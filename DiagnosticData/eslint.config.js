import tsEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
	{
		ignores: ["node_modules", "dist"],
		languageOptions: {
			parser: tsParser,
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