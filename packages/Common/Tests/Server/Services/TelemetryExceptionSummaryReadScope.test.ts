import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { TelemetryReadScope } from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The exceptions overview counts unresolved exception groups per resource
 * with one GROUP BY over the whole project. A caller whose exception read
 * is limited counts only the resources whose exceptions they may read, and
 * a block with labels takes its resources out of the counts.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceA: string = ObjectID.generate().toString();
const serviceC: string = ObjectID.generate().toString();

const props: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: ObjectID.generate(),
};

interface WhereCall {
  sql: string;
  parameters: Record<string, unknown> | undefined;
}

let whereCalls: Array<WhereCall>;
let builderUsed: boolean;
interface ScopeSpy {
  mockResolvedValue: (scope: TelemetryReadScope) => unknown;
}

let scopeSpy: ScopeSpy;

function fakeQueryBuilder(): unknown {
  const builder: Record<string, unknown> = {};
  const chain: () => unknown = (): unknown => {
    return builder;
  };

  builder["andWhere"] = (
    sql: string,
    parameters?: Record<string, unknown>,
  ): unknown => {
    whereCalls.push({ sql, parameters });
    return builder;
  };
  builder["where"] = builder["andWhere"];
  builder["select"] = chain;
  builder["addSelect"] = chain;
  builder["groupBy"] = chain;
  builder["addGroupBy"] = chain;
  builder["orderBy"] = chain;
  builder["getRawMany"] = async (): Promise<Array<Record<string, string>>> => {
    return [
      {
        primaryEntityId: serviceA,
        primaryEntityType: "Service",
        unresolvedCount: "3",
        totalOccurrences: "12",
      },
    ];
  };

  return builder;
}

beforeEach(() => {
  whereCalls = [];
  builderUsed = false;

  jest.spyOn(ModelPermission, "checkReadQueryPermission").mockResolvedValue({
    query: {},
    select: null,
    relationSelect: {},
  } as never);

  jest
    .spyOn(TelemetryExceptionService, "getQueryBuilder")
    .mockImplementation((() => {
      builderUsed = true;
      return fakeQueryBuilder();
    }) as never);

  scopeSpy = jest.spyOn(
    AnalyticsModelPermission,
    "getReadScopeForPermissions",
  ) as unknown as ScopeSpy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function summarise(scope: TelemetryReadScope): Promise<Array<unknown>> {
  scopeSpy.mockResolvedValue(scope);

  return await (
    TelemetryExceptionService as unknown as {
      aggregateUnresolvedByService: (
        projectId: ObjectID,
        props: DatabaseCommonInteractionProps,
      ) => Promise<Array<unknown>>;
    }
  ).aggregateUnresolvedByService(projectId, props);
}

function resourceConditions(): Array<WhereCall> {
  return whereCalls.filter((call: WhereCall): boolean => {
    return (
      call.sql.includes('"primaryEntityId" IN') ||
      call.sql.includes('"primaryEntityId" NOT IN')
    );
  });
}

describe("the exceptions overview counts only what the caller may read", () => {
  test("its scope is the one every read of exception groups follows, for this caller", async () => {
    await summarise({ readableIds: null, blockedIds: [] });

    expect(
      AnalyticsModelPermission.getReadScopeForPermissions,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        props: props,
        permissions: new TelemetryException().readRecordPermissions,
        includeProjectScope: true,
        operation: DatabaseRequestType.Read,
      }),
    );
  });

  test("a project-wide caller counts every resource", async () => {
    const summaries: Array<unknown> = await summarise({
      readableIds: null,
      blockedIds: [],
    });

    expect(resourceConditions()).toEqual([]);
    expect(summaries).toHaveLength(1);
    // Still the caller's project only.
    expect(
      whereCalls.some((call: WhereCall): boolean => {
        return call.parameters?.["projectId"] === projectId.toString();
      }),
    ).toBe(true);
  });

  test("a limited caller counts only the resources they may read", async () => {
    await summarise({ readableIds: [serviceA], blockedIds: [] });

    expect(resourceConditions()).toEqual([
      {
        sql: '"TelemetryException"."primaryEntityId" IN (:...readableResourceIds)',
        parameters: { readableResourceIds: [serviceA] },
      },
    ]);
  });

  test("a block with labels takes its resources out of the counts", async () => {
    await summarise({ readableIds: null, blockedIds: [serviceC] });

    expect(resourceConditions()).toEqual([
      {
        sql: '"TelemetryException"."primaryEntityId" NOT IN (:...blockedResourceIds)',
        parameters: { blockedResourceIds: [serviceC] },
      },
    ]);
  });

  test("a blocked resource is left out of a limited caller's list too", async () => {
    await summarise({
      readableIds: [serviceA, serviceC],
      blockedIds: [serviceC],
    });

    expect(resourceConditions()).toEqual([
      {
        sql: '"TelemetryException"."primaryEntityId" IN (:...readableResourceIds)',
        parameters: { readableResourceIds: [serviceA] },
      },
      {
        sql: '"TelemetryException"."primaryEntityId" NOT IN (:...blockedResourceIds)',
        parameters: { blockedResourceIds: [serviceC] },
      },
    ]);
  });

  test("a caller who may read no resource gets no counts, and nothing is queried", async () => {
    expect(await summarise({ readableIds: [], blockedIds: [] })).toEqual([]);
    expect(builderUsed).toBe(false);
  });
});
