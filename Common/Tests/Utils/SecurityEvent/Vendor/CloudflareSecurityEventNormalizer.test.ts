import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import CloudflareSecurityEventNormalizer from "../../../../Utils/SecurityEvent/Vendor/CloudflareSecurityEventNormalizer";

describe("CloudflareSecurityEventNormalizer", () => {
  function wafEvent(): JSONObject {
    return {
      RayID: "ray-123",
      Source: "waf",
      Action: "block",
      RuleID: "rule-42",
      Description: "Block SQL injection",
      ClientIP: "198.51.100.12",
      ClientRequestHost: "shop.example.com",
      ClientRequestURI: "/checkout?item=1",
      ClientRequestScheme: "https",
      OriginIP: "10.0.0.15",
      OriginPort: 443,
      Datetime: "2026-01-02T03:04:05Z",
      Severity: "high",
      metadata: {
        tactic: "TA0001",
        technique: "T1190",
      },
    };
  }

  test("detects direct Logpush events, result envelopes, and GraphQL dimensions", () => {
    expect(
      CloudflareSecurityEventNormalizer.isCloudflareSecurityEvent(wafEvent()),
    ).toBe(true);
    expect(
      CloudflareSecurityEventNormalizer.isCloudflareSecurityEvent({
        result: [wafEvent()],
      }),
    ).toBe(true);
    expect(
      CloudflareSecurityEventNormalizer.isCloudflareSecurityEvent({
        data: {
          viewer: {
            zones: { firewallEventsAdaptive: [{ dimensions: wafEvent() }] },
          },
        },
      }),
    ).toBe(true);
  });

  test("rejects unrelated request-shaped payloads", () => {
    expect(
      CloudflareSecurityEventNormalizer.isCloudflareSecurityEvent({
        action: "block",
        client_ip: "198.51.100.12",
      }),
    ).toBe(false);
  });

  test("maps WAF identity, status, severity, target, and MITRE context", () => {
    const result: NormalizedSecurityEvent =
      CloudflareSecurityEventNormalizer.normalize(wafEvent());

    expect(result).toMatchObject({
      eventUid: "ray-123:rule-42:waf:block",
      categoryUid: 2,
      classUid: 2004,
      className: "Detection Finding",
      activityName: "Block",
      severityName: OcsfSeverity.High,
      statusName: "Blocked",
      message: "Block SQL injection",
      vendorName: "Cloudflare",
      productName: "Cloudflare WAF",
      ruleId: "rule-42",
      principalIp: "198.51.100.12",
      targetHost: "shop.example.com",
      targetIp: "10.0.0.15",
      targetPort: 443,
      targetResource: "https://shop.example.com/checkout?item=1",
      mitreTactics: ["TA0001"],
      mitreTechniques: ["T1190"],
    });
    expect(result.time.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(result.observables).toEqual(
      expect.arrayContaining([
        "198.51.100.12",
        "shop.example.com",
        "10.0.0.15",
        "https://shop.example.com/checkout?item=1",
      ]),
    );
  });

  test("uses an explicit event id and recognizes non-WAF security actions", () => {
    const result: NormalizedSecurityEvent =
      CloudflareSecurityEventNormalizer.normalize({
        id: "event-1",
        source: "ratelimit",
        action: "managedChallenge",
        clientIP: "203.0.113.7",
        clientRequestHost: "api.example.com",
        clientRequestPath: "v1/orders",
        timestamp: 1767225600,
      });

    expect(result.eventUid).toBe("event-1");
    expect(result.productName).toBe("Cloudflare Rate Limiting");
    expect(result.activityName).toBe("Managed Challenge");
    expect(result.statusName).toBe("Challenge");
    expect(result.targetResource).toBe("https://api.example.com/v1/orders");
    expect(result.time.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("uses safe defaults and a stable hash when optional identity fields are absent", () => {
    const payload: JSONObject = { Source: "dlp" };
    const first: NormalizedSecurityEvent =
      CloudflareSecurityEventNormalizer.normalize(payload);
    const second: NormalizedSecurityEvent =
      CloudflareSecurityEventNormalizer.normalize(payload);

    expect(first.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.eventUid).toBe(second.eventUid);
    expect(first.message).toBe("Cloudflare security event");
    expect(first.productName).toBe("Cloudflare Data Loss Prevention");
    expect(first.severityName).toBe(OcsfSeverity.Unknown);
  });
});
