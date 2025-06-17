import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import js from "@eslint/js";

export default [
  {
    ignores: [
      "node_modules",
      "dist",
      "**/dist",
      ".eslintrc.cjs",
      "vite.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];