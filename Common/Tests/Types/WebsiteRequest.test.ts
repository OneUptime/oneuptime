import HTTPMethod from "../../Types/API/HTTPMethod";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import { HTTPResponseBodyBudget } from "../../Utils/HTTPResponseBodyReader";
import { Readable } from "stream";

/*
 * WebsiteRequest wraps axios, so axios is mocked and the assertions are about
 * the wrapper's own decisions: which method it picks, which axios options it
 * derives from its own option names, and the HEAD -> GET retry that exists
 * because some servers answer HEAD with an error but GET with a page.
 */
const axiosMock: jest.Mock = jest.fn();

jest.mock("axios", () => {
  return {
    __esModule: true,
    default: Object.assign(
      (...args: Array<unknown>) => {
        return axiosMock(...args);
      },
      {
        isAxiosError: (error: unknown): boolean => {
          return Boolean(
            (error as { isAxiosError?: boolean | undefined })?.isAxiosError,
          );
        },
      },
    ),
  };
});

import WebsiteRequest, { WebsiteResponse } from "../../Types/WebsiteRequest";

const url: URL = new URL(
  Protocol.HTTPS,
  new Hostname("example.com"),
  new Route("/index.html"),
);

type OkResponseFunction = (data?: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}) => Record<string, unknown>;

const okResponse: OkResponseFunction = (data?: {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}): Record<string, unknown> => {
  return {
    status: data?.status ?? 200,
    data: data?.body ?? "<html><body>hello</body></html>",
    headers: data?.headers ?? { "content-type": "text/html" },
  };
};

describe("WebsiteRequest.fetch", () => {
  beforeEach(() => {
    axiosMock.mockReset();
  });

  test("should issue a GET with a default 5s timeout", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {});

    expect(axiosMock).toHaveBeenCalledTimes(1);
    expect(axiosMock.mock.calls[0]![0]).toEqual(url.toString());
    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      method: HTTPMethod.GET,
      timeout: 5000,
    });
  });

  test("should map the response onto the WebsiteResponse shape", async () => {
    axiosMock.mockResolvedValue(
      okResponse({
        status: 201,
        body: "<html>ok</html>",
        headers: { server: "nginx" },
      }),
    );

    const response: WebsiteResponse = await WebsiteRequest.fetch(url, {
      headers: { "x-trace": "abc" },
    });

    expect(response.url).toBe(url);
    expect(response.responseStatusCode).toEqual(201);
    expect(response.responseHeaders).toEqual({ server: "nginx" });
    expect(response.requestHeaders).toEqual({ "x-trace": "abc" });
    expect(response.responseBody.toString()).toEqual("<html>ok</html>");
    // A response that came back at all counts as online, whatever its status.
    expect(response.isOnline).toBe(true);
  });

  test("should default requestHeaders to an empty object", async () => {
    axiosMock.mockResolvedValue(okResponse());

    const response: WebsiteResponse = await WebsiteRequest.fetch(url, {});

    expect(response.requestHeaders).toEqual({});
  });

  test("should pass through an explicit timeout and headers", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {
      timeout: 12345,
      headers: { authorization: "Bearer token" },
    });

    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      timeout: 12345,
      headers: { authorization: "Bearer token" },
    });
  });

  test("should use HEAD when asked", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, { isHeadRequest: true });

    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      method: HTTPMethod.HEAD,
    });
  });

  test("should allow HEAD Content-Length to describe a larger hypothetical GET body", async () => {
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(4);
    axiosMock.mockResolvedValue({
      status: 200,
      data: Readable.from([]),
      headers: { "Content-Length": "1000000" },
    });

    await expect(
      WebsiteRequest.fetch(url, {
        isHeadRequest: true,
        doNotFallbackFromHead: true,
        responseBodyBudget: budget,
      }),
    ).resolves.toMatchObject({
      responseStatusCode: 200,
      isOnline: true,
    });
    expect(budget.remainingBytes).toBe(4);
  });

  test("should set maxRedirects to 0 when redirects are not to be followed", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, { doNotFollowRedirects: true });

    expect(axiosMock.mock.calls[0]![1]).toMatchObject({ maxRedirects: 0 });
  });

  test("should not set maxRedirects by default", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {});

    expect(axiosMock.mock.calls[0]![1]).not.toHaveProperty("maxRedirects");
  });

  test("should accept 2xx and 3xx responses when manual redirect handling is requested", async () => {
    axiosMock.mockResolvedValue(okResponse({ status: 302 }));

    await WebsiteRequest.fetch(url, {
      doNotFollowRedirects: true,
      acceptRedirectResponses: true,
    });

    const requestOptions: {
      validateStatus?: ((status: number) => boolean) | undefined;
    } = axiosMock.mock.calls[0]![1] as {
      validateStatus?: ((status: number) => boolean) | undefined;
    };
    expect(requestOptions.validateStatus).toBeDefined();
    expect(requestOptions.validateStatus!(199)).toBe(false);
    expect(requestOptions.validateStatus!(200)).toBe(true);
    expect(requestOptions.validateStatus!(302)).toBe(true);
    expect(requestOptions.validateStatus!(399)).toBe(true);
    expect(requestOptions.validateStatus!(400)).toBe(false);
  });

  test("should use axios default status validation when redirect responses are not accepted", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {});

    expect(axiosMock.mock.calls[0]![1]).not.toHaveProperty("validateStatus");
  });

  test("should forward byte limits and disable implicit proxy routing", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 256 * 1024,
      disableProxy: true,
    });

    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 256 * 1024,
      proxy: false,
    });
  });

  test("should preserve explicit zero-byte limits", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {
      maxContentLength: 0,
      maxBodyLength: 0,
    });

    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      maxContentLength: 0,
      maxBodyLength: 0,
    });
  });

  test("should leave byte limits and proxy routing unset by default", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {});

    const requestOptions: Record<string, unknown> = axiosMock.mock.calls[0]![1];
    expect(requestOptions).not.toHaveProperty("maxContentLength");
    expect(requestOptions).not.toHaveProperty("maxBodyLength");
    expect(requestOptions).not.toHaveProperty("proxy");
  });

  test("should use an internal validated dispatch URL that the reporting URL cannot represent", async () => {
    axiosMock.mockResolvedValue(okResponse());
    const dispatchUrl: string = "https://example.com/~health";

    await WebsiteRequest.fetch(url, { dispatchUrl: dispatchUrl });

    expect(axiosMock.mock.calls[0]![0]).toBe(dispatchUrl);
  });

  test("should forward AbortSignal and normalize a budgeted HTML stream", async () => {
    const controller: AbortController = new AbortController();
    const bodyText: string = "<html>bounded</html>";
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(100);
    axiosMock.mockResolvedValue({
      status: 200,
      data: Readable.from([Buffer.from(bodyText)]),
      headers: { "content-type": "text/html" },
    });

    const response: WebsiteResponse = await WebsiteRequest.fetch(url, {
      signal: controller.signal,
      responseBodyBudget: budget,
      limitRedirectResponseBody: true,
    });

    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      signal: controller.signal,
      responseType: "stream",
      maxContentLength: -1,
    });
    expect(response.responseBody.toString()).toBe(bodyText);
    expect(budget.remainingBytes).toBe(100 - Buffer.byteLength(bodyText));
  });

  test("should strip a leading UTF-8 BOM from a budgeted HTML stream", async () => {
    const html: string = "<html><body>bounded</body></html>";
    const bodyText: string = `\uFEFF${html}`;
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(100);
    axiosMock.mockResolvedValue({
      status: 200,
      data: Readable.from([Buffer.from(bodyText)]),
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const response: WebsiteResponse = await WebsiteRequest.fetch(url, {
      responseBodyBudget: budget,
    });

    expect(response.responseBody.toString()).toBe(html);
    expect(budget.remainingBytes).toBe(100 - Buffer.byteLength(bodyText));
  });

  test("should enforce a per-response cap independently from the shared budget", async () => {
    const body: Readable = Readable.from([Buffer.from("12345")]);
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(100);
    axiosMock.mockResolvedValue({
      status: 200,
      data: body,
      headers: {},
    });

    await expect(
      WebsiteRequest.fetch(url, {
        responseBodyBudget: budget,
        maximumResponseBytes: 4,
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(body.destroyed).toBe(true);
    expect(budget.remainingBytes).toBe(95);
  });

  test("should enforce the smaller redirect cap before returning a followed redirect", async () => {
    const redirectBody: Readable = Readable.from([Buffer.from("12345")]);
    axiosMock.mockResolvedValue({
      status: 302,
      data: redirectBody,
      headers: { Location: "https://example.com/final" },
    });

    await expect(
      WebsiteRequest.fetch(url, {
        acceptRedirectResponses: true,
        responseBodyBudget: new HTTPResponseBodyBudget(100, 4),
        limitRedirectResponseBody: true,
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(axiosMock).toHaveBeenCalledTimes(1);
    expect(redirectBody.destroyed).toBe(true);
  });

  test("should allow a caller-visible redirect body to use the full cumulative budget", async () => {
    const bodyText: string = "12345";
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(10, 4);
    axiosMock.mockResolvedValue({
      status: 302,
      data: Readable.from([Buffer.from(bodyText)]),
      headers: { Location: "https://example.com/final" },
    });

    const response: WebsiteResponse = await WebsiteRequest.fetch(url, {
      acceptRedirectResponses: true,
      responseBodyBudget: budget,
      limitRedirectResponseBody: false,
    });

    expect(response.responseStatusCode).toBe(302);
    expect(response.responseBody.toString()).toBe(bodyText);
    expect(budget.remainingBytes).toBe(5);
  });

  test("should preserve deadline and budget options on the internal HEAD-to-GET fallback", async () => {
    const controller: AbortController = new AbortController();
    const budget: HTTPResponseBodyBudget = new HTTPResponseBodyBudget(13);
    const headError: {
      isAxiosError: true;
      response: {
        status: number;
        data: Readable | string;
        headers: Record<string, string>;
      };
    } = {
      isAxiosError: true,
      response: {
        status: 405,
        data: Readable.from([Buffer.from("\uFEFFno")]),
        headers: { "content-type": "text/plain" },
      },
    };
    axiosMock.mockRejectedValueOnce(headError).mockResolvedValueOnce({
      status: 200,
      data: Readable.from([Buffer.from("fallback")]),
      headers: {},
    });

    const response: WebsiteResponse = await WebsiteRequest.fetch(url, {
      isHeadRequest: true,
      signal: controller.signal,
      responseBodyBudget: budget,
      limitRedirectResponseBody: true,
    });

    expect(axiosMock).toHaveBeenCalledTimes(2);
    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      method: HTTPMethod.HEAD,
      signal: controller.signal,
      responseType: "stream",
    });
    expect(axiosMock.mock.calls[1]![1]).toMatchObject({
      method: HTTPMethod.GET,
      signal: controller.signal,
      responseType: "stream",
    });
    expect(response.responseBody.toString()).toBe("fallback");
    expect(headError.response.data).toBe("no");
    expect(budget.remainingBytes).toBe(0);
  });

  test("should forward proxy agents when supplied", async () => {
    axiosMock.mockResolvedValue(okResponse());

    const httpAgent: unknown = { name: "http-agent" };
    const httpsAgent: unknown = { name: "https-agent" };

    await WebsiteRequest.fetch(url, {
      httpAgent: httpAgent as never,
      httpsAgent: httpsAgent as never,
    });

    expect(axiosMock.mock.calls[0]![1]).toMatchObject({
      httpAgent,
      httpsAgent,
    });
  });

  test("should not set agent options when none are supplied", async () => {
    axiosMock.mockResolvedValue(okResponse());

    await WebsiteRequest.fetch(url, {});

    expect(axiosMock.mock.calls[0]![1]).not.toHaveProperty("httpAgent");
    expect(axiosMock.mock.calls[0]![1]).not.toHaveProperty("httpsAgent");
  });

  describe("HEAD failure fallback", () => {
    test("should retry with GET when a HEAD request fails", async () => {
      /*
       * Some servers reject HEAD (404/405) while serving the page fine over
       * GET, so a failed HEAD must not be reported as the site being down.
       */
      axiosMock
        .mockRejectedValueOnce(new Error("HEAD not allowed"))
        .mockResolvedValueOnce(okResponse({ status: 200 }));

      const response: WebsiteResponse = await WebsiteRequest.fetch(url, {
        isHeadRequest: true,
      });

      expect(axiosMock).toHaveBeenCalledTimes(2);
      expect(axiosMock.mock.calls[0]![1]).toMatchObject({
        method: HTTPMethod.HEAD,
      });
      expect(axiosMock.mock.calls[1]![1]).toMatchObject({
        method: HTTPMethod.GET,
      });
      expect(response.responseStatusCode).toEqual(200);
    });

    test("should preserve the other options on the retry", async () => {
      axiosMock
        .mockRejectedValueOnce(new Error("HEAD not allowed"))
        .mockResolvedValueOnce(okResponse());

      await WebsiteRequest.fetch(url, {
        isHeadRequest: true,
        timeout: 9000,
        doNotFollowRedirects: true,
        acceptRedirectResponses: true,
        maxContentLength: 4096,
        maxBodyLength: 2048,
        disableProxy: true,
        headers: { "x-trace": "abc" },
      });

      expect(axiosMock.mock.calls[1]![1]).toMatchObject({
        method: HTTPMethod.GET,
        timeout: 9000,
        maxRedirects: 0,
        maxContentLength: 4096,
        maxBodyLength: 2048,
        proxy: false,
        headers: { "x-trace": "abc" },
      });
    });

    test("should let an outer redirect guard disable the internal HEAD fallback", async () => {
      axiosMock.mockRejectedValueOnce(new Error("HEAD not allowed"));

      await expect(
        WebsiteRequest.fetch(url, {
          isHeadRequest: true,
          doNotFallbackFromHead: true,
        }),
      ).rejects.toThrow("HEAD not allowed");

      expect(axiosMock).toHaveBeenCalledTimes(1);
    });

    test("should propagate the error when the GET retry also fails", async () => {
      axiosMock
        .mockRejectedValueOnce(new Error("HEAD not allowed"))
        .mockRejectedValueOnce(new Error("site is down"));

      await expect(
        WebsiteRequest.fetch(url, { isHeadRequest: true }),
      ).rejects.toThrow("site is down");

      expect(axiosMock).toHaveBeenCalledTimes(2);
    });

    test("should not retry a failed GET request", async () => {
      axiosMock.mockRejectedValue(new Error("site is down"));

      await expect(WebsiteRequest.fetch(url, {})).rejects.toThrow(
        "site is down",
      );

      expect(axiosMock).toHaveBeenCalledTimes(1);
    });
  });
});
