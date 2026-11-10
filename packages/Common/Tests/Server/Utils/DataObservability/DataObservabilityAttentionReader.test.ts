import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
/*
 * The spy type of the jest imported above; the global jest.SpiedFunction
 * does not accept what its jest.spyOn() returns.
 */
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataProduct from "../../../../Models/DatabaseModels/DataProduct";
import DataReconciliation from "../../../../Models/DatabaseModels/DataReconciliation";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetOwnerRuleService from "../../../../Server/Services/DataAssetOwnerRuleService";
import DataAssetOwnerTeamService from "../../../../Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../../../Server/Services/DataAssetOwnerUserService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataProductService from "../../../../Server/Services/DataProductService";
import DataReconciliationService from "../../../../Server/Services/DataReconciliationService";
import MonitorService from "../../../../Server/Services/MonitorService";
import DataObservabilityAttentionReader, {
  DataObservabilityAttention,
} from "../../../../Server/Utils/DataObservability/DataObservabilityAttentionReader";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import {
  DataObservabilityCollector,
  DataObservabilityOverviewAsset,
  DataObservabilityStoreSummary,
} from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealth,
  DataCheckHealthAnswer,
} from "../../../../Types/DataObservability/DataObservabilityAttention";
import { DataObservabilityAttribute } from "../../../../Types/DataObservability/DataObservabilityMetric";
import { DataCheckAttribute } from "../../../../Types/DataObservability/DataCheckMetric";
import { DataPipelineAttribute } from "../../../../Types/DataObservability/DataPipelineMetric";
import { DataProductStatus } from "../../../../Types/DataObservability/DataProductFreshness";
import { DataReconciliationStatus } from "../../../../Types/DataObservability/DataReconciliation";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  StoredRow,
  rowMatchesWhere,
} from "../../TestingUtils/InMemoryRepository";

/*
 * WHAT NEEDS SOMEONE, AS THE OVERVIEW READS IT.
 *
 * Every source of trouble Data Observability knows of becomes one item:
 * a database it could not read, a pipeline whose last run failed or that
 * has not started when it usually does, a check whose alert is open or
 * whose query could not run, a reconciliation whose sides disagree, a data
 * product past its promise, a late table. These rows are a project's own,
 * in memory; the services read them as the database would. Alerts are
 * read with their reader's privacy clause, read here as Postgres reads it
 * (passesPrivacyClause): a check whose only open alert is private to
 * others is not failing to them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-10T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function id(suffix: string): string {
  return `22222222-2222-4222-8222-${suffix.padStart(12, "0")}`;
}

const STORE_FAILED: string = id("1");
const STORE_OK: string = id("2");
const STORE_UNWATCHED: string = id("3");

const TABLE_LATE: string = id("101");
const TABLE_CHECKED: string = id("102");

const PIPELINE_FAILED: string = id("201");
const PIPELINE_RETIRED: string = id("202");
const PIPELINE_LATE: string = id("203");
const PIPELINE_ON_TIME: string = id("204");

const CHECK_FAILING: string = id("301");
const CHECK_COULD_NOT_RUN: string = id("302");
const CHECK_PASSING: string = id("303");
const CHECK_OFF: string = id("304");
const CHECK_PRIVATE: string = id("305");
const DBT_FAILING: string = id("306");

const MONITOR_FAILING: string = id("401");
const MONITOR_PASSING: string = id("402");
const MONITOR_OFF: string = id("403");
const MONITOR_PRIVATE: string = id("404");

const PRODUCT_LATE: string = id("501");
const RECONCILIATION_DRIFTED: string = id("601");
const RECONCILIATION_FAILED: string = id("602");

const CREATED: string = id("701");
const RESOLVED: string = id("702");

const ALERT_CHECK: string = id("801");
const ALERT_CHECK_PRIVATE: string = id("802");
const ALERT_TABLE_OLD: string = id("803");
const ALERT_TABLE_NEW: string = id("804");
const ALERT_TABLE_RESOLVED: string = id("805");
const ALERT_PIPELINE: string = id("806");
const ALERT_STORE_TABLE: string = id("807");
const ALERT_PASSING_RESOLVED: string = id("808");

// People of the project, and what each may do.
const OWNER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000002");
const ADMIN: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000003");
const TEAMMATE: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000004");

// Who owns the private alert: a person, and a team TEAMMATE is in.
const DIRECT_OWNERS: Record<string, Array<string>> = {
  [ALERT_CHECK_PRIVATE]: [OWNER.toString()],
};
const TEAM_OWNERS: Record<string, Array<string>> = {
  [ALERT_CHECK_PRIVATE]: [TEAMMATE.toString()],
};

function person(
  userId: ObjectID,
  permission: Permission,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

const OUTSIDER: DatabaseCommonInteractionProps = person(
  MEMBER,
  Permission.ProjectMember,
);
const ALERT_OWNER: DatabaseCommonInteractionProps = person(
  OWNER,
  Permission.ProjectMember,
);
const PROJECT_ADMIN: DatabaseCommonInteractionProps = person(
  ADMIN,
  Permission.ProjectAdmin,
);

// A record of the project, as the database hands it back.
function model<T>(Type: { new (): T }, fields: StoredRow): T {
  const row: T = new Type();

  for (const [column, value] of Object.entries({
    projectId: PROJECT_ID,
    ...fields,
  })) {
    (row as unknown as StoredRow)[column] = value;
  }

  return row;
}

function store(
  dataStoreId: string,
  fields: Partial<DataObservabilityStoreSummary>,
): DataObservabilityStoreSummary {
  return {
    dataStoreId,
    name: "",
    kind: "PostgreSQL",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: "2026-11-10T11:55:00.000Z",
    assetCount: 10,
    lateAssetCount: 0,
    alertMonitorCount: 5,
    ...fields,
  };
}

const STORES: Array<DataObservabilityStoreSummary> = [
  store(STORE_FAILED, {
    name: "warehouse",
    status: "Failed",
    message: "password authentication failed for user oneuptime_reader",
    collectedAt: "2026-11-10T11:00:00.000Z",
    alertMonitorCount: 0,
  }),
  store(STORE_OK, { name: "orders-db" }),
  // Not watched: its failure tells of nothing anyone asked for.
  store(STORE_UNWATCHED, {
    name: "archive",
    status: "Failed",
    isTableHealthEnabled: false,
  }),
];

const LATE_ASSETS: Array<DataObservabilityOverviewAsset> = [
  {
    dataAssetId: TABLE_LATE,
    assetKey: "public.payments",
    dataStoreId: STORE_OK,
    dataStoreName: "orders-db",
    lastChangedAt: "2026-11-10T06:00:00.000Z",
    updateIntervalInSeconds: 900,
    overdueBySeconds: 4 * 3600,
  },
];

let pipelines: Array<DataPipeline>;
let checks: Array<DataCheck>;
let products: Array<DataProduct>;
let reconciliations: Array<DataReconciliation>;
let alertRows: Array<StoredRow>;
let dataAlertRows: Array<StoredRow>;
let monitors: Array<Monitor>;
let alertReads: Array<{ query: Record<string, unknown> }>;
let checkQueries: Array<Record<string, unknown>>;
let monitorQueries: Array<Record<string, unknown>>;

function seed(): void {
  pipelines = [
    model(DataPipeline, {
      _id: PIPELINE_FAILED,
      jobName: "nightly_load",
      jobNamespace: "airflow",
      lastRunState: "FAIL",
      lastRunStartedAt: new Date(NOW.getTime() - 3 * HOUR),
      lastRunEndedAt: new Date(NOW.getTime() - 2 * HOUR),
      lastFailureAt: new Date(NOW.getTime() - 2 * HOUR),
      lastErrorMessage: "relation staging.orders does not exist",
    }),
    // Failed a month and more ago, and never ran again: retired, as lateness is.
    model(DataPipeline, {
      _id: PIPELINE_RETIRED,
      jobName: "old_export",
      lastRunState: "FAIL",
      lastRunStartedAt: new Date(NOW.getTime() - 40 * DAY),
    }),
    // Every hour, last started five hours ago.
    model(DataPipeline, {
      _id: PIPELINE_LATE,
      jobName: "hourly_rollup",
      jobNamespace: "dbt",
      lastRunState: "COMPLETE",
      lastRunStartedAt: new Date(NOW.getTime() - 5 * HOUR),
      expectedRunIntervalInSeconds: 3600,
    }),
    model(DataPipeline, {
      _id: PIPELINE_ON_TIME,
      jobName: "fresh_job",
      lastRunState: "COMPLETE",
      lastRunStartedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      expectedRunIntervalInSeconds: 3600,
    }),
  ];

  checks = [
    model(DataCheck, {
      _id: CHECK_FAILING,
      name: "no duplicate orders",
      checkType: DataCheckType.DuplicatePercent,
      dataAssetId: new ObjectID(TABLE_CHECKED),
      dataAsset: { assetKey: "public.orders" },
      isEnabled: true,
      lastRunAt: new Date(NOW.getTime() - HOUR),
      lastRunStatus: "Ran",
      monitorId: new ObjectID(MONITOR_FAILING),
    }),
    model(DataCheck, {
      _id: CHECK_COULD_NOT_RUN,
      name: "emails look like emails",
      checkType: DataCheckType.FormatMismatchPercent,
      dataAssetId: new ObjectID(TABLE_CHECKED),
      dataAsset: { assetKey: "public.orders" },
      isEnabled: true,
      lastRunAt: new Date(NOW.getTime() - HOUR),
      lastRunStatus: "Failed",
      lastRunMessage: 'column "email" does not exist',
    }),
    model(DataCheck, {
      _id: CHECK_PASSING,
      name: "rows arrive",
      checkType: DataCheckType.RowCount,
      dataAssetId: new ObjectID(TABLE_CHECKED),
      isEnabled: true,
      lastRunAt: new Date(NOW.getTime() - HOUR),
      lastRunStatus: "Ran",
      monitorId: new ObjectID(MONITOR_PASSING),
    }),
    // Off: its alert may still be open, but it does not run.
    model(DataCheck, {
      _id: CHECK_OFF,
      name: "turned off",
      checkType: DataCheckType.RowCount,
      dataAssetId: new ObjectID(TABLE_CHECKED),
      isEnabled: false,
      lastRunAt: new Date(NOW.getTime() - DAY),
      lastRunStatus: "Ran",
      monitorId: new ObjectID(MONITOR_OFF),
    }),
    // Its only open alert is private, owned by OWNER.
    model(DataCheck, {
      _id: CHECK_PRIVATE,
      name: "payroll totals",
      checkType: DataCheckType.CustomSql,
      dataAssetId: new ObjectID(TABLE_CHECKED),
      isEnabled: true,
      lastRunAt: new Date(NOW.getTime() - HOUR),
      lastRunStatus: "Ran",
      monitorId: new ObjectID(MONITOR_PRIVATE),
    }),
    // dbt decides: its Failed is the data failing the test.
    model(DataCheck, {
      _id: DBT_FAILING,
      name: "not_null_orders_id",
      checkType: DataCheckType.DbtTest,
      dataAssetId: new ObjectID(TABLE_CHECKED),
      isEnabled: true,
      lastRunAt: new Date(NOW.getTime() - 2 * HOUR),
      lastRunStatus: "Failed",
    }),
  ];

  products = [
    model(DataProduct, {
      _id: PRODUCT_LATE,
      name: "Finance dashboard",
      status: DataProductStatus.Late,
      statusChangedAt: new Date(NOW.getTime() - 3 * HOUR),
    }),
  ];

  reconciliations = [
    model(DataReconciliation, {
      _id: RECONCILIATION_DRIFTED,
      name: "orders: Postgres vs Snowflake",
      status: DataReconciliationStatus.Drifted,
      statusMessage: "The target has 1,204 rows fewer.",
      statusChangedAt: new Date(NOW.getTime() - HOUR),
    }),
    model(DataReconciliation, {
      _id: RECONCILIATION_FAILED,
      name: "payments copy",
      status: DataReconciliationStatus.Failed,
      statusMessage: "The target's check could not run.",
    }),
    model(DataReconciliation, {
      _id: id("603"),
      name: "in step",
      status: DataReconciliationStatus.InStep,
    }),
  ];

  const alert: (alertId: string, fields: StoredRow) => StoredRow = (
    alertId: string,
    fields: StoredRow,
  ): StoredRow => {
    return {
      _id: alertId,
      projectId: PROJECT_ID.toString(),
      isPrivate: false,
      currentAlertStateId: CREATED,
      ...fields,
    };
  };

  alertRows = [
    alert(ALERT_CHECK, {
      title: "no duplicate orders is failing",
      alertNumberWithPrefix: "ALT-7",
      monitorId: MONITOR_FAILING,
      createdAt: new Date(NOW.getTime() - HOUR),
    }),
    alert(ALERT_PASSING_RESOLVED, {
      title: "rows arrive was failing",
      alertNumberWithPrefix: "ALT-3",
      monitorId: MONITOR_PASSING,
      currentAlertStateId: RESOLVED,
      createdAt: new Date(NOW.getTime() - DAY),
    }),
    alert(id("809"), {
      title: "turned off is failing",
      alertNumberWithPrefix: "ALT-4",
      monitorId: MONITOR_OFF,
      createdAt: new Date(NOW.getTime() - DAY),
    }),
    alert(ALERT_CHECK_PRIVATE, {
      title: "Payroll totals do not add up",
      alertNumberWithPrefix: "ALT-8",
      monitorId: MONITOR_PRIVATE,
      isPrivate: true,
      createdAt: new Date(NOW.getTime() - HOUR),
    }),
    alert(ALERT_TABLE_OLD, {
      title: "public.payments is late",
      alertNumberWithPrefix: "ALT-10",
      createdAt: new Date(NOW.getTime() - 4 * HOUR),
    }),
    alert(ALERT_TABLE_NEW, {
      title: "public.payments row count fell",
      alertNumberWithPrefix: "ALT-11",
      createdAt: new Date(NOW.getTime() - HOUR),
    }),
    alert(ALERT_TABLE_RESOLVED, {
      title: "public.payments was late",
      alertNumberWithPrefix: "ALT-9",
      currentAlertStateId: RESOLVED,
      createdAt: new Date(NOW.getTime() - 5 * HOUR),
    }),
    alert(ALERT_PIPELINE, {
      title: "nightly_load failed",
      alertNumberWithPrefix: "ALT-12",
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
    }),
    // About a table of the failed store: not the store's own alert.
    alert(ALERT_STORE_TABLE, {
      title: "a table of warehouse is late",
      alertNumberWithPrefix: "ALT-13",
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
    }),
  ];

  // What each alert is about, newest first as the reader sorts them.
  dataAlertRows = [
    {
      alertId: ALERT_TABLE_NEW,
      dataAssetId: TABLE_LATE,
      dataStoreId: STORE_OK,
      createdAt: new Date(NOW.getTime() - HOUR),
    },
    {
      alertId: ALERT_TABLE_OLD,
      dataAssetId: TABLE_LATE,
      dataStoreId: STORE_OK,
      createdAt: new Date(NOW.getTime() - 4 * HOUR),
    },
    {
      alertId: ALERT_TABLE_RESOLVED,
      dataAssetId: TABLE_LATE,
      dataStoreId: STORE_OK,
      createdAt: new Date(NOW.getTime() - 5 * HOUR),
    },
    {
      alertId: ALERT_PIPELINE,
      dataPipelineId: PIPELINE_FAILED,
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
    },
    {
      alertId: ALERT_STORE_TABLE,
      dataAssetId: id("199"),
      dataStoreId: STORE_FAILED,
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
    },
  ].map((row: StoredRow): StoredRow => {
    return { projectId: PROJECT_ID.toString(), ...row };
  });

  monitors = [];
}

/*
 * Whether a row passes the alert privacy clause on its isPrivate column,
 * as Postgres reads it (Utils/Alert/AlertPrivacyFilter).
 */
function passesPrivacyClause(clause: unknown, row: StoredRow): boolean {
  if (clause === undefined) {
    return true;
  }

  if (!(clause instanceof FindOperator) || !clause.getSql) {
    throw new Error(`Not an alert privacy clause: ${String(clause)}`);
  }

  const sql: string = clause.getSql("c");
  const isPrivate: boolean = row["isPrivate"] === true;

  if (sql === "(c IS NULL OR c = FALSE)") {
    return !isPrivate;
  }

  const userIds: Array<string> = Object.values(
    (clause.objectLiteralParameters as Record<string, unknown>) || {},
  ).map(String);

  if (
    sql.startsWith("(c IS NULL OR c = FALSE OR ") &&
    sql.includes('"AlertOwnerUser"') &&
    sql.includes('"AlertOwnerTeam"') &&
    sql.includes('"TeamMember"') &&
    userIds.length === 1
  ) {
    const alertId: string = String(row["_id"]);

    return (
      !isPrivate ||
      (DIRECT_OWNERS[alertId] || []).includes(userIds[0]!) ||
      (TEAM_OWNERS[alertId] || []).includes(userIds[0]!)
    );
  }

  throw new Error(`An alert privacy clause this test does not read: ${sql}`);
}

// A query as the database reads it, with the Includes the services turn into IN.
function matchesQuery(row: StoredRow, query: Record<string, unknown>): boolean {
  for (const [column, wanted] of Object.entries(query)) {
    if (wanted instanceof Includes) {
      if (!wanted.values.map(String).includes(String(row[column]))) {
        return false;
      }
      continue;
    }

    if (!rowMatchesWhere(row, { [column]: wanted })) {
      return false;
    }
  }

  return true;
}

function asRow(record: unknown): StoredRow {
  return record as StoredRow;
}

function stubServices(): void {
  alertReads = [];
  checkQueries = [];
  monitorQueries = [];

  jest.spyOn(DataPipelineService, "findBy").mockImplementation((async () => {
    return pipelines;
  }) as never);

  jest.spyOn(DataCheckService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    checkQueries.push(findBy.query);
    return checks.filter((check: DataCheck): boolean => {
      return matchesQuery(asRow(check), findBy.query);
    });
  }) as never);

  jest.spyOn(DataProductService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    return products.filter((product: DataProduct): boolean => {
      return matchesQuery(asRow(product), findBy.query);
    });
  }) as never);

  jest
    .spyOn(DataReconciliationService, "findBy")
    .mockImplementation((async (findBy: { query: Record<string, unknown> }) => {
      return reconciliations.filter(
        (reconciliation: DataReconciliation): boolean => {
          return matchesQuery(asRow(reconciliation), findBy.query);
        },
      );
    }) as never);

  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([new ObjectID(CREATED)] as never);

  jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
    sort: Record<string, string>;
  }) => {
    alertReads.push({ query: findBy.query });

    const { isPrivate, ...rest } = findBy.query;
    const found: Array<StoredRow> = alertRows
      .filter((row: StoredRow): boolean => {
        return matchesQuery(row, rest) && passesPrivacyClause(isPrivate, row);
      })
      .sort((a: StoredRow, b: StoredRow): number => {
        return (
          (a["createdAt"] as Date).getTime() -
          (b["createdAt"] as Date).getTime()
        );
      });

    return found.map((row: StoredRow): Alert => {
      return model(Alert, {
        ...row,
        monitorId: row["monitorId"]
          ? new ObjectID(String(row["monitorId"]))
          : undefined,
      });
    });
  }) as never);

  jest.spyOn(DataAlertService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    return dataAlertRows
      .filter((row: StoredRow): boolean => {
        return matchesQuery(row, findBy.query);
      })
      .map((row: StoredRow): DataAlert => {
        return model(DataAlert, {
          alertId: new ObjectID(String(row["alertId"])),
          dataAssetId: row["dataAssetId"]
            ? new ObjectID(String(row["dataAssetId"]))
            : undefined,
          dataPipelineId: row["dataPipelineId"]
            ? new ObjectID(String(row["dataPipelineId"]))
            : undefined,
          dataStoreId: row["dataStoreId"]
            ? new ObjectID(String(row["dataStoreId"]))
            : undefined,
        });
      });
  }) as never);

  jest.spyOn(MonitorService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    monitorQueries.push(findBy.query);
    return monitors;
  }) as never);
}

async function read(
  reader: DatabaseCommonInteractionProps = PROJECT_ADMIN,
): Promise<DataObservabilityAttention> {
  return await DataObservabilityAttentionReader.read({
    projectId: PROJECT_ID,
    now: NOW,
    reader,
    stores: STORES,
    lateAssets: LATE_ASSETS,
  });
}

function kindsAndNames(
  items: Array<DataAttentionItem>,
): Array<[DataAttentionKind, string]> {
  return items.map((item: DataAttentionItem): [DataAttentionKind, string] => {
    return [item.kind, item.name];
  });
}

function find(
  items: Array<DataAttentionItem>,
  kind: DataAttentionKind,
): DataAttentionItem {
  const found: DataAttentionItem | undefined = items.find(
    (item: DataAttentionItem): boolean => {
      return item.kind === kind;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

beforeEach(() => {
  jest.restoreAllMocks();
  seed();
  stubServices();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what needs someone, worst first", () => {
  test("every source becomes items of its kind, in the order they are told", async () => {
    const attention: DataObservabilityAttention = await read();

    expect(kindsAndNames(attention.items)).toEqual([
      [DataAttentionKind.CollectionFailed, "warehouse"],
      [DataAttentionKind.PipelineFailed, "nightly_load"],
      // The failing checks: the longest failing first (dbt's, two hours), then by name.
      [DataAttentionKind.CheckFailing, "not_null_orders_id"],
      [DataAttentionKind.CheckFailing, "no duplicate orders"],
      [DataAttentionKind.CheckFailing, "payroll totals"],
      [
        DataAttentionKind.ReconciliationDrifted,
        "orders: Postgres vs Snowflake",
      ],
      [DataAttentionKind.DataProductLate, "Finance dashboard"],
      [DataAttentionKind.TableLate, "public.payments"],
      [DataAttentionKind.PipelineLate, "hourly_rollup"],
      [DataAttentionKind.CheckCouldNotRun, "emails look like emails"],
      [DataAttentionKind.ReconciliationCouldNotRun, "payments copy"],
    ]);
  });

  test("a database that could not be read says why, and when it was tried", async () => {
    const item: DataAttentionItem = find(
      (await read()).items,
      DataAttentionKind.CollectionFailed,
    );

    expect(item).toMatchObject({
      dataStoreId: STORE_FAILED,
      where: "PostgreSQL",
      message: "password authentication failed for user oneuptime_reader",
      since: "2026-11-10T11:00:00.000Z",
    });
  });

  test("a database nobody watches is not told of, failed or not", async () => {
    const names: Array<string> = (await read()).items.map(
      (item: DataAttentionItem): string => {
        return item.name;
      },
    );

    expect(names).not.toContain("archive");
  });

  test("a failed pipeline: its error and when it failed; one retired a month ago, not at all", async () => {
    const items: Array<DataAttentionItem> = (await read()).items;
    const failed: DataAttentionItem = find(
      items,
      DataAttentionKind.PipelineFailed,
    );

    expect(failed).toMatchObject({
      dataPipelineId: PIPELINE_FAILED,
      where: "airflow",
      message: "relation staging.orders does not exist",
      since: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    });
    expect(
      items.some((item: DataAttentionItem): boolean => {
        return item.dataPipelineId === PIPELINE_RETIRED;
      }),
    ).toBe(false);
  });

  test("a pipeline that has not started when it usually does: by how much, from when it was due", async () => {
    const late: DataAttentionItem = find(
      (await read()).items,
      DataAttentionKind.PipelineLate,
    );

    // Every hour, plus the least slack of fifteen minutes: due 1h15m after its last start.
    const due: Date = new Date(NOW.getTime() - 5 * HOUR + 75 * 60 * 1000);

    expect(late).toMatchObject({
      dataPipelineId: PIPELINE_LATE,
      where: "dbt",
      since: due.toISOString(),
      overdueBySeconds: (NOW.getTime() - due.getTime()) / 1000,
    });
  });

  test("a late table keeps its database, so the page can say whether anyone is told", async () => {
    const late: DataAttentionItem = find(
      (await read()).items,
      DataAttentionKind.TableLate,
    );

    expect(late).toMatchObject({
      dataAssetId: TABLE_LATE,
      dataStoreId: STORE_OK,
      where: "orders-db",
      overdueBySeconds: 4 * 3600,
    });
  });

  test("checks: failing with their open alert, could not run with their error; passing and off ones are not told of", async () => {
    const items: Array<DataAttentionItem> = (await read()).items;
    const failing: DataAttentionItem | undefined = items.find(
      (item: DataAttentionItem): boolean => {
        return item.dataCheckId === CHECK_FAILING;
      },
    );
    const couldNotRun: DataAttentionItem = find(
      items,
      DataAttentionKind.CheckCouldNotRun,
    );

    expect(failing).toMatchObject({
      kind: DataAttentionKind.CheckFailing,
      where: "public.orders",
      dataAssetId: TABLE_CHECKED,
      alert: {
        alertId: ALERT_CHECK,
        number: "ALT-7",
        title: "no duplicate orders is failing",
      },
    });
    expect(couldNotRun).toMatchObject({
      dataCheckId: CHECK_COULD_NOT_RUN,
      message: 'column "email" does not exist',
      alert: null,
    });

    const checkIds: Array<string | null> = items.map(
      (item: DataAttentionItem) => {
        return item.dataCheckId;
      },
    );
    expect(checkIds).not.toContain(CHECK_PASSING);
    expect(checkIds).not.toContain(CHECK_OFF);
  });

  test("a reconciliation's own two checks are not read as checks of their own", async () => {
    await read();

    expect(checkQueries).toHaveLength(1);
    expect(
      rowMatchesWhere(
        { dataReconciliationId: null },
        {
          dataReconciliationId: checkQueries[0]!["dataReconciliationId"],
        },
      ),
    ).toBe(true);
    expect(
      rowMatchesWhere(
        { dataReconciliationId: RECONCILIATION_DRIFTED },
        {
          dataReconciliationId: checkQueries[0]!["dataReconciliationId"],
        },
      ),
    ).toBe(false);
  });

  test("the counts: failing checks, checks a person made (dbt's are dbt's), pipelines seen", async () => {
    const attention: DataObservabilityAttention = await read();

    expect(attention.failingCheckCount).toBe(3);
    expect(attention.checkCount).toBe(5);
    expect(attention.pipelineCount).toBe(4);
  });

  test("a reconciliation in step, and a data product on time, are not told of", async () => {
    const names: Array<string> = (await read()).items.map(
      (item: DataAttentionItem): string => {
        return item.name;
      },
    );

    expect(names).not.toContain("in step");
  });

  test("a project with nothing wrong has nothing to say", async () => {
    pipelines = [];
    checks = [];
    products = [];
    reconciliations = [];

    const attention: DataObservabilityAttention =
      await DataObservabilityAttentionReader.read({
        projectId: PROJECT_ID,
        now: NOW,
        reader: PROJECT_ADMIN,
        stores: [store(STORE_OK, { name: "orders-db" })],
        lateAssets: [],
      });

    expect(attention).toEqual({
      items: [],
      failingCheckCount: 0,
      checkCount: 0,
      pipelineCount: 0,
    });
  });
});

describe("whether anyone has been told", () => {
  test("a late table names its oldest open alert, not a resolved one", async () => {
    const late: DataAttentionItem = find(
      (await read()).items,
      DataAttentionKind.TableLate,
    );

    expect(late.alert).toEqual({
      alertId: ALERT_TABLE_OLD,
      number: "ALT-10",
      title: "public.payments is late",
    });
  });

  test("a failed pipeline names its open alert", async () => {
    const failed: DataAttentionItem = find(
      (await read()).items,
      DataAttentionKind.PipelineFailed,
    );

    expect(failed.alert?.number).toBe("ALT-12");
  });

  test("a database's own alert is not one about a table in it", async () => {
    const failed: DataAttentionItem = find(
      (await read()).items,
      DataAttentionKind.CollectionFailed,
    );

    expect(failed.alert).toBeNull();
  });

  test("only the alerts still open are read", async () => {
    await read();

    expect(alertReads.length).toBeGreaterThan(0);

    for (const alertRead of alertReads) {
      expect(
        rowMatchesWhere(
          { currentAlertStateId: CREATED },
          { currentAlertStateId: alertRead.query["currentAlertStateId"] },
        ),
      ).toBe(true);
      expect(
        rowMatchesWhere(
          { currentAlertStateId: RESOLVED },
          { currentAlertStateId: alertRead.query["currentAlertStateId"] },
        ),
      ).toBe(false);
    }
  });
});

describe("a private alert is its owners' and the project's owners' and admins'", () => {
  function privateCheck(
    items: Array<DataAttentionItem>,
  ): DataAttentionItem | undefined {
    return items.find((item: DataAttentionItem): boolean => {
      return item.dataCheckId === CHECK_PRIVATE;
    });
  }

  test("a member who does not own it: the check is not failing to them, and its title is nowhere", async () => {
    const attention: DataObservabilityAttention = await read(OUTSIDER);

    expect(privateCheck(attention.items)).toBeUndefined();
    expect(attention.failingCheckCount).toBe(2);
    expect(JSON.stringify(attention)).not.toContain(
      "Payroll totals do not add up",
    );
  });

  test("its owner sees it failing, with the alert", async () => {
    const attention: DataObservabilityAttention = await read(ALERT_OWNER);

    expect(privateCheck(attention.items)?.alert?.number).toBe("ALT-8");
    expect(attention.failingCheckCount).toBe(3);
  });

  test("a member of a team that owns it sees it too", async () => {
    const attention: DataObservabilityAttention = await read(
      person(TEAMMATE, Permission.ProjectMember),
    );

    expect(privateCheck(attention.items)?.alert?.number).toBe("ALT-8");
  });

  test("a project admin sees it", async () => {
    expect(privateCheck((await read(PROJECT_ADMIN)).items)?.alert?.number).toBe(
      "ALT-8",
    );
  });

  test("a run of OneUptime's own, read as root, is read as nobody: no private alert", async () => {
    const attention: DataObservabilityAttention = await read({
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    expect(privateCheck(attention.items)).toBeUndefined();
  });
});

// What the reader logs, kept out of the test's output.
function quietLogger(): SpyInstance<typeof logger.error> {
  return jest.spyOn(logger, "error").mockImplementation((): void => {
    return;
  });
}

describe("one source that cannot be read leaves the rest", () => {
  test("the reconciliations failing to read: every other item still told, and the failure logged", async () => {
    const logged: SpyInstance<typeof logger.error> = quietLogger();

    jest
      .spyOn(DataReconciliationService, "findBy")
      .mockRejectedValue(new Error("connection reset") as never);

    const kinds: Array<DataAttentionKind> = (await read()).items.map(
      (item: DataAttentionItem): DataAttentionKind => {
        return item.kind;
      },
    );

    expect(kinds).not.toContain(DataAttentionKind.ReconciliationDrifted);
    expect(kinds).toContain(DataAttentionKind.CollectionFailed);
    expect(kinds).toContain(DataAttentionKind.CheckFailing);
    expect(kinds).toContain(DataAttentionKind.TableLate);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("could not read reconciliations"),
    );
  });

  test("the pipelines failing to read: no pipeline told of, none counted", async () => {
    quietLogger();

    jest
      .spyOn(DataPipelineService, "findBy")
      .mockRejectedValue(new Error("timeout") as never);

    const attention: DataObservabilityAttention = await read();

    expect(attention.pipelineCount).toBe(0);
    expect(
      attention.items.some((item: DataAttentionItem): boolean => {
        return item.dataPipelineId !== null;
      }),
    ).toBe(false);
    expect(attention.failingCheckCount).toBe(3);
  });

  test("the alerts failing to read: the checks say what their last runs say", async () => {
    quietLogger();

    jest
      .spyOn(AlertService, "findBy")
      .mockRejectedValue(new Error("timeout") as never);

    const attention: DataObservabilityAttention = await read();

    expect(attention.failingCheckCount).toBe(1);
    expect(
      attention.items.filter((item: DataAttentionItem): boolean => {
        return item.kind === DataAttentionKind.CheckFailing;
      }),
    ).toHaveLength(1);
    expect(find(attention.items, DataAttentionKind.TableLate).alert).toBeNull();
  });
});

describe("how each check of a page stands", () => {
  test("by check id: failing with its alert, could not run, passing, off, dbt's verdict", async () => {
    const answers: Map<string, DataCheckHealthAnswer> =
      await DataObservabilityAttentionReader.getCheckHealth({
        projectId: PROJECT_ID,
        reader: PROJECT_ADMIN,
        checks,
      });

    expect(answers.get(CHECK_FAILING)).toEqual({
      health: DataCheckHealth.Failing,
      alert: {
        alertId: ALERT_CHECK,
        number: "ALT-7",
        title: "no duplicate orders is failing",
      },
    });
    expect(answers.get(CHECK_COULD_NOT_RUN)?.health).toBe(
      DataCheckHealth.CouldNotRun,
    );
    // Its alert was resolved: it passes.
    expect(answers.get(CHECK_PASSING)).toEqual({
      health: DataCheckHealth.Passing,
      alert: null,
    });
    expect(answers.get(CHECK_OFF)?.health).toBe(DataCheckHealth.Off);
    expect(answers.get(DBT_FAILING)?.health).toBe(DataCheckHealth.Failing);
  });

  test("no monitor among the checks: no alert is read", async () => {
    await DataObservabilityAttentionReader.getCheckHealth({
      projectId: PROJECT_ID,
      reader: PROJECT_ADMIN,
      checks: [checks[1]!],
    });

    expect(alertReads).toHaveLength(0);
  });
});

describe("whether a database's alerts are on", () => {
  function monitorScopedTo(attributes: StoredRow): Monitor {
    return model(Monitor, {
      _id: ObjectID.generate().toString(),
      monitorSteps: {
        data: {
          monitorStepsInstanceArray: [
            {
              data: {
                metricMonitor: {
                  metricViewConfig: {
                    queryConfigs: [
                      {
                        metricQueryData: {
                          filterData: { metricName: "x", attributes },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    });
  }

  test("counts each database's own monitors, not a check's or a pipeline's", async () => {
    monitors = [
      monitorScopedTo({ [DataObservabilityAttribute.DataStoreId]: STORE_OK }),
      monitorScopedTo({ [DataObservabilityAttribute.DataStoreId]: STORE_OK }),
      monitorScopedTo({
        [DataObservabilityAttribute.DataStoreId]: STORE_FAILED,
      }),
      monitorScopedTo({
        [DataObservabilityAttribute.DataStoreId]: STORE_FAILED,
        [DataCheckAttribute.CheckId]: CHECK_FAILING,
      }),
      monitorScopedTo({ [DataPipelineAttribute.PipelineId]: PIPELINE_FAILED }),
      // Names something that is not an id: no database's.
      monitorScopedTo({ [DataObservabilityAttribute.DataStoreId]: "orders" }),
    ];

    const counts: Map<string, number> =
      await DataObservabilityAttentionReader.getAlertMonitorCountByStore(
        PROJECT_ID,
      );

    expect(Object.fromEntries(counts)).toEqual({
      [STORE_OK]: 2,
      [STORE_FAILED]: 1,
    });
  });

  test("reads only the project's Metrics monitors that are on and name a database at all", async () => {
    await DataObservabilityAttentionReader.getAlertMonitorCountByStore(
      PROJECT_ID,
    );

    expect(monitorQueries).toHaveLength(1);

    const query: Record<string, unknown> = monitorQueries[0]!;
    const steps: FindOperator<unknown> = query[
      "monitorSteps"
    ] as FindOperator<unknown>;

    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["monitorType"]).toBe(MonitorType.Metrics);
    expect(query["disableActiveMonitoring"]).toBe(false);
    expect(steps.getSql!("c")).toContain("ILIKE ANY");
    expect(JSON.stringify(steps.objectLiteralParameters)).toContain(
      DataObservabilityAttribute.DataStoreId,
    );
  });

  test("the monitors failing to read: none counted, never an error", async () => {
    quietLogger();

    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("timeout") as never);

    expect(
      (
        await DataObservabilityAttentionReader.getAlertMonitorCountByStore(
          PROJECT_ID,
        )
      ).size,
    ).toBe(0);
  });
});

describe("whether anyone owns the tables", () => {
  function counted(value: number): never {
    return {
      toNumber: (): number => {
        return value;
      },
    } as never;
  }

  test("people and teams named on tables, and the owner rules", async () => {
    jest
      .spyOn(DataAssetOwnerUserService, "countBy")
      .mockResolvedValue(counted(3));
    jest
      .spyOn(DataAssetOwnerTeamService, "countBy")
      .mockResolvedValue(counted(2));
    jest
      .spyOn(DataAssetOwnerRuleService, "countBy")
      .mockResolvedValue(counted(1));

    expect(
      await DataObservabilityAttentionReader.getOwnerCounts(PROJECT_ID),
    ).toEqual({ tableOwnerCount: 5, ownerRuleCount: 1 });
  });

  test("a count that fails counts none, and the others still count", async () => {
    const logged: SpyInstance<typeof logger.error> = quietLogger();

    jest
      .spyOn(DataAssetOwnerUserService, "countBy")
      .mockRejectedValue(new Error("timeout") as never);
    jest
      .spyOn(DataAssetOwnerTeamService, "countBy")
      .mockResolvedValue(counted(2));
    jest
      .spyOn(DataAssetOwnerRuleService, "countBy")
      .mockResolvedValue(counted(0));

    expect(
      await DataObservabilityAttentionReader.getOwnerCounts(PROJECT_ID),
    ).toEqual({ tableOwnerCount: 2, ownerRuleCount: 0 });
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("could not count table owners"),
    );
  });
});
