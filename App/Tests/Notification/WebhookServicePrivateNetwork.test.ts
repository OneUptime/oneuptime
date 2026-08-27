import WebhookService from "../../FeatureSet/Notification/Services/WebhookService";
import ProjectService from "Common/Server/Services/ProjectService";
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
 * WebhookService is what actually delivers project webhooks — on-call
 * escalations, incident notifications, workflow "send webhook" steps. It is
 * the sink a self-hosted operator hits when they point an alert at an internal
 * Mattermost (issue #3424), so it resolves the per-project opt-in and hands it
 * to the SSRF guard.
 *
 * The properties worth pinning are the negative ones: a project that did not
 * opt in behaves exactly as before, and an opted-in project still cannot reach
 * the cloud metadata endpoint or the app server's own loopback.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";

const PROJECT_ID: ObjectID = ObjectID.generate();

describe("WebhookService — private network opt-in", () => {
  let postSpy: jest.SpiedFunction<typeof API.post>;
  let allowedSpy: jest.SpiedFunction<
    (projectId: ObjectID | null | undefined) => Promise<boolean>
  >;
  let originalAllow: string | undefined;

  beforeEach(() => {
    originalAllow = process.env[ALLOW_ENV];
    process.env[ALLOW_ENV] = "true";

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

    allowedSpy = jest.spyOn(
      ProjectService,
      "isPrivateNetworkWebhookAllowed",
    ) as unknown as typeof allowedSpy;
    allowedSpy.mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalAllow === undefined) {
      delete process.env[ALLOW_ENV];
    } else {
      process.env[ALLOW_ENV] = originalAllow;
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

  test("resolves the opt-in for the project the webhook belongs to", async () => {
    await expect(
      send("http://mattermost.internal/hooks/abc"),
    ).rejects.toThrow();

    expect(allowedSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a project that has not opted in never issues the request", async () => {
    await expect(send("http://10.0.0.5/hooks/abc")).rejects.toThrow();

    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a project that opted in reaches its internal host", async () => {
    allowedSpy.mockResolvedValue(true);

    await expect(
      send("http://mattermost.internal/hooks/abc"),
    ).resolves.toBeUndefined();
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://127.0.0.1:8080/admin",
    "http://localhost/api/status",
  ])("an opted-in project still cannot reach %s", async (url: string) => {
    allowedSpy.mockResolvedValue(true);

    await expect(send(url)).rejects.toThrow();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("an opted-in project is still refused when the instance allows nothing", async () => {
    delete process.env[ALLOW_ENV];
    allowedSpy.mockResolvedValue(true);

    await expect(send("http://10.0.0.5/hooks/abc")).rejects.toThrow();
    expect(postSpy).not.toHaveBeenCalled();
  });
});
