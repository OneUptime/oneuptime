/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import NeedsAttentionCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/NeedsAttentionCard";
import ResourceStatusCell from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceStatusCell";
import ResourceOverview from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import {
  getDatabaseHealthPill,
  getDatabaseOwnAttentionItems,
  getDatabaseStatusCell,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseHealthPresentation";
import { getDatabaseFleetAttentionItems } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseFleetAttention";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Route from "../../../Types/API/Route";
import {
  DatabaseHealthAssessment,
  assessDatabase,
} from "../../../Types/DatabaseServer/DatabaseHealth";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslator from "../../../UI/Utils/UseTranslator";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A DATABASE'S HEALTH IN THE READER'S LANGUAGE - from the Dashboard's
 * shipped locale files. Every word the rules say (DatabaseHealth) - the
 * health pill, the list's Status and its reason, Needs attention's rows and
 * reasons - reads in German, and in Persian with a count in the reader's
 * digits; the engine's own names (max_connections, PostgreSQL) stay as
 * written.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");

const NOW: Date = new Date("2026-11-03T10:00:00.000Z");

// The locale's wording, which must be its own and not the English.
function worded(locale: Record<string, string>, key: string): string {
  const value: string | undefined = locale[key];
  expect(value).toBeTruthy();
  expect(value).not.toBe(key);
  return value as string;
}

// A sentence of the locale with its values in place.
function sentence(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string>,
): string {
  let text: string = worded(locale, key);
  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }
  return text;
}

/*
 * Fields to set on the row over the defaults below. A field may be set to
 * undefined, as a database that never sent readings has none: Partial alone
 * refuses that under exactOptionalPropertyTypes.
 */
type DatabaseServerFields = {
  [Field in keyof DatabaseServer]?: DatabaseServer[Field] | undefined;
};

function database(
  values: Record<string, number>,
  extra: DatabaseServerFields = {},
): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row._id = "42b6aaae-7558-42fe-999b-395bbfc79d63";
  row.name = "orders-db";
  row.dbSystem = "postgresql";
  row.otelCollectorStatus = "connected";
  row.collectorLastSeenAt = new Date(NOW.getTime() - 60 * 1000);
  row.engineReadings = {
    instances: {
      "orders-db.internal:5432": {
        at: new Date(NOW.getTime() - 60 * 1000).toISOString(),
        values: {
          "Sum|postgresql.backends|": 20,
          "Sum|postgresql.connection.max|": 100,
          ...values,
        },
      },
    },
  };
  Object.assign(row, extra);
  return row;
}

function assess(row: DatabaseServer): DatabaseHealthAssessment {
  return assessDatabase(row, { now: NOW });
}

const UNHEALTHY: DatabaseServer = database({
  "Sum|postgresql.backends|": 96,
  "Max|postgresql.wal.delay|operation=replay": 75,
});

const STOPPED: DatabaseServer = database(
  {},
  {
    otelCollectorStatus: "disconnected",
    collectorLastSeenAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    engineReadings: undefined,
  },
);

// Needs attention with the rows a database's own Overview hands it.
const OwnAttention: React.FunctionComponent<{ row: DatabaseServer }> = (props: {
  row: DatabaseServer;
}): React.ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <NeedsAttentionCard
      testId="database-needs-attention"
      items={getDatabaseOwnAttentionItems({
        assessment: assess(props.row),
        translator: translator,
        metricsRoute: new Route("/metrics"),
        documentationRoute: new Route("/documentation"),
      })}
      showKind={false}
    />
  );
};

function itemsText(testId: string): Array<string> {
  return within(screen.getByTestId(testId))
    .getAllByTestId(`${testId}-item`)
    .map((item: HTMLElement): string => {
      return withoutIsolateMarks(item.textContent || "");
    });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

afterEach(() => {
  cleanup();
});

describe("in German", () => {
  test("the list's Status and its reason", () => {
    render(
      <ResourceStatusCell
        resource={getDatabaseStatusCell({
          assessment: assess(UNHEALTHY),
          language: "de",
          now: NOW,
        })}
      />,
    );
    expect(screen.getByText(worded(DE, "Unhealthy"))).toBeInTheDocument();
    expect(
      withoutIsolateMarks(
        screen.getByTestId("resource-status-reason").textContent || "",
      ),
    ).toContain(
      sentence(DE, "Connections at {{percent}} of max_connections", {
        percent: "96\u00A0%",
      }),
    );
  });

  test("engine metrics that stopped, and when they last arrived", () => {
    render(
      <ResourceStatusCell
        resource={getDatabaseStatusCell({
          assessment: assess(STOPPED),
          language: "de",
          now: NOW,
        })}
      />,
    );
    expect(
      screen.getByText(worded(DE, "Engine metrics stopped")),
    ).toBeInTheDocument();
    // "vor 3 Stunden", in the sentence's own language.
    expect(
      withoutIsolateMarks(
        screen.getByTestId("resource-status-reason").textContent || "",
      ),
    ).toBe(sentence(DE, "Last reported {{time}}", { time: "vor 3 Stunden" }));
  });

  test("the hero's health pill", () => {
    render(
      <MemoryRouter>
        <ResourceOverview
          icon={IconProp.Database}
          title="orders-db"
          identifier="orders-db.internal:5432"
          identifierLabel="endpoint"
          status="active"
          statusLabel="Seen recently"
          lastSeenAt={NOW}
          health={getDatabaseHealthPill(assess(UNHEALTHY))}
          chips={[]}
          tiles={[]}
          detailRows={[]}
          detailsDescription="Its engine and endpoints."
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("resource-overview-health")).toHaveTextContent(
      worded(DE, "Unhealthy"),
    );
    cleanup();
    render(
      <MemoryRouter>
        <ResourceOverview
          icon={IconProp.Database}
          title="orders-db"
          identifier=""
          identifierLabel="endpoint"
          status="inactive"
          lastSeenAt={NOW}
          health={getDatabaseHealthPill(assess(STOPPED))}
          chips={[]}
          tiles={[]}
          detailRows={[]}
          detailsDescription="Its engine and endpoints."
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("resource-overview-health")).toHaveTextContent(
      worded(DE, "Health Unknown"),
    );
  });

  test("Needs attention's rows are named and worded in German, the most urgent first", () => {
    render(
      <MemoryRouter>
        <OwnAttention row={UNHEALTHY} />
      </MemoryRouter>,
    );
    const rows: Array<string> = itemsText("database-needs-attention");
    expect(rows[0]).toContain(worded(DE, "Connections"));
    expect(rows[0]).toContain(
      sentence(DE, "Connections at {{percent}} of max_connections", {
        percent: "96\u00A0%",
      }),
    );
    expect(rows[1]).toContain(worded(DE, "Replication"));
    expect(rows[1]).toContain(
      sentence(DE, "A replica {{minutes}} min behind", { minutes: "1" }),
    );
  });

  test("PostgreSQL's own SQL checks: wraparound coming and a transaction left open", () => {
    render(
      <MemoryRouter>
        <OwnAttention
          row={database({
            "Max|postgresql.xid.oldest_age|": 1_600_000_000,
            "Max|postgresql.transaction.longest_duration|": 7300,
          })}
        />
      </MemoryRouter>,
    );
    const rows: Array<string> = itemsText("database-needs-attention");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(worded(DE, "Availability"));
    expect(rows[0]).toContain(
      sentence(DE, "Transaction IDs at {{percent}} of wraparound", {
        percent: "74\u00A0%",
      }),
    );
    expect(rows[1]).toContain(worded(DE, "Performance"));
    expect(rows[1]).toContain(
      sentence(DE, "A transaction open for {{hours}} h", { hours: "2" }),
    );
  });
});

describe("in Persian", () => {
  test("a count in Persian digits, max_connections as written", async () => {
    await i18next.changeLanguage("fa");
    render(
      <ResourceStatusCell
        resource={getDatabaseStatusCell({
          assessment: assess(
            database(
              {
                "Max|sqlserver.processes.blocked|": 3,
                "Min|sqlserver.page.buffer_cache.hit_ratio|": 99,
                "Min|sqlserver.page.life_expectancy|": 4000,
                "Max|sqlserver.memory.grants.pending.count|": 0,
              },
              { dbSystem: "microsoft.sql_server" },
            ),
          ),
          language: "fa",
          now: NOW,
        })}
      />,
    );
    expect(screen.getByText(worded(FA, "Degraded"))).toBeInTheDocument();
    expect(
      withoutIsolateMarks(
        screen.getByTestId("resource-status-reason").textContent || "",
      ),
    ).toBe(sentence(FA, "{{count}} blocked sessions", { count: "۳" }));
  });

  test("sessions waiting on locks, counted in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    render(
      <ResourceStatusCell
        resource={getDatabaseStatusCell({
          assessment: assess(
            database({ "Max|postgresql.sessions.waiting_on_lock|": 3 }),
          ),
          language: "fa",
          now: NOW,
        })}
      />,
    );
    expect(screen.getByText(worded(FA, "Degraded"))).toBeInTheDocument();
    expect(
      withoutIsolateMarks(
        screen.getByTestId("resource-status-reason").textContent || "",
      ),
    ).toBe(sentence(FA, "{{count}} sessions waiting on locks", { count: "۳" }));
  });

  test("the fleet's Needs attention: Persian reasons, the engine's name as written", async () => {
    await i18next.changeLanguage("fa");
    render(
      <MemoryRouter>
        <NeedsAttentionCard
          testId="database-fleet-attention"
          items={getDatabaseFleetAttentionItems({
            databases: [UNHEALTHY],
            now: NOW,
            getDatabaseRoute: (id: string): Route => {
              return new Route(`/databases/${id}`);
            },
          })}
        />
      </MemoryRouter>,
    );
    const card: HTMLElement = screen.getByTestId("database-fleet-attention");
    expect(
      within(card).getByTestId("database-fleet-attention-kind"),
    ).toHaveTextContent("PostgreSQL");
    const text: string = itemsText("database-fleet-attention")[0]!;
    expect(text).toContain("orders-db");
    expect(text).toContain(
      sentence(FA, "Connections at {{percent}} of max_connections", {
        percent: "۹۶٪",
      }),
    );
    expect(text).toContain(
      sentence(FA, "A replica {{minutes}} min behind", { minutes: "۱" }),
    );
  });
});
