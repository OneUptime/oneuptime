import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ee/jest.config.js: the server project must resolve Common/ and App/ to the
 * core packages with anchored mappers, and the ui project's mapper list must
 * be DERIVED from packages/Common/jest.config.json (never a drifting copy).
 * Running this file at all proves the server project works.
 */

interface JestProject {
  displayName: string;
  rootDir: string;
  testEnvironment: string;
  testMatch: Array<string>;
  moduleNameMapper: Record<string, string>;
  setupFilesAfterEnv?: Array<string>;
}

// An anchored ("^...") or file-extension ("\\.(css|...)$") mapper key.
const ANCHORED_OR_EXTENSION_KEY: RegExp = /^[\^\\]/;

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const COMMON_DIR: string = path.resolve(EE_DIR, "..", "packages", "Common");
const APP_DIR: string = path.resolve(EE_DIR, "..", "packages", "App");

/*
 * Keys ee/jest.config.js maps itself, ahead of Common's list: the core
 * packages, the frontend internals, and the Enterprise plugin specifiers -
 * which Common maps to the Community stubs but ee must map to its own
 * plugins.
 */
const EE_OVERRIDDEN_KEYS: ReadonlySet<string> = new Set<string>([
  "^Common/(.*)$",
  "^App/(.*)$",
  "^@oneuptime/dashboard/(.*)$",
  "^@oneuptime/admin-dashboard/(.*)$",
  "^@oneuptime/ee-dashboard$",
  "^@oneuptime/ee-admin-dashboard$",
]);

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const jestConfig: {
  projects: Array<JestProject>;
} = require("../../jest.config.js");

const project: (name: string) => JestProject = (name: string): JestProject => {
  const found: JestProject | undefined = jestConfig.projects.find(
    (candidate: JestProject): boolean => {
      return candidate.displayName === name;
    },
  );

  if (!found) {
    throw new Error(`No jest project named ${name}`);
  }

  return found;
};

const commonJestConfig: {
  moduleNameMapper: Record<string, string>;
  testEnvironment: string;
  setupFilesAfterEnv: Array<string>;
} = JSON.parse(
  fs.readFileSync(path.join(COMMON_DIR, "jest.config.json"), "utf8"),
);

describe("ee/jest.config.js", () => {
  test("has exactly the server and ui projects, both rooted at ee/", () => {
    expect(
      jestConfig.projects.map((candidate: JestProject) => {
        return candidate.displayName;
      }),
    ).toEqual(["server", "ui"]);

    for (const candidate of jestConfig.projects) {
      expect(candidate.rootDir).toBe(EE_DIR);
    }
  });

  test("the server project runs in node, and this test is in it", () => {
    expect(project("server").testEnvironment).toBe("node");
    expect(
      typeof (globalThis as unknown as Record<string, unknown>)["document"],
    ).toBe("undefined");
  });

  test("the server project maps Common/ and App/ with anchored patterns only", () => {
    expect(project("server").moduleNameMapper).toEqual({
      "^Common/(.*)$": path.join(COMMON_DIR, "$1"),
      "^App/(.*)$": path.join(APP_DIR, "$1"),
    });
  });

  test("Common/ and App/ imports land on the core packages", () => {
    expect(require.resolve("Common/Server/Enterprise/EnterpriseEdition")).toBe(
      path.join(COMMON_DIR, "Server", "Enterprise", "EnterpriseEdition.ts"),
    );
    expect(require.resolve("App/Utils/EnterpriseLoader")).toBe(
      path.join(APP_DIR, "Utils", "EnterpriseLoader.ts"),
    );
  });

  test("the ui project uses Common's jsdom environment and setup file", () => {
    const ui: JestProject = project("ui");

    expect(ui.testEnvironment).toBe(
      commonJestConfig.testEnvironment.replace("<rootDir>", COMMON_DIR),
    );
    expect(fs.existsSync(ui.testEnvironment)).toBe(true);
    expect(ui.setupFilesAfterEnv).toEqual(
      commonJestConfig.setupFilesAfterEnv.map((file: string) => {
        return file.replace("<rootDir>", COMMON_DIR);
      }),
    );
  });

  test("the ui project carries every one of Common's mappers, rooted at packages/Common", () => {
    const uiMapper: Record<string, string> = project("ui").moduleNameMapper;

    for (const [key, value] of Object.entries(
      commonJestConfig.moduleNameMapper,
    )) {
      const expectedValue: string = value.split("<rootDir>").join(COMMON_DIR);
      const mappedKey: string | undefined = [key, `^${key}$`, `^${key}`].find(
        (candidate: string): boolean => {
          return candidate in uiMapper;
        },
      );

      expect({ key, mapped: mappedKey !== undefined }).toEqual({
        key,
        mapped: true,
      });

      if (EE_OVERRIDDEN_KEYS.has(mappedKey as string)) {
        // ee maps these itself (Common's copy points at the CE stubs).
        continue;
      }

      expect(uiMapper[mappedKey as string]).toBe(expectedValue);
    }
  });

  test("no ui mapper still points at <rootDir> or is an unanchored bare module pattern", () => {
    for (const [key, value] of Object.entries(project("ui").moduleNameMapper)) {
      expect(value).not.toContain("<rootDir>");
      expect({
        key,
        anchoredOrExtension: ANCHORED_OR_EXTENSION_KEY.test(key),
      }).toEqual({
        key,
        anchoredOrExtension: true,
      });
    }
  });

  test("the frontend specifiers come before Common's patterns and map into the frontends", () => {
    const keys: Array<string> = Object.keys(project("ui").moduleNameMapper);
    const mapper: Record<string, string> = project("ui").moduleNameMapper;

    expect(keys.slice(0, 4)).toEqual([
      "^@oneuptime/dashboard/(.*)$",
      "^@oneuptime/admin-dashboard/(.*)$",
      "^@oneuptime/ee-dashboard$",
      "^@oneuptime/ee-admin-dashboard$",
    ]);
    expect(mapper["^@oneuptime/dashboard/(.*)$"]).toBe(
      path.join(APP_DIR, "FeatureSet", "Dashboard", "src", "$1"),
    );
    expect(mapper["^@oneuptime/admin-dashboard/(.*)$"]).toBe(
      path.join(APP_DIR, "FeatureSet", "AdminDashboard", "src", "$1"),
    );
    expect(mapper["^Common/(.*)$"]).toBe(path.join(COMMON_DIR, "$1"));
  });

  test("in ee's own UI tests the plugin specifiers resolve to the real ee plugins, not the Community stubs", () => {
    const mapper: Record<string, string> = project("ui").moduleNameMapper;

    expect(mapper["^@oneuptime/ee-dashboard$"]).toBe(
      path.join(EE_DIR, "Dashboard", "Index.tsx"),
    );
    expect(mapper["^@oneuptime/ee-admin-dashboard$"]).toBe(
      path.join(EE_DIR, "AdminDashboard", "Index.tsx"),
    );
  });
});
