import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import { Readable } from "stream";
import AzureBackupStorage, {
  AZURE_MAX_BLOCKS,
  describeAzureBackupFailure,
  getAzureBlockId,
} from "../../../Server/Backup/Storage/AzureBackupStorage";
import { BackupHttpRequest } from "../../../Server/Backup/Storage/BackupHttp";
import {
  BackupListing,
  BackupStorageError,
  BackupUploadResult,
  deleteBackupPrefix,
} from "../../../Server/Backup/Storage/BackupStorage";
import { BackupDestinationSettings } from "Common/Server/Utils/Backup/BackupSettings";
import { AuditLogExportAzureAuthentication } from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import { BackupProvider } from "Common/Types/Backup/BackupDestinationCatalog";
import {
  createFakeBackupAzure,
  FAKE_AZURE_ACCOUNT,
  FAKE_AZURE_ACCOUNT_KEY,
  FakeBackupAzure,
} from "./Fakes/FakeBackupAzure";

/*
 * Backups on Azure Blob Storage, as block blobs, against a faithful fake of
 * the Blob service (Fakes/FakeBackupAzure) that verifies each Shared Key
 * signature - query included - and each SAS token's permissions with its
 * own code: a small file in one Put Blob, a large one as equal blocks a
 * block list commits (nothing visible before it does), read back, listed
 * page by page, deleted; refusals in sentences that say what to change.
 */

const MIB: number = 1024 * 1024;
const CONTAINER: string = "oneuptime-backups";

function settingsWithKey(): BackupDestinationSettings {
  return {
    type: BackupDestinationType.AzureBlobStorage,
    provider: BackupProvider.AzureBlobStorage,
    config: {
      accountName: FAKE_AZURE_ACCOUNT,
      container: CONTAINER,
      authentication: AuditLogExportAzureAuthentication.AccessKey,
    },
    secrets: { accountKey: FAKE_AZURE_ACCOUNT_KEY },
  };
}

function settingsWithSas(token: string): BackupDestinationSettings {
  return {
    type: BackupDestinationType.AzureBlobStorage,
    provider: BackupProvider.AzureBlobStorage,
    config: {
      accountName: FAKE_AZURE_ACCOUNT,
      container: CONTAINER,
      authentication: AuditLogExportAzureAuthentication.SasToken,
    },
    secrets: { sasToken: `?${token}` },
  };
}

function storageFor(
  settings: BackupDestinationSettings,
  fake: FakeBackupAzure,
): AzureBackupStorage {
  return new AzureBackupStorage({ settings, transport: fake.transport });
}

function bytes(length: number): Buffer {
  const buffer: Buffer = Buffer.alloc(length);

  for (let index: number = 0; index < length; index++) {
    buffer[index] = (index * 13 + 5) % 256;
  }

  return buffer;
}

async function refusal(
  run: () => Promise<unknown>,
): Promise<BackupStorageError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(BackupStorageError);
    return error as BackupStorageError;
  }

  throw new Error("Expected the storage to refuse.");
}

const FULL_ACCESS: string = "racwdl";
const IN_A_YEAR: Date = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

describe("AzureBackupStorage", () => {
  test.each([
    [
      "an access key",
      (fake: FakeBackupAzure): BackupDestinationSettings => {
        void fake;
        return settingsWithKey();
      },
    ],
    [
      "a SAS token for the container",
      (fake: FakeBackupAzure): BackupDestinationSettings => {
        return settingsWithSas(
          fake.issueSasToken({
            permissions: FULL_ACCESS,
            expiresAt: IN_A_YEAR,
          }),
        );
      },
    ],
  ])(
    "with %s: writes, reads, looks up, lists and deletes",
    async (
      _with: string,
      settingsOf: (fake: FakeBackupAzure) => BackupDestinationSettings,
    ) => {
      const fake: FakeBackupAzure = createFakeBackupAzure({
        containers: [CONTAINER],
      });
      const storage: AzureBackupStorage = storageFor(settingsOf(fake), fake);

      await storage.putObject({
        key: "oneuptime/backups/b/manifest.json",
        body: Buffer.from("{}"),
        contentType: "application/json",
      });

      expect(
        (
          await storage.readSmallObject(
            "oneuptime/backups/b/manifest.json",
            1024,
          )
        )?.toString(),
      ).toBe("{}");
      expect(
        await storage.headObject("oneuptime/backups/b/manifest.json"),
      ).toEqual(expect.objectContaining({ sizeInBytes: 2 }));
      expect(
        (await storage.list({ prefix: "oneuptime/backups/" })).objects.map(
          (object: { key: string }): string => {
            return object.key;
          },
        ),
      ).toEqual(["oneuptime/backups/b/manifest.json"]);

      await storage.deleteObject("oneuptime/backups/b/manifest.json");

      expect(fake.blobNames(CONTAINER)).toEqual([]);
      expect(
        await storage.headObject("oneuptime/backups/b/manifest.json"),
      ).toBeNull();
    },
  );

  test("a large file goes up as equal blocks a block list commits; nothing is visible before it does", async () => {
    const fake: FakeBackupAzure = createFakeBackupAzure({
      containers: [CONTAINER],
    });
    const storage: AzureBackupStorage = storageFor(settingsWithKey(), fake);
    const data: Buffer = bytes(35 * MIB);
    let visibleEarly: boolean = false;
    const transport: typeof fake.transport = fake.transport;

    (storage as unknown as { transport: typeof fake.transport }).transport =
      async (request: BackupHttpRequest) => {
        if (new URL(request.url).searchParams.get("comp") === "blocklist") {
          visibleEarly = fake.blobs.has(
            `${CONTAINER}/oneuptime/backups/b/postgres.dump`,
          );
        }

        return await transport(request);
      };

    const result: BackupUploadResult = await storage.upload({
      key: "oneuptime/backups/b/postgres.dump",
      source: Readable.from([data]),
      contentType: "application/octet-stream",
    });

    expect(result).toEqual({
      sizeInBytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
    expect(visibleEarly).toBe(false);
    expect(
      fake.blobs
        .get(`${CONTAINER}/oneuptime/backups/b/postgres.dump`)!
        .body.equals(data),
    ).toBe(true);
    expect(
      fake.blobs.get(`${CONTAINER}/oneuptime/backups/b/postgres.dump`)!
        .contentType,
    ).toBe("application/octet-stream");
    expect(
      fake.requests
        .filter((request: { operation: string }): boolean => {
          return request.operation === "PutBlock";
        })
        .map((request: { bodyLength: number }): number => {
          return request.bodyLength;
        }),
    ).toEqual([16 * MIB, 16 * MIB, 3 * MIB]);
  });

  test("an upload whose stream fails commits nothing", async () => {
    const fake: FakeBackupAzure = createFakeBackupAzure({
      containers: [CONTAINER],
    });
    let sent: number = 0;
    const source: Readable = new Readable({
      read(): void {
        if (sent >= 20 * MIB) {
          this.destroy(
            new Error("pg_dump failed: server closed the connection."),
          );
          return;
        }

        sent += MIB;
        this.push(bytes(MIB));
      },
    });

    await expect(
      storageFor(settingsWithKey(), fake).upload({
        key: "oneuptime/backups/b/postgres.dump",
        source,
        contentType: "application/octet-stream",
      }),
    ).rejects.toThrow("pg_dump failed");

    expect(fake.blobNames(CONTAINER)).toEqual([]);
  });

  test("block ids are all one length, as Azure requires, and name their part", () => {
    expect(getAzureBlockId(1).length).toBe(getAzureBlockId(49999).length);
    expect(Buffer.from(getAzureBlockId(7), "base64").toString()).toBe(
      "oneuptime-block-000007",
    );
    expect(AZURE_MAX_BLOCKS).toBe(50000);
  });

  test("lists every page, and the folders under a delimiter", async () => {
    const fake: FakeBackupAzure = createFakeBackupAzure({
      containers: [CONTAINER],
    });
    const storage: AzureBackupStorage = storageFor(settingsWithKey(), fake);

    for (const key of [
      "p/20261020T020000Z-a/manifest.json",
      "p/20261021T020000Z-b/manifest.json",
      "p/20261021T020000Z-b/postgres.dump",
      "p/20261022T020000Z-c/manifest.json",
      "p/readme.txt",
    ]) {
      await storage.putObject({
        key,
        body: Buffer.from("x"),
        contentType: "x",
      });
    }

    expect((await storage.list({ prefix: "p/" })).objects).toHaveLength(5);

    const folders: BackupListing = await storage.list({
      prefix: "p/",
      delimiter: "/",
    });

    expect(folders.prefixes).toEqual([
      "p/20261020T020000Z-a/",
      "p/20261021T020000Z-b/",
      "p/20261022T020000Z-c/",
    ]);
    expect(
      await deleteBackupPrefix({ storage, prefix: "p/20261021T020000Z-b/" }),
    ).toBe(2);
    expect(fake.blobNames(CONTAINER)).toHaveLength(3);
  });

  describe("what a refusal says", () => {
    test("an access key that is not the account's", async () => {
      const fake: FakeBackupAzure = createFakeBackupAzure({
        containers: [CONTAINER],
      });
      const wrong: BackupDestinationSettings = settingsWithKey();
      wrong.secrets = { accountKey: Buffer.alloc(64, 1).toString("base64") };

      expect(
        (
          await refusal(() => {
            return storageFor(wrong, fake).putObject({
              key: "x",
              body: Buffer.from("x"),
              contentType: "x",
            });
          })
        ).message,
      ).toBe(
        `Azure refused the access key (HTTP 403, AuthenticationFailed). Check that it is a current key of the storage account ${FAKE_AZURE_ACCOUNT}.`,
      );
    });

    test("a SAS token that expired", async () => {
      const fake: FakeBackupAzure = createFakeBackupAzure({
        containers: [CONTAINER],
      });
      const token: string = fake.issueSasToken({
        permissions: FULL_ACCESS,
        expiresAt: new Date(Date.now() - 1000),
      });

      expect(
        (
          await refusal(() => {
            return storageFor(settingsWithSas(token), fake).putObject({
              key: "x",
              body: Buffer.from("x"),
              contentType: "x",
            });
          })
        ).message,
      ).toBe(
        "Azure refused the SAS token (HTTP 403, AuthenticationFailed). It may have expired, or belong to another storage account. Create a new one for the container.",
      );
    });

    test("a SAS token without Delete: says which permissions a backup needs", async () => {
      const fake: FakeBackupAzure = createFakeBackupAzure({
        containers: [CONTAINER],
      });
      const token: string = fake.issueSasToken({
        permissions: "racwl",
        expiresAt: IN_A_YEAR,
      });
      const storage: AzureBackupStorage = storageFor(
        settingsWithSas(token),
        fake,
      );

      await storage.putObject({
        key: "x",
        body: Buffer.from("x"),
        contentType: "x",
      });

      expect(
        (
          await refusal(() => {
            return storage.deleteObject("x");
          })
        ).message,
      ).toBe(
        `The SAS token may not delete blobs in the container ${CONTAINER} (HTTP 403, AuthorizationPermissionMismatch). Give it Read, Add, Create, Write, Delete and List on the container.`,
      );
    });

    test("a container that does not exist", async () => {
      const fake: FakeBackupAzure = createFakeBackupAzure({
        containers: ["other"],
      });

      expect(
        (
          await refusal(() => {
            return storageFor(settingsWithKey(), fake).putObject({
              key: "x",
              body: Buffer.from("x"),
              contentType: "x",
            });
          })
        ).message,
      ).toBe(
        `The container ${CONTAINER} does not exist in the storage account ${FAKE_AZURE_ACCOUNT} (HTTP 404, ContainerNotFound). Create it, or check the container name.`,
      );
    });

    test("never holds the SAS token or the key", () => {
      const fake: FakeBackupAzure = createFakeBackupAzure({
        containers: [CONTAINER],
      });
      const token: string = fake.issueSasToken({
        permissions: FULL_ACCESS,
        expiresAt: IN_A_YEAR,
      });
      const storage: AzureBackupStorage = storageFor(
        settingsWithSas(token),
        fake,
      );
      const redacted: string = (
        storage as unknown as { redact: (text: string) => string }
      ).redact(`failed with ${token} in it`);

      expect(redacted).toBe("failed with [REDACTED] in it");
      expect(
        describeAzureBackupFailure({
          status: 500,
          bodyText: "<Error><Code>ServerBusy</Code></Error>",
          accountName: FAKE_AZURE_ACCOUNT,
          container: CONTAINER,
          usesSasToken: true,
          operation: "write blobs",
        }),
      ).toBe(
        "Azure Blob Storage is busy (HTTP 500, ServerBusy). Try again later.",
      );
    });
  });

  test("an emulator's path-style address (Azurite) is signed with its account in the path", () => {
    const storage: AzureBackupStorage = new AzureBackupStorage({
      settings: settingsWithKey(),
      transport: async () => {
        throw new Error("not called");
      },
      blobEndpoint: "http://127.0.0.1:10000/devstoreaccount1",
    });

    expect(storage.getServiceUrl()).toBe(
      "http://127.0.0.1:10000/devstoreaccount1",
    );
    expect(storage.describeKey("a/b")).toBe(
      `http://127.0.0.1:10000/devstoreaccount1/${CONTAINER}/a/b`,
    );
  });
});
