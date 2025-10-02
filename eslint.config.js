import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    ignores: ["dist/**", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
      parserOptions: {
        projectService: true,
      },
    },
  }
);
