import TopologyRequest, {
  MAX_CURSOR_NAME_LENGTH,
  MAX_ENTITY_KEY_LENGTH,
  RANGE_START_MAX_FUTURE_SKEW_MS,
  TopologyCollectionRequest,
  TopologyCollectionSearchRequest,
  TopologyEntityConnectionsRequest,
  TopologyEntityRequest,
  floorToMinute,
  rowsForSection,
} from "../../../../Server/Utils/Topology/TopologyRequest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { TopologyApiLimits } from "../../../../Types/Topology/TopologyApi";
import { describe, expect, test } from "@jest/globals";

/*
 * Request bodies are parsed strictly before a connection is taken: every
 * value the SQL binds comes out typed, bounded and normalized, and anything
 * else is a 400 with a message that names the field.
 */

const NOW: Date = new Date("2026-09-26T12:00:30.000Z");
const RANGE_START: string = "2026-09-26T11:00:45.678Z";
const FLOORED: Date = new Date("2026-09-26T11:00:00.000Z");

function expectBadData(parse: () => unknown, message: RegExp): void {
  let caught: unknown = null;
  try {
    parse();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BadDataException);
  expect((caught as Error).message).toMatch(message);
}

describe("TopologyRequest", () => {
  describe("rangeStart", () => {
    test("is floored to the minute", () => {
      expect(
        TopologyRequest.parseRangeRequest({ rangeStart: RANGE_START }, NOW)
          .rangeStart,
      ).toEqual(FLOORED);
      expect(floorToMinute(new Date("2026-09-26T11:00:59.999Z"))).toEqual(
        FLOORED,
      );
    });

    test.each([
      ["with an offset", "2026-09-26T13:00:45+02:00"],
      ["without seconds", "2026-09-26T11:00Z"],
      ["with nanoseconds", "2026-09-26T11:00:45.123456789Z"],
    ])("accepts ISO 8601 %s", (_label: string, value: string) => {
      expect(
        TopologyRequest.parseRangeRequest({ rangeStart: value }, NOW)
          .rangeStart,
      ).toEqual(FLOORED);
    });

    test("accepts a start up to five minutes ahead of this clock", () => {
      const ahead: string = new Date(
        NOW.getTime() + RANGE_START_MAX_FUTURE_SKEW_MS,
      ).toISOString();
      expect(() => {
        return TopologyRequest.parseRangeRequest({ rangeStart: ahead }, NOW);
      }).not.toThrow();
    });

    test.each([
      ["missing", {}, /rangeStart must be an ISO 8601 date-time/],
      ["a number", { rangeStart: 1790000000000 }, /ISO 8601/],
      ["a date without time", { rangeStart: "2026-09-26" }, /ISO 8601/],
      ["without a zone", { rangeStart: "2026-09-26T11:00:00" }, /ISO 8601/],
      ["free text", { rangeStart: "yesterday" }, /ISO 8601/],
      [
        "too long",
        { rangeStart: `${RANGE_START}${"0".repeat(64)}` },
        /ISO 8601/,
      ],
      [
        "an impossible date",
        { rangeStart: "2026-02-31T25:61:00Z" },
        /not a valid date/,
      ],
      [
        "more than five minutes ahead",
        { rangeStart: "2026-09-26T12:06:00.000Z" },
        /cannot be in the future/,
      ],
      [
        "before 1970",
        { rangeStart: "1969-12-31T23:59:00Z" },
        /too far in the past/,
      ],
      [
        "year zero",
        { rangeStart: "0000-01-01T00:00:00Z" },
        /too far in the past/,
      ],
    ])(
      "rejects rangeStart %s",
      (_label: string, body: JSONObject, message: RegExp) => {
        expectBadData(() => {
          return TopologyRequest.parseRangeRequest(body, NOW);
        }, message);
      },
    );

    test.each([
      ["null", null],
      ["an array", [RANGE_START]],
      ["a string", RANGE_START],
    ])("rejects a body that is %s", (_label: string, body: unknown) => {
      expectBadData(() => {
        return TopologyRequest.parseRangeRequest(body, NOW);
      }, /body must be a JSON object/);
    });
  });

  describe("collection page", () => {
    const valid: JSONObject = {
      rangeStart: RANGE_START,
      entityType: EntityType.NetworkDevice,
      includeInactive: false,
    };

    test("defaults: no terms, no cursor, the default page size", () => {
      const request: TopologyCollectionRequest =
        TopologyRequest.parseCollectionRequest(valid, NOW);
      expect(request).toEqual({
        rangeStart: FLOORED,
        entityType: EntityType.NetworkDevice,
        includeInactive: false,
        nameTerms: [],
        cursor: null,
        limit: TopologyApiLimits.CollectionPageSizeDefault,
      });
    });

    test("terms are trimmed and lowercased; the cursor may carry an empty name", () => {
      const request: TopologyCollectionRequest =
        TopologyRequest.parseCollectionRequest(
          {
            ...valid,
            nameTerms: ["  Core ", "SWITCH"],
            cursor: { name: "", key: "k-1" },
            limit: TopologyApiLimits.CollectionPageSizeMax,
          },
          NOW,
        );
      expect(request.nameTerms).toEqual(["core", "switch"]);
      expect(request.cursor).toEqual({ name: "", key: "k-1" });
      expect(request.limit).toBe(TopologyApiLimits.CollectionPageSizeMax);
    });

    test.each([
      [
        "a structural type",
        { entityType: EntityType.KubernetesPod },
        /not a flat infrastructure type/,
      ],
      [
        "a service",
        { entityType: EntityType.Service },
        /not a flat infrastructure type/,
      ],
      [
        "an application type",
        { entityType: EntityType.Database },
        /not a flat infrastructure type/,
      ],
      ["an empty type", { entityType: "" }, /entityType cannot be empty/],
      ["a non-string type", { entityType: 7 }, /entityType must be a string/],
      [
        "includeInactive missing",
        { includeInactive: undefined },
        /includeInactive must be a boolean/,
      ],
      [
        "includeInactive as a string",
        { includeInactive: "true" },
        /includeInactive must be a boolean/,
      ],
      [
        "terms not an array",
        { nameTerms: "core" },
        /nameTerms must be an array of strings/,
      ],
      [
        "a non-string term",
        { nameTerms: ["core", 5] },
        /nameTerms must be an array of strings/,
      ],
      ["a blank term", { nameTerms: ["  "] }, /cannot contain an empty term/],
      [
        "too many terms",
        {
          nameTerms: new Array(TopologyApiLimits.MaxSearchTerms + 1).fill("a"),
        },
        /cannot have more than/,
      ],
      [
        "a term too long",
        { nameTerms: ["a".repeat(TopologyApiLimits.MaxSearchTermLength + 1)] },
        /terms cannot be longer than/,
      ],
      [
        "a cursor that is not an object",
        { cursor: "k-1" },
        /cursor must be a JSON object/,
      ],
      [
        "a cursor without a key",
        { cursor: { name: "a" } },
        /cursor.key must be a string/,
      ],
      [
        "a cursor with an empty key",
        { cursor: { name: "a", key: "" } },
        /cursor.key cannot be empty/,
      ],
      [
        "a cursor name too long",
        { cursor: { name: "a".repeat(MAX_CURSOR_NAME_LENGTH + 1), key: "k" } },
        /cursor.name cannot be longer/,
      ],
      ["a zero limit", { limit: 0 }, /limit must be an integer from 1/],
      ["a fractional limit", { limit: 1.5 }, /limit must be an integer/],
      [
        "a limit above the maximum",
        { limit: TopologyApiLimits.CollectionPageSizeMax + 1 },
        /limit must be an integer/,
      ],
    ])("rejects %s", (_label: string, change: JSONObject, message: RegExp) => {
      expectBadData(() => {
        return TopologyRequest.parseCollectionRequest(
          { ...valid, ...change },
          NOW,
        );
      }, message);
    });
  });

  describe("collection search", () => {
    test("parses each type's terms", () => {
      const request: TopologyCollectionSearchRequest =
        TopologyRequest.parseCollectionSearchRequest(
          {
            rangeStart: RANGE_START,
            includeInactive: true,
            types: [
              { entityType: EntityType.NetworkDevice, nameTerms: ["Core"] },
              { entityType: EntityType.IoTDevice, nameTerms: [] },
            ],
          },
          NOW,
        );
      expect(request).toEqual({
        rangeStart: FLOORED,
        includeInactive: true,
        types: [
          { entityType: EntityType.NetworkDevice, nameTerms: ["core"] },
          { entityType: EntityType.IoTDevice, nameTerms: [] },
        ],
      });
    });

    test.each([
      ["types missing", { types: undefined }, /types must be an array/],
      [
        "too many types",
        {
          types: new Array(TopologyApiLimits.MaxCollectionSearchTypes + 1).fill(
            {
              entityType: EntityType.NetworkDevice,
              nameTerms: [],
            },
          ),
        },
        /types cannot have more than/,
      ],
      [
        "a type listed twice",
        {
          types: [
            { entityType: EntityType.NetworkDevice, nameTerms: [] },
            { entityType: EntityType.NetworkDevice, nameTerms: ["a"] },
          ],
        },
        /more than once/,
      ],
      [
        "an entry that is not an object",
        { types: ["network.device"] },
        /types\[0\] must be a JSON object/,
      ],
      [
        "a structural type",
        { types: [{ entityType: EntityType.Host, nameTerms: [] }] },
        /types\[0\].entityType "host" is not a flat infrastructure type/,
      ],
      [
        "terms missing",
        { types: [{ entityType: EntityType.NetworkDevice }] },
        /types\[0\].nameTerms must be an array of strings/,
      ],
    ])("rejects %s", (_label: string, change: JSONObject, message: RegExp) => {
      expectBadData(() => {
        return TopologyRequest.parseCollectionSearchRequest(
          { rangeStart: RANGE_START, includeInactive: true, ...change },
          NOW,
        );
      }, message);
    });
  });

  describe("entity and connections", () => {
    test("the type is optional", () => {
      for (const entityType of [undefined, null, ""]) {
        const request: TopologyEntityRequest =
          TopologyRequest.parseEntityRequest(
            { rangeStart: RANGE_START, entityKey: "svc-a", entityType },
            NOW,
          );
        expect(request).toEqual({
          rangeStart: FLOORED,
          entityKey: "svc-a",
          entityType: null,
        });
      }
      expect(
        TopologyRequest.parseEntityRequest(
          {
            rangeStart: RANGE_START,
            entityKey: "svc-a",
            entityType: "service",
          },
          NOW,
        ).entityType,
      ).toBe("service");
    });

    test.each([
      ["no key", {}, /entityKey must be a string/],
      ["an empty key", { entityKey: "" }, /entityKey cannot be empty/],
      [
        "a key too long",
        { entityKey: "k".repeat(MAX_ENTITY_KEY_LENGTH + 1) },
        /entityKey cannot be longer/,
      ],
      [
        "a non-string type",
        { entityKey: "k", entityType: 3 },
        /entityType must be a string/,
      ],
    ])("rejects %s", (_label: string, change: JSONObject, message: RegExp) => {
      expectBadData(() => {
        return TopologyRequest.parseEntityRequest(
          { rangeStart: RANGE_START, ...change },
          NOW,
        );
      }, message);
    });

    test("a page defaults to the section's own row count", () => {
      const calls: TopologyEntityConnectionsRequest =
        TopologyRequest.parseEntityConnectionsRequest(
          {
            rangeStart: RANGE_START,
            entityKey: "svc-a",
            section: "calls",
            offset: 100,
          },
          NOW,
        );
      expect(calls).toEqual({
        rangeStart: FLOORED,
        entityKey: "svc-a",
        entityType: null,
        section: "calls",
        offset: 100,
        limit: TopologyApiLimits.EntityDependencyRows,
      });
      expect(rowsForSection("calledBy")).toBe(
        TopologyApiLimits.EntityDependencyRows,
      );
      expect(rowsForSection("runsOn")).toBe(TopologyApiLimits.EntityOtherRows);
      expect(rowsForSection("related")).toBe(TopologyApiLimits.EntityOtherRows);
    });

    test.each([
      [
        "an unknown section",
        { section: "neighbours" },
        /section must be one of calls, calledBy, runsOn, related/,
      ],
      ["no section", { section: undefined }, /section must be one of/],
      ["no offset", { offset: undefined }, /offset is required/],
      ["a negative offset", { offset: -1 }, /offset must be an integer from 0/],
      [
        "an offset past the scan limit",
        { offset: TopologyApiLimits.EntityConnectionScanLimit + 1 },
        /offset must be an integer/,
      ],
      [
        "a limit above the page maximum",
        { limit: TopologyApiLimits.EntityConnectionsPageSizeMax + 1 },
        /limit must be an integer from 1/,
      ],
    ])("rejects %s", (_label: string, change: JSONObject, message: RegExp) => {
      expectBadData(() => {
        return TopologyRequest.parseEntityConnectionsRequest(
          {
            rangeStart: RANGE_START,
            entityKey: "svc-a",
            section: "related",
            offset: 0,
            ...change,
          },
          NOW,
        );
      }, message);
    });
  });
});
