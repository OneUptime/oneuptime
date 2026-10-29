import BadDataException from "../../../Types/Exception/BadDataException";
import {
  AFFECTED_RESOURCE_KINDS,
  AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT,
  AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
  AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH,
  AFFECTED_RESOURCE_SEARCH_ROUTE,
  AffectedResourceKind,
  AffectedResourceSearchRequest,
  AffectedResourceSearchResult,
  isAffectedResourceKind,
  readAffectedResourceSearchRequest,
  readAffectedResourceSearchResult,
  toAffectedResourceSearchResultJSON,
} from "../../../Types/AffectedResources/AffectedResourceSearch";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The one search across every kind of resource (issue #5341): the request
 * the picker sends and the server takes, and the answer the server sends
 * and the picker reads. Both come from outside the code that reads them -
 * a request from any client with an API key, an answer over the network -
 * so each is read defensively: a malformed request is refused with what
 * to send instead, a malformed answer is read for what it holds.
 */

const ID_A: string = "11111111-1111-4111-8111-111111111111";
const ID_B: string = "22222222-2222-4222-8222-222222222222";

function refusal(body: unknown): string {
  try {
    readAffectedResourceSearchRequest(body);
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as BadDataException).message;
  }

  throw new Error("The request was taken.");
}

describe("the kinds", () => {
  test("are every kind the pickers offer, each once, monitors and network devices included", () => {
    expect(new Set(AFFECTED_RESOURCE_KINDS).size).toBe(
      AFFECTED_RESOURCE_KINDS.length,
    );
    expect(AFFECTED_RESOURCE_KINDS).toEqual(
      Object.values(AffectedResourceKind),
    );
    expect(AFFECTED_RESOURCE_KINDS).toContain(AffectedResourceKind.Monitor);
    expect(AFFECTED_RESOURCE_KINDS).toContain(
      AffectedResourceKind.NetworkDevice,
    );
    expect(AFFECTED_RESOURCE_KINDS).toHaveLength(16);
  });

  test("a network device comes right after a host, as on the incident's card", () => {
    expect(
      AFFECTED_RESOURCE_KINDS.indexOf(AffectedResourceKind.NetworkDevice),
    ).toBe(AFFECTED_RESOURCE_KINDS.indexOf(AffectedResourceKind.Host) + 1);
  });

  test.each([
    ["Host", true],
    ["NetworkDevice", true],
    ["Monitor", true],
    ["host", false],
    ["Hosts", false],
    ["ServerlessFunction", false],
    ["", false],
    [42, false],
    [null, false],
    [undefined, false],
    [["Host"], false],
  ])("isAffectedResourceKind(%j) is %s", (value: unknown, is: boolean) => {
    expect(isAffectedResourceKind(value)).toBe(is);
  });

  test("the route is the one the API mounts and the picker asks", () => {
    expect(AFFECTED_RESOURCE_SEARCH_ROUTE).toBe("/affected-resources/search");
  });
});

describe("readAffectedResourceSearchRequest - a request as the server takes it", () => {
  test("reads a whole request as sent", () => {
    expect(
      readAffectedResourceSearchRequest({
        search: "rtr",
        kinds: ["Host", "NetworkDevice"],
        limitPerKind: 20,
        countKinds: ["Monitor"],
      }),
    ).toEqual({
      search: "rtr",
      kinds: [AffectedResourceKind.Host, AffectedResourceKind.NetworkDevice],
      limitPerKind: 20,
      countKinds: [AffectedResourceKind.Monitor],
    } as AffectedResourceSearchRequest);
  });

  test("fills what a request leaves out: no text asks for suggestions, the default page, nothing counted", () => {
    expect(readAffectedResourceSearchRequest({ kinds: ["Host"] })).toEqual({
      search: "",
      kinds: [AffectedResourceKind.Host],
      limitPerKind: AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT,
      countKinds: [],
    });
    expect(
      readAffectedResourceSearchRequest({
        search: null,
        kinds: ["Host"],
        limitPerKind: null,
        countKinds: null,
      }),
    ).toEqual({
      search: "",
      kinds: [AffectedResourceKind.Host],
      limitPerKind: AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT,
      countKinds: [],
    });
  });

  test("keeps the kinds in the order given, each once", () => {
    expect(
      readAffectedResourceSearchRequest({
        kinds: ["Service", "Host", "Service", "NetworkDevice", "Host"],
      }).kinds,
    ).toEqual([
      AffectedResourceKind.Service,
      AffectedResourceKind.Host,
      AffectedResourceKind.NetworkDevice,
    ]);
  });

  test("trims the text, and cuts a pasted line to its limit rather than refusing it", () => {
    expect(
      readAffectedResourceSearchRequest({
        search: "   WAN-RTR-01  ",
        kinds: ["NetworkDevice"],
      }).search,
    ).toBe("WAN-RTR-01");

    const long: string = `${"a".repeat(AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH - 1)} ${"b".repeat(500)}`;
    const search: string = readAffectedResourceSearchRequest({
      search: long,
      kinds: ["Host"],
    }).search;

    expect(search.length).toBeLessThanOrEqual(
      AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH,
    );
    // The cut lands on the space: trimmed again, never ending in one.
    expect(search).toBe(
      "a".repeat(AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH - 1),
    );
  });

  test.each([
    [0, 1],
    [-5, 1],
    [1, 1],
    [7.9, 7],
    ["12", 12],
    [AFFECTED_RESOURCE_SEARCH_MAX_LIMIT, AFFECTED_RESOURCE_SEARCH_MAX_LIMIT],
    [
      AFFECTED_RESOURCE_SEARCH_MAX_LIMIT + 1,
      AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
    ],
    [100000, AFFECTED_RESOURCE_SEARCH_MAX_LIMIT],
  ])("holds a limit of %j at %d", (limit: unknown, held: number) => {
    expect(
      readAffectedResourceSearchRequest({
        kinds: ["Host"],
        limitPerKind: limit,
      }).limitPerKind,
    ).toBe(held);
  });

  test("a kind both listed and counted is listed only", () => {
    expect(
      readAffectedResourceSearchRequest({
        kinds: ["Host", "Monitor"],
        countKinds: ["Monitor", "Service", "Service"],
      }),
    ).toMatchObject({
      kinds: [AffectedResourceKind.Host, AffectedResourceKind.Monitor],
      countKinds: [AffectedResourceKind.Service],
    });
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "Host"],
    ["a list", ["Host"]],
    ["a number", 5],
  ])("refuses %s in place of an object", (_what: string, body: unknown) => {
    expect(refusal(body)).toBe(
      "The search must be a JSON object with search and kinds.",
    );
  });

  test("refuses a search that is not text", () => {
    expect(refusal({ search: 42, kinds: ["Host"] })).toBe(
      "search must be text.",
    );
    expect(refusal({ search: { $ne: "" }, kinds: ["Host"] })).toBe(
      "search must be text.",
    );
  });

  test("refuses a request that names no kind", () => {
    for (const body of [{}, { kinds: [] }, { kinds: null }]) {
      expect(refusal(body)).toBe(
        "kinds must name at least one kind of resource to search.",
      );
    }
  });

  test("refuses kinds that are not a list", () => {
    expect(refusal({ kinds: "Host" })).toBe(
      "kinds must be a list of resource kinds.",
    );
    expect(refusal({ kinds: ["Host"], countKinds: "Monitor" })).toBe(
      "countKinds must be a list of resource kinds.",
    );
  });

  test("refuses an unknown kind, naming every kind there is", () => {
    const message: string = refusal({ kinds: ["Host", "Router"] });

    expect(message).toContain('kinds lists "Router"');
    expect(message).toContain("which is not a kind of resource");

    for (const kind of AFFECTED_RESOURCE_KINDS) {
      expect(message).toContain(kind);
    }
  });

  test("quotes an unknown kind short, whatever its length", () => {
    const message: string = refusal({ kinds: ["x".repeat(5000)] });

    expect(message.length).toBeLessThan(600);
  });

  test("refuses a limit that is not a number", () => {
    expect(refusal({ kinds: ["Host"], limitPerKind: "many" })).toBe(
      "limitPerKind must be a number.",
    );
    expect(refusal({ kinds: ["Host"], limitPerKind: Infinity })).toBe(
      "limitPerKind must be a number.",
    );
  });
});

describe("readAffectedResourceSearchResult - an answer as the picker reads it", () => {
  test("reads a whole answer as sent", () => {
    expect(
      readAffectedResourceSearchResult({
        kinds: [
          {
            kind: "NetworkDevice",
            count: 12,
            matches: [
              { _id: ID_A, name: "WAN-RTR-01", detail: "10.0.0.1" },
              { _id: ID_B, name: "WAN-RTR-02" },
            ],
          },
        ],
        counts: [{ kind: "Monitor", count: 3 }],
        unreadableKinds: ["DatabaseServer"],
      }),
    ).toEqual({
      kinds: [
        {
          kind: AffectedResourceKind.NetworkDevice,
          count: 12,
          matches: [
            { _id: ID_A, name: "WAN-RTR-01", detail: "10.0.0.1" },
            { _id: ID_B, name: "WAN-RTR-02" },
          ],
        },
      ],
      counts: [{ kind: AffectedResourceKind.Monitor, count: 3 }],
      unreadableKinds: [AffectedResourceKind.DatabaseServer],
    } as AffectedResourceSearchResult);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", []],
    ["text", "ok"],
    ["an empty object", {}],
  ])(
    "reads %s as an answer with nothing in it",
    (_what: string, data: unknown) => {
      expect(readAffectedResourceSearchResult(data)).toEqual({
        kinds: [],
        counts: [],
        unreadableKinds: [],
      });
    },
  );

  test("drops a kind it cannot read, and keeps the rest", () => {
    expect(
      readAffectedResourceSearchResult({
        kinds: [
          null,
          "Host",
          ["Host"],
          { kind: "Router", count: 1, matches: [] },
          { count: 1, matches: [] },
          { kind: "Host", count: 1, matches: [{ _id: ID_A, name: "a" }] },
        ],
      }).kinds,
    ).toEqual([
      {
        kind: AffectedResourceKind.Host,
        count: 1,
        matches: [{ _id: ID_A, name: "a" }],
      },
    ]);
  });

  test("drops a match without a real id, rather than showing half of one", () => {
    expect(
      readAffectedResourceSearchResult({
        kinds: [
          {
            kind: "Host",
            count: 5,
            matches: [
              null,
              { name: "no id" },
              { _id: 42, name: "number id" },
              { _id: "not-a-uuid", name: "bad id" },
              { _id: ID_A, name: "kept" },
              [ID_B],
            ],
          },
        ],
      }).kinds[0]!.matches,
    ).toEqual([{ _id: ID_A, name: "kept" }]);
  });

  test("a name that is not text reads as empty, and a blank detail as none", () => {
    expect(
      readAffectedResourceSearchResult({
        kinds: [
          {
            kind: "NetworkDevice",
            count: 2,
            matches: [
              { _id: ID_A, name: 5, detail: "   " },
              { _id: ID_B, name: "b", detail: "  ap3.office  " },
            ],
          },
        ],
      }).kinds[0]!.matches,
    ).toEqual([
      { _id: ID_A, name: "" },
      { _id: ID_B, name: "b", detail: "ap3.office" },
    ]);
  });

  test("a count is never below the matches listed, nor below zero", () => {
    const read: AffectedResourceSearchResult = readAffectedResourceSearchResult(
      {
        kinds: [
          {
            kind: "Host",
            count: 1,
            matches: [
              { _id: ID_A, name: "a" },
              { _id: ID_B, name: "b" },
            ],
          },
          { kind: "Service", count: -4, matches: [] },
          { kind: "NetworkDevice", count: "9", matches: [] },
          { kind: "Monitor", count: 3.7, matches: [] },
        ],
        counts: [
          { kind: "Monitor", count: -1 },
          { kind: "Host", count: NaN },
          { kind: "Service", count: 2.5 },
        ],
      },
    );

    expect(
      read.kinds.map((kind: { count: number }): number => {
        return kind.count;
      }),
    ).toEqual([2, 0, 0, 3]);
    expect(read.counts).toEqual([
      { kind: AffectedResourceKind.Monitor, count: 0 },
      { kind: AffectedResourceKind.Host, count: 0 },
      { kind: AffectedResourceKind.Service, count: 2 },
    ]);
  });

  test("keeps each unreadable kind once, and drops what is not a kind", () => {
    expect(
      readAffectedResourceSearchResult({
        unreadableKinds: ["Host", "Host", "Router", 3, null, "Service"],
      }).unreadableKinds,
    ).toEqual([AffectedResourceKind.Host, AffectedResourceKind.Service]);
  });

  test("drops a count it cannot read", () => {
    expect(
      readAffectedResourceSearchResult({
        counts: [null, { kind: "Router", count: 1 }, ["Monitor", 1], "x"],
      }).counts,
    ).toEqual([]);
  });
});

describe("toAffectedResourceSearchResultJSON - the answer as the route sends it", () => {
  test("round-trips through the picker's reader unchanged", () => {
    const result: AffectedResourceSearchResult = {
      kinds: [
        {
          kind: AffectedResourceKind.Host,
          count: 40,
          matches: [{ _id: ID_A, name: "app-01" }],
        },
        {
          kind: AffectedResourceKind.NetworkDevice,
          count: 1,
          matches: [{ _id: ID_B, name: "WAN-RTR-01", detail: "10.0.0.1" }],
        },
      ],
      counts: [{ kind: AffectedResourceKind.Monitor, count: 2 }],
      unreadableKinds: [AffectedResourceKind.DatabaseServer],
    };

    const json: JSONObject = toAffectedResourceSearchResultJSON(result);

    expect(
      readAffectedResourceSearchResult(JSON.parse(JSON.stringify(json))),
    ).toEqual(result);
  });

  test("sends no detail key for a match without one", () => {
    const json: JSONObject = toAffectedResourceSearchResultJSON({
      kinds: [
        {
          kind: AffectedResourceKind.Host,
          count: 1,
          matches: [{ _id: ID_A, name: "app-01", detail: undefined }],
        },
      ],
      counts: [],
      unreadableKinds: [],
    });

    const match: JSONObject = (
      (json["kinds"] as Array<JSONObject>)[0]!["matches"] as Array<JSONObject>
    )[0]!;

    expect(Object.keys(match).sort()).toEqual(["_id", "name"]);
  });

  test("does not hand out the result's own list of unreadable kinds", () => {
    const result: AffectedResourceSearchResult = {
      kinds: [],
      counts: [],
      unreadableKinds: [AffectedResourceKind.Host],
    };
    const json: JSONObject = toAffectedResourceSearchResultJSON(result);

    (json["unreadableKinds"] as Array<string>).push("Service");

    expect(result.unreadableKinds).toEqual([AffectedResourceKind.Host]);
  });
});
