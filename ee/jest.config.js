/*
 * Jest for ee/, as two projects:
 *
 *   server  node environment. Common/... and App/... resolve to the core
 *           packages (the same files ee/node_modules/{Common,App} link to), so
 *           ee code and the core code it calls share one module instance.
 *   ui      jsdom, Common's environment and setup file, and Common's whole
 *           moduleNameMapper list - DERIVED from packages/Common/jest.config.json
 *           when this file loads, never hand-copied, so the React/router/i18n
 *           pins and the bullmq/uuid/... mocks cannot drift. Plus the
 *           @oneuptime/dashboard and @oneuptime/admin-dashboard specifiers ee UI
 *           code uses to reach frontend internals.
 *
 * Run it with ee's own jest 28.1.3 (node_modules/.bin/jest), never the repo
 * root's jest 30.
 *
 * This file is CommonJS: ee/package.json deliberately has no "type" field (the
 * repo root is "type": "module", which would make ee's files ESM).
 */
const fs = require("fs");
const path = require("path");

const EE_DIR = __dirname;
const PACKAGES_DIR = path.resolve(EE_DIR, "..", "packages");
const COMMON_DIR = path.join(PACKAGES_DIR, "Common");
const APP_DIR = path.join(PACKAGES_DIR, "App");
const DASHBOARD_SRC_DIR = path.join(APP_DIR, "FeatureSet", "Dashboard", "src");
const ADMIN_DASHBOARD_SRC_DIR = path.join(
  APP_DIR,
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const TS_JEST_GLOBALS = {
  "ts-jest": {
    tsconfig: path.join(EE_DIR, "tsconfig.json"),
    babelConfig: false,
    // ee's own `tsc -p tsconfig.json` is the type check; jest only transpiles.
    isolatedModules: true,
  },
};

const MODULE_PATHS = [
  path.join(EE_DIR, "node_modules"),
  path.join(COMMON_DIR, "node_modules"),
  path.join(APP_DIR, "node_modules"),
];

const ANCHORED_CORE_MAPPERS = {
  "^Common/(.*)$": path.join(COMMON_DIR, "$1"),
  "^App/(.*)$": path.join(APP_DIR, "$1"),
};

// A bare-module key such as "Common/(.*)" matches anywhere in a path unless anchored.
const BARE_MODULE_KEY = /^[A-Za-z@]/;

const withCommonRoot = (value) => {
  return value.split("<rootDir>").join(COMMON_DIR);
};

const anchor = (key) => {
  if (!BARE_MODULE_KEY.test(key)) {
    return key;
  }

  return `^${key}${key.endsWith("$") ? "" : "$"}`;
};

const readCommonJestConfig = () => {
  return JSON.parse(
    fs.readFileSync(path.join(COMMON_DIR, "jest.config.json"), "utf8"),
  );
};

/*
 * Common's mappers with <rootDir> pointing at packages/Common and every
 * bare-module key anchored. The ee-specific keys come FIRST: jest uses the
 * first mapper that matches, and "@oneuptime/dashboard/Components/Common/..."
 * would otherwise be caught by a Common/ pattern.
 */
const deriveUiModuleNameMapper = (commonJestConfig) => {
  const mapper = {
    "^@oneuptime/dashboard/(.*)$": path.join(DASHBOARD_SRC_DIR, "$1"),
    "^@oneuptime/admin-dashboard/(.*)$": path.join(
      ADMIN_DASHBOARD_SRC_DIR,
      "$1",
    ),
    "^@oneuptime/ee-dashboard$": path.join(EE_DIR, "Dashboard", "Index.tsx"),
    "^@oneuptime/ee-admin-dashboard$": path.join(
      EE_DIR,
      "AdminDashboard",
      "Index.tsx",
    ),
    ...ANCHORED_CORE_MAPPERS,
  };

  for (const [key, value] of Object.entries(
    commonJestConfig.moduleNameMapper || {},
  )) {
    const anchoredKey = anchor(key);

    if (anchoredKey in mapper) {
      continue;
    }

    mapper[anchoredKey] = withCommonRoot(value);
  }

  return mapper;
};

const commonJestConfig = readCommonJestConfig();

module.exports = {
  projects: [
    {
      displayName: "server",
      rootDir: EE_DIR,
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/Tests/Server/**/*.test.ts"],
      testPathIgnorePatterns: ["/node_modules/", "/build/"],
      modulePathIgnorePatterns: ["<rootDir>/build"],
      moduleFileExtensions: ["ts", "tsx", "js", "json"],
      transform: { "^.+\\.(ts|tsx)$": "ts-jest" },
      globals: TS_JEST_GLOBALS,
      moduleNameMapper: { ...ANCHORED_CORE_MAPPERS },
      modulePaths: MODULE_PATHS,
      testTimeout: 30000,
    },
    {
      displayName: "ui",
      rootDir: EE_DIR,
      preset: "ts-jest",
      testEnvironment: withCommonRoot(commonJestConfig.testEnvironment),
      setupFilesAfterEnv: (commonJestConfig.setupFilesAfterEnv || []).map(
        withCommonRoot,
      ),
      testMatch: ["<rootDir>/Tests/UI/**/*.test.{ts,tsx}"],
      testPathIgnorePatterns: ["/node_modules/", "/build/"],
      modulePathIgnorePatterns: ["<rootDir>/build"],
      moduleFileExtensions: ["ts", "tsx", "js", "json"],
      transform: { "^.+\\.(ts|tsx)$": "ts-jest" },
      transformIgnorePatterns: commonJestConfig.transformIgnorePatterns || [],
      globals: TS_JEST_GLOBALS,
      moduleNameMapper: deriveUiModuleNameMapper(commonJestConfig),
      modulePaths: MODULE_PATHS,
      testTimeout: commonJestConfig.testTimeout || 60000,
    },
  ],
};
