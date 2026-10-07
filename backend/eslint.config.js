'use strict';

const js = require('@eslint/js');
const globals = require('globals');

/**
 * The domain layer must stay pure (PLAN.md rule 1, MEGAPLAN P2):
 * no framework/IO imports, no wall clock, no timers, no promises.
 */
const DOMAIN_FORBIDDEN_MODULES = [
  'express', 'mysql2', 'mysql2/promise', 'mqtt', 'aedes', 'fs', 'net', 'http', 'dotenv',
];

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    files: ['src/domain/**/*.js'],
    rules: {
      'no-restricted-modules': ['error', ...DOMAIN_FORBIDDEN_MODULES],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Domain is pure: pass `now` in.' },
        { object: 'Math', property: 'random', message: 'Domain is deterministic.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'setTimeout', message: 'Timing is tick-driven.' },
        { name: 'setInterval', message: 'Timing is tick-driven.' },
        { name: 'Promise', message: 'Domain is synchronous.' },
        { name: 'process', message: 'Domain must not read the environment.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'NewExpression[callee.name="Date"][arguments.length=0]', message: 'Domain is pure: pass `now` in.' },
        { selector: 'FunctionDeclaration[async=true]', message: 'Domain is synchronous.' },
        { selector: 'ArrowFunctionExpression[async=true]', message: 'Domain is synchronous.' },
      ],
    },
  },
];
