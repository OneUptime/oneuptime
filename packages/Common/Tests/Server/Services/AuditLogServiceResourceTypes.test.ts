import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AuditLogServiceInstance from "../../../Server/Services/AuditLogService";
import AnalyticsDatabaseService, {
  Results,
} from "../../../Server/Services/AnalyticsDatabaseService";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import CountBy from "../../../Server/Types/AnalyticsDatabase/CountBy";
import ExistsBy from "../../../Server/Types/AnalyticsDatabase/ExistsBy";
import FindBy from "../../../Server/Types/AnalyticsDatabase/FindBy";
import { OnFind } from "../../../Server/Types/AnalyticsDatabase/Hooks";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";

type Spy = ReturnType<typeof getJestSpyOn>;

/*
 * THE AUDIT LOG'S API FINDS A RENAMED TYPE BY EITHER NAME (#7580).
 *
 * The audit log stores a renamed model's entries under the name it kept
 * (an On-Call Schedule's as "On-Call Policy Schedule"). The Dashboard's
 * Resource Type filter, a resource's own page and anyone reading POST
 * /audit-log/get-list may ask for a type by either name. AuditLogService
 * reads every list, count, chart and existence check with the type's
 * every name, so each finds the entries stored under the kept name -
 * every one the recorder wrote, before the rename and since - and any
 * stored under the name on screen.
 *
 * The statements are captured instead of run; the same reads run against
 * a real ClickHouse in App's
 * Tests/Telemetry/AuditLogResourceTypeFilterClickhouse.test.ts.
 */

type Hooks = {
  onBeforeFind: (findBy: FindBy<AuditLog>) => Promise<OnFind<AuditLog>>;
  onBeforeCount: (countBy: CountBy<AuditLog>) => Promise<CountBy<AuditLog>>;
};

const hooks: Hooks = AuditLogServiceInstance as unknown as Hooks;

const PROJECT_ID: ObjectID = new ObjectID(
  "75800000-0000-4000-8000-0000000000a1",
);

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

// An audit reader of the project: what the Dashboard reads the log as.
const AUDIT_READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("75800000-0000-4000-8000-0000000000b2"),
  userType: UserType.User,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
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

interface RenamedType {
  kept: string;
  screen: string;
}

// Every renamed model, read from the models.
const RENAMED: Array<RenamedType> = DatabaseModels.map(
  (modelType: DatabaseBaseModelType): DatabaseBaseModel => {
    return new modelType();
  },
)
  .filter((model: DatabaseBaseModel): boolean => {
    return Boolean(model.apiSingularName);
  })
  .map((model: DatabaseBaseModel): RenamedType => {
    return { kept: model.apiSingularName!, screen: model.singularName! };
  });

// Capture the statements the service builds instead of running them.
function captureStatements(rows: Array<JSONObject> = []): Array<Statement> {
  const captured: Array<Statement> = [];

  jest
    .spyOn(AuditLogServiceInstance as never, "executeQuery")
    .mockImplementation(((statement: Statement): Promise<Results> => {
      captured.push(statement);

      return Promise.resolve({
        json: (): Promise<unknown> => {
          return Promise.resolve({ data: rows });
        },
      } as unknown as Results);
    }) as never);

  return captured;
}

// A statement with its parameters written in, on one line.
function inline(statement: Statement): string {
  let text: string = statement.query;

  for (const [name, value] of Object.entries(
    statement.query_params as Record<string, unknown>,
  )) {
    text = text.replace(
      new RegExp(`\\{${name}:[^}]+\\}`, "g"),
      JSON.stringify(value),
    );
  }

  return text.replace(/\s+/g, " ").trim();
}

function listQuery(resourceType: unknown): Query<AuditLog> {
  return {
    projectId: PROJECT_ID,
    resourceType: resourceType,
  } as Query<AuditLog>;
}

function findOf(
  query: Query<AuditLog>,
  props: DatabaseCommonInteractionProps = ROOT,
): FindBy<AuditLog> {
  return {
    query: query,
    select: { resourceType: true, resourceName: true },
    sort: { createdAt: SortOrder.Descending },
    limit: 10,
    skip: 0,
    props: props,
  } as FindBy<AuditLog>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the hooks every read of the audit log passes", () => {
  test.each(RENAMED)(
    "a list asked for $screen, or $kept, reads both",
    async (renamed: RenamedType) => {
      for (const picked of [renamed.screen, renamed.kept]) {
        const onFind: OnFind<AuditLog> = await hooks.onBeforeFind(
          findOf(listQuery(picked)),
        );
        const condition: unknown = (
          onFind.findBy.query as Record<string, unknown>
        )["resourceType"];

        expect(condition).toBeInstanceOf(Includes);
        expect((condition as Includes).values).toEqual([
          renamed.kept,
          renamed.screen,
        ]);
        expect(onFind.findBy.query.projectId).toBe(PROJECT_ID);
      }
    },
  );

  test("a count asked for a type by today's name counts the entries the list reads", async () => {
    const counted: CountBy<AuditLog> = await hooks.onBeforeCount({
      query: listQuery("Escalation Rule User"),
      props: ROOT,
    } as CountBy<AuditLog>);

    expect(
      ((counted.query as Record<string, unknown>)["resourceType"] as Includes)
        .values,
    ).toEqual(["User's On-Call Duty Escalation Rule", "Escalation Rule User"]);
  });

  test("an entry's root type is read by both names too", async () => {
    const onFind: OnFind<AuditLog> = await hooks.onBeforeFind(
      findOf({
        projectId: PROJECT_ID,
        rootResourceType: "Maintenance Event",
      } as Query<AuditLog>),
    );

    expect(
      (
        (onFind.findBy.query as Record<string, unknown>)[
          "rootResourceType"
        ] as Includes
      ).values,
    ).toEqual(["Scheduled Maintenance Event", "Maintenance Event"]);
  });

  test("a type never renamed is asked for as it always was", async () => {
    const onFind: OnFind<AuditLog> = await hooks.onBeforeFind(
      findOf(listQuery("Monitor")),
    );

    expect(onFind.findBy.query.resourceType).toBe("Monitor");
  });

  test("a chart reads the type by both names", async () => {
    const aggregate: Spy = getJestSpyOn(
      AnalyticsDatabaseService.prototype,
      "aggregateBy",
    ).mockResolvedValue({ data: [] } as never);

    await AuditLogServiceInstance.aggregateBy({
      query: listQuery("On-Call Schedule"),
      aggregationType: AggregationType.Count,
      aggregateColumnName: "_id",
      aggregationTimestampColumnName: "createdAt",
      startTimestamp: new Date("2026-11-01T00:00:00.000Z"),
      endTimestamp: new Date("2026-11-15T00:00:00.000Z"),
      limit: 10,
      skip: 0,
      props: ROOT,
    } as AggregateBy<AuditLog>);

    const asked: AggregateBy<AuditLog> = aggregate.mock
      .calls[0]![0] as AggregateBy<AuditLog>;

    expect(
      ((asked.query as Record<string, unknown>)["resourceType"] as Includes)
        .values,
    ).toEqual(["On-Call Policy Schedule", "On-Call Schedule"]);
  });

  test("an existence check reads the type by both names", async () => {
    const exists: Spy = getJestSpyOn(
      AnalyticsDatabaseService.prototype,
      "existsBy",
    ).mockResolvedValue(true as never);

    await AuditLogServiceInstance.existsBy({
      query: listQuery("Ingestion Key"),
      props: ROOT,
    } as ExistsBy<AuditLog>);

    const asked: ExistsBy<AuditLog> = exists.mock
      .calls[0]![0] as ExistsBy<AuditLog>;

    expect(
      ((asked.query as Record<string, unknown>)["resourceType"] as Includes)
        .values,
    ).toEqual(["Telemetry Ingestion Key", "Ingestion Key"]);
  });
});

describe("the statements the API's filter runs", () => {
  /*
   * REGRESSION: the filter compared the stored value with what was typed,
   * so "On-Call Schedule" matched no entry - every one is stored as "On-Call
   * Policy Schedule".
   */
  test("REGRESSION: a list asked for On-Call Schedule reads the entries stored as On-Call Policy Schedule", async () => {
    const captured: Array<Statement> = captureStatements();

    await AuditLogServiceInstance.findBy(findOf(listQuery("On-Call Schedule")));

    expect(captured).toHaveLength(1);

    const text: string = inline(captured[0]!);

    expect(text).toContain(
      '"resourceType" IN ["On-Call Policy Schedule","On-Call Schedule"]',
    );
    expect(text).not.toContain('"resourceType" = "On-Call Schedule"');
  });

  test("REGRESSION: a list asked for Escalation Rule User reads the entries stored under its kept name", async () => {
    const captured: Array<Statement> = captureStatements();

    await AuditLogServiceInstance.findBy(
      findOf(listQuery("Escalation Rule User")),
    );

    expect(inline(captured[0]!)).toContain(
      `"resourceType" IN ["User's On-Call Duty Escalation Rule","Escalation Rule User"]`,
    );
  });

  test.each(RENAMED)(
    "$screen, as an audit reader asks for it, reads both names in the project",
    async (renamed: RenamedType) => {
      const captured: Array<Statement> = captureStatements();

      await AuditLogServiceInstance.findBy(
        findOf(listQuery(renamed.screen), AUDIT_READER),
      );

      const text: string = inline(captured[0]!);

      expect(text).toContain(
        `"resourceType" IN ${JSON.stringify([renamed.kept, renamed.screen])}`,
      );
      expect(text).toContain(`"projectId" = "${PROJECT_ID.toString()}"`);
    },
  );

  test("the count beside the list counts by both names", async () => {
    const captured: Array<Statement> = captureStatements([{ count: 3 }]);

    await AuditLogServiceInstance.countBy({
      query: listQuery("On-Call Schedule"),
      props: AUDIT_READER,
    } as CountBy<AuditLog>);

    expect(captured).toHaveLength(1);
    expect(inline(captured[0]!)).toContain(
      '"resourceType" IN ["On-Call Policy Schedule","On-Call Schedule"]',
    );
  });

  test("a list of types picked together reads every name of each", async () => {
    const captured: Array<Statement> = captureStatements();

    await AuditLogServiceInstance.findBy(
      findOf(listQuery(new Includes(["On-Call Schedule", "Monitor"]))),
    );

    expect(inline(captured[0]!)).toContain(
      '"resourceType" IN ["On-Call Policy Schedule","On-Call Schedule","Monitor"]',
    );
  });

  test("a type never renamed is compared as it always was", async () => {
    const captured: Array<Statement> = captureStatements();

    await AuditLogServiceInstance.findBy(findOf(listQuery("Monitor")));

    const text: string = inline(captured[0]!);

    expect(text).toContain('"resourceType" = "Monitor"');
    expect(text).not.toContain('"resourceType" IN');
  });

  test("a text search on the type reads the stored words, as it did", async () => {
    const captured: Array<Statement> = captureStatements();

    await AuditLogServiceInstance.findBy(
      findOf(listQuery(new Search<string>("Policy Schedule"))),
    );

    const text: string = inline(captured[0]!);

    expect(text).toContain('"resourceType" ILIKE');
    expect(text).not.toContain('"resourceType" IN');
  });

  /*
   * The Resource Type filter's choices: one row per stored type, read with
   * the page's own query (ee's fetchResourceTypeFilterOptions).
   */
  test("the filter's choices are read as one row per stored type", async () => {
    const captured: Array<Statement> = captureStatements([
      { resourceType: "On-Call Policy Schedule" },
      { resourceType: "Monitor" },
    ]);

    const rows: Array<AuditLog> = await AuditLogServiceInstance.findBy({
      query: { projectId: PROJECT_ID } as Query<AuditLog>,
      groupBy: { resourceType: true },
      select: { resourceType: true },
      sort: { resourceType: SortOrder.Ascending },
      limit: 10000,
      skip: 0,
      props: AUDIT_READER,
    } as FindBy<AuditLog>);

    const text: string = inline(captured[0]!);

    expect(text).toContain('SELECT "resourceType" FROM');
    expect(text).toContain('GROUP BY "resourceType"');
    expect(text).toContain('ORDER BY "resourceType" ASC');
    expect(
      rows.map((row: AuditLog): string | undefined => {
        return row.resourceType;
      }),
    ).toEqual(["On-Call Policy Schedule", "Monitor"]);
  });
});
