import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import type { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { getResourceTypeFilterOptions } from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The audit log's Resource Type filter, against a real ClickHouse server
 * (#7580).
 *
 * A renamed model keeps its old singular name for the API and the audit
 * log, so every entry about an On-Call Schedule - recorded before the
 * rename, and since - is stored as "On-Call Policy Schedule". The filter
 * was free text on that stored value, and "On-Call Schedule", the name the
 * product shows, found nothing. The filter now offers the types by today's
 * name and asks for the kept one, and AuditLogService reads a type by both
 * of its names. Against a table built from the real AuditLog model and
 * written through the real AuditLogService, for every renamed model:
 *
 *   1. asked for by today's name or by the kept one, a list and its count
 *      read the type's entries stored before the rename and after it
 *      (under the kept name, as the recorder writes them) and any stored
 *      under today's name - and nothing of another type or project;
 *   2. the filter's choices - one grouped row per stored type, as the
 *      Dashboard reads them - offer each renamed type once, by today's
 *      name, and each choice reads all of the type's entries;
 *   3. a type never renamed reads as it did, a list of types reads every
 *      name of each, "not a type" leaves out both names, and an entry's
 *      root is found by either name of its root's type.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/AuditLogResourceTypeFilterClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
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

import { AuditLogService } from "Common/Server/Services/AuditLogService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const TABLE: string = new AuditLog().tableName;

const database: string = `audit_log_resource_type_test_${process.pid}_${Date.now()}`;

const PROJECT_A: ObjectID = new ObjectID(
  "75800000-0000-4000-8000-00000000a001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "75800000-0000-4000-8000-00000000b002",
);

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

// An audit reader of project A: what the Dashboard reads the log as.
const AUDIT_READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("75800000-0000-4000-8000-00000000c003"),
  userType: UserType.User,
  tenantId: PROJECT_A,
  userTenantAccessPermission: {
    [PROJECT_A.toString()]: {
      projectId: PROJECT_A,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ReadAuditLog,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    } as UserTenantAccessPermission,
  },
};

// The renames of #6817 shipped on 2026-11-12: one entry each side of it.
const BEFORE_THE_RENAME: Date = new Date("2026-10-01T09:00:00.000Z");
const AFTER_THE_RENAME: Date = new Date("2026-11-14T09:00:00.000Z");

interface RenamedType {
  kept: string;
  screen: string;
}

const RENAMED: Array<RenamedType> = DatabaseModels.map(
  (modelType: typeof DatabaseBaseModel): DatabaseBaseModel => {
    return new modelType();
  },
)
  .filter((model: DatabaseBaseModel): boolean => {
    return Boolean(model.apiSingularName);
  })
  .map((model: DatabaseBaseModel): RenamedType => {
    return { kept: model.apiSingularName!, screen: model.singularName! };
  });

interface EntryFixture {
  id: string;
  projectId: ObjectID;
  createdAt: Date;
  resourceType: string;
  rootResourceType?: string | undefined;
}

const ENTRIES: Array<EntryFixture> = [];

function entry(data: Omit<EntryFixture, "id">): EntryFixture {
  const fixture: EntryFixture = {
    id: ObjectID.generate().toString(),
    ...data,
  };

  ENTRIES.push(fixture);

  return fixture;
}

// Each renamed type's entries in project A, by when and how they were stored.
const OF_TYPE: Map<string, Array<EntryFixture>> = new Map<
  string,
  Array<EntryFixture>
>();

for (const renamed of RENAMED) {
  OF_TYPE.set(renamed.kept, [
    // Recorded before the rename: under the name the model had then.
    entry({
      projectId: PROJECT_A,
      createdAt: BEFORE_THE_RENAME,
      resourceType: renamed.kept,
    }),
    // Recorded since: still under the kept name, as the recorder writes it.
    entry({
      projectId: PROJECT_A,
      createdAt: AFTER_THE_RENAME,
      resourceType: renamed.kept,
    }),
    // Any stored under the name the product shows today.
    entry({
      projectId: PROJECT_A,
      createdAt: AFTER_THE_RENAME,
      resourceType: renamed.screen,
    }),
  ]);

  // Another project's, never read for project A.
  entry({
    projectId: PROJECT_B,
    createdAt: AFTER_THE_RENAME,
    resourceType: renamed.kept,
  });
}

const MONITORS: Array<EntryFixture> = [
  entry({
    projectId: PROJECT_A,
    createdAt: BEFORE_THE_RENAME,
    resourceType: "Monitor",
  }),
  entry({
    projectId: PROJECT_A,
    createdAt: AFTER_THE_RENAME,
    resourceType: "Monitor",
  }),
];

// A type whose name starts the schedule's kept name: equality never mixes them.
const POLICIES: Array<EntryFixture> = [
  entry({
    projectId: PROJECT_A,
    createdAt: AFTER_THE_RENAME,
    resourceType: "On-Call Policy",
  }),
];

// A schedule's layers, rolled up to it under either name of its type.
const LAYERS: Array<EntryFixture> = [
  entry({
    projectId: PROJECT_A,
    createdAt: BEFORE_THE_RENAME,
    resourceType: "On-Call Schedule Layer",
    rootResourceType: "On-Call Policy Schedule",
  }),
  entry({
    projectId: PROJECT_A,
    createdAt: AFTER_THE_RENAME,
    resourceType: "On-Call Schedule Layer",
    rootResourceType: "On-Call Schedule",
  }),
];

const OF_PROJECT_A: Array<EntryFixture> = ENTRIES.filter(
  (fixture: EntryFixture): boolean => {
    return fixture.projectId.toString() === PROJECT_A.toString();
  },
);

function idsOf(entries: Array<EntryFixture | AuditLog>): Array<string> {
  return entries
    .map((item: EntryFixture | AuditLog): string => {
      return item instanceof AuditLog ? item.id!.toString() : item.id;
    })
    .sort();
}

let service: AuditLogService;

async function read(
  query: Query<AuditLog>,
  props: DatabaseCommonInteractionProps = ROOT,
): Promise<Array<AuditLog>> {
  return await service.findBy({
    query: query,
    select: { resourceType: true, projectId: true },
    sort: { createdAt: SortOrder.Descending },
    limit: 1000,
    skip: 0,
    props: props,
  });
}

async function count(
  query: Query<AuditLog>,
  props: DatabaseCommonInteractionProps = ROOT,
): Promise<number> {
  return (
    await service.countBy({ query: query, props: props, exact: true })
  ).toNumber();
}

async function countEntries(client: ClickhouseClient): Promise<number> {
  const result: { json: () => Promise<{ data?: Array<JSONObject> }> } =
    (await client.query({
      query: `SELECT count() AS count FROM ${database}.${TABLE}`,
      format: "JSON",
    })) as unknown as { json: () => Promise<{ data?: Array<JSONObject> }> };

  return Number((await result.json()).data?.[0]?.["count"]);
}

integration("The Resource Type filter against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    // The model's columns, keys, TTL and settings, on one node.
    const model: AuditLog = new AuditLog();
    const columns: Statement = new StatementGenerator<AuditLog>({
      modelType: AuditLog,
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")}) TTL ${model.ttlExpression} SETTINGS ${model.tableSettings}`,
      query_params: columns.query_params,
    });

    service = new AuditLogService(clickhouse);

    // Written as the recorder writes them: root, each at its own time.
    const times: Array<Date> = ENTRIES.map((fixture: EntryFixture): Date => {
      return fixture.createdAt;
    });

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return times.shift() ?? new Date();
    });

    const retentionDate: Date = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await service.createMany({
      items: ENTRIES.map((fixture: EntryFixture): AuditLog => {
        const auditLog: AuditLog = new AuditLog();
        auditLog.id = new ObjectID(fixture.id);
        auditLog.projectId = fixture.projectId;
        auditLog.action = AuditLogAction.Update;
        auditLog.resourceType = fixture.resourceType;
        auditLog.resourceId = ObjectID.generate();
        auditLog.resourceName = `${fixture.resourceType} entry`;
        if (fixture.rootResourceType) {
          auditLog.rootResourceType = fixture.rootResourceType;
          auditLog.rootResourceId = new ObjectID(
            "75800000-0000-4000-8000-00000000d004",
          );
        }
        auditLog.userType = "User";
        auditLog.changes = [];
        auditLog.retentionDate = retentionDate;
        return auditLog;
      }),
      props: { isRoot: true },
    });

    jest.restoreAllMocks();

    for (let attempt: number = 0; attempt < 120; attempt++) {
      if ((await countEntries(client)) === ENTRIES.length) {
        return;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 250);
      });
    }

    throw new Error("The fixture's entries never all became readable.");
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the fixture is every renamed model's entries, stored each way, and the controls", async () => {
    expect(RENAMED.length).toBeGreaterThanOrEqual(15);
    expect(await countEntries(client)).toBe(ENTRIES.length);
    expect(idsOf(await read({ projectId: PROJECT_A }))).toEqual(
      idsOf(OF_PROJECT_A),
    );
  });

  test("REGRESSION: On-Call Schedule finds the schedule's entries, stored as On-Call Policy Schedule before the rename and since", async () => {
    const expected: Array<EntryFixture> = OF_TYPE.get(
      "On-Call Policy Schedule",
    )!;

    const found: Array<AuditLog> = await read({
      projectId: PROJECT_A,
      resourceType: "On-Call Schedule",
    });

    expect(idsOf(found)).toEqual(idsOf(expected));
    expect(
      found
        .map((row: AuditLog): string => {
          return row.resourceType!;
        })
        .sort(),
    ).toEqual([
      "On-Call Policy Schedule",
      "On-Call Policy Schedule",
      "On-Call Schedule",
    ]);
  });

  test("REGRESSION: Escalation Rule User finds the entries stored as User's On-Call Duty Escalation Rule", async () => {
    const found: Array<AuditLog> = await read({
      projectId: PROJECT_A,
      resourceType: "Escalation Rule User",
    });

    expect(idsOf(found)).toEqual(
      idsOf(OF_TYPE.get("User's On-Call Duty Escalation Rule")!),
    );
  });

  test.each(RENAMED)(
    "$screen, asked for by either name, reads its entries from before the rename, since, and under today's name",
    async (renamed: RenamedType) => {
      const expected: Array<string> = idsOf(OF_TYPE.get(renamed.kept)!);

      for (const picked of [renamed.screen, renamed.kept]) {
        const query: Query<AuditLog> = {
          projectId: PROJECT_A,
          resourceType: picked,
        };

        expect({ picked, ids: idsOf(await read(query)) }).toEqual({
          picked,
          ids: expected,
        });
        expect({ picked, count: await count(query) }).toEqual({
          picked,
          count: 3,
        });
      }
    },
  );

  test("an audit reader of the project reads the same entries, and never another project's", async () => {
    const found: Array<AuditLog> = await read(
      { projectId: PROJECT_A, resourceType: "Ingestion Key" },
      AUDIT_READER,
    );

    expect(idsOf(found)).toEqual(
      idsOf(OF_TYPE.get("Telemetry Ingestion Key")!),
    );
    expect(
      found.every((row: AuditLog): boolean => {
        return row.projectId?.toString() === PROJECT_A.toString();
      }),
    ).toBe(true);
    expect(
      await count(
        { projectId: PROJECT_A, resourceType: "Ingestion Key" },
        AUDIT_READER,
      ),
    ).toBe(3);
  });

  test("the filter's choices offer every renamed type once, by today's name, and each reads all of its entries", async () => {
    // The read the Dashboard makes when the filter opens: one row per stored type.
    const rows: Array<AuditLog> = await service.findBy({
      query: { projectId: PROJECT_A },
      groupBy: { resourceType: true },
      select: { resourceType: true },
      sort: { resourceType: SortOrder.Ascending },
      limit: 10000,
      skip: 0,
      props: AUDIT_READER,
    });

    // Both names of each renamed type are stored in this fixture.
    expect(rows).toHaveLength(RENAMED.length * 2 + 3);

    const options: Array<DropdownOption> = getResourceTypeFilterOptions(
      rows.map((row: AuditLog): string | undefined => {
        return row.resourceType;
      }),
    );

    expect(options).toHaveLength(RENAMED.length + 3);

    for (const renamed of RENAMED) {
      const option: DropdownOption | undefined = options.find(
        (candidate: DropdownOption): boolean => {
          return candidate.label === renamed.screen;
        },
      );

      expect(option?.value).toBe(renamed.kept);

      // Picked, it asks for its value; the server reads both names.
      expect(
        idsOf(
          await read(
            { projectId: PROJECT_A, resourceType: String(option!.value) },
            AUDIT_READER,
          ),
        ),
      ).toEqual(idsOf(OF_TYPE.get(renamed.kept)!));
    }

    // No choice is a name nobody sees any more.
    for (const renamed of RENAMED) {
      expect(
        options.map((option: DropdownOption): string => {
          return option.label;
        }),
      ).not.toContain(renamed.kept);
    }
  });

  test("a type never renamed reads as it did, and a name that starts another is not that one", async () => {
    expect(
      idsOf(await read({ projectId: PROJECT_A, resourceType: "Monitor" })),
    ).toEqual(idsOf(MONITORS));
    expect(
      idsOf(
        await read({ projectId: PROJECT_A, resourceType: "On-Call Policy" }),
      ),
    ).toEqual(idsOf(POLICIES));
  });

  test("a list of types reads every name of each", async () => {
    expect(
      idsOf(
        await read({
          projectId: PROJECT_A,
          resourceType: new Includes(["On-Call Schedule", "Monitor"]),
        }),
      ),
    ).toEqual(idsOf([...OF_TYPE.get("On-Call Policy Schedule")!, ...MONITORS]));
  });

  test("not a type leaves out its entries under both names, and nothing else", async () => {
    const schedule: Array<string> = idsOf(
      OF_TYPE.get("On-Call Policy Schedule")!,
    );

    expect(
      idsOf(
        await read({
          projectId: PROJECT_A,
          resourceType: new NotEqual<string>("On-Call Schedule"),
        }),
      ),
    ).toEqual(
      idsOf(OF_PROJECT_A).filter((id: string): boolean => {
        return !schedule.includes(id);
      }),
    );
  });

  test("what rolls up to a schedule is found by either name of the schedule's type", async () => {
    for (const rootType of ["On-Call Schedule", "On-Call Policy Schedule"]) {
      expect({
        rootType,
        ids: idsOf(
          await read({ projectId: PROJECT_A, rootResourceType: rootType }),
        ),
      }).toEqual({ rootType, ids: idsOf(LAYERS) });
    }
  });
});

describe("Audit log Resource Type filter ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
