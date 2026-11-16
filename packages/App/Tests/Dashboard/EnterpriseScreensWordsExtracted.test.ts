import {
  ExtractedString,
  scanSourceRoots,
  SKIPPED_SOURCE_FILES,
  SOURCE_ROOTS,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * TEAM COMPLIANCE, THE SCIM PAGES, THE RETENTION OVERRIDES AND THE
 * ENTERPRISE LICENSE NOTICES HOLD THEIR WORDS IN THE DASHBOARD'S LOCALES
 * (#8296, #8461).
 *
 * These Enterprise screens (ee/Dashboard) are drawn by the Dashboard
 * through its plugins, and the string extractor never read them: about 116
 * of their words were in no locale, and every reader got them in English -
 * "Members", "Compliant", "Need attention", "SCIM Base URL:", "Per-severity
 * overrides". Each screen's words go through the reader's Translator now,
 * the extractor reads its directory as the Dashboard's own, and the
 * compliance rule catalog (Common/Types/Team/ComplianceRule.ts) as a file
 * whose marked words are keys - the server evaluates rules with it, and
 * keeps its English.
 *
 * This holds the extractor to those roots, the words they draw to keys of
 * the English locale, and every such key to a wording in every Dashboard
 * language.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const SCREENS: ReadonlyArray<string> = [
  "ee/Dashboard/TeamCompliance",
  "ee/Dashboard/Identity",
  "ee/Dashboard/TelemetryRetention",
  "ee/Dashboard/EnterpriseSettings",
  // Every other screen the Dashboard draws from ee/Dashboard (#8634).
  "ee/Dashboard/CustomRoles",
  "ee/Dashboard/AuditLogExport",
  "ee/Dashboard/IpAllowlists",
  "ee/Dashboard/License",
  "ee/Dashboard/StatusPageAccessControls",
  "ee/Dashboard/StatusPageBranding",
];

/*
 * The screens are the Enterprise Edition's. The App Test job deletes ee/
 * before it runs (core is the Community Edition by construction), and the
 * extractor reads a root that is not there as no words, so the screens are
 * held to their words where ee/ is checked out: the Enterprise Edition Test
 * workflow (test.ee.yaml) runs this with ee/ present. The rule catalog and
 * the findings are Common's, and are read everywhere.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_ROOT, "ee", "Dashboard"),
);

const CATALOG: string = "packages/Common/Types/Team/ComplianceRule.ts";

// What the compliance page says about a rule and a member (#8632).
const FINDINGS: string = "packages/Common/Types/Team/TeamComplianceFindings.ts";

const rootOf: (directory: string) => SourceRoot = (
  directory: string,
): SourceRoot => {
  const root: SourceRoot | undefined = SOURCE_ROOTS.find(
    (candidate: SourceRoot): boolean => {
      return candidate.directory === directory;
    },
  );

  if (!root) {
    throw new Error(`${directory} is not a source root`);
  }

  return root;
};

const extractedFrom: (directory: string) => Array<ExtractedString> = (
  directory: string,
): Array<ExtractedString> => {
  return scanSourceRoots([rootOf(directory)]).strings;
};

// Every key a root's words are, with each count's "one" form.
const keysOf: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const keys: Set<string> = new Set<string>();

  for (const entry of extractedFrom(directory)) {
    keys.add(entry.text);

    if (entry.pluralOne !== undefined) {
      keys.add(`${entry.text}_one`);
    }
  }

  return Array.from(keys);
};

const textsOf: (directory: string) => Set<string> = (
  directory: string,
): Set<string> => {
  return new Set(
    extractedFrom(directory).map((entry: ExtractedString): string => {
      return entry.text;
    }),
  );
};

const english: Record<string, string> = readDashboardLocale("en");

const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

describe("the roots the extractor reads", () => {
  test.each(SCREENS)(
    "%s is read as the Dashboard's own screens",
    (directory: string) => {
      expect(rootOf(directory).kind).toBe("ui");

      if (ENTERPRISE_PRESENT) {
        expect(fs.existsSync(path.join(REPOSITORY_ROOT, directory))).toBe(true);
      }
    },
  );

  test("the compliance rule catalog is read for the words it marks, and only those", () => {
    expect(rootOf(CATALOG).kind).toBe("keys");

    const texts: Set<string> = textsOf(CATALOG);

    // A rule's name, what it checks, a channel's name and the sentences.
    for (const text of [
      "Incident on-call rules",
      "Verified phone for calls",
      "Members have a verified phone number that can be called.",
      "Push notification",
      "Custom channel",
      "{{channels}} for incidents",
      "Every member has an incident on-call rule that notifies them by {{channel}} for {{scope}}.",
      "every incident severity",
      "Every member has a verified phone number for calls.",
      'Unknown compliance rule "{{ruleType}}".',
    ]) {
      expect({ text, found: texts.has(text) }).toEqual({ text, found: true });
    }

    // What the server alone words (a method's noun, a rule's subject) is not.
    for (const text of ["phone number for calls", "incident episode"]) {
      expect({ text, found: texts.has(text) }).toEqual({ text, found: false });
    }
  });

  test("what the compliance page says about a rule and a member is read for the words it marks (#8632)", () => {
    expect(rootOf(FINDINGS).kind).toBe("keys");

    const texts: Set<string> = textsOf(FINDINGS);

    for (const text of [
      "This rule type is not recognised, so it is not checked.",
      "{{channel}} notifications are switched off for this project, so members will not be notified by {{channel}} even when they meet this rule. A Project Owner, a Billing Admin or someone with Manage Billing can turn them on in Project Settings > Notifications > Notification Channels.",
      "No verified phone number configured for call notifications",
      "an unverified phone number for calls",
      "No {{channel}} rule for incident severities: {{severities}}",
      "Opted out of alert episode notifications for: {{severities}}",
    ]) {
      expect({ text, found: texts.has(text) }).toEqual({ text, found: true });
    }
  });

  /*
   * Every Enterprise screen the Dashboard draws is a root, and none of them
   * draws a word no translator sees (#8634): the extractor's hard-coded
   * scan finds nothing in any of them.
   */
  test("every directory of ee/Dashboard the Dashboard draws is read, and none draws a hard-coded word", () => {
    if (!ENTERPRISE_PRESENT) {
      return;
    }

    const drawn: Array<string> = fs
      .readdirSync(path.join(REPOSITORY_ROOT, "ee/Dashboard"), {
        withFileTypes: true,
      })
      .filter((entry: fs.Dirent): boolean => {
        return entry.isDirectory();
      })
      .map((entry: fs.Dirent): string => {
        return `ee/Dashboard/${entry.name}`;
      })
      .sort();

    expect([...SCREENS, "ee/Dashboard/AuditLogs"].sort()).toEqual(drawn);

    for (const directory of SCREENS) {
      const hardcoded: Array<string> = scanSourceRoots([
        rootOf(directory),
      ]).hardcoded.map((entry: { file: string; text: string }): string => {
        return `${entry.file}: ${entry.text}`;
      });

      expect({ directory, hardcoded }).toEqual({ directory, hardcoded: [] });
    }
  });

  test("the license server's own words stay out of every locale", () => {
    expect(
      SKIPPED_SOURCE_FILES.has(
        "packages/Common/Models/DatabaseModels/EnterpriseLicense.ts",
      ),
    ).toBe(true);
  });
});

describe("the words the Enterprise screens draw", () => {
  // The words #8296 and #8461 found in English in every language.
  const DRAWN: Record<string, ReadonlyArray<string>> = {
    "ee/Dashboard/TeamCompliance": [
      "Members",
      "Compliant",
      "Need attention",
      "Active rules",
      "Needs attention",
      "Team compliance at a glance",
      "Members pass this rule when",
      "Recommended rules",
      "No severities left",
      "All incident severities",
      "{{title}} (all incident severities)",
      "Checked against {{count}} active rules",
      "{{compliant}} of {{count}} members meet every rule",
      "{{passing}} of {{count}} members meet it",
      "{{count}} people invited to this team are not checked until they accept their invitation.",
      "{{count}} rules have problems members cannot fix",
      "Open {{name}}'s on-call setup",
      "Open my incident on-call rules",
      "the {{count}} severities you selected",
      "No members match these filters.",
    ],
    "ee/Dashboard/Identity": [
      "SCIM Base URL:",
      "Users Endpoint:",
      "Bearer Token:",
      "Use these URLs to configure SCIM in your identity provider:",
      "OAuth 2.0 Client Credentials:",
      "Set. It works until {{date}}, and is never shown again.",
      "No details available",
      "Status Message: {{message}}",
      // What the reset dialog says when a token cannot be made, or is refused (#8634).
      "This browser cannot generate a secure bearer token. Please use a current browser and try again.",
      "A new bearer token must be at least 32 characters long.",
    ],
    "ee/Dashboard/TelemetryRetention": [
      "Per-severity overrides",
      "Per-status overrides",
      "Specific overrides",
      "No overrides set.",
      "Uses default retention",
      "{{days}} days",
      "Set the default retention for telemetry collected from this {{resource}}.",
      "Retention overrides apply as configured during the {{trialDays}}-day trial of an installation with no license, or the {{graceDays}}-day grace period after a license expires. When it ends, new telemetry is kept for the project's default retention until an Enterprise license is activated in the Admin Dashboard.",
    ],
    "ee/Dashboard/CustomRoles": ["Roles"],
    "ee/Dashboard/EnterpriseSettings": [
      "Enterprise license required: custom roles cannot be created or changed.",
      "Activate or renew the Enterprise license in the Admin Dashboard to change this again.",
      "Everything here can be changed during the {{trialDays}}-day trial of an installation with no license, or the {{graceDays}}-day grace period after a license expires. When it ends: {{afterTheLapse}}",
    ],
  };

  test.each(SCREENS)(
    "are found by the extractor in %s",
    (directory: string) => {
      if (!ENTERPRISE_PRESENT) {
        return;
      }

      const found: Set<string> = textsOf(directory);

      for (const text of DRAWN[directory] || []) {
        expect({ text, isFound: found.has(text) }).toEqual({
          text,
          isFound: true,
        });
      }
    },
  );

  test("a count is found with both its forms", () => {
    if (!ENTERPRISE_PRESENT) {
      return;
    }

    const plurals: Map<string, string | undefined> = new Map(
      extractedFrom("ee/Dashboard/TeamCompliance")
        .filter((entry: ExtractedString): boolean => {
          return entry.kind === "plural";
        })
        .map((entry: ExtractedString): [string, string | undefined] => {
          return [entry.text, entry.pluralOne];
        }),
    );

    expect(plurals.get("{{count}} rules are paused")).toBe(
      "{{count}} rule is paused",
    );
    expect(plurals.get("{{passing}} of {{count}} members meet it")).toBe(
      "{{passing}} of {{count}} member meets it",
    );
  });

  test.each([...SCREENS, CATALOG, FINDINGS])(
    "every word found in %s is a key of the English locale",
    (directory: string) => {
      const missing: Array<string> = [];

      for (const entry of extractedFrom(directory)) {
        if (typeof english[entry.text] !== "string") {
          missing.push(entry.text);
        }

        if (
          entry.pluralOne !== undefined &&
          english[`${entry.text}_one`] !== entry.pluralOne
        ) {
          missing.push(`${entry.text}_one`);
        }
      }

      expect(missing).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every key the Enterprise screens and the rule catalog draw",
    (language: string) => {
      const unworded: Array<string> = [];

      for (const directory of [...SCREENS, CATALOG, FINDINGS]) {
        for (const key of keysOf(directory)) {
          if (
            key.endsWith("_one") &&
            LANGUAGES_WITHOUT_ONE.includes(language)
          ) {
            continue;
          }

          if (!isWordedInDashboardLocale(key, language)) {
            unworded.push(key);
          }
        }
      }

      expect(unworded).toEqual([]);
    },
  );
});
