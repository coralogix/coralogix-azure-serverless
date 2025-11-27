module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'EventHub/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
};

