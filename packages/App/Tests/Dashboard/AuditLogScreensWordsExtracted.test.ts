import {
  ExtractedString,
  scanSourceRoots,
  SOURCE_ROOTS,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS,
  AUDIT_LOG_FAILED_SIGN_IN_FIELD_LABELS,
  AUDIT_LOG_SESSION_FIELD_LABELS,
  AUDIT_LOG_SESSION_FIELDS,
  AUDIT_LOG_SESSION_NOT_USED_FOR,
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
  AUDIT_LOG_SESSION_SIGN_IN_WORDS,
  AUDIT_LOG_SESSION_SIGNED_IN,
  AUDIT_LOG_SIGN_IN_FAILED,
  AuditLogSessionField,
  SESSION_END_CAUSE_DESCRIPTIONS,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE AUDIT LOG'S SCREENS HOLD THEIR WORDS IN THE DASHBOARD'S LOCALES
 * (#8291, #8319).
 *
 * The audit log table, its changes dialog and Settings > Audit Logs are
 * Enterprise code (ee/Dashboard/AuditLogs) that the Dashboard draws through
 * its plugins. The string extractor never read ee/Dashboard, so the words
 * those screens drew - "3 fields changed", "Before", "No audit entries yet",
 * "API request" - could never reach en.json, no language could word them,
 * and every reader got them in English. The extractor reads the audit log's
 * screens now, and the labels the dialog gives a session's fields; this
 * holds it to the words they draw, and to every one of them being a key of
 * the English locale (npm run i18n:extract was run after they changed).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const SCREENS: string = "ee/Dashboard/AuditLogs";

/*
 * The screens are the Enterprise Edition's. The App Test job deletes ee/
 * before it runs (core is the Community Edition by construction), and the
 * extractor reads a root that is not there as no words, so their words are
 * held to it where ee/ is checked out: the Enterprise Edition Test workflow
 * (test.ee.yaml) runs this with ee/ present.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_ROOT, SCREENS),
);

const SESSION_LABELS: string =
  "packages/Common/Types/AuditLog/AuditLogSessionEvent.ts";

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

const textsOf: (entries: Array<ExtractedString>) => Set<string> = (
  entries: Array<ExtractedString>,
): Set<string> => {
  return new Set(
    entries.map((entry: ExtractedString): string => {
      return entry.text;
    }),
  );
};

const english: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      "packages/App/FeatureSet/Dashboard/src/Locales/en.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

describe("the roots the extractor reads", () => {
  test("the audit log's screens are read as the Dashboard's own, and a session's field labels as marked keys", () => {
    expect(rootOf(SCREENS).kind).toBe("ui");
    expect(rootOf(SESSION_LABELS).kind).toBe("keys");
  });

  /*
   * Each Enterprise screen comes in as its words are routed through the
   * translator: Team Compliance, the SCIM pages, the retention overrides and
   * the Enterprise settings' license notice joined the audit log in #8296 and
   * #8461, and every other screen the Dashboard draws from ee/Dashboard in
   * #8634 (EnterpriseScreensWordsExtracted holds them to their words).
   */
  test("the rest of ee/Dashboard comes in as each screen's words are routed", () => {
    const enterpriseRoots: Array<string> = SOURCE_ROOTS.filter(
      (root: SourceRoot): boolean => {
        return root.directory.startsWith("ee/");
      },
    ).map((root: SourceRoot): string => {
      return root.directory;
    });

    expect(enterpriseRoots).toEqual([
      SCREENS,
      "ee/Dashboard/TeamCompliance",
      "ee/Dashboard/Identity",
      "ee/Dashboard/TelemetryRetention",
      "ee/Dashboard/EnterpriseSettings",
      "ee/Dashboard/CustomRoles",
      "ee/Dashboard/AuditLogExport",
      "ee/Dashboard/IpAllowlists",
      "ee/Dashboard/License",
      "ee/Dashboard/StatusPageAccessControls",
      "ee/Dashboard/StatusPageBranding",
    ]);
  });
});

describe("the words the audit log's screens draw", () => {
  // The words #8291 and #8319 found English in every language.
  const DRAWN: ReadonlyArray<string> = [
    // The changes dialog (#8291).
    "Change details",
    "Created snapshot",
    "Deleted snapshot",
    "What was downloaded",
    "How and where they signed in",
    "How the session ended",
    "No details were recorded for this session.",
    "No field-level changes were recorded for this event.",
    "{{count}} fields changed",
    // The table (#8319).
    "Audit logging is not recording: not included in your Enterprise license",
    "Audit logging is not recording: Enterprise license required",
    "Audit logging is off",
    "New changes to this project are not being recorded until audit logging is turned on in Settings.",
    "Audit logging is turned off",
    "Open Audit Logs settings",
    "No audit entries yet",
    "Unnamed",
    "API Key",
    "API request",
    "Workflow",
    "System",
    "Automated change",
    "Unknown user",
    "No fields recorded",
    "{{count}} fields captured",
    "{{summary}} - view session details",
    // The license's words, which the table's empty state draws too.
    "Enterprise license required: audit logging is not recording.",
    "Your Enterprise license does not include audit logs: audit logging is not recording.",
  ];

  test("are found by the extractor", () => {
    if (!ENTERPRISE_PRESENT) {
      return;
    }

    const found: Set<string> = textsOf(extractedFrom(SCREENS));

    for (const text of DRAWN) {
      expect({ text, isFound: found.has(text) }).toEqual({
        text,
        isFound: true,
      });
    }
  });

  test("a count is found with both its forms", () => {
    if (!ENTERPRISE_PRESENT) {
      return;
    }

    const plurals: Map<string, string | undefined> = new Map(
      extractedFrom(SCREENS)
        .filter((entry: ExtractedString): boolean => {
          return entry.kind === "plural";
        })
        .map((entry: ExtractedString): [string, string | undefined] => {
          return [entry.text, entry.pluralOne];
        }),
    );

    expect(plurals.get("{{count}} fields changed")).toBe(
      "{{count}} field changed",
    );
    expect(plurals.get("{{count}} fields captured")).toBe(
      "{{count}} field captured",
    );
  });

  test("every word found there is a key of the English locale", () => {
    const missing: Array<string> = [];

    for (const entry of [
      ...extractedFrom(SCREENS),
      ...extractedFrom(SESSION_LABELS),
    ]) {
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
  });
});

describe("a session entry's words", () => {
  /*
   * The labels the dialog gives each field (#8291), and the values that are
   * OneUptime's own words (#8459): why a session ended, how its person
   * signed in, the second factor, thirty days without use as a count. The
   * server still stores them in English; the screens draw them in the
   * reader's words.
   */
  test("are every label the dialog draws, and every word of OneUptime's an entry stores, and nothing else in the file", () => {
    const expected: Set<string> = new Set<string>([
      ...AUDIT_LOG_SESSION_FIELDS.map((field: AuditLogSessionField): string => {
        return AUDIT_LOG_SESSION_FIELD_LABELS[field];
      }),
      ...Object.values(SessionEndCause)
        .filter((cause: SessionEndCause): boolean => {
          return cause !== SessionEndCause.Expired;
        })
        .map((cause: SessionEndCause): string => {
          return SESSION_END_CAUSE_DESCRIPTIONS[cause];
        }),
      ...AUDIT_LOG_SESSION_SIGN_IN_WORDS,
      AUDIT_LOG_SESSION_SIGNED_IN,
      AUDIT_LOG_SESSION_NOT_USED_FOR.one,
      AUDIT_LOG_SESSION_NOT_USED_FOR.other,
      // A private status page reader's sign-in the page no longer accepts (#6790).
      AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
      // A failed sign-in (#6788): its summary, its own label and its count.
      AUDIT_LOG_SIGN_IN_FAILED,
      ...(Object.values(
        AUDIT_LOG_FAILED_SIGN_IN_FIELD_LABELS,
      ) as Array<string>),
      AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS.one,
      AUDIT_LOG_FAILED_SIGN_IN_ATTEMPTS.other,
    ]);

    expect(textsOf(extractedFrom(SESSION_LABELS))).toEqual(expected);
  });

  test("thirty days without use is a count, never the stored sentence with its number", () => {
    const entries: Array<ExtractedString> = extractedFrom(SESSION_LABELS);

    expect(
      entries.find((entry: ExtractedString): boolean => {
        return entry.kind === "plural";
      })?.pluralOne,
    ).toBe("Not used for {{count}} day");
    expect(textsOf(entries).has("Not used for 30 days")).toBe(false);
  });
});
