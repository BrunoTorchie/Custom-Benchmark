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

	test('redacts credential formats common in prompts and config files', () => {
		for (const [input, secret] of [
			['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENG', 'wJalrXUtnFEMIK7MDENG'],
			['password: hunter2', 'hunter2'],
			['client_secret: abc123', 'abc123'],
			['api-key: q8Xk2mPz', 'q8Xk2mPz'],
			['apiKey = "abc123"', 'abc123'],
			['DATABASE_URL=postgres://admin:hunter2@db.local/app', 'hunter2'],
			['mongodb://reader:s3cr3t@cluster.local', 's3cr3t'],
			['curl -H "X-Auth: Bearer eyJhbGciOiJIUzI1NiJ9abcdef"', 'eyJhbGciOiJIUzI1NiJ9abcdef'],
			['slack xoxb-1234567890-abcdefghij', 'xoxb-1234567890-abcdefghij'],
			['aws AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
			['-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA'],
			['password="unterminated secret\nnext line', 'unterminated secret'],
		]) {
			const result = redactSecrets(input);
			assert.ok(!result.value.includes(secret), result.value);
			assert.ok(result.replacementCount > 0, input);
			assert.deepStrictEqual(redactSecrets(result.value), { value: result.value, replacementCount: 0 }, 'Redaction must be idempotent');
		}
		assert.ok(redactSecrets('password="unterminated secret\nnext line').value.endsWith('\nnext line'));
	});

	test('keeps prose and ordinary configuration that only mentions secret words', () => {
		for (const input of ['Explain why the token: field is null', 'max_tokens: 4000', 'Set num_tokens to 4096', 'the Bearer token scheme', 'https://example.com/a:b@c']) {
			assert.deepStrictEqual(redactSecrets(input), { value: input, replacementCount: 0 });
		}
	});

	test('stays linear on long unbroken runs', () => {
		for (const input of ['a'.repeat(100_000), 'ab-'.repeat(33_000), 'secret_'.repeat(14_000), '0123456789abcdef'.repeat(6_000), 'a.b'.repeat(33_000)]) {
			const started = Date.now();
			redactSecrets(input);
			assert.ok(Date.now() - started < 250, `Redaction took ${Date.now() - started} ms for ${input.slice(0, 8)}…`);
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