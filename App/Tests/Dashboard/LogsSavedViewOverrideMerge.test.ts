import { beforeAll, describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";

/*
 * The one invariant this whole feature rests on: THE COMPILED QUERY AND THE
 * CHIP ROW DESCRIBE THE SAME SLICE.
 *
 * Nothing asserted that before, which is how the following shipped. When a
 * saved view is re-applied underneath a chip set carried in the URL — the
 * Viewer -> Insights -> Viewer trip, a refresh, back-from-detail — the view's
 * own predicates have to be stripped off its query first, because
 * applyLogsFacetFiltersToQuery only ever WRITES the keys a chip selection
 * holds. It cannot know that a chip the view carried was removed somewhere
 * else, and for `attributes` it merges into the existing object rather than
 * replacing it.
 *
 * The consequence of getting it wrong is not a visible error. It is a log
 * list silently narrowed by a filter the user removed, a chip row that does
 * not mention it, a histogram over the same window counting rows the list
 * excludes, and — if the user then updates the view — the removed filter
 * written back to the database.
 *
 * So these tests are written as a round trip rather than as examples:
 * strip, compile the chips on, read the chips back, and assert you get
 * exactly the chips you started with. A seventh chip group added to the
 * read-back without being added to the strip fails here.
 */

type MergeModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge");
type PivotModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");

let Merge: MergeModule;
let Pivot: PivotModule;

const SERVICE_A: string = "0195d6c1-0000-7000-8000-00000000000a";
const SERVICE_B: string = "0195d6c1-0000-7000-8000-00000000000b";
const CLUSTER_ID: string = "0195d6c1-0000-7000-8000-0000000000c1";

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  Merge = await import(
    "../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge"
  );
  Pivot = await import(
    "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
  );
});

function chips(
  entries: Array<[string, Array<string>]>,
): Map<string, Set<string>> {
  return new Map(
    entries.map(
      ([key, values]: [string, Array<string>]): [string, Set<string>] => {
        return [key, new Set(values)];
      },
    ),
  );
}

/*
 * The read-back half of the round trip, kept in step with the copy inside
 * LogsViewer.buildFacetFiltersFromQuery. Duplicated rather than imported
 * because that one lives inside a .tsx module that pulls in React and the
 * whole viewer; the wiring test asserts the viewer routes through the strip
 * helper, and this asserts the strip helper is correct.
 */
function readChipsBack(
  query: JSONObject,
  baseQuery: JSONObject,
): Map<string, Set<string>> {
  const back: Map<string, Set<string>> = new Map();

  const valuesOf: (value: unknown) => Array<string> = (
    value: unknown,
  ): Array<string> => {
    if (value instanceof Includes) {
      return value.values.map((item: unknown): string => {
        return String(item);
      });
    }

    if (value === undefined || value === null) {
      return [];
    }

    const text: string = String(value);

    return text.length > 0 ? [text] : [];
  };

  for (const facetKey of Merge.LOGS_CHIP_FACET_KEYS) {
    if (baseQuery[facetKey] !== undefined) {
      continue;
    }

    const values: Array<string> = valuesOf(query[facetKey]);

    if (values.length > 0) {
      back.set(facetKey, new Set(values));
    }
  }

  const attributes: Record<string, unknown> =
    (query["attributes"] as Record<string, unknown> | undefined) || {};
  const baseAttributes: Record<string, unknown> =
    (baseQuery["attributes"] as Record<string, unknown> | undefined) || {};

  for (const attributeKey of Object.keys(attributes)) {
    if (baseAttributes[attributeKey] !== undefined) {
      continue;
    }

    const values: Array<string> = valuesOf(attributes[attributeKey]);

    if (values.length > 0) {
      back.set(`attributes.${attributeKey}`, new Set(values));
    }
  }

  const resourceFilters: Record<string, Array<string>> = (query[
    "resourceFilters"
  ] as Record<string, Array<string>> | undefined) || {};

  for (const facetKey of Object.keys(resourceFilters)) {
    const values: Array<string> = resourceFilters[facetKey] || [];

    if (values.length > 0) {
      back.set(facetKey, new Set(values));
    }
  }

  return back;
}

function roundTrip(
  savedQuery: JSONObject,
  baseQuery: JSONObject,
  overrideChips: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const stripped: JSONObject = Merge.buildSavedViewQueryForOverrides({
    savedQuery,
    baseQuery,
  });

  const compiled: JSONObject = Pivot.applyLogsFacetFiltersToQuery(
    stripped as never,
    overrideChips,
  ) as unknown as JSONObject;

  return readChipsBack(compiled, baseQuery);
}

describe("the chip set survives compilation onto a stripped saved query", () => {
  const CASES: Array<{
    name: string;
    savedQuery: JSONObject;
    overrideChips: Map<string, Set<string>>;
  }> = [
    {
      name: "a service chip replacing a wider service selection",
      savedQuery: {
        primaryEntityId: new Includes([SERVICE_A, SERVICE_B]),
      } as unknown as JSONObject,
      overrideChips: chips([["primaryEntityId", [SERVICE_A]]]),
    },
    {
      name: "an attribute filter the user removed",
      savedQuery: {
        primaryEntityId: new Includes([SERVICE_A]),
        attributes: { team: "payments" },
      } as unknown as JSONObject,
      overrideChips: chips([["primaryEntityId", [SERVICE_A]]]),
    },
    {
      name: "attributes and resource filters together, both removed",
      savedQuery: {
        attributes: { team: "payments", env: "prod" },
        resourceFilters: { kubernetesClusterId: [CLUSTER_ID] },
        severityText: "Error",
      } as unknown as JSONObject,
      overrideChips: chips([["primaryEntityId", [SERVICE_B]]]),
    },
    {
      name: "an attributes-only saved view cleared to nothing",
      savedQuery: {
        attributes: { team: "payments" },
      } as unknown as JSONObject,
      overrideChips: chips([]),
    },
    {
      name: "a severity chip replacing a body search",
      savedQuery: {
        body: "connection refused",
      } as unknown as JSONObject,
      overrideChips: chips([["severityText", ["Error", "Fatal"]]]),
    },
    {
      name: "an attribute chip the user kept, alongside one they dropped",
      savedQuery: {
        attributes: { team: "payments", env: "prod" },
      } as unknown as JSONObject,
      overrideChips: chips([["attributes.team", ["payments"]]]),
    },
    {
      name: "every chip group at once",
      savedQuery: {
        severityText: "Warning",
        primaryEntityId: new Includes([SERVICE_A]),
        traceId: "old-trace",
        spanId: "old-span",
        body: "old text",
        attributes: { team: "payments" },
        resourceFilters: { hostId: ["old-host"] },
      } as unknown as JSONObject,
      overrideChips: chips([
        ["severityText", ["Error"]],
        ["primaryEntityId", [SERVICE_B]],
        ["attributes.env", ["prod"]],
        ["kubernetesClusterId", [CLUSTER_ID]],
      ]),
    },
  ];

  test.each(CASES)(
    "$name",
    (testCase: {
      name: string;
      savedQuery: JSONObject;
      overrideChips: Map<string, Set<string>>;
    }) => {
      expect(
        roundTrip(testCase.savedQuery, {}, testCase.overrideChips),
      ).toEqual(testCase.overrideChips);
    },
  );
});

describe("what the strip must not touch", () => {
  test("keeps a filter the host page pinned through baseQuery", () => {
    /*
     * A service's Logs tab pins its own primaryEntityId. That is the page's
     * scope, not the view's, and the user was never offered a chip for it —
     * so it must survive a strip that exists to honour chip removals.
     */
    const stripped: JSONObject = Merge.buildSavedViewQueryForOverrides({
      savedQuery: {
        primaryEntityId: new Includes([SERVICE_A]),
      } as unknown as JSONObject,
      baseQuery: {
        primaryEntityId: new Includes([SERVICE_B]),
      } as unknown as JSONObject,
    });

    expect(stripped["primaryEntityId"]).toBeDefined();
    expect((stripped["primaryEntityId"] as Includes<string>).values).toEqual([
      SERVICE_B,
    ]);
  });

  test("keeps an attribute the host pinned while dropping the view's", () => {
    const stripped: JSONObject = Merge.buildSavedViewQueryForOverrides({
      savedQuery: {
        attributes: { team: "payments", tenant: "acme" },
      } as unknown as JSONObject,
      baseQuery: {
        attributes: { tenant: "globex" },
      } as unknown as JSONObject,
    });

    expect(stripped["attributes"]).toEqual({ tenant: "globex" });
  });

  test("keeps everything the chips cannot express", () => {
    /*
     * A window, an entity scope, a session id. None of these is a chip, so
     * none of them is the user's to have removed — dropping them would move
     * the view off the moment or the resource it is about.
     */
    const time: InBetween<Date> = new InBetween<Date>(
      new Date("2026-08-20T00:00:00.000Z"),
      new Date("2026-08-21T00:00:00.000Z"),
    );

    const stripped: JSONObject = Merge.buildSavedViewQueryForOverrides({
      savedQuery: {
        time,
        entityScope: {
          entityKeys: ["k1"],
          attributeKey: "host.name",
          attributeValue: "web-3",
        },
        sessionId: "session-1",
        primaryEntityId: new Includes([SERVICE_A]),
      } as unknown as JSONObject,
      baseQuery: {} as unknown as JSONObject,
    });

    expect(stripped["time"]).toBe(time);
    expect(stripped["entityScope"]).toEqual({
      entityKeys: ["k1"],
      attributeKey: "host.name",
      attributeValue: "web-3",
    });
    expect(stripped["sessionId"]).toBe("session-1");
    // ...while the chip-able one is gone.
    expect(stripped["primaryEntityId"]).toBeUndefined();
  });

  test("does not mutate the saved view it was handed", () => {
    /*
     * The input is the object held inside the loaded saved-views state.
     * Deleting keys off it — or off its nested attributes, which a shallow
     * spread shares — would corrupt that view for the rest of the session,
     * and the corruption would then be written back on the next Update.
     */
    const attributes: Record<string, unknown> = { team: "payments" };
    const savedQuery: JSONObject = {
      primaryEntityId: new Includes([SERVICE_A]),
      attributes,
      resourceFilters: { hostId: ["h1"] },
    } as unknown as JSONObject;

    const before: string = JSON.stringify(savedQuery);

    Merge.buildSavedViewQueryForOverrides({ savedQuery, baseQuery: {} });

    expect(JSON.stringify(savedQuery)).toBe(before);
    expect(attributes).toEqual({ team: "payments" });
  });

  test("survives an empty or absent saved query", () => {
    expect(
      Merge.buildSavedViewQueryForOverrides({ savedQuery: {}, baseQuery: {} }),
    ).toEqual({});
    expect(
      Merge.buildSavedViewQueryForOverrides({
        savedQuery: undefined as unknown as JSONObject,
        baseQuery: undefined as unknown as JSONObject,
      }),
    ).toEqual({});
  });
});

describe("listRemovableChipKeys", () => {
  test("names every chip group a query is carrying", () => {
    expect(
      Merge.listRemovableChipKeys({
        severityText: "Error",
        primaryEntityId: new Includes([SERVICE_A]),
        attributes: { team: "payments" },
        resourceFilters: { hostId: ["h1"] },
        time: "ignored",
      } as unknown as JSONObject).sort(),
    ).toEqual(
      ["severityText", "primaryEntityId", "attributes.team", "hostId"].sort(),
    );
  });

  test("a stripped query has no removable chip keys left", () => {
    /*
     * The structural statement of the invariant: after the strip there is
     * nothing left for a chip set to disagree with.
     */
    const stripped: JSONObject = Merge.buildSavedViewQueryForOverrides({
      savedQuery: {
        severityText: "Error",
        primaryEntityId: new Includes([SERVICE_A]),
        traceId: "t",
        spanId: "s",
        body: "text",
        attributes: { team: "payments" },
        resourceFilters: { hostId: ["h1"] },
      } as unknown as JSONObject,
      baseQuery: {},
    });

    expect(Merge.listRemovableChipKeys(stripped)).toEqual([]);
  });
});
