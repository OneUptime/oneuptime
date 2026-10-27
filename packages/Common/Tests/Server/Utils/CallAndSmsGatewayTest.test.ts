import { AppApiHostname } from "../../../Server/EnvironmentConfig";
import ClusterKeyAuthorization from "../../../Server/Middleware/ClusterKeyAuthorization";
import CallAndSmsGatewayTest, {
  CALL_AND_SMS_GATEWAY_TEST_ROUTE,
  CallAndSmsGatewayTestResult,
} from "../../../Server/Utils/CallAndSmsGatewayTest";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * SEND TEST, FOR THE SERVER'S SMS AND CALL GATEWAY: THE HAND-OFF TO THE
 * NOTIFICATION SERVICE.
 *
 * A master admin's Send test asks the Notification service - which sends
 * every SMS and call, and reads the gateway's URL and secret itself - to
 * post one request to the gateway as saved. The request carries the
 * cluster key in its headers, follows no redirect off its own server, and
 * names no gateway, number or project: the Notification service has them.
 * Whatever the Notification service answers - delivered or not - comes
 * back in words fit for the admin.
 */

const CLUSTER_KEY_HEADERS: Record<string, string> = {
  clusterkey: "the-installation-s-own-key",
};

let post: jest.SpyInstance;

function answer(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

beforeEach(() => {
  jest
    .spyOn(ClusterKeyAuthorization, "getClusterKeyHeaders")
    .mockReturnValue(CLUSTER_KEY_HEADERS);

  post = jest.spyOn(API, "post").mockResolvedValue(
    answer({
      ok: true,
      statusCode: 200,
      message: "Sent to the SMS and call gateway (HTTP 200).",
    }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the request to the Notification service", () => {
  test("is a POST to its gateway test route, inside the cluster", async () => {
    await CallAndSmsGatewayTest.send();

    expect(post).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = post.mock.calls[0]![0] as never;

    expect(CALL_AND_SMS_GATEWAY_TEST_ROUTE).toBe(
      "/api/notification/call-and-sms-gateway/test",
    );
    expect(request["url"]).toBeInstanceOf(URL);
    expect((request["url"] as URL).protocol).toBe(Protocol.HTTP);
    expect((request["url"] as URL).hostname.toString()).toBe(
      AppApiHostname.toString(),
    );
    expect(request["url"]!.toString()).toBe(
      `http://${AppApiHostname.toString()}${CALL_AND_SMS_GATEWAY_TEST_ROUTE}`,
    );
  });

  test("carries the cluster key in its headers, and follows redirects only on its own server", async () => {
    await CallAndSmsGatewayTest.send();

    const request: Record<string, unknown> = post.mock.calls[0]![0] as never;

    expect(request["headers"]).toEqual(CLUSTER_KEY_HEADERS);
    expect(request["options"]).toEqual({ sameServerRedirectsOnly: true });
  });

  test("names no gateway, number or project: the Notification service reads the gateway as saved", async () => {
    await CallAndSmsGatewayTest.send();

    const request: Record<string, unknown> = post.mock.calls[0]![0] as never;

    expect(request["data"]).toEqual({});
  });
});

describe("what the test answers", () => {
  test("a delivered test, with the gateway's status and the Notification service's words", async () => {
    const result: CallAndSmsGatewayTestResult =
      await CallAndSmsGatewayTest.send();

    expect(result).toEqual({
      ok: true,
      statusCode: 200,
      message: "Sent to the SMS and call gateway (HTTP 200).",
    });
  });

  test("a test the gateway refused is not ok, and says what it answered", async () => {
    post.mockResolvedValue(
      answer({
        ok: false,
        statusCode: 503,
        message:
          "Not delivered: the SMS and call gateway answered HTTP 503 (tried 3 times).",
      }),
    );

    expect(await CallAndSmsGatewayTest.send()).toEqual({
      ok: false,
      statusCode: 503,
      message:
        "Not delivered: the SMS and call gateway answered HTTP 503 (tried 3 times).",
    });
  });

  test("a gateway that could not be reached has no status", async () => {
    post.mockResolvedValue(
      answer({
        ok: false,
        statusCode: null,
        message:
          "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
      }),
    );

    const result: CallAndSmsGatewayTestResult =
      await CallAndSmsGatewayTest.send();

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeUndefined();
    expect(result.message).toBe(
      "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
    );
  });

  test("a server that sends through Twilio says so", async () => {
    post.mockResolvedValue(
      answer({
        ok: false,
        statusCode: null,
        message:
          "Not sent: this server sends SMS and calls through Twilio. Choose your own gateway, add its Gateway URL and save, then send a test.",
      }),
    );

    const result: CallAndSmsGatewayTestResult =
      await CallAndSmsGatewayTest.send();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("sends SMS and calls through Twilio");
  });

  test("ok is only a real yes: anything else is not ok", async () => {
    for (const ok of [undefined, null, 0, "", false]) {
      post.mockResolvedValue(answer({ ok: ok, message: "x" } as JSONObject));

      expect((await CallAndSmsGatewayTest.send()).ok).toBe(false);
    }

    post.mockResolvedValue(answer({ ok: "yes", message: "x" }));
    expect((await CallAndSmsGatewayTest.send()).ok).toBe(true);
  });

  test("a status or a message that is not what they should be is left out, not passed on", async () => {
    post.mockResolvedValue(
      answer({ ok: true, statusCode: "200", message: { text: "Sent" } }),
    );

    expect(await CallAndSmsGatewayTest.send()).toEqual({
      ok: true,
      statusCode: undefined,
      message: "",
    });
  });

  test("an answer with an empty body is a test that did not go", async () => {
    post.mockResolvedValue(answer({}));

    expect(await CallAndSmsGatewayTest.send()).toEqual({
      ok: false,
      statusCode: undefined,
      message: "",
    });
  });

  test("a Notification service that refused the request says why", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "Invalid cluster key provided" },
        {},
      ),
    );

    expect(await CallAndSmsGatewayTest.send()).toEqual({
      ok: false,
      message: "Invalid cluster key provided",
    });
  });

  test("a Notification service that could not be reached says so plainly", async () => {
    post.mockResolvedValue(new HTTPErrorResponse(502, {}, {}));

    expect(await CallAndSmsGatewayTest.send()).toEqual({
      ok: false,
      message: "Could not reach the Notification service to send this.",
    });
  });
});
