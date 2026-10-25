import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import { Readable } from "stream";
import S3BackupStorage, {
  describeS3BackupFailure,
  readXmlBlocks,
  S3_MAX_PARTS,
} from "../../../Server/Backup/Storage/S3BackupStorage";
import {
  BackupDownload,
  BackupListing,
  BackupStorageError,
  BackupUploadResult,
  deleteBackupPrefix,
} from "../../../Server/Backup/Storage/BackupStorage";
import { BackupDestinationSettings } from "Common/Server/Utils/Backup/BackupSettings";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import { BackupProvider } from "Common/Types/Backup/BackupDestinationCatalog";
import {
  createFakeBackupS3,
  FakeBackupS3,
  FakeS3Operation,
} from "./Fakes/FakeBackupS3";

/*
 * Backups on Amazon S3, S3-compatible storage and Google Cloud Storage,
 * through the S3 API, against a faithful fake of it (Fakes/FakeBackupS3)
 * that checks every request's signature with its own code: a backup of any
 * size up as a multipart upload of equal parts (abandoned when it fails, so
 * no half-file stays), read back as a stream, listed page by page, deleted
 * - and every refusal turned into a sentence that says what to change,
 * without the secret.
 */

const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const MIB: number = 1024 * 1024;

const AMAZON: BackupDestinationSettings = {
  type: BackupDestinationType.AmazonS3,
  provider: BackupProvider.AmazonS3,
  config: {
    bucket: "acme-backups",
    region: "eu-west-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    folder: "prod/",
  },
  secrets: { secretAccessKey: SECRET },
};

const R2: BackupDestinationSettings = {
  type: BackupDestinationType.S3Compatible,
  provider: BackupProvider.CloudflareR2,
  config: {
    endpoint: "https://0123abcd.r2.cloudflarestorage.com",
    bucket: "oneuptime-backups",
    accessKeyId: "r2-key",
  },
  secrets: { secretAccessKey: SECRET },
};

const GCS: BackupDestinationSettings = {
  type: BackupDestinationType.GoogleCloudStorage,
  provider: BackupProvider.GoogleCloudStorage,
  config: { bucket: "acme_backups", accessKeyId: "GOOG1EHMACKEY" },
  secrets: { secretAccessKey: SECRET },
};

function fakeFor(
  options: {
    region?: string | undefined;
    bucket?: string | undefined;
    accessKeyId?: string | undefined;
    requireEqualParts?: boolean | undefined;
    maxKeysPerPage?: number | undefined;
    deniedOperations?: Array<FakeS3Operation> | undefined;
    allowedPrefixes?: Array<string> | undefined;
  } = {},
): FakeBackupS3 {
  return createFakeBackupS3({
    credentials: { [options.accessKeyId || "AKIAIOSFODNN7EXAMPLE"]: SECRET },
    buckets: {
      [options.bucket || "acme-backups"]: {
        region: options.region || "eu-west-1",
        deniedOperations: options.deniedOperations,
        allowedPrefixes: options.allowedPrefixes,
      },
    },
    requireEqualParts: options.requireEqualParts,
    maxKeysPerPage: options.maxKeysPerPage,
  });
}

function storageFor(
  settings: BackupDestinationSettings,
  fake: FakeBackupS3,
): S3BackupStorage {
  return new S3BackupStorage({ settings, transport: fake.transport });
}

function bytes(length: number): Buffer {
  const buffer: Buffer = Buffer.alloc(length);

  for (let index: number = 0; index < length; index++) {
    buffer[index] = (index * 7 + 3) % 256;
  }

  return buffer;
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Array<Buffer> = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  return Buffer.concat(chunks);
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

describe("S3BackupStorage", () => {
  describe("writing", () => {
    test("a small file is one signed PutObject, encrypted at rest on Amazon S3", async () => {
      const fake: FakeBackupS3 = fakeFor();

      await storageFor(AMAZON, fake).putObject({
        key: "prod/b/manifest.json",
        body: Buffer.from("{}"),
        contentType: "application/json",
      });

      expect(
        fake.object("acme-backups", "prod/b/manifest.json")?.body.toString(),
      ).toBe("{}");
      expect(fake.requests[0]!.url).toBe(
        "https://acme-backups.s3.eu-west-1.amazonaws.com/prod/b/manifest.json",
      );
      expect(fake.requests[0]!.headers["x-amz-server-side-encryption"]).toBe(
        "AES256",
      );
    });

    test("S3-compatible storage names the bucket in the path, signs for auto on Cloudflare R2, and asks for no encryption header it may refuse", async () => {
      const fake: FakeBackupS3 = createFakeBackupS3({
        credentials: { "r2-key": SECRET },
        buckets: { "oneuptime-backups": { region: "auto" } },
      });

      await storageFor(R2, fake).putObject({
        key: "oneuptime/backups/x/manifest.json",
        body: Buffer.from("{}"),
        contentType: "application/json",
      });

      expect(fake.requests[0]!.url).toBe(
        "https://0123abcd.r2.cloudflarestorage.com/oneuptime-backups/oneuptime/backups/x/manifest.json",
      );
      expect(
        fake.requests[0]!.headers["x-amz-server-side-encryption"],
      ).toBeUndefined();
      expect(fake.keys("oneuptime-backups")).toEqual([
        "oneuptime/backups/x/manifest.json",
      ]);
    });

    test("Google Cloud Storage goes through its XML API with the HMAC key", async () => {
      const fake: FakeBackupS3 = createFakeBackupS3({
        credentials: { GOOG1EHMACKEY: SECRET },
        buckets: { acme_backups: { region: "auto" } },
      });

      await storageFor(GCS, fake).putObject({
        key: "oneuptime/backups/x/manifest.json",
        body: Buffer.from("{}"),
        contentType: "application/json",
      });

      expect(new URL(fake.requests[0]!.url).host).toBe(
        "storage.googleapis.com",
      );
      expect(storageFor(GCS, fake).describeKey("a/b")).toBe(
        "gs://acme_backups/a/b",
      );
    });

    test("a large file goes up as a multipart upload of equal parts and a smaller last, and arrives whole", async () => {
      const fake: FakeBackupS3 = fakeFor({ requireEqualParts: true });
      const data: Buffer = bytes(40 * MIB + 12345);

      // In chunks of a mebibyte, as pg_dump's output arrives.
      const chunks: Array<Buffer> = [];

      for (let at: number = 0; at < data.length; at += MIB) {
        chunks.push(data.subarray(at, Math.min(data.length, at + MIB)));
      }

      const result: BackupUploadResult = await storageFor(AMAZON, fake).upload({
        key: "prod/b/postgres.dump",
        source: Readable.from(chunks),
        contentType: "application/octet-stream",
      });

      expect(result).toEqual({
        sizeInBytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
      expect(
        fake.object("acme-backups", "prod/b/postgres.dump")!.body.equals(data),
      ).toBe(true);
      expect(
        fake.requests
          .filter((request: { operation: string }): boolean => {
            return request.operation === "UploadPart";
          })
          .map((request: { bodyLength: number }): number => {
            return request.bodyLength;
          }),
      ).toEqual([16 * MIB, 16 * MIB, 8 * MIB + 12345]);
      expect(fake.uploads.size).toBe(0);
      expect(
        fake.requests.find((request: { operation: string }): boolean => {
          return request.operation === "CreateMultipartUpload";
        })!.headers["x-amz-server-side-encryption"],
      ).toBe("AES256");
    });

    test("a small file through upload() is a single PutObject, no multipart upload", async () => {
      const fake: FakeBackupS3 = fakeFor();

      await storageFor(AMAZON, fake).upload({
        key: "prod/b/postgres.dump",
        source: Readable.from([Buffer.from("PGDMP")]),
        contentType: "application/octet-stream",
      });

      expect(
        fake.requests.map((request: { operation: string }): string => {
          return request.operation;
        }),
      ).toEqual(["PutObject"]);
    });

    test("an upload whose part is refused is abandoned: no half-file, no parts left behind", async () => {
      const fake: FakeBackupS3 = fakeFor();
      fake.failNext({
        count: 1,
        status: 403,
        code: "AccessDenied",
        operation: "UploadPart",
      });

      const error: BackupStorageError = await refusal(() => {
        return storageFor(AMAZON, fake).upload({
          key: "prod/b/postgres.dump",
          source: Readable.from([bytes(20 * MIB)]),
          contentType: "application/octet-stream",
        });
      });

      expect(error.message).toBe(
        "Amazon S3 did not let this key write the backup (HTTP 403, AccessDenied). Allow it to read, write, list and delete objects in acme-backups/prod/.",
      );
      expect(error.retryable).toBe(false);
      expect(
        fake.object("acme-backups", "prod/b/postgres.dump"),
      ).toBeUndefined();
      expect(fake.uploads.size).toBe(0);
      expect(
        fake.requests.some((request: { operation: string }): boolean => {
          return request.operation === "AbortMultipartUpload";
        }),
      ).toBe(true);
    });

    test("an upload whose stream fails (pg_dump stopping) is abandoned too", async () => {
      const fake: FakeBackupS3 = fakeFor();
      let sent: number = 0;
      const source: Readable = new Readable({
        read(): void {
          if (sent >= 18 * MIB) {
            this.destroy(
              new Error(
                "pg_dump failed: canceling statement due to user request.",
              ),
            );
            return;
          }

          sent += MIB;
          this.push(bytes(MIB));
        },
      });

      await expect(
        storageFor(AMAZON, fake).upload({
          key: "prod/b/postgres.dump",
          source,
          contentType: "application/octet-stream",
        }),
      ).rejects.toThrow("pg_dump failed");

      expect(
        fake.object("acme-backups", "prod/b/postgres.dump"),
      ).toBeUndefined();
      expect(fake.uploads.size).toBe(0);
    });

    test("S3 answering 200 with an error to finish an upload is a failure, and the upload is abandoned", async () => {
      const fake: FakeBackupS3 = fakeFor();
      fake.failCompleteWithOkStatus("InternalError");

      const error: BackupStorageError = await refusal(() => {
        return storageFor(AMAZON, fake).upload({
          key: "prod/b/postgres.dump",
          source: Readable.from([bytes(17 * MIB)]),
          contentType: "application/octet-stream",
        });
      });

      expect(error.message).toBe(
        "Amazon S3 is busy (HTTP 500, InternalError). Try again later.",
      );
      expect(
        fake.object("acme-backups", "prod/b/postgres.dump"),
      ).toBeUndefined();
      expect(fake.uploads.size).toBe(0);
    });

    test("a storage that is busy for a moment is asked again", async () => {
      const fake: FakeBackupS3 = fakeFor();
      fake.failNext({ count: 1, status: 503, code: "SlowDown" });

      await storageFor(AMAZON, fake).putObject({
        key: "prod/b/manifest.json",
        body: Buffer.from("{}"),
        contentType: "application/json",
      });

      expect(fake.object("acme-backups", "prod/b/manifest.json")).toBeDefined();
      expect(fake.requests).toHaveLength(2);
    }, 15000);

    test("the part limit is S3's 10,000", () => {
      expect(S3_MAX_PARTS).toBe(10000);
    });
  });

  describe("reading", () => {
    test("a file comes back as a stream, at its size", async () => {
      const fake: FakeBackupS3 = fakeFor();
      const storage: S3BackupStorage = storageFor(AMAZON, fake);
      await storage.putObject({
        key: "prod/b/postgres.dump",
        body: bytes(5000),
        contentType: "x",
      });

      const download: BackupDownload = await storage.download(
        "prod/b/postgres.dump",
      );

      expect(download.sizeInBytes).toBe(5000);
      expect((await readStream(download.stream)).equals(bytes(5000))).toBe(
        true,
      );
    });

    test("a missing file is null for a small read and a lookup, and an error naming it for a download", async () => {
      const fake: FakeBackupS3 = fakeFor();
      const storage: S3BackupStorage = storageFor(AMAZON, fake);

      expect(
        await storage.readSmallObject("prod/x/manifest.json", 1024),
      ).toBeNull();
      expect(await storage.headObject("prod/x/manifest.json")).toBeNull();

      const error: BackupStorageError = await refusal(() => {
        return storage.download("prod/x/postgres.dump");
      });

      expect(error.status).toBe(404);
      expect(error.code).toBe("NoSuchKey");
    });

    test("a lookup says the size and when it was written", async () => {
      const fake: FakeBackupS3 = fakeFor();
      const storage: S3BackupStorage = storageFor(AMAZON, fake);
      await storage.putObject({
        key: "prod/b/postgres.dump",
        body: bytes(321),
        contentType: "x",
      });

      expect(await storage.headObject("prod/b/postgres.dump")).toEqual(
        expect.objectContaining({
          key: "prod/b/postgres.dump",
          sizeInBytes: 321,
        }),
      );
    });

    test("a small read refuses a file larger than it reads", async () => {
      const fake: FakeBackupS3 = fakeFor();
      const storage: S3BackupStorage = storageFor(AMAZON, fake);
      await storage.putObject({
        key: "prod/b/manifest.json",
        body: bytes(2048),
        contentType: "x",
      });

      await expect(
        storage.readSmallObject("prod/b/manifest.json", 1024),
      ).rejects.toThrow(
        "The file is larger than the 1024 bytes OneUptime reads of it.",
      );
    });
  });

  describe("listing", () => {
    test("reads every page, and the folders under a delimiter", async () => {
      const fake: FakeBackupS3 = fakeFor({ maxKeysPerPage: 2 });
      const storage: S3BackupStorage = storageFor(AMAZON, fake);

      for (const key of [
        "prod/20261020T020000Z-a/manifest.json",
        "prod/20261021T020000Z-b/manifest.json",
        "prod/20261022T020000Z-c/manifest.json",
        "prod/20261022T020000Z-c/postgres.dump",
        "prod/notes.txt",
        "other/x",
      ]) {
        await storage.putObject({
          key,
          body: Buffer.from("x"),
          contentType: "x",
        });
      }

      const all: BackupListing = await storage.list({ prefix: "prod/" });

      expect(
        all.objects.map((object: { key: string }): string => {
          return object.key;
        }),
      ).toEqual([
        "prod/20261020T020000Z-a/manifest.json",
        "prod/20261021T020000Z-b/manifest.json",
        "prod/20261022T020000Z-c/manifest.json",
        "prod/20261022T020000Z-c/postgres.dump",
        "prod/notes.txt",
      ]);

      const folders: BackupListing = await storage.list({
        prefix: "prod/",
        delimiter: "/",
      });

      expect(folders.prefixes).toEqual([
        "prod/20261020T020000Z-a/",
        "prod/20261021T020000Z-b/",
        "prod/20261022T020000Z-c/",
      ]);
      expect(
        folders.objects.map((object: { key: string }): string => {
          return object.key;
        }),
      ).toEqual(["prod/notes.txt"]);
    });

    test("deleting a backup's folder deletes every file in it, and nothing beside it", async () => {
      const fake: FakeBackupS3 = fakeFor({ maxKeysPerPage: 3 });
      const storage: S3BackupStorage = storageFor(AMAZON, fake);

      for (let index: number = 0; index < 7; index++) {
        await storage.putObject({
          key: `prod/b/clickhouse/data/${index}.bin`,
          body: Buffer.from("x"),
          contentType: "x",
        });
      }
      await storage.putObject({
        key: "prod/b2/manifest.json",
        body: Buffer.from("x"),
        contentType: "x",
      });

      expect(await deleteBackupPrefix({ storage, prefix: "prod/b/" })).toBe(7);
      expect(fake.keys("acme-backups")).toEqual(["prod/b2/manifest.json"]);
    });

    test("deleting a file that is gone is no error", async () => {
      await expect(
        storageFor(AMAZON, fakeFor()).deleteObject("prod/gone"),
      ).resolves.toBeUndefined();
    });
  });

  describe("what a refusal says", () => {
    test("an access key S3 does not know", async () => {
      const fake: FakeBackupS3 = fakeFor({ accessKeyId: "AKIAOTHER" });

      expect(
        (
          await refusal(() => {
            return storageFor(AMAZON, fake).putObject({
              key: "prod/x",
              body: Buffer.from("x"),
              contentType: "x",
            });
          })
        ).message,
      ).toBe(
        "Amazon S3 does not know this access key (HTTP 403, InvalidAccessKeyId). Check the Access key ID.",
      );
    });

    test("a secret that does not belong to the key", async () => {
      const fake: FakeBackupS3 = fakeFor();
      const wrong: BackupDestinationSettings = {
        ...AMAZON,
        secrets: { secretAccessKey: "not-the-secret" },
      };

      const error: BackupStorageError = await refusal(() => {
        return storageFor(wrong, fake).putObject({
          key: "prod/x",
          body: Buffer.from("x"),
          contentType: "x",
        });
      });

      expect(error.message).toBe(
        "Amazon S3 refused the signature (HTTP 403, SignatureDoesNotMatch): the secret does not belong to this access key. Check the secret.",
      );
    });

    test("a bucket in another region, naming that region", async () => {
      const fake: FakeBackupS3 = fakeFor({ region: "us-west-2" });

      expect(
        (
          await refusal(() => {
            return storageFor(AMAZON, fake).putObject({
              key: "prod/x",
              body: Buffer.from("x"),
              contentType: "x",
            });
          })
        ).message,
      ).toBe(
        "The bucket acme-backups is in another region (us-west-2) (HTTP 400, AuthorizationHeaderMalformed). Set Region to the bucket's region.",
      );
    });

    test("a lookup in another region - an answer without a body - still names the region, from S3's header", async () => {
      const fake: FakeBackupS3 = fakeFor({ region: "us-west-2" });

      expect(
        (
          await refusal(() => {
            return storageFor(AMAZON, fake).headObject("prod/x");
          })
        ).message,
      ).toBe(
        "The bucket acme-backups is in another region (us-west-2) (HTTP 400). Set Region to the bucket's region.",
      );
    });

    test("the first parts of a large upload, sent at once, start one upload between them", async () => {
      const fake: FakeBackupS3 = fakeFor();

      await storageFor(AMAZON, fake).upload({
        key: "prod/b/postgres.dump",
        source: Readable.from([bytes(33 * MIB)]),
        contentType: "application/octet-stream",
      });

      expect(
        fake.requests.filter((request: { operation: string }): boolean => {
          return request.operation === "CreateMultipartUpload";
        }),
      ).toHaveLength(1);
      expect(
        fake.object("acme-backups", "prod/b/postgres.dump")!.body.length,
      ).toBe(33 * MIB);
    });

    test("a bucket that does not exist", async () => {
      const fake: FakeBackupS3 = fakeFor({ bucket: "someone-elses" });

      expect(
        (
          await refusal(() => {
            return storageFor(AMAZON, fake).putObject({
              key: "prod/x",
              body: Buffer.from("x"),
              contentType: "x",
            });
          })
        ).message,
      ).toBe(
        "The bucket acme-backups does not exist (HTTP 404, NoSuchBucket). Check the bucket name.",
      );
    });

    test("a key that may write but not delete: says to allow deleting", async () => {
      const fake: FakeBackupS3 = fakeFor({
        deniedOperations: ["DeleteObject"],
      });

      expect(
        (
          await refusal(() => {
            return storageFor(AMAZON, fake).deleteObject("prod/x");
          })
        ).message,
      ).toBe(
        "Amazon S3 did not let this key delete an old backup (HTTP 403, AccessDenied). Allow it to read, write, list and delete objects in acme-backups/prod/.",
      );
    });

    test("never holds the secret, whatever the storage answered", () => {
      const message: string = describeS3BackupFailure({
        status: 400,
        bodyText: `<Error><Code>Odd</Code><Message>bad ${SECRET}</Message></Error>`,
        type: BackupDestinationType.AmazonS3,
        bucket: "acme-backups",
        folder: "prod/",
        operation: "write the backup",
      });

      expect(message).toContain(
        "Amazon S3 could not write the backup (HTTP 400, Odd)",
      );

      const storage: S3BackupStorage = storageFor(AMAZON, fakeFor());
      const redacted: string = (
        storage as unknown as { redact: (text: string) => string }
      ).redact(message);

      expect(redacted).not.toContain(SECRET);
      expect(redacted).toContain("[REDACTED]");
    });

    test("a storage that cannot be reached says so, and what to check", async () => {
      const fake: FakeBackupS3 = createFakeBackupS3({
        credentials: { "r2-key": SECRET },
        buckets: { "oneuptime-backups": { region: "auto" } },
      });
      fake.dropNext(4);

      const error: BackupStorageError = await refusal(() => {
        return storageFor(R2, fake).putObject({
          key: "x",
          body: Buffer.from("x"),
          contentType: "x",
        });
      });

      expect(error.message).toBe(
        "Could not reach The S3-compatible storage: connect ECONNREFUSED 10.0.0.5:9000. Check the endpoint.",
      );
      expect(fake.requests).toHaveLength(4);
    }, 30000);
  });

  test("readXmlBlocks reads every block of a tag in order, and stops at a block that never closes", () => {
    expect(readXmlBlocks("<a><b>1</b><b>2</b><b>3", "b")).toEqual(["1", "2"]);
  });
});
