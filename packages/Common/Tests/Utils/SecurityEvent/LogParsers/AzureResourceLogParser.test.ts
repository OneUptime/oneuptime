import { describe, expect, test } from "@jest/globals";
import { buildSecurityEventDbRow } from "../../../../Server/Utils/SecurityEvent/SecurityEventRow";
import SecurityEventStoreOnce from "../../../../Server/Utils/SecurityEvent/SecurityEventStoreOnce";
import { TelemetryServiceMetadata } from "../../../../Server/Services/OpenTelemetryIngestService";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE } from "../../../../Types/SecurityCase/SecurityConnection";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  getSecurityLogFormatDefinition,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  getLogAttributeSearchValues,
  getObservableSearchValues,
  getRecordSecurityValues,
  matchResourceId,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import AzureResourceLogParser, {
  AZURE_KEY_VAULT_PRODUCT_NAME,
  AZURE_RESOURCE_LOG_PREFILTER_GROUPS,
  AZURE_SQL_PRODUCT_NAME,
  AZURE_STORAGE_PRODUCT_NAME,
  AzureResourceLogService,
  StorageAuthorization,
  getAzureResourceLogRecordUid,
  getAzureResourceLogService,
  isAzureResourceLogRecord,
  readAzureCallerAddress,
  readStorageAuthorization,
} from "../../../../Utils/SecurityEvent/LogParsers/AzureResourceLogParser";
import { readAzureResourceLogResourceIds } from "../../../../Utils/SecurityEvent/LogParsers/CloudAuditResources";
import SecurityLogParser, {
  SECURITY_LOG_PREFILTER,
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { azureActivityExport } from "../Connectors/EntraIdFixtures";
import {
  BLOB_SERVICE_ID,
  SQL_DATABASE_ID,
  SQL_MANAGED_INSTANCE_ID,
  SQL_SERVER_ID,
  STORAGE_ACCOUNT_ID,
  SUBSCRIPTION,
  UPN_CLAIM,
  VAULT_ID,
  accountKeyStorageRecord,
  anonymousStorageRecord,
  batchOf,
  keyVaultChallenge,
  keyVaultRecord,
  keyVaultSample,
  sasStorageRecord,
  sqlAuditRecord,
  sqlDatabaseRecord,
  sqlFreshSignIn,
  storageRecord,
} from "./AzureResourceLogFixtures";
import { logLine } from "./LogParserFixtures";

/*
 * Contract under test (#10110) - an Azure resource's own audit log, as a
 * diagnostic setting sends it, becomes security events: a key vault's
 * AuditEvent, a storage account's StorageRead, StorageWrite and
 * StorageDelete, and Azure SQL auditing's SQLSecurityAuditEvents
 * (AzureResourceLogParser). Each event is read from the line exactly as
 * the log scan's prefilter lets it out of the database, names its resource
 * by the one key every Azure ID is kept by, and has an id of its own, so a
 * record that arrives twice is stored once.
 */

function parse(body: JSONObject | string): Array<NormalizedSecurityEvent> {
  const text: string = typeof body === "string" ? body : JSON.stringify(body);

  return SecurityLogParser.parse(logLine(text));
}

function only(body: JSONObject | string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(body);

  expect(events).toHaveLength(1);

  return events[0]!;
}

function summary(event: NormalizedSecurityEvent): JSONObject {
  return {
    className: event.className,
    activityName: event.activityName,
    statusName: event.statusName,
    severityName: event.severityName,
    vendorName: event.vendorName,
    productName: event.productName,
    format: event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] as string,
  };
}

const PROJECT_ID: ObjectID = new ObjectID(
  "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
);
const SERVICE: TelemetryServiceMetadata = {
  primaryEntityId: new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001"),
  primaryEntityType: ServiceType.OpenTelemetry,
  serviceRetentionInDays: 30,
  projectRetentionInDays: 30,
} as unknown as TelemetryServiceMetadata;

/*
 * Whether a cloud resource's Security Events page finds an event: its own
 * row's search - hasAny(observables, spellings) or its stamped
 * cloud.resource_id - over the row the event is stored as.
 */
function isOnPageOf(
  event: NormalizedSecurityEvent,
  providerResourceId: string,
): boolean {
  const row: JSONObject = buildSecurityEventDbRow({
    normalized: event,
    projectId: PROJECT_ID,
    serviceMetadata: SERVICE,
    retentionDays: 30,
  });
  const observables: Array<string> =
    (row["observables"] as Array<string>) || [];
  const spellings: Array<string> = getObservableSearchValues(
    getRecordSecurityValues({ names: [providerResourceId] }),
  );
  const attributes: JSONObject = (row["attributes"] as JSONObject) || {};
  const stamped: unknown = attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE];

  return (
    observables.some((observable: string): boolean => {
      return spellings.includes(observable);
    }) ||
    (typeof stamped === "string" &&
      getLogAttributeSearchValues({
        key: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
        value: providerResourceId,
      }).includes(stamped))
  );
}

describe("AzureResourceLogParser - which records it reads", () => {
  test("a key vault's AuditEvent, a storage service's requests and Azure SQL's audit, each its own service", () => {
    expect(getAzureResourceLogService(keyVaultRecord())).toBe(
      AzureResourceLogService.KeyVault,
    );
    for (const category of ["StorageRead", "StorageWrite", "StorageDelete"]) {
      expect(getAzureResourceLogService(storageRecord({ category }))).toBe(
        AzureResourceLogService.Storage,
      );
    }
    expect(getAzureResourceLogService(sqlAuditRecord())).toBe(
      AzureResourceLogService.Sql,
    );
    // Category's case is Azure's to choose.
    expect(
      isAzureResourceLogRecord(keyVaultRecord({ category: "AUDITEVENT" })),
    ).toBe(true);
  });

  test("another service's AuditEvent, and every other category, is not read", () => {
    const hsm: string = `/SUBSCRIPTIONS/${SUBSCRIPTION.toUpperCase()}/RESOURCEGROUPS/RG/PROVIDERS/MICROSOFT.KEYVAULT/MANAGEDHSMS/CONTOSO-HSM`;
    const attestation: string = `/SUBSCRIPTIONS/${SUBSCRIPTION.toUpperCase()}/RESOURCEGROUPS/RG/PROVIDERS/MICROSOFT.ATTESTATION/ATTESTATIONPROVIDERS/CONTOSO`;

    for (const record of [
      keyVaultRecord({ resourceId: hsm }),
      keyVaultRecord({ resourceId: attestation }),
      keyVaultRecord({ resourceId: "" }),
      keyVaultRecord({ category: "AppServiceConsoleLogs" }),
      storageRecord({ category: "Transaction" }),
      azureActivityExport(),
    ]) {
      expect(isAzureResourceLogRecord(record)).toBe(false);
      expect(AzureResourceLogParser.parse(logLine(batchOf([record])))).toEqual(
        [],
      );
    }
  });

  test("an address is read with or without its port, never a local one", () => {
    expect(readAzureCallerAddress("104.40.82.76")).toBe("104.40.82.76");
    expect(readAzureCallerAddress("192.0.2.10:52314")).toBe("192.0.2.10");
    expect(readAzureCallerAddress("[2001:db8::7]:443")).toBe("2001:db8::7");
    expect(readAzureCallerAddress("2001:db8::7")).toBe("2001:db8::7");
    expect(readAzureCallerAddress("127.0.0.1:80")).toBe("");
    expect(readAzureCallerAddress("unknown")).toBe("");
    expect(readAzureCallerAddress("")).toBe("");
    expect(readAzureCallerAddress("a:b:c")).toBe("");
  });

  test("each record names its own resource and the one it is a part of, by their keys", () => {
    expect(readAzureResourceLogResourceIds(keyVaultRecord())).toEqual([
      VAULT_ID.toLowerCase(),
    ]);
    expect(readAzureResourceLogResourceIds(storageRecord())).toEqual([
      BLOB_SERVICE_ID.toLowerCase(),
      STORAGE_ACCOUNT_ID.toLowerCase(),
    ]);
    expect(readAzureResourceLogResourceIds(sqlDatabaseRecord())).toEqual([
      SQL_DATABASE_ID.toLowerCase(),
      SQL_SERVER_ID.toLowerCase(),
    ]);
    // A delegated resource is who called, never what was called on.
    expect(
      readAzureResourceLogResourceIds(
        storageRecord({
          identity: {
            type: "OAuth",
            delegatedResource: {
              resourceId: `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg/providers/Microsoft.Compute/virtualMachines/web-01`,
            },
          },
        }),
      ),
    ).not.toContain(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg/providers/microsoft.compute/virtualmachines/web-01`,
    );
    expect(
      readAzureResourceLogResourceIds(keyVaultRecord({ resourceId: "kv" })),
    ).toEqual([]);
  });
});

describe("AzureResourceLogParser - a key vault's AuditEvent", () => {
  test("a secret read is an Informational API Activity: who read which secret, from where", () => {
    const event: NormalizedSecurityEvent = only(batchOf([keyVaultRecord()]));

    expect(summary(event)).toEqual({
      className: "API Activity",
      activityName: "SecretGet",
      statusName: "Success",
      severityName: OcsfSeverity.Informational,
      vendorName: "Microsoft",
      productName: AZURE_KEY_VAULT_PRODUCT_NAME,
      format: SecurityLogFormat.AzureResourceLogs,
    });
    expect(event.principalUser).toBe("alice@contoso.com");
    expect(event.principalIp).toBe("203.0.113.24");
    expect(event.targetResource).toBe(
      "https://contosokeyvault.vault.azure.net/secrets/db-password/7c3f9d2a1b4e4f6a8c0d2e4f6a8b0c1d",
    );
    expect(event.message).toBe(
      "alice@contoso.com called SecretGet on key vault CONTOSOKEYVAULT (secrets/db-password/7c3f9d2a1b4e4f6a8c0d2e4f6a8b0c1d)",
    );
    expect(event.time.toISOString()).toBe("2026-11-18T09:12:44.612Z");
    // The record's fields, for a rule to read as Microsoft names them.
    expect(event.attributes["properties.httpStatusCode"]).toBe("200");
    expect(event.attributes["identity.claim.appid"]).toBe(
      "04b07795-8ddb-461a-bbee-02f9e1bf7b46",
    );
  });

  test("Microsoft's own sample, a VaultGet, hands out nothing secret: no event", () => {
    expect(parse(batchOf([keyVaultSample()]))).toEqual([]);
  });

  test.each([
    ["SecretGetDeleted", OcsfSeverity.Informational],
    ["SecretSet", OcsfSeverity.Informational],
    ["KeyCreate", OcsfSeverity.Informational],
    ["KeyRotationPolicySet", OcsfSeverity.Informational],
    ["CertificateImport", OcsfSeverity.Informational],
    ["VaultPatch", OcsfSeverity.Informational],
    ["SecretBackup", OcsfSeverity.Low],
    ["KeyBackup", OcsfSeverity.Low],
    ["SecretDelete", OcsfSeverity.Low],
    ["VaultDelete", OcsfSeverity.Low],
    ["KeyPurge", OcsfSeverity.Low],
    ["CertificatePurge", OcsfSeverity.Low],
    ["VaultAccessPolicyChangedEventGridNotification", OcsfSeverity.Low],
  ])(
    "%s that succeeded is an event, %s",
    (operationName: string, severity: OcsfSeverity) => {
      const event: NormalizedSecurityEvent = only(
        batchOf([keyVaultRecord({ operationName })]),
      );

      expect([
        event.activityName,
        event.statusName,
        event.severityName,
      ]).toEqual([operationName, "Success", severity]);
    },
  );

  test.each([
    "VaultGet",
    "KeyGet",
    "CertificateGet",
    "SecretList",
    "KeyListVersions",
    "KeySign",
    "KeyVerify",
    "KeyWrap",
    "KeyUnwrap",
    "KeyEncrypt",
    "KeyDecrypt",
    "KeyRotateIfDue",
    "KeyNearExpiryEventGridNotification",
    "SecretExpiredEventGridNotification",
    "CertificatePolicyGet",
    "Authentication",
  ])("%s that succeeded is no event", (operationName: string) => {
    expect(parse(batchOf([keyVaultRecord({ operationName })]))).toEqual([]);
  });

  test("a request the vault refused is a Low failure, whatever it asked for", () => {
    for (const operationName of ["SecretGet", "KeyDecrypt", "SecretList"]) {
      const event: NormalizedSecurityEvent = only(
        batchOf([
          keyVaultRecord({
            operationName,
            resultType: "Success",
            resultSignature: "Forbidden",
            properties: {
              id: "https://contosokeyvault.vault.azure.net/secrets/db-password",
              httpStatusCode: 403,
              isAccessPolicyMatch: false,
              isRbacAuthorized: false,
            },
          }),
        ]),
      );

      expect([event.statusName, event.severityName]).toEqual([
        "Failure",
        OcsfSeverity.Low,
      ]);
      expect(event.message).toBe(
        `alice@contoso.com was refused ${operationName} on key vault CONTOSOKEYVAULT (secrets/db-password): Forbidden`,
      );
    }
  });

  test("the firewall's refusal is one too: a 403 read from its signature alone", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([
        keyVaultRecord({
          resultSignature: "Forbidden",
          resultDescription:
            "Client address is not authorized and caller is not a trusted service.",
          properties: { isAddressAuthorized: false },
        }),
      ]),
    );

    expect(event.statusName).toBe("Failure");
  });

  test("the Azure SDK's first, tokenless call is no refusal: its Authentication 401, or any 401 naming no caller", () => {
    expect(parse(batchOf([keyVaultChallenge()]))).toEqual([]);
    expect(
      parse(batchOf([keyVaultChallenge({ operationName: "SecretGet" })])),
    ).toEqual([]);
    // The prefilter keeps the challenge in the database to begin with.
    expect(matchesSecurityLogPrefilter(batchOf([keyVaultChallenge()]))).toBe(
      false,
    );
  });

  test("a 401 for a token the vault refused, naming its caller, is a refusal", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([
        keyVaultRecord({
          resultSignature: "Unauthorized",
          resultDescription: "AKV10032: Invalid issuer.",
          properties: { httpStatusCode: 401 },
        }),
      ]),
    );

    expect([event.statusName, event.severityName, event.principalUser]).toEqual(
      ["Failure", OcsfSeverity.Low, "alice@contoso.com"],
    );
  });

  test.each([404, 409, 429, 500, 503])(
    "a %s is no security event",
    (httpStatusCode: number) => {
      expect(
        parse(
          batchOf([
            keyVaultRecord({ properties: { httpStatusCode, id: "x" } }),
          ]),
        ),
      ).toEqual([]);
    },
  );

  test("an app signed in with its own identity is named by its app id", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([
        keyVaultRecord({
          identity: {
            claim: {
              appid: "2c4e6a8b-0d1f-4a3c-8e5f-7a9b1c3d5e7f",
              "http://schemas.microsoft.com/identity/claims/objectidentifier":
                "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
            },
          },
        }),
      ]),
    );

    expect(event.principalUser).toBe("2c4e6a8b-0d1f-4a3c-8e5f-7a9b1c3d5e7f");
  });

  test("a vault the export names in capitals is on the page of the vault its row writes in mixed case", () => {
    const event: NormalizedSecurityEvent = only(batchOf([keyVaultRecord()]));

    expect(isOnPageOf(event, VAULT_ID)).toBe(true);
    expect(
      matchResourceId({
        entityValue: VAULT_ID.toUpperCase(),
        providerResourceId: VAULT_ID,
      }),
    ).not.toBeNull();
    // And so is the same record, written in the portal's case.
    expect(
      isOnPageOf(
        only(batchOf([keyVaultRecord({ resourceId: VAULT_ID })])),
        VAULT_ID,
      ),
    ).toBe(true);
  });

  test("near misses never reach the vault's page: another vault, a longer name, another subscription", () => {
    const event: NormalizedSecurityEvent = only(batchOf([keyVaultRecord()]));

    for (const other of [
      VAULT_ID.replace("ContosoKeyVault", "ContosoKeyVault2"),
      VAULT_ID.replace("ContosoKeyVault", "ContosoKey"),
      VAULT_ID.replace(SUBSCRIPTION, "bbbb1b1b-cc2c-dd3d-ee4e-ffffff5f5f5f"),
      VAULT_ID.replace("ContosoGroup", "OtherGroup"),
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/ContosoGroup`,
    ]) {
      expect([other, isOnPageOf(event, other)]).toEqual([other, false]);
    }
  });
});

describe("AzureResourceLogParser - a storage account's requests", () => {
  test("Microsoft's own sample, a PutBlob signed in with Microsoft Entra ID, is no event", () => {
    expect(parse(batchOf([storageRecord()]))).toEqual([]);
  });

  test("a read served anonymously is a Low event: the object, and the address without its port", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([anonymousStorageRecord()]),
    );

    expect(summary(event)).toEqual({
      className: "API Activity",
      activityName: "GetBlob",
      statusName: "Success",
      severityName: OcsfSeverity.Low,
      vendorName: "Microsoft",
      productName: AZURE_STORAGE_PRODUCT_NAME,
      format: SecurityLogFormat.AzureResourceLogs,
    });
    expect(event.principalIp).toBe("198.51.100.23");
    expect(event.principalUser).toBe("");
    expect(event.targetResource).toBe(
      "/contosodata/public/invoices/2026-11.pdf",
    );
    expect(event.message).toBe(
      "An anonymous caller called GetBlob on storage account CONTOSODATA (/contosodata/public/invoices/2026-11.pdf) from 198.51.100.23",
    );
  });

  test("its blob service's event is on the storage account's page, and the service's own", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([anonymousStorageRecord()]),
    );

    expect(isOnPageOf(event, STORAGE_ACCOUNT_ID)).toBe(true);
    expect(isOnPageOf(event, BLOB_SERVICE_ID)).toBe(true);
    // Not another account's, nor one whose name only starts the same.
    expect(
      isOnPageOf(event, STORAGE_ACCOUNT_ID.replace("contosodata", "contoso")),
    ).toBe(false);
    expect(
      isOnPageOf(
        event,
        STORAGE_ACCOUNT_ID.replace("contosodata", "contosodatabackup"),
      ),
    ).toBe(false);
  });

  test("a static website's pages and a CORS preflight are anonymous by design: no event", () => {
    for (const record of [
      anonymousStorageRecord({
        uri: "https://contosodata.z13.web.core.windows.net/index.html",
        properties: {
          accountName: "contosodata",
          objectKey: "/contosodata/$web/index.html",
        },
      }),
      anonymousStorageRecord({
        uri: "https://contosodata.z13.web.core.windows.net/about",
      }),
      anonymousStorageRecord({
        properties: { objectKey: "/contosodata/$web/app.js" },
      }),
      anonymousStorageRecord({ operationName: "BlobPreflightRequest" }),
    ]) {
      expect(parse(batchOf([record]))).toEqual([]);
      expect(matchesSecurityLogPrefilter(batchOf([record]))).toBe(false);
    }
  });

  test("a read a shared access signature, the account key or Entra ID signed is no event", () => {
    for (const record of [
      sasStorageRecord({
        category: "StorageRead",
        operationName: "GetBlob",
        statusCode: 200,
      }),
      accountKeyStorageRecord(),
      storageRecord({
        category: "StorageRead",
        operationName: "GetBlob",
        statusCode: 206,
      }),
      storageRecord({ category: "StorageRead", operationName: "ListBlobs" }),
    ]) {
      expect(parse(batchOf([record]))).toEqual([]);
    }
  });

  test("a write or a delete a shared access signature signed is an Informational event", () => {
    const write: NormalizedSecurityEvent = only(batchOf([sasStorageRecord()]));
    const deleted: NormalizedSecurityEvent = only(
      batchOf([
        sasStorageRecord({
          category: "StorageDelete",
          operationName: "DeleteBlob",
          statusCode: 202,
        }),
      ]),
    );

    expect([write.statusName, write.severityName]).toEqual([
      "Success",
      OcsfSeverity.Informational,
    ]);
    expect(write.message).toBe(
      "A shared access signature called PutBlob on storage account CONTOSODATA (/contosodata/uploads/avatar.png) from 203.0.113.80",
    );
    expect(deleted.activityName).toBe("DeleteBlob");
  });

  test.each(["SAS", "SAS Key", "DelegationSas"])(
    "identity type %s is a shared access signature",
    (type: string) => {
      expect(
        readStorageAuthorization(sasStorageRecord({ identity: { type } })),
      ).toBe(StorageAuthorization.SharedAccessSignature);
    },
  );

  test("with no identity, the status text says how it was signed", () => {
    expect(
      readStorageAuthorization(
        sasStorageRecord({ identity: undefined, statusText: "SASSuccess" }),
      ),
    ).toBe(StorageAuthorization.SharedAccessSignature);
    expect(
      readStorageAuthorization(
        anonymousStorageRecord({
          identity: undefined,
          statusText: "AnonymousSuccess",
        }),
      ),
    ).toBe(StorageAuthorization.Anonymous);
    expect(readStorageAuthorization(accountKeyStorageRecord())).toBe(
      StorageAuthorization.AccountKey,
    );
    expect(readStorageAuthorization(storageRecord())).toBe(
      StorageAuthorization.EntraId,
    );
  });

  test.each([
    [
      "an Entra ID caller without the role",
      storageRecord,
      403,
      "AuthorizationPermissionMismatch",
    ],
    [
      "a shared access signature",
      sasStorageRecord,
      403,
      "AuthorizationFailure",
    ],
    [
      "an anonymous caller",
      anonymousStorageRecord,
      401,
      "NoAuthenticationInformation",
    ],
    [
      "an anonymous caller of an account that allows none",
      anonymousStorageRecord,
      409,
      "PublicAccessNotPermitted",
    ],
  ])(
    "a request refused to %s is a Low failure",
    (
      _caller: string,
      record: (overrides?: JSONObject) => JSONObject,
      statusCode: number,
      statusText: string,
    ) => {
      const event: NormalizedSecurityEvent = only(
        batchOf([record({ statusCode, statusText })]),
      );

      expect([event.statusName, event.severityName]).toEqual([
        "Failure",
        OcsfSeverity.Low,
      ]);
      expect(event.message.endsWith(`: ${statusText}`)).toBe(true);
    },
  );

  test("an Entra ID caller refused is named by their UPN", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([
        storageRecord({
          statusCode: 403,
          statusText: "AuthorizationPermissionMismatch",
          identity: {
            type: "OAuth",
            requester: { upn: "mallory@contoso.com", objectId: "x" },
          },
        }),
      ]),
    );

    expect(event.principalUser).toBe("mallory@contoso.com");
  });

  test("an access list changed, and a whole container deleted, are Low events whoever signed them", () => {
    for (const [category, operationName, statusCode] of [
      ["StorageWrite", "SetContainerACL", 200],
      ["StorageWrite", "SetShareAcl", 200],
      ["StorageWrite", "SetPathAccessControl", 200],
      ["StorageDelete", "DeleteContainer", 202],
      ["StorageDelete", "DeleteFilesystem", 202],
      ["StorageDelete", "DeleteQueue", 204],
      ["StorageDelete", "DeleteTable", 204],
      ["StorageDelete", "DeleteShare", 202],
    ] as Array<[string, string, number]>) {
      const event: NormalizedSecurityEvent = only(
        batchOf([
          accountKeyStorageRecord({ category, operationName, statusCode }),
        ]),
      );

      expect([event.activityName, event.severityName]).toEqual([
        operationName,
        OcsfSeverity.Low,
      ]);
    }
  });

  test("a blob deleted with the account key, a not found, a throttled or an unknown status is no event", () => {
    for (const record of [
      accountKeyStorageRecord({
        category: "StorageDelete",
        operationName: "DeleteBlob",
        statusCode: 202,
      }),
      anonymousStorageRecord({ statusCode: 404, statusText: "BlobNotFound" }),
      sasStorageRecord({ statusCode: 503, statusText: "ServerBusy" }),
      anonymousStorageRecord({ statusCode: "Unknown" }),
    ]) {
      expect(parse(batchOf([record]))).toEqual([]);
    }
  });

  test("the status code may be text, as some writers keep it", () => {
    expect(
      only(batchOf([anonymousStorageRecord({ statusCode: "200" })])).statusName,
    ).toBe("Success");
  });
});

describe("AzureResourceLogParser - Azure SQL auditing", () => {
  test("a pooled connection's sign-in, IBM's sample, is audited on every reuse: no event", () => {
    expect(parse(batchOf([sqlAuditRecord()]))).toEqual([]);
    expect(matchesSecurityLogPrefilter(batchOf([sqlAuditRecord()]))).toBe(
      false,
    );
  });

  test("a new connection's sign-in is an Informational Authentication: who, from where, to which instance", () => {
    const event: NormalizedSecurityEvent = only(batchOf([sqlFreshSignIn()]));

    expect(summary(event)).toEqual({
      className: "Authentication",
      activityName: "Logon",
      statusName: "Success",
      severityName: OcsfSeverity.Informational,
      vendorName: "Microsoft",
      productName: AZURE_SQL_PRODUCT_NAME,
      format: SecurityLogFormat.AzureResourceLogs,
    });
    expect(event.principalUser).toBe("LoginName");
    expect(event.principalIp).toBe("10.242.142.140");
    expect(event.message).toBe(
      "Azure SQL sign-in for LoginName to contoso-mi from 10.242.142.140",
    );
    expect(event.time.toISOString()).toBe("2020-07-19T05:26:01.166Z");
    expect(isOnPageOf(event, SQL_MANAGED_INSTANCE_ID)).toBe(true);
  });

  test("a failed sign-in to a database is a Low failure, on the database's page and its server's", () => {
    const event: NormalizedSecurityEvent = only(batchOf([sqlDatabaseRecord()]));

    expect([
      event.className,
      event.statusName,
      event.severityName,
      event.principalUser,
      event.principalIp,
    ]).toEqual([
      "Authentication",
      "Failure",
      OcsfSeverity.Low,
      "app_reader",
      "198.51.100.77",
    ]);
    expect(event.message).toBe(
      "Failed Azure SQL sign-in for app_reader to Orders from 198.51.100.77",
    );
    expect(isOnPageOf(event, SQL_DATABASE_ID)).toBe(true);
    expect(isOnPageOf(event, SQL_SERVER_ID)).toBe(true);
    expect(
      isOnPageOf(event, SQL_DATABASE_ID.replace("Orders", "OrdersArchive")),
    ).toBe(false);
  });

  test("a failed pooled sign-in is still a failed sign-in", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([
        sqlAuditRecord(
          {},
          {
            action_id: "LGIF",
            action_name: "LOGIN FAILED",
            succeeded: "false",
          },
        ),
      ]),
    );

    expect(event.statusName).toBe("Failure");
  });

  test("a batch is no event, whether it succeeded or failed, and never leaves the database", () => {
    for (const succeeded of ["true", "false"]) {
      const record: JSONObject = sqlDatabaseRecord({
        action_id: "BCM",
        action_name: "BATCH COMPLETED",
        succeeded,
        class_type: "DB",
        database_principal_name: "app_writer",
        statement: "UPDATE dbo.Orders SET Status = 'Shipped' WHERE Id = @p0",
        additional_information: "",
      });

      expect(parse(batchOf([record]))).toEqual([]);
      expect(matchesSecurityLogPrefilter(batchOf([record]))).toBe(false);
    }
  });

  test("a batch whose statement says what an event's record would is still no event, and its words never let it out", () => {
    const record: JSONObject = sqlDatabaseRecord({
      action_id: "BCM",
      action_name: "BATCH COMPLETED",
      succeeded: "true",
      class_type: "DB",
      database_principal_name: "app_writer",
      statement:
        'GRANT SELECT ON dbo.Orders TO app_reader; INSERT INTO dbo.Audit VALUES (\'{"action_name":"LOGIN FAILED","succeeded":"false"}\') -- login failed, password reset',
      additional_information: "",
    });

    expect(parse(batchOf([record]))).toEqual([]);
    expect(matchesSecurityLogPrefilter(batchOf([record]))).toBe(false);
  });

  test.each([
    ["GRANT", "G", "app_reader"],
    ["REVOKE WITH CASCADE", "RWC", "app_reader"],
    ["DENY", "D", "contractor"],
    ["ADD MEMBER", "APRL", "app_writer"],
    ["DROP MEMBER", "DPRL", "app_writer"],
    ["IMPERSONATE", "IMP", "dbo"],
  ])(
    "%s is an event naming whom it was for",
    (actionName: string, actionId: string, target: string) => {
      const event: NormalizedSecurityEvent = only(
        batchOf([
          sqlDatabaseRecord({
            action_id: actionId,
            action_name: actionName,
            succeeded: "true",
            class_type: "U",
            schema_name: "dbo",
            object_name: "Orders",
            database_principal_name: "dba",
            target_database_principal_name: target,
          }),
        ]),
      );

      expect([
        event.className,
        event.activityName,
        event.severityName,
        event.targetUser,
      ]).toEqual([
        "API Activity",
        actionName,
        OcsfSeverity.Informational,
        target,
      ]);
      expect(event.message).toBe(
        `dba ran ${actionName} on Orders (dbo.Orders) for ${target}`,
      );
    },
  );

  test("a password changed, and a login or a user created, altered or dropped, are events", () => {
    for (const [actionName, classType] of [
      ["CHANGE PASSWORD", "SL"],
      ["RESET PASSWORD", "SL"],
      ["CREATE", "SL"],
      ["DROP", "US"],
      ["ALTER", "RL"],
    ]) {
      const event: NormalizedSecurityEvent = only(
        batchOf([
          sqlDatabaseRecord({
            action_id: "XX",
            action_name: actionName,
            succeeded: "true",
            class_type: classType,
            database_principal_name: "dba",
            object_name: "new_admin",
          }),
        ]),
      );

      expect(event.activityName).toBe(actionName);
    }
  });

  test("a table created, or an object read, is no event", () => {
    for (const [actionName, classType] of [
      ["CREATE", "U"],
      ["SELECT", "U"],
      ["EXECUTE", "P"],
    ]) {
      expect(
        parse(
          batchOf([
            sqlDatabaseRecord({
              action_id: "XX",
              action_name: actionName,
              succeeded: "true",
              class_type: classType,
              database_principal_name: "app",
            }),
          ]),
        ),
      ).toEqual([]);
    }
  });

  test("an action whose permission check failed is a Low refusal", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([
        sqlDatabaseRecord({
          action_id: "SL",
          action_name: "SELECT",
          succeeded: "false",
          class_type: "U",
          schema_name: "dbo",
          object_name: "Salaries",
          database_principal_name: "app_reader",
        }),
      ]),
    );

    expect([event.statusName, event.severityName, event.message]).toEqual([
      "Failure",
      OcsfSeverity.Low,
      "app_reader was refused SELECT on Orders (dbo.Salaries)",
    ]);
  });

  test("Log Analytics' suffixed field names are read too", () => {
    const event: NormalizedSecurityEvent = only(
      batchOf([
        {
          time: "2026-11-18T09:20:31.4410000Z",
          resourceId: SQL_DATABASE_ID.toUpperCase(),
          category: "SQLSecurityAuditEvents",
          operationName: "AuditEvent",
          properties: {
            action_id_s: "DBAF",
            action_name_s: "DATABASE AUTHENTICATION FAILED",
            succeeded_s: "false",
            database_principal_name_s: "app_reader",
            database_name_s: "Orders",
            client_ip_s: "198.51.100.77",
            event_time_t: "2026-11-18T09:20:30.912Z",
            sequence_group_id_g: "6C1E9B7A-2D3F-4A5B-8C9D-0E1F2A3B4C5D",
            sequence_number_d: 1,
          },
        },
      ]),
    );

    expect([event.statusName, event.principalUser]).toEqual([
      "Failure",
      "app_reader",
    ]);
  });
});

describe("AzureResourceLogParser - a record's id, so it is stored once", () => {
  test("the same record gives the same id alone, in a batch, pretty-printed and in another case", () => {
    for (const record of [
      keyVaultRecord(),
      anonymousStorageRecord(),
      sqlDatabaseRecord(),
    ]) {
      const uid: string = getAzureResourceLogRecordUid(record);
      const lowerId: JSONObject = {
        ...record,
        resourceId: String(record["resourceId"]).toLowerCase(),
      };

      expect(uid).not.toBe("");
      expect(getAzureResourceLogRecordUid(lowerId)).toBe(uid);
      expect(only(JSON.stringify(record)).eventUid).toBe(uid);
      expect(only(batchOf([accountKeyStorageRecord(), record])).eventUid).toBe(
        uid,
      );
      expect(
        only(JSON.stringify({ records: [record] }, null, 2)).eventUid,
      ).toBe(uid);
    }
  });

  test("each service has an id of its own kind", () => {
    expect(getAzureResourceLogRecordUid(keyVaultRecord())).toMatch(
      /^azure-keyvault:[0-9a-f]{40}$/,
    );
    expect(getAzureResourceLogRecordUid(anonymousStorageRecord())).toMatch(
      /^azure-storage:[0-9a-f]{40}$/,
    );
    expect(getAzureResourceLogRecordUid(sqlDatabaseRecord())).toMatch(
      /^azure-sql:[0-9a-f]{40}$/,
    );
  });

  test("two requests are two ids: another moment, another secret, another request, another record of a statement", () => {
    expect(
      getAzureResourceLogRecordUid(
        keyVaultRecord({ time: "2026-11-18T09:12:44.6127744Z" }),
      ),
    ).not.toBe(getAzureResourceLogRecordUid(keyVaultRecord()));
    expect(
      getAzureResourceLogRecordUid(
        keyVaultRecord({
          properties: {
            ...(keyVaultRecord()["properties"] as JSONObject),
            id: "https://contosokeyvault.vault.azure.net/secrets/api-key/1",
          },
        }),
      ),
    ).not.toBe(getAzureResourceLogRecordUid(keyVaultRecord()));
    // A copy logs its source and its destination under one correlationId.
    expect(
      getAzureResourceLogRecordUid(
        storageRecord({ operationName: "CopyBlobSource" }),
      ),
    ).not.toBe(
      getAzureResourceLogRecordUid(
        storageRecord({ operationName: "CopyBlobDestination" }),
      ),
    );
    expect(
      getAzureResourceLogRecordUid(
        storageRecord({
          correlationId: "eeee4444-ff55-6666-7700-888888111111",
        }),
      ),
    ).not.toBe(getAzureResourceLogRecordUid(storageRecord()));
    expect(
      getAzureResourceLogRecordUid(
        sqlDatabaseRecord({ sequence_number: 2, event_id: "" }),
      ),
    ).not.toBe(
      getAzureResourceLogRecordUid(
        sqlDatabaseRecord({ sequence_number: 1, event_id: "" }),
      ),
    );
  });

  test("a record that says too little has no id: it is known by its line", () => {
    expect(
      getAzureResourceLogRecordUid(
        anonymousStorageRecord({ correlationId: "" }),
      ),
    ).toBe("");
    expect(getAzureResourceLogRecordUid(keyVaultRecord({ time: "" }))).toBe("");

    const event: NormalizedSecurityEvent = only(
      batchOf([anonymousStorageRecord({ correlationId: "" })]),
    );

    expect(event.eventUid.startsWith("log:")).toBe(true);
  });

  test("their products are among those the store looks up before it writes", () => {
    for (const productName of [
      AZURE_KEY_VAULT_PRODUCT_NAME,
      AZURE_STORAGE_PRODUCT_NAME,
      AZURE_SQL_PRODUCT_NAME,
    ]) {
      expect(SecurityEventStoreOnce.isSharedProduct(productName)).toBe(true);
    }

    const events: Array<NormalizedSecurityEvent> = [
      only(batchOf([keyVaultRecord()])),
      only(JSON.stringify(keyVaultRecord())),
      only(batchOf([anonymousStorageRecord()])),
    ];

    expect(
      events.every((event: NormalizedSecurityEvent): boolean => {
        return SecurityEventStoreOnce.isSharedRecord(event);
      }),
    ).toBe(true);
  });
});

describe("AzureResourceLogParser - batches, and the database's prefilter", () => {
  test("a batch's records are each read, the noise left out", () => {
    const events: Array<NormalizedSecurityEvent> = parse(
      batchOf([
        accountKeyStorageRecord(),
        anonymousStorageRecord(),
        sasStorageRecord(),
        sasStorageRecord({
          category: "StorageRead",
          operationName: "GetBlob",
          statusCode: 200,
          correlationId: "ffff5555-0066-7777-8811-999999222222",
        }),
      ]),
    );

    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return event.activityName;
      }),
    ).toEqual(["GetBlob", "PutBlob"]);
  });

  test("one batch of the Activity Log and a vault's own log gives both their events", () => {
    const events: Array<NormalizedSecurityEvent> = parse(
      batchOf([azureActivityExport(), keyVaultRecord()]),
    );

    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return event.productName;
      }),
    ).toEqual(["Azure Activity Log", AZURE_KEY_VAULT_PRODUCT_NAME]);
  });

  test("a storage account's successful reads never leave the database", () => {
    for (const record of [
      accountKeyStorageRecord(),
      storageRecord({ category: "StorageRead", operationName: "GetBlob" }),
      sasStorageRecord({
        category: "StorageRead",
        operationName: "GetBlob",
        statusCode: 200,
      }),
    ]) {
      expect(matchesSecurityLogPrefilter(batchOf([record]))).toBe(false);
      expect(matchesSecurityLogPrefilter(JSON.stringify(record, null, 1))).toBe(
        false,
      );
    }
  });

  test("its words are lowercase, and a group never asks the database for more than it can", () => {
    for (const group of AZURE_RESOURCE_LOG_PREFILTER_GROUPS) {
      for (const word of [
        group.requires,
        ...group.anyOf,
        ...(group.noneOf || []),
        ...(group.unlessAnyOf || []),
      ]) {
        expect(word).toBe(word.toLowerCase());
        expect(word.length).toBeGreaterThan(0);
      }

      // multiSearchAnyCaseInsensitive takes at most 255 needles at once.
      expect(group.anyOf.length).toBeLessThan(255);
      expect(SECURITY_LOG_PREFILTER.groups).toContainEqual({ ...group });
    }
  });

  test("the prefilter holds every line the parser turns into events, across thousands of generated batches", () => {
    const random: SeededRandom = seededRandom(10110);
    const pick: <T>(items: ReadonlyArray<T>) => T = <T>(
      items: ReadonlyArray<T>,
    ): T => {
      return items[random(items.length)]!;
    };
    const vaultOperations: Array<string> = [
      "SecretGet",
      "SecretList",
      "KeyDecrypt",
      "SecretPurge",
      "VaultPut",
      "Authentication",
      "KeyNearExpiryEventGridNotification",
    ];
    const statuses: Array<number> = [
      200, 201, 202, 204, 206, 304, 401, 403, 404, 409, 429, 500,
    ];
    const records: Array<() => JSONObject> = [
      (): JSONObject => {
        const status: number = pick(statuses);

        return keyVaultRecord({
          time: `2026-11-18T09:12:${10 + random(50)}.${random(9999999)}Z`,
          operationName: pick(vaultOperations),
          resultSignature: pick([
            "OK",
            "Forbidden",
            "Unauthorized",
            "NotFound",
          ]),
          identity:
            random(3) === 0
              ? {}
              : { claim: { [UPN_CLAIM]: "alice@contoso.com" } },
          properties: {
            httpStatusCode: status,
            id: "https://x.vault.azure.net/secrets/s",
          },
        });
      },
      (): JSONObject => {
        const base: (overrides?: JSONObject) => JSONObject = pick([
          storageRecord,
          anonymousStorageRecord,
          sasStorageRecord,
          accountKeyStorageRecord,
        ]);

        return base({
          category: pick(["StorageRead", "StorageWrite", "StorageDelete"]),
          operationName: pick([
            "GetBlob",
            "PutBlob",
            "DeleteBlob",
            "SetContainerACL",
            "DeleteContainer",
            "BlobPreflightRequest",
            "ListBlobs",
          ]),
          statusCode: random(5) === 0 ? String(pick(statuses)) : pick(statuses),
          statusText: pick([
            "Success",
            "AnonymousSuccess",
            "SASSuccess",
            "AuthorizationFailure",
            "PublicAccessNotPermitted",
            "BlobNotFound",
          ]),
          correlationId: `aaaa0000-bb11-2222-33cc-${String(random(999999999)).padStart(12, "0")}`,
          uri: pick([
            "https://contosodata.blob.core.windows.net/public/a.pdf",
            "https://contosodata.z13.web.core.windows.net/index.html",
          ]),
        });
      },
      (): JSONObject => {
        return sqlAuditRecord(
          {},
          {
            action_id: pick([
              "LGIS",
              "LGIF",
              "DBAS",
              "DBAF",
              "BCM",
              "G",
              "SL",
              "CR",
            ]),
            action_name: pick([
              "LOGIN SUCCEEDED",
              "LOGIN FAILED",
              "DATABASE AUTHENTICATION SUCCEEDED",
              "DATABASE AUTHENTICATION FAILED",
              "BATCH COMPLETED",
              "GRANT",
              "SELECT",
              "CREATE",
              "CHANGE PASSWORD",
            ]),
            succeeded: pick(["true", "false"]),
            class_type: pick(["LX", "SL", "US", "U", "DB"]),
            target_database_principal_name: pick(["", "app_reader"]),
            additional_information: pick([
              "<action_info><pooled_connection>1</pooled_connection></action_info>",
              "<action_info><pooled_connection>0</pooled_connection></action_info>",
              "",
            ]),
            sequence_group_id: `0AB33370-A776-485A-AD98-${String(random(999999999)).padStart(12, "0")}`,
          },
        );
      },
    ];
    let held: number = 0;

    for (let index: number = 0; index < 3000; index++) {
      const count: number = 1 + random(4);
      const batch: Array<JSONObject> = [];

      for (let item: number = 0; item < count; item++) {
        batch.push(pick(records)());
      }

      const value: JSONObject = count === 1 ? batch[0]! : { records: batch };
      const text: string =
        random(2) === 0
          ? JSON.stringify(value)
          : JSON.stringify(value, null, 1);
      const events: Array<NormalizedSecurityEvent> = parse(text);

      if (events.length > 0) {
        held++;
        expect([text, matchesSecurityLogPrefilter(text)]).toEqual([text, true]);
      }
    }

    expect(held).toBeGreaterThan(500);
  });

  test("the format's example line is a secret read the parsers make one event of", () => {
    const example: string = getSecurityLogFormatDefinition(
      SecurityLogFormat.AzureResourceLogs,
    )!.example;
    const event: NormalizedSecurityEvent = only(example);

    expect([event.activityName, event.productName]).toEqual([
      "SecretGet",
      AZURE_KEY_VAULT_PRODUCT_NAME,
    ]);
    expect(matchesSecurityLogPrefilter(example)).toBe(true);
  });

  test("reading a long line takes time in line with it", () => {
    const line: string = `{"records":[${Array.from({ length: 400 }, () => {
      return JSON.stringify(anonymousStorageRecord());
    }).join(",")}]}`;
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return AzureResourceLogParser.parse(logLine(line)).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});
