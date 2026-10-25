import { randomBytes } from "crypto";
import { describe, expect, test } from "@jest/globals";
import BackupSettingsUtil, {
  BACKUP_MAX_SECRET_LENGTH,
  BackupDestinationSettings,
} from "../../../../Server/Utils/Backup/BackupSettings";
import { AuditLogExportAzureAuthentication } from "../../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import BackupDestinationType from "../../../../Types/Backup/BackupDestinationType";
import { BackupProvider } from "../../../../Types/Backup/BackupDestinationCatalog";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { startEachTestOnSelfHostedEgressPolicy } from "../EgressPolicyEnvironment";

/*
 * The checks a save runs on the backup destination, so a mistake is a form
 * error naming the field - "Bucket must be an S3 bucket name..." - and not
 * a backup that fails every night. And the readings the runner connects
 * with: the folder, the endpoint, the region, where it is in words, and
 * whether two settings are the same place.
 */

const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const AZURE_KEY: string = randomBytes(64).toString("base64");
const SAS: string =
  "sv=2022-11-02&ss=b&srt=co&sp=racwdl&se=2027-01-01T00:00:00Z&st=2026-10-01T00:00:00Z&spr=https&sig=abc123%2Fdef%3D";

function validate(data: {
  type: BackupDestinationType | string;
  provider?: string | undefined;
  config: JSONObject;
  secrets?: JSONObject | undefined;
  requireRequiredSecrets?: boolean | undefined;
}): BackupDestinationSettings {
  return BackupSettingsUtil.validate({
    type: data.type,
    provider: data.provider,
    config: data.config,
    secrets: data.secrets || {},
    requireRequiredSecrets: data.requireRequiredSecrets ?? true,
  });
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the settings to be refused.");
}

const S3: JSONObject = {
  bucket: "acme-backups",
  region: "eu-west-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
};

const MINIO: JSONObject = {
  endpoint: "https://minio.example.com:9000",
  bucket: "oneuptime-backups",
  accessKeyId: "minio-admin",
};

const GCS: JSONObject = {
  bucket: "acme_backups.eu",
  accessKeyId: "GOOG1EXAMPLEHMACKEY",
};

const AZURE: JSONObject = {
  accountName: "acmebackups",
  container: "oneuptime-backups",
};

describe("BackupSettingsUtil.validate", () => {
  test("keeps an Amazon S3 destination as it was typed, with Amazon S3 as its provider", () => {
    expect(
      validate({
        type: BackupDestinationType.AmazonS3,
        config: { ...S3, folder: "prod/" },
        secrets: { secretAccessKey: SECRET },
      }),
    ).toEqual({
      type: BackupDestinationType.AmazonS3,
      provider: BackupProvider.AmazonS3,
      config: { ...S3, folder: "prod/" },
      secrets: { secretAccessKey: SECRET },
    });
  });

  test("keeps the recommended destination an S3-compatible storage was picked as", () => {
    expect(
      validate({
        type: BackupDestinationType.S3Compatible,
        provider: BackupProvider.CloudflareR2,
        config: {
          ...MINIO,
          endpoint: "https://0123abcd.r2.cloudflarestorage.com",
        },
        secrets: { secretAccessKey: SECRET },
      }).provider,
    ).toBe(BackupProvider.CloudflareR2);
  });

  test("refuses a provider of another storage, saying to choose again", () => {
    expect(
      refusal(() => {
        return validate({
          type: BackupDestinationType.AmazonS3,
          provider: BackupProvider.MinIO,
          config: S3,
          secrets: { secretAccessKey: SECRET },
        });
      }),
    ).toBe("MinIO is not Amazon S3. Choose the destination again.");
  });

  test("refuses a storage it does not know", () => {
    expect(
      refusal(() => {
        return validate({ type: "ftp", config: {} });
      }),
    ).toBe(
      "Destination must be one of: Amazon S3, S3-compatible storage, Google Cloud Storage or Azure Blob Storage.",
    );
  });

  test.each<[string, BackupDestinationType, JSONObject, JSONObject, string]>([
    [
      "an S3 bucket name S3 would refuse",
      BackupDestinationType.AmazonS3,
      { ...S3, bucket: "Acme_Backups" },
      { secretAccessKey: SECRET },
      "Bucket must be an S3 bucket name: 3 to 63 lowercase letters, digits, dots and hyphens, starting and ending with a letter or digit.",
    ],
    [
      "a region that is not one",
      BackupDestinationType.AmazonS3,
      { ...S3, region: "eu west 1" },
      { secretAccessKey: SECRET },
      "Region must be a region name such as us-east-1: letters, digits and hyphens.",
    ],
    [
      "a key ID with a space",
      BackupDestinationType.AmazonS3,
      { ...S3, accessKeyId: "AKIA EXAMPLE" },
      { secretAccessKey: SECRET },
      "Access key ID must be the key's ID, without spaces.",
    ],
    [
      "a secret with a line break",
      BackupDestinationType.AmazonS3,
      S3,
      { secretAccessKey: "abc\ndef" },
      "Secret access key cannot hold spaces or line breaks.",
    ],
    [
      "an S3-compatible bucket with a slash",
      BackupDestinationType.S3Compatible,
      { ...MINIO, bucket: "backups/oneuptime" },
      { secretAccessKey: SECRET },
      "Bucket must be a bucket name, without slashes or spaces.",
    ],
    [
      "an endpoint with a query",
      BackupDestinationType.S3Compatible,
      { ...MINIO, endpoint: "https://minio.example.com:9000/?x=1" },
      { secretAccessKey: SECRET },
      "Endpoint must be the storage's address without a query or a fragment, such as https://minio.example.com:9000.",
    ],
    [
      "an S3-compatible region that is not one",
      BackupDestinationType.S3Compatible,
      { ...MINIO, region: "a b" },
      { secretAccessKey: SECRET },
      "Region must be a region name such as us-east-1, or empty.",
    ],
    [
      "a Cloud Storage bucket with capitals",
      BackupDestinationType.GoogleCloudStorage,
      { ...GCS, bucket: "Acme" },
      { secretAccessKey: SECRET },
      "Bucket must be a Cloud Storage bucket name: 3 to 63 lowercase letters, digits, hyphens, underscores and dots, starting and ending with a letter or digit.",
    ],
    [
      "a storage account with capitals",
      BackupDestinationType.AzureBlobStorage,
      { ...AZURE, accountName: "AcmeBackups" },
      { sasToken: SAS },
      "Storage account must be the account's name: 3 to 24 lowercase letters and digits.",
    ],
    [
      "a container with an underscore",
      BackupDestinationType.AzureBlobStorage,
      { ...AZURE, container: "oneuptime_backups" },
      { sasToken: SAS },
      "Container must be a container name: 3 to 63 lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
    ],
    [
      "a SAS token that is not one",
      BackupDestinationType.AzureBlobStorage,
      AZURE,
      { sasToken: "not-a-token" },
      "SAS token must be a shared access signature, such as sv=...&sp=racwdl&...&sig=... - copy it from the storage account's Shared access signature page.",
    ],
    [
      "an access key that is not one",
      BackupDestinationType.AzureBlobStorage,
      {
        ...AZURE,
        authentication: AuditLogExportAzureAuthentication.AccessKey,
      },
      { accountKey: "not base64!" },
      "Access key must be one of the storage account's access keys, as the portal shows it.",
    ],
    [
      "a folder that climbs out",
      BackupDestinationType.AmazonS3,
      { ...S3, folder: "backups/../other" },
      { secretAccessKey: SECRET },
      "Folder",
    ],
  ])(
    "refuses %s, naming the field",
    (
      _case: string,
      type: BackupDestinationType,
      config: JSONObject,
      secrets: JSONObject,
      message: string,
    ) => {
      expect(
        refusal(() => {
          return validate({ type, config, secrets });
        }),
      ).toContain(message);
    },
  );

  test("refuses a credential longer than any a storage gives out", () => {
    expect(
      refusal(() => {
        return validate({
          type: BackupDestinationType.AmazonS3,
          config: S3,
          secrets: {
            secretAccessKey: "a".repeat(BACKUP_MAX_SECRET_LENGTH + 1),
          },
        });
      }),
    ).toContain("A credential is longer than any key a storage gives out");
  });

  test("asks for each required setting and credential", () => {
    expect(
      refusal(() => {
        return validate({
          type: BackupDestinationType.AmazonS3,
          config: { region: "eu-west-1", accessKeyId: "AKIAEXAMPLE" },
          secrets: { secretAccessKey: SECRET },
        });
      }),
    ).toContain("Bucket");

    expect(
      refusal(() => {
        return validate({
          type: BackupDestinationType.AmazonS3,
          config: S3,
          secrets: {},
        });
      }),
    ).toContain("Secret access key");
  });

  test("an update that keeps the stored credentials is checked without them", () => {
    expect(
      validate({
        type: BackupDestinationType.AmazonS3,
        config: S3,
        secrets: {},
        requireRequiredSecrets: false,
      }).secrets,
    ).toEqual({});
  });

  test("Amazon S3's region is us-east-1 when it is left alone", () => {
    const settings: BackupDestinationSettings = validate({
      type: BackupDestinationType.AmazonS3,
      config: { bucket: "acme-backups", accessKeyId: "AKIAEXAMPLE" },
      secrets: { secretAccessKey: SECRET },
    });

    expect(BackupSettingsUtil.getS3Region(settings)).toBe("us-east-1");
  });

  test("Azure asks for the credential its authentication names, and keeps only that one", () => {
    expect(
      refusal(() => {
        return validate({
          type: BackupDestinationType.AzureBlobStorage,
          config: AZURE,
          secrets: {},
        });
      }),
    ).toContain("SAS token");

    const withKey: BackupDestinationSettings = validate({
      type: BackupDestinationType.AzureBlobStorage,
      config: {
        ...AZURE,
        authentication: AuditLogExportAzureAuthentication.AccessKey,
      },
      secrets: { accountKey: AZURE_KEY },
    });

    expect(BackupSettingsUtil.usesAzureSasToken(withKey)).toBe(false);
    expect(
      BackupSettingsUtil.usesAzureSasToken(
        validate({
          type: BackupDestinationType.AzureBlobStorage,
          config: AZURE,
          secrets: { sasToken: SAS },
        }),
      ),
    ).toBe(true);
  });
});

describe("BackupSettingsUtil readings", () => {
  test.each<[unknown, string]>([
    [undefined, "oneuptime/backups/"],
    ["", "oneuptime/backups/"],
    ["   ", "oneuptime/backups/"],
    ["prod", "prod/"],
    ["/prod/", "prod/"],
    ["//prod//", "prod/"],
    ["eu/prod", "eu/prod/"],
    [42, "oneuptime/backups/"],
  ])("the folder %p is %p", (folder: unknown, expected: string) => {
    expect(
      BackupSettingsUtil.getFolder({
        config: folder === undefined ? {} : ({ folder } as JSONObject),
      }),
    ).toBe(expected);
  });

  test("the S3 endpoint: Amazon S3 addresses the bucket itself, S3-compatible storage its endpoint, Cloud Storage its XML API", () => {
    expect(
      BackupSettingsUtil.getS3Endpoint({
        type: BackupDestinationType.AmazonS3,
        config: S3,
      }),
    ).toBeNull();
    expect(
      BackupSettingsUtil.getS3Endpoint({
        type: BackupDestinationType.S3Compatible,
        config: MINIO,
      }),
    ).toBe("https://minio.example.com:9000");
    expect(
      BackupSettingsUtil.getS3Endpoint({
        type: BackupDestinationType.GoogleCloudStorage,
        config: GCS,
      }),
    ).toBe("https://storage.googleapis.com");
  });

  test("the S3 region: the setting's, else read from the endpoint, and auto for Cloud Storage", () => {
    expect(
      BackupSettingsUtil.getS3Region({
        type: BackupDestinationType.S3Compatible,
        config: {
          ...MINIO,
          endpoint: "https://s3.us-west-004.backblazeb2.com",
        },
      }),
    ).toBe("us-west-004");
    expect(
      BackupSettingsUtil.getS3Region({
        type: BackupDestinationType.S3Compatible,
        config: {
          ...MINIO,
          endpoint: "https://s3.us-west-004.backblazeb2.com",
          region: "eu-central-003",
        },
      }),
    ).toBe("eu-central-003");
    expect(
      BackupSettingsUtil.getS3Region({
        type: BackupDestinationType.GoogleCloudStorage,
        config: GCS,
      }),
    ).toBe("auto");
    expect(
      BackupSettingsUtil.getS3Region({
        type: BackupDestinationType.AzureBlobStorage,
        config: AZURE,
      }),
    ).toBe("");
  });

  test.each<[BackupDestinationType, JSONObject, string]>([
    [
      BackupDestinationType.AmazonS3,
      S3,
      "s3://acme-backups/oneuptime/backups/",
    ],
    [
      BackupDestinationType.S3Compatible,
      { ...MINIO, folder: "prod" },
      "minio.example.com:9000/oneuptime-backups/prod/",
    ],
    [
      BackupDestinationType.GoogleCloudStorage,
      GCS,
      "gs://acme_backups.eu/oneuptime/backups/",
    ],
    [
      BackupDestinationType.AzureBlobStorage,
      AZURE,
      "acmebackups/oneuptime-backups/oneuptime/backups/",
    ],
  ])(
    "%s is described as where its backups are, without a credential",
    (type: BackupDestinationType, config: JSONObject, location: string) => {
      expect(BackupSettingsUtil.describeLocation({ type, config })).toBe(
        location,
      );
    },
  );

  describe("the destination's fingerprint", () => {
    const fingerprint: (
      type: BackupDestinationType,
      config: JSONObject,
    ) => string = (type: BackupDestinationType, config: JSONObject): string => {
      return BackupSettingsUtil.getDestinationFingerprint({ type, config });
    };

    test("is the same for the same place, whatever key reaches it", () => {
      expect(fingerprint(BackupDestinationType.AmazonS3, S3)).toBe(
        fingerprint(BackupDestinationType.AmazonS3, {
          ...S3,
          accessKeyId: "AKIAROTATEDKEY",
          region: "eu-west-1",
        }),
      );
    });

    test("reads a folder written either way as the same folder", () => {
      expect(
        fingerprint(BackupDestinationType.AmazonS3, { ...S3, folder: "/prod" }),
      ).toBe(
        fingerprint(BackupDestinationType.AmazonS3, { ...S3, folder: "prod/" }),
      );
    });

    test("reads an endpoint's host in any case as the same endpoint", () => {
      expect(
        fingerprint(BackupDestinationType.S3Compatible, {
          ...MINIO,
          endpoint: "https://MINIO.example.com:9000",
        }),
      ).toBe(fingerprint(BackupDestinationType.S3Compatible, MINIO));
    });

    test.each<[string, BackupDestinationType, JSONObject, JSONObject]>([
      [
        "another bucket",
        BackupDestinationType.AmazonS3,
        S3,
        { ...S3, bucket: "acme-other" },
      ],
      [
        "another folder",
        BackupDestinationType.AmazonS3,
        S3,
        { ...S3, folder: "staging" },
      ],
      [
        "another endpoint",
        BackupDestinationType.S3Compatible,
        MINIO,
        { ...MINIO, endpoint: "https://minio2.example.com:9000" },
      ],
      [
        "another container",
        BackupDestinationType.AzureBlobStorage,
        AZURE,
        { ...AZURE, container: "other-backups" },
      ],
      [
        "another Azure cloud",
        BackupDestinationType.AzureBlobStorage,
        AZURE,
        { ...AZURE, cloud: "china" },
      ],
    ])(
      "changes with %s",
      (
        _case: string,
        type: BackupDestinationType,
        before: JSONObject,
        after: JSONObject,
      ) => {
        expect(fingerprint(type, before)).not.toBe(fingerprint(type, after));
      },
    );

    test("tells Amazon S3 and Cloud Storage buckets of the same name apart", () => {
      expect(
        fingerprint(BackupDestinationType.AmazonS3, { bucket: "acme-backups" }),
      ).not.toBe(
        fingerprint(BackupDestinationType.GoogleCloudStorage, {
          bucket: "acme-backups",
        }),
      );
    });

    test("is a SHA-256, never the settings themselves", () => {
      expect(fingerprint(BackupDestinationType.AmazonS3, S3)).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });
  });
});

describe("BackupSettingsUtil.assertTargetsAllowed", () => {
  startEachTestOnSelfHostedEgressPolicy();

  const minio: (endpoint: string) => BackupDestinationSettings = (
    endpoint: string,
  ): BackupDestinationSettings => {
    return {
      type: BackupDestinationType.S3Compatible,
      provider: BackupProvider.MinIO,
      config: { ...MINIO, endpoint },
      secrets: { secretAccessKey: SECRET },
    };
  };

  test("lets a master admin point backups at a MinIO on the private network", async () => {
    await expect(
      BackupSettingsUtil.assertTargetsAllowed(minio("http://10.0.0.5:9000")),
    ).resolves.toBeUndefined();
  });

  test.each([
    ["the loopback address", "http://127.0.0.1:9000"],
    ["the cloud metadata address", "http://169.254.169.254"],
  ])("refuses %s, for everyone", async (_case: string, endpoint: string) => {
    await expect(
      BackupSettingsUtil.assertTargetsAllowed(minio(endpoint)),
    ).rejects.toThrow();
  });

  test("has nothing to check for the storages whose address OneUptime knows", async () => {
    await expect(
      BackupSettingsUtil.assertTargetsAllowed({
        type: BackupDestinationType.AmazonS3,
        provider: BackupProvider.AmazonS3,
        config: S3,
        secrets: { secretAccessKey: SECRET },
      }),
    ).resolves.toBeUndefined();
  });
});
