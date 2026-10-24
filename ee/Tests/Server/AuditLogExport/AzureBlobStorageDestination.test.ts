import { describe, expect, test } from "@jest/globals";
import AzureBlobStorageDestination, {
  AZURE_BLOB_API_VERSION,
  getAzureBlobHost,
  getAzureBlobPath,
  signAzureSharedKey,
} from "../../../Server/AuditLogExport/Destinations/AzureBlobStorageDestination";
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
  ACCOUNT_KEY,
  ACCOUNT_NAME,
  createFakeAzureBlobStorage,
  FakeAzure,
} from "./Fakes/FakeAzureBlobStorage";

/*
 * Azure Blob Storage, against a faithful fake of Put Blob that verifies a
 * Shared Key signature by the documented string-to-sign, and a SAS token's
 * expiry and permissions (Fakes/FakeAzureBlobStorage).
 */

const records: Array<AuditLogExportRecord> = [
  auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
  auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
];

const IN_A_YEAR: Date = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

const withSas: (
  sasToken: string,
  config?: Record<string, unknown>,
) => AuditLogExportSettings = (
  sasToken: string,
  config: Record<string, unknown> = {},
): AuditLogExportSettings => {
  return settingsOf({
    type: AuditLogExportDestinationType.AzureBlobStorage,
    config: {
      accountName: ACCOUNT_NAME,
      container: "audit-logs",
      ...config,
    } as never,
    secrets: { sasToken },
  });
};

const withAccessKey: (accountKey?: string) => AuditLogExportSettings = (
  accountKey: string = ACCOUNT_KEY,
): AuditLogExportSettings => {
  return settingsOf({
    type: AuditLogExportDestinationType.AzureBlobStorage,
    config: {
      accountName: ACCOUNT_NAME,
      container: "audit-logs",
      authentication: "access-key",
    },
    secrets: { accountKey },
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

describe("Azure Blob Storage with a SAS token", () => {
  test("puts one block blob per batch, as gzip NDJSON", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });
    const token: string = azure.issueSasToken({
      permissions: "cw",
      expiresAt: IN_A_YEAR,
    });

    const receipt: { location: string } = await new AzureBlobStorageDestination(
      {
        transport: azure.transport,
      },
    ).deliver(
      deliveryOf({ settings: withSas(token), batch: batchOf(records) }),
    );

    const name: string = `oneuptime/audit-logs/2026/10/24/09/20261024T091503Z_${records[0]!.id}.ndjson.gz`;

    expect(receipt.location).toBe(
      `https://${ACCOUNT_NAME}.blob.core.windows.net/audit-logs/${name}`,
    );
    expect(azure.blobs.get(`audit-logs/${name}`)!.contentType).toBe(
      "application/gzip",
    );
    expect(azure.readBlob("audit-logs", name)).toHaveLength(2);
  });

  test("a token pasted with its leading ? works as well", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });
    const token: string = azure.issueSasToken({
      permissions: "racw",
      expiresAt: IN_A_YEAR,
    });

    await new AzureBlobStorageDestination({
      transport: azure.transport,
    }).deliver(
      deliveryOf({ settings: withSas(`?${token}`), batch: batchOf(records) }),
    );

    expect(azure.blobs.size).toBe(1);
  });

  test("an expired token says to create a new one", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });
    const token: string = azure.issueSasToken({
      permissions: "cw",
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new AzureBlobStorageDestination({
        transport: azure.transport,
      }).deliver(
        deliveryOf({ settings: withSas(token), batch: batchOf(records) }),
      );
    });

    expect(error.message).toBe(
      "Azure refused the SAS token (HTTP 403, AuthenticationFailed). It may have expired, or belong to another storage account. Create a new one for the container.",
    );
    expect(error.retryable).toBe(false);
    // The token is never in the message.
    expect(error.message).not.toContain("sig=");
  });

  test("a read-only token is told which permissions to add", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });
    const token: string = azure.issueSasToken({
      permissions: "rl",
      expiresAt: IN_A_YEAR,
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new AzureBlobStorageDestination({
        transport: azure.transport,
      }).deliver(
        deliveryOf({ settings: withSas(token), batch: batchOf(records) }),
      );
    });

    expect(error.message).toBe(
      "The SAS token may not write blobs in the container audit-logs (HTTP 403, AuthorizationPermissionMismatch). Give it Create and Write permission on blobs in the container.",
    );
  });

  test("a container that does not exist says so", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({ containers: [] });
    const token: string = azure.issueSasToken({
      permissions: "cw",
      expiresAt: IN_A_YEAR,
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new AzureBlobStorageDestination({
        transport: azure.transport,
      }).deliver(
        deliveryOf({ settings: withSas(token), batch: batchOf(records) }),
      );
    });

    expect(error.message).toBe(
      `The container audit-logs does not exist in the storage account ${ACCOUNT_NAME} (HTTP 404, ContainerNotFound). Create it, or check the container name.`,
    );
  });

  test("a storage account that does not exist cannot be reached, and says what to check", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });
    const token: string = azure.issueSasToken({
      permissions: "cw",
      expiresAt: IN_A_YEAR,
    });

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new AzureBlobStorageDestination({
        transport: azure.transport,
      }).deliver(
        deliveryOf({
          settings: withSas(token, { accountName: "acmetypo" }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toBe(
      "Could not reach Azure Blob Storage at acmetypo.blob.core.windows.net: getaddrinfo ENOTFOUND acmetypo.blob.core.windows.net. Check the storage account name and the cloud. It is retried automatically.",
    );
    expect(error.retryable).toBe(true);
  });

  test("the service being busy is worth trying again", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });
    azure.failNext(503, "ServerBusy");

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new AzureBlobStorageDestination({
        transport: azure.transport,
      }).deliver(
        deliveryOf({
          settings: withSas(
            azure.issueSasToken({ permissions: "cw", expiresAt: IN_A_YEAR }),
          ),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.retryable).toBe(true);
    expect(error.message).toBe(
      "Azure Blob Storage is busy (HTTP 503, ServerBusy). It is retried automatically.",
    );
  });
});

describe("Azure Blob Storage with an access key", () => {
  test("signs each request with Shared Key, which the service verifies", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });

    await new AzureBlobStorageDestination({
      transport: azure.transport,
    }).deliver(
      deliveryOf({ settings: withAccessKey(), batch: batchOf(records) }),
    );

    expect(azure.blobs.size).toBe(1);

    const headers: Record<string, string> = azure.requests[0]!
      .headers as Record<string, string>;

    expect(
      headers["Authorization"]!.startsWith(`SharedKey ${ACCOUNT_NAME}:`),
    ).toBe(true);
    expect(headers["x-ms-version"]).toBe(AZURE_BLOB_API_VERSION);
    expect(headers["x-ms-blob-type"]).toBe("BlockBlob");
    // No SAS in the address.
    expect(new URL(azure.requests[0]!.url).search).toBe("");
  });

  test("another account's key is refused, without the key in the message", async () => {
    const azure: FakeAzure = createFakeAzureBlobStorage({
      containers: ["audit-logs"],
    });
    const otherKey: string = Buffer.alloc(64, 7).toString("base64");

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new AzureBlobStorageDestination({
        transport: azure.transport,
      }).deliver(
        deliveryOf({
          settings: withAccessKey(otherKey),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toBe(
      `Azure refused the access key (HTTP 403, AuthenticationFailed). Check that it is a current key of the storage account ${ACCOUNT_NAME}.`,
    );
    expect(error.message).not.toContain(otherKey);
  });

  test("the string to sign is Azure's documented form", () => {
    const signed: { stringToSign: string; authorization: string } =
      signAzureSharedKey({
        method: "PUT",
        accountName: "myaccount",
        accountKey: Buffer.from("key").toString("base64"),
        path: "/mycontainer/a%20b/c.ndjson.gz",
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": "120",
          "x-ms-version": "2021-12-02",
          "x-ms-date": "Fri, 24 Oct 2026 09:15:03 GMT",
          "x-ms-blob-type": "BlockBlob",
        },
      });

    expect(signed.stringToSign).toBe(
      [
        "PUT",
        "",
        "",
        "120",
        "",
        "application/gzip",
        "",
        "",
        "",
        "",
        "",
        "",
        "x-ms-blob-type:BlockBlob\nx-ms-date:Fri, 24 Oct 2026 09:15:03 GMT\nx-ms-version:2021-12-02\n/myaccount/mycontainer/a%20b/c.ndjson.gz",
      ].join("\n"),
    );
    expect(signed.authorization.startsWith("SharedKey myaccount:")).toBe(true);
  });

  test("an empty body's length is signed as empty, as Azure wants since 2015", () => {
    expect(
      signAzureSharedKey({
        method: "PUT",
        accountName: "a",
        accountKey: "a2V5",
        path: "/c/b",
        headers: { "Content-Length": "0" },
      }).stringToSign.split("\n")[3],
    ).toBe("");
  });
});

describe("addresses", () => {
  test("each Azure cloud has its own host suffix", () => {
    expect(getAzureBlobHost({ accountName: "acme", cloud: "public" })).toBe(
      "acme.blob.core.windows.net",
    );
    expect(getAzureBlobHost({ accountName: "acme", cloud: "usgov" })).toBe(
      "acme.blob.core.usgovcloudapi.net",
    );
    expect(getAzureBlobHost({ accountName: "acme", cloud: "china" })).toBe(
      "acme.blob.core.chinacloudapi.cn",
    );
    expect(getAzureBlobHost({ accountName: "acme", cloud: "" })).toBe(
      "acme.blob.core.windows.net",
    );
  });

  test("each part of the blob's path is encoded", () => {
    expect(
      getAzureBlobPath({ container: "logs", blobName: "a b/c#d.ndjson.gz" }),
    ).toBe("/logs/a%20b/c%23d.ndjson.gz");
  });
});
