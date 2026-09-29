import { describe, expect, test } from "@jest/globals";
import OktaNormalizer, {
  OKTA_ACCOUNT_CHANGE_CLASS_UID,
  OKTA_AUTHENTICATION_CLASS_UID,
  OKTA_DETECTION_FINDING_CLASS_UID,
  OKTA_GROUP_MANAGEMENT_CLASS_UID,
} from "../../../../Utils/SecurityEvent/Connectors/OktaNormalizer";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Fixtures are shaped like the LogEvent objects GET /api/v1/logs returns:
 * `uuid`, `published`, `eventType`, `severity`, `displayMessage`, an
 * `actor`, a `client` with `ipAddress` and geolocation, an `outcome`, a
 * `target` array (or null), and the transaction / debug / authentication
 * / security context blocks every event carries.
 */

const definition: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.OktaSystemLog,
  )!;

function actor(): JSONObject {
  return {
    id: "00u1abcd2EFGHijkl3m4",
    type: "User",
    alternateId: "alice@example.com",
    displayName: "Alice Example",
    detailEntry: null,
  };
}

function client(ipAddress: string = "203.0.113.42"): JSONObject {
  return {
    userAgent: {
      rawUserAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      os: "Mac OS X",
      browser: "CHROME",
    },
    zone: "null",
    device: "Computer",
    id: null,
    ipAddress,
    geographicalContext: {
      city: "Seattle",
      state: "Washington",
      country: "United States",
      postalCode: "98101",
      geolocation: { lat: 47.6062, lon: -122.3321 },
    },
  };
}

function baseEvent(overrides: JSONObject = {}): JSONObject {
  return {
    uuid: "7f4a3c1e-2b9d-4e1f-8a6c-0d5e9f2b1c3a",
    published: "2026-09-12T10:15:00.123Z",
    eventType: "user.session.start",
    version: "0",
    severity: "INFO",
    legacyEventType: "core.user_auth.login_success",
    displayMessage: "User login to Okta",
    actor: actor(),
    client: client(),
    device: null,
    outcome: { result: "SUCCESS", reason: null },
    target: null,
    transaction: {
      type: "WEB",
      id: "Zq1WvX8yTk3LmN4oP5rS6A",
      detail: {},
    },
    debugContext: {
      debugData: {
        requestId: "Zq1WvX8yTk3LmN4oP5rS6A",
        requestUri: "/idp/idx/identify",
        threatSuspected: "false",
        url: "/idp/idx/identify?",
        authnRequestId: "Yp2XuW7zSj4KlM5nO6qR7B",
      },
    },
    authenticationContext: {
      authenticationProvider: "OKTA_AUTHENTICATION_PROVIDER",
      credentialProvider: null,
      credentialType: "PASSWORD",
      issuer: null,
      interface: null,
      authenticationStep: 0,
      rootSessionId: "102aBcDeFgHiJkLmNoPqRsTuV",
      externalSessionId: "102aBcDeFgHiJkLmNoPqRsTuV",
    },
    securityContext: {
      asNumber: 64496,
      asOrg: "example isp",
      isp: "example isp",
      domain: "example.net",
      isProxy: false,
    },
    request: {
      ipChain: [
        {
          ip: "203.0.113.42",
          geographicalContext: {
            city: "Seattle",
            state: "Washington",
            country: "United States",
            postalCode: "98101",
            geolocation: { lat: 47.6062, lon: -122.3321 },
          },
          version: "V4",
          source: null,
        },
      ],
    },
    ...overrides,
  };
}

function userTarget(
  alternateId: string = "bob@example.com",
  displayName: string = "Bob Example",
): JSONObject {
  return {
    id: "00u9zyxw8VUTSrqpo7n6",
    type: "User",
    alternateId,
    displayName,
    detailEntry: null,
  };
}

function groupTarget(): JSONObject {
  return {
    id: "00g5edcb4AZYXwvut3s2",
    type: "UserGroup",
    alternateId: "unknown",
    displayName: "Engineering",
    detailEntry: null,
  };
}

function appTarget(): JSONObject {
  return {
    id: "0oa3fedc2BAZYxwvu1t0",
    type: "AppInstance",
    alternateId: "Salesforce.com",
    displayName: "Salesforce",
    detailEntry: null,
  };
}

describe("OktaNormalizer", () => {
  describe("isRecognized", () => {
    test("recognizes a LogEvent by its eventType together with a uuid or a published time", () => {
      expect(OktaNormalizer.isRecognized(baseEvent())).toBe(true);
      expect(
        OktaNormalizer.isRecognized({
          eventType: "user.session.start",
          uuid: "abc",
        }),
      ).toBe(true);
      expect(
        OktaNormalizer.isRecognized({
          eventType: "user.session.start",
          published: "2026-09-12T10:15:00.123Z",
        }),
      ).toBe(true);
    });

    test("rejects Okta's error envelope and records without an event type or identity", () => {
      expect(
        OktaNormalizer.isRecognized({
          errorCode: "E0000011",
          errorSummary: "Invalid token provided",
          errorId: "oaeQ9pJ1bK2SxW3yLm4nO5pQ6",
          errorCauses: [],
        }),
      ).toBe(false);
      expect(
        OktaNormalizer.isRecognized({ eventType: "user.session.start" }),
      ).toBe(false);
      expect(
        OktaNormalizer.isRecognized({
          uuid: "abc",
          published: "2026-09-12T10:15:00.123Z",
        }),
      ).toBe(false);
      expect(OktaNormalizer.isRecognized({})).toBe(false);
      expect(OktaNormalizer.isRecognized([] as unknown as JSONObject)).toBe(
        false,
      );
      expect(OktaNormalizer.isRecognized(null as unknown as JSONObject)).toBe(
        false,
      );
    });
  });

  describe("normalize", () => {
    test("maps a successful sign-in to an Authentication Logon with every typed column", () => {
      const event: NormalizedSecurityEvent =
        OktaNormalizer.normalize(baseEvent());

      expect(event.classUid).toBe(OKTA_AUTHENTICATION_CLASS_UID);
      expect(event.classUid).toBe(3002);
      expect(event.className).toBe("Authentication");
      expect(event.categoryUid).toBe(3);
      expect(event.categoryName).toBe("Identity & Access Management");
      expect(event.activityName).toBe("Logon");
      expect(event.time.toISOString()).toBe("2026-09-12T10:15:00.123Z");
      expect(event.eventUid).toBe("7f4a3c1e-2b9d-4e1f-8a6c-0d5e9f2b1c3a");
      expect(event.vendorName).toBe(definition.vendorName);
      expect(event.productName).toBe(definition.productName);
      expect(event.vendorName).toBe("Okta");
      expect(event.productName).toBe("Okta System Log");
      expect(event.severityName).toBe(OcsfSeverity.Informational);
      expect(event.severityId).toBe(1);
      expect(event.statusName).toBe("Success");
      expect(event.message).toBe("User login to Okta");
      expect(event.ruleId).toBe("");
      expect(event.ruleName).toBe("");
      expect(event.mitreTactics).toEqual([]);
      expect(event.mitreTechniques).toEqual([]);

      expect(event.principalUser).toBe("alice@example.com");
      expect(event.principalIp).toBe("203.0.113.42");
      expect(event.principalHost).toBe("");
      expect(event.principalProcess).toBe("");
      expect(event.targetUser).toBe("");
      expect(event.targetHost).toBe("");
      expect(event.targetIp).toBe("");
      expect(event.targetPort).toBe(0);
      expect(event.targetResource).toBe("");
      expect(event.observables).toEqual(["alice@example.com", "203.0.113.42"]);
    });

    test("keeps the whole LogEvent, nested blocks and arrays included, in the flattened attributes", () => {
      const event: NormalizedSecurityEvent =
        OktaNormalizer.normalize(baseEvent());

      expect(event.attributes["eventType"]).toBe("user.session.start");
      expect(event.attributes["legacyEventType"]).toBe(
        "core.user_auth.login_success",
      );
      expect(event.attributes["actor.alternateId"]).toBe("alice@example.com");
      expect(event.attributes["actor.id"]).toBe("00u1abcd2EFGHijkl3m4");
      expect(event.attributes["client.ipAddress"]).toBe("203.0.113.42");
      expect(event.attributes["client.userAgent.browser"]).toBe("CHROME");
      expect(event.attributes["client.geographicalContext.city"]).toBe(
        "Seattle",
      );
      expect(
        event.attributes["client.geographicalContext.geolocation.lat"],
      ).toBe("47.6062");
      expect(event.attributes["outcome.result"]).toBe("SUCCESS");
      expect(event.attributes["debugContext.debugData.requestUri"]).toBe(
        "/idp/idx/identify",
      );
      expect(event.attributes["authenticationContext.credentialType"]).toBe(
        "PASSWORD",
      );
      expect(event.attributes["securityContext.asNumber"]).toBe("64496");
      expect(event.attributes["securityContext.isProxy"]).toBe("false");
      expect(event.attributes["request.ipChain.0.ip"]).toBe("203.0.113.42");
      expect(event.attributes["request.ipChain.0.version"]).toBe("V4");
      // Nulls are not stored as the string "null".
      expect(event.attributes["device"]).toBeUndefined();
      expect(event.attributes["target"]).toBeUndefined();
      expect(event.attributes["outcome.reason"]).toBeUndefined();
    });

    test("raises a failed sign-in at INFO to Low and keeps WARN at Medium", () => {
      const failedAtInfo: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          severity: "INFO",
          displayMessage: "User login to Okta",
          outcome: { result: "FAILURE", reason: "INVALID_CREDENTIALS" },
        }),
      );

      expect(failedAtInfo.classUid).toBe(3002);
      expect(failedAtInfo.activityName).toBe("Logon");
      expect(failedAtInfo.statusName).toBe("Failure");
      expect(failedAtInfo.severityName).toBe(OcsfSeverity.Low);
      expect(failedAtInfo.severityId).toBe(2);

      const failedAtWarn: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          severity: "WARN",
          outcome: { result: "FAILURE", reason: "INVALID_CREDENTIALS" },
        }),
      );

      expect(failedAtWarn.severityName).toBe(OcsfSeverity.Medium);
      expect(failedAtWarn.severityId).toBe(3);
    });

    test("maps session end, MFA, authentication and other session events onto Authentication activities", () => {
      expect(
        OktaNormalizer.normalize(
          baseEvent({
            eventType: "user.session.end",
            displayMessage: "User logout from Okta",
          }),
        ).activityName,
      ).toBe("Logoff");

      const mfa: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.mfa.okta_verify.deny_push",
          severity: "INFO",
          displayMessage: "User rejected Okta push verify",
          outcome: { result: "DENY", reason: null },
        }),
      );
      expect(mfa.classUid).toBe(3002);
      expect(mfa.activityName).toBe("Authentication Ticket");
      expect(mfa.statusName).toBe("Denied");
      // A denied factor is a failed authentication, so INFO is raised to Low.
      expect(mfa.severityName).toBe(OcsfSeverity.Low);

      const viaMfa: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.authentication.auth_via_mfa",
          displayMessage: "Authentication of user via MFA",
        }),
      );
      expect(viaMfa.classUid).toBe(3002);
      expect(viaMfa.activityName).toBe("Logon");

      const adminApp: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.session.access_admin_app",
          displayMessage: "User accessing Okta admin app",
        }),
      );
      expect(adminApp.classUid).toBe(3002);
      expect(adminApp.activityName).toBe("Other");
    });

    test("maps account and lifecycle events to Account Change with the target user", () => {
      const passwordChange: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          uuid: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
          eventType: "user.account.update_password",
          displayMessage: "User update password for Okta",
          target: [userTarget()],
        }),
      );

      expect(passwordChange.classUid).toBe(OKTA_ACCOUNT_CHANGE_CLASS_UID);
      expect(passwordChange.classUid).toBe(3001);
      expect(passwordChange.className).toBe("Account Change");
      expect(passwordChange.categoryUid).toBe(3);
      expect(passwordChange.activityName).toBe("Update Password");
      expect(passwordChange.principalUser).toBe("alice@example.com");
      expect(passwordChange.targetUser).toBe("bob@example.com");
      expect(passwordChange.observables).toEqual([
        "alice@example.com",
        "bob@example.com",
        "203.0.113.42",
      ]);
      expect(passwordChange.attributes["target.0.alternateId"]).toBe(
        "bob@example.com",
      );
      expect(passwordChange.attributes["target.0.type"]).toBe("User");

      const deactivate: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.lifecycle.deactivate",
          severity: "INFO",
          displayMessage: "Deactivate Okta user",
          target: [userTarget()],
        }),
      );
      expect(deactivate.classUid).toBe(3001);
      expect(deactivate.activityName).toBe("Deactivate");
      expect(deactivate.targetUser).toBe("bob@example.com");
    });

    test("maps group membership to Group Management and skips Okta's 'unknown' placeholder identifiers", () => {
      const event: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "group.user_membership.add",
          displayMessage: "Add user to group membership",
          target: [userTarget(), groupTarget()],
        }),
      );

      expect(event.classUid).toBe(OKTA_GROUP_MANAGEMENT_CLASS_UID);
      expect(event.classUid).toBe(3006);
      expect(event.className).toBe("Group Management");
      expect(event.categoryUid).toBe(3);
      expect(event.activityName).toBe("Add");
      expect(event.targetUser).toBe("bob@example.com");
      expect(event.targetResource).toBe("");
      expect(event.observables).toEqual([
        "alice@example.com",
        "bob@example.com",
        "203.0.113.42",
      ]);
      expect(event.observables).not.toContain("unknown");
      expect(event.attributes["target.1.displayName"]).toBe("Engineering");
    });

    test("maps Okta's own security detections to Detection Finding with the event type as the rule", () => {
      const event: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          uuid: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
          eventType: "security.threat.detected",
          severity: "WARN",
          displayMessage: "Threat detected: password spray",
          outcome: { result: "DENY", reason: "Password spray detected" },
          target: null,
        }),
      );

      expect(event.classUid).toBe(OKTA_DETECTION_FINDING_CLASS_UID);
      expect(event.classUid).toBe(2004);
      expect(event.className).toBe("Detection Finding");
      expect(event.categoryUid).toBe(2);
      expect(event.categoryName).toBe("Findings");
      expect(event.activityName).toBe("Create");
      expect(event.ruleName).toBe("security.threat.detected");
      expect(event.ruleId).toBe("");
      expect(event.severityName).toBe(OcsfSeverity.Medium);
      expect(event.statusName).toBe("Denied");
      expect(event.message).toBe("Threat detected: password spray");
      expect(event.principalIp).toBe("203.0.113.42");
    });

    test("treats a denied sign-on policy evaluation as a finding but an allowed one as a plain Okta event", () => {
      const denied: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "policy.evaluate_sign_on",
          displayMessage: "Evaluation of sign-on policy",
          outcome: {
            result: "DENY",
            reason: "Sign-on policy evaluation resulted in DENY",
          },
        }),
      );

      expect(denied.classUid).toBe(2004);
      expect(denied.className).toBe("Detection Finding");
      expect(denied.ruleName).toBe("policy.evaluate_sign_on");
      expect(denied.statusName).toBe("Denied");

      const allowed: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "policy.evaluate_sign_on",
          displayMessage: "Evaluation of sign-on policy",
          outcome: {
            result: "ALLOW",
            reason: "Sign-on policy evaluation resulted in ALLOW",
          },
        }),
      );

      expect(allowed.classUid).toBe(0);
      expect(allowed.className).toBe("Policy Evaluate Sign On");
      expect(allowed.categoryUid).toBe(0);
      expect(allowed.categoryName).toBe("Uncategorized");
      expect(allowed.activityName).toBe("Evaluate Sign On");
      expect(allowed.ruleName).toBe("");
      expect(allowed.statusName).toBe("Allowed");
    });

    test("keeps unmapped event families as class 0 with a name derived from the event type", () => {
      const tokenCreate: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "system.api_token.create",
          displayMessage: "Create API token",
          target: [
            {
              id: "00Tabcdefghijklmnopq",
              type: "Token",
              alternateId: "unknown",
              displayName: "OneUptime security events",
              detailEntry: null,
            },
          ],
        }),
      );

      expect(tokenCreate.classUid).toBe(0);
      expect(tokenCreate.className).toBe("System Api Token Create");
      expect(tokenCreate.activityName).toBe("Create");
      expect(tokenCreate.targetUser).toBe("");
      expect(tokenCreate.observables).toEqual([
        "alice@example.com",
        "203.0.113.42",
      ]);

      const appAssignment: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "application.user_membership.add",
          displayMessage: "Add user to application membership",
          target: [userTarget(), appTarget()],
        }),
      );

      expect(appAssignment.classUid).toBe(0);
      expect(appAssignment.className).toBe("Application User Membership Add");
      expect(appAssignment.targetUser).toBe("bob@example.com");
      expect(appAssignment.targetResource).toBe("Salesforce.com");
      expect(appAssignment.observables).toEqual([
        "alice@example.com",
        "bob@example.com",
        "Salesforce.com",
        "203.0.113.42",
      ]);
    });

    test("classifies case-insensitively and tolerates surrounding whitespace", () => {
      expect(
        OktaNormalizer.classify("  USER.SESSION.START  ", "SUCCESS")
          .activityName,
      ).toBe("Logon");
      expect(
        OktaNormalizer.classify("User.MFA.Factor.Verify", "").classUid,
      ).toBe(3002);
      expect(
        OktaNormalizer.classify("Policy.Evaluate_Sign_On", "deny").classUid,
      ).toBe(2004);
      expect(OktaNormalizer.classify("", "").className).toBe("Okta event");
    });

    test("maps Okta's four severities and falls back to the generic aliases, then Unknown", () => {
      const cases: Array<[string, OcsfSeverity, number]> = [
        ["DEBUG", OcsfSeverity.Informational, 1],
        ["INFO", OcsfSeverity.Informational, 1],
        ["WARN", OcsfSeverity.Medium, 3],
        ["ERROR", OcsfSeverity.High, 4],
        ["warn", OcsfSeverity.Medium, 3],
        [" error ", OcsfSeverity.High, 4],
        ["critical", OcsfSeverity.Critical, 5],
        ["", OcsfSeverity.Unknown, 0],
        ["whatever", OcsfSeverity.Unknown, 0],
      ];

      for (const [severity, expectedName, expectedId] of cases) {
        const event: NormalizedSecurityEvent = OktaNormalizer.normalize(
          baseEvent({ eventType: "user.lifecycle.create", severity }),
        );

        expect(event.severityName).toBe(expectedName);
        expect(event.severityId).toBe(expectedId);
      }

      // The failed-outcome bump only applies to Authentication events.
      expect(OktaNormalizer.severityFor("INFO", 3001, "FAILURE")).toBe(
        OcsfSeverity.Informational,
      );
      expect(OktaNormalizer.severityFor("INFO", 3002, "DENY")).toBe(
        OcsfSeverity.Low,
      );
      expect(OktaNormalizer.severityFor("INFO", 3002, "SKIPPED")).toBe(
        OcsfSeverity.Informational,
      );
    });

    test("labels every documented outcome and prettifies ones Okta adds later", () => {
      const cases: Array<[string, string]> = [
        ["SUCCESS", "Success"],
        ["FAILURE", "Failure"],
        ["SKIPPED", "Skipped"],
        ["ALLOW", "Allowed"],
        ["DENY", "Denied"],
        ["CHALLENGE", "Challenge"],
        ["UNKNOWN", "Unknown"],
        ["RATE_LIMIT", "Rate Limited"],
        ["DEFERRED", "Deferred"],
        ["SCHEDULED", "Scheduled"],
        ["ABANDONED", "Abandoned"],
        ["UNANSWERED", "Unanswered"],
        ["success", "Success"],
        ["PARTIAL_SUCCESS", "Partial Success"],
        ["", ""],
      ];

      for (const [result, expected] of cases) {
        expect(OktaNormalizer.statusFor(result)).toBe(expected);
      }

      expect(
        OktaNormalizer.normalize(baseEvent({ outcome: null })).statusName,
      ).toBe("");
    });

    test("falls back through the outcome reason, the event type and a generic message for the title", () => {
      expect(
        OktaNormalizer.normalize(
          baseEvent({
            displayMessage: null,
            outcome: { result: "FAILURE", reason: "INVALID_CREDENTIALS" },
          }),
        ).message,
      ).toBe("user.session.start: INVALID_CREDENTIALS");
      expect(
        OktaNormalizer.normalize(
          baseEvent({ displayMessage: "", outcome: { result: "SUCCESS" } }),
        ).message,
      ).toBe("user.session.start");
      expect(
        OktaNormalizer.normalize({
          uuid: "x",
          published: "2026-09-12T10:15:00.123Z",
        }).message,
      ).toBe("Okta System Log event");
    });

    test("parses published as ISO 8601 with Z or an offset and falls back to now otherwise", () => {
      expect(
        OktaNormalizer.normalize(
          baseEvent({ published: "2026-09-12T12:15:00.500+02:00" }),
        ).time.toISOString(),
      ).toBe("2026-09-12T10:15:00.500Z");

      const before: number = Date.now();
      const missing: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({ published: null }),
      );
      const garbage: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({ published: "yesterday-ish" }),
      );

      for (const event of [missing, garbage]) {
        expect(event.time.getTime()).toBeGreaterThanOrEqual(before);
        expect(event.time.getTime()).toBeLessThanOrEqual(Date.now());
      }
    });

    test("uses uuid as the event id and a stable content hash when it is missing", () => {
      const payload: JSONObject = baseEvent();
      delete payload["uuid"];

      const first: NormalizedSecurityEvent = OktaNormalizer.normalize(payload);
      const second: NormalizedSecurityEvent = OktaNormalizer.normalize({
        ...payload,
      });

      expect(first.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(second.eventUid).toBe(first.eventUid);
      expect(
        OktaNormalizer.normalize({
          ...payload,
          published: "2026-09-12T10:16:00.123Z",
        }).eventUid,
      ).not.toBe(first.eventUid);
      expect(OktaNormalizer.normalize(baseEvent()).eventUid).toBe(
        "7f4a3c1e-2b9d-4e1f-8a6c-0d5e9f2b1c3a",
      );
    });

    test("reads the actor's display name when it has no alternateId, and nothing when there is no actor", () => {
      const systemActor: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.lifecycle.deactivate",
          actor: {
            id: "SystemPrincipal",
            type: "SystemPrincipal",
            alternateId: "",
            displayName: "Okta System",
            detailEntry: null,
          },
          client: client(""),
          target: [userTarget()],
        }),
      );

      expect(systemActor.principalUser).toBe("Okta System");
      expect(systemActor.principalIp).toBe("");
      expect(systemActor.observables).toEqual(["bob@example.com"]);

      const noActor: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({ actor: null, client: null }),
      );

      expect(noActor.principalUser).toBe("");
      expect(noActor.principalIp).toBe("");
      expect(noActor.observables).toEqual([]);
    });

    test("falls back to the target's display name when its alternateId is the 'unknown' placeholder", () => {
      const event: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.account.reset_password",
          target: [userTarget("Unknown", "Carol Example")],
        }),
      );

      expect(event.targetUser).toBe("Carol Example");
      expect(event.observables).toEqual(["alice@example.com", "203.0.113.42"]);
    });

    test("ignores a target that is not an array and non-object target entries", () => {
      expect(
        OktaNormalizer.normalize(
          baseEvent({
            eventType: "user.account.update_profile",
            target: { type: "User", alternateId: "bob@example.com" },
          }),
        ).targetUser,
      ).toBe("");

      const mixed: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.account.update_profile",
          target: ["junk", null, 42, userTarget()],
        }),
      );

      expect(mixed.targetUser).toBe("bob@example.com");
    });

    test("deduplicates observables case-insensitively and keeps the first spelling", () => {
      const event: NormalizedSecurityEvent = OktaNormalizer.normalize(
        baseEvent({
          eventType: "user.account.update_profile",
          target: [userTarget("Alice@Example.com", "Alice Example")],
        }),
      );

      expect(event.targetUser).toBe("Alice@Example.com");
      expect(event.observables).toEqual(["alice@example.com", "203.0.113.42"]);
    });
  });
});
