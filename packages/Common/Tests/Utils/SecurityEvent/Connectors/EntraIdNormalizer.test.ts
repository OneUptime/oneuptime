import { describe, expect, test } from "@jest/globals";
import {
  ENTRA_INTERRUPT_CODES,
  ENTRA_LOG_ATTRIBUTE,
  EntraLog,
  PRIVILEGED_ENTRA_ROLES,
  isEntraDirectoryAudit,
  isEntraSignIn,
  readEntraDirectoryAudit,
  readEntraRisk,
  readEntraSignIn,
  readSignInOutcome,
} from "../../../../Utils/SecurityEvent/Connectors/EntraIdNormalizer";
import { readEntraExportRecord } from "../../../../Utils/SecurityEvent/LogParsers/AzureActivityLogParser";
import {
  SecurityRecordReading,
  toNormalizedSecurityEvent,
} from "../../../../Utils/SecurityEvent/SecurityRecordReading";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  entraConsent,
  entraExport,
  entraFailedSignIn,
  entraRiskDetection,
  entraRoleAssignment,
  entraSignIn,
} from "./EntraIdFixtures";

/*
 * Microsoft Entra ID's records as Microsoft Graph returns them, read the
 * way the Microsoft Entra ID connection imports them: how a sign-in's
 * outcome and risk read (an MFA prompt is not a failure), which directory
 * changes matter more (a privileged role), Identity Protection's risks,
 * and that a record read from Graph and the same record exported to the
 * project's logs become the same event.
 */

describe("EntraIdNormalizer - sign-ins", () => {
  test("a sign-in that worked is an Informational logon naming who, to what, from where", () => {
    const reading: SecurityRecordReading = readEntraSignIn(entraSignIn());

    expect(reading.classUid).toBe(3002);
    expect(reading.activityName).toBe("Logon");
    expect(reading.statusName).toBe("Success");
    expect(reading.severity).toBe(OcsfSeverity.Informational);
    expect(reading.message).toBe(
      "alice@contoso.example signed in to Azure Portal from 203.0.113.7 in Seattle, US",
    );
    expect(reading.principalUser).toBe("alice@contoso.example");
    expect(reading.principalIp).toBe("203.0.113.7");
    expect(reading.targetResource).toBe("Azure Portal");
    expect(reading.eventUid).toBe(
      "entra:signin:66ea54eb-6301-4ee5-be62-ff5a759b0100",
    );
    expect(reading.time?.toISOString()).toBe("2026-10-30T09:57:40.000Z");
    expect(reading.attributes[ENTRA_LOG_ATTRIBUTE]).toBe(EntraLog.SignInLogs);
    // Graph's own field names, for rules to read.
    expect(reading.attributes["riskLevelDuringSignIn"]).toBe("none");
    // Attributes are text, as the event table stores them.
    expect(reading.attributes["status.errorCode"]).toBe("0");
  });

  test("a wrong password is a Low failure with Entra's reason and code", () => {
    const reading: SecurityRecordReading = readEntraSignIn(entraFailedSignIn());

    expect(reading.statusName).toBe("Failure");
    expect(reading.severity).toBe(OcsfSeverity.Low);
    expect(reading.message).toBe(
      "Failed sign-in for alice@contoso.example to Azure Portal from 203.0.113.7 in Seattle, US: Error validating credentials due to invalid username or password. (50126)",
    );
  });

  test("a sign-in waiting on MFA or a prompt is a step, not a failure", () => {
    for (const errorCode of ENTRA_INTERRUPT_CODES) {
      const signIn: ReturnType<typeof entraSignIn> = entraSignIn({
        status: {
          errorCode,
          failureReason: "Strong Authentication is required.",
        },
      });

      expect({ errorCode, outcome: readSignInOutcome(signIn) }).toEqual({
        errorCode,
        outcome: "Interrupted",
      });
    }

    const reading: SecurityRecordReading = readEntraSignIn(
      entraSignIn({
        status: {
          errorCode: 50074,
          failureReason: "Strong Authentication is required.",
        },
      }),
    );

    expect(reading.severity).toBe(OcsfSeverity.Informational);
    expect(reading.message).toBe(
      "alice@contoso.example's sign-in to Azure Portal from 203.0.113.7 in Seattle, US needs another step: Strong Authentication is required. (50074)",
    );
  });

  test("risk raises a sign-in's severity and says so first", () => {
    const risky: SecurityRecordReading = readEntraSignIn(
      entraSignIn({ riskLevelDuringSignIn: "high" }),
    );
    const riskyFailure: SecurityRecordReading = readEntraSignIn(
      entraFailedSignIn({ riskLevelAggregated: "medium" }),
    );

    expect(risky.severity).toBe(OcsfSeverity.High);
    expect(
      risky.message.startsWith(
        "High-risk sign-in: alice@contoso.example signed in",
      ),
    ).toBe(true);
    expect(riskyFailure.severity).toBe(OcsfSeverity.Medium);
    expect(
      riskyFailure.message.startsWith(
        "Medium-risk failed sign-in for alice@contoso.example",
      ),
    ).toBe(true);
    // Low risk is not called out.
    expect(
      readEntraSignIn(entraSignIn({ riskLevelDuringSignIn: "low" })).severity,
    ).toBe(OcsfSeverity.Informational);
  });

  test("an app's own sign-in names the app, and a device's name is its host", () => {
    const servicePrincipal: SecurityRecordReading = readEntraSignIn(
      entraSignIn({
        userPrincipalName: "",
        servicePrincipalName: "Build Pipeline",
      }),
      EntraLog.ServicePrincipalSignInLogs,
    );
    const fromDevice: SecurityRecordReading = readEntraSignIn(
      entraSignIn({
        deviceDetail: {
          displayName: "ALICE-LAPTOP",
          operatingSystem: "Windows 11",
        },
      }),
    );

    expect(servicePrincipal.principalUser).toBe("Build Pipeline");
    expect(servicePrincipal.attributes[ENTRA_LOG_ATTRIBUTE]).toBe(
      EntraLog.ServicePrincipalSignInLogs,
    );
    expect(fromDevice.principalHost).toBe("ALICE-LAPTOP");
  });

  test("an address that is not a remote one is left out", () => {
    expect(
      readEntraSignIn(entraSignIn({ ipAddress: "127.0.0.1" })).principalIp,
    ).toBe("");
  });
});

describe("EntraIdNormalizer - directory changes", () => {
  test("a privileged role assigned is a Medium privilege change naming the role and who got it", () => {
    const reading: SecurityRecordReading = readEntraDirectoryAudit(
      entraRoleAssignment("Global Administrator"),
    );

    expect(reading.classUid).toBe(3005);
    expect(reading.activityName).toBe("Add member to role");
    expect(reading.statusName).toBe("Success");
    expect(reading.severity).toBe(OcsfSeverity.Medium);
    expect(reading.targetResource).toBe("Global Administrator");
    expect(reading.message).toContain(
      "Add member to role (Global Administrator → ",
    );
    expect(reading.eventUid.startsWith("entra:audit:")).toBe(true);
    expect(reading.attributes[ENTRA_LOG_ATTRIBUTE]).toBe(EntraLog.AuditLogs);
  });

  test("every privileged role is Medium; another role is Informational", () => {
    for (const role of PRIVILEGED_ENTRA_ROLES) {
      const title: string = role
        .split(" ")
        .map((word: string): string => {
          return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
        })
        .join(" ");

      expect({
        role,
        severity: readEntraDirectoryAudit(entraRoleAssignment(title)).severity,
      }).toEqual({ role, severity: OcsfSeverity.Medium });
    }

    expect(
      readEntraDirectoryAudit(entraRoleAssignment("Directory Readers"))
        .severity,
    ).toBe(OcsfSeverity.Informational);
  });

  test("a change that failed is Low and says why", () => {
    const reading: SecurityRecordReading = readEntraDirectoryAudit(
      entraConsent({
        result: "failure",
        resultReason: "Policy blocked consent",
      }),
    );

    expect(reading.statusName).toBe("Failure");
    expect(reading.severity).toBe(OcsfSeverity.Low);
    expect(reading.message).toBe(
      "bob@contoso.example: Consent to application (Mail Exporter Pro) - Policy blocked consent",
    );
    expect(reading.principalIp).toBe("198.51.100.23");
  });

  test("the class follows the category", () => {
    const cases: Array<[string, number]> = [
      ["UserManagement", 3001],
      ["GroupManagement", 3006],
      ["RoleManagement", 3005],
      ["ApplicationManagement", 3004],
      ["Policy", 3004],
    ];

    for (const [category, classUid] of cases) {
      expect({
        category,
        classUid: readEntraDirectoryAudit(entraConsent({ category })).classUid,
      }).toEqual({ category, classUid });
    }
  });

  test("a change an app made names the app", () => {
    const reading: SecurityRecordReading = readEntraDirectoryAudit(
      entraConsent({
        initiatedBy: { app: { displayName: "Microsoft Graph PowerShell" } },
      }),
    );

    expect(reading.principalUser).toBe("Microsoft Graph PowerShell");
  });
});

describe("EntraIdNormalizer - Identity Protection", () => {
  test("a risk detected is a finding in Identity Protection's own words", () => {
    const reading: SecurityRecordReading | null = readEntraRisk(
      entraRiskDetection(),
      EntraLog.UserRiskEvents,
    );

    expect(reading?.classUid).toBe(2004);
    expect(reading?.severity).toBe(OcsfSeverity.High);
    expect(reading?.message).toBe(
      "Microsoft Entra ID Protection: Anonymous IP address for alice@contoso.example (high risk)",
    );
    expect(reading?.ruleId).toBe("anonymizedIPAddress");
    expect(reading?.principalIp).toBe("203.0.113.99");
    expect(reading?.time?.toISOString()).toBe("2026-10-30T09:51:00.000Z");
  });

  test("a risk dismissed or remediated is no longer one; one confirmed is Critical", () => {
    for (const riskState of ["dismissed", "remediated", "confirmedSafe"]) {
      expect(
        readEntraRisk(
          entraRiskDetection({ riskState }),
          EntraLog.UserRiskEvents,
        ),
      ).toBeNull();
    }

    const confirmed: SecurityRecordReading | null = readEntraRisk(
      entraRiskDetection({ riskState: "confirmedCompromised" }),
      EntraLog.RiskyUsers,
    );

    expect(confirmed?.severity).toBe(OcsfSeverity.Critical);
    expect(confirmed?.ruleName).toBe("User confirmed compromised");
  });
});

describe("EntraIdNormalizer - shapes and both paths", () => {
  test("a sign-in and a directory audit are told apart by their fields", () => {
    expect(isEntraSignIn(entraSignIn())).toBe(true);
    expect(isEntraSignIn(entraRoleAssignment())).toBe(false);
    expect(isEntraDirectoryAudit(entraRoleAssignment())).toBe(true);
    expect(isEntraDirectoryAudit(entraSignIn())).toBe(false);
    expect(isEntraSignIn({})).toBe(false);
  });

  test("a sign-in read from Graph and the same sign-in exported to the logs are one event", () => {
    const fromGraph: NormalizedSecurityEvent = toNormalizedSecurityEvent({
      reading: readEntraSignIn(entraFailedSignIn()),
      vendorName: "Microsoft",
      productName: "Microsoft Entra ID",
      raw: entraFailedSignIn(),
    });
    const exported: SecurityRecordReading | null = readEntraExportRecord(
      entraExport("SignInLogs", entraFailedSignIn()),
    );

    expect(exported?.eventUid).toBe(fromGraph.eventUid);
    expect(exported?.message).toBe(fromGraph.message);
    expect(exported?.statusName).toBe(fromGraph.statusName);
  });
});
