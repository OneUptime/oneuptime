import { describe, expect, test } from "@jest/globals";
import GoogleWorkspaceNormalizer, {
  GOOGLE_ADMIN_GRANTS,
  GOOGLE_LOGIN_FINDINGS,
  isGoogleWorkspaceActivity,
  prettyWorkspaceName,
  readGoogleWorkspaceActivity,
  readWorkspaceParameters,
} from "../../../../Utils/SecurityEvent/Connectors/GoogleWorkspaceNormalizer";
import { SecurityRecordReading } from "../../../../Utils/SecurityEvent/SecurityRecordReading";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { JSONObject } from "../../../../Types/JSON";
import { googleWorkspaceActivity } from "./GoogleWorkspaceFixtures";

/*
 * Google Workspace's audit logs as the Reports API returns them, read the
 * way the Google Workspace connection imports them: one event per Reports
 * API event worth reading - sign-ins and Google's own findings about them,
 * administrators' changes, apps given access, single sign-on, accounts'
 * security settings and Drive's sharing and downloads - and nothing for
 * the rest (a sign-out, a file viewed).
 */

function readOne(activity: JSONObject): SecurityRecordReading {
  const readings: Array<SecurityRecordReading> =
    readGoogleWorkspaceActivity(activity);

  expect(readings).toHaveLength(1);

  return readings[0]!;
}

describe("GoogleWorkspaceNormalizer - sign-ins", () => {
  test("a sign-in that worked is an Informational logon with Google's fields kept", () => {
    const reading: SecurityRecordReading = readOne(
      googleWorkspaceActivity("login", "login_success", [
        { name: "login_type", value: "google_password" },
        { name: "is_suspicious", boolValue: false },
      ]),
    );

    expect(reading.classUid).toBe(3002);
    expect(reading.activityName).toBe("Logon");
    expect(reading.statusName).toBe("Success");
    expect(reading.severity).toBe(OcsfSeverity.Informational);
    expect(reading.message).toBe(
      "alice@example.com signed in to Google from 203.0.113.7",
    );
    expect(reading.principalUser).toBe("alice@example.com");
    expect(reading.principalIp).toBe("203.0.113.7");
    expect(reading.eventUid).toBe(
      "google-workspace:login:-7461213048771283016:2026-10-30T09:45:12.345Z:0",
    );
    expect(reading.time?.toISOString()).toBe("2026-10-30T09:45:12.345Z");
    expect(reading.attributes["event.name"]).toBe("login_success");
    expect(reading.attributes["event.type"]).toBe("login");
    expect(reading.attributes["parameters.login_type"]).toBe("google_password");
    expect(reading.attributes["id.applicationName"]).toBe("login");
  });

  test("a failed sign-in says why; one Google calls suspicious is Medium", () => {
    const failed: SecurityRecordReading = readOne(
      googleWorkspaceActivity("login", "login_failure", [
        { name: "login_failure_type", value: "login_failure_invalid_password" },
      ]),
    );
    const suspicious: SecurityRecordReading = readOne(
      googleWorkspaceActivity("login", "login_failure", [
        { name: "is_suspicious", boolValue: true },
      ]),
    );

    expect(failed.statusName).toBe("Failure");
    expect(failed.severity).toBe(OcsfSeverity.Low);
    expect(failed.message).toBe(
      "Failed Google sign-in for alice@example.com from 203.0.113.7: invalid password",
    );
    expect(suspicious.severity).toBe(OcsfSeverity.Medium);
  });

  test("a challenge is a step of a sign-in", () => {
    const reading: SecurityRecordReading = readOne(
      googleWorkspaceActivity("login", "login_challenge", [
        { name: "login_challenge_status", value: "Challenge Passed" },
      ]),
    );

    expect(reading.statusName).toBe("Challenge");
    expect(reading.message).toBe(
      "Google asked alice@example.com to verify a sign-in from 203.0.113.7: Challenge Passed",
    );
  });

  test("a sign-out is not read", () => {
    expect(
      readGoogleWorkspaceActivity(googleWorkspaceActivity("login", "logout")),
    ).toEqual([]);
  });

  test("each of Google's findings is a finding at its own severity, for the account it is about", () => {
    for (const name of Object.keys(GOOGLE_LOGIN_FINDINGS)) {
      const reading: SecurityRecordReading = readOne(
        googleWorkspaceActivity("login", name, [
          { name: "affected_email_address", value: "bob@example.com" },
        ]),
      );

      expect({
        name,
        classUid: reading.classUid,
        severity: reading.severity,
        principalUser: reading.principalUser,
        ruleName: reading.ruleName,
      }).toEqual({
        name,
        classUid: 2004,
        severity: GOOGLE_LOGIN_FINDINGS[name]!.severity,
        principalUser: "bob@example.com",
        ruleName: GOOGLE_LOGIN_FINDINGS[name]!.title,
      });
    }

    expect(
      readOne(googleWorkspaceActivity("login", "gov_attack_warning")).message,
    ).toBe(
      "Google: Government-backed attack warning for alice@example.com from 203.0.113.7",
    );
  });
});

describe("GoogleWorkspaceNormalizer - administrators", () => {
  test("power granted is a Medium privilege change naming the role and the person", () => {
    for (const name of GOOGLE_ADMIN_GRANTS) {
      const reading: SecurityRecordReading = readOne(
        googleWorkspaceActivity("admin", name, [
          { name: "ROLE_NAME", value: "_SEED_ADMIN_ROLE" },
          { name: "USER_EMAIL", value: "bob@example.com" },
        ]),
      );

      expect({
        name,
        classUid: reading.classUid,
        activityName: reading.activityName,
        severity: reading.severity,
        targetUser: reading.targetUser,
      }).toEqual({
        name,
        classUid: 3005,
        activityName: "Assign Privileges",
        severity: OcsfSeverity.Medium,
        targetUser: "bob@example.com",
      });
    }

    expect(
      readOne(
        googleWorkspaceActivity("admin", "ASSIGN_ROLE", [
          { name: "ROLE_NAME", value: "_SEED_ADMIN_ROLE" },
          { name: "USER_EMAIL", value: "bob@example.com" },
        ]),
      ).message,
    ).toBe(
      "alice@example.com: Assign role (_SEED_ADMIN_ROLE → bob@example.com)",
    );
  });

  test("power taken away is Informational", () => {
    expect(
      readOne(googleWorkspaceActivity("admin", "REVOKE_ADMIN_PRIVILEGE"))
        .severity,
    ).toBe(OcsfSeverity.Informational);
  });

  test("account and group changes read as OCSF's account and group activities", () => {
    const cases: Array<[string, number, string, OcsfSeverity]> = [
      ["CREATE_USER", 3001, "Create", OcsfSeverity.Informational],
      ["DELETE_USER", 3001, "Delete", OcsfSeverity.Low],
      ["SUSPEND_USER", 3001, "Disable", OcsfSeverity.Informational],
      [
        "TURN_OFF_2_STEP_VERIFICATION",
        3001,
        "MFA Factor Disable",
        OcsfSeverity.Low,
      ],
      ["ADD_GROUP_MEMBER", 3006, "Add User", OcsfSeverity.Informational],
      [
        "CHANGE_APPLICATION_SETTING",
        3004,
        "Change application setting",
        OcsfSeverity.Informational,
      ],
    ];

    for (const [name, classUid, activityName, severity] of cases) {
      const reading: SecurityRecordReading = readOne(
        googleWorkspaceActivity("admin", name, [
          { name: "USER_EMAIL", value: "bob@example.com" },
        ]),
      );

      expect({
        name,
        classUid: reading.classUid,
        activityName: reading.activityName,
        severity: reading.severity,
      }).toEqual({ name, classUid, activityName, severity });
    }
  });
});

describe("GoogleWorkspaceNormalizer - apps, single sign-on and accounts", () => {
  test("an app given access names the app and how many scopes", () => {
    const reading: SecurityRecordReading = readOne(
      googleWorkspaceActivity("token", "authorize", [
        { name: "app_name", value: "Files Exporter" },
        { name: "client_id", value: "1234.apps.googleusercontent.com" },
        {
          name: "scope",
          multiValue: [
            "https://www.googleapis.com/auth/drive",
            "https://mail.google.com/",
            "openid",
          ],
        },
      ]),
    );

    expect(reading.classUid).toBe(3003);
    expect(reading.message).toBe(
      "alice@example.com gave an app access: Files Exporter (3 scopes)",
    );
    expect(reading.targetResource).toBe("Files Exporter");
  });

  test("a single sign-on that failed is a Low failure naming the app; other SAML events are not read", () => {
    const reading: SecurityRecordReading = readOne(
      googleWorkspaceActivity("saml", "login_failure", [
        { name: "application_name", value: "Slack" },
      ]),
    );

    expect(reading.statusName).toBe("Failure");
    expect(reading.severity).toBe(OcsfSeverity.Low);
    expect(reading.message).toBe(
      "Failed single sign-on for alice@example.com to Slack from 203.0.113.7",
    );
    expect(
      readGoogleWorkspaceActivity(
        googleWorkspaceActivity("saml", "some_other_event"),
      ),
    ).toEqual([]);
  });

  test("2-Step Verification turned off is Low; a password changed is Informational", () => {
    expect(
      readOne(googleWorkspaceActivity("user_accounts", "2sv_disable")).severity,
    ).toBe(OcsfSeverity.Low);
    expect(
      readOne(googleWorkspaceActivity("user_accounts", "password_change"))
        .severity,
    ).toBe(OcsfSeverity.Informational);
  });
});

describe("GoogleWorkspaceNormalizer - Drive", () => {
  test("a file opened to anyone with the link is a Low share", () => {
    const reading: SecurityRecordReading = readOne(
      googleWorkspaceActivity("drive", "change_document_visibility", [
        { name: "doc_title", value: "Budget" },
        { name: "visibility", value: "people_with_link" },
        { name: "owner", value: "alice@example.com" },
      ]),
    );

    expect(reading.classUid).toBe(6006);
    expect(reading.activityName).toBe("Share");
    expect(reading.severity).toBe(OcsfSeverity.Low);
    expect(reading.message).toBe(
      "alice@example.com changed who can open Budget in Google Drive: people with link",
    );
  });

  test("a file shared with someone in another domain is Low; within the owner's own, Informational", () => {
    const outside: SecurityRecordReading = readOne(
      googleWorkspaceActivity("drive", "change_user_access", [
        { name: "doc_title", value: "Budget" },
        { name: "owner", value: "alice@example.com" },
        { name: "target_user", value: "bob@fabrikam.example" },
      ]),
    );
    const inside: SecurityRecordReading = readOne(
      googleWorkspaceActivity("drive", "change_user_access", [
        { name: "doc_title", value: "Budget" },
        { name: "owner", value: "alice@example.com" },
        { name: "target_user", value: "carol@example.com" },
      ]),
    );

    expect(outside.severity).toBe(OcsfSeverity.Low);
    expect(outside.targetUser).toBe("bob@fabrikam.example");
    expect(inside.severity).toBe(OcsfSeverity.Informational);
  });

  test("a download is read; a file viewed is not", () => {
    expect(
      readOne(
        googleWorkspaceActivity("drive", "download", [
          { name: "doc_title", value: "Budget" },
        ]),
      ).message,
    ).toBe("alice@example.com downloaded Budget from Google Drive");
    expect(
      readGoogleWorkspaceActivity(googleWorkspaceActivity("drive", "view")),
    ).toEqual([]);
  });
});

describe("GoogleWorkspaceNormalizer - activities and parameters", () => {
  test("each event of an activity worth reading is an event of its own, with an id of its own", () => {
    const activity: JSONObject = googleWorkspaceActivity(
      "admin",
      "CREATE_USER",
      [{ name: "USER_EMAIL", value: "bob@example.com" }],
    );
    (activity["events"] as Array<JSONObject>).push(
      { type: "USER_SETTINGS", name: "GRANT_ADMIN_PRIVILEGE", parameters: [] },
      { type: "USER_SETTINGS", name: "not an object" },
    );
    (activity["events"] as Array<unknown>).push("text");

    const readings: Array<SecurityRecordReading> =
      readGoogleWorkspaceActivity(activity);

    expect(
      readings.map((reading: SecurityRecordReading): string => {
        return reading.eventUid.split(":").pop()!;
      }),
    ).toEqual(["0", "1", "2"]);
    expect(
      new Set(
        readings.map((reading: SecurityRecordReading): string => {
          return reading.eventUid;
        }),
      ).size,
    ).toBe(3);
  });

  test("an application the connection does not read gives nothing", () => {
    expect(
      readGoogleWorkspaceActivity(
        googleWorkspaceActivity("calendar", "create_event"),
      ),
    ).toEqual([]);
  });

  test("parameters read as text whatever their kind, and nothing odd gets in", () => {
    expect(
      readWorkspaceParameters({
        parameters: [
          { name: "value", value: "text" },
          { name: "int", intValue: "42" },
          { name: "bool", boolValue: true },
          { name: "many", multiValue: ["a", "b"] },
          { name: "ints", multiIntValue: ["1", "2"] },
          { name: "__proto__", value: "x" },
          { value: "no name" },
          "text",
        ],
      }),
    ).toEqual({
      value: "text",
      int: "42",
      bool: "true",
      many: "a,b",
      ints: "1,2",
    });
    expect(readWorkspaceParameters({ parameters: "none" })).toEqual({});
  });

  test("prettyWorkspaceName makes Google's names words", () => {
    expect(prettyWorkspaceName("ASSIGN_ROLE")).toBe("Assign role");
    expect(prettyWorkspaceName("login_failure")).toBe("Login failure");
    expect(prettyWorkspaceName("")).toBe("");
  });

  test("an activity is told by its application and its events", () => {
    expect(
      isGoogleWorkspaceActivity(googleWorkspaceActivity("login", "logout")),
    ).toBe(true);
    expect(
      isGoogleWorkspaceActivity({ id: { applicationName: "login" } }),
    ).toBe(false);
    expect(isGoogleWorkspaceActivity({ events: [] })).toBe(false);
  });

  test("the connection's normalizer stamps Google Workspace on every event", () => {
    const events: Array<NormalizedSecurityEvent> =
      GoogleWorkspaceNormalizer.normalize(
        googleWorkspaceActivity("login", "login_success"),
      );

    expect(events).toHaveLength(1);
    expect(events[0]!.vendorName).toBe("Google");
    expect(events[0]!.productName).toBe("Google Workspace");
    expect(events[0]!.className).toBe("Authentication");
    expect(GoogleWorkspaceNormalizer.isRecognized({})).toBe(false);
  });
});
