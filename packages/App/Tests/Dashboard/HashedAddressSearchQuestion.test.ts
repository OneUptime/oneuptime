import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  HashedAddressSignal,
  MAX_HASHED_ADDRESS_SEARCH_TEXTS,
  MAX_HASHED_ADDRESS_SEARCH_TEXT_LENGTH,
} from "Common/Types/Telemetry/HashedAddressSearch";

/*
 * ---------------------------------------------------------------------------
 * WHAT AN EXPLORER ASKS THE SERVER ABOUT ITS SEARCH, AND WHEN (#10418).
 *
 * Only the server can make a project's token and knows its rules, so an
 * explorer asks it which addresses its search also matched by their hash
 * token, to say so above the results. It asks only when a text of its
 * search holds an address an IP Address rule hides - found by the rule's
 * own function - so a search for anything else, a private address
 * included, sends nothing. It asks with as many texts, as long, as one
 * question may hold, and reads back only addresses: an answer it cannot
 * read is no note.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(() => {
        return { tenantid: "project" };
      }),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import {
  askHashedAddressSearch,
  getHashedAddressSearchQuestion,
  getHashedAddressSearchRoute,
  readHashedAddressSearchAnswer,
} from "../../FeatureSet/Dashboard/src/Components/Telemetry/HashedAddressSearch";

const postMock: jest.Mock = API.post as unknown as jest.Mock;

beforeEach(() => {
  postMock.mockReset();
});

describe("the question: the search's texts that hold an address a rule hides", () => {
  test("public addresses, however they are written, and nothing else", () => {
    expect(
      getHashedAddressSearchQuestion([
        "203.0.113.7",
        "login failed from 2001:db8::1",
        "::ffff:198.51.100.4",
        "timeout",
        "10.0.0.12",
        "fe80::1",
        "203.0.113.*",
        "[HASHED:3f9a1c0be27d4e5a]",
      ]),
    ).toEqual([
      "203.0.113.7",
      "login failed from 2001:db8::1",
      "::ffff:198.51.100.4",
    ]);
  });

  test("each text once", () => {
    expect(
      getHashedAddressSearchQuestion(["203.0.113.7", "203.0.113.7"]),
    ).toEqual(["203.0.113.7"]);
  });

  test("a search that names no address asks nothing", () => {
    expect(
      getHashedAddressSearchQuestion(["timeout", "10.0.0.12", "std::vector"]),
    ).toEqual([]);
    expect(getHashedAddressSearchQuestion([])).toEqual([]);
  });

  test("never more texts, nor longer ones, than one question may hold", () => {
    const many: Array<string> = Array.from(
      { length: MAX_HASHED_ADDRESS_SEARCH_TEXTS + 20 },
      (_value: unknown, index: number): string => {
        return `203.0.113.${index % 250} #${index}`;
      },
    );
    const tooLong: string = `${"a".repeat(MAX_HASHED_ADDRESS_SEARCH_TEXT_LENGTH)} 203.0.113.7`;

    expect(getHashedAddressSearchQuestion(many)).toHaveLength(
      MAX_HASHED_ADDRESS_SEARCH_TEXTS,
    );
    expect(getHashedAddressSearchQuestion([tooLong])).toEqual([]);
  });
});

describe("where each explorer asks", () => {
  test.each([
    [HashedAddressSignal.Logs, "/telemetry/logs/hashed-address-search"],
    [HashedAddressSignal.Traces, "/telemetry/traces/hashed-address-search"],
    [
      HashedAddressSignal.Exceptions,
      "/telemetry/exceptions/hashed-address-search",
    ],
  ])("%s: %s", (signal: HashedAddressSignal, route: string) => {
    expect(getHashedAddressSearchRoute(signal)).toBe(route);
  });
});

describe("the answer", () => {
  test("only the addresses it names, as strings", () => {
    expect(
      readHashedAddressSearchAnswer({
        addresses: ["203.0.113.7", 7, "", null, "2001:db8::1"],
      } as unknown as JSONObject),
    ).toEqual(["203.0.113.7", "2001:db8::1"]);
  });

  test.each([
    ["no answer", undefined],
    ["no list", { addresses: "203.0.113.7" }],
    ["nothing", {}],
  ])("%s reads as no address", (_case: string, data: unknown) => {
    expect(
      readHashedAddressSearchAnswer(data as JSONObject | undefined),
    ).toEqual([]);
  });

  test("asked of the signal's route with the texts and the project's headers", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse(200, { addresses: ["203.0.113.7"] }, {}) as never,
    );

    expect(
      await askHashedAddressSearch({
        signal: HashedAddressSignal.Traces,
        texts: ["203.0.113.7"],
      }),
    ).toEqual(["203.0.113.7"]);

    const request: {
      url: URL;
      data: JSONObject;
      headers: Record<string, string>;
    } = postMock.mock.calls[0]![0] as {
      url: URL;
      data: JSONObject;
      headers: Record<string, string>;
    };

    expect(request.url.toString()).toBe(
      "http://localhost/api/telemetry/traces/hashed-address-search",
    );
    expect(request.data).toEqual({ texts: ["203.0.113.7"] });
    expect(request.headers).toEqual({ tenantid: "project" });
  });

  test("a refused question is no note", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not allowed" }, {}) as never,
    );

    expect(
      await askHashedAddressSearch({
        signal: HashedAddressSignal.Logs,
        texts: ["203.0.113.7"],
      }),
    ).toEqual([]);
  });
});
