import MetricTypeService from "../../../Server/Services/MetricTypeService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import { TelemetryReadScope } from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * THE METRIC CATALOGUE FOLLOWS THE SERVICES THAT REPORT IT.
 *
 * A metric type records the services that report it. A caller whose metric
 * grant reaches only some services sees the metric types one of those
 * services reports (and the ones no service reports - host, cluster and
 * device metrics); a block with labels takes away the metric types only
 * blocked services report. Reads, counts, updates and deletes all follow
 * the caller's grants for their own operation.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceA: string = ObjectID.generate().toString();
const serviceB: string = ObjectID.generate().toString();
const serviceC: string = ObjectID.generate().toString();

const JUNCTION: {
  joinTableName: string;
  ownerColumnName: string;
  relationColumnName: string;
} = {
  joinTableName: "MetricTypeService",
  ownerColumnName: "metricTypeId",
  relationColumnName: "serviceId",
};

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockReturnValue: (value: unknown) => unknown;
  mockResolvedValue: (value: unknown) => unknown;
  mockImplementation: (implementation: (...args: Array<any>) => any) => unknown;
}

function spyOn(target: unknown, method: string): Spy {
  return jest.spyOn(target as never, method as never) as unknown as Spy;
}

const userProps: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: ObjectID.generate(),
};

let scopeSpy: Spy;
let currentScope: TelemetryReadScope;

beforeEach(() => {
  spyOn(QueryUtil, "getManyToManyRelationMetadata").mockReturnValue(JUNCTION);

  currentScope = { readableIds: [serviceA, serviceB], blockedIds: [] };
  scopeSpy = spyOn(AnalyticsModelPermission, "getReadScopeForPermissions");
  scopeSpy.mockImplementation(async () => {
    return currentScope;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sqlOf(operator: unknown): string {
  return (operator as FindOperator<unknown>).getSql!('"MetricType"."_id"');
}

function parametersOf(operator: unknown): Array<string> {
  return Object.values(
    ((operator as FindOperator<unknown>).objectLiteralParameters ||
      {}) as Record<string, unknown>,
  ).flatMap((value: unknown) => {
    return Array.isArray(value) ? value.map(String) : [String(value)];
  });
}

describe("the catalogue condition", () => {
  test("a caller reaching every service with nothing blocked gets no condition", () => {
    expect(
      MetricTypeService.getCatalogueScopeClause({
        readableIds: null,
        blockedIds: [],
      }),
    ).toBeNull();
  });

  test("a limited caller sees the metric types a readable service reports, and those no service reports", () => {
    const clause: unknown = MetricTypeService.getCatalogueScopeClause({
      readableIds: [serviceA, serviceB],
      blockedIds: [],
    });

    const sql: string = sqlOf(clause);
    expect(sql).toContain(
      'NOT EXISTS (SELECT 1 FROM "MetricTypeService" WHERE "MetricTypeService"."metricTypeId" = "MetricType"."_id")',
    );
    expect(sql).toContain('"MetricTypeService"."serviceId" IN (:...');
    expect(parametersOf(clause).sort()).toEqual([serviceA, serviceB].sort());
  });

  test("a caller reading no service sees only the metric types no service reports", () => {
    const clause: unknown = MetricTypeService.getCatalogueScopeClause({
      readableIds: [serviceC],
      blockedIds: [serviceC],
    });

    const sql: string = sqlOf(clause);
    expect(sql).toContain("NOT EXISTS");
    expect(sql).not.toContain(" OR EXISTS");
    expect(parametersOf(clause)).toEqual([]);
  });

  test("a block with labels takes away the metric types only blocked services report", () => {
    const clause: unknown = MetricTypeService.getCatalogueScopeClause({
      readableIds: null,
      blockedIds: [serviceC],
    });

    const sql: string = sqlOf(clause);
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain('"MetricTypeService"."serviceId" NOT IN (:...');
    expect(parametersOf(clause)).toEqual([serviceC]);
  });

  test("without the services relation the condition is refused, never dropped", () => {
    spyOn(QueryUtil, "getManyToManyRelationMetadata").mockReturnValue(null);

    expect(() => {
      MetricTypeService.getCatalogueScopeClause({
        readableIds: [serviceA],
        blockedIds: [],
      });
    }).toThrow(BadDataException);
  });
});

describe("the catalogue scope on a query", () => {
  test("root, master admins and requests with no project are left alone", async () => {
    for (const props of [
      { isRoot: true },
      { ...userProps, isMasterAdmin: true },
      { userId: ObjectID.generate() },
    ] as Array<DatabaseCommonInteractionProps>) {
      const query: Record<string, unknown> = { name: "http.server.duration" };
      expect(
        await MetricTypeService.addCatalogueScope(
          query,
          props,
          DatabaseRequestType.Read,
        ),
      ).toEqual({ name: "http.server.duration" });
    }
    expect(scopeSpy.mock.calls.length).toBe(0);
  });

  test("a caller reaching every service gets the query as it was", async () => {
    currentScope = { readableIds: null, blockedIds: [] };

    expect(
      await MetricTypeService.addCatalogueScope(
        { projectId },
        userProps,
        DatabaseRequestType.Read,
      ),
    ).toEqual({ projectId });
  });

  test("a limited caller's query is narrowed on the metric type's id", async () => {
    const query: Record<string, unknown> =
      await MetricTypeService.addCatalogueScope(
        { projectId } as Record<string, unknown>,
        userProps,
        DatabaseRequestType.Read,
      );

    expect(query["projectId"]).toEqual(projectId);
    expect(query["_id"]).toBeInstanceOf(FindOperator);
    expect(parametersOf(query["_id"]).sort()).toEqual(
      [serviceA, serviceB].sort(),
    );
  });

  test("a caller's own id filter is kept beside the catalogue condition", async () => {
    const metricTypeId: string = ObjectID.generate().toString();

    const query: Record<string, unknown> =
      await MetricTypeService.addCatalogueScope(
        { _id: metricTypeId } as Record<string, unknown>,
        userProps,
        DatabaseRequestType.Read,
      );

    const operator: FindOperator<unknown> = query[
      "_id"
    ] as FindOperator<unknown>;
    expect(operator.type).toBe("and");
    expect(JSON.stringify(parametersOfAll(operator))).toContain(metricTypeId);
  });

  test.each([
    [DatabaseRequestType.Read, "readRecordPermissions"],
    [DatabaseRequestType.Update, "updateRecordPermissions"],
    [DatabaseRequestType.Delete, "deleteRecordPermissions"],
  ] as Array<[DatabaseRequestType, keyof MetricType]>)(
    "a %s is scoped by the grants for that operation",
    async (operation: DatabaseRequestType, list: keyof MetricType) => {
      await MetricTypeService.addCatalogueScope(
        { projectId },
        userProps,
        operation,
      );

      const request: {
        permissions: Array<Permission>;
        operation: DatabaseRequestType;
      } = scopeSpy.mock.calls[0]![0] as {
        permissions: Array<Permission>;
        operation: DatabaseRequestType;
      };
      expect(request.permissions).toEqual(new MetricType()[list]);
      expect(request.operation).toBe(operation);
    },
  );
});

describe("a read across the caller's projects", () => {
  const projectP: ObjectID = ObjectID.generate();
  const projectQ: ObjectID = ObjectID.generate();
  const projectR: ObjectID = ObjectID.generate();

  function acrossProjects(
    data: { tenantId?: ObjectID } = {},
  ): DatabaseCommonInteractionProps {
    return {
      userId: ObjectID.generate(),
      ...(data.tenantId ? { tenantId: data.tenantId } : {}),
      isMultiTenantRequest: true,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [projectP, projectQ, projectR],
        globalPermissions: [],
      },
    };
  }

  // Each project's scope, as the caller's grants in that project make it.
  function scopeInProject(
    scopes: Record<string, TelemetryReadScope | "refused">,
  ): void {
    scopeSpy.mockImplementation(
      async (request: { props: DatabaseCommonInteractionProps }) => {
        const scope: TelemetryReadScope | "refused" | undefined =
          scopes[request.props.tenantId!.toString()];
        if (scope === "refused") {
          throw new NotAuthorizedException("blocked in this project");
        }
        return scope;
      },
    );
  }

  test("each project's metric types follow the caller's scope in that project", async () => {
    scopeInProject({
      [projectP.toString()]: { readableIds: null, blockedIds: [] },
      [projectQ.toString()]: { readableIds: [serviceA], blockedIds: [] },
      [projectR.toString()]: "refused",
    });

    const query: Record<string, unknown> =
      await MetricTypeService.addCatalogueScope(
        {} as Record<string, unknown>,
        acrossProjects(),
        DatabaseRequestType.Read,
      );

    const sql: string = sqlOf(query["_id"]);
    const parameters: Array<string> = parametersOf(query["_id"]);

    // Project P reaches every service: all its metric types.
    expect(sql).toContain('"MetricType"."projectId" IN (:...mtWide_');
    expect(parameters).toContain(projectP.toString());
    // Project Q is limited: its metric types a readable service reports, or none does.
    expect(parameters).toContain(projectQ.toString());
    expect(parameters).toContain(serviceA);
    expect(sql).toContain("NOT EXISTS");
    // Project R refuses the read: nothing of it is added.
    expect(parameters).not.toContain(projectR.toString());

    // Each project's scope was worked out with that project's grants.
    const tenants: Array<string> = scopeSpy.mock.calls.map(
      (call: Array<unknown>): string => {
        const request: { props: DatabaseCommonInteractionProps } = call[0] as {
          props: DatabaseCommonInteractionProps;
        };
        expect(request.props.isMultiTenantRequest).toBe(false);
        return request.props.tenantId!.toString();
      },
    );
    expect(tenants.sort()).toEqual(
      [projectP, projectQ, projectR].map(String).sort(),
    );
  });

  test("a multi-project request naming one project still weighs every project on its own", async () => {
    scopeInProject({
      [projectP.toString()]: { readableIds: null, blockedIds: [] },
      [projectQ.toString()]: { readableIds: null, blockedIds: [serviceC] },
      [projectR.toString()]: { readableIds: null, blockedIds: [] },
    });

    const query: Record<string, unknown> =
      await MetricTypeService.addCatalogueScope(
        {} as Record<string, unknown>,
        acrossProjects({ tenantId: projectP }),
        DatabaseRequestType.Read,
      );

    // Project P reaching every service does not open project Q's blocked services.
    expect(sqlOf(query["_id"])).toContain("NOT IN (:...");
    expect(parametersOf(query["_id"])).toContain(serviceC);
  });

  test("every project reaching every service adds no condition", async () => {
    scopeInProject({
      [projectP.toString()]: { readableIds: null, blockedIds: [] },
      [projectQ.toString()]: { readableIds: null, blockedIds: [] },
      [projectR.toString()]: "refused",
    });

    expect(
      await MetricTypeService.addCatalogueScope(
        { name: "cpu" } as Record<string, unknown>,
        acrossProjects(),
        DatabaseRequestType.Read,
      ),
    ).toEqual({ name: "cpu" });
  });

  test("an error other than a refusal is not swallowed", async () => {
    scopeSpy.mockImplementation(async () => {
      throw new Error("lookup failed");
    });

    await expect(
      MetricTypeService.addCatalogueScope(
        {} as Record<string, unknown>,
        acrossProjects(),
        DatabaseRequestType.Read,
      ),
    ).rejects.toThrow("lookup failed");
  });
});

function parametersOfAll(operator: FindOperator<unknown>): Array<unknown> {
  if (operator.type === "and") {
    return (operator.value as Array<FindOperator<unknown>>).flatMap(
      (child: FindOperator<unknown>) => {
        return parametersOfAll(child);
      },
    );
  }
  if (operator.type === "equal") {
    return [operator.value];
  }
  return parametersOf(operator);
}

describe("every catalogue operation applies the scope", () => {
  type Hooks = {
    onBeforeFind: (findBy: unknown) => Promise<{ findBy: unknown }>;
    onBeforeUpdate: (updateBy: unknown) => Promise<{ updateBy: unknown }>;
    onBeforeDelete: (deleteBy: unknown) => Promise<{ deleteBy: unknown }>;
  };
  const hooks: Hooks = MetricTypeService as unknown as Hooks;

  function operationOfLastScope(): DatabaseRequestType {
    return (
      scopeSpy.mock.calls[scopeSpy.mock.calls.length - 1]![0] as {
        operation: DatabaseRequestType;
      }
    ).operation;
  }

  test("reads", async () => {
    const result: { findBy: unknown } = await hooks.onBeforeFind({
      query: { projectId },
      props: userProps,
    });

    expect(
      (result.findBy as { query: Record<string, unknown> }).query["_id"],
    ).toBeInstanceOf(FindOperator);
    expect(operationOfLastScope()).toBe(DatabaseRequestType.Read);
  });

  test("counts", async () => {
    const parentCount: Spy = spyOn(DatabaseService.prototype, "countBy");
    parentCount.mockResolvedValue(new PositiveNumber(0));

    await MetricTypeService.countBy({
      query: { projectId },
      props: userProps,
    });

    const countedQuery: Record<string, unknown> = (
      parentCount.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(countedQuery["_id"]).toBeInstanceOf(FindOperator);
    expect(operationOfLastScope()).toBe(DatabaseRequestType.Read);
  });

  test("updates", async () => {
    const parentUpdate: Spy = spyOn(
      ProjectReferencesService.prototype,
      "onBeforeUpdate",
    );
    parentUpdate.mockImplementation(async (updateBy: unknown) => {
      return { updateBy, carryForward: null };
    });

    const result: { updateBy: unknown } = await hooks.onBeforeUpdate({
      query: { projectId },
      data: { description: "changed" },
      props: userProps,
    });

    expect(
      (result.updateBy as { query: Record<string, unknown> }).query["_id"],
    ).toBeInstanceOf(FindOperator);
    expect(operationOfLastScope()).toBe(DatabaseRequestType.Update);
  });

  test("deletes", async () => {
    const result: { deleteBy: unknown } = await hooks.onBeforeDelete({
      query: { projectId },
      props: userProps,
    });

    expect(
      (result.deleteBy as { query: Record<string, unknown> }).query["_id"],
    ).toBeInstanceOf(FindOperator);
    expect(operationOfLastScope()).toBe(DatabaseRequestType.Delete);
  });
});
