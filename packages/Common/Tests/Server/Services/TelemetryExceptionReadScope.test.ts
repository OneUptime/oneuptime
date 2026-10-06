import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN EXCEPTION GROUP IS READ AS THE TELEMETRY IT CAME FROM.
 *
 * The exceptions list, its counts, and changes to a group reach only the
 * groups of the resources the caller's grants for that operation reach
 * (TelemetryExceptionService.addExceptionScope). The scope itself is the
 * one every telemetry read follows (TelemetryReadScopeResolution.test.ts
 * pins how it is worked out); here it is handed in, and what is pinned is
 * how each scope narrows the query.
 */

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const serviceA: string = ObjectID.generate().toString();
const serviceC: string = ObjectID.generate().toString();

const memberProps: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: ObjectID.generate(),
};

type ScopeResolver = (data: {
  props: DatabaseCommonInteractionProps;
}) => Promise<TelemetryReadScope>;

let scopeSpy: {
  mockImplementation: (resolver: ScopeResolver) => unknown;
  mock: { calls: Array<Array<unknown>> };
};

beforeEach(() => {
  scopeSpy = jest.spyOn(
    AnalyticsModelPermission,
    "getReadScopeForPermissions",
  ) as unknown as typeof scopeSpy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function withScope(scope: TelemetryReadScope): void {
  scopeSpy.mockImplementation(async (): Promise<TelemetryReadScope> => {
    return scope;
  });
}

async function scoped(
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = memberProps,
  operation: DatabaseRequestType = DatabaseRequestType.Read,
): Promise<Record<string, unknown>> {
  return await TelemetryExceptionService.addExceptionScope(
    query,
    props,
    operation,
  );
}

// Every SQL fragment a condition (or an AND of conditions) carries.
function sqlOf(operator: unknown, alias: string): string {
  const findOperator: FindOperator<unknown> = operator as FindOperator<unknown>;

  if (findOperator.type === "and") {
    return (findOperator.value as unknown as Array<unknown>)
      .map((child: unknown): string => {
        return sqlOf(child, alias);
      })
      .join(" AND ");
  }

  if (findOperator.type === "in") {
    return `${alias} IN (${JSON.stringify(findOperator.value)})`;
  }

  if (findOperator.type === "equal") {
    return `${alias} = ${JSON.stringify(findOperator.value)}`;
  }

  return findOperator.getSql!(alias);
}

function parametersOf(operator: unknown): Array<unknown> {
  const findOperator: FindOperator<unknown> = operator as FindOperator<unknown>;

  if (findOperator.type === "and") {
    return (findOperator.value as unknown as Array<unknown>).flatMap(
      parametersOf,
    );
  }

  return Object.values(findOperator.objectLiteralParameters || {});
}

describe("exception groups follow the caller's telemetry scope", () => {
  test("a caller whose grants reach the whole project reads every group", async () => {
    withScope(TelemetryReadScopeUtil.getUnrestrictedScope());

    expect(await scoped({ projectId })).toEqual({ projectId });
  });

  test("root and master admins are not narrowed, and no scope is worked out", async () => {
    expect(await scoped({ projectId }, { isRoot: true })).toEqual({
      projectId,
    });
    expect(await scoped({ projectId }, { isMasterAdmin: true })).toEqual({
      projectId,
    });
    expect(scopeSpy.mock.calls).toHaveLength(0);
  });

  test("a label or Owned grant reads the groups of the resources it reaches", async () => {
    withScope({
      readableIds: [serviceA, projectId.toString()],
      blockedIds: [],
    });

    const query: Record<string, unknown> = await scoped({ projectId });

    expect(query["primaryEntityId"]).toBeInstanceOf(FindOperator);
    expect(sqlOf(query["primaryEntityId"], "entityId")).toContain(
      "entityId IN (",
    );
    expect(parametersOf(query["primaryEntityId"])).toEqual([
      [serviceA, projectId.toString()],
    ]);
    // The project is still the caller's.
    expect(query["projectId"]).toBe(projectId);
  });

  test("a grant that reaches no resource reads no group", async () => {
    withScope({ readableIds: [], blockedIds: [] });

    const query: Record<string, unknown> = await scoped({ projectId });

    expect(parametersOf(query["primaryEntityId"])).toEqual([
      [TelemetryReadScopeUtil.NO_RESOURCE_ID],
    ]);
  });

  test("a block with labels leaves out the groups of the resources carrying them, and keeps groups of no resource", async () => {
    withScope({ readableIds: null, blockedIds: [serviceC] });

    const query: Record<string, unknown> = await scoped({ projectId });
    const sql: string = sqlOf(query["primaryEntityId"], "entityId");

    expect(sql).toContain("entityId NOT IN (");
    expect(sql).toContain("entityId IS NULL");
    expect(parametersOf(query["primaryEntityId"])).toEqual([[serviceC]]);
  });

  test("the caller's own resource filter is kept next to the scope", async () => {
    withScope({ readableIds: [serviceA], blockedIds: [] });

    const query: Record<string, unknown> = await scoped({
      projectId,
      primaryEntityId: new Includes([serviceA, serviceC]),
    });

    const combined: FindOperator<unknown> = query[
      "primaryEntityId"
    ] as FindOperator<unknown>;
    expect(combined.type).toBe("and");
    expect(JSON.stringify(combined)).toContain(serviceC);
    expect(JSON.stringify(combined)).toContain(serviceA);
  });

  test("a filter on the resource it cannot keep next to the scope is refused, not dropped", async () => {
    withScope({ readableIds: [serviceA], blockedIds: [] });

    await expect(
      scoped({ projectId, primaryEntityId: { nested: "shape" } }),
    ).rejects.toThrow(BadDataException);
  });

  test("a block with no labels refuses the read", async () => {
    scopeSpy.mockImplementation(async (): Promise<TelemetryReadScope> => {
      throw new NotAuthorizedException("blocked");
    });

    await expect(scoped({ projectId })).rejects.toThrow(NotAuthorizedException);
  });

  test("each operation is weighed by the model's own list for it", async () => {
    withScope(TelemetryReadScopeUtil.getUnrestrictedScope());

    const model: TelemetryException = new TelemetryException();

    for (const [operation, permissions] of [
      [DatabaseRequestType.Read, model.readRecordPermissions],
      [DatabaseRequestType.Update, model.updateRecordPermissions],
      [DatabaseRequestType.Delete, model.deleteRecordPermissions],
    ] as Array<[DatabaseRequestType, unknown]>) {
      await scoped({ projectId }, memberProps, operation);

      const call: Record<string, unknown> = scopeSpy.mock.calls[
        scopeSpy.mock.calls.length - 1
      ]![0] as Record<string, unknown>;

      expect([operation, call["permissions"], call["operation"]]).toEqual([
        operation,
        permissions,
        operation,
      ]);
      // Unattributed groups belong to the project: an Owned grant reads them.
      expect(call["includeProjectScope"]).toBe(true);
    }
  });
});

/*
 * A read that names no project reads every project the caller belongs to;
 * each project's groups follow the caller's scope in THAT project, so
 * leaving the project out of the request reads no more than naming it.
 */
describe("a read across the caller's projects", () => {
  const acrossProjects: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [],
      projectIds: [projectId, otherProjectId],
    },
  };

  test("narrows each project by the caller's scope there", async () => {
    scopeSpy.mockImplementation(
      async (data: {
        props: DatabaseCommonInteractionProps;
      }): Promise<TelemetryReadScope> => {
        return data.props.tenantId?.toString() === projectId.toString()
          ? { readableIds: [serviceA], blockedIds: [] }
          : TelemetryReadScopeUtil.getUnrestrictedScope();
      },
    );

    const query: Record<string, unknown> = await scoped({}, acrossProjects);

    const sql: string = sqlOf(query["_id"], "groupId");
    // The project with a narrower scope is read through its own condition...
    expect(sql).toContain(
      'groupId IN (SELECT "TelemetryException"."_id" FROM "TelemetryException" WHERE "TelemetryException"."primaryEntityId" IN (',
    );
    // ...and the project read in full is read in full.
    expect(sql).toContain(
      'groupId IN (SELECT "TelemetryException"."_id" FROM "TelemetryException" WHERE "TelemetryException"."projectId" IN (',
    );

    const parameters: Array<unknown> = parametersOf(query["_id"]);
    expect(parameters).toContainEqual([serviceA]);
    expect(parameters).toContainEqual([otherProjectId.toString()]);
    expect(parameters).toContainEqual([projectId.toString()]);
  });

  test("works each project's scope out with one props object a request, so it is looked up once", async () => {
    withScope(TelemetryReadScopeUtil.getUnrestrictedScope());

    await scoped({}, acrossProjects);
    await scoped({}, acrossProjects);

    const propsFor: (project: ObjectID) => Array<unknown> = (
      project: ObjectID,
    ): Array<unknown> => {
      return scopeSpy.mock.calls
        .map((call: Array<unknown>): unknown => {
          return (call[0] as { props: unknown }).props;
        })
        .filter((props: unknown): boolean => {
          return (
            (props as DatabaseCommonInteractionProps).tenantId?.toString() ===
            project.toString()
          );
        });
    };

    for (const eachProject of [projectId, otherProjectId]) {
      const asked: Array<unknown> = propsFor(eachProject);
      expect(asked).toHaveLength(2);
      expect(asked[0]).toBe(asked[1]);
    }
  });

  test("is left alone when every project is read in full", async () => {
    withScope(TelemetryReadScopeUtil.getUnrestrictedScope());

    expect(await scoped({}, acrossProjects)).toEqual({});
  });
});
