import { describe, expect, test } from "@jest/globals";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import ObjectID from "Common/Types/ObjectID";
import {
  ExceptionInstanceScope,
  MAX_SCOPED_FINGERPRINTS,
  NO_MATCH_FINGERPRINT,
  applyExceptionGroupQueryScope,
  buildExceptionEntityKeyScope,
  buildExceptionInstanceScopeQuery,
  getExceptionInstanceScopeKey,
  hasExceptionInstanceScope,
  mergeExceptionInstanceScopes,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";

const PROJECT_ID: ObjectID = new ObjectID(
  "7c1b6b0e-0000-4000-8000-0000000000ef",
);
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T11:00:00.000Z"),
);
const POD_A: string = "k8s.pod:checkout-a";
const POD_B: string = "k8s.pod:checkout-b";

function emptyScope(): ExceptionInstanceScope {
  return {
    attributeSelections: {},
    attributePredicates: {},
    columnPredicates: {},
  };
}

function entityKeyIncludes(scope: ExceptionInstanceScope): Includes {
  return scope.columnPredicates["entityKeys"]![0] as Includes;
}

describe("buildExceptionEntityKeyScope", () => {
  test("undefined, empty, and blank-only inputs do not trigger an instance lookup", () => {
    const inputs: Array<ReadonlyArray<string> | undefined> = [
      undefined,
      [],
      ["", "   ", "\t"],
    ];

    for (const input of inputs) {
      const scope: ExceptionInstanceScope = buildExceptionEntityKeyScope(input);

      expect(scope).toEqual(emptyScope());
      expect(hasExceptionInstanceScope(scope)).toBe(false);
    }
  });

  test("trims, de-duplicates, and sorts keys without mutating the caller's array", () => {
    const input: Array<string> = [` ${POD_B} `, POD_A, POD_B, "", ` ${POD_A}`];
    const original: Array<string> = [...input];

    const scope: ExceptionInstanceScope = buildExceptionEntityKeyScope(input);

    expect(input).toEqual(original);
    expect(entityKeyIncludes(scope)).toBeInstanceOf(Includes);
    expect(entityKeyIncludes(scope).values).toEqual([POD_A, POD_B]);
  });

  test("one key remains array membership rather than invalid scalar equality", () => {
    const scope: ExceptionInstanceScope = buildExceptionEntityKeyScope([POD_A]);

    expect(entityKeyIncludes(scope)).toBeInstanceOf(Includes);
    expect(entityKeyIncludes(scope).values).toEqual([POD_A]);
  });

  test("equivalent key sets produce one stable resolution cache key", () => {
    const a: string = getExceptionInstanceScopeKey({
      scope: buildExceptionEntityKeyScope([POD_B, POD_A, POD_A]),
      windowStartMs: WINDOW.startValue.getTime(),
      windowEndMs: WINDOW.endValue.getTime(),
    });
    const b: string = getExceptionInstanceScopeKey({
      scope: buildExceptionEntityKeyScope([POD_A, POD_B]),
      windowStartMs: WINDOW.startValue.getTime(),
      windowEndMs: WINDOW.endValue.getTime(),
    });

    expect(a).toBe(b);
  });

  test("changing the fixed entity changes the resolution cache key", () => {
    const a: string = getExceptionInstanceScopeKey({
      scope: buildExceptionEntityKeyScope([POD_A]),
      windowStartMs: WINDOW.startValue.getTime(),
      windowEndMs: WINDOW.endValue.getTime(),
    });
    const b: string = getExceptionInstanceScopeKey({
      scope: buildExceptionEntityKeyScope([POD_B]),
      windowStartMs: WINDOW.startValue.getTime(),
      windowEndMs: WINDOW.endValue.getTime(),
    });

    expect(a).not.toBe(b);
  });

  test("fixed keys intersect an existing entity-key predicate instead of replacing it", () => {
    const hostScope: ExceptionInstanceScope = {
      ...emptyScope(),
      columnPredicates: {
        entityKeys: [new Includes(["service:checkout"])],
      },
    };
    const merged: ExceptionInstanceScope = mergeExceptionInstanceScopes(
      hostScope,
      buildExceptionEntityKeyScope([POD_A]),
    );

    const query: Query<ExceptionInstance> = buildExceptionInstanceScopeQuery({
      projectId: PROJECT_ID,
      window: WINDOW,
      scope: merged,
    });
    const predicates: Array<Includes> = (query as Record<string, unknown>)[
      "entityKeys"
    ] as Array<Includes>;

    expect(predicates).toHaveLength(2);
    expect(
      predicates.every((predicate: Includes): boolean => {
        return predicate instanceof Includes;
      }),
    ).toBe(true);
    expect(
      predicates.map((predicate: Includes): Array<string> => {
        return predicate.values;
      }),
    ).toEqual(expect.arrayContaining([["service:checkout"], [POD_A]]));
  });

  test("entity, attribute, and column filters land on one bounded instance query", () => {
    const searchScope: ExceptionInstanceScope = {
      attributeSelections: {},
      attributePredicates: { region: [new Search("eu-")] },
      columnPredicates: {
        exceptionType: [new Includes(["TimeoutError"])],
      },
    };
    const merged: ExceptionInstanceScope = mergeExceptionInstanceScopes(
      searchScope,
      buildExceptionEntityKeyScope([POD_A, POD_B]),
    );

    const query: Record<string, unknown> = buildExceptionInstanceScopeQuery({
      projectId: PROJECT_ID,
      window: WINDOW,
      scope: merged,
    }) as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toBe(WINDOW);
    expect(query["entityKeys"]).toBeInstanceOf(Includes);
    expect((query["entityKeys"] as Includes).values).toEqual([POD_A, POD_B]);
    expect(query["exceptionType"]).toBeInstanceOf(Includes);
    expect(
      (query["attributes"] as Record<string, unknown>)["region"],
    ).toBeInstanceOf(Search);
  });
});

describe("applyExceptionGroupQueryScope", () => {
  test("without an instance scope, lastSeenAt carries the selected window", () => {
    const query: Query<TelemetryException> = {
      isResolved: false,
    } as Query<TelemetryException>;

    applyExceptionGroupQueryScope({
      query,
      window: WINDOW,
      instanceScopeKey: null,
      resolvedFingerprints: null,
    });

    const record: Record<string, unknown> = query as Record<string, unknown>;
    const lastSeenAt: InBetween<Date> = record["lastSeenAt"] as InBetween<Date>;
    expect(lastSeenAt).toBeInstanceOf(InBetween);
    expect(lastSeenAt.startValue).toEqual(WINDOW.startValue);
    expect(lastSeenAt.endValue).toEqual(WINDOW.endValue);
    expect(record).not.toHaveProperty("fingerprint");
    expect(record["isResolved"]).toBe(false);
  });

  test("resolved instance fingerprints replace lastSeenAt as the window scope", () => {
    const query: Query<TelemetryException> = {} as Query<TelemetryException>;

    applyExceptionGroupQueryScope({
      query,
      window: WINDOW,
      instanceScopeKey: "entity-scope-a",
      resolvedFingerprints: ["fp-a", "fp-b"],
    });

    const record: Record<string, unknown> = query as Record<string, unknown>;
    expect(record).not.toHaveProperty("lastSeenAt");
    expect(record["fingerprint"]).toBeInstanceOf(Includes);
    expect((record["fingerprint"] as Includes).values).toEqual([
      "fp-a",
      "fp-b",
    ]);
  });

  test.each([
    ["pending", null],
    ["resolved empty", []],
  ])(
    "a %s instance resolution fails closed",
    (_label: string, result: unknown) => {
      const query: Query<TelemetryException> = {} as Query<TelemetryException>;

      applyExceptionGroupQueryScope({
        query,
        window: WINDOW,
        instanceScopeKey: "entity-scope-a",
        resolvedFingerprints: result as Array<string> | null,
      });

      const record: Record<string, unknown> = query as Record<string, unknown>;
      expect(record).not.toHaveProperty("lastSeenAt");
      expect((record["fingerprint"] as Includes).values).toEqual([
        NO_MATCH_FINGERPRINT,
      ]);
    },
  );

  test("a historical match is not excluded when the group recurs later", () => {
    const query: Query<TelemetryException> = {} as Query<TelemetryException>;

    applyExceptionGroupQueryScope({
      query,
      window: WINDOW,
      instanceScopeKey: "entity-scope-a",
      resolvedFingerprints: ["fp-seen-inside-window"],
    });

    const record: Record<string, unknown> = query as Record<string, unknown>;
    expect(record).not.toHaveProperty("lastSeenAt");
    expect((record["fingerprint"] as Includes).values).toEqual([
      "fp-seen-inside-window",
    ]);
  });

  test("the fingerprint cap is retained through the group-scope helper", () => {
    const query: Query<TelemetryException> = {} as Query<TelemetryException>;
    const fingerprints: Array<string> = Array.from(
      { length: MAX_SCOPED_FINGERPRINTS + 3 },
      (_value: unknown, index: number): string => {
        return `fp-${index}`;
      },
    );

    applyExceptionGroupQueryScope({
      query,
      window: WINDOW,
      instanceScopeKey: "entity-scope-a",
      resolvedFingerprints: fingerprints,
    });

    expect(
      ((query as Record<string, unknown>)["fingerprint"] as Includes).values,
    ).toHaveLength(MAX_SCOPED_FINGERPRINTS);
  });
});
