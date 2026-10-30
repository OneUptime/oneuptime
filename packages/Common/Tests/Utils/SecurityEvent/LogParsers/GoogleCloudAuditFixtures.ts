import { JSONObject } from "../../../../Types/JSON";

/*
 * Google Cloud audit log entries as a log sink exports them: a LogEntry
 * with an AuditLog payload, in one of the four audit logs
 * (cloud.google.com/logging/docs/reference/audit/auditlog/rest). Made-up
 * project and people. Not a test file itself.
 */

export type LogKind = "activity" | "data_access" | "system_event" | "policy";

export function googleAuditEntry(
  kind: LogKind,
  payload: JSONObject = {},
  entry: JSONObject = {},
): JSONObject {
  return {
    insertId: "1a2b3c4d5e",
    logName: `projects/acme-prod/logs/cloudaudit.googleapis.com%2F${kind}`,
    resource: {
      type: "service_account",
      labels: { project_id: "acme-prod", email_id: "app@acme-prod.iam.gserviceaccount.com" },
    },
    timestamp: "2026-10-30T09:58:12.345Z",
    receiveTimestamp: "2026-10-30T09:58:13.001Z",
    severity: "NOTICE",
    protoPayload: {
      "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
      status: {},
      authenticationInfo: { principalEmail: "alice@example.com" },
      requestMetadata: {
        callerIp: "203.0.113.7",
        callerSuppliedUserAgent: "google-cloud-sdk",
      },
      serviceName: "iam.googleapis.com",
      methodName: "google.iam.admin.v1.CreateServiceAccountKey",
      authorizationInfo: [
        {
          resource: "projects/-/serviceAccounts/app@acme-prod.iam.gserviceaccount.com",
          permission: "iam.serviceAccountKeys.create",
          granted: true,
        },
      ],
      resourceName: "projects/-/serviceAccounts/app@acme-prod.iam.gserviceaccount.com",
      ...payload,
    },
    ...entry,
  };
}
