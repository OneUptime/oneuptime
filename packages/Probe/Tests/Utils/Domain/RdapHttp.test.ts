process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API, { APIRequestOptions } from "Common/Utils/API";
import ProxyConfig from "../../../Utils/ProxyConfig";
import RdapHttp, { RdapHttpResponse } from "../../../Utils/Domain/RdapHttp";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * Every other RDAP test stubs this module out, so without these the media
 * type and the proxy wiring - the two things it exists for - are never
 * exercised. RDAP is the one probe protocol that CAN honour a proxy (WHOIS
 * is a raw socket), so silently dropping the agents would break every
 * proxied deployment.
 */
describe("RdapHttp.getJson", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let getSpy = jest.spyOn(API, "get");

  beforeEach(() => {
    getSpy = jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { ldhName: "example.com" }, {}),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function requestOptions(): APIRequestOptions {
    return getSpy.mock.calls[0]![0] as APIRequestOptions;
  }

  it("requests the URL it was given", async () => {
    await RdapHttp.getJson("https://rdap.example/rdap/domain/example.com", {
      timeoutInMs: 5000,
    });

    expect((requestOptions().url as URL).toString()).toBe(
      "https://rdap.example/rdap/domain/example.com",
    );
  });

  it("asks for the RDAP media type ahead of plain JSON", async () => {
    await RdapHttp.getJson("https://rdap.example/rdap/domain/example.com", {
      timeoutInMs: 5000,
    });

    expect(requestOptions().headers?.["Accept"]).toBe(
      "application/rdap+json, application/json",
    );
  });

  it("passes the timeout through", async () => {
    await RdapHttp.getJson("https://rdap.example/domain/x.com", {
      timeoutInMs: 1234,
    });

    expect(requestOptions().options?.timeout).toBe(1234);
  });

  it("attaches the probe's proxy agents", async () => {
    const httpsAgent: Record<string, unknown> = { marker: "https-agent" };

    jest
      .spyOn(ProxyConfig, "getRequestProxyAgents")
      .mockReturnValue({ httpsAgent } as never);

    await RdapHttp.getJson("https://rdap.example/domain/x.com", {
      timeoutInMs: 5000,
    });

    expect(requestOptions().options?.httpsAgent).toBe(httpsAgent);
  });

  it("returns the status and body of a successful response", async () => {
    const response: RdapHttpResponse = await RdapHttp.getJson(
      "https://rdap.example/domain/x.com",
      { timeoutInMs: 5000 },
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ldhName: "example.com" });
  });

  /*
   * API.get returns rather than throws for a response that arrived, which is
   * how a 404 ("not registered") reaches the caller as data.
   */
  it("returns the status of an error response instead of throwing", async () => {
    getSpy.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "not found" }, {}),
    );

    const response: RdapHttpResponse = await RdapHttp.getJson(
      "https://rdap.example/domain/x.com",
      { timeoutInMs: 5000 },
    );

    expect(response.statusCode).toBe(404);
  });

  /*
   * An array body is not an RDAP domain object; handing it to the parser as
   * one would let `["a","b"]` masquerade as a record.
   */
  it("reports an array body as null", async () => {
    getSpy.mockResolvedValue({
      statusCode: 200,
      data: ["not", "a", "domain"],
    } as never);

    const response: RdapHttpResponse = await RdapHttp.getJson(
      "https://rdap.example/domain/x.com",
      { timeoutInMs: 5000 },
    );

    expect(response.body).toBeNull();
  });

  it("reports an absent body as null", async () => {
    getSpy.mockResolvedValue({ statusCode: 204, data: undefined } as never);

    const response: RdapHttpResponse = await RdapHttp.getJson(
      "https://rdap.example/domain/x.com",
      { timeoutInMs: 5000 },
    );

    expect(response.body).toBeNull();
  });

  it("propagates a connection-level failure to the caller", async () => {
    getSpy.mockRejectedValue(new Error("connect ECONNREFUSED") as never);

    await expect(
      RdapHttp.getJson("https://rdap.example/domain/x.com", {
        timeoutInMs: 5000,
      }),
    ).rejects.toThrow("connect ECONNREFUSED");
  });
});
