import TelemetryAttributeServiceInstance from "../../../Server/Services/TelemetryAttributeService";
import LogService from "../../../Server/Services/LogService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { TelemetryServiceFilter } from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The attribute pickers (keys, then values) read the keys and values seen
 * on telemetry rows. A caller limited to some services must get the keys
 * and values of those services' rows only, and both are cached - so a
 * limited answer must be cached apart from the whole project's, and never
 * be served to (or from) another caller's scope.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceA: ObjectID = ObjectID.generate();
const serviceB: ObjectID = ObjectID.generate();
const serviceC: ObjectID = ObjectID.generate();

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (implementation: (...args: Array<any>) => any) => unknown;
  mockResolvedValue: (value: unknown) => unknown;
}

function spyOn(target: unknown, method: string): Spy {
  return jest.spyOn(target as never, method as never) as unknown as Spy;
}

function dbResult(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: rows };
    },
  };
}

// Statistics say the query finished, so fewer rows than the LIMIT are every value.
function finishedDbResult(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<JSONObject> => {
      return {
        data: rows,
        statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 1 },
      };
    },
  };
}

let cache: Map<string, JSONObject>;
let logQuery: Spy;

beforeEach(() => {
  cache = new Map();

  spyOn(GlobalCache, "getJSONObject").mockImplementation(
    async (_namespace: string, key: string): Promise<JSONObject | null> => {
      return cache.get(key) || null;
    },
  );
  spyOn(GlobalCache, "setJSON").mockImplementation(
    async (_namespace: string, key: string, value: JSONObject) => {
      cache.set(key, value);
    },
  );

  logQuery = spyOn(LogService, "executeQuery");
  logQuery.mockResolvedValue(dbResult([{ keys: ["http.method"] }]));
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lastStatement(spy: Spy): Statement {
  return spy.mock.calls[spy.mock.calls.length - 1]![0] as Statement;
}

function boundLists(statement: Statement): Array<Array<string>> {
  return Object.values(statement.query_params).filter(
    (value: unknown): boolean => {
      return Array.isArray(value);
    },
  ) as Array<Array<string>>;
}

const limited: TelemetryServiceFilter = {
  serviceIds: [serviceA],
  excludedServiceIds: [serviceC],
};

describe("attribute keys follow the caller's read scope", () => {
  test("a limited caller's keys are read from their services' rows only", async () => {
    await TelemetryAttributeServiceInstance.fetchAttributes({
      projectId,
      telemetryType: TelemetryType.Log,
      serviceFilter: limited,
    });

    const statement: Statement = lastStatement(logQuery);
    expect(statement.query).toContain("AND primaryEntityId IN (");
    expect(statement.query).toContain("AND primaryEntityId NOT IN (");
    expect(boundLists(statement)).toEqual(
      expect.arrayContaining([[serviceA.toString()], [serviceC.toString()]]),
    );
    // The filter sits inside the WHERE clause, before the query settings.
    expect(statement.query.indexOf("primaryEntityId IN (")).toBeLessThan(
      statement.query.indexOf("SETTINGS"),
    );
  });

  test("a project-wide caller's keys are read with no service filter", async () => {
    await TelemetryAttributeServiceInstance.fetchAttributes({
      projectId,
      telemetryType: TelemetryType.Log,
    });

    expect(lastStatement(logQuery).query).not.toContain("primaryEntityId");
  });

  test("a project-wide answer in the cache is never served to a limited caller", async () => {
    logQuery.mockResolvedValue(dbResult([{ keys: ["every.service.key"] }]));
    const projectWide: Array<string> =
      await TelemetryAttributeServiceInstance.fetchAttributes({
        projectId,
        telemetryType: TelemetryType.Log,
      });
    expect(projectWide).toEqual(["every.service.key"]);

    logQuery.mockResolvedValue(dbResult([{ keys: ["service.a.key"] }]));
    const forLimited: Array<string> =
      await TelemetryAttributeServiceInstance.fetchAttributes({
        projectId,
        telemetryType: TelemetryType.Log,
        serviceFilter: limited,
      });

    expect(forLimited).toEqual(["service.a.key"]);
    expect(logQuery.mock.calls.length).toBe(2);
  });

  test("callers with different scopes are cached apart; the same scope shares its entry", async () => {
    await TelemetryAttributeServiceInstance.fetchAttributes({
      projectId,
      telemetryType: TelemetryType.Log,
      serviceFilter: { serviceIds: [serviceA, serviceB] },
    });
    await TelemetryAttributeServiceInstance.fetchAttributes({
      projectId,
      telemetryType: TelemetryType.Log,
      serviceFilter: { serviceIds: [serviceB] },
    });
    await TelemetryAttributeServiceInstance.fetchAttributes({
      projectId,
      telemetryType: TelemetryType.Log,
      serviceFilter: { excludedServiceIds: [serviceB] },
    });

    // Three scopes, three entries, three reads.
    expect(cache.size).toBe(3);
    expect(logQuery.mock.calls.length).toBe(3);
    for (const key of cache.keys()) {
      expect(key).toContain(":scope:");
      // The cache key names no resource id outright.
      expect(key).not.toContain(serviceA.toString());
      expect(key).not.toContain(serviceB.toString());
    }

    // The same services in another order are the same scope: served from the cache.
    await TelemetryAttributeServiceInstance.fetchAttributes({
      projectId,
      telemetryType: TelemetryType.Log,
      serviceFilter: { serviceIds: [serviceB, serviceA] },
    });
    expect(logQuery.mock.calls.length).toBe(3);
  });
});

describe("attribute values follow the caller's read scope", () => {
  test("a limited caller's values are read from their services' rows only", async () => {
    logQuery.mockResolvedValue(dbResult([{ attributeValue: "GET" }]));

    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
      searchText: "G",
      serviceFilter: limited,
    });

    const statement: Statement = lastStatement(logQuery);
    expect(statement.query).toContain("AND primaryEntityId IN (");
    expect(statement.query).toContain("AND primaryEntityId NOT IN (");
    expect(boundLists(statement)).toEqual(
      expect.arrayContaining([[serviceA.toString()], [serviceC.toString()]]),
    );
    // The scope narrows before LIMIT picks the values to return.
    expect(statement.query.indexOf("primaryEntityId IN (")).toBeLessThan(
      statement.query.indexOf("LIMIT"),
    );
  });

  test("a project-wide caller's values are read with no service filter", async () => {
    logQuery.mockResolvedValue(dbResult([]));

    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
    });

    expect(lastStatement(logQuery).query).not.toContain("primaryEntityId");
  });

  test("each scope's answer is cached for that scope alone", async () => {
    logQuery.mockResolvedValue(
      dbResult([{ attributeValue: "every.service.value" }]),
    );
    const projectWide: Array<string> =
      await TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
      });
    expect(projectWide).toEqual(["every.service.value"]);

    logQuery.mockResolvedValue(
      dbResult([{ attributeValue: "service.a.value" }]),
    );
    const forLimited: Array<string> =
      await TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
        serviceFilter: limited,
      });
    expect(forLimited).toEqual(["service.a.value"]);
    expect(logQuery.mock.calls.length).toBe(2);

    // Asked again, each caller gets its own answer back from the cache.
    expect(
      await TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
      }),
    ).toEqual(["every.service.value"]);
    expect(
      await TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
        serviceFilter: limited,
      }),
    ).toEqual(["service.a.value"]);
    expect(logQuery.mock.calls.length).toBe(2);
  });

  test("callers with different scopes are cached apart; the same scope shares its entry", async () => {
    logQuery.mockResolvedValue(dbResult([{ attributeValue: "GET" }]));

    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
      serviceFilter: { serviceIds: [serviceA, serviceB] },
    });
    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
      serviceFilter: { serviceIds: [serviceB] },
    });
    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
      serviceFilter: { excludedServiceIds: [serviceB] },
    });

    // Three scopes, three entries, three reads.
    expect(cache.size).toBe(3);
    expect(logQuery.mock.calls.length).toBe(3);
    for (const key of cache.keys()) {
      expect(key).toContain(":scope:");
      // The cache key names no resource id outright.
      expect(key).not.toContain(serviceA.toString());
      expect(key).not.toContain(serviceB.toString());
    }

    // The same services in another order are the same scope: served from the cache.
    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
      serviceFilter: { serviceIds: [serviceB, serviceA] },
    });
    expect(logQuery.mock.calls.length).toBe(3);
  });

  test("a search is answered from a finished load in the caller's own scope only", async () => {
    // Every value the key has across the project.
    logQuery.mockResolvedValue(
      finishedDbResult([{ attributeValue: "GET" }, { attributeValue: "POST" }]),
    );
    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
    });

    // The limited caller's search reads their services' rows instead.
    logQuery.mockResolvedValue(dbResult([{ attributeValue: "PUT" }]));
    expect(
      await TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
        searchText: "P",
        serviceFilter: limited,
      }),
    ).toEqual(["PUT"]);
    expect(logQuery.mock.calls.length).toBe(2);

    // Once their own unfiltered load has finished, it answers their searches.
    logQuery.mockResolvedValue(
      finishedDbResult([
        { attributeValue: "PATCH" },
        { attributeValue: "PUT" },
      ]),
    );
    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "http.method",
      serviceFilter: limited,
    });
    expect(
      await TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
        searchText: "PA",
        serviceFilter: limited,
      }),
    ).toEqual(["PATCH"]);
    expect(logQuery.mock.calls.length).toBe(3);
  });

  test("requests that arrive together share a load only within one scope", async () => {
    let open: () => void = (): void => {};
    const opened: Promise<void> = new Promise<void>((resolve: () => void) => {
      open = resolve;
    });
    logQuery.mockImplementation(
      async (statement: Statement): Promise<unknown> => {
        await opened;
        return dbResult([
          {
            attributeValue: statement.query.includes("primaryEntityId")
              ? "service.a.value"
              : "every.service.value",
          },
        ]);
      },
    );

    const pending: Promise<Array<Array<string>>> = Promise.all([
      TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
      }),
      TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
        serviceFilter: limited,
      }),
      TelemetryAttributeServiceInstance.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "http.method",
        serviceFilter: {
          serviceIds: [serviceA],
          excludedServiceIds: [serviceC],
        },
      }),
    ]);
    open();

    expect(await pending).toEqual([
      ["every.service.value"],
      ["service.a.value"],
      ["service.a.value"],
    ]);
    // One load for the project, one shared by the two limited callers.
    expect(logQuery.mock.calls.length).toBe(2);
  });
});

describe("metrics recorded by the platform follow the same scope", () => {
  const MUTABLE_METRIC_NAME: string = "oneuptime.incident.time_to_resolve";

  test("their keys and values are read from the caller's services' rows only", async () => {
    const mutableQuery: Spy = spyOn(MutableMetricService, "executeQuery");
    mutableQuery.mockResolvedValue(dbResult([{ keys: [] }]));

    await TelemetryAttributeServiceInstance.fetchAttributes({
      projectId,
      telemetryType: TelemetryType.Metric,
      metricName: MUTABLE_METRIC_NAME,
      serviceFilter: limited,
    });

    let statement: Statement = lastStatement(mutableQuery);
    expect(statement.query).toContain("primaryEntityId IN (");
    expect(statement.query).toContain("primaryEntityId NOT IN (");

    mutableQuery.mockResolvedValue(dbResult([]));

    await TelemetryAttributeServiceInstance.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Metric,
      metricName: MUTABLE_METRIC_NAME,
      attributeKey: "incident.severity",
      serviceFilter: limited,
    });

    statement = lastStatement(mutableQuery);
    expect(statement.query).toContain("primaryEntityId IN (");
    expect(statement.query).toContain("primaryEntityId NOT IN (");
  });
});
