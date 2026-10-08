import * as assert from 'assert';

import { redactSecrets } from '../redaction';

suite('Secret redaction', () => {
	test('redacts common token and authorization formats', () => {
		const input = [
			'Authorization: Bearer secret-token-value',
			'OPENAI_API_KEY=sk-example123456789',
			'github_pat_example1234567890',
		].join('\n');

		const result = redactSecrets(input);

		assert.strictEqual(result.replacementCount, 3);
		assert.ok(!result.value.includes('secret-token-value'));
		assert.ok(!result.value.includes('sk-example123456789'));
		assert.ok(!result.value.includes('github_pat_example1234567890'));
		assert.strictEqual(result.value.match(/\[REDACTED\]/g)?.length, 3);
	});

	test('redacts quoted environment values and JSON credentials without corrupting JSON', () => {
		for (const input of [
			'PASSWORD="synthetic secret with spaces"',
			"API_KEY='synthetic secret with spaces'",
			'{"password":"synthetic secret with spaces","safe":"keep me"}',
			JSON.stringify({ password: 'synthetic secret "with quotes"', safe: 'keep me' }),
		]) {
			const result = redactSecrets(input);
			assert.ok(!result.value.includes('synthetic secret'));
			assert.strictEqual(result.replacementCount, 1);
			if (input.startsWith('{')) {
				assert.deepStrictEqual(JSON.parse(result.value), { password: '[REDACTED]', safe: 'keep me' });
			}
		}
	});

	test('leaves ordinary text unchanged', () => {
		const result = redactSecrets('Run npm test and summarize the failures.');

		assert.deepStrictEqual(result, {
			value: 'Run npm test and summarize the failures.',
			replacementCount: 0,
		});
	});
});