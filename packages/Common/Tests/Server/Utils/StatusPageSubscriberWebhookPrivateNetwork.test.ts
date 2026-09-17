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
 * The one sink the private-network exception (issue #3424) must never reach.
 *
 * Anyone who can load a public status page can register a subscriber with an
 * arbitrary webhook URL, so relaxing this sink would hand every visitor on the
 * internet a POST into the operator's private network — regardless of what the
 * operator configured the exception FOR, which is workflows their own team
 * wrote.
 *
 * The guarantee is structural: the send site passes no options to
 * SSRFProtection at all, so there is no project to consult and no flag to set.
 * These tests turn the instance settings all the way up and assert nothing
 * moves.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

describe("Status page subscriber webhooks ignore the private network exception", () => {
  let postSpy: jest.SpiedFunction<typeof API.post>;
  let originalAllow: string | undefined;
  let originalAllowlist: string | undefined;

  const payload: StatusPageWebhookPayload = {
    eventType: "IncidentCreated",
    statusPageId: "status-page-id",
    statusPageName: "Status Page",
    statusPageUrl: "https://status.example.com",
    unsubscribeUrl: "https://status.example.com/unsubscribe",
    data: {},
  };

  beforeEach(() => {
    originalAllow = process.env[ALLOW_ENV];
    originalAllowlist = process.env[ALLOWLIST_ENV];

    // Instance configured as permissively as the feature allows.
    process.env[ALLOW_ENV] = "true";
    process.env[ALLOWLIST_ENV] =
      "mattermost.internal, 10.0.0.0/8, 127.0.0.1, *.svc.cluster.local";

    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "10.1.2.3", family: 4 }] as never);

    postSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}) as never,
      ) as unknown as jest.SpiedFunction<typeof API.post>;
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalAllow === undefined) {
      delete process.env[ALLOW_ENV];
    } else {
      process.env[ALLOW_ENV] = originalAllow;
    }

    if (originalAllowlist === undefined) {
      delete process.env[ALLOWLIST_ENV];
    } else {
      process.env[ALLOWLIST_ENV] = originalAllowlist;
    }
  });

  test.each([
    "http://10.0.0.5/subscriber-hook",
    "http://192.168.1.10/subscriber-hook",
    "http://127.0.0.1:9000/subscriber-hook",
    "http://mattermost.internal/hooks/abc",
    "http://mattermost.svc.cluster.local/hooks/abc",
    "http://169.254.169.254/latest/meta-data/",
  ])("refuses %s and never issues the request", async (url: string) => {
    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
        webhookUrl: URL.fromString(url),
        payload,
      });

    expect(result).toBeInstanceOf(HTTPErrorResponse);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("still sends to a public target", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
        webhookUrl: URL.fromString("https://hooks.example.com/subscriber"),
        payload,
      });

    expect(result).toBeInstanceOf(HTTPResponse);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
