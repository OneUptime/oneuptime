"use strict";

/**
 * Every Playwright config in packages/E2E runs its browser in a zone it
 * names, never the machine's.
 *
 * A browser left to the machine reads its dates in the zone of whatever
 * runs it: a spec that pins "09:30 AM UTC" passes on a runner and fails on
 * a laptop in Berlin, and a change to how a zone is named (a browser on UTC
 * read "GMT" until #8475) cannot be checked against a known zone. Sixteen
 * configs named none until #8724.
 *
 * So each config's top-level `use` sets `timezoneId` to a zone that exists
 * (Europe/London where a suite reads GMT, UTC elsewhere), as a string a
 * reader of the config can see, and no project sets one that does not
 * exist. A config whose suite opens no browser through Playwright's `use` -
 * none at all, or one Lighthouse launches itself - is listed below with why;
 * the list only holds configs that still exist and still name no zone.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "packages", "E2E");

const NO_BROWSER_OF_PLAYWRIGHT = {
  "playwright.sharding.config.ts":
    "Sharding.spec.ts runs Node checks and Playwright's --list: no browser",
  "playwright.lighthouse.config.ts":
    "Lighthouse/Scan.ts launches the Chromium Lighthouse drives, outside `use`, and a scan reads no date",
  "playwright.lighthouse-production.config.ts":
    "Lighthouse/Scan.ts launches the Chromium Lighthouse drives, outside `use`, and a scan reads no date",
};

// The value of `name` in an object literal, or undefined.
function propertyOf(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name
    ) {
      return property.initializer;
    }
  }

  return undefined;
}

// The object literal handed to defineConfig(...), or null.
function configObjectOf(sourceFile) {
  let found = null;

  function visit(node) {
    if (
      !found &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineConfig" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      found = node.arguments[0];
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return found;
}

function isZone(name) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/*
 * What is wrong with a config's zone, as sentences: none when its top-level
 * `use` names a zone that exists, and every project that names one names
 * one that exists.
 */
function zoneProblemsOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const config = configObjectOf(sourceFile);

  if (!config) {
    return ["no defineConfig({ ... }) to read"];
  }

  const problems = [];
  const zoneProblemOf = (where, value) => {
    if (!value) {
      return `${where} sets no timezoneId`;
    }

    if (
      !ts.isStringLiteral(value) &&
      !ts.isNoSubstitutionTemplateLiteral(value)
    ) {
      return `${where}'s timezoneId is not a string the config names (${value.getText(sourceFile)})`;
    }

    return isZone(value.text)
      ? null
      : `${where}'s timezoneId "${value.text}" is no time zone`;
  };

  const use = propertyOf(config, "use");
  const topLevel =
    use && ts.isObjectLiteralExpression(use)
      ? zoneProblemOf("its use", propertyOf(use, "timezoneId"))
      : "it has no use block that sets timezoneId";

  if (topLevel) {
    problems.push(topLevel);
  }

  const projects = propertyOf(config, "projects");

  if (projects && ts.isArrayLiteralExpression(projects)) {
    for (const project of projects.elements) {
      if (!ts.isObjectLiteralExpression(project)) {
        continue;
      }

      const projectUse = propertyOf(project, "use");
      const zone =
        projectUse && ts.isObjectLiteralExpression(projectUse)
          ? propertyOf(projectUse, "timezoneId")
          : undefined;

      if (zone) {
        const name = propertyOf(project, "name");
        const problem = zoneProblemOf(
          `project ${name ? name.getText(sourceFile) : "(unnamed)"}`,
          zone,
        );

        if (problem) {
          problems.push(problem);
        }
      }
    }
  }

  return problems;
}

const configs = fs
  .readdirSync(E2E_DIR)
  .filter((name) => {
    return /^playwright\..*config\.ts$/.test(name);
  })
  .sort();

describe("the reader of a config's zone", () => {
  const configOf = (use, extra = "") => {
    return `import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./Suite",
  ${use}
  ${extra}
});`;
  };

  test("passes a use block that names a zone that exists, beside a device and a locale", () => {
    expect(
      zoneProblemsOf(
        "a.ts",
        configOf(
          'use: { ...devices["Desktop Chrome"], locale: "en-GB", timezoneId: "Europe/London" },',
        ),
      ),
    ).toEqual([]);
    expect(
      zoneProblemsOf("b.ts", configOf('use: { timezoneId: "UTC" },')),
    ).toEqual([]);
  });

  test("fails a config with no use, or a use that names no zone", () => {
    expect(zoneProblemsOf("a.ts", configOf(""))).toEqual([
      "it has no use block that sets timezoneId",
    ]);
    expect(
      zoneProblemsOf("b.ts", configOf('use: { locale: "en-US" },')),
    ).toEqual(["its use sets no timezoneId"]);
    // A zone on one project only leaves the others to the machine.
    expect(
      zoneProblemsOf(
        "c.ts",
        configOf(
          "use: {},",
          'projects: [{ name: "chromium", use: { timezoneId: "UTC" } }],',
        ),
      ),
    ).toEqual(["its use sets no timezoneId"]);
  });

  test("fails a zone that does not exist, or one the config does not write out", () => {
    expect(
      zoneProblemsOf("a.ts", configOf('use: { timezoneId: "Mars/Olympus" },')),
    ).toEqual(['its use\'s timezoneId "Mars/Olympus" is no time zone']);
    expect(
      zoneProblemsOf("b.ts", configOf("use: { timezoneId: process.env.TZ },")),
    ).toEqual([
      "its use's timezoneId is not a string the config names (process.env.TZ)",
    ]);
    expect(
      zoneProblemsOf(
        "c.ts",
        configOf(
          'use: { timezoneId: "UTC" },',
          'projects: [{ name: "phone", use: { timezoneId: "Europe/Nowhere" } }],',
        ),
      ),
    ).toEqual([
      'project "phone"\'s timezoneId "Europe/Nowhere" is no time zone',
    ]);
  });

  test("reads a config that is not one as such", () => {
    expect(zoneProblemsOf("a.ts", "export default {};")).toEqual([
      "no defineConfig({ ... }) to read",
    ]);
  });
});

describe("every Playwright config in packages/E2E names its browser's zone", () => {
  test("the configs are found where they are kept (the check below is not vacuous)", () => {
    expect(configs.length).toBeGreaterThan(100);
    expect(configs).toContain("playwright.monitor-overview-ui.config.ts");
  });

  test("each config's use names a zone that exists, unless its suite opens no browser through use", () => {
    const found = [];

    for (const name of configs) {
      if (NO_BROWSER_OF_PLAYWRIGHT[name]) {
        continue;
      }

      for (const problem of zoneProblemsOf(
        name,
        fs.readFileSync(path.join(E2E_DIR, name), "utf8"),
      )) {
        found.push(
          `packages/E2E/${name}: ${problem}. Set timezoneId in its top-level use: Europe/London where the suite reads GMT, UTC elsewhere.`,
        );
      }
    }

    expect(found).toEqual([]);
  });

  test("the configs left to the machine still exist, still name no zone, and say why", () => {
    const namingAZone = [];

    for (const [name, why] of Object.entries(NO_BROWSER_OF_PLAYWRIGHT)) {
      expect(configs).toContain(name);
      expect(why.length).toBeGreaterThan(20);

      if (
        /timezoneId/.test(fs.readFileSync(path.join(E2E_DIR, name), "utf8"))
      ) {
        namingAZone.push(`${name} names a zone now: take it off the list`);
      }
    }

    expect(namingAZone).toEqual([]);
  });
});
