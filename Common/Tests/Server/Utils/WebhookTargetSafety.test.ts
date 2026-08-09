import {
  createSafeWebhookRequestAgents,
  SafeWebhookRequestAgents,
  validateWebhookTargetIsSafe,
} from "../../../Server/Utils/WebhookTargetSafety";
import StatusPageSubscriberWebhookUtil from "../../../Server/Utils/StatusPageSubscriberWebhook";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import API from "../../../Utils/API";
import dns from "dns";
import http from "http";
import https from "https";
import type { LookupFunction } from "net";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

describe("WebhookTargetSafety", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    "http://127.0.0.1/webhook",
    "http://127.0.0.1:3000/webhook",
    "http://2130706433/webhook",
    "http://0x7f000001/webhook",
    "http://0177.0.0.1/webhook",
    "http://10.0.0.1/webhook",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/webhook",
    "http://localhost/webhook",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[::]/webhook",
    "http://[::1]/webhook",
    "http://[::ffff:127.0.0.1]/webhook",
    "http://[fc00::1]/webhook",
    "http://[febf::1]/webhook",
    "file:///etc/passwd",
  ])("rejects non-public webhook target %s", async (target: string) => {
    await expect(validateWebhookTargetIsSafe(target)).rejects.toThrow(
      /not allowed|http or https/,
    );
  });

  test("rejects a hostname when any DNS answer is private", async () => {
    jest.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ] as never);

    await expect(
      validateWebhookTargetIsSafe("https://webhook.example/notify"),
    ).rejects.toThrow(/not allowed/);
  });

  test("allows a public HTTPS target with a port", async () => {
    jest.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ] as never);

    await expect(
      validateWebhookTargetIsSafe("https://webhook.example:8443/notify"),
    ).resolves.toBeUndefined();
  });

  test("creates guarded HTTP and HTTPS request agents", () => {
    const agents: SafeWebhookRequestAgents = createSafeWebhookRequestAgents();

    expect(agents.httpAgent).toBeInstanceOf(http.Agent);
    expect(agents.httpsAgent).toBeInstanceOf(https.Agent);
  });

  test("rejects a private address returned during the connection lookup", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

    await expect(
      validateWebhookTargetIsSafe("https://rebind.example/webhook"),
    ).resolves.toBeUndefined();

    const lookupImplementation: (
      hostname: string,
      options: dns.LookupAllOptions,
      callback: (
        error: NodeJS.ErrnoException | null,
        addresses: Array<dns.LookupAddress>,
      ) => void,
    ) => void = (
      _hostname: string,
      _options: dns.LookupAllOptions,
      callback: (
        error: NodeJS.ErrnoException | null,
        addresses: Array<dns.LookupAddress>,
      ) => void,
    ): void => {
      callback(null, [{ address: "10.0.0.5", family: 4 }]);
    };

    jest
      .spyOn(dns, "lookup")
      .mockImplementation(lookupImplementation as unknown as typeof dns.lookup);

    const agents: SafeWebhookRequestAgents = createSafeWebhookRequestAgents();

    await expect(
      runAgentLookup(agents.httpAgent, "rebind.example"),
    ).rejects.toMatchObject({ code: "EACCES" });
  });

  test("does not dispatch an unsafe stored status-page subscriber webhook", async () => {
    jest.spyOn(API, "post");

    await expect(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification({
        webhookUrl: URL.fromString("http://169.254.169.254/latest/meta-data/"),
        payload: {
          eventType: "Incident",
          statusPageId: "status-page-id",
          statusPageName: "Status Page",
          statusPageUrl: "https://status.example.com",
          unsubscribeUrl: "https://status.example.com/unsubscribe",
          data: {},
        },
      }),
    ).rejects.toThrow(/not allowed/);

    expect(API.post).not.toHaveBeenCalled();
  });

  test("sends a public target with guarded request options", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

    await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
      webhookUrl: URL.fromString("https://webhook.example/events"),
      payload: {
        eventType: "Incident",
        statusPageId: "status-page-id",
        statusPageName: "Status Page",
        statusPageUrl: "https://status.example.com",
        unsubscribeUrl: "https://status.example.com/unsubscribe",
        data: {},
      },
    });

    expect(API.post).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          timeout: 10_000,
          doNotFollowRedirects: true,
          doNotUseProxy: true,
          httpAgent: expect.any(http.Agent),
          httpsAgent: expect.any(https.Agent),
        }),
      }),
    );
  });
});

function runAgentLookup(
  agent: http.Agent,
  hostname: string,
): Promise<{ address: string | Array<dns.LookupAddress>; family?: number }> {
  const lookup: LookupFunction | undefined = (
    agent as unknown as { options: { lookup?: LookupFunction | undefined } }
  ).options.lookup;

  if (!lookup) {
    throw new Error("Guarded webhook agent does not have a lookup function.");
  }

  return new Promise(
    (
      resolve: (result: {
        address: string | Array<dns.LookupAddress>;
        family?: number;
      }) => void,
      reject: (error: NodeJS.ErrnoException) => void,
    ): void => {
      lookup(
        hostname,
        { all: false },
        (
          error: NodeJS.ErrnoException | null,
          address: string | Array<dns.LookupAddress>,
          family?: number,
        ): void => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            address,
            ...(family !== undefined ? { family } : {}),
          });
        },
      );
    },
  );
}
