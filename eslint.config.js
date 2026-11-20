import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["node_modules/**", "dist/**", ".wrangler/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: [
      "packages/contracts/src/v1/contract-validation.ts",
      "packages/storage-sqlite/src/index.ts",
    ],
    rules: { "no-control-regex": "off" },
  },
  {
    files: ["tests/cloudflare-deploy.test.mjs"],
    rules: { "no-regex-spaces": "off" },
  },
];
