import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import GoogleCloudAuditLogParser, {
  GOOGLE_AUDIT_FILTERED_LOG_MARKERS,
  GOOGLE_AUDIT_REFUSAL_MARKERS,
  GoogleCloudAuditLog,
  readGoogleAuditLog,
  shortMethodName,
} from "../../../../Utils/SecurityEvent/LogParsers/GoogleCloudAuditLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { logLine } from "./LogParserFixtures";
import { googleAuditEntry } from "./GoogleCloudAuditFixtures";

/*
 * Contract under test - Google Cloud's audit logs, exported by a log sink
 * and forwarded as logs, become security events (GoogleCloudAuditLogParser):
 * Admin Activity and Policy Denied whole, Data Access and System Event only
 * for refusals and Workspace's sign-ins.
 *
 * Entries follow Google's LogEntry and AuditLog layouts
 * (cloud.google.com/logging/docs/reference/audit/auditlog/rest).
 */

function parse(entry: JSONObject | string): Array<NormalizedSecurityEvent> {
  return GoogleCloudAuditLogParser.parse(
    logLine(typeof entry === "string" ? entry : JSON.stringify(entry)),
  );
}

function only(entry: JSONObject | string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(entry);

  expect(events).toHaveLength(1);

  return events[0]!;
}

const DENIED: JSONObject = {
  status: { code: 7, message: "PERMISSION_DENIED" },
  authorizationInfo: [
    {
      resource: "projects/_/buckets/payroll",
      permission: "storage.objects.list",
      granted: false,
    },
  ],
  serviceName: "storage.googleapis.com",
  methodName: "storage.objects.list",
  resourceName: "projects/_/buckets/payroll",
};

describe("GoogleCloudAuditLogParser - Admin Activity", () => {
  test("a change is an API Activity naming who made it, from where, on what", () => {
    const event: NormalizedSecurityEvent = only(googleAuditEntry("activity"));

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
      targetResource: event.targetResource,
      eventUid: event.eventUid,
      time: event.time.toISOString(),
      message: event.message,
    }).toEqual({
      className: "API Activity",
      activityName: "CreateServiceAccountKey",
      statusName: "Success",
      severityName: "Informational",
      vendorName: "Google",
      productName: "Google Cloud Audit Logs",
      principalUser: "alice@example.com",
      principalIp: "203.0.113.7",
      targetHost: "acme-prod",
      targetResource:
        "projects/-/serviceAccounts/app@acme-prod.iam.gserviceaccount.com",
      eventUid: "gcp-audit:1a2b3c4d5e",
      time: "2026-10-30T09:58:12.345Z",
      message:
        "alice@example.com called CreateServiceAccountKey on iam.googleapis.com (projects/-/serviceAccounts/app@acme-prod.iam.gserviceaccount.com)",
    });
    expect(event.attributes["protoPayload.methodName"]).toBe(
      "google.iam.admin.v1.CreateServiceAccountKey",
    );
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.GoogleCloudAudit,
    );
  });

  test("a change Google refused is a Low failure with Google's reason", () => {
    const event: NormalizedSecurityEvent = only(
      googleAuditEntry("activity", {
        status: { code: 7, message: "Permission 'iam.roles.update' denied" },
      }),
    );

    expect(event.statusName).toBe("Failure");
    expect(event.severityName).toBe("Low");
    expect(
      event.message.endsWith(": Permission 'iam.roles.update' denied"),
    ).toBe(true);
  });

  test("a call from inside Google names a network, not an address, so no address is kept", () => {
    expect(
      only(
        googleAuditEntry("activity", {
          requestMetadata: { callerIp: "private" },
        }),
      ).principalIp,
    ).toBe("");
  });

  test("a long-running operation's poll is not a change", () => {
    expect(
      parse(
        googleAuditEntry("activity", {
          methodName: "google.longrunning.Operations.GetOperation",
        }),
      ),
    ).toEqual([]);
  });

  test("an audit sink re-routed away from the Data Access log is still read", () => {
    const entry: JSONObject = googleAuditEntry("activity", {
      serviceName: "logging.googleapis.com",
      methodName: "google.logging.v2.ConfigServiceV2.UpdateSink",
      request: {
        sinkName: "projects/acme-prod/sinks/to-siem",
        sink: {
          filter:
            'logName:"projects/acme-prod/logs/cloudaudit.googleapis.com%2Fdata_access"',
        },
      },
    });
    const line: string = JSON.stringify(entry);

    expect(only(line).activityName).toBe("UpdateSink");
    expect(matchesSecurityLogPrefilter(line)).toBe(true);
  });
});

describe("GoogleCloudAuditLogParser - the other three logs", () => {
  test("Policy Denied is always an event", () => {
    const event: NormalizedSecurityEvent = only(
      googleAuditEntry("policy", {
        status: {
          code: 7,
          message: "Request is prohibited by organization's policy",
        },
        serviceName: "storage.googleapis.com",
        methodName: "google.storage.objects.get",
      }),
    );

    expect(event.statusName).toBe("Failure");
    expect(event.severityName).toBe("Low");
  });

  test("a Data Access read Google allowed stays a log, and never leaves the database", () => {
    const line: string = JSON.stringify(
      googleAuditEntry("data_access", {
        serviceName: "storage.googleapis.com",
        methodName: "storage.objects.get",
      }),
    );

    expect(parse(line)).toEqual([]);
    expect(matchesSecurityLogPrefilter(line)).toBe(false);
  });

  test("a Data Access read Google refused is an event", () => {
    const line: string = JSON.stringify(
      googleAuditEntry("data_access", DENIED),
    );
    const event: NormalizedSecurityEvent = only(line);

    expect(event.statusName).toBe("Failure");
    expect(event.activityName).toBe("list");
    expect(matchesSecurityLogPrefilter(line)).toBe(true);
  });

  test("an unauthenticated read (16) is refused too", () => {
    expect(
      parse(
        googleAuditEntry("data_access", {
          status: { code: 16, message: "UNAUTHENTICATED" },
          authorizationInfo: [],
        }),
      ),
    ).toHaveLength(1);
  });

  test("a System Event is Google acting on its own, and stays a log", () => {
    expect(
      parse(
        googleAuditEntry("system_event", {
          authenticationInfo: {},
          serviceName: "compute.googleapis.com",
          methodName: "compute.instances.migrateOnHostMaintenance",
        }),
      ),
    ).toEqual([]);
  });

  test("Workspace's sign-ins, shared with Google Cloud, are Authentication events", () => {
    const failed: NormalizedSecurityEvent = only(
      googleAuditEntry("data_access", {
        serviceName: "login.googleapis.com",
        methodName: "google.login.LoginService.loginFailure",
        authenticationInfo: { principalEmail: "bob@example.com" },
      }),
    );
    const succeeded: NormalizedSecurityEvent = only(
      googleAuditEntry("data_access", {
        serviceName: "login.googleapis.com",
        methodName: "google.login.LoginService.loginSuccess",
        authenticationInfo: { principalEmail: "bob@example.com" },
      }),
    );

    expect([failed.className, failed.statusName, failed.principalUser]).toEqual(
      ["Authentication", "Failure", "bob@example.com"],
    );
    expect(failed.message).toBe(
      "Failed Google sign-in for bob@example.com from 203.0.113.7",
    );
    expect(succeeded.statusName).toBe("Success");
    expect(
      parse(
        googleAuditEntry("data_access", {
          serviceName: "login.googleapis.com",
          methodName: "google.login.LoginService.logout",
        }),
      ),
    ).toEqual([]);
  });
});

describe("GoogleCloudAuditLogParser - a payload on its own", () => {
  test("an AuditLog payload without its entry is read, its log named by the line's attributes", () => {
    const payload: JSONObject = googleAuditEntry("activity")[
      "protoPayload"
    ] as JSONObject;
    const events: Array<NormalizedSecurityEvent> =
      GoogleCloudAuditLogParser.parse(
        logLine(JSON.stringify(payload), {
          "gcp.log_name":
            "projects/acme-prod/logs/cloudaudit.googleapis.com%2Factivity",
        }),
      );

    expect(events).toHaveLength(1);
    expect(events[0]!.targetHost).toBe("acme-prod");
  });

  test("a read whose log is unknown is kept only when it was refused", () => {
    const read: JSONObject = {
      "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
      serviceName: "storage.googleapis.com",
      methodName: "storage.objects.get",
      authenticationInfo: { principalEmail: "alice@example.com" },
    };

    expect(parse(read)).toEqual([]);
    expect(parse({ ...read, status: { code: 7 } })).toHaveLength(1);
  });

  test("lines that are not audit entries are not read", () => {
    for (const body of [
      "",
      "text",
      "{}",
      '{"protoPayload":{"methodName":"x"}}',
      '{"@type":"type.googleapis.com/google.cloud.audit.AuditLog"}',
      JSON.stringify({
        protoPayload: { "@type": "type.googleapis.com/other" },
      }),
      '{"@type":"type.googleapis.com/google.cloud.audit.AuditLog",',
    ]) {
      expect({ body, events: parse(body) }).toEqual({ body, events: [] });
    }
  });
});

describe("GoogleCloudAuditLogParser - helpers", () => {
  test.each([
    [
      "projects/p/logs/cloudaudit.googleapis.com%2Factivity",
      GoogleCloudAuditLog.Activity,
    ],
    [
      "organizations/1/logs/cloudaudit.googleapis.com%2Fdata_access",
      GoogleCloudAuditLog.DataAccess,
    ],
    [
      "folders/2/logs/cloudaudit.googleapis.com/system_event",
      GoogleCloudAuditLog.SystemEvent,
    ],
    [
      "projects/p/logs/cloudaudit.googleapis.com%2Fpolicy",
      GoogleCloudAuditLog.Policy,
    ],
    [
      "projects/p/logs/cloudaudit.googleapis.com%2Fother",
      GoogleCloudAuditLog.Unknown,
    ],
    ["projects/p/logs/stdout", GoogleCloudAuditLog.Unknown],
    ["", GoogleCloudAuditLog.Unknown],
  ])(
    "readGoogleAuditLog(%p) is %s",
    (logName: string, log: GoogleCloudAuditLog) => {
      expect(readGoogleAuditLog(logName)).toBe(log);
    },
  );

  test("shortMethodName keeps a method's last segment", () => {
    expect(shortMethodName("google.iam.admin.v1.CreateServiceAccountKey")).toBe(
      "CreateServiceAccountKey",
    );
    expect(shortMethodName("SetIamPolicy")).toBe("SetIamPolicy");
  });

  test("the prefilter's words are lowercase", () => {
    for (const word of [
      ...GOOGLE_AUDIT_FILTERED_LOG_MARKERS,
      ...GOOGLE_AUDIT_REFUSAL_MARKERS,
    ]) {
      expect(word).toBe(word.toLowerCase());
    }
  });

  test("the whole log parser reads an audit entry as one Google Cloud event", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(JSON.stringify(googleAuditEntry("activity"))),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.GoogleCloudAudit,
    );
  });
});

describe("GoogleCloudAuditLogParser - long lines", () => {
  test("an entry with an enormous request reads in time that grows with it", () => {
    const line: string = JSON.stringify(
      googleAuditEntry("activity", {
        request: {
          items: Array.from({ length: 20000 }, (_v: unknown, i: number) => {
            return { name: `n${i}` };
          }),
        },
      }),
    ).slice(0, 250000);
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return GoogleCloudAuditLogParser.parse(logLine(line)).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});
