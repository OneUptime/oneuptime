import { describe, expect, test } from "@jest/globals";
import GoogleCloudStorageDestination, {
  describeGoogleCloudStorageFailure,
  getGoogleCloudStorageUploadUrl,
} from "../../../Server/AuditLogExport/Destinations/GoogleCloudStorageDestination";
import { AuditLogExportDeliveryError } from "../../../Server/AuditLogExport/Destinations/Types";
import { AuditLogExportSettings } from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import { AuditLogExportRecord } from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import {
  auditLogRecord,
  batchOf,
  deliveryOf,
  settingsOf,
} from "./AuditLogExportTestData";
import {
  createFakeGoogleCloudStorage,
  FakeGcs,
  OTHER_SERVICE_ACCOUNT_JSON,
  SERVICE_ACCOUNT_EMAIL,
  SERVICE_ACCOUNT_JSON,
} from "./Fakes/FakeGoogleCloudStorage";

/*
 * Google Cloud Storage, against a faithful fake of its JSON API and of
 * Google's token endpoint, which verifies the service account's signed
 * assertion with the account's public key (Fakes/FakeGoogleCloudStorage).
 */

const settings: (
  config?: Record<string, unknown>,
  serviceAccountJson?: string,
) => AuditLogExportSettings = (
  config: Record<string, unknown> = {},
  serviceAccountJson: string = SERVICE_ACCOUNT_JSON,
): AuditLogExportSettings => {
  return settingsOf({
    type: AuditLogExportDestinationType.GoogleCloudStorage,
    config: { bucket: "acme-audit-logs", ...config } as never,
    secrets: { serviceAccountJson },
  });
};

const records: Array<AuditLogExportRecord> = [
  auditLogRecord({ createdAt: "2026-10-24T23:59:59.000Z" }),
  auditLogRecord({ createdAt: "2026-10-25T00:00:01.000Z" }),
];

const fakeStorage: () => FakeGcs = (): FakeGcs => {
  return createFakeGoogleCloudStorage({
    buckets: {
      "acme-audit-logs": { creators: [SERVICE_ACCOUNT_EMAIL] },
      "acme-locked": { creators: [] },
    },
  });
};

const failureOf: (
  run: () => Promise<unknown>,
) => Promise<AuditLogExportDeliveryError> = async (
  run: () => Promise<unknown>,
): Promise<AuditLogExportDeliveryError> => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AuditLogExportDeliveryError);
    return error as AuditLogExportDeliveryError;
  }

  throw new Error("Expected the delivery to fail.");
};

describe("Google Cloud Storage", () => {
  test("signs in as the service account and uploads one gzip NDJSON file per batch", async () => {
    const storage: FakeGcs = fakeStorage();
    const destination: GoogleCloudStorageDestination =
      new GoogleCloudStorageDestination({ transport: storage.transport });

    const receipt: { location: string } = await destination.deliver(
      deliveryOf({ settings: settings(), batch: batchOf(records) }),
    );

    // Filed by the FIRST entry's hour, even though the batch runs past midnight.
    const name: string = `oneuptime/audit-logs/2026/10/24/23/20261024T235959Z_${records[0]!.id}.ndjson.gz`;

    expect(receipt.location).toBe(`gs://acme-audit-logs/${name}`);
    expect(storage.tokenRequests).toBe(1);
    expect(storage.objects.get(`acme-audit-logs/${name}`)!.contentType).toBe(
      "application/gzip",
    );
    expect(storage.readObject("acme-audit-logs", name)).toEqual(
      records.map((record: AuditLogExportRecord): unknown => {
        return JSON.parse(JSON.stringify(record));
      }),
    );
  });

  test("keeps its token between batches rather than signing in for each", async () => {
    const storage: FakeGcs = fakeStorage();
    const destination: GoogleCloudStorageDestination =
      new GoogleCloudStorageDestination({ transport: storage.transport });

    for (const record of records) {
      await destination.deliver(
        deliveryOf({ settings: settings(), batch: batchOf([record]) }),
      );
    }

    expect(storage.tokenRequests).toBe(1);
    expect(storage.objects.size).toBe(2);
  });

  test("a token Google stopped taking is dropped: the next batch signs in anew", async () => {
    const storage: FakeGcs = fakeStorage();
    const destination: GoogleCloudStorageDestination =
      new GoogleCloudStorageDestination({ transport: storage.transport });

    await destination.deliver(
      deliveryOf({ settings: settings(), batch: batchOf([records[0]!]) }),
    );
    storage.revokeAllTokens();

    const refused: AuditLogExportDeliveryError = await failureOf(() => {
      return destination.deliver(
        deliveryOf({ settings: settings(), batch: batchOf([records[1]!]) }),
      );
    });
    expect(refused.status).toBe(401);

    await destination.deliver(
      deliveryOf({ settings: settings(), batch: batchOf([records[1]!]) }),
    );
    expect(storage.tokenRequests).toBe(2);
    expect(storage.objects.size).toBe(2);
  });

  test("the object name is passed encoded, folder and all", () => {
    expect(
      getGoogleCloudStorageUploadUrl({
        bucket: "acme",
        objectName: "compliance/2026 archive/a.ndjson.gz",
      }),
    ).toBe(
      "https://storage.googleapis.com/upload/storage/v1/b/acme/o?uploadType=media&name=compliance%2F2026%20archive%2Fa.ndjson.gz",
    );
  });

  test("an account the bucket does not let create objects is told which role to give", async () => {
    const storage: FakeGcs = fakeStorage();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new GoogleCloudStorageDestination({
        transport: storage.transport,
      }).deliver(
        deliveryOf({
          settings: settings({ bucket: "acme-locked" }),
          batch: batchOf(records),
        }),
      );
    });

    expect(
      error.message.startsWith(
        `The service account ${SERVICE_ACCOUNT_EMAIL} may not create files in the bucket acme-locked (HTTP 403). Give it the Storage Object Creator role on the bucket.`,
      ),
    ).toBe(true);
    expect(error.retryable).toBe(false);
  });

  test("a bucket that does not exist says so", async () => {
    const storage: FakeGcs = fakeStorage();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new GoogleCloudStorageDestination({
        transport: storage.transport,
      }).deliver(
        deliveryOf({
          settings: settings({ bucket: "acme-gone" }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toContain(
      "The bucket acme-gone does not exist (HTTP 404). Check the bucket name.",
    );
  });

  test("a key Google does not take is refused at sign-in, never retried, and never echoed", async () => {
    const storage: FakeGcs = fakeStorage();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new GoogleCloudStorageDestination({
        transport: storage.transport,
      }).deliver(
        deliveryOf({
          settings: settings({}, OTHER_SERVICE_ACCOUNT_JSON),
          batch: batchOf(records),
        }),
      );
    });

    expect(
      error.message.startsWith("Google refused the service account key:"),
    ).toBe(true);
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain("PRIVATE KEY");
    expect(storage.uploads).toHaveLength(0);
  });

  test("Cloud Storage failing is worth trying again", async () => {
    const storage: FakeGcs = fakeStorage();
    storage.failNextUpload(503);

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new GoogleCloudStorageDestination({
        transport: storage.transport,
      }).deliver(deliveryOf({ settings: settings(), batch: batchOf(records) }));
    });

    expect(error.message).toBe(
      "Google Cloud Storage is busy (HTTP 503). It is retried automatically.",
    );
    expect(error.retryable).toBe(true);
  });

  test("the message carries Google's own words when it gives them", () => {
    expect(
      describeGoogleCloudStorageFailure({
        answer: {
          ok: false,
          status: 400,
          bodyText: "",
          bodyJson: { error: { message: "Invalid bucket name." } },
        },
        bucket: "acme",
        clientEmail: SERVICE_ACCOUNT_EMAIL,
      }),
    ).toBe(
      "Google Cloud Storage did not accept the file (HTTP 400). Google said: Invalid bucket name.",
    );
  });
});
