import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import OktaSystemLogNormalizer from "../../../../Utils/SecurityEvent/Vendor/OktaSystemLogNormalizer";

describe("OktaSystemLogNormalizer", () => {
  function authenticationEvent(): JSONObject {
    return {
      uuid: "okta-1",
      eventType: "user.session.start",
      published: "2026-05-06T07:08:09Z",
      displayMessage: "User login to Okta",
      severity: "INFO",
      outcome: { result: "SUCCESS" },
      actor: {
        alternateId: "user@example.com",
        displayName: "Example User",
      },
      client: {
        device: "MacBook Pro",
        ipAddress: "198.51.100.20",
      },
      target: [
        { type: "User", alternateId: "target@example.com" },
        { type: "Device", displayName: "target-laptop" },
      ],
      request: {
        ipChain: [{ ip: "198.51.100.20" }, { ip: "203.0.113.20" }],
      },
      debugContext: {
        debugData: { requestUri: "/api/v1/authn" },
      },
    };
  }

  test("detects System Log records and rejects arbitrary typed events", () => {
    expect(
      OktaSystemLogNormalizer.isOktaSystemLogEvent(authenticationEvent()),
    ).toBe(true);
    expect(
      OktaSystemLogNormalizer.isOktaSystemLogEvent({
        event_type: "user.lifecycle.activate",
        outcome: { result: "SUCCESS" },
      }),
    ).toBe(true);
    expect(
      OktaSystemLogNormalizer.isOktaSystemLogEvent({
        eventType: "user.session.start",
      }),
    ).toBe(false);
  });

  test("maps authentication actor, targets, outcome, and request data", () => {
    const result: NormalizedSecurityEvent = OktaSystemLogNormalizer.normalize(
      authenticationEvent(),
    );

    expect(result).toMatchObject({
      eventUid: "okta-1",
      categoryUid: 3,
      classUid: 3002,
      className: "Authentication",
      activityName: "Logon",
      severityName: OcsfSeverity.Informational,
      statusName: "Success",
      message: "User login to Okta",
      vendorName: "Okta",
      productName: "System Log",
      ruleId: "user.session.start",
      ruleName: "User Session Start",
      principalUser: "user@example.com",
      principalHost: "MacBook Pro",
      principalIp: "198.51.100.20",
      targetUser: "target@example.com",
      targetHost: "target-laptop",
      targetResource: "/api/v1/authn",
    });
    expect(result.time.toISOString()).toBe("2026-05-06T07:08:09.000Z");
    expect(result.observables).toEqual(
      expect.arrayContaining([
        "user@example.com",
        "MacBook Pro",
        "198.51.100.20",
        "target@example.com",
        "target-laptop",
        "203.0.113.20",
      ]),
    );
  });

  test.each<[string, number, string]>([
    ["user.lifecycle.activate", 3001, "Activate"],
    ["group.user_membership.add", 3006, "Add"],
    ["application.lifecycle.create", 3004, "Create"],
    ["policy.evaluate_sign_on", 3003, "Authorize"],
    ["system.api_token.create", 6003, "System Api Token Create"],
  ])(
    "maps %s to the appropriate OCSF class",
    (eventType: string, classUid: number, activityName: string) => {
      const result: NormalizedSecurityEvent = OktaSystemLogNormalizer.normalize(
        {
          uuid: `okta-${eventType}`,
          eventType,
          outcome: { result: "FAILURE" },
        },
      );

      expect(result.classUid).toBe(classUid);
      expect(result.activityName).toBe(activityName);
      expect(result.statusName).toBe("Failure");
    },
  );

  test("maps session end events to logoff and falls back to target resource", () => {
    const result: NormalizedSecurityEvent = OktaSystemLogNormalizer.normalize({
      eventId: "okta-end",
      event_type: "user.session.end",
      actor: { id: "actor-id" },
      target: [{ type: "ApplicationInstance", alternateId: "app-id" }],
    });

    expect(result.eventUid).toBe("okta-end");
    expect(result.activityName).toBe("Logoff");
    expect(result.targetResource).toBe("app-id");
    expect(result.message).toBe("User Session End");
    expect(result.severityName).toBe(OcsfSeverity.Unknown);
  });

  test("uses a stable hash when an otherwise valid record has no event id", () => {
    const payload: JSONObject = {
      eventType: "user.lifecycle.deactivate",
      displayMessage: "Deactivate user",
    };
    const result: NormalizedSecurityEvent =
      OktaSystemLogNormalizer.normalize(payload);

    expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.classUid).toBe(3001);
  });
});
