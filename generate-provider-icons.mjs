import { icons } from '@iconify-json/logos';
import { mkdirSync, writeFileSync } from 'node:fs';

const selectedIcons = ['claude-icon'];
const generatedIcons = Object.fromEntries(selectedIcons.map((name) => {
	const icon = icons.icons[name];
	if (!icon) {
		throw new Error(`Iconify logo not found: ${name}`);
	}

	return [name, {
		body: icon.body,
		left: icon.left ?? 0,
		top: icon.top ?? 0,
		width: icon.width ?? icons.width ?? 24,
		height: icon.height ?? icons.height ?? 24,
	}];
}));

mkdirSync('src/generated', { recursive: true });
writeFileSync(
	'src/generated/providerIcons.ts',
	`// Generated from @iconify-json/logos. Do not edit manually.\nexport const providerIcons = ${JSON.stringify(generatedIcons, null, '\t')} as const;\n`,
);