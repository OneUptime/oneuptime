import { buildSecurityEventDbRow } from "../../../Server/Utils/SecurityEvent/SecurityEventRow";
import { TelemetryServiceMetadata } from "../../../Server/Services/OpenTelemetryIngestService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
  SECURITY_LOG_DOCKER_HOST_ATTRIBUTE,
  SECURITY_LOG_FUNCTION_ATTRIBUTE,
  SecurityConnectionCertainty,
  SecurityConnectionReason,
} from "../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  SecurityConnectionLookups,
  foldResourceIdObservables,
  getAzureResourceIdKey,
  getConnectionValueKey,
  getLogAttributeSearchValues,
  getObservableSearchValues,
  getRecordSecurityValues,
  getResourceIdMatchKey,
  getSecurityConnectionLookups,
  isCaseInsensitiveResourceId,
  matchResourceId,
} from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import MicrosoftDefenderXdrNormalizer from "../../../Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import { buildObservables } from "../../../Utils/SecurityEvent/NormalizerHelpers";
import SecurityEventNormalizer from "../../../Utils/SecurityEvent/SecurityEventNormalizer";
import { readAzureActivityResourceIds } from "../../../Utils/SecurityEvent/LogParsers/CloudAuditResources";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { readLogCloudResource } from "../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import { describe, expect, test } from "@jest/globals";

/*
 * AN AZURE RESOURCE ID FROM ANY SOURCE, WHATEVER ITS CASE (#10034).
 *
 * Azure compares its resource IDs without case ("Resource and resource
 * group names are case-insensitive ... Always perform a case-insensitive
 * comparison of names"), and each writer spells one its own way: the
 * Activity Log's export in capitals, Resource Manager and the portal in
 * mixed case, Microsoft Defender XDR's evidence as it received it, a
 * pipeline as its sender typed it. A cloud resource's Security card and
 * Security Events page search the events' observables (a bloom-indexed
 * array, matched exactly) for the resource's own ID - so every event now
 * keeps an Azure ID by one key, in lower case, and the record searches for
 * that key first.
 *
 * An AWS ARN and a Google Cloud full resource name stay exact: IAM compares
 * an ARN's resource as written, and two resources may differ by case alone
 * (a DynamoDB table "Orders" beside "orders", a BigQuery dataset
 * "mydataset" beside "MyDataset").
 *
 * The events here are realistic payloads from several sources; the search
 * is ClickHouse's own semantics - hasAny(observables, spellings) holds when
 * one of the stored observables IS one of the spellings, byte for byte.
 */

// The key vault as Resource Manager and its Cloud Resource row write it.
const VAULT_ID: string =
  "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments";
const VAULT_KEY: string = VAULT_ID.toLowerCase();
// The same vault as the Activity Log's export writes it.
const VAULT_ID_EXPORTED: string = VAULT_ID.toUpperCase();
// And as an analyst, a script or another product might: neither the row's nor the export's case.
const VAULT_ID_MIXED: string =
  "/Subscriptions/6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B/ResourceGroups/RG-PAYMENTS-PROD/Providers/microsoft.keyvault/Vaults/KV-PAYMENTS";

const STORAGE_ID: string =
  "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.Storage/storageAccounts/acmeinvoices";

const ORDERS_TABLE: string =
  "arn:aws:dynamodb:us-east-1:111122223333:table/Orders";
const ORDERS_TABLE_LOWER: string =
  "arn:aws:dynamodb:us-east-1:111122223333:table/orders";

const DATASET: string =
  "//bigquery.googleapis.com/projects/acme-prod/datasets/MyDataset";
const DATASET_LOWER: string =
  "//bigquery.googleapis.com/projects/acme-prod/datasets/mydataset";

const SERVICE: TelemetryServiceMetadata = {
  primaryEntityId: new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001"),
  primaryEntityType: ServiceType.OpenTelemetry,
  serviceRetentionInDays: 30,
  projectRetentionInDays: 30,
} as unknown as TelemetryServiceMetadata;

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-2222-4aaa-8bbb-000000000002",
);

// The row an event is stored as: what ClickHouse holds and searches.
function rowOf(event: NormalizedSecurityEvent): JSONObject {
  return buildSecurityEventDbRow({
    normalized: event,
    projectId: PROJECT_ID,
    serviceMetadata: SERVICE,
    retentionDays: 30,
  });
}

/*
 * ClickHouse's hasAny(observables, [...]) OR (has(attributeKeys, k) AND
 * attributes[k] IN (...)): exact membership, as the bloom index can serve.
 */
function isFoundBy(
  row: JSONObject,
  scope: {
    observables: Array<string>;
    attribute?: { key: string; values: Array<string> };
  },
): boolean {
  const observables: Array<string> =
    (row["observables"] as Array<string>) || [];
  const attributes: JSONObject = (row["attributes"] as JSONObject) || {};

  if (
    observables.some((observable: string): boolean => {
      return scope.observables.includes(observable);
    })
  ) {
    return true;
  }

  if (!scope.attribute) {
    return false;
  }

  const value: unknown = attributes[scope.attribute.key];

  return typeof value === "string" && scope.attribute.values.includes(value);
}

// What a cloud resource's card and page search for, from its own row (ResourceSecurity).
function scopeOfResource(providerResourceId: string): {
  observables: Array<string>;
  attribute: { key: string; values: Array<string> };
} {
  return {
    observables: getObservableSearchValues(
      getRecordSecurityValues({ names: [providerResourceId] }),
    ),
    attribute: {
      key: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
      values: getLogAttributeSearchValues({
        key: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
        value: providerResourceId,
      }),
    },
  };
}

// ---------- The events: realistic payloads from several sources ----------

// Microsoft Defender XDR, through its connection: an alert whose evidence names the vault as it received it.
function defenderAlert(resourceId: string): NormalizedSecurityEvent {
  return MicrosoftDefenderXdrNormalizer.normalize({
    "@odata.type": "#microsoft.graph.security.alert",
    id: "da637900000000000000_-1234567890",
    providerAlertId: "2518393400000000000_7a9b8c7d",
    title: "Suspicious secret access from an unusual location",
    severity: "high",
    status: "new",
    category: "CredentialAccess",
    serviceSource: "microsoftDefenderForCloud",
    detectionSource: "microsoftDefenderForCloud",
    createdDateTime: "2026-11-18T09:12:44.000Z",
    firstActivityDateTime: "2026-11-18T09:10:02.000Z",
    mitreTechniques: ["T1552"],
    evidence: [
      {
        "@odata.type": "#microsoft.graph.security.azureResourceEvidence",
        createdDateTime: "2026-11-18T09:12:44.000Z",
        verdict: "suspicious",
        remediationStatus: "none",
        roles: [],
        resourceId: resourceId,
        resourceName: "kv-Payments",
        resourceType: "Microsoft.KeyVault/vaults",
      },
      {
        "@odata.type": "#microsoft.graph.security.ipEvidence",
        createdDateTime: "2026-11-18T09:12:44.000Z",
        verdict: "suspicious",
        roles: ["attacker"],
        ipAddress: "198.51.100.23",
      },
    ],
  });
}

// The Activity Log, as a diagnostic setting exports it to an Event Hub: the ID in capitals.
function exportedActivityLine(
  resourceId: string,
): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse({
    body: JSON.stringify({
      records: [
        {
          time: "2026-11-18T09:20:31.3810679Z",
          resourceId,
          operationName: "MICROSOFT.KEYVAULT/VAULTS/ACCESSPOLICIES/WRITE",
          category: "Administrative",
          resultType: "Success",
          resultSignature: "Succeeded.OK",
          durationMs: "421",
          callerIpAddress: "203.0.113.40",
          correlationId: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
          identity: {
            claims: {
              "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn":
                "kmorgan@acme.example",
            },
          },
          level: "Information",
          location: "global",
          properties: {
            statusCode: "OK",
            eventCategory: "Administrative",
            entity: VAULT_ID,
            message: "Microsoft.KeyVault/vaults/accessPolicies/write",
          },
        },
      ],
    }),
    attributes: {},
    time: new Date("2026-11-18T09:21:00.000Z"),
    logId: "0193c0de-3333-4aaa-8bbb-000000000003",
  });
}

// A pipeline's OCSF record, its sender's own spelling among its observables.
function ocsfPipelineRecord(resourceId: string): NormalizedSecurityEvent {
  return SecurityEventNormalizer.normalize({
    class_uid: 6003,
    class_name: "API Activity",
    category_uid: 6,
    activity_id: 3,
    activity_name: "Update",
    severity_id: 3,
    status: "Success",
    time: 1763457600000,
    message: "Purge protection turned off on a key vault",
    metadata: {
      uid: "ocsf-7f1e2d3c-0001",
      product: { name: "Acme SIEM Forwarder", vendor_name: "Acme" },
    },
    actor: { user: { name: "svc-terraform@acme.example" } },
    src_endpoint: { ip: "203.0.113.41" },
    api: { operation: "Microsoft.KeyVault/vaults/write" },
    resources: [{ uid: resourceId, type: "Microsoft.KeyVault/vaults" }],
    observables: [
      { name: "resources.uid", type: "Resource UID", value: resourceId },
      { name: "src_endpoint.ip", type: "IP Address", value: "203.0.113.41" },
    ],
  })!;
}

// A line its account's stream filed under the resource, stamped with its ID in any case a collector chose.
function streamedLine(stampedId: string): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse({
    body: "Oct 19 10:00:01 web-03 sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2",
    attributes: { "resource.cloud.resource_id": stampedId },
    time: new Date("2026-11-18T09:30:00.000Z"),
    logId: "0193c0de-4444-4aaa-8bbb-000000000004",
  });
}

describe("which clouds compare their resource IDs without case", () => {
  test.each([
    [VAULT_ID, true],
    [VAULT_ID_EXPORTED, true],
    [VAULT_ID_MIXED, true],
    [`  ${VAULT_ID}  `, true],
    [ORDERS_TABLE, false],
    [DATASET, false],
    ["kv-Payments", false],
    ["/subscriptions/", false],
    ["/subscriptions/6f1c2a3b /resourceGroups/rg", false],
    ["", false],
  ])("%p: %p", (value: string, expected: boolean) => {
    expect(isCaseInsensitiveResourceId(value)).toBe(expected);
  });

  test("an Azure ID's key is its lower case, trimmed, without a trailing slash", () => {
    expect(getAzureResourceIdKey(VAULT_ID)).toBe(VAULT_KEY);
    expect(getAzureResourceIdKey(VAULT_ID_EXPORTED)).toBe(VAULT_KEY);
    expect(getAzureResourceIdKey(VAULT_ID_MIXED)).toBe(VAULT_KEY);
    expect(getAzureResourceIdKey(` ${VAULT_ID}/ `)).toBe(VAULT_KEY);
    expect(getAzureResourceIdKey(`${VAULT_ID}///`)).toBe(VAULT_KEY);
    // A subscription alone is a resource too.
    expect(
      getAzureResourceIdKey(
        "/SUBSCRIPTIONS/6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B",
      ),
    ).toBe("/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b");
    expect(getAzureResourceIdKey("/subscriptions//")).toBeNull();
    expect(getAzureResourceIdKey(ORDERS_TABLE)).toBeNull();
  });

  test("an ARN's and a Google Cloud name's key is the ID as written", () => {
    expect(getResourceIdMatchKey(` ${ORDERS_TABLE} `)).toBe(ORDERS_TABLE);
    expect(getResourceIdMatchKey(DATASET)).toBe(DATASET);
    expect(getResourceIdMatchKey("Web-1")).toBe("Web-1");
  });

  test("two values are one by each cloud's rule, and a name by its folded self", () => {
    expect(getConnectionValueKey(VAULT_ID_EXPORTED)).toBe(
      getConnectionValueKey(VAULT_ID),
    );
    expect(getConnectionValueKey(ORDERS_TABLE)).not.toBe(
      getConnectionValueKey(ORDERS_TABLE_LOWER),
    );
    expect(getConnectionValueKey(" WEB-1 ")).toBe(
      getConnectionValueKey("web-1"),
    );
  });
});

describe("every source keeps an Azure resource ID by its one key", () => {
  test("Microsoft Defender XDR's evidence, in the case it received it", () => {
    const event: NormalizedSecurityEvent = defenderAlert(VAULT_ID_MIXED);

    expect(event.observables).toContain(VAULT_KEY);
    expect(event.observables).not.toContain(VAULT_ID_MIXED);
    // Its address, and the resource's name, as they came.
    expect(event.observables).toContain("198.51.100.23");
    expect(event.observables).toContain("kv-Payments");
    expect(rowOf(event)["observables"]).toContain(VAULT_KEY);
  });

  test("the Activity Log's export, in capitals: the resource and the subscription it is in", () => {
    const events: Array<NormalizedSecurityEvent> =
      exportedActivityLine(VAULT_ID_EXPORTED);

    expect(events).toHaveLength(1);
    expect(events[0]!.observables).toContain(VAULT_KEY);
    expect(events[0]!.observables).not.toContain(VAULT_ID_EXPORTED);
  });

  test("a pipeline's OCSF record, in its sender's own spelling", () => {
    const event: NormalizedSecurityEvent = ocsfPipelineRecord(VAULT_ID_MIXED);

    expect(event.observables).toEqual([
      "svc-terraform@acme.example",
      "203.0.113.41",
      VAULT_KEY,
    ]);
  });

  test("the ID a stream stamped on the line the event was read from", () => {
    const events: Array<NormalizedSecurityEvent> =
      streamedLine(VAULT_ID_EXPORTED);

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]).toBe(
      VAULT_KEY,
    );
    expect(
      readLogCloudResource({ "resource.cloud.resource_id": ` ${VAULT_ID}/ ` }),
    ).toEqual({ [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: VAULT_KEY });
    // An ARN as the stream stamped it.
    expect(
      readLogCloudResource({ "resource.cloud.resource_id": ORDERS_TABLE }),
    ).toEqual({ [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: ORDERS_TABLE });
  });

  test("one Azure resource named in three cases is one observable; two ARNs that differ by case stay two", () => {
    expect(
      buildObservables([
        VAULT_ID,
        VAULT_ID_EXPORTED,
        VAULT_ID_MIXED,
        ORDERS_TABLE,
        ORDERS_TABLE_LOWER,
        "WEB-1",
        "web-1",
      ]),
    ).toEqual([VAULT_KEY, ORDERS_TABLE, ORDERS_TABLE_LOWER, "WEB-1"]);
  });

  test("every row keeps the key, whatever wrote its event: a finding, a feed's match, a hand-built event", () => {
    const event: NormalizedSecurityEvent = {
      ...ocsfPipelineRecord(VAULT_ID),
      // A detection's finding copies its matched events' observables as they were stored.
      observables: [
        "kmorgan@acme.example",
        VAULT_ID_EXPORTED,
        VAULT_ID_MIXED,
        ORDERS_TABLE,
      ],
      attributes: {
        [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: VAULT_ID_MIXED,
        [SECURITY_LOG_FUNCTION_ATTRIBUTE]: "Checkout-Handler",
      },
    };
    const row: JSONObject = rowOf(event);

    expect(row["observables"]).toEqual([
      "kmorgan@acme.example",
      VAULT_KEY,
      ORDERS_TABLE,
    ]);
    expect(
      (row["attributes"] as JSONObject)[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE],
    ).toBe(VAULT_KEY);
    // A function's name is no resource ID: as it came.
    expect(
      (row["attributes"] as JSONObject)[SECURITY_LOG_FUNCTION_ATTRIBUTE],
    ).toBe("Checkout-Handler");
    // The event it was built from is left as it was.
    expect(event.observables).toContain(VAULT_ID_MIXED);
  });

  test("an ARN stamped on a row stays as written", () => {
    const row: JSONObject = rowOf({
      ...ocsfPipelineRecord(VAULT_ID),
      attributes: { [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: ORDERS_TABLE },
    });

    expect(
      (row["attributes"] as JSONObject)[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE],
    ).toBe(ORDERS_TABLE);
  });

  test("the observables of a row are left as they are when no Azure ID is among them", () => {
    expect(
      foldResourceIdObservables(["Web-1", ORDERS_TABLE, "203.0.113.9"]),
    ).toEqual(["Web-1", ORDERS_TABLE, "203.0.113.9"]);
    expect(foldResourceIdObservables(undefined)).toEqual([]);
    expect(
      foldResourceIdObservables([
        VAULT_ID,
        7 as unknown as string,
        VAULT_ID_EXPORTED,
      ]),
    ).toEqual([VAULT_KEY]);
  });
});

describe("a cloud resource's card and page find each source's event", () => {
  const sources: Array<[string, () => Array<NormalizedSecurityEvent>]> = [
    [
      "Defender XDR's evidence, in mixed case",
      (): Array<NormalizedSecurityEvent> => {
        return [defenderAlert(VAULT_ID_MIXED)];
      },
    ],
    [
      "the Activity Log's export, in capitals",
      (): Array<NormalizedSecurityEvent> => {
        return exportedActivityLine(VAULT_ID_EXPORTED);
      },
    ],
    [
      "a pipeline's OCSF record, in mixed case",
      (): Array<NormalizedSecurityEvent> => {
        return [ocsfPipelineRecord(VAULT_ID_MIXED)];
      },
    ],
    [
      "its own streamed logs, stamped in capitals",
      (): Array<NormalizedSecurityEvent> => {
        return streamedLine(VAULT_ID_EXPORTED);
      },
    ],
  ];

  test.each(sources)(
    "%s",
    (_source: string, read: () => Array<NormalizedSecurityEvent>) => {
      const rows: Array<JSONObject> = read().map(rowOf);

      expect(rows.length).toBeGreaterThan(0);

      // The vault's row keeps its ID as Resource Manager wrote it.
      for (const row of rows) {
        expect(isFoundBy(row, scopeOfResource(VAULT_ID))).toBe(true);
      }
    },
  );

  test("the key is what finds a new event, and is searched for first", () => {
    expect(scopeOfResource(VAULT_ID).observables[0]).toBe(VAULT_KEY);
    expect(scopeOfResource(VAULT_ID).attribute.values[0]).toBe(VAULT_KEY);

    // An event from before #10034, as Defender XDR wrote it then: still found by the ID as written.
    expect(
      isFoundBy(
        { observables: [VAULT_ID], attributes: {} },
        scopeOfResource(VAULT_ID),
      ),
    ).toBe(true);
  });

  /*
   * Near misses: what looks like the vault but is not it. Each is held to
   * the vault's own row, and none is found.
   */
  test.each([
    [
      "the same vault name in another subscription",
      "/subscriptions/0f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments",
    ],
    [
      "in another resource group",
      "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Test/providers/Microsoft.KeyVault/vaults/kv-Payments",
    ],
    [
      "a vault whose name starts with this one's",
      "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments2",
    ],
    [
      "a vault whose name is this one's but shorter",
      "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payment",
    ],
    [
      "a managed HSM of the same name",
      "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/managedHSMs/kv-Payments",
    ],
    [
      "its resource group alone",
      "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod",
    ],
    ["its bare name", "kv-Payments"],
  ])("%s is not the vault", (_case: string, other: string) => {
    for (const row of [
      defenderAlert(other),
      ocsfPipelineRecord(other),
      ...streamedLine(other),
    ].map(rowOf)) {
      expect(isFoundBy(row, scopeOfResource(VAULT_ID))).toBe(false);
    }

    expect(
      matchResourceId({ entityValue: other, providerResourceId: VAULT_ID }),
    ).toBeNull();
  });

  test("a part of the vault names the vault too, by the Activity Log's reading - never the other way round", () => {
    const secret: string = `${VAULT_ID_EXPORTED}/SECRETS/DB-PASSWORD`;

    // The Activity Log names the vault a secret is in (CloudAuditResources).
    expect(readAzureActivityResourceIds({ resourceId: secret })).toEqual([
      secret.toLowerCase(),
      VAULT_KEY,
    ]);
    // A secret is not the vault by its ID alone.
    expect(
      matchResourceId({ entityValue: secret, providerResourceId: VAULT_ID }),
    ).toBeNull();
  });

  test("an ARN or a Google Cloud name of another case is another resource: not found, not matched", () => {
    const tableRow: JSONObject = rowOf({
      ...ocsfPipelineRecord(ORDERS_TABLE_LOWER),
      attributes: {
        [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: ORDERS_TABLE_LOWER,
      },
    });

    expect(isFoundBy(tableRow, scopeOfResource(ORDERS_TABLE))).toBe(false);
    expect(isFoundBy(tableRow, scopeOfResource(ORDERS_TABLE_LOWER))).toBe(true);
    expect(scopeOfResource(ORDERS_TABLE).observables).toEqual([ORDERS_TABLE]);
    expect(scopeOfResource(ORDERS_TABLE).attribute.values).toEqual([
      ORDERS_TABLE,
    ]);

    const datasetRow: JSONObject = rowOf(ocsfPipelineRecord(DATASET_LOWER));

    expect(isFoundBy(datasetRow, scopeOfResource(DATASET))).toBe(false);
    expect(
      matchResourceId({
        entityValue: DATASET_LOWER,
        providerResourceId: DATASET,
      }),
    ).toBeNull();
  });

  test("Connected Signals matches the vault in any case, and nothing else", () => {
    for (const spelling of [
      VAULT_ID,
      VAULT_ID_EXPORTED,
      VAULT_ID_MIXED,
      `${VAULT_ID}/`,
    ]) {
      expect(
        matchResourceId({
          entityValue: spelling,
          providerResourceId: VAULT_ID,
        }),
      ).toEqual({
        certainty: SecurityConnectionCertainty.Exact,
        reason: SecurityConnectionReason.ResourceId,
      });
    }

    expect(
      matchResourceId({
        entityValue: STORAGE_ID,
        providerResourceId: VAULT_ID,
      }),
    ).toBeNull();
  });
});

describe("what a case's or an event's resource IDs are looked up as", () => {
  test("an Azure ID once, by its key, however many cases name it", () => {
    const lookups: SecurityConnectionLookups = getSecurityConnectionLookups([
      { type: SecurityEntityType.Other, value: VAULT_ID },
      { type: SecurityEntityType.Other, value: VAULT_ID_EXPORTED },
      { type: SecurityEntityType.Other, value: VAULT_ID_MIXED },
    ]);

    expect(lookups.resourceIds).toEqual([VAULT_KEY]);
    expect(lookups.lookedUp).toEqual([
      { type: SecurityEntityType.Other, value: VAULT_ID },
    ]);
  });

  test("two ARNs that differ by case alone are both looked up, each as written", () => {
    const lookups: SecurityConnectionLookups = getSecurityConnectionLookups([
      { type: SecurityEntityType.Other, value: ORDERS_TABLE },
      { type: SecurityEntityType.Other, value: ORDERS_TABLE_LOWER },
      { type: SecurityEntityType.Other, value: DATASET },
      { type: SecurityEntityType.Other, value: DATASET_LOWER },
    ]);

    expect(lookups.resourceIds).toEqual([
      ORDERS_TABLE,
      ORDERS_TABLE_LOWER,
      DATASET,
      DATASET_LOWER,
    ]);
    expect(lookups.lookedUp).toHaveLength(4);
  });

  test("a host named twice in two cases is still one name", () => {
    expect(
      getSecurityConnectionLookups([
        { type: SecurityEntityType.Host, value: "WEB-1" },
        { type: SecurityEntityType.Host, value: "web-1" },
      ]).hostNames,
    ).toEqual(["web-1"]);
  });
});

describe("the values the attribute on a record's own events is searched for", () => {
  test("a cloud resource's Azure ID: its key, then as written and in capitals", () => {
    expect(
      getLogAttributeSearchValues({
        key: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
        value: VAULT_ID,
      }),
    ).toEqual([VAULT_KEY, VAULT_ID, VAULT_ID_EXPORTED]);
  });

  test.each([
    [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE, ORDERS_TABLE],
    [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE, DATASET],
    // A readable stand-in its metrics keep it by: exactly what the stream stamps.
    [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE, "AWS/AmazonMQ Broker=orders"],
    [SECURITY_LOG_FUNCTION_ATTRIBUTE, "Checkout-Handler"],
    // A container host's name, even one shaped like an Azure ID, is no cloud resource's.
    [SECURITY_LOG_DOCKER_HOST_ATTRIBUTE, VAULT_ID],
  ])("%s %p: as it is", (key: string, value: string) => {
    expect(getLogAttributeSearchValues({ key, value })).toEqual([value]);
  });
});
