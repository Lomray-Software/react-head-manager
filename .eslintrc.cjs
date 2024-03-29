module.exports = {
  root: true,
  extends: [
    'prettier',
    'plugin:prettier/recommended',
    'plugin:jsx-a11y/recommended',
    '@lomray/eslint-config'
  ],
  ignorePatterns: ['/*.*'],
  plugins: [],
  env: {
    browser: true,
    es6: true,
    node: true,
    serviceworker: true,
  },
  globals: {
    NodeJS: true,
    JSX: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    files: ['*.ts', '*.tsx'],
    project: ['./tsconfig.json'],
    tsconfigRootDir: './',
  },
  rules: {
    'unicorn/import-index': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    'no-await-in-loop': 'off',
    '@typescript-eslint/no-for-in-array': 'off',
    'unicorn/no-nested-ternary': 'off',
    'prettier/prettier': [
      'error',
      {
        endOfLine: 'auto'
      }
    ]
  }
}
