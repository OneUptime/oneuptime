import WebhookService from "../../FeatureSet/Notification/Services/WebhookService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
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
 * WebhookService delivers project webhooks — on-call escalations, incident
 * notifications, workflow "send webhook" steps. It is the sink a self-hosted
 * operator hits when they point an alert at an internal Mattermost
 * (issue #3424), and its URLs are configured by members of the project, so it
 * declares itself eligible for the instance's private-network exception.
 *
 * The properties worth pinning are the negative ones: an instance that
 * configured nothing behaves exactly as before, and a configured instance
 * still cannot be made to reach the cloud metadata endpoint or the app
 * server's own loopback.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

const PROJECT_ID: ObjectID = ObjectID.generate();

describe("WebhookService — private network exception", () => {
  let postSpy: jest.SpiedFunction<typeof API.post>;
  let originalAllow: string | undefined;
  let originalAllowlist: string | undefined;

  beforeEach(() => {
    originalAllow = process.env[ALLOW_ENV];
    originalAllowlist = process.env[ALLOWLIST_ENV];
    delete process.env[ALLOW_ENV];
    delete process.env[ALLOWLIST_ENV];

    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "10.1.2.3", family: 4 }] as never);

    postSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { ok: true }, {}) as never,
      ) as unknown as jest.SpiedFunction<typeof API.post>;

    // The delivery log is a database write and is not what these tests are about.
    jest
      .spyOn(WebhookLogService, "create")
      .mockResolvedValue({} as never) as unknown as jest.SpyInstance;
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

  const send: (url: string) => Promise<void> = (url: string): Promise<void> => {
    return WebhookService.sendWebhook(
      {
        url,
        eventType: "IncidentCreated",
        payload: { incident: "id" },
      },
      { projectId: PROJECT_ID },
    );
  };

  test("an unconfigured instance never issues the request", async () => {
    await expect(send("http://10.0.0.5/hooks/abc")).rejects.toThrow();

    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a configured instance reaches the internal host", async () => {
    process.env[ALLOW_ENV] = "true";

    await expect(
      send("http://mattermost.internal/hooks/abc"),
    ).resolves.toBeUndefined();
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test("an allowlisted host is reached without the blanket setting", async () => {
    process.env[ALLOWLIST_ENV] = "mattermost.internal";

    await expect(
      send("http://mattermost.internal/hooks/abc"),
    ).resolves.toBeUndefined();
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://127.0.0.1:8080/admin",
    "http://localhost/api/status",
    "http://[::1]/",
  ])("a configured instance still cannot reach %s", async (url: string) => {
    process.env[ALLOW_ENV] = "true";

    await expect(send(url)).rejects.toThrow();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a public target is unaffected either way", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

    await expect(
      send("https://hooks.example.com/abc"),
    ).resolves.toBeUndefined();
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
