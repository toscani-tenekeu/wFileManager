import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: [
      "supabase/functions/**/*.ts",
      "src/lib/server/archive-runtime.ts",
      "src/lib/server/archive-runtime-v2.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: [
      "supabase/functions/wfilemanager-customer-api/index.ts",
      "supabase/functions/wfilemanager-customer-security-api/index.ts",
      "supabase/functions/wfilemanager-invoice-api/index.ts",
      "supabase/functions/wfilemanager-setup-api/index.ts",
    ],
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    files: ["src/routes/_app.explorer.tsx"],
    rules: {
      "no-constant-binary-expression": "off",
    },
  },
  {
    files: ["src/lib/server/file-manager-runtime.ts"],
    rules: {
      "no-useless-escape": "off",
    },
  },
  eslintPluginPrettier,
);
