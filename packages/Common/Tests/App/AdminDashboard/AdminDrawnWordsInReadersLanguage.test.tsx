import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHAT THE ADMIN'S OWN PAGES DREW AS WRITTEN, IN THE READER'S LANGUAGE (#8555).
 *
 * 56 texts of the Admin Dashboard's own pages never went near a lookup: an
 * element's own text (the migration status's "Applied" and "Pending", the
 * ClickHouse table's column heads), or a sentence glued from pieces
 * ("ClickHouse is " + "not reachable" + " from this instance.", "and " + 2 +
 * " more…", `${feature} is a OneUptime Enterprise Edition feature…`). A
 * German, Arabic or Persian reader read each in English, and a count in a
 * Persian sentence in Latin digits. More were kept in constants and helpers
 * the extractor could not read: the support bundle's contents, the health
 * log's metric labels, the Enterprise upsells' feature names.
 *
 * Each goes through the page's translator now. This draws the real pages,
 * with the server's answers stood in and i18next set up as the Admin's, in
 * English, German, Arabic and Persian: each sentence reads whole, in the
 * language's words, its counts in the language's digits and its facts set
 * apart as the language does - and none of the English is left.
 * App/Tests/AdminDashboard/AdminOwnPagesDrawnAsWrittenGuard holds the pages
 * to drawing nothing as written.
 */

jest.setTimeout(60000);

const mockApiGet: MockFunction = getJestMockFunction();
const mockFetchProjectMilestones: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return mockApiGet(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : String(err);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Components/ProjectMilestones/ProjectMilestones",
  () => {
    return {
      __esModule: true,
      fetchProjectMilestones: (...args: Array<unknown>): unknown => {
        return mockFetchProjectMilestones(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import MigrationStatus from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/MigrationStatus";
import ClickhouseCapacity from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacity";
import ClickhouseCapacitySummary from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/ClickhouseCapacitySummary";
import InstanceHealthLogs from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/InstanceHealthLogs";
import SupportBundle from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/SupportBundle";
import EnterpriseFeatureUpgrade from "../../../../App/FeatureSet/AdminDashboard/src/Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import ProjectMilestonesCard from "../../../../App/FeatureSet/AdminDashboard/src/Components/ProjectMilestones/ProjectMilestonesCard";
import ProjectScopedTeamsPicker from "../../../../App/FeatureSet/AdminDashboard/src/Components/GlobalProvider/ProjectScopedTeamsPicker";
import { ACTIVATION_MILESTONE_DETAILS } from "../../../Types/Analytics/ActivationMilestone";

type Locale = Record<string, unknown>;

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const readLocale: (language: string) => Locale = (language: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
};

const ENGLISH: Locale = readLocale("en");

// The languages drawn: a long one, and both read from the right.
const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];

// The text `language` gives `key`, read from its file.
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

// `language`'s sentence for `key`, its {{placeholders}} filled.
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

// What the page reads, without the marks that set a value apart.
const pageText: () => string = (): string => {
  return (document.body.textContent || "").replace(/[⁦-⁩]/g, "");
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

  expect(pieces.length).toBeGreaterThan(0);

  for (const piece of pieces) {
    expect({ key, piece, drawn: pageText().includes(piece) }).toEqual({
      key,
      piece,
      drawn: true,
    });
  }
};

// None of the English of `keys` is left on a page drawn in another language.
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

// An instance as the Admin's Utils/i18n.ts has it, in `language`.
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

// Twelve migrations behind, the first of them failing; the data migrations up to date.
const PENDING: Array<string> = Array.from(
  { length: 12 },
  (_value: unknown, index: number): string => {
    return `Migration${121 + index}`;
  },
);

const MIGRATIONS: JSONObject = {
  postgres: {
    connected: true,
    isUpToDate: false,
    totalApplied: 120,
    totalDefined: 132,
    totalPending: 12,
    pendingMigrations: PENDING,
    latestDefinedMigration: { name: "Migration132" },
    latestAppliedMigration: { name: "Migration120" },
    lastFailedAt: "2026-11-14T10:15:00.000Z",
    recentFailures: [
      {
        migrationName: "Migration121",
        attemptedAt: "2026-11-14T10:15:00.000Z",
        errorMessage: 'relation "Probe" does not exist',
        errorStack: "Error: relation does not exist\n    at Migration121.up",
        hostName: "app-1",
        appVersion: "14.2.0",
      },
    ],
  },
  dataMigrations: {
    connected: true,
    isUpToDate: true,
    totalApplied: 40,
    totalDefined: 40,
    totalPending: 0,
    pendingMigrations: [],
    latestDefinedMigration: { name: "DataMigration40" },
    latestAppliedMigration: { name: "DataMigration40" },
    recentFailures: [],
  },
};

const CAPACITY: JSONObject = {
  connected: true,
  dataSizeInBytes: 5 * 1024 * 1024 * 1024,
  diskTotalInBytes: 300,
  diskFreeInBytes: 90,
  diskByNode: [
    {
      shardNum: 1,
      host: "ch-1",
      diskName: "default",
      totalInBytes: 100,
      freeInBytes: 70,
    },
    {
      shardNum: 2,
      host: "ch-2",
      diskName: "default",
      totalInBytes: 200,
      freeInBytes: 20,
    },
  ],
  localTableSizesByShard: [
    {
      shardNum: 1,
      host: "ch-1",
      tableName: "LogItem",
      sizeInBytes: 2048,
      rowCount: 10,
      partCount: 2,
    },
  ],
};

const HEALTH_LOGS: Array<JSONObject> = [
  {
    _id: "log-1",
    eventType: "ClickHouseDataPruning",
    status: "WaitingForReclaim",
    createdAt: "2026-11-14T10:15:00.000Z",
    completedAt: "2026-11-14T10:16:00.000Z",
    nextCheckAt: "2026-11-14T10:30:00.000Z",
    message: "Dropped 3 partitions.",
    capacityBeforePercent: 91,
    capacityAfterPercent: 75,
    thresholdPercent: 90,
    targetPercent: 70,
    estimatedFreedBytes: 4096,
    metadata: { partitions: 3 },
  },
  {
    _id: "log-2",
    eventType: "SomeNewerKindOfWork",
    status: "Resolved",
    createdAt: "2026-11-14T09:00:00.000Z",
  },
];

let healthLogs: Array<JSONObject> = HEALTH_LOGS;
let capacity: JSONObject = CAPACITY;

beforeEach(() => {
  healthLogs = HEALTH_LOGS;
  capacity = CAPACITY;
  mockApiGet.mockReset();
  mockApiGet.mockImplementation(async (...args: Array<unknown>) => {
    const url: string = String((args[0] as { url: unknown }).url);

    if (url.includes("/admin/health/migrations")) {
      return { data: MIGRATIONS };
    }

    if (url.includes("/admin/health/clickhouse-capacity")) {
      return { data: capacity };
    }

    if (url.includes("/admin/health/instance-health-logs")) {
      return { data: { logs: healthLogs } };
    }

    throw new Error(`No answer for ${url}`);
  });
  mockFetchProjectMilestones.mockReset();
  mockFetchProjectMilestones.mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
});

describe.each(LANGUAGES)(
  "Admin Dashboard > Health > Migrations, in %s",
  (language: string) => {
    const LABELS: Array<string> = [
      "PostgreSQL schema migrations",
      "Structural schema migrations applied to the Postgres database.",
      "ClickHouse & data migrations",
      "ClickHouse schema and data backfill migrations.",
      "Applied",
      "Shipped in build",
      "Latest in build",
      "Latest applied",
      "Last failed attempt",
      "A migration failed to apply. The runner stops at the first failure, so every migration after it stays pending until it is fixed and re-run. See the error below.",
      "Pending migrations (run in order)",
      "Stack trace",
    ];

    test("each block's labels, its explanation and its list read in the language", async () => {
      await drawIn(language, <MigrationStatus />);

      await waitFor(() => {
        expect(
          screen.getByText(wordIn(language, "PostgreSQL schema migrations")),
        ).toBeVisible();
      });

      for (const key of LABELS) {
        expect({
          key,
          drawn: pageText().includes(wordIn(language, key)),
        }).toEqual({ key, drawn: true });
      }

      expect(
        screen.getAllByText(wordIn(language, "Pending")).length,
      ).toBeGreaterThan(0);

      expectNoEnglishOf(language, LABELS);
    });

    test("the counts are whole sentences, in the language's forms and digits", async () => {
      await drawIn(language, <MigrationStatus />);

      // Twelve pending, the first failing: the status bubble says both.
      expect(
        await screen.findByText(
          sentenceIn(language, "{{count}} pending · failed", {
            count: digits(language, 12),
          }),
        ),
      ).toBeVisible();

      // Ten are listed, and the rest counted.
      expect(pageText()).toContain(
        sentenceIn(language, "and {{count}} more…", {
          count: digits(language, 2),
        }),
      );

      expect(pageText()).toContain(
        sentenceIn(language, "Recent failed attempts ({{count}})", {
          count: digits(language, 1),
        }),
      );

      // The data migrations are up to date, in the language's words.
      expect(screen.getByText(wordIn(language, "Up to date"))).toBeVisible();

      if (language !== "en") {
        expect(pageText()).not.toContain("12 pending");
        expect(pageText()).not.toContain("and 2 more");
        expect(pageText()).not.toContain("Recent failed attempts");
      }
    });

    test("a failed attempt says when, where and on which build, each as one sentence", async () => {
      await drawIn(language, <MigrationStatus />);

      await waitFor(() => {
        expect(pageText()).toContain(
          sentenceIn(language, "on {{host}}", { host: "app-1" }),
        );
      });

      expect(pageText()).toContain(
        sentenceIn(language, "build {{version}}", { version: "14.2.0" }),
      );
      expectSentenceAround(language, "Failed {{time}}");

      // The server's own words read as it wrote them.
      expect(pageText()).toContain('relation "Probe" does not exist');
    });
  },
);

describe.each(LANGUAGES)(
  "Admin Dashboard > Health > ClickHouse capacity, in %s",
  (language: string) => {
    const WORDS: Array<string> = [
      "ClickHouse is reachable from this instance.",
      "Shard",
      "Host",
      "Local table",
      "Data",
      "Rows",
      "Active parts",
      "ClickHouse data",
      "Disk used",
      "Disk total",
    ];

    test("the sentence, the stats and the local tables' columns read in the language", async () => {
      await drawIn(language, <ClickhouseCapacity />);

      expect(
        await screen.findByText(
          wordIn(language, "ClickHouse is reachable from this instance."),
        ),
      ).toBeVisible();

      for (const key of WORDS) {
        expect({
          key,
          drawn: screen.queryAllByText(wordIn(language, key)).length > 0,
        }).toEqual({ key, drawn: true });
      }

      expectNoEnglishOf(language, [
        "ClickHouse is reachable from this instance.",
        "Local table",
        "Active parts",
        "Disk used",
        "Disk total",
      ]);
    });

    test("each disk is named by its facts, set apart as the language does, its shard in the language's digits", async () => {
      await drawIn(language, <ClickhouseCapacity />);

      const label: string = [
        wordIn(language, "ClickHouse disk"),
        sentenceIn(language, "Shard {{shard}}", {
          shard: digits(language, 2),
        }),
        "ch-2",
        "default",
      ].join(separatorIn(language));

      await screen.findByText(
        wordIn(language, "ClickHouse is reachable from this instance."),
      );
      expect(pageText()).toContain(label);
    });

    test("an unreachable ClickHouse says so as one sentence", async () => {
      capacity = { connected: false };

      await drawIn(language, <ClickhouseCapacity />);

      expect(
        await screen.findByText(
          wordIn(language, "ClickHouse is not reachable from this instance."),
        ),
      ).toBeVisible();
      expect(
        screen.getByText(
          wordIn(language, "No local ClickHouse table sizes were reported."),
        ),
      ).toBeVisible();
    });

    test("the Health landing page's summary names the fullest of the disks in the language", async () => {
      await drawIn(language, <ClickhouseCapacitySummary />);

      const label: string = [
        sentenceIn(language, "Fullest of {{count}} disks", {
          count: digits(language, 2),
        }),
        sentenceIn(language, "Shard {{shard}}", {
          shard: digits(language, 2),
        }),
        "ch-2",
        "default",
      ].join(separatorIn(language));

      expect(
        await screen.findByText(
          wordIn(language, "ClickHouse is reachable from this instance."),
        ),
      ).toBeVisible();
      expect(pageText()).toContain(label);
      expect(pageText()).toContain(
        sentenceIn(language, "ClickHouse data: {{size}}", {
          size: "5.0\u00A0GB",
        }),
      );

      if (language !== "en") {
        expect(pageText()).not.toContain("Fullest of");
        expect(pageText()).not.toContain("ClickHouse data:");
      }
    });
  },
);

describe.each(LANGUAGES)(
  "Admin Dashboard > Health > OneUptime Health log, in %s",
  (language: string) => {
    const METRICS: Array<string> = [
      "Capacity before",
      "Capacity after",
      "Trigger",
      "Target",
      "Estimated space freed",
      "Work details",
    ];

    test("each entry's kind, outcome, times and figures read in the language", async () => {
      await drawIn(language, <InstanceHealthLogs />);

      expect(
        await screen.findByText(wordIn(language, "ClickHouse Data Pruning")),
      ).toBeVisible();
      expect(
        screen.getByText(wordIn(language, "Waiting for Reclaim")),
      ).toBeVisible();
      expect(screen.getByText(wordIn(language, "Resolved"))).toBeVisible();

      for (const key of METRICS) {
        expect({
          key,
          drawn: screen.queryAllByText(wordIn(language, key)).length > 0,
        }).toEqual({ key, drawn: true });
      }

      for (const key of [
        "Recorded {{time}}",
        "Completed {{time}}",
        "Next check {{time}}",
      ]) {
        expectSentenceAround(language, key);
      }

      // A kind of work this page does not name yet is spelled out, as written.
      expect(screen.getByText("Some Newer Kind Of Work")).toBeVisible();

      expectNoEnglishOf(language, [
        "ClickHouse Data Pruning",
        "Waiting for Reclaim",
        ...METRICS,
      ]);
    });

    test("with nothing recorded, it says so in the language", async () => {
      healthLogs = [];

      await drawIn(language, <InstanceHealthLogs />);

      expect(
        await screen.findByText(
          wordIn(language, "No OneUptime Health work has been recorded yet."),
        ),
      ).toBeVisible();
    });
  },
);

describe.each(LANGUAGES)(
  "Admin Dashboard > Health > Support Bundle, in %s",
  (language: string) => {
    const CONTENTS: Array<string> = [
      "Instance version & build",
      "Runtime & resource usage",
      "Effective configuration (secrets redacted)",
      "Component health & datastore capacity",
      "Database migration status",
      "Queue stats & failed jobs (full body, options & logs)",
      "Application, Postgres, ClickHouse & Valkey logs",
      "Postgres diagnostics (connections, table stats)",
      "ClickHouse diagnostics (mutations, parts)",
      "Postgres & ClickHouse schema (structure only)",
    ];

    test("what the bundle holds, and what to check before sharing it, read in the language", async () => {
      await drawIn(language, <SupportBundle />);

      expect(
        screen.getByText(wordIn(language, "What's included")),
      ).toBeVisible();

      for (const key of CONTENTS) {
        expect({
          key,
          drawn: screen.queryAllByText(wordIn(language, key)).length > 0,
        }).toEqual({ key, drawn: true });
      }

      expect(
        screen.getByText(
          wordIn(
            language,
            "Credentials are scrubbed (config, schema, connection strings). Failed-job bodies and logs may contain customer data — review before sharing externally.",
          ),
        ),
      ).toBeVisible();

      expectNoEnglishOf(language, ["What's included", ...CONTENTS]);
    });
  },
);

describe.each(LANGUAGES)(
  "Admin Dashboard > the Enterprise upsell, in %s",
  (language: string) => {
    test("its badge, the feature's name and the pitch around it read in the language", async () => {
      await drawIn(
        language,
        <EnterpriseFeatureUpgrade
          title="OneUptime Health"
          description="Operational health of this OneUptime instance."
          featureName="PostgreSQL cluster health"
          featureDescription="Connectivity and memory capacity for the Valkey backing this instance."
          benefits={[]}
        />,
      );

      const feature: string = wordIn(language, "PostgreSQL cluster health");

      expect(screen.getByText(feature)).toBeVisible();
      expect(screen.getByText(wordIn(language, "Enterprise"))).toBeVisible();
      expect(
        screen.getByText(
          wordIn(
            language,
            "Connectivity and memory capacity for the Valkey backing this instance.",
          ),
        ),
      ).toBeVisible();
      expect(pageText()).toContain(
        sentenceIn(
          language,
          "{{feature}} is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable it.",
          { feature },
        ),
      );

      if (language !== "en") {
        expect(pageText()).not.toContain("PostgreSQL cluster health");
        expect(pageText()).not.toContain("is a OneUptime Enterprise Edition");
      }
    });
  },
);

describe.each(LANGUAGES)(
  "Admin Dashboard > a project's milestones and teams, in %s",
  (language: string) => {
    test("a milestone not reached yet says so, and where the project is stuck reads as one sentence", async () => {
      await drawIn(
        language,
        <ProjectMilestonesCard
          projectId={ObjectID.generate()}
          title="Milestones"
          description="How far this project has got."
        />,
      );

      await waitFor(() => {
        expect(screen.getAllByText(wordIn(language, "Not yet")).length).toBe(
          ACTIVATION_MILESTONE_DETAILS.length,
        );
      });

      expectSentenceAround(language, "Stuck at: {{step}}.");

      // The catalog's words too: each milestone's title, and what is missing (#8599).
      expect(pageText()).toContain(
        sentenceIn(language, "Stuck at: {{step}}.", {
          step: wordIn(language, ACTIVATION_MILESTONE_DETAILS[0]!.missingText),
        }),
      );

      for (const detail of ACTIVATION_MILESTONE_DETAILS) {
        expect({
          title: detail.title,
          drawn: pageText().includes(wordIn(language, detail.title)),
        }).toEqual({ title: detail.title, drawn: true });
      }

      if (language !== "en") {
        expect(pageText()).not.toContain("Not yet");
        expect(pageText()).not.toContain("Stuck at:");
        expect(pageText()).not.toContain("First monitor created");
        expect(pageText()).not.toContain("No monitor yet");
      }
    });

    test("the default-teams picker with no project chosen says what to do first", async () => {
      await drawIn(
        language,
        <ProjectScopedTeamsPicker
          projectId={undefined}
          selectedTeamIds={[]}
          onChange={() => {}}
        />,
      );

      expect(
        screen.getByText(
          wordIn(
            language,
            "Select a project first to choose its default teams.",
          ),
        ),
      ).toBeVisible();
    });
  },
);
