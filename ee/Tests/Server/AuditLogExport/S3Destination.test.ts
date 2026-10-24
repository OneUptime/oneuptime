import { describe, expect, test } from "@jest/globals";
import S3Destination, {
  describeS3Failure,
  getS3Target,
  S3Target,
} from "../../../Server/AuditLogExport/Destinations/S3Destination";
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
import { createFakeS3, FakeS3 } from "./Fakes/FakeS3";

/*
 * Amazon S3 and S3-compatible storage, against a faithful fake of the S3
 * API that checks the Signature Version 4 signature with its own code, the
 * payload hash, the bucket's region and the key's prefix (Fakes/FakeS3).
 */

const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

const amazonSettings: (config?: Record<string, unknown>) => AuditLogExportSettings = (
  config: Record<string, unknown> = {},
): AuditLogExportSettings => {
  return settingsOf({
    type: AuditLogExportDestinationType.AmazonS3,
    config: {
      bucket: "acme-audit-logs",
      region: "eu-west-1",
      accessKeyId: ACCESS_KEY_ID,
      ...config,
    } as never,
    secrets: { secretAccessKey: SECRET },
  });
};

const records: Array<AuditLogExportRecord> = [
  auditLogRecord({ createdAt: "2026-10-24T09:15:03.000Z" }),
  auditLogRecord({
    createdAt: "2026-10-24T09:15:04.000Z",
    resourceName: "Checkout API",
  }),
];

const fakeAmazon: () => FakeS3 = (): FakeS3 => {
  return createFakeS3({
    credentials: { [ACCESS_KEY_ID]: SECRET },
    buckets: {
      "acme-audit-logs": {
        region: "eu-west-1",
        writablePrefixes: ["oneuptime/audit-logs/", "compliance/"],
      },
      "acme.audit.logs": { region: "eu-west-1" },
    },
  });
};

const failureOf: (run: () => Promise<unknown>) => Promise<AuditLogExportDeliveryError> =
  async (run: () => Promise<unknown>): Promise<AuditLogExportDeliveryError> => {
    try {
      await run();
    } catch (error) {
      expect(error).toBeInstanceOf(AuditLogExportDeliveryError);
      return error as AuditLogExportDeliveryError;
    }

    throw new Error("Expected the delivery to fail.");
  };

describe("Amazon S3", () => {
  test("writes one gzip NDJSON file per batch, filed by its first entry's hour", async () => {
    const s3: FakeS3 = fakeAmazon();
    const destination: S3Destination = new S3Destination({
      transport: s3.transport,
    });

    const receipt: { location: string } = await destination.deliver(
      deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
    );

    const key: string = `oneuptime/audit-logs/2026/10/24/09/20261024T091503Z_${records[0]!.id}.ndjson.gz`;

    expect(receipt.location).toBe(`s3://acme-audit-logs/${key}`);
    expect(Array.from(s3.buckets.get("acme-audit-logs")!.objects.keys())).toEqual(
      [key],
    );
    expect(s3.buckets.get("acme-audit-logs")!.objects.get(key)!.contentType).toBe(
      "application/gzip",
    );
    expect(s3.readObject("acme-audit-logs", key)).toEqual(
      records.map((record: AuditLogExportRecord): unknown => {
        return JSON.parse(JSON.stringify(record));
      }),
    );
  });

  test("addresses the bucket by its own host name, signed for its region", async () => {
    const s3: FakeS3 = fakeAmazon();

    await new S3Destination({ transport: s3.transport }).deliver(
      deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
    );

    const url: URL = new URL(s3.requests[0]!.url);

    expect(url.host).toBe("acme-audit-logs.s3.eu-west-1.amazonaws.com");
    expect(url.pathname.startsWith("/oneuptime/audit-logs/2026/10/24/09/")).toBe(
      true,
    );
    expect(s3.requests[0]!.method).toBe("PUT");
    expect(String(s3.requests[0]!.headers!["Authorization"])).toContain(
      `Credential=${ACCESS_KEY_ID}/`,
    );
    expect(String(s3.requests[0]!.headers!["Authorization"])).toContain(
      "/eu-west-1/s3/aws4_request",
    );
  });

  test("the same batch read again writes the same file again, not a second one", async () => {
    const s3: FakeS3 = fakeAmazon();
    const destination: S3Destination = new S3Destination({
      transport: s3.transport,
    });

    await destination.deliver(
      deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
    );
    await destination.deliver(
      deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
    );

    expect(s3.buckets.get("acme-audit-logs")!.objects.size).toBe(1);
  });

  test("files go to the folder the export names", async () => {
    const s3: FakeS3 = fakeAmazon();

    const receipt: { location: string } = await new S3Destination({
      transport: s3.transport,
    }).deliver(
      deliveryOf({
        settings: amazonSettings({ folder: "/compliance/oneuptime" }),
        batch: batchOf(records),
      }),
    );

    expect(receipt.location).toContain(
      "s3://acme-audit-logs/compliance/oneuptime/2026/10/24/09/",
    );
  });

  test("a bucket with dots is addressed in the path, whose certificate covers the host", async () => {
    const s3: FakeS3 = fakeAmazon();

    await new S3Destination({ transport: s3.transport }).deliver(
      deliveryOf({
        settings: amazonSettings({ bucket: "acme.audit.logs" }),
        batch: batchOf(records),
      }),
    );

    const url: URL = new URL(s3.requests[0]!.url);

    expect(url.host).toBe("s3.eu-west-1.amazonaws.com");
    expect(url.pathname.startsWith("/acme.audit.logs/oneuptime/")).toBe(true);
    expect(s3.buckets.get("acme.audit.logs")!.objects.size).toBe(1);
  });

  test("a test writes one fixed file in the folder, overwritten by every test", async () => {
    const s3: FakeS3 = fakeAmazon();
    const destination: S3Destination = new S3Destination({
      transport: s3.transport,
    });

    for (let index: number = 0; index < 2; index++) {
      await destination.deliver(
        deliveryOf({
          settings: amazonSettings(),
          batch: batchOf([records[index]!], true),
        }),
      );
    }

    expect(Array.from(s3.buckets.get("acme-audit-logs")!.objects.keys())).toEqual(
      ["oneuptime/audit-logs/oneuptime-audit-log-export-test.ndjson.gz"],
    );
  });

  test("a key in a folder S3 refuses is told how to allow it", async () => {
    const s3: FakeS3 = fakeAmazon();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new S3Destination({ transport: s3.transport }).deliver(
        deliveryOf({
          settings: amazonSettings({ folder: "elsewhere" }),
          batch: batchOf(records),
        }),
      );
    });

    expect(error.message).toBe(
      "Amazon S3 did not let this access key write to the bucket (HTTP 403, AccessDenied). Allow it s3:PutObject on acme-audit-logs/elsewhere/*.",
    );
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(403);
  });

  test("an unknown access key, a wrong secret, a wrong region and a missing bucket each say what to change", async () => {
    const s3: FakeS3 = fakeAmazon();
    const destination: S3Destination = new S3Destination({
      transport: s3.transport,
    });

    const unknownKey: AuditLogExportDeliveryError = await failureOf(() => {
      return destination.deliver(
        deliveryOf({
          settings: amazonSettings({ accessKeyId: "AKIAUNKNOWN" }),
          batch: batchOf(records),
        }),
      );
    });
    expect(unknownKey.message).toBe(
      "Amazon S3 does not know this access key (HTTP 403, InvalidAccessKeyId). Check the Access key ID.",
    );

    const wrongSecret: AuditLogExportDeliveryError = await failureOf(() => {
      return destination.deliver(
        deliveryOf({
          settings: settingsOf({
            type: AuditLogExportDestinationType.AmazonS3,
            config: {
              bucket: "acme-audit-logs",
              region: "eu-west-1",
              accessKeyId: ACCESS_KEY_ID,
            },
            secrets: { secretAccessKey: "not-the-secret-of-this-key" },
          }),
          batch: batchOf(records),
        }),
      );
    });
    expect(wrongSecret.message).toBe(
      "Amazon S3 refused the signature (HTTP 403, SignatureDoesNotMatch): the secret access key does not belong to this access key ID. Check the Secret access key.",
    );
    // Never the secret itself.
    expect(wrongSecret.message).not.toContain("not-the-secret-of-this-key");

    const wrongRegion: AuditLogExportDeliveryError = await failureOf(() => {
      return destination.deliver(
        deliveryOf({
          settings: amazonSettings({ region: "us-east-2" }),
          batch: batchOf(records),
        }),
      );
    });
    expect(wrongRegion.message).toBe(
      "The bucket acme-audit-logs is in another region (eu-west-1) (HTTP 400, AuthorizationHeaderMalformed). Set Region to the bucket's region.",
    );
    expect(wrongRegion.retryable).toBe(false);

    const missing: AuditLogExportDeliveryError = await failureOf(() => {
      return destination.deliver(
        deliveryOf({
          settings: amazonSettings({ bucket: "acme-gone" }),
          batch: batchOf(records),
        }),
      );
    });
    expect(missing.message).toBe(
      "The bucket acme-gone does not exist (HTTP 404, NoSuchBucket). Check the bucket name.",
    );
  });

  test("S3 slowing down, or not answering, is worth trying again", async () => {
    const s3: FakeS3 = fakeAmazon();
    const destination: S3Destination = new S3Destination({
      transport: s3.transport,
    });

    s3.failNext(1, 503, "SlowDown");

    const busy: AuditLogExportDeliveryError = await failureOf(() => {
      return destination.deliver(
        deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
      );
    });
    expect(busy.message).toBe(
      "Amazon S3 is busy (HTTP 503, SlowDown). It is retried automatically.",
    );
    expect(busy.retryable).toBe(true);

    s3.dropNext(1);

    const unreachable: AuditLogExportDeliveryError = await failureOf(() => {
      return destination.deliver(
        deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
      );
    });
    expect(unreachable.retryable).toBe(true);
    expect(unreachable.message).toContain("Could not reach Amazon S3");
    expect(unreachable.message).toContain("ECONNREFUSED");

    // And the next try goes through.
    await destination.deliver(
      deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
    );
    expect(s3.buckets.get("acme-audit-logs")!.objects.size).toBe(1);
  });

  test("the request is exactly what was signed: a changed body is refused by S3", async () => {
    const s3: FakeS3 = fakeAmazon();

    const error: AuditLogExportDeliveryError = await failureOf(() => {
      return new S3Destination({
        transport: (request) => {
          return s3.transport({ ...request, body: Buffer.from("changed") });
        },
      }).deliver(
        deliveryOf({ settings: amazonSettings(), batch: batchOf(records) }),
      );
    });

    expect(error.message).toContain("XAmzContentSHA256Mismatch");
  });
});

describe("S3-compatible storage", () => {
  const compatible: (
    endpoint: string,
    config?: Record<string, unknown>,
  ) => AuditLogExportSettings = (
    endpoint: string,
    config: Record<string, unknown> = {},
  ): AuditLogExportSettings => {
    return settingsOf({
      type: AuditLogExportDestinationType.S3Compatible,
      config: {
        endpoint,
        bucket: "audit",
        region: "us-east-1",
        accessKeyId: ACCESS_KEY_ID,
        ...config,
      } as never,
      secrets: { secretAccessKey: SECRET },
    });
  };

  test.each([
    ["MinIO on its own port", "https://minio.internal.example:9000", "us-east-1"],
    ["Cloudflare R2", "https://0123abcd.r2.cloudflarestorage.com", "auto"],
    ["Backblaze B2", "https://s3.us-west-004.backblazeb2.com", "us-west-004"],
    ["Wasabi", "https://s3.eu-central-1.wasabisys.com", "eu-central-1"],
  ])(
    "%s: the bucket goes in the path, the host (and port) are signed as sent",
    async (_name: string, endpoint: string, region: string) => {
      const s3: FakeS3 = createFakeS3({
        credentials: { [ACCESS_KEY_ID]: SECRET },
        buckets: { audit: { region } },
      });

      const receipt: { location: string } = await new S3Destination({
        transport: s3.transport,
      }).deliver(
        deliveryOf({
          settings: compatible(endpoint, { region }),
          batch: batchOf(records),
        }),
      );

      const url: URL = new URL(s3.requests[0]!.url);

      expect(url.host).toBe(new URL(endpoint).host);
      expect(url.pathname.startsWith("/audit/oneuptime/audit-logs/")).toBe(true);
      expect(receipt.location.startsWith("s3://audit/oneuptime/audit-logs/")).toBe(
        true,
      );
      expect(s3.buckets.get("audit")!.objects.size).toBe(1);
    },
  );

  test("an endpoint with a path of its own keeps it before the bucket", () => {
    const target: S3Target = getS3Target({
      isAmazonS3: false,
      endpoint: "https://storage.example.com/s3/",
      bucket: "audit",
      region: "us-east-1",
      key: "a/b c.ndjson.gz",
    });

    expect(target.url).toBe(
      "https://storage.example.com/s3/audit/a/b%20c.ndjson.gz",
    );
    expect(target.signingPath).toBe("/s3/audit/a/b c.ndjson.gz");
    expect(target.host).toBe("storage.example.com");
  });

  test("a missing bucket on S3-compatible storage points at the endpoint too", () => {
    expect(
      describeS3Failure({
        answer: {
          ok: false,
          status: 404,
          bodyText: "<Error><Code>NoSuchBucket</Code></Error>",
          bodyJson: undefined,
        },
        isAmazonS3: false,
        bucket: "audit",
        folder: "oneuptime/audit-logs/",
      }),
    ).toBe(
      "The bucket audit does not exist (HTTP 404, NoSuchBucket). Check the bucket name and the endpoint.",
    );
  });
});

describe("the AWS partitions", () => {
  test("a China region uses amazonaws.com.cn", () => {
    expect(
      getS3Target({
        isAmazonS3: true,
        endpoint: "",
        bucket: "acme",
        region: "cn-north-1",
        key: "k",
      }).host,
    ).toBe("acme.s3.cn-north-1.amazonaws.com.cn");
  });

  test("GovCloud stays on amazonaws.com", () => {
    expect(
      getS3Target({
        isAmazonS3: true,
        endpoint: "",
        bucket: "acme",
        region: "us-gov-west-1",
        key: "k",
      }).host,
    ).toBe("acme.s3.us-gov-west-1.amazonaws.com");
  });
});

describe("what S3 answers without a code", () => {
  test.each([
    [301, "is in another region"],
    [403, "refused the access key"],
    [500, "is busy"],
    [418, "did not accept the file (HTTP 418)"],
  ])("HTTP %s", (status: number, words: string) => {
    expect(
      describeS3Failure({
        answer: { ok: false, status, bodyText: "", bodyJson: undefined },
        isAmazonS3: true,
        bucket: "acme",
        folder: "oneuptime/audit-logs/",
      }),
    ).toContain(words);
  });
});
