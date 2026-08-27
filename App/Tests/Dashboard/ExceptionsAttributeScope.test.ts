import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import {
  EXCEPTION_ATTRIBUTE_FACET_PREFIX,
  ExceptionAttributeSelections,
  ExceptionInstanceScope,
  MAX_SCOPED_FINGERPRINTS,
  NO_MATCH_FINGERPRINT,
  applyExceptionFingerprintScope,
  buildExceptionInstanceScopeQuery,
  getExceptionAttributeSelections,
  getExceptionInstanceScopeKey,
  hasExceptionInstanceScope,
  isExceptionAttributeFacetKey,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";

const PROJECT_ID: ObjectID = new ObjectID(
  "7c1b6b0e-0000-4000-8000-0000000000ee",
);
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T11:00:00.000Z"),
);

function emptyScope(): ExceptionInstanceScope {
  return {
    attributeSelections: {},
    attributePredicates: {},
    columnPredicates: {},
  };
}

describe("getExceptionAttributeSelections", () => {
  test("splits attribute chips from column facets, stripping only the first prefix", () => {
    const selections: ExceptionAttributeSelections =
      getExceptionAttributeSelections({
        facetGroups: {
          "attributes.http.method": ["GET", "POST"],
          // Dots in the key survive — only the leading prefix strips.
          "attributes.attributes.weird": ["x"],
          exceptionType: ["TypeError"],
          primaryEntityId: ["some-service"],
        },
      });

    expect(selections).toEqual({
      "http.method": ["GET", "POST"],
      "attributes.weird": ["x"],
    });
  });

  test("blank keys/values never become selections", () => {
    expect(
      getExceptionAttributeSelections({
        facetGroups: { "attributes.": ["x"], "attributes.k": ["  ", ""] },
      }),
    ).toEqual({});
  });

  test("facet-key detection is exact about the prefix", () => {
    expect(isExceptionAttributeFacetKey("attributes.http.method")).toBe(true);
    expect(isExceptionAttributeFacetKey("attributes.")).toBe(false);
    expect(isExceptionAttributeFacetKey("exceptionType")).toBe(false);
    expect(EXCEPTION_ATTRIBUTE_FACET_PREFIX).toBe("attributes.");
  });
});

describe("hasExceptionInstanceScope", () => {
  test("no filter of any kind means no cross-store round trip", () => {
    expect(hasExceptionInstanceScope(emptyScope())).toBe(false);
  });

  test.each([
    ["attributeSelections", { host: ["web-1"] }],
    ["attributePredicates", { host: ["web-1"] }],
    ["columnPredicates", { exceptionType: ["TypeError"] }],
  ])("a filter in %p resolves the scope", (key: string, value: unknown) => {
    const scope: ExceptionInstanceScope = {
      ...emptyScope(),
      [key]: value,
    } as ExceptionInstanceScope;

    expect(hasExceptionInstanceScope(scope)).toBe(true);
  });
});

describe("getExceptionInstanceScopeKey", () => {
  test("is stable across selection insertion order", () => {
    const a: string = getExceptionInstanceScopeKey({
      scope: {
        ...emptyScope(),
        attributeSelections: { b: ["2", "1"], a: ["x"] },
      },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    const b: string = getExceptionInstanceScopeKey({
      scope: {
        ...emptyScope(),
        attributeSelections: { a: ["x"], b: ["1", "2"] },
      },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    expect(a).toBe(b);
  });

  test("two equal operators are one key — a new object identity is not a new filter", () => {
    const a: string = getExceptionInstanceScopeKey({
      scope: {
        ...emptyScope(),
        columnPredicates: { k: [new Includes(["x"])] },
      },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    const b: string = getExceptionInstanceScopeKey({
      scope: {
        ...emptyScope(),
        columnPredicates: { k: [new Includes(["x"])] },
      },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    expect(a).toBe(b);
  });

  test("changes when the window changes", () => {
    const a: string = getExceptionInstanceScopeKey({
      scope: { ...emptyScope(), attributeSelections: { a: ["x"] } },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    const b: string = getExceptionInstanceScopeKey({
      scope: { ...emptyScope(), attributeSelections: { a: ["x"] } },
      windowStartMs: 1,
      windowEndMs: 3,
    });
    expect(a).not.toBe(b);
  });
});

describe("buildExceptionInstanceScopeQuery", () => {
  test("ANDs every attribute on one instance query, equality for one value, membership for many", () => {
    const query: Record<string, unknown> = buildExceptionInstanceScopeQuery({
      projectId: PROJECT_ID,
      window: WINDOW,
      scope: {
        ...emptyScope(),
        attributeSelections: {
          "http.method": ["GET", "POST"],
          host: ["web-1"],
        },
      },
    }) as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toBe(WINDOW);

    const attributes: Record<string, unknown> = query["attributes"] as Record<
      string,
      unknown
    >;
    expect(attributes["host"]).toBe("web-1");
    expect(attributes["http.method"]).toBeInstanceOf(Includes);
    expect((attributes["http.method"] as Includes).values).toEqual([
      "GET",
      "POST",
    ]);
  });
});

describe("applyExceptionFingerprintScope", () => {
  test("narrows to the resolved fingerprints, capped", () => {
    const query: Query<TelemetryException> = {} as Query<TelemetryException>;
    const fingerprints: Array<string> = Array.from(
      { length: MAX_SCOPED_FINGERPRINTS + 5 },
      (_: unknown, index: number) => {
        return `fp-${index}`;
      },
    );

    applyExceptionFingerprintScope(query, fingerprints);

    const scoped: Includes = (query as Record<string, unknown>)[
      "fingerprint"
    ] as Includes;
    expect(scoped).toBeInstanceOf(Includes);
    expect(scoped.values).toHaveLength(MAX_SCOPED_FINGERPRINTS);
  });

  test("an empty resolution injects the no-match sentinel — never the unfiltered list", () => {
    const query: Query<TelemetryException> = {} as Query<TelemetryException>;
    applyExceptionFingerprintScope(query, []);

    const scoped: Includes = (query as Record<string, unknown>)[
      "fingerprint"
    ] as Includes;
    expect(scoped.values).toEqual([NO_MATCH_FINGERPRINT]);
  });
});

describe("exceptions viewer wiring", () => {
  test("the viewer resolves, injects, and carries the scope everywhere counts are computed", () => {
    const source: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(source).toContain("getExceptionAttributeSelections");
    expect(source).toContain("applyExceptionFingerprintScope");
    expect(source).toContain("AnalyticsModelAPI.getList<ExceptionInstance>");
    // Histogram AND facets payloads carry the scope.
    expect(source.match(/payload\["fingerprints"\]/g)?.length).toBe(2);
    // Unknown search selections chip as attribute facets.
    expect(source).toContain(
      "`${EXCEPTION_ATTRIBUTE_FACET_PREFIX}${fieldKey}`",
    );
    /*
     * Attribute and operator filters reach the instance query rather than
     * the Postgres one, which has neither an attributes column nor a way to
     * tell the chart about the filter.
     */
    expect(source).toContain("buildExceptionInstanceScopeQuery");
    expect(source).toContain("columnPredicates");
  });
});
