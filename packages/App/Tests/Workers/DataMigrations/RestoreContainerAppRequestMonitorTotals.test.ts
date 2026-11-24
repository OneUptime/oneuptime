import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MonitorFeedEventType } from "Common/Models/DatabaseModels/MonitorFeed";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { Gray500 } from "Common/Types/BrandColors";
import { getAzureStoredMetricName } from "Common/Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RestoreContainerAppRequestMonitorTotals from "../../../FeatureSet/Workers/DataMigrations/RestoreContainerAppRequestMonitorTotals";
import RestoreNamespaceMetricMonitorTotals from "../../../FeatureSet/Workers/DataMigrations/RestoreNamespaceMetricMonitorTotals";
import fs from "fs";
import path from "path";

/*
 * RestoreContainerAppRequestMonitorTotals (#10837): a Metrics monitor on a
 * Container App's requests that read them with the average read the app's
 * number while the Azure connection read Requests whole, and the average
 * status code category since it reads them split by statusCodeCategory.
 * The migration moves each such query, read a minute at a time, to the
 * catalog's Sum - the app's requests again - and says so in the monitor's
 * feed. It shares its loop with RestoreNamespaceMetricMonitorTotals
 * (RestoreCloudResourceMonitorTotals): pinned here are what is moved -
 * only a Container App's requests, never a namespace's queries, which the
 * namespace migration moves in its own words, and the other way round -
 * the feed entry, and that a second run moves nothing.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "RestoreContainerAppRequestMonitorTotals";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT_ID: string = "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c";
const SUBSCRIPTION: string = "3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b";

const MONITOR_A: string = "0a7d3c1e-1b2c-4d3e-8f4a-5b6c7d8e9f01";
const MONITOR_B: string = "0b8e4d2f-2c3d-4e4f-9a5b-6c7d8e9f0a12";
const MONITOR_C: string = "0c9f5e3a-3d4e-4f5a-8b6c-7d8e9f0a1b23";

function azureId(type: string, name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${type}/${name}`;
}

const CART: string = azureId("Microsoft.App/containerApps", "cart");
const CHECKOUT: string = azureId("Microsoft.App/containerApps", "checkout");
const SHOP: string = azureId("Microsoft.ServiceBus/namespaces", "shop");

const REQUESTS: string = getAzureStoredMetricName("Requests", "total");
const RESPONSE_TIME: string = getAzureStoredMetricName(
  "ResponseTime",
  "average",
);
const MESSAGES_IN: string = getAzureStoredMetricName(
  "IncomingMessages",
  "total",
);

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

function query(data: {
  variable: string;
  metricName: string;
  resourceId: string;
  aggregationType?: AggregationType | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.variable,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: { "azuremonitor.resource_id": data.resourceId },
        aggregateBy: {},
        ...(data.aggregationType
          ? { aggegationType: data.aggregationType }
          : {}),
      },
    },
  } as MetricQueryConfigData;
}

function metricMonitor(
  queries: Array<MetricQueryConfigData>,
  rollingTime: RollingTime = RollingTime.Past15Minutes,
): MonitorStepMetricMonitor {
  return {
    metricViewConfig: { queryConfigs: queries, formulaConfigs: [] },
    rollingTime,
  };
}

const STATUS_IDS: {
  online: ObjectID;
  offline: ObjectID;
  incident: ObjectID;
  alert: ObjectID;
} = {
  online: new ObjectID("5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  offline: new ObjectID("6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e"),
  incident: new ObjectID("7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f"),
  alert: new ObjectID("8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a"),
};

function metricStep(monitor: MonitorStepMetricMonitor): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "cart",
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: STATUS_IDS.online,
    offlineMonitorStatusId: STATUS_IDS.offline,
    defaultIncidentSeverityId: STATUS_IDS.incident,
    defaultAlertSeverityId: STATUS_IDS.alert,
  });

  step.setMetricMonitor(monitor);

  return step;
}

// Monitor steps as the database holds them and hands them back.
function storedOf(monitors: Array<MonitorStepMetricMonitor>): JSONObject {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(monitors.map(metricStep));
  monitorSteps.setDefaultMonitorStatusId(STATUS_IDS.online);

  return JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject;
}

// Each step's queries' aggregations, as stored monitor steps say.
function aggregationsOf(json: JSONObject): Array<Array<unknown>> {
  return MonitorSteps.fromJSON(json).data!.monitorStepsInstanceArray.map(
    (step: MonitorStep): Array<unknown> => {
      return (
        step.data?.metricMonitor?.metricViewConfig.queryConfigs || []
      ).map((config: MetricQueryConfigData): unknown => {
        return config.metricQueryData.filterData.aggegationType;
      });
    },
  );
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StoredRow {
  _id: string;
  projectId: string;
  monitorType: string;
  monitorSteps: unknown;
}

interface StubbedTable {
  statements: Array<Statement>;
  rows: Array<StoredRow>;
  failUpdatesFor: Set<string>;
}

function sameJSON(a: unknown, b: unknown): boolean {
  const parsed: (value: unknown) => unknown = (value: unknown): unknown => {
    return typeof value === "string" ? JSON.parse(value) : value;
  };

  return JSON.stringify(parsed(a)) === JSON.stringify(parsed(b));
}

/*
 * Answers the migration's SELECT from `rows` as Postgres would - the
 * monitor type it asks for, steps whose text matches its LIKE, paged by id
 * - and its UPDATE only while the row holds what the statement read.
 */
function stubTable(): StubbedTable {
  const table: StubbedTable = {
    statements: [],
    rows: [],
    failUpdatesFor: new Set<string>(),
  };

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      table.statements.push(statement);

      if (statement.sql.startsWith("SELECT")) {
        const limit: number = statement.parameters[0] as number;
        const monitorType: string = statement.parameters[1] as string;
        const like: string = statement.parameters[2] as string;
        const after: string | undefined = statement.parameters[3] as
          | string
          | undefined;
        const contains: string = like.slice(1, -1);

        return table.rows
          .filter((row: StoredRow) => {
            const text: string = JSON.stringify(row.monitorSteps);

            return (
              row.monitorSteps !== null &&
              row.monitorType === monitorType &&
              text.includes(contains) &&
              (!after || row._id > after)
            );
          })
          .sort((a: StoredRow, b: StoredRow) => {
            return a._id < b._id ? -1 : 1;
          })
          .slice(0, limit);
      }

      const id: string = statement.parameters[1] as string;

      if (table.failUpdatesFor.has(id)) {
        throw new Error("could not write");
      }

      const row: StoredRow | undefined = table.rows.find(
        (candidate: StoredRow) => {
          return candidate._id === id;
        },
      );
      const holdsWhatWasRead: boolean =
        Boolean(row) && sameJSON(row!.monitorSteps, statement.parameters[2]);

      if (holdsWhatWasRead) {
        row!.monitorSteps = JSON.parse(statement.parameters[0] as string);
      }

      const written: Array<{ _id: string }> = holdsWhatWasRead
        ? [{ _id: id }]
        : [];

      return [written, written.length];
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: { query },
    } as never);

  return table;
}

function updatesOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("UPDATE");
  });
}

interface FeedCall {
  monitorId: ObjectID;
  projectId: ObjectID;
  monitorFeedEventType: MonitorFeedEventType;
  displayColor: unknown;
  feedInfoInMarkdown: string;
}

function row(
  id: string,
  monitorSteps: unknown,
  monitorType: MonitorType = MonitorType.Metrics,
): StoredRow {
  return { _id: id, projectId: PROJECT_ID, monitorType, monitorSteps };
}

describe("RestoreContainerAppRequestMonitorTotals", () => {
  const migration: RestoreContainerAppRequestMonitorTotals =
    new RestoreContainerAppRequestMonitorTotals();

  let monitors: StubbedTable;
  let feed: Array<FeedCall>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    monitors = stubTable();
    feed = [];
    jest
      .spyOn(MonitorFeedService, "createMonitorFeedItem")
      .mockImplementation(async (data: unknown): Promise<void> => {
        feed.push(data as FeedCall);
      });
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts, once, after the namespace migration and before the last slots", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(
        instantiations.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        instantiations.indexOf("RestoreNamespaceMetricMonitorTotals"),
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 2,
      );
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("rollback changes nothing", async () => {
      await migration.rollback();

      expect(monitors.statements).toHaveLength(0);
    });
  });

  describe("what it writes", () => {
    test("a Container App's requests read with the average, by the minute, read their Sum; its response time keeps its average", async () => {
      const before: JSONObject = storedOf([
        metricMonitor([
          query({
            variable: "requests",
            metricName: REQUESTS,
            resourceId: CART,
            aggregationType: AggregationType.Avg,
          }),
          query({
            variable: "latency",
            metricName: RESPONSE_TIME,
            resourceId: CART,
            aggregationType: AggregationType.Avg,
          }),
        ]),
      ]);
      monitors.rows = [row(MONITOR_A, before)];

      await migration.migrate();

      const updates: Array<Statement> = updatesOf(monitors);

      expect(updates).toHaveLength(1);
      expect(updates[0]!.parameters[1]).toBe(MONITOR_A);
      expect(JSON.parse(updates[0]!.parameters[2] as string)).toEqual(before);
      expect(
        aggregationsOf(
          JSON.parse(updates[0]!.parameters[0] as string) as JSONObject,
        ),
      ).toEqual([[AggregationType.Sum, AggregationType.Avg]]);
    });

    test("one stored with no aggregation, which read the average, is moved too; a window read in longer intervals is left", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({ variable: "a", metricName: REQUESTS, resourceId: CART }),
            ]),
          ]),
        ),
        row(
          MONITOR_B,
          storedOf([
            metricMonitor(
              [
                query({
                  variable: "a",
                  metricName: REQUESTS,
                  resourceId: CART,
                  aggregationType: AggregationType.Avg,
                }),
              ],
              RollingTime.Past12Hours,
            ),
          ]),
        ),
      ];

      await migration.migrate();

      expect(
        updatesOf(monitors).map((statement: Statement): unknown => {
          return statement.parameters[1];
        }),
      ).toEqual([MONITOR_A]);
    });

    test("a namespace's query is never moved by it, nor a Container App's by the namespace migration", async () => {
      const both: () => JSONObject = (): JSONObject => {
        return storedOf([
          metricMonitor([
            query({
              variable: "incoming",
              metricName: MESSAGES_IN,
              resourceId: SHOP,
              aggregationType: AggregationType.Avg,
            }),
            query({
              variable: "requests",
              metricName: REQUESTS,
              resourceId: CART,
              aggregationType: AggregationType.Avg,
            }),
          ]),
        ]);
      };

      monitors.rows = [row(MONITOR_A, both())];
      await migration.migrate();

      expect(
        aggregationsOf(monitors.rows[0]!.monitorSteps as JSONObject),
      ).toEqual([[AggregationType.Avg, AggregationType.Sum]]);

      monitors.rows = [row(MONITOR_B, both())];
      await new RestoreNamespaceMetricMonitorTotals().migrate();

      expect(
        aggregationsOf(monitors.rows[0]!.monitorSteps as JSONObject),
      ).toEqual([[AggregationType.Sum, AggregationType.Avg]]);
    });

    test("an aggregation someone picked is kept", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "a",
                metricName: REQUESTS,
                resourceId: CART,
                aggregationType: AggregationType.Max,
              }),
              query({
                variable: "b",
                metricName: REQUESTS,
                resourceId: CHECKOUT,
                aggregationType: AggregationType.Sum,
              }),
            ]),
          ]),
        ),
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
      expect(feed).toHaveLength(0);
    });

    test("a second run writes nothing", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "a",
                metricName: REQUESTS,
                resourceId: CART,
                aggregationType: AggregationType.Avg,
              }),
            ]),
          ]),
        ),
      ];

      await migration.migrate();
      monitors.statements = [];
      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
      expect(feed).toHaveLength(1);
    });

    test("keeps going after a row it cannot write, and says how many it moved", async () => {
      const steps: () => JSONObject = (): JSONObject => {
        return storedOf([
          metricMonitor([
            query({ variable: "a", metricName: REQUESTS, resourceId: CART }),
          ]),
        ]);
      };
      monitors.rows = [
        row(MONITOR_A, steps()),
        row(MONITOR_B, steps()),
        row(MONITOR_C, steps()),
      ];
      monitors.failUpdatesFor.add(MONITOR_B);

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(
        feed.map((call: FeedCall): string => {
          return call.monitorId.toString();
        }),
      ).toEqual([MONITOR_A, MONITOR_C]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: could not move monitor ${MONITOR_B}:`,
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: 2 monitor(s) read their Container App's requests as its total; 1 could not be written.`,
      );
    });
  });

  describe("what each moved monitor's feed says", () => {
    test("one entry per monitor written, in its own project, as an update, in the Container App's words", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "requests",
                metricName: REQUESTS,
                resourceId: CART,
                aggregationType: AggregationType.Avg,
              }),
            ]),
          ]),
        ),
      ];

      await migration.migrate();

      expect(feed).toHaveLength(1);
      expect(feed[0]!.monitorId.toString()).toBe(MONITOR_A);
      expect(feed[0]!.projectId.toString()).toBe(PROJECT_ID);
      expect(feed[0]!.monitorFeedEventType).toBe(
        MonitorFeedEventType.MonitorUpdated,
      );
      expect(feed[0]!.displayColor).toBe(Gray500);
      expect(feed[0]!.feedInfoInMarkdown).toBe(
        [
          "📊 **This monitor now reads the Container App's total requests.**",
          "",
          "Azure reports the requests of the Container App **cart** once per status code category, so their **Avg** is the average status code category. This monitor now reads `azure_requests_total` with **Sum**, which adds them up, as the Container App's **Metrics** tab does.",
          "",
          "Its criteria are unchanged.",
        ].join("\n"),
      );
    });

    test("names each Container App once, in the order its queries are", () => {
      const markdown: string =
        RestoreContainerAppRequestMonitorTotals.getFeedMarkdown(
          [CART, CART, CHECKOUT].map((resourceId: string, index: number) => {
            return {
              metricVariable: String.fromCharCode(97 + index),
              metricName: REQUESTS,
              resource: {
                provider: CloudProvider.Azure,
                type: "Microsoft.App/containerApps",
                name: resourceId.split("/").pop()!,
              },
              from: AggregationType.Avg,
              to: AggregationType.Sum,
            };
          }),
        ).toString();

      expect(markdown.split("\n\n")[0]).toBe(
        "📊 **This monitor now reads each Container App's total requests.**",
      );
      expect(
        markdown.split("\n\n").filter((line: string): boolean => {
          return line.startsWith("Azure reports");
        }),
      ).toEqual([
        "Azure reports the requests of the Container App **cart** once per status code category, so their **Avg** is the average status code category. This monitor now reads `azure_requests_total` with **Sum**, which adds them up, as the Container App's **Metrics** tab does.",
        "Azure reports the requests of the Container App **checkout** once per status code category, so their **Avg** is the average status code category. This monitor now reads `azure_requests_total` with **Sum**, which adds them up, as the Container App's **Metrics** tab does.",
      ]);
    });
  });
});
