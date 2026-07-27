import HTTPMethod from "../../Types/API/HTTPMethod";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";

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
    default: (...args: Array<unknown>) => {
      return axiosMock(...args);
    },
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
        headers: { "x-trace": "abc" },
      });

      expect(axiosMock.mock.calls[1]![1]).toMatchObject({
        method: HTTPMethod.GET,
        timeout: 9000,
        maxRedirects: 0,
        headers: { "x-trace": "abc" },
      });
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
