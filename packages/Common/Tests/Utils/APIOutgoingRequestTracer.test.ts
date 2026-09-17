import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import API, { OutgoingRequest } from "../../Utils/API";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import axios, { AxiosRequestConfig, AxiosStatic } from "axios";

/*
 * The shared API client stays tracing-SDK free: a server process installs an
 * OutgoingRequestTracer, and the client must route each logical request —
 * retries included — through it and send whatever headers it added, without
 * disturbing the caller's own headers.
 */

jest.mock("axios", () => {
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

const mockedAxios: jest.MockedFunction<AxiosStatic> =
  axios as jest.MockedFunction<typeof axios>;

function okResponse(): unknown {
  return {
    data: { ok: true },
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: {} },
  };
}

afterEach(() => {
  API.setOutgoingRequestTracer(null);
  mockedAxios.mockReset();
});

describe("API outgoing request tracer", () => {
  test("without a tracer the request goes out exactly as configured", async () => {
    mockedAxios.mockResolvedValueOnce(okResponse() as never);
    await API.post<JSONObject>({
      url: URL.fromString("https://hooks.example.com/services/T0/B0/secret"),
      data: { text: "hi" },
      headers: { "X-Signature": "abc" },
    });
    const config: AxiosRequestConfig = mockedAxios.mock
      .calls[0]![0] as AxiosRequestConfig;
    expect(config.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json;charset=UTF-8",
      "X-Signature": "abc",
    });
  });

  test("a tracer sees one request per call and its headers are sent", async () => {
    const seen: Array<{ method: HTTPMethod; url: string }> = [];
    API.setOutgoingRequestTracer({
      trace: async <T>(
        request: OutgoingRequest,
        send: () => Promise<T>,
      ): Promise<T> => {
        seen.push({ method: request.method, url: request.url });
        request.headers["traceparent"] =
          "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        return send();
      },
    });
    mockedAxios
      .mockRejectedValueOnce(new Error("socket hang up") as never)
      .mockResolvedValueOnce(okResponse() as never);

    const response: unknown = await API.post<JSONObject>({
      url: URL.fromString("http://oneuptime-app:3002/probe-ingest/alive"),
      data: {},
      headers: { "X-Probe-Key": "key" },
      options: { retries: 1 },
    });

    expect(response).toBeInstanceOf(HTTPResponse);
    expect(seen).toEqual([
      {
        method: HTTPMethod.POST,
        url: "http://oneuptime-app:3002/probe-ingest/alive",
      },
    ]);
    expect(mockedAxios).toHaveBeenCalledTimes(2);
    for (const call of mockedAxios.mock.calls) {
      const headers: Dictionary<string> = (call[0] as AxiosRequestConfig)
        .headers as Dictionary<string>;
      expect(headers["X-Probe-Key"]).toBe("key");
      expect(headers["traceparent"]).toBe(
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      );
    }
  });

  test("a tracer that adds nothing leaves the caller's headers alone", async () => {
    API.setOutgoingRequestTracer({
      trace: <T>(
        _request: OutgoingRequest,
        send: () => Promise<T>,
      ): Promise<T> => {
        return send();
      },
    });
    mockedAxios.mockResolvedValueOnce(okResponse() as never);
    await API.get<JSONObject>({
      url: URL.fromString("https://customer.example.com/health"),
      headers: { Authorization: "Bearer customer" },
    });
    const headers: Dictionary<string> = (
      mockedAxios.mock.calls[0]![0] as AxiosRequestConfig
    ).headers as Dictionary<string>;
    expect(headers["traceparent"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer customer");
  });

  test("the tracer learns the dispatch URL a guarded caller actually uses", async () => {
    let tracedUrl: string = "";
    API.setOutgoingRequestTracer({
      trace: <T>(
        request: OutgoingRequest,
        send: () => Promise<T>,
      ): Promise<T> => {
        tracedUrl = request.url;
        return send();
      },
    });
    mockedAxios.mockResolvedValueOnce(okResponse() as never);
    await API.get<JSONObject>({
      url: URL.fromString("https://example.com/a"),
      options: { dispatchUrl: "https://93.184.216.34/a" },
    });
    expect(tracedUrl).toBe("https://93.184.216.34/a");
  });
});
