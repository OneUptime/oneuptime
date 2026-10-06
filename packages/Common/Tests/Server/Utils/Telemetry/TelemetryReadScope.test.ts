import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * TelemetryReadScope applies a scope somebody else worked out
 * (ModelPermission.getReadScope) to the three shapes a telemetry read takes:
 * a check on one resource, an aggregation request's serviceIds /
 * excludedServiceIds, and an analytics model query. Every one of them must
 * keep the same promise: never wider than the scope, never an empty list
 * that an aggregation service would read as "the whole project".
 */

const NO_RESOURCE: string = ObjectID.getZeroObjectID().toString();

const serviceA: string = ObjectID.generate().toString();
const serviceB: string = ObjectID.generate().toString();
const serviceC: string = ObjectID.generate().toString();

function scope(
  readableIds: Array<string> | null,
  blockedIds: Array<string> = [],
): TelemetryReadScope {
  return { readableIds, blockedIds };
}

function ids(values: Array<ObjectID> | undefined): Array<string> | undefined {
  return values?.map((value: ObjectID): string => {
    return value.toString();
  });
}

describe("TelemetryReadScope: one resource", () => {
  test("the unrestricted scope reads every resource and blocks none", () => {
    const unrestricted: TelemetryReadScope =
      TelemetryReadScopeUtil.getUnrestrictedScope();

    expect(TelemetryReadScopeUtil.isProjectWide(unrestricted)).toBe(true);
    expect(TelemetryReadScopeUtil.isReadable(unrestricted, serviceA)).toBe(
      true,
    );
  });

  test("a scope limited to some resources reads exactly those", () => {
    const limited: TelemetryReadScope = scope([serviceA]);

    expect(TelemetryReadScopeUtil.isProjectWide(limited)).toBe(false);
    expect(TelemetryReadScopeUtil.isReadable(limited, serviceA)).toBe(true);
    expect(TelemetryReadScopeUtil.isReadable(limited, serviceB)).toBe(false);
    expect(
      TelemetryReadScopeUtil.isReadable(limited, new ObjectID(serviceA)),
    ).toBe(true);
  });

  test("an empty list reads nothing at all", () => {
    expect(TelemetryReadScopeUtil.isReadable(scope([]), serviceA)).toBe(false);
  });

  test("a blocked resource is not readable, whatever else the scope says", () => {
    expect(
      TelemetryReadScopeUtil.isReadable(scope(null, [serviceA]), serviceA),
    ).toBe(false);
    expect(
      TelemetryReadScopeUtil.isReadable(
        scope([serviceA], [serviceA]),
        serviceA,
      ),
    ).toBe(false);
    expect(
      TelemetryReadScopeUtil.isReadable(scope(null, [serviceA]), serviceB),
    ).toBe(true);
    expect(TelemetryReadScopeUtil.isProjectWide(scope(null, [serviceA]))).toBe(
      false,
    );
  });

  test("filterReadableIds keeps the readable ids in their order", () => {
    expect(
      TelemetryReadScopeUtil.filterReadableIds(
        scope([serviceC, serviceA], [serviceC]),
        [serviceA, serviceB, serviceC],
      ),
    ).toEqual([serviceA]);
  });
});

describe("TelemetryReadScope.toServiceFilter", () => {
  test("project-wide, nothing asked for: no filter at all", () => {
    const filter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(scope(null));

    expect(filter.serviceIds).toBeUndefined();
    expect(filter.excludedServiceIds).toBeUndefined();
  });

  test("project-wide, some asked for: exactly those", () => {
    expect(
      ids(
        TelemetryReadScopeUtil.toServiceFilter(scope(null), [
          serviceA,
          serviceB,
        ]).serviceIds,
      ),
    ).toEqual([serviceA, serviceB]);
  });

  test("an empty request list is no request", () => {
    expect(
      TelemetryReadScopeUtil.toServiceFilter(scope(null), []).serviceIds,
    ).toBeUndefined();
    expect(
      ids(
        TelemetryReadScopeUtil.toServiceFilter(scope([serviceA]), [])
          .serviceIds,
      ),
    ).toEqual([serviceA]);
  });

  test("a duplicated request is asked for once", () => {
    expect(
      ids(
        TelemetryReadScopeUtil.toServiceFilter(scope(null), [
          serviceA,
          new ObjectID(serviceA),
        ]).serviceIds,
      ),
    ).toEqual([serviceA]);
  });

  test("limited, nothing asked for: every service the scope reaches", () => {
    expect(
      ids(
        TelemetryReadScopeUtil.toServiceFilter(scope([serviceA, serviceB]))
          .serviceIds,
      ),
    ).toEqual([serviceA, serviceB]);
  });

  test("limited, some asked for: the ones the scope reaches", () => {
    expect(
      ids(
        TelemetryReadScopeUtil.toServiceFilter(scope([serviceA]), [
          serviceA,
          serviceB,
        ]).serviceIds,
      ),
    ).toEqual([serviceA]);
  });

  test("limited and asking only for others: a list that matches nothing, never an empty one", () => {
    expect(
      ids(
        TelemetryReadScopeUtil.toServiceFilter(scope([serviceA]), [serviceB])
          .serviceIds,
      ),
    ).toEqual([NO_RESOURCE]);
  });

  test("reaching nothing: a list that matches nothing, never no filter", () => {
    expect(
      ids(TelemetryReadScopeUtil.toServiceFilter(scope([])).serviceIds),
    ).toEqual([NO_RESOURCE]);
  });

  test("a labelled block leaves the blocked services out of every list", () => {
    const filter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(scope(null, [serviceB]));

    expect(filter.serviceIds).toBeUndefined();
    expect(ids(filter.excludedServiceIds)).toEqual([serviceB]);

    const asked: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(scope(null, [serviceB]), [
        serviceA,
        serviceB,
      ]);

    expect(ids(asked.serviceIds)).toEqual([serviceA]);
    expect(ids(asked.excludedServiceIds)).toEqual([serviceB]);
  });

  test("a labelled block and a label scope together", () => {
    const filter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(
        scope([serviceA, serviceB], [serviceB]),
      );

    expect(ids(filter.serviceIds)).toEqual([serviceA]);
    expect(ids(filter.excludedServiceIds)).toEqual([serviceB]);
  });

  test("asking only for a blocked service matches nothing", () => {
    expect(
      ids(
        TelemetryReadScopeUtil.toServiceFilter(scope(null, [serviceB]), [
          serviceB,
        ]).serviceIds,
      ),
    ).toEqual([NO_RESOURCE]);
  });
});

describe("TelemetryReadScope.appendServiceFilter", () => {
  function render(filter: TelemetryServiceFilter, column?: string): Statement {
    const statement: Statement = new Statement();
    TelemetryReadScopeUtil.appendServiceFilter(statement, filter, column);
    return statement;
  }

  test("nothing to filter adds nothing", () => {
    expect(render({}).query).toBe("");
    expect(render({ serviceIds: [], excludedServiceIds: [] }).query).toBe("");
  });

  test("serviceIds become an IN list on primaryEntityId", () => {
    const statement: Statement = render({
      serviceIds: [new ObjectID(serviceA), new ObjectID(serviceB)],
    });

    expect(statement.query).toContain("AND primaryEntityId IN (");
    expect(statement.query).not.toContain("NOT IN");
    expect(Object.values(statement.query_params)).toContainEqual([
      serviceA,
      serviceB,
    ]);
  });

  test("excludedServiceIds become a NOT IN list", () => {
    const statement: Statement = render({
      excludedServiceIds: [new ObjectID(serviceC)],
    });

    expect(statement.query).toContain("AND primaryEntityId NOT IN (");
    expect(statement.query).not.toContain("primaryEntityId IN (");
    expect(Object.values(statement.query_params)).toContainEqual([serviceC]);
  });

  test("both together, on another column when asked", () => {
    const statement: Statement = render(
      {
        serviceIds: [new ObjectID(serviceA)],
        excludedServiceIds: [new ObjectID(serviceC)],
      },
      "rumApplicationId",
    );

    expect(statement.query).toContain("AND rumApplicationId IN (");
    expect(statement.query).toContain("AND rumApplicationId NOT IN (");
  });

  test("a column that is not a plain identifier is refused, not written into the SQL", () => {
    for (const column of [
      "primaryEntityId) OR (1=1",
      "primary EntityId",
      "`primaryEntityId`",
      "1primaryEntityId",
      "",
    ]) {
      expect(() => {
        render({ serviceIds: [new ObjectID(serviceA)] }, column);
      }).toThrow("Invalid resource column");
    }
  });
});

describe("TelemetryReadScope.applyToQuery", () => {
  const column: string = "primaryEntityId";

  test("a project-wide scope leaves the query exactly as it was", () => {
    const query: Record<string, unknown> = { projectId: "p" };

    expect(
      TelemetryReadScopeUtil.applyToQuery(query, column, scope(null)),
    ).toEqual({ projectId: "p" });
  });

  test("a limited scope with no filter of the caller's: the readable ids", () => {
    const query: any = TelemetryReadScopeUtil.applyToQuery(
      {},
      column,
      scope([serviceA, serviceB], [serviceB]),
    );

    expect(query[column]).toBeInstanceOf(Includes);
    expect(query[column].values).toEqual([serviceA]);
  });

  test("a limited scope reaching nothing matches nothing", () => {
    const query: any = TelemetryReadScopeUtil.applyToQuery(
      {},
      column,
      scope([]),
    );

    expect(query[column].values).toEqual([NO_RESOURCE]);
  });

  test("the caller's own id is kept when readable and refused when not", () => {
    const readable: any = TelemetryReadScopeUtil.applyToQuery(
      { [column]: new ObjectID(serviceA) },
      column,
      scope([serviceA]),
    );
    expect(readable[column].values).toEqual([serviceA]);

    const unreadable: any = TelemetryReadScopeUtil.applyToQuery(
      { [column]: serviceB },
      column,
      scope([serviceA]),
    );
    expect(unreadable[column].values).toEqual([NO_RESOURCE]);
  });

  test("the caller's Includes is intersected, never widened", () => {
    const query: any = TelemetryReadScopeUtil.applyToQuery(
      { [column]: new Includes([serviceA, serviceC]) },
      column,
      scope([serviceA, serviceB]),
    );

    expect(query[column].values).toEqual([serviceA]);
  });

  test("a project-wide scope with a labelled block excludes the blocked resources", () => {
    const query: any = TelemetryReadScopeUtil.applyToQuery(
      { projectId: "p" },
      column,
      scope(null, [serviceB]),
    );

    expect(query[column]).toBeInstanceOf(IncludesNone);
    expect(query[column].values).toEqual([serviceB]);
  });

  test("a labelled block on a caller's own list drops the blocked id", () => {
    const query: any = TelemetryReadScopeUtil.applyToQuery(
      { [column]: new Includes([serviceA, serviceB]) },
      column,
      scope(null, [serviceB]),
    );

    expect(query[column]).toBeInstanceOf(Includes);
    expect(query[column].values).toEqual([serviceA]);
  });

  test("any other filter of the caller's stays next to the scope", () => {
    const notEqual: NotEqual<string> = new NotEqual<string>(serviceC);

    const limited: any = TelemetryReadScopeUtil.applyToQuery(
      { [column]: notEqual },
      column,
      scope([serviceA]),
    );
    expect(Array.isArray(limited[column])).toBe(true);
    expect(limited[column][0]).toBe(notEqual);
    expect(limited[column][1]).toBeInstanceOf(Includes);

    const blocked: any = TelemetryReadScopeUtil.applyToQuery(
      { [column]: [notEqual] },
      column,
      scope(null, [serviceB]),
    );
    expect(blocked[column]).toHaveLength(2);
    expect(blocked[column][0]).toBe(notEqual);
    expect(blocked[column][1]).toBeInstanceOf(IncludesNone);
  });

  test("a filter shape the column cannot combine falls back to the scope alone", () => {
    const query: any = TelemetryReadScopeUtil.applyToQuery(
      { [column]: { unexpected: true } },
      column,
      scope([serviceA]),
    );

    expect(query[column]).toBeInstanceOf(Includes);
    expect(query[column].values).toEqual([serviceA]);
  });
});
