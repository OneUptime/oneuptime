import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import CloudAuditSecurityEvents from "../../../../Server/Utils/SecurityEvent/CloudAudit/CloudAuditSecurityEvents";
import {
  getObservableSearchValues,
  getRecordSecurityValues,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import AzureActivityLogParser, {
  readAzureActivityRecord,
} from "../../../../Utils/SecurityEvent/LogParsers/AzureActivityLogParser";
import CloudTrailLogParser from "../../../../Utils/SecurityEvent/LogParsers/CloudTrailLogParser";
import GoogleCloudAuditLogParser from "../../../../Utils/SecurityEvent/LogParsers/GoogleCloudAuditLogParser";
import {
  SecurityRecordReading,
  toNormalizedSecurityEvent,
} from "../../../../Utils/SecurityEvent/SecurityRecordReading";
import { logLine, cloudTrailRecord } from "./LogParserFixtures";
import {
  ACCOUNT,
  EC2_AUTHORIZE_INGRESS,
  GCP_BUCKET_IAM,
  GCP_SET_METADATA,
  LAMBDA_UPDATE_CODE,
  S3_PUT_BUCKET_POLICY,
  SUBSCRIPTION,
  azureContainerWrite,
  azureKeyVaultRoleAssignment,
} from "./CloudAuditResourceFixtures";

/*
 * A CLOUD'S AUDIT RECORDS REACH THE RESOURCES THEY ARE ABOUT (#9779).
 *
 * The three cloud audit parsers name the resources a record is about among
 * the event's observables, by the id each resource's Cloud Resource keeps -
 * whether the record came through a log pipeline ("Your logs") or a
 * connected account's own read (Cloud audit logs). A record's page searches
 * the observables for the spellings of its own ID
 * (getObservableSearchValues): these hold the two to one another, with the
 * near misses that must stay apart.
 */

function only(events: Array<NormalizedSecurityEvent>): NormalizedSecurityEvent {
  expect(events).toHaveLength(1);

  return events[0]!;
}

function cloudTrailEvent(record: JSONObject): NormalizedSecurityEvent {
  return only(CloudTrailLogParser.parse(logLine(JSON.stringify(record))));
}

function azureEvent(record: JSONObject): NormalizedSecurityEvent {
  return only(
    AzureActivityLogParser.parse(
      logLine(JSON.stringify({ records: [record] })),
    ),
  );
}

function googleEvent(entry: JSONObject): NormalizedSecurityEvent {
  return only(GoogleCloudAuditLogParser.parse(logLine(JSON.stringify(entry))));
}

// What a record's own page searches for, by its provider's ID as its row keeps it.
function searchedFor(providerResourceId: string): Array<string> {
  return getObservableSearchValues(
    getRecordSecurityValues({ names: [providerResourceId] }),
  );
}

function names(
  event: NormalizedSecurityEvent,
  providerResourceId: string,
): boolean {
  return searchedFor(providerResourceId).some((spelling: string): boolean => {
    return event.observables.includes(spelling);
  });
}

describe("each parser names what its record is about among the observables", () => {
  test("CloudTrail: the bucket made public, beside who made it public", () => {
    const event: NormalizedSecurityEvent =
      cloudTrailEvent(S3_PUT_BUCKET_POLICY);

    expect(event.observables).toEqual([
      `arn:aws:sts::${ACCOUNT}:assumed-role/Admin/alice`,
      ACCOUNT,
      "198.51.100.30",
      "arn:aws:s3:::acme-invoices",
    ]);
    // Its target and attributes are as they were: the rule library reads them.
    expect(event.targetResource).toBe("s3.amazonaws.com PutBucketPolicy");
    expect(event.attributes["requestParameters.bucketName"]).toBe(
      "acme-invoices",
    );
  });

  test("CloudTrail: an instance's security group opened to the internet", () => {
    expect(cloudTrailEvent(EC2_AUTHORIZE_INGRESS).observables).toContain(
      `arn:aws:ec2:us-east-1:${ACCOUNT}:security-group/sg-0123456789abcdef0`,
    );
  });

  test("the Azure Activity Log: the container and its storage account, in lower case, from the export", () => {
    const event: NormalizedSecurityEvent = azureEvent(azureContainerWrite());

    expect(event.observables).toEqual(
      expect.arrayContaining([
        `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.storage/storageaccounts/acmeinvoices/blobservices/default/containers/invoices`,
        `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.storage/storageaccounts/acmeinvoices`,
      ]),
    );
    // The resource stays its target, as Azure wrote it.
    expect(event.targetResource).toBe(
      azureContainerWrite()["resourceId"] as string,
    );
  });

  test("Google Cloud's audit logs: the VM by its full resource name", () => {
    expect(googleEvent(GCP_SET_METADATA).observables).toContain(
      "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-1",
    );
  });

  test("a sign-in is about no cloud resource", () => {
    const signIn: NormalizedSecurityEvent = cloudTrailEvent(
      cloudTrailRecord({
        eventSource: "signin.amazonaws.com",
        eventName: "ConsoleLogin",
        requestParameters: null,
        responseElements: { ConsoleLogin: "Failure" },
      }),
    );

    expect(
      signIn.observables.filter((value: string): boolean => {
        return value.startsWith("arn:aws:s3") || value.includes(":instance/");
      }),
    ).toEqual([]);
  });

  test("a reading a connection stores names them too", () => {
    const reading: SecurityRecordReading = readAzureActivityRecord(
      azureKeyVaultRoleAssignment(),
    )!;
    const event: NormalizedSecurityEvent = toNormalizedSecurityEvent({
      reading,
      vendorName: "Microsoft",
      productName: "Azure Activity Log",
      raw: azureKeyVaultRoleAssignment(),
    });

    expect(event.observables).toContain(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.keyvault/vaults/kv-payments`,
    );
  });
});

describe("a connected account's own read names them the same way (Cloud audit logs)", () => {
  test("CloudTrail's, the Activity Log's and Google Cloud's records, read from the account", () => {
    const now: Date = new Date("2026-11-18T10:05:00.000Z");
    const aws: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.AWS,
        records: [{ accountId: ACCOUNT, record: LAMBDA_UPDATE_CODE }],
        now,
      });
    const azure: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.Azure,
        records: [
          { accountId: SUBSCRIPTION, record: azureKeyVaultRoleAssignment() },
        ],
        now,
      });
    const google: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.GCP,
        records: [{ accountId: "acme-prod", record: GCP_BUCKET_IAM }],
        now,
      });

    expect(only(aws).observables).toContain(
      `arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler`,
    );
    expect(only(azure).observables).toContain(
      `/subscriptions/${SUBSCRIPTION}/resourcegroups/rg-prod/providers/microsoft.keyvault/vaults/kv-payments`,
    );
    expect(only(google).observables).toContain(
      "//storage.googleapis.com/projects/_/buckets/acme-invoices",
    );
  });
});

describe("a resource's own page finds them by its ID, exactly", () => {
  test("an AWS function by its ARN, in the case it was named in", () => {
    const event: NormalizedSecurityEvent = cloudTrailEvent(LAMBDA_UPDATE_CODE);

    expect(
      names(
        event,
        `arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler`,
      ),
    ).toBe(true);
    // Another function, whose name differs in case alone, is another resource.
    expect(
      names(
        event,
        `arn:aws:lambda:us-east-1:${ACCOUNT}:function:checkout-handler`,
      ),
    ).toBe(false);
    // So is one of the same name in another account or Region.
    expect(
      names(
        event,
        `arn:aws:lambda:us-east-1:444455556666:function:Checkout-Handler`,
      ),
    ).toBe(false);
    expect(
      names(
        event,
        `arn:aws:lambda:eu-west-1:${ACCOUNT}:function:Checkout-Handler`,
      ),
    ).toBe(false);
  });

  test("an AWS bucket, never one whose name starts the same", () => {
    const event: NormalizedSecurityEvent =
      cloudTrailEvent(S3_PUT_BUCKET_POLICY);

    expect(names(event, "arn:aws:s3:::acme-invoices")).toBe(true);
    expect(names(event, "arn:aws:s3:::acme-invoices-archive")).toBe(false);
    expect(names(event, "arn:aws:s3:::acme")).toBe(false);
  });

  test("an Azure storage account kept in Resource Manager's casing, from the export's capitals", () => {
    const event: NormalizedSecurityEvent = azureEvent(azureContainerWrite());

    expect(
      names(
        event,
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/acmeinvoices`,
      ),
    ).toBe(true);
    expect(
      names(
        event,
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/acmeinvoices2`,
      ),
    ).toBe(false);
  });

  test("a Key Vault, from the REST API's own casing of a role granted on it", () => {
    const event: NormalizedSecurityEvent = azureEvent(
      azureKeyVaultRoleAssignment(),
    );

    expect(
      names(
        event,
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/RG-PROD/providers/Microsoft.KeyVault/vaults/kv-payments`,
      ),
    ).toBe(true);
  });

  test("a Google Cloud VM, never another of a longer name", () => {
    const event: NormalizedSecurityEvent = googleEvent(GCP_SET_METADATA);

    expect(
      names(
        event,
        "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-1",
      ),
    ).toBe(true);
    expect(
      names(
        event,
        "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-10",
      ),
    ).toBe(false);
  });

  test("a resource is never searched for by its short name", () => {
    // A bucket's, a function's and a VM's bare names are no observable a record searches for.
    for (const id of [
      "arn:aws:s3:::acme-invoices",
      `arn:aws:lambda:us-east-1:${ACCOUNT}:function:Checkout-Handler`,
      "//compute.googleapis.com/projects/acme-prod/zones/us-central1-a/instances/web-1",
    ]) {
      expect(searchedFor(id)).toEqual([id]);
    }
  });
});
