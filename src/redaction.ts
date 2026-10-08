export interface RedactionResult {
	value: string;
	replacementCount: number;
}

interface RedactionRule {
	pattern: RegExp;
	replacement: (match: string, ...groups: string[]) => string;
}

// Every rule must stay linear: an unanchored `[\w-]*` prefix rescans each word run from every
// position, which turned a 30k-character token into seconds of work inside a 2-second hook.
const SECRET_KEY = String.raw`(?<![\w-])[\w-]*(?:api[_-]?key|access[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*`;
const NOT_ALREADY_REDACTED = String.raw`(?!\[REDACTED)`;

const REDACTION_RULES: readonly RedactionRule[] = [
	{
		pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
		replacement: () => '[REDACTED PRIVATE KEY]',
	},
	{
		// Quoted values, including JSON. A missing closing quote still ends the secret at the line break.
		pattern: new RegExp(String.raw`(${SECRET_KEY})"${NOT_ALREADY_REDACTED}(?:\\.|[^"\\\r\n])*"?`, 'gi'),
		replacement: (_match, prefix = '') => `${prefix}"[REDACTED]"`,
	},
	{
		pattern: new RegExp(String.raw`(${SECRET_KEY})'${NOT_ALREADY_REDACTED}(?:\\.|[^'\\\r\n])*'?`, 'gi'),
		replacement: (_match, prefix = '') => `${prefix}'[REDACTED]'`,
	},
	{
		pattern: /(Authorization\s*:\s*Bearer\s+)(?!\[REDACTED)[^\s"']+/gi,
		replacement: (_match, prefix = '') => `${prefix}[REDACTED]`,
	},
	{
		// Unquoted assignments, as in .env files: any value.
		pattern: /((?<![\w-])[\w-]*(?:api[_-]?key|access[_-]?key|secret|token|password|passwd)\s*=\s*)(?!["']|\[REDACTED)[^\s"',;]+/gi,
		replacement: (_match, prefix = '') => `${prefix}[REDACTED]`,
	},
	{
		// Unquoted `key: value` pairs only when the value looks like a credential, so prose survives.
		pattern: /((?<![\w-])[\w-]*(?:api[_-]?key|access[_-]?key|secret|token|password|passwd)\s*:\s*)(?!["']|\[REDACTED)(?=[^\s"',;]*\d)[^\s"',;]{6,}/gi,
		replacement: (_match, prefix = '') => `${prefix}[REDACTED]`,
	},
	{
		pattern: /\b(Bearer\s+)(?!\[REDACTED)[A-Za-z0-9._~+/-]{16,}=*/g,
		replacement: (_match, prefix = '') => `${prefix}[REDACTED]`,
	},
	{
		// Credentials embedded in connection strings: scheme://user:password@host
		pattern: /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:)(?!\[REDACTED)[^\s/@"']+(@)/gi,
		replacement: (_match, prefix = '', at = '@') => `${prefix}[REDACTED]${at}`,
	},
	{
		pattern: /\b(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{10,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bxox[abposr]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
		replacement: () => '[REDACTED]',
	},
];

export function redactSecrets(input: string): RedactionResult {
	let value = input;
	let replacementCount = 0;

	for (const rule of REDACTION_RULES) {
		value = value.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
			replacementCount += 1;
			// The last two arguments are the match offset and the whole input, not capture groups.
			return rule.replacement(match, ...rest.slice(0, -2).map((group) => typeof group === 'string' ? group : ''));
		});
	}

	return { value, replacementCount };
}
