import tseslint from "typescript-eslint";

const sharedParserOptions = {
  tsconfigRootDir: import.meta.dirname,
};

const strictTypeRules = {
  eqeqeq: ["error", "always"],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "test-js/**"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ...sharedParserOptions,
        project: "./tsconfig.json",
      },
    },
    rules: strictTypeRules,
  },
  {
    files: ["test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        ...sharedParserOptions,
        project: "./tsconfig.test.json",
      },
    },
    rules: {
      ...strictTypeRules,
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
];
