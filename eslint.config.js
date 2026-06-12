import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["**/*.js", "**/*.d.ts"],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      "@typescript-eslint/member-ordering": "warn",
      "@typescript-eslint/method-signature-style": "error",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-import-type-side-effects": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/prefer-readonly": "warn",
      "@typescript-eslint/promise-function-async": "warn",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/strict-boolean-expressions": "error",
      eqeqeq: ["error", "smart"],
      "no-console": "error",
      "no-else-return": "warn",
      "no-implicit-coercion": "warn",
      "no-lonely-if": "warn",
      "no-return-assign": "warn",
      "no-useless-rename": "warn",
      "object-shorthand": "warn",
      "prefer-const": "warn",
      yoda: "warn",
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
]);
