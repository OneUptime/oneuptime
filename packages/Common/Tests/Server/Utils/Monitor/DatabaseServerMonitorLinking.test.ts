/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseServerEndpointService from "../../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorStepResourceIdentity from "../../../../Server/Utils/Monitor/MonitorStepResourceIdentity";
import SeriesResourceLabels, {
  AllResourceIdentityLabelKeys,
  DatabaseServerAddressLabelKeys,
  DatabaseServerPortLabelKeys,
  SeriesResourceRefs,
} from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import SeriesResourceLinker, {
  SeriesResolvedResourceIds,
} from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SqlDatabaseType from "../../../../Types/Monitor/SqlDatabaseType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The monitors people actually build for a database must land their alerts
 * and incidents on it. Before this, a database was linked ONLY through the
 * `oneuptime.database.server.id` stamp, which only engine-receiver telemetry
 * carries — so:
 *
 *   - the Database Health monitor the database's own Documentation tab points
 *     at opened incidents that never reached the database's Incidents tab;
 *   - a SQL Query monitor against it, likewise;
 *   - a Metrics monitor on `postgresql.backends` filtered by the obvious
 *     `server.address`, or a Traces monitor on client spans calling it, too.
 *
 * All of them name the database by the endpoint it listens on. These tests
 * pin that the endpoint is extracted from the monitor's own configuration,
 * canonicalized exactly like ingest does, and resolved through the project's
 * DatabaseServerEndpoint rows — and that series labels never do the same.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const DATABASE_A: string = "d0000000-0000-4000-8000-00000000000a";
const DATABASE_B: string = "d0000000-0000-4000-8000-00000000000b";

function monitorWithStep(
  monitorType: MonitorType,
  stepData: JSONObject,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = monitorType;
  monitor.projectId = PROJECT_ID;

  const step: MonitorStep = new MonitorStep();
  step.data = {
    ...step.data,
    ...stepData,
  } as MonitorStep["data"];

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };

  monitor.monitorSteps = steps;
  return monitor;
}

function refsFor(monitor: Monitor): SeriesResourceRefs {
  return MonitorStepResourceIdentity.extractResourceRefsFromMonitor({
    monitor: monitor,
  });
}

function databaseHealthMonitor(connection: JSONObject): Monitor {
  return monitorWithStep(MonitorType.Database, {
    databaseMonitor: {
      databaseType: SqlDatabaseType.PostgreSQL,
      port: 5432,
      databaseName: "orders",
      username: "monitor",
      password: "{{monitorSecrets.dbPassword}}",
      ...connection,
    },
  });
}

function metricMonitorWithQueries(
  queries: Array<{ metricName: string; attributes: JSONObject }>,
): Monitor {
  return monitorWithStep(MonitorType.Metrics, {
    metricMonitor: {
      metricViewConfig: {
        queryConfigs: queries.map(
          (query: { metricName: string; attributes: JSONObject }) => {
            return {
              metricQueryData: {
                filterData: {
                  metricName: query.metricName,
                  attributes: query.attributes,
                },
              },
            };
          },
        ),
        formulaConfigs: [],
      },
    },
  });
}

describe("probe monitors name the database they connect to", () => {
  test("a Database Health monitor names its host:port", () => {
    const refs: SeriesResourceRefs = refsFor(
      databaseHealthMonitor({ host: "db.prod.internal", port: 5432 }),
    );

    expect(refs.databaseServerEndpoints).toEqual(["db.prod.internal:5432"]);
    expect(MonitorStepResourceIdentity.isEmpty(refs)).toBe(false);
  });

  test("the host is canonicalized the way ingest keys endpoints", () => {
    expect(
      refsFor(databaseHealthMonitor({ host: "  DB.Prod.Internal.  " }))
        .databaseServerEndpoints,
    ).toEqual(["db.prod.internal:5432"]);
  });

  test("a SQL Query monitor names its host, with the engine's default port when none is given", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithStep(MonitorType.SQLQuery, {
        sqlMonitor: {
          databaseType: SqlDatabaseType.MySQL,
          host: "orders-mysql.internal",
          port: undefined,
          databaseName: "orders",
          query: "select 1",
        },
      }),
    );

    expect(refs.databaseServerEndpoints).toEqual([
      "orders-mysql.internal:3306",
    ]);
  });

  test("a SQL Server named instance is the server, not part of its host", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithStep(MonitorType.Database, {
        databaseMonitor: {
          databaseType: SqlDatabaseType.MicrosoftSqlServer,
          host: "sql.prod.internal\\REPORTING",
          port: 1433,
        },
      }),
    );

    expect(refs.databaseServerEndpoints).toEqual(["sql.prod.internal:1433"]);
  });

  test("an explicit non-default port is kept", () => {
    expect(
      refsFor(databaseHealthMonitor({ host: "pgbouncer.internal", port: 6432 }))
        .databaseServerEndpoints,
    ).toEqual(["pgbouncer.internal:6432"]);
  });

  test("a port typed as text is accepted", () => {
    expect(
      refsFor(
        databaseHealthMonitor({
          host: "db.prod.internal",
          port: "5433" as unknown as number,
        }),
      ).databaseServerEndpoints,
    ).toEqual(["db.prod.internal:5433"]);
  });

  test("a Kubernetes service name is expanded to its cluster DNS name", () => {
    expect(
      refsFor(databaseHealthMonitor({ host: "orders-db.shop.svc" }))
        .databaseServerEndpoints,
    ).toEqual(["orders-db.shop.svc.cluster.local:5432"]);
  });

  test("an IPv6 host is bracketed", () => {
    expect(
      refsFor(databaseHealthMonitor({ host: "2001:db8::5" }))
        .databaseServerEndpoints,
    ).toEqual(["[2001:db8::5]:5432"]);
  });

  test.each(["localhost", "127.0.0.1", "::1", "host.docker.internal"])(
    "a loopback / host-relative host (%s) names no database",
    (host: string) => {
      /*
       * "localhost:5432" is a different server for every probe, so it can
       * never identify one row — linking it would attach every probe's
       * local database to whichever row happened to own that string.
       */
      expect(
        refsFor(databaseHealthMonitor({ host: host })).databaseServerEndpoints,
      ).toEqual([]);
    },
  );

  test("a secret reference is never read as an address", () => {
    expect(
      refsFor(
        databaseHealthMonitor({ host: "{{monitorSecrets.productionDbHost}}" }),
      ).databaseServerEndpoints,
    ).toEqual([]);

    // A secret PORT still leaves a usable host, on the engine's default port.
    expect(
      refsFor(
        databaseHealthMonitor({
          host: "db.prod.internal",
          port: "{{monitorSecrets.dbPort}}" as unknown as number,
        }),
      ).databaseServerEndpoints,
    ).toEqual(["db.prod.internal:5432"]);
  });

  test.each([
    ["no connection block", {}],
    ["a null connection block", { databaseMonitor: null }],
    ["a numeric host", { databaseMonitor: { host: 42, port: 5432 } }],
    ["an object port", { databaseMonitor: { host: "db.prod", port: {} } }],
    ["an empty host", { databaseMonitor: { host: "   " } }],
  ])(
    "does not throw on malformed step JSON (%s)",
    (_label: string, stepData: JSONObject) => {
      expect(() => {
        return refsFor(monitorWithStep(MonitorType.Database, stepData));
      }).not.toThrow();
    },
  );

  test("a stray connection block on a non-database monitor is ignored", () => {
    expect(
      refsFor(
        monitorWithStep(MonitorType.Website, {
          databaseMonitor: { host: "db.prod.internal", port: 5432 },
        }),
      ).databaseServerEndpoints,
    ).toEqual([]);
  });
});

describe("metric and trace filters name a database by server.address", () => {
  test("a filter on server.address + db.system.name names that endpoint", () => {
    expect(
      refsFor(
        metricMonitorWithQueries([
          {
            metricName: "db.client.operation.duration",
            attributes: {
              "server.address": "orders-db.internal",
              "db.system.name": "postgresql",
            },
          },
        ]),
      ).databaseServerEndpoints,
    ).toEqual(["orders-db.internal:5432"]);
  });

  test("the filter's own port wins, numeric or text", () => {
    expect(
      refsFor(
        metricMonitorWithQueries([
          {
            metricName: "db.client.operation.duration",
            attributes: {
              "server.address": "orders-db.internal",
              "server.port": 6432,
              "db.system.name": "postgresql",
            },
          },
        ]),
      ).databaseServerEndpoints,
    ).toEqual(["orders-db.internal:6432"]);
  });

  test("a receiver metric's engine supplies the default port (resource.server.address)", () => {
    /*
     * The "obvious choice" the audit called out: a Metrics monitor on
     * postgresql.backends filtered by the Database Agent's resource
     * attribute, with no port or engine filter at all.
     */
    expect(
      refsFor(
        metricMonitorWithQueries([
          {
            metricName: "postgresql.backends",
            attributes: { "resource.server.address": "db.prod.internal" },
          },
        ]),
      ).databaseServerEndpoints,
    ).toEqual(["db.prod.internal:5432"]);
  });

  test("port and engine are read per query, never across queries", () => {
    const refs: SeriesResourceRefs = refsFor(
      metricMonitorWithQueries([
        {
          metricName: "redis.memory.used",
          attributes: { "server.address": "cache.internal" },
        },
        {
          metricName: "postgresql.backends",
          attributes: {
            "server.address": "db.prod.internal",
            "server.port": "5433",
          },
        },
      ]),
    );

    expect(refs.databaseServerEndpoints.sort()).toEqual([
      "cache.internal:6379",
      "db.prod.internal:5433",
    ]);
  });

  test("a Search or Includes matcher names no single server", () => {
    expect(
      refsFor(
        metricMonitorWithQueries([
          {
            metricName: "db.client.operation.duration",
            attributes: {
              "server.address": new Search("prod") as unknown as string,
            },
          },
          {
            metricName: "db.client.operation.duration",
            attributes: {
              "server.address": new Includes([
                "a.internal",
              ]) as unknown as string,
            },
          },
        ]),
      ).databaseServerEndpoints,
    ).toEqual([]);
  });

  test("a Traces monitor on client spans names the server they call", () => {
    expect(
      refsFor(
        monitorWithStep(MonitorType.Traces, {
          traceMonitor: {
            attributes: {
              "server.address": "orders-mysql.internal",
              "db.system.name": "mysql",
            },
            spanStatuses: [],
            spanName: "",
            telemetryServiceIds: [],
            entityKeys: [],
            lastXSecondsOfSpans: 300,
          },
        }),
      ).databaseServerEndpoints,
    ).toEqual(["orders-mysql.internal:3306"]);
  });

  test("a Logs monitor filtered by the database id stamp names that database", () => {
    const refs: SeriesResourceRefs = refsFor(
      monitorWithStep(MonitorType.Logs, {
        logMonitor: {
          attributes: {
            "oneuptime.database.server.id": DATABASE_A,
            "resource.oneuptime.database.server.id": "not-a-uuid",
          },
          body: "",
          severityTexts: [],
          telemetryServiceIds: [],
          lastXSecondsOfLogs: 300,
        },
      }),
    );

    expect(refs.databaseServerIds).toEqual([DATABASE_A]);
  });

  test("a metric filter on the database id still links by id (unchanged)", () => {
    expect(
      refsFor(
        metricMonitorWithQueries([
          {
            metricName: "postgresql.backends",
            attributes: { "oneuptime.database.server.id": DATABASE_A },
          },
        ]),
      ).databaseServerIds,
    ).toEqual([DATABASE_A]);
  });
});

describe("series labels never name a database by endpoint", () => {
  test("a series grouped by server.address yields no endpoint ref", () => {
    /*
     * `server.address` is the generic peer attribute of every HTTP client
     * span too, and maintenance suppression matches databases by id only —
     * linking a series by endpoint without suppressing it by endpoint is the
     * divergence SeriesResourceLabels exists to prevent.
     */
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs({
      "server.address": "db.prod.internal",
      "server.port": "5432",
      "db.system.name": "postgresql",
    });

    expect(refs.databaseServerEndpoints).toEqual([]);
    expect(refs.databaseServerIds).toEqual([]);
  });

  test("the endpoint keys are not resource-identity keys a script is barred from", () => {
    for (const key of [
      ...DatabaseServerAddressLabelKeys,
      ...DatabaseServerPortLabelKeys,
    ]) {
      expect(AllResourceIdentityLabelKeys).not.toContain(key);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Resolution: endpoints become DatabaseServer ids through the project's
 * DatabaseServerEndpoint rows.
 * ---------------------------------------------------------------------------
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyLike = any;

let endpointRows: Array<{ databaseServerId?: ObjectID | undefined }>;
let databaseRows: Array<{ _id: string }>;
let endpointSpy: SpyLike;
let databaseSpy: SpyLike;

beforeEach(() => {
  endpointRows = [];
  databaseRows = [];

  endpointSpy = jest
    .spyOn(DatabaseServerEndpointService, "findBy")
    .mockImplementation((): Promise<never> => {
      return Promise.resolve(endpointRows as never);
    });

  databaseSpy = jest
    .spyOn(DatabaseServerService, "findBy")
    .mockImplementation((): Promise<never> => {
      return Promise.resolve(databaseRows as never);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function refsWith(overrides: Partial<SeriesResourceRefs>): SeriesResourceRefs {
  return {
    ...MonitorStepResourceIdentity.emptyRefs(),
    ...overrides,
  };
}

describe("SeriesResourceLinker resolves database endpoints", () => {
  test("looks the endpoints up project-scoped, as root, and returns their databases", async () => {
    endpointRows = [{ databaseServerId: new ObjectID(DATABASE_A) }];

    const resolved: SeriesResolvedResourceIds =
      await SeriesResourceLinker.resolveResourceRefs({
        refs: refsWith({ databaseServerEndpoints: ["db.prod.internal:5432"] }),
        projectId: PROJECT_ID,
        nameMatch: "caseInsensitive",
      });

    expect(resolved.databaseServerIds).toEqual([DATABASE_A]);
    expect(endpointSpy).toHaveBeenCalledTimes(1);

    const call: {
      query: JSONObject;
      props: JSONObject;
    } = endpointSpy.mock.calls[0][0];

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect((call.query["endpoint"] as Includes).values).toEqual([
      "db.prod.internal:5432",
    ]);
    expect(call.props["isRoot"]).toBe(true);
  });

  test("unions endpoint matches with id-stamp matches, deduped", async () => {
    endpointRows = [
      { databaseServerId: new ObjectID(DATABASE_A) },
      { databaseServerId: new ObjectID(DATABASE_B) },
    ];
    databaseRows = [{ _id: DATABASE_A }];

    const resolved: SeriesResolvedResourceIds =
      await SeriesResourceLinker.resolveResourceRefs({
        refs: refsWith({
          databaseServerIds: [DATABASE_A],
          databaseServerEndpoints: ["a.internal:5432", "b.internal:6379"],
        }),
        projectId: PROJECT_ID,
        nameMatch: "exact",
      });

    expect(resolved.databaseServerIds.sort()).toEqual(
      [DATABASE_A, DATABASE_B].sort(),
    );
  });

  test("dedupes the endpoints it asks for", async () => {
    await SeriesResourceLinker.resolveResourceRefs({
      refs: refsWith({
        databaseServerEndpoints: ["a.internal:5432", "a.internal:5432", ""],
      }),
      projectId: PROJECT_ID,
      nameMatch: "exact",
    });

    expect(
      (endpointSpy.mock.calls[0][0].query["endpoint"] as Includes).values,
    ).toEqual(["a.internal:5432"]);
  });

  test("costs no lookup when the monitor names no endpoint", async () => {
    const resolved: SeriesResolvedResourceIds =
      await SeriesResourceLinker.resolveResourceRefs({
        refs: refsWith({}),
        projectId: PROJECT_ID,
        nameMatch: "exact",
      });

    expect(resolved.databaseServerIds).toEqual([]);
    expect(endpointSpy).not.toHaveBeenCalled();
    expect(databaseSpy).not.toHaveBeenCalled();
  });

  test("an endpoint nobody owns links nothing", async () => {
    endpointRows = [];

    const resolved: SeriesResolvedResourceIds =
      await SeriesResourceLinker.resolveResourceRefs({
        refs: refsWith({ databaseServerEndpoints: ["api.stripe.com:443"] }),
        projectId: PROJECT_ID,
        nameMatch: "exact",
      });

    expect(resolved.databaseServerIds).toEqual([]);
  });

  test("a row without a database id is skipped", async () => {
    endpointRows = [{}, { databaseServerId: new ObjectID(DATABASE_B) }];

    const resolved: SeriesResolvedResourceIds =
      await SeriesResourceLinker.resolveResourceRefs({
        refs: refsWith({ databaseServerEndpoints: ["b.internal:6379"] }),
        projectId: PROJECT_ID,
        nameMatch: "exact",
      });

    expect(resolved.databaseServerIds).toEqual([DATABASE_B]);
  });
});

describe("end to end: a Database Health monitor's incident lands on the database", () => {
  test("the monitor's host:port resolves to the database and attaches to the alert and incident", async () => {
    /*
     * THE reported scenario: the Documentation tab's "create a Database
     * Health monitor" link, a connection-saturation breach, and an incident
     * that never reached the database's Incidents tab or badge.
     */
    endpointRows = [{ databaseServerId: new ObjectID(DATABASE_A) }];

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: databaseHealthMonitor({
          host: "DB.Prod.Internal",
          port: 5432,
        }),
      });

    expect(resolved.databaseServerIds).toEqual([DATABASE_A]);
    expect(
      (endpointSpy.mock.calls[0][0].query["endpoint"] as Includes).values,
    ).toEqual(["db.prod.internal:5432"]);
    expect(endpointSpy.mock.calls[0][0].query["projectId"]).toBe(PROJECT_ID);

    const alert: Alert = new Alert();
    const incident: Incident = new Incident();

    SeriesResourceLinker.attachResolvedResources({
      model: alert,
      resolved: resolved,
    });
    SeriesResourceLinker.attachResolvedResources({
      model: incident,
      resolved: resolved,
    });

    expect(
      (alert.databaseServers || []).map((row: { _id?: string | undefined }) => {
        return String(row._id);
      }),
    ).toEqual([DATABASE_A]);
    expect(
      (incident.databaseServers || []).map(
        (row: { _id?: string | undefined }) => {
          return String(row._id);
        },
      ),
    ).toEqual([DATABASE_A]);
  });

  test("a failed endpoint lookup never blocks incident creation", async () => {
    endpointSpy.mockImplementation((): Promise<never> => {
      return Promise.reject(new Error("connection reset"));
    });

    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: databaseHealthMonitor({ host: "db.prod.internal" }),
      });

    expect(resolved).toEqual(MonitorResourceContextUtil.emptyContext());
  });

  test("a Database Health monitor on localhost costs no lookup at all", async () => {
    const resolved: SeriesResolvedResourceIds =
      await MonitorResourceContextUtil.resolveResourceContextForMonitor({
        monitor: databaseHealthMonitor({ host: "localhost" }),
      });

    expect(resolved).toEqual(MonitorResourceContextUtil.emptyContext());
    expect(endpointSpy).not.toHaveBeenCalled();
  });
});
