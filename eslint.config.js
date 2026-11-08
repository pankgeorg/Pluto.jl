// Lint the Julia sources with eslint-plugin-julia (https://github.com/pankgeorg/eslint-plugin-julia):
// the recommended rules as errors, every other rule as a warning (the `strict` preset).
import julia from 'eslint-plugin-julia';

export default [
  {
    ignores: [
      'frontend/**',
      'frontend-bundler/**',
      'frontend-dist/**',
      '**/node_modules/**',
      // Deliberately broken notebooks and fixtures (syntax errors are the point).
      'sample/cm6 crash test.jl',
      'sample/test1.jl',
      'test/frontend/fixtures/**',
    ],
  },
  julia.configs.strict,
];
