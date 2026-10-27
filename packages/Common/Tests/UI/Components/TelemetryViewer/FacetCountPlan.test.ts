import { describe, expect, test } from "@jest/globals";
import {
  FacetCountAnswer,
  FacetCountRequestPart,
  mergeFacetCountAnswers,
  planFacetCountRequests,
  readFacetCountAnswer,
} from "../../../../UI/Components/TelemetryViewer/FacetCountPlan";

/*
 * How an explorer asks for its facet counts so that a facet with values
 * chosen is counted without its own selection: one request per chosen facet,
 * then one for every facet nothing is chosen in, with every filter. The
 * explorers' own wiring is rendered in Common's ExplorerFacetMultiSelect.
 */

const KEYS: Array<string> = ["primaryEntityId", "hostId", "statusCode", "kind"];

describe("planFacetCountRequests", () => {
  test("nothing chosen: the one request explorers always sent", () => {
    expect(
      planFacetCountRequests({ facetKeys: KEYS, selectedFacetKeys: [] }),
    ).toEqual([{ facetKeys: KEYS, withoutSelectionOf: null }]);
  });

  test("a chosen facet is counted on its own, without its selection; the rest together, last", () => {
    expect(
      planFacetCountRequests({
        facetKeys: KEYS,
        selectedFacetKeys: ["statusCode"],
      }),
    ).toEqual([
      { facetKeys: ["statusCode"], withoutSelectionOf: "statusCode" },
      {
        facetKeys: ["primaryEntityId", "hostId", "kind"],
        withoutSelectionOf: null,
      },
    ]);
  });

  test("several chosen facets: one request each, in the explorer's order, whatever order they were chosen in", () => {
    const parts: Array<FacetCountRequestPart> = planFacetCountRequests({
      facetKeys: KEYS,
      selectedFacetKeys: new Set<string>(["kind", "primaryEntityId"]),
    });

    expect(
      parts.map((part: FacetCountRequestPart): string | null => {
        return part.withoutSelectionOf;
      }),
    ).toEqual(["primaryEntityId", "kind", null]);
    expect(parts[2]!.facetKeys).toEqual(["hostId", "statusCode"]);
  });

  test("every facet chosen: no shared request at all", () => {
    const parts: Array<FacetCountRequestPart> = planFacetCountRequests({
      facetKeys: ["severityText", "primaryEntityId"],
      selectedFacetKeys: ["primaryEntityId", "severityText"],
    });

    expect(parts).toEqual([
      { facetKeys: ["severityText"], withoutSelectionOf: "severityText" },
      { facetKeys: ["primaryEntityId"], withoutSelectionOf: "primaryEntityId" },
    ]);
  });

  test("a chosen key the explorer does not count is ignored", () => {
    expect(
      planFacetCountRequests({
        facetKeys: KEYS,
        selectedFacetKeys: ["traceId", "durationUnixNano"],
      }),
    ).toEqual([{ facetKeys: KEYS, withoutSelectionOf: null }]);
  });

  test("a key listed twice is asked for once", () => {
    expect(
      planFacetCountRequests({
        facetKeys: ["kind", "kind", "statusCode"],
        selectedFacetKeys: [],
      }),
    ).toEqual([
      { facetKeys: ["kind", "statusCode"], withoutSelectionOf: null },
    ]);
  });

  test("never changes the lists it was handed", () => {
    const facetKeys: Array<string> = [...KEYS];
    const selected: Array<string> = ["statusCode"];

    planFacetCountRequests({ facetKeys, selectedFacetKeys: selected });

    expect(facetKeys).toEqual(KEYS);
    expect(selected).toEqual(["statusCode"]);
  });
});

describe("mergeFacetCountAnswers", () => {
  const parts: Array<FacetCountRequestPart> = planFacetCountRequests({
    facetKeys: KEYS,
    selectedFacetKeys: ["statusCode"],
  });

  test("each facet comes from the request that counted it", () => {
    const merged: FacetCountAnswer = mergeFacetCountAnswers(parts, [
      {
        facets: {
          statusCode: [
            { value: "2", count: 4 },
            { value: "1", count: 20 },
            { value: "0", count: 30 },
          ],
        },
        timedOutFacets: [],
      },
      {
        facets: {
          primaryEntityId: [{ value: "svc", count: 4 }],
          hostId: [],
          kind: [{ value: "SPAN_KIND_SERVER", count: 4 }],
        },
        timedOutFacets: [],
      },
    ]);

    expect(Object.keys(merged.facets).sort()).toEqual([
      "hostId",
      "kind",
      "primaryEntityId",
      "statusCode",
    ]);
    // The chosen facet keeps every value, the checked one among them.
    expect(merged.facets["statusCode"]).toHaveLength(3);
  });

  test("a facet an answer carries but its request did not count is left out", () => {
    const merged: FacetCountAnswer = mergeFacetCountAnswers(parts, [
      {
        facets: {
          statusCode: [{ value: "0", count: 30 }],
          // Not this request's to answer: the shared one counts kind.
          kind: [{ value: "stale", count: 999 }],
        },
        timedOutFacets: [],
      },
      {
        facets: { kind: [{ value: "SPAN_KIND_SERVER", count: 4 }] },
        timedOutFacets: [],
      },
    ]);

    expect(merged.facets["kind"]).toEqual([
      { value: "SPAN_KIND_SERVER", count: 4 },
    ]);
  });

  test("the facets a request was stopped on are reported once, and only its own", () => {
    const merged: FacetCountAnswer = mergeFacetCountAnswers(parts, [
      { facets: { statusCode: [] }, timedOutFacets: ["statusCode", "kind"] },
      { facets: { kind: [] }, timedOutFacets: ["kind", "hostId"] },
    ]);

    expect(merged.timedOutFacets).toEqual(["statusCode", "hostId", "kind"]);
  });

  test("a missing answer leaves its facets out instead of throwing", () => {
    const merged: FacetCountAnswer = mergeFacetCountAnswers(parts, [
      {
        facets: { statusCode: [{ value: "2", count: 4 }] },
        timedOutFacets: [],
      },
    ]);

    expect(Object.keys(merged.facets)).toEqual(["statusCode"]);
  });
});

describe("readFacetCountAnswer", () => {
  test("reads facets and the facets stopped at the time limit", () => {
    expect(
      readFacetCountAnswer({
        facets: { kind: [{ value: "x", count: 1 }] },
        timedOutFacets: ["kind"],
      }),
    ).toEqual({
      facets: { kind: [{ value: "x", count: 1 }] },
      timedOutFacets: ["kind"],
    });
  });

  test("anything else reads as no facets and nothing stopped", () => {
    for (const data of [
      null,
      undefined,
      {},
      { facets: [], timedOutFacets: "kind" },
      { facets: "x", timedOutFacets: [1, null] },
    ]) {
      expect(
        readFacetCountAnswer(data as Record<string, unknown> | null),
      ).toEqual({ facets: {}, timedOutFacets: [] });
    }
  });

  test("keeps only the names among the stopped facets", () => {
    expect(
      readFacetCountAnswer({ facets: {}, timedOutFacets: ["kind", 3, null] })
        .timedOutFacets,
    ).toEqual(["kind"]);
  });
});
