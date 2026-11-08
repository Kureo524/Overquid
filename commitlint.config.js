/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      ['core', 'desktop', 'sdk', 'ui', 'plugins', 'docs', 'ci', 'deps', 'repo', 'release'],
    ],
  },
};
