import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

import SecurityEventAttributeUtil from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeUtil";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import Dictionary from "../../../Types/Dictionary";

/*
 * The security events table's "Add Attribute Column" search is fed from this
 * one request. Three things about it are worth pinning, because each fails
 * quietly rather than loudly:
 *
 *  - the route. A wrong path 404s, which the picker renders as an error the
 *    user cannot act on.
 *  - the tenant headers. AnalyticsModelAPI.getCommonHeaders carries the
 *    project id these bespoke telemetry routes read the tenant from; without
 *    it the request is rejected as having no project.
 *  - the shape of what comes back. It is JSON off the wire, so a non-array
 *    (or an array with junk in it) has to degrade to "no attributes" rather
 *    than generating columns titled "null" that read nothing off any row.
 */

type PostArgs = {
  url: URL;
  data: JSONObject;
  headers?: Dictionary<string> | undefined;
};

type MockPostFunction = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => jest.SpiedFunction<typeof API.post>;

const mockPost: MockPostFunction = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): jest.SpiedFunction<typeof API.post> => {
  return jest
    .spyOn(API, "post")
    .mockResolvedValue(response as never) as unknown as jest.SpiedFunction<
    typeof API.post
  >;
};

type FirstPostArgsFunction = (
  spy: jest.SpiedFunction<typeof API.post>,
) => PostArgs;

const firstPostArgs: FirstPostArgsFunction = (
  spy: jest.SpiedFunction<typeof API.post>,
): PostArgs => {
  return (spy.mock.calls[0] as Array<unknown>)[0] as PostArgs;
};

type OkFunction = (data: JSONObject) => HTTPResponse<JSONObject>;

const ok: OkFunction = (data: JSONObject): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

describe("SecurityEventAttributeUtil.getAttributeKeys", () => {
  beforeEach(() => {
    jest
      .spyOn(AnalyticsModelAPI, "getCommonHeaders")
      .mockReturnValue({ tenantid: "project-1" } as Dictionary<string>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("posts to the security events attribute route", async () => {
    const spy: jest.SpiedFunction<typeof API.post> = mockPost(
      ok({ attributes: [] }),
    );

    await SecurityEventAttributeUtil.getAttributeKeys();

    expect(firstPostArgs(spy).url.toString()).toContain(
      "/telemetry/security-events/get-attributes",
    );
  });

  test("carries the tenant headers the route reads the project from", async () => {
    const spy: jest.SpiedFunction<typeof API.post> = mockPost(
      ok({ attributes: [] }),
    );

    await SecurityEventAttributeUtil.getAttributeKeys();

    expect(firstPostArgs(spy).headers).toMatchObject({
      tenantid: "project-1",
    });
  });

  test("returns the keys the server sent", async () => {
    mockPost(
      ok({
        attributes: ["device.hostname", "class_uid", "finding_info.title"],
      }),
    );

    await expect(
      SecurityEventAttributeUtil.getAttributeKeys(),
    ).resolves.toEqual(["device.hostname", "class_uid", "finding_info.title"]);
  });

  test("an empty list is an empty list, not an error", async () => {
    mockPost(ok({ attributes: [] }));

    await expect(
      SecurityEventAttributeUtil.getAttributeKeys(),
    ).resolves.toEqual([]);
  });

  test("a missing attributes field degrades to no attributes", async () => {
    mockPost(ok({ someOtherField: true }));

    await expect(
      SecurityEventAttributeUtil.getAttributeKeys(),
    ).resolves.toEqual([]);
  });

  test("a non-array attributes field degrades to no attributes", async () => {
    mockPost(ok({ attributes: "device.hostname" }));

    await expect(
      SecurityEventAttributeUtil.getAttributeKeys(),
    ).resolves.toEqual([]);
  });

  test("non-string entries are dropped rather than turned into columns", async () => {
    mockPost(
      ok({
        attributes: ["device.hostname", null, 42, { a: 1 }, "class_uid"],
      } as unknown as JSONObject),
    );

    await expect(
      SecurityEventAttributeUtil.getAttributeKeys(),
    ).resolves.toEqual(["device.hostname", "class_uid"]);
  });

  /*
   * The caller turns a rejection into the picker's error message. Swallowing
   * it here would show an empty search box instead, which reads as "this
   * project has no attributes".
   */
  test("an error response is thrown, not swallowed", async () => {
    const error: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { message: "clickhouse said no" },
      {},
    );

    mockPost(error);

    await expect(SecurityEventAttributeUtil.getAttributeKeys()).rejects.toBe(
      error,
    );
  });
});
