import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE DATABASES LIST'S NEEDS ATTENTION: which databases need someone, the
 * most urgent first, rendered for real against a stubbed ModelAPI. The card
 * asks for the databases whose stored verdict may need someone (a fresh
 * Degraded or Unhealthy, and engine metrics that stopped), judges each row
 * again by the same rules, and links each to its page.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

import DatabaseFleetAttentionCard, {
  DATABASE_FLEET_ATTENTION_REFRESH_MS,
  DATABASE_FLEET_ATTENTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseFleetAttentionCard";
import {
  DATABASE_FLEET_ATTENTION_LIMIT,
  DATABASE_FLEET_ATTENTION_SELECT,
  getDatabaseFleetAttentionQueries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseFleetAttention";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { DATABASE_ENGINE_READINGS_STALE_MS } from "../../../Types/DatabaseServer/DatabaseEngineReadings";

type Query = Record<string, unknown>;

const NOW: Date = new Date();

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function database(data: {
  id: string;
  name: string;
  dbSystem: string;
  status: string;
  collectorLastSeenAt: Date;
  readings?: Record<string, number> | undefined;
  readAt?: Date | undefined;
}): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row._id = data.id;
  row.name = data.name;
  row.dbSystem = data.dbSystem;
  row.otelCollectorStatus = data.status;
  row.collectorLastSeenAt = data.collectorLastSeenAt;
  if (data.readings) {
    const at: Date = data.readAt || minutesAgo(1);
    row.engineReadings = {
      instances: {
        "-": { at: at.toISOString(), values: data.readings },
      },
    };
    row.engineReadingsAt = at;
  }
  return row;
}

const UNHEALTHY_PG: DatabaseServer = database({
  id: "11111111-1111-4111-8111-111111111111",
  name: "orders-db",
  dbSystem: "postgresql",
  status: "connected",
  collectorLastSeenAt: minutesAgo(2),
  readings: {
    "Sum|postgresql.backends|": 97,
    "Sum|postgresql.connection.max|": 100,
  },
});

const DEGRADED_REDIS: DatabaseServer = database({
  id: "22222222-2222-4222-8222-222222222222",
  name: "sessions-cache",
  dbSystem: "redis",
  status: "connected",
  collectorLastSeenAt: minutesAgo(2),
  readings: {
    "Sum|redis.memory.used|": 930,
    "Sum|redis.maxmemory|": 1000,
  },
});

const STOPPED_MYSQL: DatabaseServer = database({
  id: "33333333-3333-4333-8333-333333333333",
  name: "billing-db",
  dbSystem: "mysql",
  status: "disconnected",
  collectorLastSeenAt: minutesAgo(90),
});

// A verdict the ingest stored before the readings went calm again.
const RECOVERED_PG: DatabaseServer = database({
  id: "44444444-4444-4444-8444-444444444444",
  name: "analytics-db",
  dbSystem: "postgresql",
  status: "connected",
  collectorLastSeenAt: minutesAgo(2),
  readings: {
    "Sum|postgresql.backends|": 10,
    "Sum|postgresql.connection.max|": 100,
  },
});

function isVerdictQuery(query: Query): boolean {
  return query["engineHealth"] instanceof Includes;
}

function serve(data: {
  verdicts: Array<DatabaseServer>;
  stopped: Array<DatabaseServer>;
}): void {
  getListMock.mockImplementation((request: unknown) => {
    const query: Query = (request as { query: Query }).query;
    const rows: Array<DatabaseServer> = isVerdictQuery(query)
      ? data.verdicts
      : data.stopped;
    return Promise.resolve({ data: rows, count: rows.length });
  });
}

async function renderCard(
  refreshToken: string = "a",
): Promise<ReturnType<typeof render>> {
  let rendered: ReturnType<typeof render> | null = null;
  await act(async () => {
    rendered = render(
      <MemoryRouter>
        <DatabaseFleetAttentionCard refreshToken={refreshToken} />
      </MemoryRouter>,
    );
  });
  return rendered!;
}

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("what the card asks for", () => {
  test("a fresh Degraded or Unhealthy verdict, and engine metrics that stopped - never an archived database", () => {
    const [verdicts, stopped] = getDatabaseFleetAttentionQueries(NOW);
    expect(verdicts!["isArchived"]).toBe(false);
    expect(verdicts!["otelCollectorStatus"]).toBe("connected");
    expect(
      (verdicts!["engineHealth"] as Includes).values.slice().sort(),
    ).toEqual(["degraded", "unhealthy"]);
    const freshSince: GreaterThanOrEqual<Date> = verdicts![
      "engineReadingsAt"
    ] as GreaterThanOrEqual<Date>;
    expect(freshSince).toBeInstanceOf(GreaterThanOrEqual);
    expect(NOW.getTime() - (freshSince.value as Date).getTime()).toBe(
      DATABASE_ENGINE_READINGS_STALE_MS,
    );

    expect(stopped!["isArchived"]).toBe(false);
    expect(stopped!["otelCollectorStatus"]).toBeInstanceOf(NotEqual);
    expect(stopped!["collectorLastSeenAt"]).toBeInstanceOf(NotNull);
  });

  test("each read is bounded and selects only what the rules read", async () => {
    serve({ verdicts: [], stopped: [] });
    await renderCard();
    expect(getListMock).toHaveBeenCalledTimes(2);
    for (const call of getListMock.mock.calls) {
      const request: { limit: number; select: unknown } = call[0] as never;
      expect(request.limit).toBe(DATABASE_FLEET_ATTENTION_LIMIT);
      expect(request.select).toEqual(DATABASE_FLEET_ATTENTION_SELECT);
    }
    expect(Object.keys(DATABASE_FLEET_ATTENTION_SELECT).sort()).toEqual([
      "_id",
      "collectorLastSeenAt",
      "dbSystem",
      "engineReadings",
      "engineReadingsAt",
      "name",
      "otelCollectorStatus",
    ]);
  });
});

describe("what the card says", () => {
  test("the most urgent first: critical by reasons, then what needs a look; each row its engine, why and its page", async () => {
    serve({
      verdicts: [DEGRADED_REDIS, UNHEALTHY_PG, RECOVERED_PG],
      stopped: [STOPPED_MYSQL],
    });
    await renderCard();

    const card: HTMLElement = await screen.findByTestId(
      DATABASE_FLEET_ATTENTION_TEST_ID,
    );
    const items: Array<HTMLElement> = within(card).getAllByTestId(
      `${DATABASE_FLEET_ATTENTION_TEST_ID}-item`,
    );
    /*
     * The recovered database's stale verdict is judged again, and left out;
     * billing-db and orders-db are both critical with one reason, so by name.
     */
    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-key");
      }),
    ).toEqual([STOPPED_MYSQL._id, UNHEALTHY_PG._id, DEGRADED_REDIS._id]);

    expect(items[0]).toHaveTextContent("billing-db");
    expect(items[0]).toHaveTextContent("MySQL");
    expect(items[0]).toHaveTextContent("Engine metrics stopped");
    expect(
      within(items[0]!).getByTestId(
        `${DATABASE_FLEET_ATTENTION_TEST_ID}-last-report`,
      ),
    ).toHaveTextContent(/Last reported/);

    expect(items[1]).toHaveTextContent("orders-db");
    expect(items[1]).toHaveTextContent("PostgreSQL");
    expect(items[1]).toHaveTextContent(
      "Connections at 97% of max_connections",
    );
    expect(items[1]).toHaveAttribute("data-severity", "critical");

    expect(items[2]).toHaveTextContent("sessions-cache");
    expect(items[2]).toHaveTextContent("Memory at 93% of maxmemory");
    expect(items[2]).toHaveAttribute("data-severity", "warning");

    expect(within(items[1]!).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining(`/databases/${UNHEALTHY_PG._id}`),
    );
    expect(
      within(card).getByTestId(`${DATABASE_FLEET_ATTENTION_TEST_ID}-summary`),
    ).toHaveTextContent("2 critical");
  });

  test("a database both reads return is listed once", async () => {
    serve({ verdicts: [UNHEALTHY_PG], stopped: [UNHEALTHY_PG] });
    await renderCard();
    expect(
      screen.getAllByTestId(`${DATABASE_FLEET_ATTENTION_TEST_ID}-item`).length,
    ).toBe(1);
  });

  test("a calm fleet draws no card", async () => {
    serve({ verdicts: [RECOVERED_PG], stopped: [] });
    await renderCard();
    expect(
      screen.queryByTestId(DATABASE_FLEET_ATTENTION_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a read that came back full says the card may not show every database", async () => {
    const many: Array<DatabaseServer> = [];
    for (let index: number = 0; index < DATABASE_FLEET_ATTENTION_LIMIT; index++) {
      const row: DatabaseServer = database({
        id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
        name: `db-${index}`,
        dbSystem: "postgresql",
        status: "connected",
        collectorLastSeenAt: minutesAgo(1),
        readings: {
          "Sum|postgresql.backends|": 99,
          "Sum|postgresql.connection.max|": 100,
        },
      });
      many.push(row);
    }
    serve({ verdicts: many, stopped: [] });
    await renderCard();
    expect(
      screen.getByTestId(DATABASE_FLEET_ATTENTION_TEST_ID),
    ).toHaveTextContent("The first 200 of each kind are shown");
  });

  test("a read that fails says so in the card, and Refresh reads again", async () => {
    getListMock.mockImplementation(() => {
      return Promise.reject(new Error("Forbidden"));
    });
    await renderCard();
    const error: HTMLElement = screen.getByTestId(
      `${DATABASE_FLEET_ATTENTION_TEST_ID}-error`,
    );
    expect(error).toHaveTextContent("Forbidden");

    serve({ verdicts: [UNHEALTHY_PG], stopped: [] });
    await act(async () => {
      fireEvent.click(within(error).getByRole("button"));
    });
    expect(
      await screen.findByTestId(`${DATABASE_FLEET_ATTENTION_TEST_ID}-item`),
    ).toHaveTextContent("orders-db");
  });
});

describe("when the card reads again", () => {
  test("when the list is refreshed, and every minute", async () => {
    jest.useFakeTimers();
    serve({ verdicts: [UNHEALTHY_PG], stopped: [] });
    const rendered: ReturnType<typeof render> = await renderCard("a");
    expect(getListMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      rendered.rerender(
        <MemoryRouter>
          <DatabaseFleetAttentionCard refreshToken="b" />
        </MemoryRouter>,
      );
    });
    expect(getListMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      jest.advanceTimersByTime(DATABASE_FLEET_ATTENTION_REFRESH_MS);
    });
    expect(getListMock).toHaveBeenCalledTimes(6);
  });
});
