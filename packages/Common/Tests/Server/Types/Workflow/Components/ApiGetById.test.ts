/*
 * API Get By ID: an ID from outside goes into the address only when it is a
 * plain ID, and nothing is sent otherwise (Types/Workflow/Components/
 * ApiGetById). Then it is API Get: the same address rules, no redirects, the
 * same return values and outputs.
 *
 * The ID is what a webhook sent - a Jira issue key, a Dynamics 365 row's
 * GUID - so it is outside text, and these pin that no shape of it can change
 * the request: a path that climbs out, a query, a fragment, an encoded
 * slash, a line break, a long or empty value. And that a URL with no {id}
 * is refused rather than sent without the ID.
 */

import ApiGetById from "../../../../../Server/Types/Workflow/Components/API/GetById";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata from "../../../../../Types/Workflow/Component";
import Components from "../../../../../Types/Workflow/Components";
import {
  MAX_API_GET_BY_ID_LENGTH,
  buildApiGetByIdUrl,
} from "../../../../../Types/Workflow/Components/ApiGetById";
import API from "../../../../../Utils/API";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";

jest.mock("../../../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    },
  };
});

interface OptionsFixture {
  options: RunOptions;
  log: jest.Mock;
  onError: jest.Mock;
}

function makeOptions(): OptionsFixture {
  const log: jest.Mock = jest.fn();
  const onError: jest.Mock = jest.fn((exception: Exception): Exception => {
    return exception;
  });

  return {
    log,
    onError,
    options: {
      log: log as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: onError as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

const JIRA_URL: string =
  "https://acme.atlassian.net/rest/api/3/issue/{id}?fields=labels";

const getMock: () => jest.Mock = (): jest.Mock => {
  return API.get as unknown as jest.Mock;
};

const lookupSpy: jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
> = jest.spyOn(dns.promises, "lookup") as never;

beforeEach(() => {
  jest.clearAllMocks();
  lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("buildApiGetByIdUrl", () => {
  test.each([
    ["a Jira issue key", "OPS-12"],
    ["a GUID", "1f2e3d4c-5b6a-4798-8a9b-0c1d2e3f4a5b"],
    ["a number", "40312"],
    ["a word with an underscore", "case_7"],
  ])("puts %s in place of {id}", (_name: string, id: string) => {
    expect(buildApiGetByIdUrl({ url: JIRA_URL, id: id })).toEqual({
      url: `https://acme.atlassian.net/rest/api/3/issue/${id}?fields=labels`,
    });
  });

  test("a number given as a number is an ID too", () => {
    expect(
      buildApiGetByIdUrl({ url: "https://z.example.com/e/{id}", id: 40312 })
        .url,
    ).toBe("https://z.example.com/e/40312");
  });

  test("the space around an ID is not part of it", () => {
    expect(
      buildApiGetByIdUrl({ url: "https://z.example.com/e/{id}", id: " OPS-12 \n" })
        .url,
    ).toBe("https://z.example.com/e/OPS-12");
  });

  test("every {id} in the URL takes the ID", () => {
    expect(
      buildApiGetByIdUrl({
        url: "https://dyn.example.com/incidents({id})?$filter=incidentid eq {id}",
        id: "abc",
      }).url,
    ).toBe("https://dyn.example.com/incidents(abc)?$filter=incidentid eq abc");
  });

  test.each([
    ["climbs out of the path", "x/../../users"],
    ["ends the path", "OPS-12?fields=*all"],
    ["adds to the query", "x&$expand=customerid"],
    ["starts a fragment", "x#"],
    ["is already percent-encoded", "x%2F..%2Fusers"],
    ["has a dot", "1.2"],
    ["has a space inside", "OPS 12"],
    ["has a line break inside", "OPS\n12"],
    ["has a quote", "x'"],
    ["has a bracket", "x)"],
    ["is not Latin", "تیکت-12"],
    ["is a double brace", "{{local.variables.token}}"],
  ])("refuses an ID that %s, and sends nothing", (_name: string, id: string) => {
    const placed: { url?: string; error?: string } = buildApiGetByIdUrl({
      url: JIRA_URL,
      id: id,
    });

    expect(placed.url).toBeUndefined();
    expect(placed.error).toBe(
      "ID is not a plain ID - only letters, digits, dashes and underscores - so nothing was read.",
    );
  });

  test("never echoes the refused ID", () => {
    expect(
      buildApiGetByIdUrl({ url: JIRA_URL, id: "x/<script>" }).error,
    ).not.toContain("<script>");
  });

  test.each([undefined, null, "", "   ", {}, [], true, Number.NaN])(
    "refuses an empty ID (%p)",
    (id: unknown) => {
      expect(buildApiGetByIdUrl({ url: JIRA_URL, id: id }).error).toBe(
        "ID is empty, so nothing was read.",
      );
    },
  );

  test("refuses an ID longer than an ID is", () => {
    expect(
      buildApiGetByIdUrl({
        url: JIRA_URL,
        id: "a".repeat(MAX_API_GET_BY_ID_LENGTH),
      }).url,
    ).toBeDefined();
    expect(
      buildApiGetByIdUrl({
        url: JIRA_URL,
        id: "a".repeat(MAX_API_GET_BY_ID_LENGTH + 1),
      }).error,
    ).toContain(`longer than ${MAX_API_GET_BY_ID_LENGTH} characters`);
  });

  test("refuses a URL with nowhere for the ID to go, rather than reading without it", () => {
    expect(
      buildApiGetByIdUrl({
        url: "https://acme.atlassian.net/rest/api/3/issue/",
        id: "OPS-12",
      }).error,
    ).toContain("URL has no {id} for the ID to go in");
  });

  test.each([undefined, "", "   ", 7])(
    "refuses an empty URL (%p)",
    (url: unknown) => {
      expect(buildApiGetByIdUrl({ url: url, id: "OPS-12" }).error).toBe(
        "URL is empty, so nothing was read.",
      );
    },
  );

  /*
   * The pattern only ever reads an ID of at most MAX_API_GET_BY_ID_LENGTH
   * characters: a longer one is refused by its length first. So a webhook
   * that sends 400,000 characters costs no more than one that sends 200.
   */
  test("refuses a 400,000-character ID at once, without reading it with the pattern", () => {
    const almost: string = "a".repeat(MAX_API_GET_BY_ID_LENGTH - 1) + "/";

    expect(buildApiGetByIdUrl({ url: JIRA_URL, id: almost }).error).toContain(
      "is not a plain ID",
    );

    const timed: FastestRun<string | undefined> = fastestRun({
      run: (): string | undefined => {
        return buildApiGetByIdUrl({
          url: JIRA_URL,
          id: "a".repeat(400000) + "/",
        }).error;
      },
      limitInMs: 2000,
    });

    expect(timed.result).toContain("longer than");
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("API Get By ID, the step", () => {
  test("is in the catalog under API, beside API Get", () => {
    const metadata: ComponentMetadata | undefined = Components.find(
      (component: ComponentMetadata) => {
        return component.id === ComponentID.ApiGetById;
      },
    );

    expect(metadata?.title).toBe("API Get By ID (JSON)");
    expect(metadata?.category).toBe("API");
    expect(
      metadata?.arguments.map((argument: { id: string }) => {
        return argument.id;
      }),
    ).toEqual(["url", "id", "request-headers"]);
    // The headers carry tokens, so they are kept out of the run's log.
    expect(
      metadata?.arguments.find((argument: { id: string }) => {
        return argument.id === "request-headers";
      })?.isSensitive,
    ).toBe(true);
  });

  test("reads the item, with the ID in place and the headers sent", async () => {
    getMock().mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { key: "OPS-12" }, {}),
    );
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new ApiGetById().run(
      {
        url: JIRA_URL,
        id: "OPS-12",
        "request-headers": '{"Authorization":"Basic dG9rZW4="}',
      },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["response-body"]).toEqual({ key: "OPS-12" });
    expect(result.returnValues["error"]).toBeNull();

    const request: {
      url: URL;
      headers: JSONObject;
      options: { doNotFollowRedirects?: boolean };
    } = getMock().mock.calls[0]![0] as {
      url: URL;
      headers: JSONObject;
      options: { doNotFollowRedirects?: boolean };
    };

    expect(request.url.toString()).toBe(
      "https://acme.atlassian.net/rest/api/3/issue/OPS-12?fields=labels",
    );
    expect(request.headers).toEqual({ Authorization: "Basic dG9rZW4=" });
    expect(request.options.doNotFollowRedirects).toBe(true);
  });

  test("an ID that is not an ID goes down Error, and no request is sent", async () => {
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new ApiGetById().run(
      { url: JIRA_URL, id: "x/../../myself" },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.executePortReason).toContain("is not a plain ID");
    expect(result.returnValues["error"]).toContain("is not a plain ID");
    expect(getMock()).not.toHaveBeenCalled();
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  test("an error answer goes down Error, with the answer kept", async () => {
    getMock().mockResolvedValue(
      new HTTPErrorResponse(
        404,
        { errorMessages: ["Issue does not exist"] },
        {},
      ),
    );

    const result: RunReturnType = await new ApiGetById().run(
      { url: JIRA_URL, id: "OPS-404" },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["response-status"]).toBe(404);
    expect(result.returnValues["response-body"]).toEqual({
      errorMessages: ["Issue does not exist"],
    });
  });

  test("a request that never got an answer goes down Error", async () => {
    getMock().mockRejectedValue(new Error("socket hang up"));

    const result: RunReturnType = await new ApiGetById().run(
      { url: JIRA_URL, id: "OPS-12" },
      makeOptions().options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("socket hang up");
  });

  test("an address on a private network is refused as API Get refuses it", async () => {
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const fixture: OptionsFixture = makeOptions();

    await expect(
      new ApiGetById().run(
        { url: "https://metadata.example.com/latest/{id}", id: "meta-data" },
        fixture.options,
      ),
    ).rejects.toBeTruthy();
    expect(getMock()).not.toHaveBeenCalled();
    expect(fixture.onError).toHaveBeenCalled();
  });
});
