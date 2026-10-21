import VideoCallHttpClient, {
  VideoCallFetch,
  VideoCallFetchInit,
  VideoCallFetchResponse,
  VideoCallHttpResponse,
} from "../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import APIException from "../../../../Types/Exception/ApiException";
import { describe, expect, test } from "@jest/globals";

/*
 * The HTTP path every meeting provider takes. A status is never thrown - the
 * clients decide what a 400 means - but a request that never completes is,
 * with a deadline, because a person may be waiting on a Start call button.
 */
describe("VideoCallHttpClient", () => {
  test("returns any status with the body text and its JSON object", async () => {
    const http: VideoCallHttpClient = new VideoCallHttpClient({
      fetchImplementation: async (): Promise<VideoCallFetchResponse> => {
        return {
          ok: false,
          status: 400,
          text: async (): Promise<string> => {
            return '{"error":"invalid_client"}';
          },
        };
      },
    });

    const response: VideoCallHttpResponse = await http.request({
      url: "https://example.com",
      method: "POST",
      headers: {},
      stepLabel: "Test request",
    });

    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
    expect(response.json).toEqual({ error: "invalid_client" });
  });

  test("passes the method, headers, body and an abort signal to fetch", async () => {
    let seen: VideoCallFetchInit | undefined = undefined;

    const fetchImplementation: VideoCallFetch = async (
      _url: string,
      init: VideoCallFetchInit,
    ): Promise<VideoCallFetchResponse> => {
      seen = init;
      return {
        ok: true,
        status: 200,
        text: async (): Promise<string> => {
          return "";
        },
      };
    };

    await new VideoCallHttpClient({ fetchImplementation }).request({
      url: "https://example.com",
      method: "POST",
      headers: { "X-Test": "1" },
      body: "a=b",
      stepLabel: "Test request",
    });

    expect(seen!.method).toBe("POST");
    expect(seen!.headers).toEqual({ "X-Test": "1" });
    expect(seen!.body).toBe("a=b");
    expect(seen!.signal).toBeDefined();
  });

  test("gives up after the deadline, naming the step", async () => {
    const http: VideoCallHttpClient = new VideoCallHttpClient({
      timeoutInMs: 20,
      fetchImplementation: (): Promise<VideoCallFetchResponse> => {
        return new Promise<VideoCallFetchResponse>(() => {
          // Never answers.
        });
      },
    });

    const error: unknown = await http
      .request({
        url: "https://example.com",
        method: "GET",
        headers: {},
        stepLabel: "Zoom token request",
      })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(APIException);
    expect((error as Error).message).toBe(
      "Zoom token request timed out after 1 seconds with no response.",
    );
  });

  test("turns a network failure into a provider failure naming the step", async () => {
    const http: VideoCallHttpClient = new VideoCallHttpClient({
      fetchImplementation: async (): Promise<VideoCallFetchResponse> => {
        throw new Error("getaddrinfo ENOTFOUND api.zoom.us");
      },
    });

    await expect(
      http.request({
        url: "https://api.zoom.us",
        method: "GET",
        headers: {},
        stepLabel: "Zoom meeting request",
      }),
    ).rejects.toThrow(
      "Zoom meeting request failed: getaddrinfo ENOTFOUND api.zoom.us",
    );
  });

  describe("parseJsonObject", () => {
    test.each([
      ["", null],
      ["<html></html>", null],
      ["[1,2]", null],
      ["null", null],
      ['"text"', null],
      ['{"a":1}', { a: 1 }],
    ])("parses %s", (text: string, expected: unknown) => {
      expect(VideoCallHttpClient.parseJsonObject(text)).toEqual(expected);
    });
  });

  describe("summarizeErrorBody", () => {
    function response(
      bodyText: string,
      status: number = 400,
    ): VideoCallHttpResponse {
      return {
        status,
        ok: false,
        bodyText,
        json: VideoCallHttpClient.parseJsonObject(bodyText),
      };
    }

    test("prefers OAuth's error_description", () => {
      expect(
        VideoCallHttpClient.summarizeErrorBody(
          response(
            '{"error":"invalid_grant","error_description":"Invalid email or User ID"}',
          ),
        ),
      ).toBe("Invalid email or User ID");
    });

    test("reads Zoom's reason and message", () => {
      expect(
        VideoCallHttpClient.summarizeErrorBody(
          response('{"reason":"Invalid client_id or client_secret"}'),
        ),
      ).toBe("Invalid client_id or client_secret");
      expect(
        VideoCallHttpClient.summarizeErrorBody(
          response('{"code":1001,"message":"User does not exist"}'),
        ),
      ).toBe("User does not exist");
    });

    test("reads Graph's and Google's nested error message", () => {
      expect(
        VideoCallHttpClient.summarizeErrorBody(
          response('{"error":{"code":"Forbidden","message":"No policy"}}'),
        ),
      ).toBe("No policy");
    });

    test("falls back to the body text on one line, shortened", () => {
      const summary: string = VideoCallHttpClient.summarizeErrorBody(
        response(`<html>\n${"x".repeat(1000)}\n</html>`, 502),
      );

      expect(summary).not.toContain("\n");
      expect(summary.length).toBe(300);
      expect(summary.endsWith("…")).toBe(true);
    });

    test("falls back to the status for an empty body", () => {
      expect(VideoCallHttpClient.summarizeErrorBody(response("", 503))).toBe(
        "HTTP 503",
      );
    });

    test("redacts anything credential-shaped", () => {
      const summary: string = VideoCallHttpClient.summarizeErrorBody(
        response(
          '{"message":"bad token Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlc2lnbmF0dXJl"}',
        ),
      );

      expect(summary).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    });
  });

  describe("readErrorCode", () => {
    test.each([
      ['{"error":"unauthorized_client"}', "unauthorized_client"],
      ['{"error":{"code":"Forbidden","message":"x"}}', "Forbidden"],
      ['{"error":{"code":403,"status":"PERMISSION_DENIED"}}', "403"],
      ['{"error":{"status":"PERMISSION_DENIED"}}', "PERMISSION_DENIED"],
      ['{"code":4711,"message":"x"}', "4711"],
      ["{}", ""],
    ])("reads %s", (text: string, expected: string) => {
      expect(
        VideoCallHttpClient.readErrorCode(
          VideoCallHttpClient.parseJsonObject(text),
        ),
      ).toBe(expected);
    });

    test("reads nothing from no body", () => {
      expect(VideoCallHttpClient.readErrorCode(null)).toBe("");
    });
  });
});
