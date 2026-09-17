import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * Monitoring stopped for a paying customer because "active subscription" was
 * defined in four places that disagreed: SubscriptionStatusUtil counted
 * past_due as active, while ProjectService.getActiveProjectStatusQuery and
 * the raw SQL in MonitorProbeService and NetworkDeviceService each carried
 * their own active / trialing list. There is now one definition,
 * SubscriptionStatusUtil.getActiveSubscriptionStatuses.
 *
 * Unit tests of each consumer prove today's code is right; they cannot stop
 * the NEXT query from pasting in its own list. This scan does: it fails when
 * a server or app source file hardcodes a subscription status list the way
 * the drifted copies did.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const COMMON_ROOT: string = path.join(REPO_ROOT, "Common");

const SCAN_ROOTS: Array<string> = [
  path.join(COMMON_ROOT, "Server"),
  path.join(COMMON_ROOT, "Types"),
  path.join(COMMON_ROOT, "Utils"),
  path.join(COMMON_ROOT, "Models"),
  path.join(REPO_ROOT, "App"),
];

const SKIPPED_DIRECTORY_NAMES: Set<string> = new Set([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  "__mocks__",
  "Locales",
  "public",
  ".git",
]);

// The one file allowed to spell the statuses out.
const DEFINITION_FILE: string = path.join(
  COMMON_ROOT,
  "Types",
  "Billing",
  "SubscriptionStatus.ts",
);

type Rule = {
  description: string;
  pattern: RegExp;
};

/*
 * Single-quoted literals only: prettier writes TypeScript strings with double
 * quotes, so a single-quoted status is (almost always) SQL text - which is
 * where both drifted raw copies lived. Plain TypeScript comparisons such as
 * a billing check on "trialing" are not this file's business.
 */
const RULES: Array<Rule> = [
  {
    description: "a SQL 'trialing' literal (a hand-written active-status list)",
    pattern: /'trialing'/,
  },
  {
    description: "a SQL 'past_due' literal",
    pattern: /'past_due'/,
  },
  {
    description: "a raw SQL IN (...) list on a subscription status column",
    pattern: /SubscriptionStatus"\s+IN\s*\(/i,
  },
  {
    description:
      "an inline SubscriptionStatus array handed to QueryHelper (use getActiveSubscriptionStatuses)",
    pattern:
      /QueryHelper\.(equalToOrNull|any|notEquals)\(\s*\[\s*SubscriptionStatus\./,
  },
];

/*
 * Named rather than inlined at the use sites: an inline literal used as
 * `/\.ts$/.test(x)` trips eslint's wrap-regex, whose fix prettier then undoes
 * (the fight LogErrorPattern documents).
 */
const TYPESCRIPT_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.(ts|tsx)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

function collectSourceFiles(directory: string, into: Array<string>): void {
  let entries: Array<fs.Dirent> = [];

  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        collectSourceFiles(fullPath, into);
      }
      continue;
    }

    if (
      TYPESCRIPT_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name)
    ) {
      into.push(fullPath);
    }
  }
}

describe("the active subscription definition stays single-sourced", () => {
  test("the scan actually finds the files that used to carry copies", () => {
    const files: Array<string> = [];
    collectSourceFiles(path.join(COMMON_ROOT, "Server"), files);

    expect(files).toContain(
      path.join(COMMON_ROOT, "Server", "Services", "MonitorProbeService.ts"),
    );
    expect(files).toContain(
      path.join(COMMON_ROOT, "Server", "Services", "NetworkDeviceService.ts"),
    );
    expect(files).toContain(
      path.join(COMMON_ROOT, "Server", "Services", "ProjectService.ts"),
    );
  });

  test("the patterns catch the exact copies that drifted", () => {
    const driftedCopies: Array<string> = [
      `OR p."paymentProviderSubscriptionStatus" IN ('active', 'trialing'))`,
      `OR p."paymentProviderMeteredSubscriptionStatus" IN ('active', 'trialing'))`,
      `paymentProviderSubscriptionStatus: QueryHelper.equalToOrNull([
        SubscriptionStatus.Active,
        SubscriptionStatus.Trialing,
      ]),`,
    ];

    for (const copy of driftedCopies) {
      expect(
        RULES.some((rule: Rule) => {
          return rule.pattern.test(copy);
        }),
      ).toBe(true);
    }
  });

  test("no server or app source hardcodes its own subscription status list", () => {
    const files: Array<string> = [];

    for (const root of SCAN_ROOTS) {
      collectSourceFiles(root, files);
    }

    // Guard against a scan that silently looks at nothing.
    expect(files.length).toBeGreaterThan(100);

    const violations: Array<string> = [];

    for (const file of files) {
      if (file === DEFINITION_FILE) {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");

      for (const rule of RULES) {
        if (rule.pattern.test(source)) {
          violations.push(
            `${path.relative(REPO_ROOT, file)}: ${rule.description}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
