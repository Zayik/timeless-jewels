module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  plugins: ['svelte', '@typescript-eslint'],
  ignorePatterns: ['*.cjs'],
  overrides: [
    {
      files: ['*.svelte'],
      parser: 'svelte-eslint-parser',
      parserOptions: {
        parser: '@typescript-eslint/parser'
      },
      rules: {
        // Svelte 5 runes require `let` for reactive declarations ($state, $props,
        // $bindable, $derived) — the compiler reassigns them — so the core rule
        // misfires on every rune. And `x = x` is the idiomatic way to nudge
        // reactivity. Both are false positives in component files.
        'prefer-const': 'off',
        'no-self-assign': 'off'
      }
    }
  ],
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2020
  },
  env: {
    browser: true,
    es2017: true,
    node: true
  },
  rules: {
    'no-undef': 'off',
    'array-callback-return': 'error',
    'no-constant-binary-expression': 'error',
    'no-self-compare': 'error',
    'no-template-curly-in-string': 'error',
    'no-unmodified-loop-condition': 'error',
    'no-unreachable-loop': 'error',
    'arrow-body-style': ['error', 'as-needed'],
    'block-scoped-var': 'error',
    curly: ['error', 'all'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-var': 'error',
    'one-var': ['error', 'never'],
    'prefer-arrow-callback': 'error',
    'prefer-const': 'error',
    yoda: 'error',
    'array-bracket-newline': ['error', { multiline: true }],
    'brace-style': 'error',
    // Core no-shadow flags TS enums (which create a type and value of the same
    // name) as self-shadowing; the typescript-eslint variant understands them.
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',
    // Function declarations are hoisted, so using them before their definition
    // is safe and keeps high-level functions readable at the top of a file.
    'no-use-before-define': ['error', { functions: false }],
    'dot-notation': 'error'
  }
};
