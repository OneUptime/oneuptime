import PostgresCluster from "../../../AdminDashboard/Health/PostgresCluster";
import {
  EnterpriseLicenseInstanceStatusPill,
  getLicenseLifecycle,
  LicenseLifecycle,
  LicenseStatusPill,
  SeatUsageMeter,
} from "../../../AdminDashboard/EnterpriseLicenses/Components/LicenseUtil";
import { withoutIsolateMarks } from "Common/Tests/Helpers/IsolateMarks";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THE ENTERPRISE ADMIN PAGES DREW AS WRITTEN, IN THE READER'S LANGUAGE (#8599).
 *
 * The Enterprise Edition's admin pages (ee/AdminDashboard) drew 204 texts
 * without a lookup: the PostgreSQL cluster page's column heads and empty
 * states, sentences glued from pieces ("· replay lag " + lag, "1 primary + "
 * + n + " standbys", "The " + extension + " extension is not available…"),
 * and a license's status, seats and instances' tooltips. Each read English
 * in every language, and a count in Latin digits on a Persian page.
 *
 * This draws the real PostgreSQL cluster page, with the server's answers
 * stood in, and the license pills and seat meter the license pages draw, in
 * English, German, Arabic and Persian, from the Admin Dashboard's own
 * locale files: each sentence reads whole in the language's words, its
 * counts in the language's forms and digits, and none of the English is
 * left. App/Tests/AdminDashboard/AdminOwnPagesDrawnAsWrittenGuard holds the
 * pages to drawing nothing as written.
 */

const mockApiGet: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return mockApiGet(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

type Locale = Record<string, unknown>;

const LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages/App/FeatureSet/AdminDashboard/src/Locales",
);

const readLocale: (language: string) => Locale = (language: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Locale;
};

const ENGLISH: Locale = readLocale("en");

// A long language, and both read from the right.
const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];

const wordIn: (language: string, key: string) => string = (
  language: string,
  key: string,
): string => {
  const word: unknown = readLocale(language)[key];

  if (typeof word !== "string") {
    throw new Error(`${language} has no entry for ${key}`);
  }

  return word;
};

// A number in the reader's digits: Latin in Arabic, as OneUptime writes it.
const digits: (language: string, value: number) => string = (
  language: string,
  value: number,
): string => {
  return new Intl.NumberFormat(
    language === "ar" ? "ar-u-nu-latn" : language,
  ).format(value);
};

// Facts on one line: " · ", or " • " beside Persian's dot of a zero.
const separatorIn: (language: string) => string = (
  language: string,
): string => {
  return language === "fa" ? " • " : " · ";
};

const sentenceIn: (
  language: string,
  key: string,
  values: Record<string, string>,
) => string = (
  language: string,
  key: string,
  values: Record<string, string>,
): string => {
  let sentence: string = wordIn(language, key);

  for (const [name, value] of Object.entries(values)) {
    sentence = sentence.split(`{{${name}}}`).join(value);
  }

  return sentence.split(" · ").join(separatorIn(language));
};

const pageText: () => string = (): string => {
  return withoutIsolateMarks(document.body.textContent || "");
};

// The words around each {{placeholder}} of `key`, each on the page.
const expectSentenceAround: (language: string, key: string) => void = (
  language: string,
  key: string,
): void => {
  const pieces: Array<string> = wordIn(language, key)
    .split(/\{\{[^{}]+\}\}/)
    .map((piece: string): string => {
      return piece.trim();
    })
    .filter((piece: string): boolean => {
      return piece.length > 0;
    });

  for (const piece of pieces) {
    expect({ key, piece, drawn: pageText().includes(piece) }).toEqual({
      key,
      piece,
      drawn: true,
    });
  }
};

const expectNoEnglishOf: (language: string, keys: Array<string>) => void = (
  language: string,
  keys: Array<string>,
): void => {
  if (language === "en") {
    return;
  }

  const text: string = pageText();

  for (const key of keys) {
    const english: string = String(ENGLISH[key]);

    if (wordIn(language, key) === english) {
      continue;
    }

    expect({ key, english: text.includes(english) }).toEqual({
      key,
      english: false,
    });
  }
};

const instanceFor: (language: string) => Promise<i18n> = async (
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [language]: { translation: readLocale(language) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
};

const drawIn: (
  language: string,
  element: ReactElement,
) => Promise<void> = async (
  language: string,
  element: ReactElement,
): Promise<void> => {
  render(
    <I18nextProvider i18n={await instanceFor(language)}>
      {element}
    </I18nextProvider>,
  );
};

// A primary with one streaming standby and a slot; two sessions blocked.
const CLUSTER: JSONObject = {
  connected: true,
  clusterName: "pg-main",
  role: "primary",
  isInRecovery: false,
  serverVersion: "16.2",
  uptimeSeconds: 3 * 86400,
  databaseSizeInBytes: 1073741824,
  replication: [
    {
      applicationName: "standby-1",
      clientAddr: "10.0.0.2",
      state: "streaming",
      syncState: "async",
      replayLagSeconds: 2,
      bytesBehind: 2048,
    },
  ],
  replicationSlots: [
    {
      slotName: "slot_a",
      slotType: "physical",
      active: true,
      walStatus: "reserved",
      retainedBytes: 4096,
    },
  ],
  connections: {
    maxConnections: 100,
    total: 20,
    active: 5,
    idle: 10,
    idleInTransaction: 1,
    waitingOnLock: 2,
    blocked: 2,
    longestTransactionSeconds: 30,
  },
  database: {
    cacheHitRatio: 99.5,
    xactCommit: 1000,
    xactRollback: 3,
    tempFiles: 2,
    tempBytes: 1024,
    deadlocks: 0,
  },
  wraparound: { maxXidAge: 1000000 },
  topTablesByDeadTuples: [
    { name: "public.Log", deadTuples: 500, lastAutovacuum: null },
  ],
  topTablesBySize: [],
};

const ACTIVITY: JSONObject = {
  connected: true,
  blockedSessions: [
    {
      blockedPid: 4242,
      blockedUser: "app",
      blockedForSeconds: 12,
      blockedQuery: "UPDATE monitor SET name = $1",
      blockingPid: 4141,
      blockingUser: "migrate",
      blockingState: "idle in transaction",
      blockingQuery: "ALTER TABLE monitor ADD COLUMN x int",
    },
  ],
  activeQueries: [],
  vacuumProgress: [],
  statementsAvailable: false,
  topStatements: [],
};

afterEach(() => {
  cleanup();
  mockApiGet.mockReset();
});

const serve: () => void = (): void => {
  mockApiGet.mockImplementation(async (...args: Array<unknown>) => {
    const url: string = String((args[0] as { url: unknown }).url);

    if (url.includes("/admin/health/postgres-activity")) {
      return { data: ACTIVITY };
    }

    return { data: CLUSTER };
  });
};

describe.each(LANGUAGES)(
  "Health > PostgreSQL cluster, in %s",
  (language: string) => {
    test("the cluster line, the standby and the slot read as the language's sentences", async () => {
      serve();
      await drawIn(language, <PostgresCluster />);

      await waitFor(() => {
        expect(pageText()).toContain("pg-main");
      });

      // "Cluster pg-main · 1 primary + 1 standby · pg 16.2 · up 3d".
      expectSentenceAround(language, "Cluster {{cluster}}");
      expect(pageText()).toContain(
        sentenceIn(language, "1 primary + {{count}} standbys_one", {
          count: digits(language, 1),
        }),
      );
      expect(pageText()).toContain(
        sentenceIn(language, "replay lag {{lag}}", { lag: "2.0s" }),
      );
      expect(pageText()).toContain(
        sentenceIn(language, "{{size}} behind", { size: "2.0 KB" }),
      );
      expect(pageText()).toContain(
        sentenceIn(language, "retains {{size}}", { size: "4.0 KB" }),
      );

      // Two sessions blocked: one sentence, its count in the language's digits.
      expect(pageText()).toContain(
        sentenceIn(language, "{{count}} sessions blocked waiting on a lock.", {
          count: digits(language, 2),
        }),
      );

      expectNoEnglishOf(language, [
        "replay lag {{lag}}",
        "retains {{size}}",
        "{{count}} sessions blocked waiting on a lock.",
      ]);

      if (language !== "en") {
        expect(pageText()).not.toContain("1 primary +");
        expect(pageText()).not.toContain("blocked waiting on a lock");
      }
    });

    test("live activity's blocked session and the statements notice read in the language", async () => {
      serve();
      await drawIn(language, <PostgresCluster />);

      await waitFor(() => {
        expect(pageText()).toContain("(migrate)");
      });

      expect(
        screen.getAllByText(wordIn(language, "Blocked sessions")).length,
      ).toBeGreaterThan(0);
      expectSentenceAround(language, "blocked by PID {{pid}}");
      expect(pageText()).toContain("(migrate)");

      // pg_stat_statements' names and command stay as PostgreSQL spells them.
      expectSentenceAround(
        language,
        "The {{extension}} extension is not available on this instance. Add it to {{setting}}, restart PostgreSQL, then run {{command}} to unlock cumulative query statistics.",
      );
      expect(pageText()).toContain("CREATE EXTENSION pg_stat_statements;");
      expect(pageText()).toContain("shared_preload_libraries");

      expectNoEnglishOf(language, ["Blocked sessions", "Running queries"]);

      if (language !== "en") {
        expect(pageText()).not.toContain("extension is not available");
      }
    });
  },
);

describe.each(LANGUAGES)("Enterprise licenses, in %s", (language: string) => {
  test("a license's status reads in the language, its days in the language's forms", async () => {
    // Five days and an hour away: five whole days, however long the render takes.
    const expiresAt: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 5),
      1,
    );
    const lifecycle: LicenseLifecycle | null = getLicenseLifecycle(
      expiresAt,
      30,
    );

    await drawIn(
      language,
      <div>
        <LicenseStatusPill expiresAt={expiresAt} reminderDays={30} />
      </div>,
    );

    expect(lifecycle?.state).toBe("expiring-soon");
    expect(pageText()).toContain(
      sentenceIn(language, "Expires in {{count}} days", {
        count: digits(language, lifecycle?.daysUntilExpiry || 0),
      }),
    );

    if (language !== "en") {
      expect(pageText()).not.toContain("Expires in");
    }
  });

  test("the seat meter's count and the over-limit note read in the language", async () => {
    await drawIn(
      language,
      <div>
        <SeatUsageMeter currentUserCount={160} userLimit={150} />
        <SeatUsageMeter currentUserCount={4} userLimit={0} />
      </div>,
    );

    expect(pageText()).toContain(
      sentenceIn(language, "/ {{count}} users", {
        count: digits(language, 150),
      }),
    );
    expect(pageText()).toContain(
      sentenceIn(language, "{{count}} over", { count: digits(language, 10) }),
    );
    expect(pageText()).toContain(
      sentenceIn(language, "{{count}} users · no limit", {
        count: digits(language, 4),
      }),
    );

    if (language !== "en") {
      expect(pageText()).not.toContain("users");
      expect(pageText()).not.toContain("no limit");
    }
  });

  test("an instance's activity pill reads in the language", async () => {
    await drawIn(
      language,
      <div>
        <EnterpriseLicenseInstanceStatusPill
          instance={{} as never}
          isActive={true}
        />
      </div>,
    );

    expect(screen.getByText(wordIn(language, "Active"))).toBeVisible();
  });
});
