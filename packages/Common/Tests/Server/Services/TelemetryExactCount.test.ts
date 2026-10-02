/*
 * The identifier lookup is stubbed: these tests are about the statements a
 * count compiles and the query it compiles them from, and leaving it live
 * would make them depend on a reachable Postgres.
 */
const kubernetesClusterFindBy: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/KubernetesClusterService", () => {
  return { __esModule: true, default: { findBy: kubernetesClusterFindBy } };
});

import LogService from "../../../Server/Services/LogService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Span from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { keyForKubernetesCluster } from "../../../Utils/Telemetry/EntityKey";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The count behind the traces and logs explorers' totals (issue #4202).
 *
 * The explorers count with their list's own query, through POST
 * /span/count and /log/count with `exact: true`. What is pinned here:
 *   - a count of a list narrowed by a resource facet works for a member —
 *     the explorer's `resourceFilters` is rewritten before the permission
 *     check, exactly as the list's is, where it used to be refused as
 *     "Invalid column";
 *   - an exact span count reads the table with the list's own WHERE clause
 *     (raw startTime bounds, the retention filter), never the minute-rounded
 *     projection shortcut threshold callers keep;
 *   - it fails at its time limit instead of returning part of a count.
 */

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-10-01T10:48:39.000Z");
const endTime: Date = new Date("2026-10-01T11:48:39.000Z");

const clusterId: string = ObjectID.generate().toString();
const clusterEntityKey: string = keyForKubernetesCluster(
  projectId.toString(),
  "prod-eu",
);

/*
 * A project member's props, as getUserMiddleware leaves them. Unlike a root
 * caller, a member's query goes through the per-column permission check —
 * which is where an unrewritten `resourceFilters` was refused.
 */
const memberProps: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: ObjectID.generate(),
  userType: UserType.User,
  userGlobalAccessPermission: {
    _type: "UserGlobalAccessPermission",
    projectIds: [projectId],
    globalPermissions: [Permission.Public, Permission.User],
  },
  userTenantAccessPermission: {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
};

// Capture the statements a service builds instead of running them.
function captureStatements(
  service: { executeQuery: (statement: Statement) => Promise<Results> },
  rows: Array<JSONObject> = [{ count: 712345 }],
): Array<Statement> {
  const captured: Array<Statement> = [];

  jest.spyOn(service as never, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<Results> => {
    captured.push(statement);

    return Promise.resolve({
      json: (): Promise<unknown> => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results);
  }) as never);

  return captured;
}

/*
 * A statement with its parameters written in, so two statements whose
 * placeholders are numbered differently (a find has its SELECT first) can
 * be compared by what they filter on.
 */
function inline(statement: Statement): string {
  let text: string = statement.query;
  const params: Record<string, unknown> = statement.query_params as Record<
    string,
    unknown
  >;

  for (const [name, value] of Object.entries(params)) {
    text = text.replace(
      new RegExp(`\\{${name}:[^}]+\\}`, "g"),
      JSON.stringify(value),
    );
  }

  return text.replace(/\s+/g, " ").trim();
}

// The WHERE clause of a statement: from "WHERE TRUE" to the next clause.
function whereClause(text: string): string {
  const start: number = text.indexOf("WHERE TRUE");
  const ends: Array<number> = [" SETTINGS", " ORDER BY", " GROUP BY", " LIMIT"]
    .map((clause: string): number => {
      return text.indexOf(clause, start);
    })
    .filter((index: number): boolean => {
      return index > start;
    });
  return text.substring(start, Math.min(...ends)).trim();
}

const pastHour: () => InBetween<Date> = (): InBetween<Date> => {
  return new InBetween<Date>(startTime, endTime);
};

describe("a count of a list narrowed by a resource facet", () => {
  beforeEach(() => {
    kubernetesClusterFindBy.mockReset();
    kubernetesClusterFindBy.mockResolvedValue([
      { clusterIdentifier: "prod-eu" },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Why the rewrite has to come first: the permission check refuses any key
   * that is not a column, and `resourceFilters` is the explorer's own.
   */
  test("the permission check alone refuses the explorer's resourceFilters key", async () => {
    await expect(
      ModelPermission.checkReadPermission(
        Span,
        {
          projectId,
          startTime: pastHour(),
          resourceFilters: { kubernetesClusterId: [clusterId] },
        } as never,
        null,
        memberProps,
      ),
    ).rejects.toThrow(/resourceFilters/);
  });

  test("REGRESSION: a member's span count with a cluster selected is counted, by the cluster's entity key", async () => {
    const captured: Array<Statement> = captureStatements(SpanService);

    const count: PositiveNumber = await SpanService.countBy({
      query: {
        projectId,
        startTime: pastHour(),
        resourceFilters: { kubernetesClusterId: [clusterId] },
      } as never,
      props: memberProps,
      exact: true,
    });

    expect(count.toNumber()).toBe(712345);
    expect(captured).toHaveLength(1);

    const sql: string = inline(captured[0]!);
    // By id, by the entity key ingest stamped, or by the resource attribute.
    expect(sql).toContain(`"primaryEntityId" IN ["${clusterId}"]`);
    expect(sql).toContain(`hasAny("entityKeys", ["${clusterEntityKey}"])`);
    expect(sql).toContain(
      `"attributes"["resource.k8s.cluster.name"] IN ["prod-eu"]`,
    );
    expect(sql).not.toContain("resourceFilters");
  });

  test("the log count resolves it the same way", async () => {
    const captured: Array<Statement> = captureStatements(LogService);

    const count: PositiveNumber = await LogService.countBy({
      query: {
        projectId,
        time: pastHour(),
        resourceFilters: { kubernetesClusterId: [clusterId] },
      } as never,
      props: memberProps,
      exact: true,
    });

    expect(count.toNumber()).toBe(712345);
    const sql: string = inline(captured[0]!);
    expect(sql).toContain(`hasAny("entityKeys", ["${clusterEntityKey}"])`);
  });

  /*
   * The ids are the client's; the scope they become is the server's. A
   * client that sends a scope of its own must not get it compiled verbatim.
   */
  test("a client-sent resourceEntityScopes is dropped, not trusted", async () => {
    const captured: Array<Statement> = captureStatements(SpanService);

    await SpanService.countBy({
      query: {
        projectId,
        startTime: pastHour(),
        resourceEntityScopes: [
          { entityIds: ["injected"], entityKeys: ["injected-key"] },
        ],
      } as never,
      props: memberProps,
      exact: true,
    });

    expect(inline(captured[0]!)).not.toContain("injected-key");
  });

  test("the list's own rewrite and the count's agree on the scope", async () => {
    const listQuery: Record<string, unknown> = {
      projectId,
      startTime: pastHour(),
      resourceFilters: { kubernetesClusterId: [clusterId] },
    };
    const countQuery: Record<string, unknown> = {
      projectId,
      startTime: pastHour(),
      resourceFilters: { kubernetesClusterId: [clusterId] },
    };

    await (
      SpanService as unknown as {
        onBeforeFind: (input: unknown) => Promise<unknown>;
      }
    ).onBeforeFind({ query: listQuery, props: memberProps });
    await (
      SpanService as unknown as {
        onBeforeCount: (input: unknown) => Promise<unknown>;
      }
    ).onBeforeCount({ query: countQuery, props: memberProps });

    expect(countQuery).toEqual(listQuery);
    expect(countQuery["resourceEntityScopes"]).toBeDefined();
  });
});

describe("an exact span count reads what the list reads", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an eligible approximate count still rides the minute-rounded projection", () => {
    const sql: string = inline(
      SpanService.toCountStatement({
        query: { projectId, startTime: pastHour() } as never,
        props: { isRoot: true },
      }),
    );

    expect(sql).toContain("toStartOfMinute(startTime)");
    expect(sql).toContain("optimize_use_projections = 1");
    expect(sql).toContain("timeout_overflow_mode = 'break'");
  });

  /*
   * The projection rounds both window edges to the minute and cannot apply
   * the retention filter: a "Past 1 Hour" ending at 11:48:39 counts the
   * spans from 10:48:00, nearly a minute of rows the list never shows.
   */
  test("the exact count never rounds the window to the minute", () => {
    const sql: string = inline(
      SpanService.toCountStatement({
        query: { projectId, startTime: pastHour() } as never,
        props: { isRoot: true },
        exact: true,
      }),
    );

    expect(sql).not.toContain("toStartOfMinute");
    expect(sql).not.toContain("optimize_use_projections");
    expect(sql).toContain("retentionDate >= now()");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    // The window's own edges, to the second, as the list's.
    expect(sql).toContain(
      `"startTime" >= "2026-10-01 10:48:39.000000000" AND "startTime" <= "2026-10-01 11:48:39.000000000"`,
    );
  });

  test.each([
    ["the default past-hour view", { startTime: "window" }],
    ["root spans only", { startTime: "window", isRootSpan: true }],
    ["one service", { startTime: "window", primaryEntityId: "service" }],
    [
      "two services and a status",
      { startTime: "window", primaryEntityId: "services", statusCode: 2 },
    ],
    ["a span name search", { startTime: "window", name: "search" }],
  ])(
    "%s: the count's WHERE clause is the list's",
    (_label: string, shape: Record<string, unknown>) => {
      const serviceId: ObjectID = ObjectID.generate();
      const query: Record<string, unknown> = { projectId };

      for (const [key, value] of Object.entries(shape)) {
        if (value === "window") {
          query[key] = pastHour();
        } else if (value === "service") {
          query[key] = serviceId;
        } else if (value === "services") {
          query[key] = new Includes([serviceId, ObjectID.generate()]);
        } else if (value === "search") {
          query[key] = new Search("checkout");
        } else {
          query[key] = value;
        }
      }

      const count: string = whereClause(
        inline(
          SpanService.toCountStatement({
            query: query as never,
            props: { isRoot: true },
            exact: true,
          }),
        ),
      );

      const list: string = whereClause(
        inline(
          SpanService.toFindStatement({
            query: query as never,
            select: { spanId: true } as never,
            sort: { startTime: SortOrder.Descending } as never,
            limit: new PositiveNumber(51),
            skip: new PositiveNumber(0),
            props: { isRoot: true },
          }).statement,
        ),
      );

      /*
       * The list may add one bound after it — the result-preserving
       * sort-key boundary that keeps its `_id` tiebreaker cheap — and
       * nothing else.
       */
      expect(list.startsWith(count)).toBe(true);
      expect(count).toContain("retentionDate >= now()");
    },
  );

  test("the exact count is counted from the table, through countBy, as one statement", async () => {
    const captured: Array<Statement> = captureStatements(SpanService);

    jest
      .spyOn(ModelPermission, "checkReadPermission")
      .mockImplementation((_modelType: unknown, query: unknown) => {
        return Promise.resolve({ query, select: null } as never);
      });

    const count: PositiveNumber = await SpanService.countBy({
      query: { projectId, startTime: pastHour() } as never,
      props: { isRoot: true },
      exact: true,
    });

    expect(count.toNumber()).toBe(712345);
    expect(captured).toHaveLength(1);
    expect(inline(captured[0]!)).not.toContain("toStartOfMinute");
  });
});

describe("an exact log count", () => {
  test("fails at its time limit instead of returning part of a count", () => {
    const sql: string = inline(
      LogService.toCountStatement({
        query: { projectId, time: pastHour() } as never,
        props: { isRoot: true },
        exact: true,
      }),
    );

    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).toContain("retentionDate >= now()");
  });
});
