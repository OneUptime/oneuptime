module.exports = {
  clearMocks: true,
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/index.ts"],
  coverageDirectory: "coverage",
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  preset: "ts-jest",
  setupFilesAfterEnv: ["<rootDir>/Tests/jest.setup.ts"],
  testEnvironment: "node",
  testMatch: ["<rootDir>/Tests/**/*.test.ts", "<rootDir>/Tests/**/*.test.tsx"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
};
