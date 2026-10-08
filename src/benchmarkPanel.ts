import { officialModelsForProvider, PROVIDER_MODEL_SNAPSHOT } from './providerModels';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { BenchmarkData, BenchmarkExecutor, BenchmarkModel, BenchmarkRepository, DEMO_MODELS, TASK_TYPES, createBenchmarkCase, upsertBenchmarkCase, demoCases, demoExecutor, executeBenchmark, modelKey, selectBenchmarkModels, registeredBenchmarkPerformance } from './benchmark';

export class BenchmarkWorkbench implements vscode.Disposable {
	private panel?: vscode.WebviewPanel;
	private controller?: AbortController;
	private data?: BenchmarkData;
	private models: vscode.LanguageModelChat[] = [];
	private panelDisposables: vscode.Disposable[] = [];
	private busy = false;

	constructor(private readonly folder: vscode.WorkspaceFolder, private readonly repository: BenchmarkRepository, private readonly onChange: () => Promise<void>) {}

	async open(prompt = ''): Promise<void> {
		if (this.panel) {
			this.panel.reveal();
			if (prompt.trim()) { await this.panel.webview.postMessage({ type: 'draft', prompt }); }
			return;
		}
		this.data = await this.repository.update((data) => {
			for (const run of data.runs) { if (run.status === 'running') { run.status = 'interrupted'; } }
		});
		this.panel = vscode.window.createWebviewPanel('personalBenchmark.workbench', `Benchmark · ${this.folder.name}`, vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
		this.panel.webview.html = renderBenchmarkWorkbench(this.panel.webview, this.folder.name, prompt);
		this.panelDisposables = [
			this.panel.onDidDispose(() => {
				this.controller?.abort();
				this.panel = undefined;
				this.panelDisposables.forEach((item) => item.dispose());
				this.panelDisposables = [];
			}),
			this.panel.webview.onDidReceiveMessage((message: unknown) => {
				void this.handleMessage(message).catch((error: unknown) => this.publish(error instanceof Error ? error.message : String(error)));
			}),
		];
	}

	dispose(): void { this.controller?.abort(); this.panel?.dispose(); this.panelDisposables.forEach((item) => item.dispose()); }
	get running(): boolean { return this.busy; }
	private async publish(error?: string, notice?: string): Promise<void> {
		await this.panel?.webview.postMessage({ type: 'state', data: this.data, models: this.models.map((model) => ({ ...describeModel(model), key: modelKey(model) })), busy: this.busy, error, notice, eligible: this.data ? registeredBenchmarkPerformance(this.data).length : 0 });
		await this.onChange();
	}
	private async handleMessage(value: unknown): Promise<void> {
		if (!value || typeof value !== 'object') { return; }
		const message = value as Record<string, unknown>;
		if (message.type === 'cancel') { this.controller?.abort(); return; }
		if (message.type === 'ready') { await this.publish(); return; }
		if (this.busy) { throw new Error('Wait for the current operation or cancel the run first.'); }
		this.busy = true;
		let notice: string | undefined;
		try {
			switch (message.type) {
				case 'refreshModels': this.models = await vscode.lm.selectChatModels(); break;
				case 'save': {
					if (message.consent !== true) { throw new Error('Confirm that this curated prompt and its checks may be saved locally.'); }
					const item = createBenchmarkCase(message.input);
					this.data = await this.repository.update((data) => upsertBenchmarkCase(data, item, message.caseId));
					await this.panel?.webview.postMessage({ type: 'saved' });
					notice = 'Case saved.';
					break;
				}
				case 'remove': {
					const item = this.data?.cases.find((candidate) => candidate.id === message.caseId);
					if (!item) { return; }
					if (await vscode.window.showWarningMessage(`Remove “${item.title}” from future benchmarks? Historical runs keep their case snapshots.`, { modal: true }, 'Remove case') !== 'Remove case') { return; }
					this.data = await this.repository.update((data) => { data.cases = data.cases.filter((candidate) => candidate.id !== item.id); });
					break;
				}
				case 'demo': {
					this.data = await this.repository.update((data) => {
						const missing = demoCases().filter((item) => !data.cases.some((candidate) => candidate.fingerprint === item.fingerprint));
						if (data.cases.length + missing.length > 100) { throw new Error('Make room for the three demo cases before running the demo (100-case limit).'); }
						data.cases.push(...missing);
					});
					await this.run(this.data.cases.filter((item) => demoCases().some((demo) => demo.fingerprint === item.fingerprint)).map((item) => item.id), DEMO_MODELS, demoExecutor, true);
					break;
				}
				case 'run': {
					if (!vscode.workspace.isTrusted) { throw new Error('Trust this workspace before running model requests.'); }
					if (!Array.isArray(message.modelIds) || !Array.isArray(message.caseIds)) { throw new Error('Select cases and models.'); }
					const selected = selectBenchmarkModels(this.models, message.modelIds);
					if (selected.length < 1 || selected.length > 5) { throw new Error('Select 1–5 available models; use Refresh models if the list is empty.'); }
					const caseIds = message.caseIds.filter((id): id is string => typeof id === 'string');
					const cases = this.data?.cases.filter((item) => caseIds.includes(item.id)) ?? [];
					if (!cases.length) { throw new Error('Select at least one case.'); }
					const choice = await vscode.window.showInformationMessage(`Run ${cases.length * selected.length} model requests?`, { modal: true, detail: `Send the full saved prompts for ${cases.map((item) => item.title).join(', ')} to ${selected.map((model) => `${model.name} (${model.vendor})`).join(', ')} through VS Code. Provider usage limits or charges may apply. No repository files, captured traces, or scoring answers are sent. Each request has a 60-second timeout. Review prompts in the case editor before proceeding.` }, 'Run reviewed benchmark');
					if (choice !== 'Run reviewed benchmark') { return; }
					await this.run(caseIds, selected.map(describeModel), languageModelExecutor(selected), false);
					break;
				}
			}
		} finally { this.busy = false; await this.publish(undefined, notice); }
	}
	private async run(caseIds: string[], models: BenchmarkModel[], executor: BenchmarkExecutor, demo: boolean): Promise<void> {
		this.controller = new AbortController();
		const cases = this.data?.cases.filter((item) => caseIds.includes(item.id)) ?? [];
		try {
			await executeBenchmark(cases, models, executor, { signal: this.controller.signal, demo, onProgress: async (run) => {
				this.data = await this.repository.update((data) => {
					const index = data.runs.findIndex((item) => item.id === run.id);
					if (index < 0) { data.runs.push(run); } else { data.runs[index] = run; }
					data.runs = data.runs.slice(-50);
				});
				await this.publish();
			} });
		} finally { this.controller = undefined; }
	}
}

export function describeModel(model: vscode.LanguageModelChat): BenchmarkModel { return { id: model.id, name: model.name, vendor: model.vendor, version: model.version }; }
export function languageModelExecutor(models: readonly vscode.LanguageModelChat[]): BenchmarkExecutor {
	return async (identity, prompt, signal) => {
		const model = models.find((candidate) => modelKey(describeModel(candidate)) === modelKey(identity));
		if (!model) { throw new Error('The selected model is no longer available. Refresh models and try again.'); }
		const cancellation = new vscode.CancellationTokenSource();
		const abort = (): void => cancellation.cancel();
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) { cancellation.cancel(); }
		try {
			const tokens = await model.countTokens(prompt, cancellation.token);
			if (signal.aborted) { throw new Error('Run cancelled.'); }
			if (tokens > model.maxInputTokens) { throw new Error('This case exceeds the model input token limit.'); }
			const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], { justification: 'Run the benchmark cases you reviewed and selected.' }, cancellation.token);
			let text = '';
			for await (const fragment of response.text) {
				if (signal.aborted) { throw new Error('Run cancelled.'); }
				text += fragment;
				if (text.length > 64_000) { cancellation.cancel(); throw new Error('Model output exceeded the 64,000 character limit.'); }
			}
			return text;
		} finally { signal.removeEventListener('abort', abort); cancellation.cancel(); cancellation.dispose(); }
	};
}

export function renderBenchmarkWorkbench(_webview: Pick<vscode.Webview, 'cspSource'>, repositoryName: string, prompt: string): string {
	const nonce = randomBytes(16).toString('base64');
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>Benchmark workbench</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;--surface:var(--vscode-editor-background);--border:var(--vscode-panel-border);--muted:var(--vscode-descriptionForeground);--accent:var(--vscode-textLink-foreground)}
*{box-sizing:border-box}body{margin:0;padding:28px;color:var(--vscode-editor-foreground);background:var(--surface);font:13px/1.55 var(--vscode-font-family)}main{max-width:1120px;margin:auto}header{border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:22px}h1{font-size:28px;font-weight:600;letter-spacing:-.6px;margin:6px 0}h2{font-size:17px;margin:0 0 12px}h3{font-size:14px;margin:14px 0 6px}.eyebrow{font-size:10px;letter-spacing:1.8px;color:var(--accent);font-weight:bold}p{margin:6px 0 12px;color:var(--muted)}.grid{display:grid;grid-template-columns:minmax(240px,1fr) minmax(240px,1fr);gap:20px}.card{padding:20px;border:1px solid var(--border);border-radius:8px;margin-bottom:20px;min-width:0}label{display:block;margin:10px 0 5px}input:not([type=checkbox]),textarea,select{width:100%;font:inherit;padding:8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--border));border-radius:3px}textarea{min-height:100px;resize:vertical}button{font:inherit;border:0;border-radius:3px;padding:8px 12px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.5;cursor:default}.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.check{display:grid;grid-template-columns:100px 1fr 30px;gap:6px;margin-bottom:8px}.check button{padding:4px}.choice{display:flex;align-items:flex-start;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);overflow-wrap:anywhere}.choice label{margin:0;flex:1}.choice small{display:block;color:var(--muted)}.choice button{padding:3px 7px}.consent{display:flex;gap:8px;align-items:flex-start;color:var(--muted)}.status{padding:12px;border-left:3px solid var(--accent);background:var(--vscode-textBlockQuote-background);margin-bottom:18px;overflow-wrap:anywhere}.status:empty{display:none}.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:9px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;font-size:12px}.score{font-size:20px;font-weight:600;color:var(--accent)}summary{cursor:pointer;padding:8px 0}.pill{font-size:10px;letter-spacing:.5px;border:1px solid var(--border);padding:2px 6px;border-radius:10px}.empty{padding:16px 0;color:var(--muted)}@media(max-width:650px){body{padding:14px}.grid{grid-template-columns:1fr}.card{padding:14px}h1{font-size:23px}}@media(max-width:300px){.check{grid-template-columns:1fr 30px}.check select{grid-column:1 / -1}}
</style></head><body><main>
<header><div class="eyebrow">PERSONAL BENCHMARK / ${escapeHtml(repositoryName)}</div><h1>Measure models on your work.</h1><p>Curate a task, define success, and compare scored answers. Results stay on this machine.</p><span class="pill">EXPLICIT RUN REVIEW</span> <span class="pill">DETERMINISTIC CHECKS</span></header>
<div id="status" class="status" role="status" aria-live="polite"></div>
<div class="grid"><section class="card"><h2 id="editor-title">1. Create a case</h2><p>Save a self-contained prompt. Full curated prompts are stored locally after redaction; raw captured prompts remain transient.</p>
<form id="case-form"><label for="title">Case title</label><input id="title" required maxlength="120" placeholder="e.g. Explain a failing async test"><label for="task">Task type</label><select id="task">${TASK_TYPES.map((task) => `<option>${task}</option>`).join('')}</select><label for="prompt">Prompt sent to the model</label><textarea id="prompt" required maxlength="20000" placeholder="Include all context the model needs">${escapeHtml(prompt)}</textarea><label>Success checks</label><p>Checks carry equal weight. Contains/excludes ignore case; exact trims surrounding whitespace; JSON requires a valid JSON answer.</p><div id="checks"></div><button type="button" id="add-check" class="secondary">Add check</button><label class="consent"><input id="consent" type="checkbox" required><span>Save this curated prompt and its checks on this machine.</span></label><div class="actions"><button id="save" type="submit">Save case</button><button type="button" class="secondary" id="new-case">New case</button></div></form>
</section><section class="card"><h2>2. Select and run</h2><p>Only selected prompts go to selected models after review. Scoring answers and repository files are never sent.</p><h3>Cases <span id="case-count" class="pill">0</span></h3><div id="cases"></div><h3>Runnable models</h3><div id="models"><p>Refresh to discover models available through VS Code.</p></div><div class="actions"><button id="refresh-models" class="secondary">Refresh models</button><button id="run">Review &amp; run</button><button id="cancel" class="secondary" disabled>Cancel</button></div><details><summary>Official provider models · ${PROVIDER_MODEL_SNAPSHOT.checkedAt}</summary><p>Documented offerings; access depends on plan, policy and client version. Only models exposed through VS Code appear as runnable above. Claude Code and Codex offerings here are reference lists, not benchmark connections.</p>${(['copilot', 'claude', 'codex'] as const).map((id) => `<h3>${({ copilot: 'GitHub Copilot', claude: 'Claude Code', codex: 'OpenAI Codex' })[id]}</h3><p>${officialModelsForProvider(id).map((model) => escapeHtml(model.label)).join(' · ')}</p>`).join('')}</details><h3>Try the complete workflow</h3><p>Run three synthetic cases against two mock models. Demo scores never influence recommendations.</p><button id="demo" class="secondary">Run demo benchmark</button></section></div>
<section class="card"><h2>3. Results &amp; evidence</h2><p id="evidence">Three distinct comparable cases of one task type are needed before real results influence recommendations.</p><div id="results" class="empty">No runs yet. Create a case or try the demo.</div></section>
</main><script nonce="${nonce}">
const api=acquireVsCodeApi();const el=id=>document.getElementById(id);let state;let editing;let selectedCases=new Set();let selectedModels=new Set();let seenCases=new Set();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function addCheck(kind='contains',expected=''){const row=document.createElement('div');row.className='check';row.innerHTML='<select aria-label="Check kind">'+['contains','excludes','exact','json'].map(k=>'<option>'+k+'</option>').join('')+'</select><input aria-label="Expected answer text" maxlength="2000" placeholder="Expected text"><button type="button" class="secondary" aria-label="Remove check">×</button>';row.querySelector('select').value=kind;row.querySelector('input').value=expected;row.querySelector('button').onclick=()=>{row.remove()};el('checks').append(row)}
function reset(){editing=undefined;el('case-form').reset();el('prompt').value='';el('checks').textContent='';addCheck();el('editor-title').textContent='1. Create a case'}
function send(type,extra={}){el('status').textContent='';api.postMessage({type,...extra})}
el('add-check').onclick=()=>addCheck();el('new-case').onclick=reset;
el('case-form').onsubmit=event=>{event.preventDefault();send('save',{caseId:editing,consent:el('consent').checked,input:{title:el('title').value,taskType:el('task').value,prompt:el('prompt').value,checks:[...el('checks').children].map(row=>({kind:row.querySelector('select').value,expected:row.querySelector('input').value}))}});};
el('refresh-models').onclick=()=>send('refreshModels');el('demo').onclick=()=>send('demo');el('cancel').onclick=()=>send('cancel');el('run').onclick=()=>send('run',{caseIds:[...selectedCases],modelIds:[...selectedModels]});
function render(){const data=state.data;if(!data)return;data.cases.forEach(c=>{if(!seenCases.has(c.id)){seenCases.add(c.id);selectedCases.add(c.id)}});el('case-count').textContent=data.cases.length;el('cases').innerHTML=data.cases.map(c=>'<div class="choice"><input type="checkbox" aria-label="Select '+esc(c.title)+'" data-case="'+esc(c.id)+'" '+(selectedCases.has(c.id)?'checked':'')+'><label>'+esc(c.title)+'<small>'+esc(c.taskType)+(c.synthetic?' · DEMO':'')+' · '+c.checks.length+' checks</small></label><button class="secondary" data-edit="'+esc(c.id)+'">Edit</button><button class="secondary" aria-label="Remove '+esc(c.title)+'" data-remove="'+esc(c.id)+'">×</button></div>').join('')||'<p>No cases yet. Save one or run the demo.</p>';
el('models').innerHTML=state.models.map(m=>'<div class="choice"><input type="checkbox" aria-label="Select '+esc(m.name)+'" data-model="'+esc(m.key)+'" '+(selectedModels.has(m.key)?'checked':'')+'><label>'+esc(m.name)+'<small>'+esc(m.vendor)+' · '+esc(m.id)+' · '+esc(m.version||'provider default')+'</small></label></div>').join('')||'<p>No models loaded. Use Refresh models. If none appear, sign into a model provider in VS Code. Demo mode works offline.</p>';
el('evidence').textContent=state.eligible?state.eligible+' model/task scores are eligible for recommendations. Only complete real runs and unchanged cases count.':'Three distinct comparable cases of one task type are needed before real results influence recommendations. Demo, failed, cancelled and interrupted runs are excluded.';
el('results').innerHTML=[...data.runs].reverse().map((r,index)=>{const summary=r.models.map(m=>{const rows=r.results.filter(x=>x.model.id===m.id&&x.model.vendor===m.vendor&&x.model.version===m.version);const score=rows.length?Math.round(rows.reduce((s,x)=>s+x.score,0)/rows.length):0;return '<tr><td>'+esc(m.name)+'</td><td class="score">'+(rows.length===0?'—':rows.some(x=>x.status!=='scored')?'Incomplete':score+'/100')+'</td><td>'+rows.length+'/'+r.cases.length+'</td><td>'+rows.filter(x=>x.status==='error').length+'</td></tr>'}).join('');return '<details '+(index===0?'open':'')+'><summary><strong>'+(r.demo?'DEMO · ':'')+esc(r.status.toUpperCase())+'</strong> · '+esc(new Date(r.startedAt).toLocaleString())+' · '+r.results.length+'/'+(r.cases.length*r.models.length)+' answers</summary><div class="scroll"><table><thead><tr><th>Model</th><th>Score</th><th>Cases</th><th>Errors</th></tr></thead><tbody>'+summary+'</tbody></table></div>'+r.results.map(x=>{const c=r.cases.find(c=>c.id===x.caseId);return '<details><summary>'+esc(c?.title||x.caseId)+' · '+esc(x.model.name)+' · '+(x.status==='scored'?x.score+'/100':x.status.toUpperCase())+' · '+x.durationMs+'ms</summary><p>'+esc(x.error||x.passed.map((p,i)=>(p?'PASS':'FAIL')+' '+c.checks[i].kind+': '+c.checks[i].expected).join(' | '))+'</p><pre>'+esc(x.output)+(x.outputTruncated?'\\n[Preview truncated; scoring used the full answer.]':'')+'</pre></details>'}).join('')+'</details>'}).join('')||'No runs yet. Create a case or try the demo.';
['save','demo','run','refresh-models'].forEach(id=>el(id).disabled=state.busy);el('cancel').disabled=!state.busy;if(state.error)el('status').textContent=state.error;else if(state.notice)el('status').textContent=state.notice;else if(state.busy)el('status').textContent='Running… completed answers are saved as they arrive.';else el('status').textContent='';}
document.addEventListener('change',event=>{const t=event.target;if(t.dataset.case){t.checked?selectedCases.add(t.dataset.case):selectedCases.delete(t.dataset.case)}if(t.dataset.model){t.checked?selectedModels.add(t.dataset.model):selectedModels.delete(t.dataset.model)}});
document.addEventListener('click',event=>{const t=event.target.closest('button');if(!t)return;if(t.dataset.remove)send('remove',{caseId:t.dataset.remove});if(t.dataset.edit){const c=state.data.cases.find(c=>c.id===t.dataset.edit);editing=c.id;el('title').value=c.title;el('task').value=c.taskType;el('prompt').value=c.prompt;el('checks').textContent='';c.checks.forEach(c=>addCheck(c.kind,c.expected));el('consent').checked=false;el('editor-title').textContent='Edit case';el('title').focus()}});
window.addEventListener('message',event=>{if(event.data.type==='state'){state=event.data;render()}if(event.data.type==='saved'){reset()}if(event.data.type==='draft'&&!editing&&!el('prompt').value.trim()){el('prompt').value=event.data.prompt}});addCheck();send('ready');
</script></body></html>`;
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
