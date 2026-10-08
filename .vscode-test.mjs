import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: fileURLToPath(new URL('./src/test/fixtures/workspace', import.meta.url)),
	mocha: {
		ui: 'tdd',
		timeout: 20000,
	},
});
