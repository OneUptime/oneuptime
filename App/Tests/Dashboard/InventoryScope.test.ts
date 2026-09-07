import { describe, expect, test } from "@jest/globals";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import {
  INVENTORY_SCOPE_SOURCE_PARAM,
  INVENTORY_SCOPE_STALE_PARAM,
  INVENTORY_SCOPE_TYPE_PARAM,
  InventoryScope,
  InventoryScopeQuery,
  buildInventoryScopeQuery,
  buildInventoryScopeQueryString,
  isInventoryScopeEmpty,
  parseInventoryScope,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryScope";
import { INVENTORY_STALE_AFTER_MINUTES } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryLiveness";

/*
 * The scope is the contract between the Overview's drill-downs and the Items
 * page. It travels through the URL, which means:
 *
 *   - it has to round-trip exactly (a link that loses its `stale=true` opens
 *     an unfiltered list instead of the selected drill-down), and
 *   - it is attacker-reachable, so parsing must validate against the real
 *     vocabularies rather than forwarding whatever the URL said into a model
 *     query.
 *
 * Both are checked here, plus the derived query fragment, so drill-downs
 * always load the selected inventory items.
 */

const NOW: Date = new Date("2026-08-13T12:00:00.000Z");

type ParseFromRecordFunction = (
  params: Record<string, string>,
) => InventoryScope;

const parseFromRecord: ParseFromRecordFunction = (
  params: Record<string, string>,
): InventoryScope => {
  return parseInventoryScope((paramName: string): string | null => {
    return params[paramName] ?? null;
  });
};

type ParseFromQueryStringFunction = (queryString: string) => InventoryScope;

const parseFromQueryString: ParseFromQueryStringFunction = (
  queryString: string,
): InventoryScope => {
  const searchParams: URLSearchParams = new URLSearchParams(queryString);

  return parseInventoryScope((paramName: string): string | null => {
    return searchParams.get(paramName);
  });
};

describe("the empty scope", () => {
  test("parses out of an empty URL", () => {
    expect(parseFromRecord({})).toEqual({});
  });

  test("is recognised as empty", () => {
    expect(isInventoryScopeEmpty({})).toBe(true);
  });

  test("builds a clean URL rather than a bare question mark", () => {
    expect(buildInventoryScopeQueryString({})).toBe("");
  });

  test("adds nothing to the model query", () => {
    expect(buildInventoryScopeQuery({}, NOW)).toEqual({});
  });
});

describe("round-tripping through the URL", () => {
  const SCOPES: Array<InventoryScope> = [
    { entityType: EntityType.KubernetesPod },
    { source: EntitySource.Manual },
    { staleOnly: true },
    { source: EntitySource.Discovered, staleOnly: true },
    {
      entityType: EntityType.NetworkDevice,
      source: EntitySource.Inventory,
    },
    {
      entityType: EntityType.ExternalService,
      source: EntitySource.Manual,
      staleOnly: true,
    },
  ];

  test.each(SCOPES)(
    "%j survives a build/parse round trip",
    (scope: InventoryScope) => {
      expect(
        parseFromQueryString(buildInventoryScopeQueryString(scope)),
      ).toEqual(scope);
    },
  );

  test("every entity type round-trips, including the dotted ones", () => {
    for (const entityType of Object.values(EntityType)) {
      const queryString: string = buildInventoryScopeQueryString({
        entityType,
      });

      expect(parseFromQueryString(queryString).entityType).toBe(entityType);
    }
  });

  test("every source round-trips", () => {
    for (const source of Object.values(EntitySource)) {
      expect(
        parseFromQueryString(buildInventoryScopeQueryString({ source })).source,
      ).toBe(source);
    }
  });

  test("the built string uses the declared param names", () => {
    const queryString: string = buildInventoryScopeQueryString({
      entityType: EntityType.Host,
      source: EntitySource.Discovered,
      staleOnly: true,
    });

    expect(queryString.startsWith("?")).toBe(true);
    expect(queryString).toContain(`${INVENTORY_SCOPE_TYPE_PARAM}=`);
    expect(queryString).toContain(`${INVENTORY_SCOPE_SOURCE_PARAM}=`);
    expect(queryString).toContain(`${INVENTORY_SCOPE_STALE_PARAM}=true`);
  });
});

describe("parsing rejects anything it does not recognise", () => {
  test("an unknown entity type is dropped, not forwarded", () => {
    expect(
      parseFromRecord({ [INVENTORY_SCOPE_TYPE_PARAM]: "k8s.wombat" }),
    ).toEqual({});
  });

  test("an unknown source is dropped", () => {
    expect(
      parseFromRecord({ [INVENTORY_SCOPE_SOURCE_PARAM]: "smuggled" }),
    ).toEqual({});
  });

  test("a SQL-ish payload never reaches the query", () => {
    const scope: InventoryScope = parseFromRecord({
      [INVENTORY_SCOPE_TYPE_PARAM]: "'; DROP TABLE InventoryItem;--",
    });

    expect(scope).toEqual({});
    expect(buildInventoryScopeQuery(scope, NOW)).toEqual({});
  });

  test("a valid value alongside an invalid one keeps only the valid one", () => {
    expect(
      parseFromRecord({
        [INVENTORY_SCOPE_TYPE_PARAM]: "nope",
        [INVENTORY_SCOPE_SOURCE_PARAM]: EntitySource.Manual,
      }),
    ).toEqual({ source: EntitySource.Manual });
  });

  test("the stale flag only accepts the exact string 'true'", () => {
    // Anything truthy-looking would make `?stale=false` filter the list.
    for (const value of ["false", "1", "yes", "TRUE", ""]) {
      expect(
        parseFromRecord({ [INVENTORY_SCOPE_STALE_PARAM]: value }).staleOnly,
      ).toBeUndefined();
    }

    expect(
      parseFromRecord({ [INVENTORY_SCOPE_STALE_PARAM]: "true" }).staleOnly,
    ).toBe(true);
  });

  test("empty param values are ignored", () => {
    expect(
      parseFromRecord({
        [INVENTORY_SCOPE_TYPE_PARAM]: "",
        [INVENTORY_SCOPE_SOURCE_PARAM]: "",
      }),
    ).toEqual({});
  });
});

describe("the model query fragment", () => {
  test("a type scope narrows by entityType", () => {
    expect(
      buildInventoryScopeQuery({ entityType: EntityType.Container }, NOW),
    ).toEqual({ entityType: EntityType.Container });
  });

  test("a source scope narrows by source", () => {
    expect(
      buildInventoryScopeQuery({ source: EntitySource.Inventory }, NOW),
    ).toEqual({ source: EntitySource.Inventory });
  });

  test("a stale scope becomes a lastSeenAt cutoff", () => {
    const query: InventoryScopeQuery = buildInventoryScopeQuery(
      { staleOnly: true },
      NOW,
    );

    expect(query.lastSeenAt).toBeInstanceOf(LessThan);
  });

  test("the cutoff is exactly the staleness threshold, not a second copy of it", () => {
    /*
     * If the query used its own number, the "Gone Quiet" tile's count and the
     * list it opens would disagree at the margin — the worst kind of wrong,
     * because both look plausible.
     */
    const query: InventoryScopeQuery = buildInventoryScopeQuery(
      { staleOnly: true },
      NOW,
    );

    const cutoff: Date = query.lastSeenAt!.value;

    expect(NOW.getTime() - cutoff.getTime()).toBe(
      INVENTORY_STALE_AFTER_MINUTES * 60 * 1000,
    );
  });

  test("a combined scope carries all three narrowings", () => {
    const query: InventoryScopeQuery = buildInventoryScopeQuery(
      {
        entityType: EntityType.Service,
        source: EntitySource.Discovered,
        staleOnly: true,
      },
      NOW,
    );

    expect(query.entityType).toBe(EntityType.Service);
    expect(query.source).toBe(EntitySource.Discovered);
    expect(query.lastSeenAt).toBeInstanceOf(LessThan);
  });

  test("the query is derived from the passed clock, not the wall clock", () => {
    const earlier: Date = new Date("2020-01-01T00:00:00.000Z");

    const query: InventoryScopeQuery = buildInventoryScopeQuery(
      { staleOnly: true },
      earlier,
    );

    expect(query.lastSeenAt!.value.getTime()).toBeLessThan(earlier.getTime());
  });
});
