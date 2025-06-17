import tsEslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";


export default [
	{
		files: ['**/*.ts'],
		ignores: [
			'dist/**',
			'node_modules/**'
		],
        languageOptions: {
            parser: tsparser,
            ecmaVersion: 2020,
            sourceType: 'module',
        },
		plugins: {
			"@typescript-eslint": tsEslint
		},
		rules: {
			...tsEslint.configs.recommended.rules,
			"@typescript-eslint/no-explicit-any": "off"
		}
	}
];