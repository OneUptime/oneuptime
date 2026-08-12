import JSONFunctions from "../../../Types/JSONFunctions";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import { JSONObject } from "../../../Types/JSON";
import {
  readSavedViewFilters,
  SavedViewFilterTuple,
} from "../../../Utils/Telemetry/SavedViewFilters";
import { describe, expect, test } from "@jest/globals";

/*
 * Facet filters are stored as [facetKey, value] tuples inside a JSON column,
 * and for a while the serializer rewrote every one of them into
 * { "0": facetKey, "1": value }. Those rows are still in the database, so the
 * explorers cannot destructure saved filters directly — a single bad row used
 * to take the whole Traces page down with
 * "TypeError: (destructured parameter) is not iterable".
 *
 * These tests cover both shapes and the junk in between.
 */

// The shape a pre-fix serializer left in the database.
const LEGACY_CORRUPTED_FILTERS: unknown = [
  { "0": "primaryEntityId", "1": "6512f1a0a1b2c3d4e5f60718" },
  { "0": "attributes.http.method", "1": "GET" },
];

describe("readSavedViewFilters", () => {
  describe("Well-formed saved state", () => {
    test("Reads tuples that were stored correctly", () => {
      expect(
        readSavedViewFilters([
          ["service", "api"],
          ["status", "error"],
        ]),
      ).toEqual([
        ["service", "api"],
        ["status", "error"],
      ]);
    });

    test("Reads a single tuple", () => {
      expect(readSavedViewFilters([["service", "api"]])).toEqual([
        ["service", "api"],
      ]);
    });

    test("Returns an empty list for an empty list", () => {
      expect(readSavedViewFilters([])).toEqual([]);
    });

    test("Keeps a filter whose value is deliberately the empty string", () => {
      expect(readSavedViewFilters([["statusMessage", ""]])).toEqual([
        ["statusMessage", ""],
      ]);
    });

    test("Ignores anything beyond the first two elements of a tuple", () => {
      expect(
        readSavedViewFilters([["service", "api", "extra", "junk"]]),
      ).toEqual([["service", "api"]]);
    });

    test("Preserves order", () => {
      expect(
        readSavedViewFilters([
          ["c", "3"],
          ["a", "1"],
          ["b", "2"],
        ]),
      ).toEqual([
        ["c", "3"],
        ["a", "1"],
        ["b", "2"],
      ]);
    });

    test("Returns real arrays, so callers can destructure them", () => {
      const filters: Array<SavedViewFilterTuple> = readSavedViewFilters([
        ["service", "api"],
      ]);

      const read: Array<string> = filters.map(
        ([facetKey, value]: SavedViewFilterTuple): string => {
          return `${facetKey}:${value}`;
        },
      );

      expect(read).toEqual(["service:api"]);
    });
  });

  describe("Legacy rows corrupted by the old serializer", () => {
    test("Reads { '0': key, '1': value } back into a tuple", () => {
      expect(readSavedViewFilters(LEGACY_CORRUPTED_FILTERS)).toEqual([
        ["primaryEntityId", "6512f1a0a1b2c3d4e5f60718"],
        ["attributes.http.method", "GET"],
      ]);
    });

    test("A healed legacy row is destructurable", () => {
      const filters: Array<SavedViewFilterTuple> = readSavedViewFilters(
        LEGACY_CORRUPTED_FILTERS,
      );

      expect(() => {
        return filters.map(([facetKey]: SavedViewFilterTuple): string => {
          return facetKey;
        });
      }).not.toThrow();
    });

    test("Reads a list that mixes healed and correct rows", () => {
      expect(
        readSavedViewFilters([
          { "0": "service", "1": "api" },
          ["status", "error"],
        ]),
      ).toEqual([
        ["service", "api"],
        ["status", "error"],
      ]);
    });

    test("Heals exactly what the old serializer produced, end to end", () => {
      /*
       * Reproduce the corruption the way it actually happened — through the
       * pre-fix serializer — rather than hand-writing the broken shape.
       */
      const corrupted: JSONObject = {
        filters: [
          { "0": "service", "1": "api" },
          { "0": "status", "1": "error" },
        ],
      };

      expect(readSavedViewFilters(corrupted["filters"])).toEqual([
        ["service", "api"],
        ["status", "error"],
      ]);
    });
  });

  describe("Malformed saved state never throws", () => {
    test("Returns an empty list for undefined, null and non-arrays", () => {
      expect(readSavedViewFilters(undefined)).toEqual([]);
      expect(readSavedViewFilters(null)).toEqual([]);
      expect(readSavedViewFilters("service:api")).toEqual([]);
      expect(readSavedViewFilters(42)).toEqual([]);
      expect(readSavedViewFilters(true)).toEqual([]);
      expect(readSavedViewFilters({})).toEqual([]);
      expect(readSavedViewFilters({ service: "api" })).toEqual([]);
    });

    test("Drops entries that are not tuple-shaped at all", () => {
      expect(
        readSavedViewFilters([
          "service:api",
          42,
          null,
          undefined,
          true,
          ["status", "error"],
        ]),
      ).toEqual([["status", "error"]]);
    });

    test("Drops entries with no usable facet key", () => {
      expect(
        readSavedViewFilters([
          [],
          ["", "api"],
          [null, "api"],
          [{ nested: true }, "api"],
          ["service", "api"],
        ]),
      ).toEqual([["service", "api"]]);
    });

    test("Falls back to an empty value when the stored value is unusable", () => {
      expect(readSavedViewFilters([["service", null]])).toEqual([
        ["service", ""],
      ]);
      expect(readSavedViewFilters([["service"]])).toEqual([["service", ""]]);
      expect(readSavedViewFilters([["service", { nested: true }]])).toEqual([
        ["service", ""],
      ]);
      expect(readSavedViewFilters([["service", ["a"]]])).toEqual([
        ["service", ""],
      ]);
    });

    test("Stringifies values that came back as numbers or booleans", () => {
      expect(
        readSavedViewFilters([
          ["duration", 500],
          ["hasException", true],
        ]),
      ).toEqual([
        ["duration", "500"],
        ["hasException", "true"],
      ]);
    });

    test("Drops non-finite numeric values rather than writing 'NaN' into a chip", () => {
      expect(readSavedViewFilters([["duration", NaN]])).toEqual([
        ["duration", ""],
      ]);
      expect(readSavedViewFilters([["duration", Infinity]])).toEqual([
        ["duration", ""],
      ]);
    });

    test("Reads a numeric facet key stored as a number", () => {
      expect(readSavedViewFilters([[7, "api"]])).toEqual([["7", "api"]]);
    });
  });

  describe("Round trip through the serializer that stores the view", () => {
    test("Filters written by the fixed serializer read straight back", () => {
      const state: TelemetrySavedViewState = {
        search: "status:error",
        filters: [
          ["service", "api"],
          ["attributes.http.method", "GET"],
        ],
        pageSize: 50,
      };

      const stored: JSONObject = JSONFunctions.deserialize(
        JSON.parse(
          JSON.stringify(JSONFunctions.serialize(state as JSONObject)),
        ),
      );

      expect(readSavedViewFilters(stored["filters"])).toEqual(state.filters);
    });

    test("A view with no filters at all reads as no filters", () => {
      const state: TelemetrySavedViewState = { search: "status:error" };

      const stored: JSONObject = JSONFunctions.serialize(state as JSONObject);

      expect(readSavedViewFilters(stored["filters"])).toEqual([]);
    });
  });
});
