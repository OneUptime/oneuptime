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
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  CloudAlertTemplate,
  getCloudAlertTemplate,
} from "Common/Types/Monitor/CloudAlertTemplates";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RestoreNamespaceMetricMonitorTotals, {
  NAMES_AN_AZURE_RESOURCE,
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/RestoreNamespaceMetricMonitorTotals";
import fs from "fs";
import path from "path";

/*
 * RestoreNamespaceMetricMonitorTotals (#6460): a Metrics monitor on a
 * Service Bus or Event Hubs namespace that read a metric with the average
 * read the namespace's number until #6415 split its metrics by queue, and
 * the average queue since. The migration moves each such query, read a
 * minute at a time, to the catalog's Sum - the namespace's number again -
 * and says so in the monitor's feed. Which queries move is pinned in
 * Common (MetricQueryCloudAggregation.test.ts); what the moved monitors
 * read against stored points in NamespaceMonitorTotalsClickhouse. Pinned
 * here: which rows are read, what is written and only while the row still
 * holds what was read, the feed entry of each row written, and that a
 * failing row holds no other back.
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

const MIGRATION_NAME: string = "RestoreNamespaceMetricMonitorTotals";

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

const SHOP: string = azureId("Microsoft.ServiceBus/namespaces", "shop");
const TELEMETRY: string = azureId("Microsoft.EventHub/namespaces", "telemetry");
const WEB_01: string = azureId("Microsoft.Compute/virtualMachines", "web-01");

const MESSAGES_IN: string = getAzureStoredMetricName(
  "IncomingMessages",
  "total",
);
const MESSAGES_WAITING: string = getAzureStoredMetricName(
  "ActiveMessages",
  "average",
);
const DEAD_LETTERED: string = getAzureStoredMetricName(
  "DeadletteredMessages",
  "average",
);
const SEND_LATENCY: string = getAzureStoredMetricName(
  "ServerSendLatency",
  "average",
);
const EVENTS_IN: string = getAzureStoredMetricName("IncomingMessages", "total");
const VM_CPU: string = getAzureStoredMetricName("Percentage CPU", "average");

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
  aggregatesWholeWindow: boolean = false,
): MonitorStepMetricMonitor {
  return {
    metricViewConfig: { queryConfigs: queries, formulaConfigs: [] },
    rollingTime,
    ...(aggregatesWholeWindow ? { aggregatesWholeWindow: true } : {}),
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
    monitorName: "shop",
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
function stored(steps: Array<MonitorStep>): JSONObject {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(steps);
  monitorSteps.setDefaultMonitorStatusId(STATUS_IDS.online);

  return JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject;
}

function storedOf(monitors: Array<MonitorStepMetricMonitor>): JSONObject {
  return stored(monitors.map(metricStep));
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

// The first step's first query's filter, in stored monitor steps.
function firstQueryFilterOf(json: JSONObject): JSONObject {
  const steps: Array<JSONObject> = (json["value"] as JSONObject)[
    "monitorStepsInstanceArray"
  ] as Array<JSONObject>;
  const metricMonitor: JSONObject = (steps[0]!["value"] as JSONObject)[
    "metricMonitor"
  ] as JSONObject;
  const queryConfigs: Array<JSONObject> = (
    metricMonitor["metricViewConfig"] as JSONObject
  )["queryConfigs"] as Array<JSONObject>;

  return (queryConfigs[0]!["metricQueryData"] as JSONObject)[
    "filterData"
  ] as JSONObject;
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
  // Rows saved by someone else between the migration's read and its write.
  savedMeanwhile: Set<string>;
  // How the driver hands back an UPDATE ... RETURNING.
  returning: "pg" | "rows";
}

function sameJSON(a: unknown, b: unknown): boolean {
  const parsed: (value: unknown) => unknown = (value: unknown): unknown => {
    return typeof value === "string" ? JSON.parse(value) : value;
  };

  return JSON.stringify(parsed(a)) === JSON.stringify(parsed(b));
}

/*
 * Answers the migration's SELECT from `rows` - the monitor type it asks
 * for, steps whose text matches its LIKE, paged by id as Postgres would -
 * and its UPDATE as Postgres would: only while the row holds what the
 * statement says it read, then handing back the row it wrote.
 */
function stubTable(): StubbedTable {
  const table: StubbedTable = {
    statements: [],
    rows: [],
    failUpdatesFor: new Set<string>(),
    savedMeanwhile: new Set<string>(),
    returning: "pg",
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
            const text: string =
              typeof row.monitorSteps === "string"
                ? row.monitorSteps
                : JSON.stringify(row.monitorSteps);

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
        Boolean(row) &&
        !table.savedMeanwhile.has(id) &&
        sameJSON(row!.monitorSteps, statement.parameters[2]);

      if (holdsWhatWasRead) {
        row!.monitorSteps = JSON.parse(statement.parameters[0] as string);
      }

      const written: Array<{ _id: string }> = holdsWhatWasRead
        ? [{ _id: id }]
        : [];

      return table.returning === "pg" ? [written, written.length] : written;
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

function selectsOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("SELECT");
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

describe("RestoreNamespaceMetricMonitorTotals", () => {
  const migration: RestoreNamespaceMetricMonitorTotals =
    new RestoreNamespaceMetricMonitorTotals();

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

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("is registered exactly once, before the last slot, which AddAuditLogMcpClientColumns keeps", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(
        instantiations.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 1,
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

  describe("what it reads", () => {
    test("only Metrics monitors whose steps name an Azure resource", async () => {
      await migration.migrate();

      const selects: Array<Statement> = selectsOf(monitors);

      expect(selects).toHaveLength(1);
      expect(selects[0]!.sql).toBe(
        `SELECT "_id", "projectId", "monitorSteps" FROM "Monitor" WHERE "monitorSteps" IS NOT NULL AND "monitorType" = $2 AND "monitorSteps"::text LIKE $3 ORDER BY "_id" ASC LIMIT $1`,
      );
      expect(selects[0]!.parameters).toEqual([
        PAGE_SIZE,
        MonitorType.Metrics,
        '%"azuremonitor.resource_id"%',
      ]);
      expect(NAMES_AN_AZURE_RESOURCE).toBe('%"azuremonitor.resource_id"%');
    });

    test("an Azure resource's monitor of another type is never read", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "a",
                metricName: MESSAGES_IN,
                resourceId: SHOP,
                aggregationType: AggregationType.Avg,
              }),
            ]),
          ]),
          MonitorType.Logs,
        ),
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
      expect(feed).toHaveLength(0);
    });
  });

  describe("what it writes", () => {
    test("a count read with the average, by the minute, reads its Sum - only while the row holds what was read", async () => {
      const before: JSONObject = storedOf([
        metricMonitor([
          query({
            variable: "incoming",
            metricName: MESSAGES_IN,
            resourceId: SHOP,
            aggregationType: AggregationType.Avg,
          }),
        ]),
      ]);
      monitors.rows = [row(MONITOR_A, before)];

      await migration.migrate();

      const updates: Array<Statement> = updatesOf(monitors);

      expect(updates).toHaveLength(1);
      expect(updates[0]!.sql).toBe(
        `UPDATE "Monitor" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb RETURNING "_id"`,
      );
      expect(updates[0]!.parameters[1]).toBe(MONITOR_A);
      expect(JSON.parse(updates[0]!.parameters[2] as string)).toEqual(before);

      const after: JSONObject = JSON.parse(
        updates[0]!.parameters[0] as string,
      ) as JSONObject;

      expect(aggregationsOf(after)).toEqual([[AggregationType.Sum]]);

      // Nothing else of the steps changed: the criteria, the window, the ids.
      const expected: JSONObject = JSON.parse(JSON.stringify(before));
      firstQueryFilterOf(expected)["aggegationType"] = AggregationType.Sum;
      expect(after).toEqual(expected);
    });

    test("monitors on a count, an amount held and a latency: the first two read their total, the latency its average", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "incoming",
                metricName: MESSAGES_IN,
                resourceId: SHOP,
              }),
            ]),
            metricMonitor(
              [
                query({
                  variable: "waiting",
                  metricName: MESSAGES_WAITING,
                  resourceId: SHOP,
                  aggregationType: AggregationType.Avg,
                }),
              ],
              RollingTime.Past1Hour,
            ),
            metricMonitor([
              query({
                variable: "latency",
                metricName: SEND_LATENCY,
                resourceId: SHOP,
                aggregationType: AggregationType.Avg,
              }),
            ]),
          ]),
        ),
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(
        aggregationsOf(monitors.rows[0]!.monitorSteps as JSONObject),
      ).toEqual([
        [AggregationType.Sum],
        [AggregationType.Sum],
        [AggregationType.Avg],
      ]);
    });

    test("leaves alone what no aggregation restores, and what someone picked", async () => {
      const untouched: Array<StoredRow> = [
        // Messages waiting over 6 hours: read in 5-minute intervals.
        row(
          MONITOR_A,
          storedOf([
            metricMonitor(
              [
                query({
                  variable: "waiting",
                  metricName: MESSAGES_WAITING,
                  resourceId: SHOP,
                  aggregationType: AggregationType.Avg,
                }),
              ],
              RollingTime.Past6Hours,
            ),
          ]),
        ),
        // A count read whole, and a Max of an amount held.
        row(
          MONITOR_B,
          storedOf([
            metricMonitor(
              [
                query({
                  variable: "incoming",
                  metricName: MESSAGES_IN,
                  resourceId: SHOP,
                  aggregationType: AggregationType.Avg,
                }),
              ],
              RollingTime.Past15Minutes,
              true,
            ),
            metricMonitor([
              query({
                variable: "dead",
                metricName: DEAD_LETTERED,
                resourceId: SHOP,
                aggregationType: AggregationType.Max,
              }),
            ]),
          ]),
        ),
        // Another Azure resource's metric.
        row(
          MONITOR_C,
          storedOf([
            metricMonitor([
              query({
                variable: "cpu",
                metricName: VM_CPU,
                resourceId: WEB_01,
                aggregationType: AggregationType.Avg,
              }),
            ]),
          ]),
        ),
      ];
      const before: string = JSON.stringify(untouched);
      monitors.rows = untouched;

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
      expect(feed).toHaveLength(0);
      expect(JSON.stringify(monitors.rows)).toBe(before);
    });

    test("the monitors OneUptime recommends for a namespace are left as they are", async () => {
      const args: {
        cloudResourceId: string;
        telemetryAttributes: Dictionary<string>;
        onlineMonitorStatusId: ObjectID;
        offlineMonitorStatusId: ObjectID;
        defaultIncidentSeverityId: ObjectID;
        defaultAlertSeverityId: ObjectID;
        monitorName: string;
      } = {
        cloudResourceId: "9e5f6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b",
        telemetryAttributes: { "azuremonitor.resource_id": SHOP },
        onlineMonitorStatusId: STATUS_IDS.online,
        offlineMonitorStatusId: STATUS_IDS.offline,
        defaultIncidentSeverityId: STATUS_IDS.incident,
        defaultAlertSeverityId: STATUS_IDS.alert,
        monitorName: "shop",
      };
      const templates: Array<CloudAlertTemplate> = [
        "cloud-azure-messaging-dead-lettered",
        "cloud-azure-messaging-server-errors",
        "cloud-azure-messaging-throttled",
      ].map((id: string): CloudAlertTemplate => {
        return getCloudAlertTemplate(id)!;
      });

      monitors.rows = templates.map(
        (template: CloudAlertTemplate, index: number): StoredRow => {
          return row(
            [MONITOR_A, MONITOR_B, MONITOR_C][index]!,
            stored([template.getMonitorStep(args)]),
          );
        },
      );

      await migration.migrate();

      expect(selectsOf(monitors)).toHaveLength(1);
      expect(updatesOf(monitors)).toHaveLength(0);
    });

    test("reads a column handed back as text, and skips values that are not monitor steps or rows with no project", async () => {
      const steps: JSONObject = storedOf([
        metricMonitor([
          query({ variable: "a", metricName: MESSAGES_IN, resourceId: SHOP }),
        ]),
      ]);
      monitors.rows = [
        row(MONITOR_A, JSON.stringify(steps)),
        row(MONITOR_B, `not json "azuremonitor.resource_id"`),
        { ...row(MONITOR_C, steps), projectId: "" },
      ];

      await migration.migrate();

      expect(
        updatesOf(monitors).map((statement: Statement) => {
          return statement.parameters[1];
        }),
      ).toEqual([MONITOR_A]);
    });

    test("a row saved since it was read is left to that save, and gets no feed entry", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "a",
                metricName: MESSAGES_IN,
                resourceId: SHOP,
                aggregationType: AggregationType.Avg,
              }),
            ]),
          ]),
        ),
      ];
      monitors.savedMeanwhile.add(MONITOR_A);

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(feed).toHaveLength(0);
      expect(
        aggregationsOf(monitors.rows[0]!.monitorSteps as JSONObject),
      ).toEqual([[AggregationType.Avg]]);
    });

    test("counts a written row however the driver hands it back", async () => {
      monitors.returning = "rows";
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "a",
                metricName: MESSAGES_IN,
                resourceId: SHOP,
              }),
            ]),
          ]),
        ),
        row(
          MONITOR_B,
          storedOf([
            metricMonitor([
              query({
                variable: "a",
                metricName: MESSAGES_IN,
                resourceId: SHOP,
              }),
            ]),
          ]),
        ),
      ];
      monitors.savedMeanwhile.add(MONITOR_B);

      await migration.migrate();

      expect(
        feed.map((call: FeedCall) => {
          return call.monitorId.toString();
        }),
      ).toEqual([MONITOR_A]);
    });
  });

  describe("what each moved monitor's feed says", () => {
    test("one entry per monitor written, in its own project, as an update", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "incoming",
                metricName: MESSAGES_IN,
                resourceId: SHOP,
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
          "📊 **This monitor reads its namespace's total.**",
          "",
          "Azure reports the metrics of the Service Bus Namespace **shop** once per queue, topic and event hub, so an average of them is the average queue. This monitor now reads `azure_incomingmessages_total` with **Sum**: the namespace's total, the number its **Metrics** tab shows.",
          "",
          "Its criteria are unchanged.",
        ].join("\n"),
      );
    });

    test("names each namespace once, with each of its metrics once", () => {
      const markdown: string =
        RestoreNamespaceMetricMonitorTotals.getFeedMarkdown([
          {
            metricVariable: "a",
            metricName: MESSAGES_IN,
            resource: {
              provider: CloudProvider.Azure,
              type: "Microsoft.ServiceBus/namespaces",
              name: "shop",
            },
            from: AggregationType.Avg,
            to: AggregationType.Sum,
          },
          {
            metricVariable: "b",
            metricName: MESSAGES_WAITING,
            resource: {
              provider: CloudProvider.Azure,
              type: "Microsoft.ServiceBus/namespaces",
              name: "shop",
            },
            from: undefined,
            to: AggregationType.Sum,
          },
          {
            metricVariable: "c",
            metricName: EVENTS_IN,
            resource: {
              provider: CloudProvider.Azure,
              type: "Microsoft.EventHub/namespaces",
              name: "telemetry",
            },
            from: AggregationType.Avg,
            to: AggregationType.Sum,
          },
          {
            metricVariable: "d",
            metricName: MESSAGES_IN,
            resource: {
              provider: CloudProvider.Azure,
              type: "Microsoft.ServiceBus/namespaces",
              name: "shop",
            },
            from: AggregationType.Avg,
            to: AggregationType.Sum,
          },
        ]).toString();

      expect(markdown.split("\n\n")).toEqual([
        "📊 **This monitor reads its namespace's total.**",
        "Azure reports the metrics of the Service Bus Namespace **shop** once per queue, topic and event hub, so an average of them is the average queue. This monitor now reads `azure_incomingmessages_total` and `azure_activemessages_average` with **Sum**: the namespace's total, the number its **Metrics** tab shows.",
        "Azure reports the metrics of the Event Hubs Namespace **telemetry** once per queue, topic and event hub, so an average of them is the average queue. This monitor now reads `azure_incomingmessages_total` with **Sum**: the namespace's total, the number its **Metrics** tab shows.",
        "Its criteria are unchanged.",
      ]);
    });

    test("a name that reads as Markdown reads as it was written", () => {
      const markdown: string =
        RestoreNamespaceMetricMonitorTotals.getFeedMarkdown([
          {
            metricVariable: "a",
            metricName: "azure_incomingmessages_total`",
            resource: {
              provider: CloudProvider.Azure,
              type: "Microsoft.ServiceBus/namespaces",
              name: "shop_*eu*[x](https://example.com)",
            },
            from: AggregationType.Avg,
            to: AggregationType.Sum,
          },
        ]).toString();

      expect(markdown).toContain(
        "**shop\\_\\*eu\\*\\[x\\](https://example.com)**",
      );
      expect(markdown).toContain("`` azure_incomingmessages_total` ``");
    });
  });

  describe("how it walks the table", () => {
    test("pages by id until a short page", async () => {
      const steps: JSONObject = storedOf([
        metricMonitor([
          query({ variable: "a", metricName: MESSAGES_IN, resourceId: SHOP }),
        ]),
      ]);
      monitors.rows = Array.from(
        { length: PAGE_SIZE + 3 },
        (_value: unknown, index: number): StoredRow => {
          return row(`row-${String(index).padStart(5, "0")}`, steps);
        },
      );

      await migration.migrate();

      const selects: Array<Statement> = selectsOf(monitors);

      expect(selects).toHaveLength(2);
      expect(selects[0]!.parameters).toHaveLength(3);
      expect(selects[1]!.sql).toBe(
        `SELECT "_id", "projectId", "monitorSteps" FROM "Monitor" WHERE "monitorSteps" IS NOT NULL AND "monitorType" = $2 AND "monitorSteps"::text LIKE $3 AND "_id" > $4 ORDER BY "_id" ASC LIMIT $1`,
      );
      expect(selects[1]!.parameters[3]).toBe(
        `row-${String(PAGE_SIZE - 1).padStart(5, "0")}`,
      );
      expect(updatesOf(monitors)).toHaveLength(PAGE_SIZE + 3);
    });

    test("keeps going after a row it cannot write or tell about", async () => {
      const steps: () => JSONObject = (): JSONObject => {
        return storedOf([
          metricMonitor([
            query({ variable: "a", metricName: MESSAGES_IN, resourceId: SHOP }),
          ]),
        ]);
      };
      monitors.rows = [
        row(MONITOR_A, steps()),
        row(MONITOR_B, steps()),
        row(MONITOR_C, steps()),
      ];
      monitors.failUpdatesFor.add(MONITOR_A);
      jest
        .spyOn(MonitorFeedService, "createMonitorFeedItem")
        .mockImplementation(async (data: unknown): Promise<void> => {
          if ((data as FeedCall).monitorId.toString() === MONITOR_B) {
            throw new Error("feed is down");
          }

          feed.push(data as FeedCall);
        });

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(
        updatesOf(monitors).map((statement: Statement) => {
          return statement.parameters[1];
        }),
      ).toEqual([MONITOR_A, MONITOR_B, MONITOR_C]);
      expect(
        feed.map((call: FeedCall) => {
          return call.monitorId.toString();
        }),
      ).toEqual([MONITOR_C]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        `RestoreNamespaceMetricMonitorTotals: could not move monitor ${MONITOR_A}:`,
      );
      expect(mockedLogger.error).toHaveBeenCalledWith(
        `RestoreNamespaceMetricMonitorTotals: could not tell monitor ${MONITOR_B}'s feed:`,
      );
      // B was written: it reads its total, though its feed missed the word.
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "RestoreNamespaceMetricMonitorTotals: 2 monitor(s) read their namespace's metrics as its total; 1 could not be written.",
      );
    });

    test("a second run writes nothing", async () => {
      monitors.rows = [
        row(
          MONITOR_A,
          storedOf([
            metricMonitor([
              query({
                variable: "a",
                metricName: MESSAGES_IN,
                resourceId: TELEMETRY,
                aggregationType: AggregationType.Avg,
              }),
            ]),
          ]),
        ),
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      monitors.statements = [];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
      expect(feed).toHaveLength(1);
    });
  });
});
