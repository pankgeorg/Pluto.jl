// Lint the Julia sources with eslint-plugin-julia (https://github.com/pankgeorg/eslint-plugin-julia):
// the recommended rules as errors, every other rule as a warning.
import julia from 'eslint-plugin-julia';

const warn = Object.fromEntries(Object.keys(julia.configs.all.rules).map(r => [r, 'warn']));

export default [
  { ignores: ['frontend/**', 'frontend-bundler/**', 'frontend-dist/**', '**/node_modules/**'] },
  { ...julia.configs.all, rules: { ...warn, ...julia.configs.recommended.rules } },
];
