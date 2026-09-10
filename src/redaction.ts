export interface RedactionResult {
	value: string;
	replacementCount: number;
}

interface RedactionRule {
	pattern: RegExp;
	replacement: (match: string, prefix?: string) => string;
}

const REDACTION_RULES: readonly RedactionRule[] = [
	{
		pattern: /(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi,
		replacement: (_match, prefix = '') => `${prefix}[REDACTED]`,
	},
	{
		pattern: /((?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*)[^\s"']+/gi,
		replacement: (_match, prefix = '') => `${prefix}[REDACTED]`,
	},
	{
		pattern: /\b(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{10,}\b/g,
		replacement: () => '[REDACTED]',
	},
];

export function redactSecrets(input: string): RedactionResult {
	let value = input;
	let replacementCount = 0;

	for (const rule of REDACTION_RULES) {
		value = value.replace(rule.pattern, (match, prefix: string | undefined) => {
			replacementCount += 1;
			return rule.replacement(match, prefix);
		});
	}

	return { value, replacementCount };
}