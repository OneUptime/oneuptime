/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import URL from "../../Types/API/URL";
import APIException from "../../Types/Exception/ApiException";
import API from "../../Utils/API";
import ResponseTooLarge from "../../Utils/ResponseTooLarge";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { AxiosError, AxiosHeaders } from "axios";
import http from "http";
import { AddressInfo } from "net";

/*
 * AN ANSWER LARGER THAN A REQUEST READS (issue #8875).
 *
 * Axios stops reading an answer at the request's maxContentLength and
 * rejects with "maxContentLength size of 10485760 exceeded". ResponseTooLarge
 * tells that failure apart (isError) - API does not try it again - and a
 * sender says it in a sentence of its own (getMessage) that names nothing
 * of the URL. The first part holds the two to their words; the last sends a
 * real request through API, so the matcher is held to the error axios
 * really throws and API really wraps.
 */

function axiosError(message: string, code: string): AxiosError {
  const error: AxiosError = new Error(message) as AxiosError;

  error.isAxiosError = true;
  error.name = "AxiosError";
  error.code = code;
  error.config = { headers: new AxiosHeaders() };

  return error;
}

const TOO_LARGE: AxiosError = axiosError(
  "maxContentLength size of 10485760 exceeded",
  "ERR_BAD_RESPONSE",
);

describe("ResponseTooLarge.isError", () => {
  test("knows axios's refusal of an answer larger than the request reads", () => {
    expect(ResponseTooLarge.isError(TOO_LARGE)).toBe(true);
  });

  test("knows it inside the APIException API.fetch throws, however deep", () => {
    const thrownByFetch: APIException = new APIException(
      "Request failed to https://hooks.example.com/x. maxContentLength size of 10485760 exceeded",
      TOO_LARGE,
    );

    expect(ResponseTooLarge.isError(thrownByFetch)).toBe(true);
    expect(
      ResponseTooLarge.isError(
        new APIException("The answer was too large.", thrownByFetch),
      ),
    ).toBe(true);
  });

  test("is no other failure", () => {
    for (const error of [
      axiosError("stream has been aborted", "ERR_BAD_RESPONSE"),
      axiosError("timeout of 30000ms exceeded", "ECONNABORTED"),
      axiosError("connect ECONNREFUSED 127.0.0.1:80", "ECONNREFUSED"),
      // The same words, not from axios.
      new Error("maxContentLength size of 10485760 exceeded"),
      new APIException("Request failed to https://x.example/. Bad response"),
      "maxContentLength size of 10485760 exceeded",
      null,
      undefined,
    ]) {
      expect(ResponseTooLarge.isError(error)).toBe(false);
    }
  });
});

describe("ResponseTooLarge.getMessage", () => {
  test("says what happened in a sentence, with the limit as people read sizes", () => {
    expect(ResponseTooLarge.getMessage(10 * 1024 * 1024)).toBe(
      "The answer was larger than 10 MB, so it was not read.",
    );
    expect(ResponseTooLarge.getMessage(1024 * 1024)).toBe(
      "The answer was larger than 1 MB, so it was not read.",
    );
  });

  test("names whose answer it was, when the sender says", () => {
    expect(
      ResponseTooLarge.getMessage(8 * 1024 * 1024, "Mattermost's answer"),
    ).toBe("Mattermost's answer was larger than 8 MB, so it was not read.");
  });

  test.each([
    [1024 * 1024 * 1024, "1 GB"],
    [1.5 * 1024 * 1024, "1.5 MB"],
    [10 * 1024 * 1024 + 1, "10 MB"],
    [64 * 1024, "64 KB"],
    [1024, "1 KB"],
    [1000, "1000 bytes"],
    [1, "1 byte"],
    [0, "0 bytes"],
  ])("%d bytes reads %s", (bytes: number, size: string) => {
    expect(ResponseTooLarge.getMessage(bytes)).toBe(
      `The answer was larger than ${size}, so it was not read.`,
    );
  });
});

describe("a real answer larger than the request reads", () => {
  let server: http.Server;
  let port: number = 0;

  beforeAll(async () => {
    server = http.createServer(
      (_request: http.IncomingMessage, response: http.ServerResponse) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ padding: "x".repeat(4096) }));
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();

    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test("throws what ResponseTooLarge.isError knows, and is asked for once", async () => {
    let requests: number = 0;
    server.on("request", () => {
      requests++;
    });

    const error: unknown = await API.get({
      url: URL.fromString(`http://127.0.0.1:${port}/big`),
      options: {
        useNodeHttpAdapter: true,
        maxContentLength: 1024,
        retries: 2,
        retryOnlyOnRetryableErrors: true,
      },
    }).catch((caught: unknown) => {
      return caught;
    });

    expect(error).toBeInstanceOf(APIException);
    expect(ResponseTooLarge.isError(error)).toBe(true);
    expect(requests).toBe(1);
  });

  test("an answer the request can read is not one", async () => {
    const response: unknown = await API.get({
      url: URL.fromString(`http://127.0.0.1:${port}/big`),
      options: { useNodeHttpAdapter: true, maxContentLength: 64 * 1024 },
    });

    expect(ResponseTooLarge.isError(response)).toBe(false);
    expect((response as { statusCode: number }).statusCode).toBe(200);
  });
});
