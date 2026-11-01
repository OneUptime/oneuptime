import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import AzureActivityLogParser, {
  AZURE_PREFILTER_WORDS,
  azureCategoryMarkers,
  readAzureRecords,
  subscriptionOf,
} from "../../../../Utils/SecurityEvent/LogParsers/AzureActivityLogParser";
import { ENTRA_LOG_ATTRIBUTE } from "../../../../Utils/SecurityEvent/Connectors/EntraIdNormalizer";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { logLine } from "./LogParserFixtures";
import {
  azureActivityApiEvent,
  azureActivityExport,
  entraConsent,
  entraExport,
  entraFailedSignIn,
  entraRiskDetection,
  entraRoleAssignment,
  entraSignIn,
} from "../Connectors/EntraIdFixtures";

/*
 * Contract under test - what Azure's diagnostic settings export (the
 * Activity Log, and Microsoft Entra ID's logs), forwarded as logs, becomes
 * security events (AzureActivityLogParser).
 */

function parse(body: JSONObject | string): Array<NormalizedSecurityEvent> {
  return AzureActivityLogParser.parse(
    logLine(typeof body === "string" ? body : JSON.stringify(body)),
  );
}

function only(body: JSONObject | string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(body);

  expect(events).toHaveLength(1);

  return events[0]!;
}

describe("AzureActivityLogParser - the Activity Log", () => {
  test("a change that ended is an API Activity naming who made it, from where, on what", () => {
    const event: NormalizedSecurityEvent = only(azureActivityExport());

    expect({
      className: event.className,
      activityName: event.activityName,
      statusName: event.statusName,
      severityName: event.severityName,
      vendorName: event.vendorName,
      productName: event.productName,
      principalUser: event.principalUser,
      principalIp: event.principalIp,
      targetHost: event.targetHost,
      time: event.time.toISOString(),
    }).toEqual({
      className: "API Activity",
      activityName: "MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/WRITE",
      statusName: "Success",
      severityName: "Informational",
      vendorName: "Microsoft",
      productName: "Azure Activity Log",
      principalUser: "alice@contoso.example",
      principalIp: "203.0.113.7",
      targetHost: "11111111-2222-3333-4444-555555555555",
      time: "2026-10-30T09:59:01.000Z",
    });
    expect(event.attributes["identity.authorization.action"]).toBe(
      "Microsoft.Authorization/roleAssignments/write",
    );
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.AzureActivity,
    );
  });

  test("an operation that failed is a Low failure", () => {
    const event: NormalizedSecurityEvent = only(
      azureActivityExport({ resultType: "Failure" }),
    );

    expect([event.statusName, event.severityName]).toEqual(["Failure", "Low"]);
    expect(event.message.endsWith("(failed)")).toBe(true);
  });

  test.each(["Start", "Accept", "Started", "Accepted", ""])(
    "an operation's %p phase is not its end, and not an event",
    (resultType: string) => {
      expect(parse(azureActivityExport({ resultType }))).toEqual([]);
    },
  );

  test("the REST API's record is read too: its caller, its address and its id", () => {
    const event: NormalizedSecurityEvent = only(azureActivityApiEvent());

    expect(event.activityName).toBe(
      "Microsoft.Insights/diagnosticSettings/delete",
    );
    expect(event.principalUser).toBe("mallory@contoso.example");
    expect(event.principalIp).toBe("198.51.100.66");
    expect(event.eventUid).toBe(
      "azure-activity:a0b1c2d3-0000-4000-8000-000000000008",
    );
    expect(event.time.toISOString()).toBe("2026-10-30T09:59:30.123Z");
  });

  test("a Defender for Cloud alert is a finding at its own severity", () => {
    const event: NormalizedSecurityEvent = only(
      azureActivityExport({
        category: "Security",
        operationName: "Microsoft.Security/locations/alerts/activate/action",
        properties: {
          alertName: "Suspicious PowerShell activity detected",
          severity: "High",
        },
      }),
    );

    expect(event.className).toBe("Detection Finding");
    expect(event.severityName).toBe("High");
    expect(event.ruleName).toBe("Suspicious PowerShell activity detected");
  });

  test("Azure Policy refusing a request is an event; auditing one is not", () => {
    const denied: NormalizedSecurityEvent = only(
      azureActivityExport({
        category: "Policy",
        operationName: "MICROSOFT.AUTHORIZATION/POLICIES/DENY/ACTION",
        resultType: "Failure",
      }),
    );

    expect(denied.statusName).toBe("Failure");
    expect(
      parse(
        azureActivityExport({
          category: "Policy",
          operationName: "MICROSOFT.AUTHORIZATION/POLICIES/AUDIT/ACTION",
        }),
      ),
    ).toEqual([]);
  });

  test.each([
    "ServiceHealth",
    "ResourceHealth",
    "Autoscale",
    "Recommendation",
    "Alert",
  ])("a %s record is not a security event", (category: string) => {
    expect(parse(azureActivityExport({ category }))).toEqual([]);
  });
});

describe("AzureActivityLogParser - Microsoft Entra ID's logs", () => {
  test("an interactive sign-in is an event whatever its outcome", () => {
    const succeeded: NormalizedSecurityEvent = only(
      entraExport("SignInLogs", entraSignIn()),
    );
    const failed: NormalizedSecurityEvent = only(
      entraExport("SignInLogs", entraFailedSignIn()),
    );

    expect(succeeded.productName).toBe("Microsoft Entra ID");
    expect(succeeded.statusName).toBe("Success");
    expect(failed.statusName).toBe("Failure");
    expect(failed.attributes[ENTRA_LOG_ATTRIBUTE]).toBe("SignInLogs");
    // The same id the Microsoft Entra ID connection gives the same sign-in.
    expect(succeeded.eventUid).toBe(
      "entra:signin:66ea54eb-6301-4ee5-be62-ff5a759b0100",
    );
  });

  test("an app's background sign-in for a person is an event only when it failed", () => {
    expect(
      parse(entraExport("NonInteractiveUserSignInLogs", entraSignIn())),
    ).toEqual([]);
    expect(
      parse(entraExport("NonInteractiveUserSignInLogs", entraFailedSignIn())),
    ).toHaveLength(1);
  });

  test("an app's own sign-in failing names the app", () => {
    const event: NormalizedSecurityEvent = only(
      entraExport(
        "ServicePrincipalSignInLogs",
        entraFailedSignIn({
          userPrincipalName: null,
          servicePrincipalName: "payroll-sync",
          appDisplayName: "payroll-sync",
        }),
      ),
    );

    expect(event.principalUser).toBe("payroll-sync");
    expect(event.attributes[ENTRA_LOG_ATTRIBUTE]).toBe(
      "ServicePrincipalSignInLogs",
    );
  });

  test("a role assigned in the directory is a User Access Management event", () => {
    const event: NormalizedSecurityEvent = only(
      entraExport("AuditLogs", entraRoleAssignment()),
    );

    expect(event.className).toBe("User Access Management");
    expect(event.severityName).toBe("Medium");
    expect(event.targetUser).toBe("mallory@contoso.example");
    expect(event.targetResource).toBe("Global Administrator");
  });

  test("an Identity Protection risk is a finding", () => {
    const event: NormalizedSecurityEvent = only(
      entraExport("UserRiskEvents", entraRiskDetection()),
    );

    expect(event.className).toBe("Detection Finding");
    expect(event.ruleName).toBe("Anonymous IP address");
    expect(event.severityName).toBe("High");
  });

  test("a consent to an application is an Entity Management event naming the app", () => {
    const event: NormalizedSecurityEvent = only(
      entraExport("AuditLogs", entraConsent()),
    );

    expect(event.className).toBe("Entity Management");
    expect(event.targetResource).toBe("Mail Exporter Pro");
  });

  test.each([
    "ManagedIdentitySignInLogs",
    "ProvisioningLogs",
    "MicrosoftGraphActivityLogs",
  ])("a %s record is not read", (category: string) => {
    expect(parse(entraExport(category, entraFailedSignIn()))).toEqual([]);
  });
});

describe("AzureActivityLogParser - Azure's batches", () => {
  test("an Event Hub batch of records is read record by record", () => {
    const batch: JSONObject = {
      records: [
        entraExport("SignInLogs", entraFailedSignIn()),
        azureActivityExport({ resultType: "Start" }),
        azureActivityExport(),
        entraExport("NonInteractiveUserSignInLogs", entraSignIn()),
        entraExport("NonInteractiveUserSignInLogs", entraFailedSignIn()),
      ],
    };
    const events: Array<NormalizedSecurityEvent> = parse(batch);

    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return `${event.productName}:${event.statusName}`;
      }),
    ).toEqual([
      "Microsoft Entra ID:Failure",
      "Azure Activity Log:Success",
      "Microsoft Entra ID:Failure",
    ]);
    expect(matchesSecurityLogPrefilter(JSON.stringify(batch))).toBe(true);
  });

  test("a batch whose successes outnumber its failures is never kept out by its successes", () => {
    const records: Array<JSONObject> = [];

    for (let index: number = 0; index < 50; index++) {
      records.push(entraExport("NonInteractiveUserSignInLogs", entraSignIn()));
    }

    records.push(
      entraExport("NonInteractiveUserSignInLogs", entraFailedSignIn()),
    );

    const line: string = JSON.stringify({ records });

    expect(matchesSecurityLogPrefilter(line)).toBe(true);
    expect(parse(line)).toHaveLength(1);
  });

  test("readAzureRecords reads at most 500 records of a batch", () => {
    const records: Array<JSONObject> = Array.from({ length: 600 }, () => {
      return { category: "x" };
    });

    expect(readAzureRecords(JSON.stringify({ records }))).toHaveLength(500);
  });

  test("a record whose category is written another way than the line's prefilter reads is not read", () => {
    // A category spelled with a tab after the colon is not one of the four ways.
    const line: string = JSON.stringify(azureActivityExport()).replace(
      '"category":"Administrative"',
      '"category":\t"Administrative"',
    );

    expect(parse(line)).toEqual([]);
  });
});

describe("AzureActivityLogParser - helpers", () => {
  test("subscriptionOf reads a resource id's subscription, in any case", () => {
    expect(
      subscriptionOf("/SUBSCRIPTIONS/abc/RESOURCEGROUPS/x/PROVIDERS/y"),
    ).toBe("abc");
    expect(subscriptionOf("/subscriptions/def")).toBe("def");
    expect(subscriptionOf("/tenants/t/providers/Microsoft.aadiam")).toBe("");
  });

  test("each category is named four ways, lowercase", () => {
    expect(azureCategoryMarkers("SignInLogs")).toEqual([
      '"category":"signinlogs"',
      '"category": "signinlogs"',
      '"category":{"value":"signinlogs"',
      '"category": {"value": "signinlogs"',
    ]);

    for (const word of AZURE_PREFILTER_WORDS) {
      expect(word).toBe(word.toLowerCase());
    }
  });

  test("the whole log parser reads an export as Azure events", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(JSON.stringify(entraExport("SignInLogs", entraFailedSignIn()))),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.AzureActivity,
    );
  });

  test("lines that are not Azure records are not read", () => {
    for (const body of [
      "",
      "text",
      "{}",
      "[]",
      '{"category":',
      '{"records":"x"}',
    ]) {
      expect({ body, events: parse(body) }).toEqual({ body, events: [] });
    }
  });
});

describe("AzureActivityLogParser - long lines", () => {
  test("a batch near the longest line read reads in time that grows with it", () => {
    const records: Array<JSONObject> = Array.from({ length: 300 }, () => {
      return entraExport("SignInLogs", entraFailedSignIn());
    });
    const line: string = JSON.stringify({ records });
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return AzureActivityLogParser.parse(logLine(line)).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});
