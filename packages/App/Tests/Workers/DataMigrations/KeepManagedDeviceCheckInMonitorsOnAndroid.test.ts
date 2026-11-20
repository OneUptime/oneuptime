import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MonitorFeedEventType } from "Common/Models/DatabaseModels/MonitorFeed";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import Includes from "Common/Types/BaseDatabase/Includes";
import { Gray500 } from "Common/Types/BrandColors";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  ManagedDeviceCheckInAttribute,
} from "Common/Types/DeviceManagement/ManagedDeviceCheckIn";
import { ManagedDevicePlatform } from "Common/Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "Common/Types/JSON";
import {
  ManagedDeviceAlertTemplate,
  getManagedDeviceAlertTemplateById,
} from "Common/Types/Monitor/ManagedDeviceAlertTemplates";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import KeepManagedDeviceCheckInMonitorsOnAndroid, {
  FEED_MARKDOWN,
  NAMES_THE_CHECK_IN_METRIC,
  PAGE_SIZE,
  pinCheckInQueriesToAndroid,
} from "../../../FeatureSet/Workers/DataMigrations/KeepManagedDeviceCheckInMonitorsOnAndroid";
import fs from "fs";
import path from "path";

/*
 * KeepManagedDeviceCheckInMonitorsOnAndroid (#9837): a monitor over a
 * device management connection's check-ins was made while a connection
 * imported Android devices only, so it reads every device of it. An Esper
 * connection now imports its Apple devices too, which check in hours apart:
 * the migration has each such monitor read the connection's Android devices,
 * which is every device it read when it was made. Pinned here: which queries
 * are pinned and which are left, what is written and only while the row
 * still holds what was read, the feed entry of each row written, that a
 * failing row holds no other back, and that a pinned monitor still covers
 * the recommendation it was made from.
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

const MIGRATION_NAME: string = "KeepManagedDeviceCheckInMonitorsOnAndroid";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT_ID: string = "6b1f0a3c-2d4e-4f5a-9b6c-7d8e9f0a1b2c";
const CONNECTION_ID: string = "3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b";

const MONITOR_A: string = "0a7d3c1e-1b2c-4d3e-8f4a-5b6c7d8e9f01";
const MONITOR_B: string = "0b8e4d2f-2c3d-4e4f-9a5b-6c7d8e9f0a12";
const MONITOR_C: string = "0c9f5e3a-3d4e-4f5a-8b6c-7d8e9f0a1b23";

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

function androidTemplate(): ManagedDeviceAlertTemplate {
  return getManagedDeviceAlertTemplateById("esper-device-stopped-checking-in")!;
}

// A step made from a template, as the Recommendations page makes it.
function templateStep(template: ManagedDeviceAlertTemplate): MonitorStep {
  return template.getMonitorStep({
    deviceManagementConnectionId: CONNECTION_ID,
    onlineMonitorStatusId: STATUS_IDS.online,
    offlineMonitorStatusId: STATUS_IDS.offline,
    defaultIncidentSeverityId: STATUS_IDS.incident,
    defaultAlertSeverityId: STATUS_IDS.alert,
    monitorName: "Esper acme - Esper Device Stopped Checking In",
  });
}

/*
 * The step a monitor made before #9837 holds: the Android template's, with
 * no platform in its query - what the template made then.
 */
function stepMadeBefore(): MonitorStep {
  const step: MonitorStep = templateStep(androidTemplate());
  const attributes: Record<string, unknown> = step.data!.metricMonitor!
    .metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
    .attributes as Record<string, unknown>;

  delete attributes[ManagedDeviceCheckInAttribute.Platform];

  return step;
}

// Monitor steps as the database holds them and hands them back.
function stored(steps: Array<MonitorStep>): JSONObject {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(steps);
  monitorSteps.setDefaultMonitorStatusId(STATUS_IDS.online);

  return JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject;
}

// Each step's first query's attribute filter, from stored monitor steps.
function attributesOf(json: JSONObject): Array<Record<string, unknown>> {
  return MonitorSteps.fromJSON(json).data!.monitorStepsInstanceArray.map(
    (step: MonitorStep): Record<string, unknown> => {
      return step.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
        .metricQueryData.filterData.attributes as Record<string, unknown>;
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
  savedMeanwhile: Set<string>;
}

function sameJSON(a: unknown, b: unknown): boolean {
  const parsed: (value: unknown) => unknown = (value: unknown): unknown => {
    return typeof value === "string" ? JSON.parse(value) : value;
  };

  return JSON.stringify(parsed(a)) === JSON.stringify(parsed(b));
}

/*
 * Answers the migration's SELECT from `rows` - the monitor type it asks
 * for, steps whose text matches its LIKE, paged by id - and its UPDATE as
 * Postgres would: only while the row holds what the statement read.
 */
function stubTable(): StubbedTable {
  const table: StubbedTable = {
    statements: [],
    rows: [],
    failUpdatesFor: new Set<string>(),
    savedMeanwhile: new Set<string>(),
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
        const contains: string = (statement.parameters[2] as string).slice(
          1,
          -1,
        );
        const after: string | undefined = statement.parameters[3] as
          | string
          | undefined;

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

function row(
  id: string,
  monitorSteps: unknown,
  monitorType: MonitorType = MonitorType.Metrics,
): StoredRow {
  return { _id: id, projectId: PROJECT_ID, monitorType, monitorSteps };
}

interface FeedCall {
  monitorId: ObjectID;
  projectId: ObjectID;
  monitorFeedEventType: MonitorFeedEventType;
  displayColor: unknown;
  feedInfoInMarkdown: string;
}

describe("KeepManagedDeviceCheckInMonitorsOnAndroid", () => {
  const migration: KeepManagedDeviceCheckInMonitorsOnAndroid =
    new KeepManagedDeviceCheckInMonitorsOnAndroid();

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

    test("is imported and instantiated once, before the two slots that stay last", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(
        instantiations.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations[instantiations.length - 2]).toBe(
        "BackfillIncidentCallTranscriptSignInAccount",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 2,
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("which queries it pins", () => {
    test("a query of the check-in metric that names a connection and no platform reads the Android devices", () => {
      const monitor: Record<string, unknown> = JSON.parse(
        JSON.stringify(stepMadeBefore().data!.metricMonitor),
      );

      expect(pinCheckInQueriesToAndroid(monitor)).toBe(1);
      expect(
        (
          (monitor["metricViewConfig"] as JSONObject)[
            "queryConfigs"
          ] as Array<JSONObject>
        )[0]!["metricQueryData"],
      ).toMatchObject({
        filterData: {
          metricName: MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
          attributes: {
            [ManagedDeviceCheckInAttribute.ConnectionId]: CONNECTION_ID,
            [ManagedDeviceCheckInAttribute.IsHost]: "false",
            [ManagedDeviceCheckInAttribute.Platform]: "android",
          },
        },
      });
    });

    test("a query that names a platform already, any other metric, or no connection is left as it is", () => {
      const named: Record<string, unknown> = JSON.parse(
        JSON.stringify(
          templateStep(
            getManagedDeviceAlertTemplateById(
              "esper-apple-device-stopped-checking-in",
            )!,
          ).data!.metricMonitor,
        ),
      );
      const before: string = JSON.stringify(named);

      expect(pinCheckInQueriesToAndroid(named)).toBe(0);
      expect(JSON.stringify(named)).toBe(before);

      const other: Record<string, unknown> = JSON.parse(
        JSON.stringify(stepMadeBefore().data!.metricMonitor),
      );
      const filterData: JSONObject = (
        (
          (other["metricViewConfig"] as JSONObject)[
            "queryConfigs"
          ] as Array<JSONObject>
        )[0]!["metricQueryData"] as JSONObject
      )["filterData"] as JSONObject;

      filterData["metricName"] = "system.cpu.utilization";
      expect(pinCheckInQueriesToAndroid(other)).toBe(0);

      filterData["metricName"] = MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME;
      delete (filterData["attributes"] as JSONObject)[
        ManagedDeviceCheckInAttribute.ConnectionId
      ];
      expect(pinCheckInQueriesToAndroid(other)).toBe(0);

      expect(pinCheckInQueriesToAndroid({})).toBe(0);
      expect(
        pinCheckInQueriesToAndroid({ metricViewConfig: { queryConfigs: 7 } }),
      ).toBe(0);
    });

    test("a pinned monitor reads what the Android template reads, so it still covers that recommendation", () => {
      monitors.rows.push(row(MONITOR_A, stored([stepMadeBefore()])));

      return migration.migrate().then(() => {
        const pinned: MonitorStep = MonitorSteps.fromJSON(
          monitors.rows[0]!.monitorSteps as JSONObject,
        ).data!.monitorStepsInstanceArray[0]!;

        expect(
          MonitorRecommendationUtil.getFingerprintFromMonitorStep(pinned),
        ).toEqual(
          MonitorRecommendationUtil.getFingerprintFromMonitorStep(
            templateStep(androidTemplate()),
          ),
        );
      });
    });
  });

  describe("what it writes", () => {
    test("reads only Metrics monitors whose steps name the metric, a page at a time", async () => {
      await migration.migrate();

      const select: Statement = monitors.statements[0]!;

      expect(select.parameters).toEqual([
        PAGE_SIZE,
        MonitorType.Metrics,
        NAMES_THE_CHECK_IN_METRIC,
      ]);
      expect(NAMES_THE_CHECK_IN_METRIC).toBe(
        `%"${MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME}"%`,
      );
    });

    test("pins each monitor made before, writes it once, and tells its feed why", async () => {
      monitors.rows.push(row(MONITOR_A, stored([stepMadeBefore()])));
      monitors.rows.push(
        row(MONITOR_B, stored([templateStep(androidTemplate())])),
      );
      // A Logs monitor never reads the metric.
      monitors.rows.push(
        row(MONITOR_C, stored([stepMadeBefore()]), MonitorType.Logs),
      );

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(
        attributesOf(monitors.rows[0]!.monitorSteps as JSONObject)[0]![
          ManagedDeviceCheckInAttribute.Platform
        ],
      ).toBe(ManagedDevicePlatform.Android);
      expect(feed).toEqual([
        {
          monitorId: new ObjectID(MONITOR_A),
          projectId: new ObjectID(PROJECT_ID),
          monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
          displayColor: Gray500,
          feedInfoInMarkdown: FEED_MARKDOWN,
        },
      ]);
      expect(FEED_MARKDOWN).toContain("Android devices");
    });

    test("is idempotent: run again, it writes nothing", async () => {
      monitors.rows.push(row(MONITOR_A, stored([stepMadeBefore()])));

      await migration.migrate();
      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(feed).toHaveLength(1);
    });

    test("a monitor saved meanwhile is left as its owner saved it, and its feed says nothing", async () => {
      monitors.rows.push(row(MONITOR_A, stored([stepMadeBefore()])));
      monitors.savedMeanwhile.add(MONITOR_A);

      await migration.migrate();

      expect(
        attributesOf(monitors.rows[0]!.monitorSteps as JSONObject)[0]![
          ManagedDeviceCheckInAttribute.Platform
        ],
      ).toBeUndefined();
      expect(feed).toEqual([]);
    });

    test("a row that cannot be written holds no other back", async () => {
      monitors.rows.push(row(MONITOR_A, stored([stepMadeBefore()])));
      monitors.rows.push(row(MONITOR_B, stored([stepMadeBefore()])));
      monitors.failUpdatesFor.add(MONITOR_A);

      await migration.migrate();

      expect(
        attributesOf(monitors.rows[1]!.monitorSteps as JSONObject)[0]![
          ManagedDeviceCheckInAttribute.Platform
        ],
      ).toBe(ManagedDevicePlatform.Android);
      expect(feed).toHaveLength(1);
    });

    test("steps stored as text are read too", async () => {
      monitors.rows.push(
        row(MONITOR_A, JSON.stringify(stored([stepMadeBefore()]))),
      );

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
    });

    test("an Includes of platforms already named is not touched", async () => {
      const step: MonitorStep = stepMadeBefore();
      (
        step.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
          .metricQueryData.filterData.attributes as Record<string, unknown>
      )[ManagedDeviceCheckInAttribute.Platform] = new Includes(["ios"]);
      monitors.rows.push(row(MONITOR_A, stored([step])));

      await migration.migrate();

      expect(updatesOf(monitors)).toEqual([]);
    });
  });

  test("rollback changes nothing", async () => {
    await migration.rollback();

    expect(monitors.statements).toEqual([]);
  });
});
