import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["**/*.js", "**/*.d.ts"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/require-await": "off",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
]);
