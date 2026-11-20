import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import { KafkaRecord } from "Common/Server/Utils/CloudConnection/Kafka/KafkaProtocol";
import CloudAuditSecurityEvents from "Common/Server/Utils/SecurityEvent/CloudAudit/CloudAuditSecurityEvents";
import SecurityEventDedupe from "Common/Server/Utils/SecurityEvent/SecurityEventDedupe";
import SecurityEventStoreOnce from "Common/Server/Utils/SecurityEvent/SecurityEventStoreOnce";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE } from "Common/Types/SecurityCase/SecurityConnection";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import {
  getAzureActivityRecordUid,
  isAzureSecurityRecordCategory,
} from "Common/Utils/SecurityEvent/LogParsers/AzureActivityLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "Common/Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  entraExport,
  entraFailedSignIn,
} from "Common/Tests/Utils/SecurityEvent/Connectors/EntraIdFixtures";
import { googleAuditEntry } from "Common/Tests/Utils/SecurityEvent/LogParsers/GoogleCloudAuditFixtures";
import { cloudTrailRecord } from "Common/Tests/Utils/SecurityEvent/LogParsers/LogParserFixtures";
import {
  AzureDiagnosticDecoded,
  decodeAzureDiagnosticEvents,
  readAzureSecurityRecordBody,
} from "../../FeatureSet/Telemetry/Utils/AzureEventHubs/AzureDiagnosticRecords";
import {
  CloudWatchLogsMessage,
  buildResourceLogs,
  readCloudWatchLogsMessage,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/CloudWatchLogs";
import {
  CloudLoggingEntry,
  buildCloudLoggingResourceLogs,
  readAuditEntryBody,
  readCloudLoggingEntry,
} from "../../FeatureSet/Telemetry/Utils/GcpPubSub/CloudLoggingEntries";
import {
  anonymousStorageRecord,
  sasStorageRecord,
  sqlDatabaseRecord,
} from "Common/Tests/Utils/SecurityEvent/LogParsers/AzureResourceLogFixtures";
import {
  MINUTE_MS,
  STORAGE_ID,
  SUBSCRIPTION,
  VAULT_ID,
  VM_ID,
  appServiceConsoleRecord,
  eventOf,
  streamContext,
  vaultAuditRecord,
} from "./Helpers/AzureDiagnosticEvents";

/*
 * THE AUDIT RECORDS A CLOUD STREAM DELIVERS, READ AS SECURITY EVENTS -
 * ONCE EACH (#10032).
 *
 * A cloud account's stream - Azure Event Hubs, a Google Cloud log sink's
 * Pub/Sub topic, Amazon Data Firehose - files each record it delivers as a
 * log line of the project's. "Your logs" reads those lines for security
 * records, as it reads a raw pipeline's; but a stream decoded an audit
 * record into a one-line summary, and the security parsers read the record
 * itself. Now an audit-class record keeps the record as its line's body:
 *
 *   - Azure: a diagnostic record of the Activity Log's categories
 *     (Administrative, Security, Policy) or Microsoft Entra ID's - including
 *     the ones about a resource group, a subscription or the tenant, which
 *     the stream dropped before as naming no resource;
 *   - Google Cloud: a LogEntry whose protoPayload is an AuditLog, insertId
 *     and logName included;
 *   - AWS: a CloudTrail record delivered from CloudWatch Logs already is
 *     one, as its line's message.
 *
 * A record that arrives more than one way - the stream, a raw pipeline,
 * Cloud audit logs' read of the account - is the same event: the same id,
 * vendor and product, so SecurityEventStoreOnce stores it once. CloudTrail's
 * eventID and Google's insertId are in every shape; the Activity Log's
 * export has no eventDataId at all, so its records are known by an id made
 * of what both its shapes say (getAzureActivityRecordUid).
 *
 * The lines here are what ingest stores from the decoded OTLP: the body as
 * is, the record's attributes by their keys and the resource's under
 * "resource.".
 */

interface StoredLine {
  body: string;
  attributes: JSONObject;
  logId: string;
}

function attributeValue(value: JSONObject): string | undefined {
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
    if (value[key] !== undefined && value[key] !== null) {
      return String(value[key]);
    }
  }

  return undefined;
}

function flatten(
  list: JSONArray | undefined,
  prefix: string,
  into: JSONObject,
): void {
  for (const attribute of (list || []) as Array<JSONObject>) {
    const value: string | undefined = attributeValue(
      attribute["value"] as JSONObject,
    );

    if (value !== undefined) {
      into[`${prefix}${attribute["key"] as string}`] = value;
    }
  }
}

// The log lines ingest stores from OTLP resourceLogs.
function storedLines(resourceLogs: Array<JSONObject>): Array<StoredLine> {
  const lines: Array<StoredLine> = [];

  for (const resourceLog of resourceLogs) {
    const resource: JSONObject = (resourceLog["resource"] as JSONObject) || {};

    for (const scope of (resourceLog["scopeLogs"] as Array<JSONObject>) || []) {
      for (const record of (scope["logRecords"] as Array<JSONObject>) || []) {
        const attributes: JSONObject = {};

        flatten(resource["attributes"] as JSONArray, "resource.", attributes);
        flatten(record["attributes"] as JSONArray, "", attributes);
        lines.push({
          body: String((record["body"] as JSONObject)["stringValue"] ?? ""),
          attributes,
          logId: ObjectID.generate().toString(),
        });
      }
    }
  }

  return lines;
}

// What "Your logs" makes of the lines - only the ones its prefilter lets out of the database.
function readAsYourLogs(
  lines: Array<StoredLine>,
): Array<NormalizedSecurityEvent> {
  return lines
    .filter((line: StoredLine): boolean => {
      return matchesSecurityLogPrefilter(line.body);
    })
    .flatMap((line: StoredLine): Array<NormalizedSecurityEvent> => {
      return SecurityLogParser.parse({
        body: line.body,
        attributes: line.attributes,
        time: new Date(MINUTE_MS + 120_000),
        logId: line.logId,
      });
    });
}

function identityOf(event: NormalizedSecurityEvent): Array<string> {
  return [event.eventUid, event.vendorName, event.productName];
}

// ---------- Azure: what a subscription's diagnostic setting sends to Event Hubs ----------

const SUBSCRIPTION_UPPER: string = SUBSCRIPTION.toUpperCase();

// The vault's access policy changed, as the Activity Log's export writes it: in capitals.
function vaultPolicyChangeExported(): JSONObject {
  return {
    time: "2026-11-06T09:58:41.4568123Z",
    resourceId: VAULT_ID.toUpperCase(),
    operationName: "MICROSOFT.KEYVAULT/VAULTS/ACCESSPOLICIES/WRITE",
    category: "Administrative",
    resultType: "Success",
    resultSignature: "Succeeded.OK",
    durationMs: "1234",
    callerIpAddress: "203.0.113.24",
    correlationId: "2C5A1D4E-7B3F-4E8A-9C6D-0F1E2D3C4B5A",
    identity: {
      authorization: {
        scope: VAULT_ID,
        action: "Microsoft.KeyVault/vaults/accessPolicies/write",
        evidence: { role: "Owner" },
      },
      claims: {
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn":
          "mallory@acme.com",
      },
    },
    level: "Information",
    location: "global",
    properties: {
      statusCode: "OK",
      serviceRequestId: "9b1c2d3e-0000-4000-8000-000000000001",
      eventCategory: "Administrative",
      entity: VAULT_ID,
      message: "Microsoft.KeyVault/vaults/accessPolicies/write",
    },
  };
}

// The same record, as the Activity Log's REST API returns it to Cloud audit logs.
function vaultPolicyChangeFromApi(): JSONObject {
  return {
    authorization: {
      action: "Microsoft.KeyVault/vaults/accessPolicies/write",
      scope: VAULT_ID,
    },
    caller: "mallory@acme.com",
    category: { value: "Administrative", localizedValue: "Administrative" },
    correlationId: "2c5a1d4e-7b3f-4e8a-9c6d-0f1e2d3c4b5a",
    eventDataId: "e1d2c3b4-0000-4000-8000-00000000abcd",
    eventName: { value: "EndRequest", localizedValue: "End request" },
    eventTimestamp: "2026-11-06T09:58:41.4568123Z",
    httpRequest: { clientIpAddress: "203.0.113.24", method: "PUT" },
    level: "Informational",
    operationName: {
      value: "Microsoft.KeyVault/vaults/accessPolicies/write",
      localizedValue: "Update key vault access policy",
    },
    resourceId: VAULT_ID,
    status: { value: "Succeeded", localizedValue: "Succeeded" },
    subStatus: { value: "OK", localizedValue: "OK" },
    subscriptionId: SUBSCRIPTION,
    properties: { statusCode: "OK" },
  };
}

// A resource group deleted: about the group itself, which names no resource.
function resourceGroupDeleted(): JSONObject {
  return {
    time: "2026-11-06T09:58:55.1000000Z",
    resourceId: `/SUBSCRIPTIONS/${SUBSCRIPTION_UPPER}/RESOURCEGROUPS/RG-LEGACY`,
    operationName: "MICROSOFT.RESOURCES/SUBSCRIPTIONS/RESOURCEGROUPS/DELETE",
    category: "Administrative",
    resultType: "Success",
    resultSignature: "Succeeded.Accepted",
    callerIpAddress: "203.0.113.24",
    correlationId: "5f6e7d8c-0000-4000-8000-000000000002",
    identity: {
      claims: {
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn":
          "mallory@acme.com",
      },
    },
    level: "Information",
    location: "global",
    properties: { statusCode: "Accepted" },
  };
}

// A Defender for Cloud alert on the VM.
function defenderAlertOnVm(): JSONObject {
  return {
    time: "2026-11-06T09:59:02.0000000Z",
    resourceId: VM_ID.toUpperCase(),
    operationName: "Microsoft.Security/locations/alerts/activate/action",
    category: "Security",
    resultType: "Active",
    correlationId: "0a1b2c3d-0000-4000-8000-000000000003",
    level: "Warning",
    location: "global",
    properties: {
      alertName: "Suspicious PowerShell activity detected",
      severity: "High",
      compromisedEntity: VM_ID,
    },
  };
}

// The tenant's own: a sign-in Entra ID refused, sent to the same event hub.
function entraSignInRefused(): JSONObject {
  return entraExport("SignInLogs", entraFailedSignIn());
}

function decodeAzure(records: Array<JSONObject>): AzureDiagnosticDecoded {
  return decodeAzureDiagnosticEvents({
    records: [eventOf(records)].map(
      (value: Buffer, index: number): KafkaRecord => {
        return { offset: index, timestampMs: MINUTE_MS, value };
      },
    ),
    context: streamContext(),
    namespaceRegion: "eastus",
    observedAtMs: MINUTE_MS + 120_000,
  });
}

// ---------- Stored once: the store's lock and its table, stood in for ----------

function installStore(): { table: Array<NormalizedSecurityEvent> } {
  const table: Array<NormalizedSecurityEvent> = [];

  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityEventDedupe, "findExistingEventUids")
    .mockImplementation(
      async (data: {
        vendorName: string;
        productName: string;
        ids: Array<string>;
      }): Promise<Set<string>> => {
        return new Set(
          table
            .filter((stored: NormalizedSecurityEvent): boolean => {
              return (
                stored.vendorName === data.vendorName &&
                stored.productName === data.productName &&
                data.ids.includes(stored.eventUid)
              );
            })
            .map((stored: NormalizedSecurityEvent): string => {
              return stored.eventUid;
            }),
        );
      },
    );

  return { table };
}

// One way's events, stored as that way stores them: the shared records once.
async function store(
  events: Array<NormalizedSecurityEvent>,
  table: Array<NormalizedSecurityEvent>,
): Promise<Array<NormalizedSecurityEvent>> {
  const projectId: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const split: ReturnType<typeof SecurityEventStoreOnce.split> =
    SecurityEventStoreOnce.split(events);
  const stored: Array<NormalizedSecurityEvent> = [...split.rest];

  table.push(...split.rest);

  for (const group of split.shared) {
    stored.push(
      ...(await SecurityEventStoreOnce.storeNew({
        projectId,
        group,
        insert: async (
          fresh: Array<NormalizedSecurityEvent>,
        ): Promise<void> => {
          table.push(...fresh);
        },
      })),
    );
  }

  return stored;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Azure Event Hubs: the Activity Log and Entra ID's records a diagnostic setting streams", () => {
  test("the categories Security Events reads are the Activity Log's and Entra ID's", () => {
    for (const category of [
      "Administrative",
      "Security",
      "Policy",
      "SignInLogs",
      "AuditLogs",
      "NonInteractiveUserSignInLogs",
      "ServicePrincipalSignInLogs",
      "UserRiskEvents",
      "RiskyUsers",
    ]) {
      expect(isAzureSecurityRecordCategory(category)).toBe(true);
    }

    for (const category of [
      "AuditEvent",
      "StorageRead",
      "AppServiceConsoleLogs",
      "kube-apiserver",
      "ServiceHealth",
      "",
    ]) {
      expect(isAzureSecurityRecordCategory(category)).toBe(false);
    }
  });

  test("each such record keeps itself as its line's body; any other stays a one-line log", () => {
    const decoded: AzureDiagnosticDecoded = decodeAzure([
      vaultPolicyChangeExported(),
      vaultAuditRecord(),
      appServiceConsoleRecord(),
    ]);
    const lines: Array<StoredLine> = storedLines(
      decoded.resourceLogs.map((delivered: { resource: JSONObject }) => {
        return delivered.resource;
      }),
    );

    expect(lines).toHaveLength(3);

    const policy: StoredLine = lines.find((line: StoredLine): boolean => {
      return line.attributes["azure.category"] === "Administrative";
    })!;
    const audit: StoredLine = lines.find((line: StoredLine): boolean => {
      return line.attributes["azure.category"] === "AuditEvent";
    })!;
    const console: StoredLine = lines.find((line: StoredLine): boolean => {
      return line.attributes["azure.category"] === "AppServiceConsoleLogs";
    })!;

    expect(JSON.parse(policy.body)).toEqual(vaultPolicyChangeExported());
    // Its words stay where the Logs page filters on them.
    expect(policy.attributes).toMatchObject({
      "azure.operation.name": "MICROSOFT.KEYVAULT/VAULTS/ACCESSPOLICIES/WRITE",
      "azure.result.type": "Success",
      "resource.cloud.resource_id": VAULT_ID,
      "resource.cloud.account.id": SUBSCRIPTION,
    });
    // A key vault's own audit log is read too now (#10110): kept whole.
    expect(JSON.parse(audit.body)).toEqual(vaultAuditRecord());
    // An app's console line is no audit record: a one-line log, as before.
    expect(console.body).toContain("connect ECONNREFUSED 10.0.0.5:5432");
  });

  test("a record about a resource group, a subscription or the tenant is kept, not dropped as naming no resource", () => {
    const decoded: AzureDiagnosticDecoded = decodeAzure([
      resourceGroupDeleted(),
      entraSignInRefused(),
      // Neither a security record nor a resource's: still left out.
      {
        time: "2026-11-06T09:59:00Z",
        resourceId: `/SUBSCRIPTIONS/${SUBSCRIPTION_UPPER}`,
        category: "ServiceHealth",
        operationName: "Microsoft.ServiceHealth/incident/action",
      },
    ]);
    const lines: Array<StoredLine> = storedLines(
      decoded.resourceLogs.map((delivered: { resource: JSONObject }) => {
        return delivered.resource;
      }),
    );

    expect(decoded.logRecords).toBe(2);
    expect(decoded.unrecognized).toBe(1);

    const group: StoredLine = lines.find((line: StoredLine): boolean => {
      return String(line.attributes["resource.azure.resource.id"]).includes(
        "RESOURCEGROUPS/RG-LEGACY",
      );
    })!;
    const tenant: StoredLine = lines.find((line: StoredLine): boolean => {
      return line.attributes["azure.category"] === "SignInLogs";
    })!;

    expect(group.attributes["resource.cloud.account.id"]).toBe(SUBSCRIPTION);
    // No Cloud Resource is a resource group: no resource is stamped.
    expect(group.attributes["resource.cloud.resource_id"]).toBeUndefined();
    // The tenant's own record is in no subscription.
    expect(tenant.attributes["resource.cloud.account.id"]).toBeUndefined();
    expect(JSON.parse(tenant.body)).toEqual(entraSignInRefused());
    // A sighting is a subscription's: the group's is, the tenant's is not.
    expect(
      decoded.sightings.map((sighting: { accountId: string }) => {
        return sighting.accountId;
      }),
    ).toEqual([SUBSCRIPTION]);
  });

  test("Your logs reads each streamed record as a security event, as it reads a raw pipeline's", () => {
    const records: Array<JSONObject> = [
      vaultPolicyChangeExported(),
      resourceGroupDeleted(),
      defenderAlertOnVm(),
      entraSignInRefused(),
      vaultAuditRecord(),
    ];
    const streamed: Array<NormalizedSecurityEvent> = readAsYourLogs(
      storedLines(
        decodeAzure(records).resourceLogs.map(
          (delivered: { resource: JSONObject }) => {
            return delivered.resource;
          },
        ),
      ),
    );
    // A raw pipeline: the collector's azureeventhub receiver with format: raw, the event whole.
    const piped: Array<NormalizedSecurityEvent> = readAsYourLogs([
      {
        body: JSON.stringify({ records }),
        attributes: {},
        logId: ObjectID.generate().toString(),
      },
    ]);

    // The access policy change, the group deleted, Defender's alert, the refused sign-in - and the vault's own secret read (#10110).
    expect(streamed).toHaveLength(5);
    expect(
      streamed
        .map((event: NormalizedSecurityEvent): Array<string> => {
          return identityOf(event);
        })
        .sort(),
    ).toEqual(
      piped
        .map((event: NormalizedSecurityEvent): Array<string> => {
          return identityOf(event);
        })
        .sort(),
    );

    for (const event of streamed) {
      expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
        event.productName === "Azure Key Vault"
          ? SecurityLogFormat.AzureResourceLogs
          : SecurityLogFormat.AzureActivity,
      );
      // Each has an id of its own, never one made up from its line.
      expect(event.eventUid.startsWith("log:")).toBe(false);
    }
  });

  test("the vault's event names the vault, and was read from the vault's own logs (#10033)", () => {
    const [event] = readAsYourLogs(
      storedLines(
        decodeAzure([vaultPolicyChangeExported()]).resourceLogs.map(
          (delivered: { resource: JSONObject }) => {
            return delivered.resource;
          },
        ),
      ),
    );

    expect(event!.observables).toContain(VAULT_ID.toLowerCase());
    expect(event!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]).toBe(
      VAULT_ID.toLowerCase(),
    );
    expect(event!.principalUser).toBe("mallory@acme.com");
  });

  test("the export's record and the REST API's are one record: one id, whatever their spelling", () => {
    const exported: JSONObject = vaultPolicyChangeExported();
    const fromApi: JSONObject = vaultPolicyChangeFromApi();

    expect(getAzureActivityRecordUid(exported)).not.toBe("");
    expect(getAzureActivityRecordUid(exported)).toBe(
      getAzureActivityRecordUid(fromApi),
    );

    const [fromAccount] = CloudAuditSecurityEvents.parseRecords({
      provider: CloudProvider.Azure,
      records: [{ accountId: SUBSCRIPTION, record: fromApi }],
      now: new Date(MINUTE_MS + 300_000),
    });
    const [streamed] = readAsYourLogs(
      storedLines(
        decodeAzure([exported]).resourceLogs.map(
          (delivered: { resource: JSONObject }) => {
            return delivered.resource;
          },
        ),
      ),
    );

    expect(identityOf(streamed!)).toEqual(identityOf(fromAccount!));
    // The REST API's record is also looked up by the eventDataId it was stored by before.
    expect(fromAccount!.eventUidAliases).toEqual([
      "azure-activity:e1d2c3b4-0000-4000-8000-00000000abcd",
    ]);
  });

  test.each([
    ["another operation", { operationName: "MICROSOFT.KEYVAULT/VAULTS/WRITE" }],
    ["another outcome", { resultType: "Failure" }],
    ["another moment", { time: "2026-11-06T09:58:41.4578123Z" }],
    [
      "another correlation",
      { correlationId: "2c5a1d4e-7b3f-4e8a-9c6d-0f1e2d3c4b5b" },
    ],
    ["another resource", { resourceId: VM_ID.toUpperCase() }],
  ])(
    "a record that differs by %s is another record",
    (_case: string, change: JSONObject) => {
      expect(
        getAzureActivityRecordUid({
          ...vaultPolicyChangeExported(),
          ...change,
        }),
      ).not.toBe(getAzureActivityRecordUid(vaultPolicyChangeExported()));
    },
  );

  test("a record that says too little to tell it from another has no id of its own: its line is its id", () => {
    const bare: JSONObject = vaultPolicyChangeExported();

    delete bare["correlationId"];

    expect(getAzureActivityRecordUid(bare)).toBe("");

    const [event] = readAsYourLogs([
      {
        body: readAzureSecurityRecordBody(bare),
        attributes: {},
        logId: "0193c0de-0000-7000-8000-000000000001",
      },
    ]);

    expect(event!.eventUid).toBe("log:0193c0de-0000-7000-8000-000000000001:0");
  });

  test("a record that arrives three ways - the stream, a raw pipeline, Cloud audit logs - is stored once", async () => {
    const { table } = installStore();
    const exported: JSONObject = vaultPolicyChangeExported();
    const now: Date = new Date(MINUTE_MS + 300_000);
    const streamed: Array<NormalizedSecurityEvent> = readAsYourLogs(
      storedLines(
        decodeAzure([exported]).resourceLogs.map(
          (delivered: { resource: JSONObject }) => {
            return delivered.resource;
          },
        ),
      ),
    );
    const piped: Array<NormalizedSecurityEvent> = readAsYourLogs([
      {
        body: JSON.stringify({ records: [exported] }),
        attributes: {},
        logId: ObjectID.generate().toString(),
      },
    ]);
    const fromAccount: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.Azure,
        records: [
          { accountId: SUBSCRIPTION, record: vaultPolicyChangeFromApi() },
        ],
        now,
      });

    expect(await store(streamed, table)).toHaveLength(1);
    expect(await store(piped, table)).toHaveLength(0);
    expect(await store(fromAccount, table)).toHaveLength(0);
    // The stream delivers it again (Event Hubs delivers at least once): still once.
    expect(await store(streamed, table)).toHaveLength(0);
    expect(table).toHaveLength(1);
  });

  test("a record Cloud audit logs stored by its eventDataId before is not stored again when read again", async () => {
    const { table } = installStore();
    const [fromAccount] = CloudAuditSecurityEvents.parseRecords({
      provider: CloudProvider.Azure,
      records: [
        { accountId: SUBSCRIPTION, record: vaultPolicyChangeFromApi() },
      ],
      now: new Date(MINUTE_MS + 300_000),
    });

    // What an older OneUptime stored: the same record, by its eventDataId.
    table.push({
      ...fromAccount!,
      eventUid: "azure-activity:e1d2c3b4-0000-4000-8000-00000000abcd",
    });

    expect(await store([fromAccount!], table)).toHaveLength(0);
    expect(table).toHaveLength(1);
  });

  test("a record too long to read whole keeps its one-line body", () => {
    const huge: JSONObject = {
      ...vaultPolicyChangeExported(),
      properties: { responseBody: "x".repeat(300 * 1024) },
    };

    expect(readAzureSecurityRecordBody(huge)).toBe(
      "MICROSOFT.KEYVAULT/VAULTS/ACCESSPOLICIES/WRITE: Success (Succeeded.OK)",
    );
  });
});

// ---------- Google Cloud: what a log sink publishes to Pub/Sub ----------

function pushOf(entry: JSONObject): CloudLoggingEntry {
  return readCloudLoggingEntry(JSON.parse(JSON.stringify(entry)))!;
}

function linesOfPush(entry: JSONObject): Array<StoredLine> {
  return storedLines([
    buildCloudLoggingResourceLogs({
      entry: pushOf(entry),
      serviceName: "Production GCP",
      connectionId: "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f",
      observedAtMs: MINUTE_MS,
    }).resourceLogs,
  ]);
}

// A bucket made public: an Admin Activity entry, as the sink publishes it.
function bucketMadePublic(): JSONObject {
  return googleAuditEntry(
    "activity",
    {
      serviceName: "storage.googleapis.com",
      methodName: "storage.setIamPermissions",
      resourceName: "projects/_/buckets/acme-invoices",
      authorizationInfo: [
        {
          resource: "projects/_/buckets/acme-invoices",
          permission: "storage.buckets.setIamPolicy",
          granted: true,
        },
      ],
      serviceData: {
        "@type": "type.googleapis.com/google.iam.v1.logging.AuditData",
        policyDelta: {
          bindingDeltas: [
            {
              action: "ADD",
              role: "roles/storage.objectViewer",
              member: "allUsers",
            },
          ],
        },
      },
    },
    {
      insertId: "-5kfxwfe1a2b3",
      resource: {
        type: "gcs_bucket",
        labels: {
          project_id: "acme-prod",
          bucket_name: "acme-invoices",
          location: "us-central1",
        },
      },
    },
  );
}

/*
 * A RESOURCE'S OWN AUDIT LOG THROUGH THE STREAM (#10110): a key vault's
 * AuditEvent, a storage account's blob service's requests and an Azure SQL
 * database's audit, as the stream's diagnostic settings send them to the
 * event hubs. Each keeps itself as its line's body - a storage service's
 * filed under its account - so "Your logs" reads it as it reads a raw
 * pipeline's, it reaches its resource's page, and arriving twice it is
 * stored once.
 */
describe("Azure Event Hubs: a resource's own audit log, read as security events (#10110)", () => {
  const BLOB_SERVICE_ID: string = `${STORAGE_ID}/blobServices/default`;

  function anonymousRead(): JSONObject {
    return anonymousStorageRecord({
      resourceId: BLOB_SERVICE_ID.toUpperCase(),
    });
  }

  function streamedLines(records: Array<JSONObject>): Array<StoredLine> {
    return storedLines(
      decodeAzure(records).resourceLogs.map(
        (delivered: { resource: JSONObject }) => {
          return delivered.resource;
        },
      ),
    );
  }

  test("a vault's, a storage service's and Azure SQL's records keep themselves whole; a storage service's is filed under its account", () => {
    const records: Array<JSONObject> = [
      vaultAuditRecord(),
      anonymousRead(),
      sqlDatabaseRecord(),
    ];
    const lines: Array<StoredLine> = streamedLines(records);

    expect(lines).toHaveLength(3);
    expect(
      lines.map((line: StoredLine): JSONObject => {
        return JSON.parse(line.body) as JSONObject;
      }),
    ).toEqual(expect.arrayContaining(records));

    const storage: StoredLine = lines.find((line: StoredLine): boolean => {
      return line.attributes["azure.category"] === "StorageRead";
    })!;

    // Its account's Logs tab, and the account's own region.
    expect(storage.attributes).toMatchObject({
      "resource.cloud.resource_id": STORAGE_ID,
      "resource.azure.resource.id": BLOB_SERVICE_ID.toUpperCase(),
      "resource.cloud.region": "eastus",
      "resource.cloud.account.id": SUBSCRIPTION,
    });
  });

  test("Your logs reads each as it reads a raw pipeline's: the same events, with ids of their own", () => {
    const records: Array<JSONObject> = [
      vaultAuditRecord(),
      anonymousRead(),
      sqlDatabaseRecord(),
    ];
    const streamed: Array<NormalizedSecurityEvent> = readAsYourLogs(
      streamedLines(records),
    );
    const piped: Array<NormalizedSecurityEvent> = readAsYourLogs([
      {
        body: JSON.stringify({ records }),
        attributes: {},
        logId: ObjectID.generate().toString(),
      },
    ]);

    expect(
      streamed
        .map((event: NormalizedSecurityEvent): string => {
          return event.productName;
        })
        .sort(),
    ).toEqual(["Azure Key Vault", "Azure SQL", "Azure Storage"]);
    expect(
      streamed
        .map((event: NormalizedSecurityEvent): Array<string> => {
          return identityOf(event);
        })
        .sort(),
    ).toEqual(
      piped
        .map((event: NormalizedSecurityEvent): Array<string> => {
          return identityOf(event);
        })
        .sort(),
    );

    for (const event of streamed) {
      expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
        SecurityLogFormat.AzureResourceLogs,
      );
      expect(event.eventUid.startsWith("log:")).toBe(false);
    }
  });

  test("the vault's secret read is on the vault's page: by its ID, and by the vault its line was filed under", () => {
    const [event] = readAsYourLogs(streamedLines([vaultAuditRecord()]));

    expect(event!.activityName).toBe("SecretGet");
    expect(event!.principalUser).toBe("alice@acme.com");
    expect(event!.observables).toContain(VAULT_ID.toLowerCase());
    expect(event!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]).toBe(
      VAULT_ID.toLowerCase(),
    );
  });

  test("the blob service's anonymous read is on the storage account's page, the same two ways", () => {
    const [event] = readAsYourLogs(streamedLines([anonymousRead()]));

    expect(event!.observables).toEqual(
      expect.arrayContaining([
        BLOB_SERVICE_ID.toLowerCase(),
        STORAGE_ID.toLowerCase(),
      ]),
    );
    expect(event!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]).toBe(
      STORAGE_ID.toLowerCase(),
    );
  });

  test("streamed, redelivered by the event hub and piped, each record is stored once", async () => {
    const { table } = installStore();
    const records: Array<JSONObject> = [
      vaultAuditRecord(),
      anonymousRead(),
      sqlDatabaseRecord(),
    ];

    expect(
      await store(readAsYourLogs(streamedLines(records)), table),
    ).toHaveLength(3);
    // An event hub delivers at least once: the same records, as new lines.
    expect(
      await store(readAsYourLogs(streamedLines(records)), table),
    ).toHaveLength(0);
    expect(
      await store(
        readAsYourLogs([
          {
            body: JSON.stringify({ records }),
            attributes: {},
            logId: ObjectID.generate().toString(),
          },
        ]),
        table,
      ),
    ).toHaveLength(0);
    expect(table).toHaveLength(3);
  });

  test("a storage account's SAS read stays in Logs whole, under the account, and is no security event", () => {
    const lines: Array<StoredLine> = streamedLines([
      sasStorageRecord({
        resourceId: BLOB_SERVICE_ID.toUpperCase(),
        category: "StorageRead",
        operationName: "GetBlob",
        statusCode: 200,
      }),
    ]);

    expect(lines).toHaveLength(1);
    expect(
      ((JSON.parse(lines[0]!.body) as JSONObject)["identity"] as JSONObject)[
        "type"
      ],
    ).toBe("SAS");
    expect(lines[0]!.attributes["resource.cloud.resource_id"]).toBe(STORAGE_ID);
    expect(matchesSecurityLogPrefilter(lines[0]!.body)).toBe(false);
    expect(readAsYourLogs(lines)).toEqual([]);
  });
});

describe("Google Cloud Pub/Sub: the audit logs a log sink streams", () => {
  test("an audit log's entry keeps itself as its line's body, its words as attributes", () => {
    const [line] = linesOfPush(bucketMadePublic());

    expect(JSON.parse(line!.body)).toEqual(bucketMadePublic());
    expect(line!.attributes).toMatchObject({
      "gcp.audit.method_name": "storage.setIamPermissions",
      "gcp.audit.resource_name": "projects/_/buckets/acme-invoices",
      "enduser.id": "alice@example.com",
      "gcp.log.insert_id": "-5kfxwfe1a2b3",
    });
  });

  test("Your logs reads it as the same event Cloud audit logs and a raw pipeline make of it", () => {
    const [streamed] = readAsYourLogs(linesOfPush(bucketMadePublic()));
    const [piped] = readAsYourLogs([
      {
        body: JSON.stringify(bucketMadePublic()),
        attributes: {},
        logId: ObjectID.generate().toString(),
      },
    ]);
    const [fromAccount] = CloudAuditSecurityEvents.parseRecords({
      provider: CloudProvider.GCP,
      records: [{ accountId: "acme-prod", record: bucketMadePublic() }],
      now: new Date(MINUTE_MS),
    });

    expect(streamed!.eventUid).toBe("gcp-audit:-5kfxwfe1a2b3");
    expect(identityOf(streamed!)).toEqual(identityOf(piped!));
    expect(identityOf(streamed!)).toEqual(identityOf(fromAccount!));
    // The bucket, by its full resource name: its page finds it.
    expect(streamed!.observables).toContain(
      "//storage.googleapis.com/projects/_/buckets/acme-invoices",
    );
  });

  test("Data Access stays out unless Google refused the call, as from a pipeline", () => {
    const read: JSONObject = googleAuditEntry(
      "data_access",
      {
        methodName: "storage.objects.get",
        serviceName: "storage.googleapis.com",
      },
      { insertId: "da-1" },
    );
    const refused: JSONObject = googleAuditEntry(
      "data_access",
      {
        methodName: "storage.objects.get",
        serviceName: "storage.googleapis.com",
        status: { code: 7, message: "PERMISSION_DENIED" },
      },
      { insertId: "da-2" },
    );

    expect(readAsYourLogs(linesOfPush(read))).toEqual([]);
    expect(
      readAsYourLogs(linesOfPush(refused)).map(
        (event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        },
      ),
    ).toEqual(["gcp-audit:da-2"]);
  });

  test("an entry that is no audit log is read as it always was", () => {
    const entry: JSONObject = {
      insertId: "txt-1",
      logName: "projects/acme-prod/logs/syslog",
      resource: { type: "gce_instance", labels: { project_id: "acme-prod" } },
      timestamp: "2026-11-06T09:59:00Z",
      textPayload: "kernel: eth0 link up",
    };

    expect(pushOf(entry).auditEntry).toBeNull();
    expect(linesOfPush(entry)[0]!.body).toBe("kernel: eth0 link up");
    // A payload that only looks like one is no audit log either.
    expect(
      pushOf({
        ...entry,
        textPayload: undefined,
        protoPayload: { methodName: "x.y" },
      }).auditEntry,
    ).toBeNull();
  });

  test("an audit entry too long to read whole keeps its one line", () => {
    const huge: JSONObject = googleAuditEntry("activity", {
      request: { blob: "x".repeat(300 * 1024) },
    });

    expect(readAuditEntryBody(pushOf(huge))).toBe("");
    expect(linesOfPush(huge)[0]!.body).toBe(
      "google.iam.admin.v1.CreateServiceAccountKey projects/-/serviceAccounts/app@acme-prod.iam.gserviceaccount.com",
    );
  });

  test("an entry arriving by the stream and by Cloud audit logs is stored once, by its insertId", async () => {
    const { table } = installStore();
    const streamed: Array<NormalizedSecurityEvent> = readAsYourLogs(
      linesOfPush(bucketMadePublic()),
    );
    const fromAccount: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.GCP,
        records: [{ accountId: "acme-prod", record: bucketMadePublic() }],
        now: new Date(MINUTE_MS),
      });

    expect(await store(fromAccount, table)).toHaveLength(1);
    expect(await store(streamed, table)).toHaveLength(0);
    // Pub/Sub pushes again when it is unsure an earlier push was taken.
    expect(await store(streamed, table)).toHaveLength(0);
    expect(table).toHaveLength(1);
  });
});

// ---------- AWS: CloudTrail delivered by a CloudWatch Logs subscription to Firehose ----------

describe("Amazon Data Firehose: CloudTrail from CloudWatch Logs", () => {
  test("its line is the record already, read as the same event Cloud audit logs makes of it, stored once", async () => {
    const { table } = installStore();
    const record: JSONObject = cloudTrailRecord({});
    const message: CloudWatchLogsMessage = readCloudWatchLogsMessage({
      messageType: "DATA_MESSAGE",
      owner: "111122223333",
      logGroup: "aws-cloudtrail-logs-111122223333-org",
      logStream: "111122223333_CloudTrail_us-east-1",
      subscriptionFilters: ["oneuptime"],
      logEvents: [
        {
          id: "38051740212378091234567890",
          timestamp: Date.parse("2026-10-19T09:58:05Z"),
          message: JSON.stringify(record),
        },
      ],
    })!;
    const streamed: Array<NormalizedSecurityEvent> = readAsYourLogs(
      storedLines(
        buildResourceLogs({
          messages: [message],
          region: "us-east-1",
          serviceName: "Production AWS",
          connectionId: "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f",
          observedAtMs: MINUTE_MS,
        }).resourceLogs,
      ),
    );
    const fromAccount: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.AWS,
        records: [{ accountId: "111122223333", record }],
        now: new Date(MINUTE_MS),
      });

    expect(streamed).toHaveLength(1);
    expect(identityOf(streamed[0]!)).toEqual(identityOf(fromAccount[0]!));
    expect(await store(streamed, table)).toHaveLength(1);
    expect(await store(fromAccount, table)).toHaveLength(0);
  });
});
