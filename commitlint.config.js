/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes "Bump x from 1 to 2" (sentence case); accept its titles as-is.
  ignores: [(message) => /^(chore|ci)(\(deps\))?: Bump /.test(message)],
  rules: {
    'scope-enum': [
      1,
      'always',
      ['core', 'desktop', 'sdk', 'ui', 'plugins', 'docs', 'ci', 'deps', 'repo', 'release'],
    ],
  },
};
