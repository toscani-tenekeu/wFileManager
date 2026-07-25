import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const generatedSecurityFiles = [
  "supabase/functions/**/*.ts",
  "src/lib/demo/data.ts",
  "src/lib/server/directory-runtime.ts",
  "src/lib/server/operation-jobs-runtime.ts",
  "src/lib/server/path-policy-runtime.ts",
  "src/lib/server/sqlite-path-policy.ts",
  "src/lib/server/sqlite-user-admin.ts",
  "src/lib/server/upload-runtime.ts",
  "src/lib/wfilemanager-api.ts",
  "src/routes/_app.roles.tsx",
  "src/routes/_app.users.tsx",
  "src/routes/api.gateway.ts",
  "src/routes/api.local.ts",
  "src/routes/api.sqlite.ts",
  "src/routes/forgot-password.tsx",
  "src/routes/reset-password.tsx",
];

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
    files: ["src/lib/server/file-manager-runtime.ts"],
    rules: {
      "no-useless-escape": "off",
    },
  },
  eslintPluginPrettier,
  {
    files: generatedSecurityFiles,
    rules: {
      "prettier/prettier": "off",
    },
  },
  {
    files: [
      "supabase/functions/wfilemanager-customer-api/index.ts",
      "supabase/functions/wfilemanager-customer-security-api/index.ts",
      "supabase/functions/wfilemanager-invoice-api/index.ts",
      "supabase/functions/wfilemanager-setup-api/index.ts",
      "supabase/functions/wfilemanager-users-admin-api/index.ts",
      "supabase/functions/wfilemanager-account-api/index.ts",
    ],
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    files: [
      "src/routes/_app.explorer.tsx",
      "supabase/functions/wfilemanager-users-admin-api/index.ts",
    ],
    rules: {
      "no-constant-binary-expression": "off",
    },
  },
);
