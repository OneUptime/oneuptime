// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import DatabaseMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DatabaseMonitorView";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  DatabaseMetricGroup,
  getDatabaseMetricGroupLabel,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
} from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import {
  DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES,
  DATABASE_OWN_GROUP_MESSAGES,
  DATABASE_STATS_ACCESS_MESSAGE,
  DatabaseCollectionIssueText,
  getDatabaseCollectionIssueText,
} from "../../../Utils/Monitor/DatabaseCollectionIssueReading";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A DATABASE HEALTH CHECK'S COLLECTION ISSUES, IN THE READER'S LANGUAGE
 * (#8609).
 *
 * The summary's "Some metrics were not collected" box drew each group by
 * its value (Locks) and the probe's message as stored, in English in every
 * language. It names a group as the form's Metric Groups switch does
 * (Locks and Blocking), in the reader's words, says OneUptime's own
 * sentence in the reader's words, and keeps a database's own error as the
 * database wrote it, after a sentence in the reader's words that says
 * what kind of failure it is.
 *
 * Drawn in English, German, Arabic and Persian from the Dashboard's own
 * locale files, and again with every group name and sentence worded as a
 * probe that is itself a key reading TWICE: a word looked up twice would
 * say it.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const TWICE: string = "TWICE";

const PROBE_MARKS: Readonly<Record<string, string>> = {
  en: "EN› ",
  de: "DE› ",
  ar: "ع› ",
  fa: "ف› ",
};

// A database's own errors, as SQL Server and PostgreSQL write them.
const SERVER_STATE_ERROR: string =
  "VIEW SERVER STATE permission was denied on object 'server', database 'master'.";
const STATEMENT_TIMEOUT_ERROR: string =
  "canceling statement due to statement timeout";
const OTHER_ERROR: string = 'relation "pg_stat_database" does not exist';

const STATUSES: Array<DatabaseMetricGroupStatus> = [
  {
    group: DatabaseMetricGroup.Locks,
    reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
    message: SERVER_STATE_ERROR,
  },
  {
    group: DatabaseMetricGroup.Activity,
    reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
    message: DATABASE_STATS_ACCESS_MESSAGE,
  },
  {
    group: DatabaseMetricGroup.Replication,
    reason: DatabaseMetricGroupUnavailableReason.Timeout,
    message: STATEMENT_TIMEOUT_ERROR,
  },
  {
    group: DatabaseMetricGroup.Storage,
    reason: DatabaseMetricGroupUnavailableReason.Error,
    message: OTHER_ERROR,
  },
  {
    group: DatabaseMetricGroup.Maintenance,
    reason: DatabaseMetricGroupUnavailableReason.NotSupportedByEngine,
    message: 'function "pg_stat_statements" does not exist',
  },
];

const GROUP_NAMES: Array<string> = Object.values(DatabaseMetricGroup).map(
  (group: DatabaseMetricGroup): string => {
    return getDatabaseMetricGroupLabel(group);
  },
);

const OWN_WORDS: Array<string> = [
  ...DATABASE_OWN_GROUP_MESSAGES,
  ...Object.values(DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES),
];

const probeOf: (language: string, text: string) => string = (
  language: string,
  text: string,
): string => {
  return `${PROBE_MARKS[language]}${text}`;
};

const probedWords: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  const words: Record<string, string> = { ...readDashboardLocale(language) };

  for (const text of [...GROUP_NAMES, ...OWN_WORDS]) {
    words[text] = probeOf(language, text);
    words[probeOf(language, text)] = TWICE;
  }

  return words;
};

const dashboardI18n: i18n = createInstance();
const probedI18n: i18n = createInstance();

beforeAll(async () => {
  await whenCodeCanBeSetApart("ar");

  for (const [instance, wordsOf] of [
    [dashboardI18n, readDashboardLocale],
    [probedI18n, probedWords],
  ] as Array<[i18n, (language: string) => Record<string, string>]>) {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of LANGUAGES) {
      resources[language] = { translation: wordsOf(language) };
    }

    await instance
      .use(productNamePostProcessor)
      .use(codeReadsAsWrittenPostProcessor)
      .init({
        lng: "en",
        fallbackLng: "en",
        postProcess: getTranslationPostProcess(),
        resources: resources,
        interpolation: { escapeValue: false },
      });
  }
});

afterEach(() => {
  cleanup();
});

const RESPONSE: ProbeMonitorResponse = {
  isOnline: true,
  probeId: ObjectID.generate(),
  monitorId: ObjectID.generate(),
  monitorStepId: ObjectID.generate(),
  failureCause: "",
  monitoredAt: new Date(),
  databaseMonitorResponse: {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    metrics: {},
    collectedGroups: [DatabaseMetricGroup.Connections],
    unavailableGroups: STATUSES,
    connectionError: null,
  } as DatabaseMonitorResponse,
} as unknown as ProbeMonitorResponse;

// What an element shows, without the isolates' marks, with plain spaces.
const shownIn: (element: Element) => string = (element: Element): string => {
  return withoutIsolates(element.textContent || "")
    .split(NO_BREAK_SPACE)
    .join(" ")
    .split(NARROW_NO_BREAK_SPACE)
    .join(" ")
    .trim();
};

interface DrawnIssue {
  group: string;
  words: string;
  asWritten: string;
}

// Each collection issue line of the summary: its group, OneUptime's words, the database's own.
const issuesIn: (instance: i18n, language: string) => Array<DrawnIssue> = (
  instance: i18n,
  language: string,
): Array<DrawnIssue> => {
  void instance.changeLanguage(language);

  const container: HTMLElement = render(
    <I18nextProvider i18n={instance}>
      <DatabaseMonitorView probeMonitorResponse={RESPONSE} />
    </I18nextProvider>,
  ).container;

  return Array.from(
    container.querySelectorAll('[data-testid="database-collection-issue"]'),
  ).map((line: Element): DrawnIssue => {
    const spans: Array<Element> = Array.from(line.children);
    const asWritten: Element | null = line.querySelector(
      '[data-testid="database-collection-issue-message"]',
    );

    return {
      group: shownIn(spans[0] as Element),
      words: shownIn(spans[2] as Element),
      asWritten: asWritten ? shownIn(asWritten) : "",
    };
  });
};

const wordOf: (words: Record<string, string>, text: string) => string = (
  words: Record<string, string>,
  text: string,
): string => {
  return words[text] || text;
};

// What the summary says of a status, in a language's words.
const expectedIssue: (
  words: Record<string, string>,
  status: DatabaseMetricGroupStatus,
) => DrawnIssue = (
  words: Record<string, string>,
  status: DatabaseMetricGroupStatus,
): DrawnIssue => {
  const isOwn: boolean = DATABASE_OWN_GROUP_MESSAGES.includes(status.message);

  return {
    group: wordOf(words, getDatabaseMetricGroupLabel(status.group)),
    words: isOwn
      ? wordOf(words, status.message)
      : wordOf(
          words,
          DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES[status.reason],
        ),
    asWritten: isOwn ? "" : status.message,
  };
};

describe("a Database monitor's summary, for the groups it could not collect", () => {
  test.each(LANGUAGES)(
    "%s names each group as its Metric Groups switch does, says why in the reader's words, and keeps the database's own error",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const drawn: Array<DrawnIssue> = issuesIn(dashboardI18n, language);

      // The degraded groups, then the one the engine does not report.
      expect([...drawn].sort(byGroup)).toEqual(
        STATUSES.map((status: DatabaseMetricGroupStatus): DrawnIssue => {
          return expectedIssue(words, status);
        }).sort(byGroup),
      );
    },
  );

  test("English names Locks as its switch does, Locks and Blocking", () => {
    const drawn: Array<DrawnIssue> = issuesIn(dashboardI18n, "en");

    expect(
      drawn.map((issue: DrawnIssue): string => {
        return issue.group;
      }),
    ).toContain("Locks and Blocking");
    expect(
      drawn.map((issue: DrawnIssue): string => {
        return issue.group;
      }),
    ).not.toContain(DatabaseMetricGroup.Locks);
  });

  test.each(["de", "ar", "fa"])(
    "%s says no group and no sentence of OneUptime's in English",
    (language: string) => {
      for (const issue of issuesIn(dashboardI18n, language)) {
        expect(GROUP_NAMES).not.toContain(issue.group);
        expect(Object.values(DatabaseMetricGroup)).not.toContain(issue.group);
        expect(OWN_WORDS).not.toContain(issue.words);
      }
    },
  );

  test.each(LANGUAGES)(
    "%s looks each group name and sentence up once, and never the database's own error",
    (language: string) => {
      const drawn: Array<DrawnIssue> = issuesIn(probedI18n, language);

      expect(drawn.length).toBe(STATUSES.length);

      for (const issue of drawn) {
        expect(issue.group.startsWith(PROBE_MARKS[language] as string)).toBe(
          true,
        );
        expect(issue.words.startsWith(PROBE_MARKS[language] as string)).toBe(
          true,
        );
        expect(
          `${issue.group} ${issue.words} ${issue.asWritten}`,
        ).not.toContain(TWICE);
        expect(
          issue.asWritten.startsWith(PROBE_MARKS[language] as string),
        ).toBe(false);
      }
    },
  );
});

function byGroup(a: DrawnIssue, b: DrawnIssue): number {
  return a.group.localeCompare(b.group);
}

const translatorOf: (words: Record<string, string>) => Translator = (
  words: Record<string, string>,
): Translator => {
  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, "de");
};

describe("reading a collection issue", () => {
  const german: Translator = translatorOf(readDashboardLocale("de"));

  test("a sentence of OneUptime's own is the words, with nothing as written", () => {
    const issue: DatabaseCollectionIssueText = getDatabaseCollectionIssueText({
      translator: german,
      status: STATUSES[1] as DatabaseMetricGroupStatus,
    });

    expect(issue.words).toBe(
      readDashboardLocale("de")[DATABASE_STATS_ACCESS_MESSAGE],
    );
    expect(issue.asWritten).toBe("");
  });

  test("a database's own error is kept, trimmed, after why in the reader's words", () => {
    const issue: DatabaseCollectionIssueText = getDatabaseCollectionIssueText({
      translator: german,
      status: {
        group: DatabaseMetricGroup.Locks,
        reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
        message: `  ${SERVER_STATE_ERROR}\n`,
      },
    });

    expect(issue).toEqual({
      group: readDashboardLocale("de")["Locks and Blocking"],
      words:
        readDashboardLocale("de")[
          DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES[
            DatabaseMetricGroupUnavailableReason.MissingPermission
          ]
        ],
      asWritten: SERVER_STATE_ERROR,
    });
  });

  test("a reason a newer probe writes reads as a group that could not be collected", () => {
    const issue: DatabaseCollectionIssueText = getDatabaseCollectionIssueText({
      translator: translatorOf({}),
      status: {
        group: DatabaseMetricGroup.Storage,
        reason: "SomethingNew" as DatabaseMetricGroupUnavailableReason,
        message: OTHER_ERROR,
      },
    });

    expect(issue.words).toBe(
      DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES[
        DatabaseMetricGroupUnavailableReason.Error
      ],
    );
  });

  test("every reason has a sentence, and every sentence is a key the English locale holds", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const reason of Object.values(DatabaseMetricGroupUnavailableReason)) {
      const sentence: string =
        DATABASE_GROUP_UNAVAILABLE_REASON_SENTENCES[reason];

      expect({ reason, key: english[sentence] }).toEqual({
        reason,
        key: sentence,
      });
    }

    for (const message of DATABASE_OWN_GROUP_MESSAGES) {
      expect(english[message]).toBe(message);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every group name and every sentence, or keeps one as written on purpose",
    (language: string) => {
      const english: Array<string> = [...GROUP_NAMES, ...OWN_WORDS].filter(
        (text: string): boolean => {
          return !isWordedInDashboardLocale(text, language);
        },
      );

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test("the probe writes OneUptime's own sentence word for word, so the summary finds it", () => {
    const probe: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../Probe/Utils/Monitors/MonitorTypes/DatabaseMonitor.ts",
      ),
      "utf8",
    );
    // The probe's own messages: the string literals it hands as a message.
    const written: Array<string> = Array.from(
      probe.matchAll(/message:\s*\n?\s*"((?:[^"\\]|\\.)+)"/g),
      (match: RegExpMatchArray): string => {
        return JSON.parse(`"${match[1] as string}"`) as string;
      },
    );

    expect(written).toContain(DATABASE_STATS_ACCESS_MESSAGE);

    for (const message of DATABASE_OWN_GROUP_MESSAGES) {
      expect(written).toContain(message);
    }
  });
});
