import StatusPageSubscriberWebhookUtil, {
  StatusPageWebhookPayload,
} from "../../../Server/Utils/StatusPageSubscriberWebhook";
import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import dns from "dns";

/*
 * Status page subscribers can be created by unauthenticated visitors, so the
 * stored webhook URL is attacker-controlled. These tests pin the two
 * properties that keep that from becoming SSRF: the send site refuses to issue
 * the request at all for internal targets, and when it does send, it does not
 * follow redirects (which would otherwise let a public host bounce the server
 * to an internal address after validation passed).
 */

describe("StatusPageSubscriberWebhookUtil.sendWebhookNotification", () => {
  let postSpy: jest.SpiedFunction<typeof API.post>;

  const payload: StatusPageWebhookPayload = {
    eventType: "IncidentCreated",
    statusPageId: "status-page-id",
    statusPageName: "Status Page",
    statusPageUrl: "https://status.example.com",
    unsubscribeUrl: "https://status.example.com/unsubscribe",
    data: {},
  };

  beforeEach(() => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

    postSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}) as never,
      ) as unknown as jest.SpiedFunction<typeof API.post>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("does not send to the cloud metadata endpoint", async () => {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
        webhookUrl: URL.fromString(
          "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        ),
        payload,
      });

    expect(postSpy).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(HTTPErrorResponse);
  });

  test("does not send to a loopback or private address", async () => {
    for (const unsafeUrl of [
      "http://127.0.0.1:9200/",
      "http://10.0.0.5/internal",
      "http://localhost/admin",
    ]) {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
          webhookUrl: URL.fromString(unsafeUrl),
          payload,
        });

      expect(result).toBeInstanceOf(HTTPErrorResponse);
    }

    expect(postSpy).not.toHaveBeenCalled();
  });

  test("sends to a public target without following redirects", async () => {
    await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
      webhookUrl: URL.fromString("https://hooks.example.com/webhook"),
      payload,
    });

    expect(postSpy).toHaveBeenCalledTimes(1);

    const callArg: { options?: { doNotFollowRedirects?: boolean } } = postSpy
      .mock.calls[0]![0] as {
      options?: { doNotFollowRedirects?: boolean };
    };
    expect(callArg.options?.doNotFollowRedirects).toBe(true);
  });
});
