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
  MAX_SCOPED_FINGERPRINTS,
  NO_MATCH_FINGERPRINT,
  applyExceptionFingerprintScope,
  buildExceptionInstanceAttributeQuery,
  getExceptionAttributeScopeKey,
  getExceptionAttributeSelections,
  isExceptionAttributeFacetKey,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionsAttributeScope";

const PROJECT_ID: ObjectID = new ObjectID(
  "7c1b6b0e-0000-4000-8000-0000000000ee",
);
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T11:00:00.000Z"),
);

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
        searchFieldFilters: {},
      });

    expect(selections).toEqual({
      "http.method": ["GET", "POST"],
      "attributes.weird": ["x"],
    });
  });

  test("unknown search fields are attributes; known backend fields are not", () => {
    const selections: ExceptionAttributeSelections =
      getExceptionAttributeSelections({
        facetGroups: {},
        searchFieldFilters: {
          "http.method": ["GET"],
          exceptionType: ["TypeError"],
          environment: ["prod"],
          primaryEntityId: ["svc"],
        },
      });

    expect(selections).toEqual({ "http.method": ["GET"] });
  });

  test("blank keys/values never become selections", () => {
    expect(
      getExceptionAttributeSelections({
        facetGroups: { "attributes.": ["x"], "attributes.k": ["  ", ""] },
        searchFieldFilters: {},
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

describe("getExceptionAttributeScopeKey", () => {
  test("is stable across selection insertion order", () => {
    const a: string = getExceptionAttributeScopeKey({
      selections: { b: ["2", "1"], a: ["x"] },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    const b: string = getExceptionAttributeScopeKey({
      selections: { a: ["x"], b: ["1", "2"] },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    expect(a).toBe(b);
  });

  test("changes when the window changes", () => {
    const a: string = getExceptionAttributeScopeKey({
      selections: { a: ["x"] },
      windowStartMs: 1,
      windowEndMs: 2,
    });
    const b: string = getExceptionAttributeScopeKey({
      selections: { a: ["x"] },
      windowStartMs: 1,
      windowEndMs: 3,
    });
    expect(a).not.toBe(b);
  });
});

describe("buildExceptionInstanceAttributeQuery", () => {
  test("ANDs every attribute on one instance query, equality for one value, membership for many", () => {
    const query: Record<string, unknown> = buildExceptionInstanceAttributeQuery(
      {
        projectId: PROJECT_ID,
        window: WINDOW,
        selections: {
          "http.method": ["GET", "POST"],
          host: ["web-1"],
        },
      },
    ) as Record<string, unknown>;

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
    // Unknown search fields no longer land on the Postgres query as columns.
    expect(source).toContain("KNOWN_EXCEPTION_SEARCH_FIELDS.includes(key)");
  });
});
