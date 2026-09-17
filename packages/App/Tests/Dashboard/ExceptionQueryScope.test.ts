import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { MonitorStepExceptionMonitorUtil } from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import { SearchQueryValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  EMPTY_EXCEPTION_QUERY_SCOPE,
  ExceptionQueryScope,
  ExceptionScopeChip,
  buildExceptionQueryScope,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionQueryScope";
import {
  ExceptionInstanceScope,
  MAX_SCOPED_FINGERPRINTS,
  NO_MATCH_FINGERPRINT,
  applyExceptionFingerprintScope,
  buildExceptionInstanceScopeQuery,
  getExceptionInstanceScopeKey,
  hasExceptionInstanceScope,
  mergeExceptionInstanceScopes,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";

/*
 * The exceptions snapshot on an Alert / Incident page is the awkward signal:
 * the monitor stored a `Query<ExceptionInstance>` against ClickHouse
 * OCCURRENCES, while the exceptions explorer the page now embeds lists
 * Postgres exception GROUPS. `fingerprint` is the only join between them,
 * and the viewer already owns that join — one `GROUP BY fingerprint` read
 * narrows the list, the histogram and the facet counts together.
 *
 * So the stored query has to become an INSTANCE SCOPE, not a second filter
 * path on the group query. This file pins that translation, and the two
 * properties that make it safe: the host's filters AND with the user's
 * rather than replacing them, and nothing the reader cannot express is
 * dropped.
 */

const SERVICE_ID_A: string = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
).toString();
const SERVICE_ID_B: string = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
).toString();
const PROJECT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

function roundTrip(query: Query<ExceptionInstance>): Query<ExceptionInstance> {
  return JSONFunctions.deserialize(
    JSONFunctions.anyObjectToJSONObject(query as unknown as JSONObject),
  ) as unknown as Query<ExceptionInstance>;
}

function storedOnly(query: Query<ExceptionInstance>): JSONObject {
  return JSONFunctions.anyObjectToJSONObject(query as unknown as JSONObject);
}

function exceptionMonitorQuery(
  overrides: Partial<
    Parameters<typeof MonitorStepExceptionMonitorUtil.toAnalyticsQuery>[0]
  >,
): Query<ExceptionInstance> {
  return MonitorStepExceptionMonitorUtil.toAnalyticsQuery({
    ...MonitorStepExceptionMonitorUtil.getDefault(),
    ...overrides,
  });
}

const STORED: Query<ExceptionInstance> = exceptionMonitorQuery({
  telemetryServiceIds: [new ObjectID(SERVICE_ID_A), new ObjectID(SERVICE_ID_B)],
  entityKeys: ["service:checkout", "k8s.pod:checkout-abc"],
  exceptionTypes: ["TimeoutError", "TypeError"],
  message: "connection reset",
  lastXSecondsOfExceptions: 300,
});

const EMPTY_USER_SCOPE: ExceptionInstanceScope = {
  attributeSelections: {},
  attributePredicates: {},
  columnPredicates: {},
};

describe("a real exception monitor's stored query", () => {
  test("every key an exception monitor emits is accounted for", () => {
    expect(Object.keys(STORED).sort()).toEqual([
      "entityKeys",
      "exceptionType",
      "message",
      "primaryEntityId",
      "time",
    ]);
  });

  test("reads identically whether or not the page deserialized it", () => {
    for (const shape of [roundTrip(STORED), storedOnly(STORED)]) {
      const scope: ExceptionQueryScope = buildExceptionQueryScope(
        shape as Query<ExceptionInstance>,
      );

      expect(scope.hasScope).toBe(true);
      expect(
        scope.instanceScope.columnPredicates["primaryEntityId"],
      ).toHaveLength(1);
      expect(
        scope.instanceScope.columnPredicates["exceptionType"],
      ).toHaveLength(1);
      expect(scope.instanceScope.columnPredicates["message"]).toHaveLength(1);
      expect(scope.instanceScope.columnPredicates["entityKeys"]).toHaveLength(
        1,
      );
    }
  });

  test("the message stays a substring match", () => {
    /*
     * The monitor stores `new Search(message)`. Compiled as equality it would
     * match only exceptions whose entire message is the fragment, and the
     * alert would show none of the exceptions it fired on.
     */
    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      roundTrip(STORED),
    );
    const predicate: SearchQueryValue =
      scope.instanceScope.columnPredicates["message"]![0]!;

    expect(predicate).toBeInstanceOf(Search);
    expect((predicate as Search<string>).toString()).toBe("connection reset");
  });

  test("entityKeys stays a membership even for a single value", () => {
    /*
     * `entityKeys` is a ClickHouse ARRAY column: an Includes compiles to
     * hasAny(entityKeys, [...]), while a bare string would compare an array
     * against a scalar and match nothing at all.
     */
    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      roundTrip(exceptionMonitorQuery({ entityKeys: ["service:checkout"] })),
    );

    expect(
      scope.instanceScope.columnPredicates["entityKeys"]![0],
    ).toBeInstanceOf(Includes);
  });

  test("a single service id is a plain equality, keeping the fast path", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      roundTrip(
        exceptionMonitorQuery({
          telemetryServiceIds: [new ObjectID(SERVICE_ID_A)],
        }),
      ),
    );

    expect(scope.instanceScope.columnPredicates["primaryEntityId"]).toEqual([
      SERVICE_ID_A,
    ]);
  });

  test("the window becomes a pin and never a column predicate", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      roundTrip(STORED),
    );

    expect(scope.window).not.toBeNull();
    expect(
      scope.window!.endValue.getTime() - scope.window!.startValue.getTime(),
    ).toBe(300 * 1000);
    expect(scope.instanceScope.columnPredicates).not.toHaveProperty("time");
    expect(scope.instanceScope.columnQuery || {}).not.toHaveProperty("time");
  });

  test("projectId is dropped — the resolution query stamps its own", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      ...roundTrip(STORED),
      projectId: PROJECT_ID,
    } as Query<ExceptionInstance>);

    expect(scope.instanceScope.columnPredicates).not.toHaveProperty(
      "projectId",
    );
    expect(scope.instanceScope.columnQuery || {}).not.toHaveProperty(
      "projectId",
    );
  });

  test("every scoped dimension surfaces as a chip", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      roundTrip(STORED),
    );

    const byKey: (key: string) => Array<ExceptionScopeChip> = (
      key: string,
    ): Array<ExceptionScopeChip> => {
      return scope.chips.filter((chip: ExceptionScopeChip): boolean => {
        return chip.facetKey === key;
      });
    };

    expect(byKey("primaryEntityId")).toHaveLength(2);
    expect(
      byKey("exceptionType").map((c: ExceptionScopeChip) => {
        return c.value;
      }),
    ).toEqual(["TimeoutError", "TypeError"]);
    expect(byKey("entityKeys")).toHaveLength(2);
    expect(byKey("message")[0]!.value).toBe("connection reset");
    expect(byKey("message")[0]!.displayKey).toBe("Message");
  });

  test("attributes become attribute predicates, stringified for the map column", () => {
    /*
     * ClickHouse stores attributes as Map(String, String); a number written
     * as a number would compare against a column that only holds strings.
     */
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      attributes: { "http.status_code": 500, "http.route": "/checkout" },
    } as unknown as Query<ExceptionInstance>);

    expect(scope.instanceScope.attributePredicates).toEqual({
      "http.status_code": ["500"],
      "http.route": ["/checkout"],
    });
    expect(scope.instanceScope.attributeSelections).toEqual({});
  });
});

describe("nothing is dropped", () => {
  test("an unreadable value is forwarded verbatim on the raw fragment", () => {
    /*
     * Unlike the traces side there is no `notCarried` here: everything the
     * reader puts on the instance query constrains the list, the chart AND
     * the facet counts at once, because all three ride the resolved
     * fingerprints. So the only requirement is that nothing is lost.
     */
    const weird: unknown = { some: "operator we do not model" };
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      spanStatusCode: weird,
    } as unknown as Query<ExceptionInstance>);

    expect(scope.hasScope).toBe(true);
    expect(scope.instanceScope.columnQuery).toEqual({ spanStatusCode: weird });
  });

  test("an unreadable attributes value is forwarded rather than ignored", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      attributes: new Includes(["not-a-record"]),
    } as unknown as Query<ExceptionInstance>);

    expect(scope.hasScope).toBe(true);
    expect(scope.instanceScope.columnQuery).toHaveProperty("attributes");
  });

  test("an EMPTY membership scopes nothing and is skipped", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope({
      primaryEntityId: new Includes([]),
      exceptionType: new Includes([]),
    } as unknown as Query<ExceptionInstance>);

    expect(scope.hasScope).toBe(false);
    expect(scope.chips).toEqual([]);
  });

  test("null / undefined / non-object yield the empty scope", () => {
    for (const value of [null, undefined, [], "nope", 7]) {
      const scope: ExceptionQueryScope = buildExceptionQueryScope(
        value as unknown as Query<ExceptionInstance>,
      );

      expect(scope.hasScope).toBe(false);
      expect(scope.window).toBeNull();
    }
  });

  test("a window-only query pins the picker but scopes nothing", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      roundTrip(exceptionMonitorQuery({ lastXSecondsOfExceptions: 60 })),
    );

    expect(scope.window).not.toBeNull();
    expect(scope.hasScope).toBe(false);
    expect(EMPTY_EXCEPTION_QUERY_SCOPE.hasScope).toBe(false);
  });
});

describe("the host scope reaches the ClickHouse resolution query", () => {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-01-01T00:05:00.000Z"),
  );

  test("every host filter lands on the instance query, with the window and project", () => {
    const scope: ExceptionQueryScope = buildExceptionQueryScope(
      roundTrip(STORED),
    );

    const query: Record<string, unknown> = buildExceptionInstanceScopeQuery({
      projectId: PROJECT_ID,
      window: window,
      scope: scope.instanceScope,
    }) as unknown as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toBe(window);
    expect(query["exceptionType"]).toBeInstanceOf(Includes);
    expect(query["message"]).toBeInstanceOf(Search);
    expect(query["entityKeys"]).toBeInstanceOf(Includes);
    expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
  });

  test("the raw fragment is applied, but never over the window or project", () => {
    const query: Record<string, unknown> = buildExceptionInstanceScopeQuery({
      projectId: PROJECT_ID,
      window: window,
      scope: {
        ...EMPTY_USER_SCOPE,
        columnQuery: {
          release: "1.2.3",
          // A malicious/stale fragment must not be able to widen the window.
          time: new InBetween<Date>(new Date(0), new Date(1)),
          projectId: new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
        } as unknown as Query<ExceptionInstance>,
      },
    }) as unknown as Record<string, unknown>;

    expect(query["release"]).toBe("1.2.3");
    expect(query["time"]).toBe(window);
    expect(query["projectId"]).toBe(PROJECT_ID);
  });

  test("hasExceptionInstanceScope sees a fragment-only scope", () => {
    /*
     * Otherwise a host whose whole scope was unreadable would resolve nothing
     * and the viewer would show the UNFILTERED project-wide list.
     */
    expect(
      hasExceptionInstanceScope({
        ...EMPTY_USER_SCOPE,
        columnQuery: {
          release: "1.2.3",
        } as unknown as Query<ExceptionInstance>,
      }),
    ).toBe(true);
    expect(hasExceptionInstanceScope(EMPTY_USER_SCOPE)).toBe(false);
  });

  test("the resolution cache key changes when the fragment does", () => {
    /*
     * The key pairs a resolved fingerprint set with the filters that produced
     * it. A fragment left out of the key would let a stale resolution be
     * reused after the host's scope changed — the list would show another
     * event's exceptions.
     */
    const keyOf: (release: string) => string = (release: string): string => {
      return getExceptionInstanceScopeKey({
        scope: {
          ...EMPTY_USER_SCOPE,
          columnQuery: { release } as unknown as Query<ExceptionInstance>,
        },
        windowStartMs: 0,
        windowEndMs: 1000,
      });
    };

    expect(keyOf("1.2.3")).not.toBe(keyOf("1.2.4"));
    expect(keyOf("1.2.3")).toBe(keyOf("1.2.3"));
  });

  test("the key compares operators by value, not identity", () => {
    /*
     * Two equal filters are different objects on every render; identity
     * comparison would refetch the fingerprints forever.
     */
    const keyOf: () => string = (): string => {
      return getExceptionInstanceScopeKey({
        scope: {
          ...EMPTY_USER_SCOPE,
          columnQuery: {
            exceptionType: new Includes(["TimeoutError"]),
          } as unknown as Query<ExceptionInstance>,
        },
        windowStartMs: 0,
        windowEndMs: 1000,
      });
    };

    expect(keyOf()).toBe(keyOf());
  });
});

describe("mergeExceptionInstanceScopes", () => {
  test("predicates on the same column AND rather than replace", () => {
    /*
     * An incident pinned to `exceptionType IN (TimeoutError)` still means
     * that when the user types `@type:Timeout*`. Replacing would let a chip
     * silently widen the list past the event it belongs to.
     */
    const host: ExceptionInstanceScope = {
      ...EMPTY_USER_SCOPE,
      columnPredicates: { exceptionType: [new Includes(["TimeoutError"])] },
    };
    const user: ExceptionInstanceScope = {
      ...EMPTY_USER_SCOPE,
      columnPredicates: { exceptionType: [new Search<string>("Timeout")] },
    };

    const merged: ExceptionInstanceScope = mergeExceptionInstanceScopes(
      host,
      user,
    );

    expect(merged.columnPredicates["exceptionType"]).toHaveLength(2);
  });

  test("attribute predicates and selections merge without duplicating", () => {
    const merged: ExceptionInstanceScope = mergeExceptionInstanceScopes(
      {
        attributeSelections: { "http.route": ["/checkout"] },
        attributePredicates: { env: ["prod"] },
        columnPredicates: {},
      },
      {
        attributeSelections: { "http.route": ["/checkout", "/cart"] },
        attributePredicates: { region: ["eu"] },
        columnPredicates: {},
      },
    );

    expect(merged.attributeSelections["http.route"]).toEqual([
      "/checkout",
      "/cart",
    ]);
    expect(Object.keys(merged.attributePredicates).sort()).toEqual([
      "env",
      "region",
    ]);
  });

  test("raw fragments merge, with the overlay winning a shared key", () => {
    const merged: ExceptionInstanceScope = mergeExceptionInstanceScopes(
      {
        ...EMPTY_USER_SCOPE,
        columnQuery: {
          release: "host",
          environment: "prod",
        } as unknown as Query<ExceptionInstance>,
      },
      {
        ...EMPTY_USER_SCOPE,
        columnQuery: { release: "user" } as unknown as Query<ExceptionInstance>,
      },
    );

    expect(merged.columnQuery).toEqual({
      release: "user",
      environment: "prod",
    });
  });

  test("merging two empty scopes leaves no fragment key at all", () => {
    const merged: ExceptionInstanceScope = mergeExceptionInstanceScopes(
      EMPTY_USER_SCOPE,
      EMPTY_USER_SCOPE,
    );

    expect(hasExceptionInstanceScope(merged)).toBe(false);
    expect(merged.columnQuery).toBeUndefined();
  });

  test("an empty per-key list never creates a key", () => {
    const merged: ExceptionInstanceScope = mergeExceptionInstanceScopes(
      { ...EMPTY_USER_SCOPE, columnPredicates: { exceptionType: [] } },
      EMPTY_USER_SCOPE,
    );

    expect(merged.columnPredicates).toEqual({});
  });
});

describe("applyExceptionFingerprintScope, the group-side half of the join", () => {
  test("a resolved set narrows the group query", () => {
    const query: Query<TelemetryException> = {};

    applyExceptionFingerprintScope(query, ["fp1", "fp2"]);

    expect((query as Record<string, unknown>)["fingerprint"]).toBeInstanceOf(
      Includes,
    );
  });

  test("an empty resolution narrows to nothing, it does not widen", () => {
    /*
     * The failure mode this sentinel prevents: a scope that matched no
     * instances silently showing every exception in the project under an
     * incident's heading.
     */
    const query: Query<TelemetryException> = {};

    applyExceptionFingerprintScope(query, []);

    expect(
      ((query as Record<string, unknown>)["fingerprint"] as Includes).values,
    ).toEqual([NO_MATCH_FINGERPRINT]);
  });

  test("the fingerprint list is capped", () => {
    const many: Array<string> = Array.from(
      { length: MAX_SCOPED_FINGERPRINTS + 10 },
      (_unused: unknown, index: number): string => {
        return `fp-${index}`;
      },
    );
    const query: Query<TelemetryException> = {};

    applyExceptionFingerprintScope(query, many);

    expect(
      ((query as Record<string, unknown>)["fingerprint"] as Includes).values,
    ).toHaveLength(MAX_SCOPED_FINGERPRINTS);
  });
});
