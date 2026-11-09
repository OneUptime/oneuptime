import { generateKeyPairSync, randomBytes } from "crypto";
import { describe, expect, test } from "@jest/globals";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
  describeFolderProblem,
  getAuditLogExportFolder,
  isAmazonS3BucketName,
  isAzureContainerName,
  isAzureStorageAccountName,
  isGoogleCloudStorageBucketName,
  isHttpHeaderName,
  isS3CompatibleBucketName,
  isS3RegionName,
  isSyslogHost,
} from "../../../../../Server/Utils/AuditLog/Export/AuditLogExportSettings";
import AuditLogExportDestinationType from "../../../../../Types/AuditLog/Export/AuditLogExportDestinationType";
import { AUDIT_LOG_EXPORT_DEFAULT_FOLDER } from "../../../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { startEachTestOnSelfHostedEgressPolicy } from "../../EgressPolicyEnvironment";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * The checks a save runs on an audit log export's settings, so a mistake is
 * a form error - "Bucket must be an S3 bucket name..." - and not a delivery
 * that fails on every run. Each message names the field and what it takes.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "audit-export@acme.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

const AZURE_ACCOUNT_KEY: string = randomBytes(64).toString("base64");

const validate: (data: {
  type: AuditLogExportDestinationType;
  config: JSONObject;
  secrets?: JSONObject | undefined;
  requireRequiredSecrets?: boolean | undefined;
}) => AuditLogExportSettings = (data: {
  type: AuditLogExportDestinationType;
  config: JSONObject;
  secrets?: JSONObject | undefined;
  requireRequiredSecrets?: boolean | undefined;
}): AuditLogExportSettings => {
  return AuditLogExportSettingsUtil.validate({
    type: data.type,
    config: data.config,
    secrets: data.secrets || {},
    requireRequiredSecrets: data.requireRequiredSecrets ?? true,
  });
};

const refusal: (run: () => unknown) => string = (
  run: () => unknown,
): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the settings to be refused.");
};

const S3_CONFIG: JSONObject = {
  bucket: "acme-audit-logs",
  region: "eu-west-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
};

const S3_SECRETS: JSONObject = {
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("validating an export's settings", () => {
  test("refuses a destination that is not one of the six", () => {
    expect(
      refusal(() => {
        return AuditLogExportSettingsUtil.validate({
          type: "ftp",
          config: {},
          secrets: {},
          requireRequiredSecrets: true,
        });
      }),
    ).toBe(
      "Destination must be one of: Amazon S3, S3-compatible storage, Google Cloud Storage, Azure Blob Storage, Webhook or Syslog.",
    );
  });

  test("Amazon S3: valid settings come back as stored, trimmed", () => {
    expect(
      validate({
        type: AuditLogExportDestinationType.AmazonS3,
        config: { ...S3_CONFIG, bucket: "  acme-audit-logs  " },
        secrets: S3_SECRETS,
      }),
    ).toEqual({
      type: "s3",
      config: S3_CONFIG,
      secrets: S3_SECRETS,
    });
  });

  test("Amazon S3: a region left out reads as us-east-1", () => {
    const settings: AuditLogExportSettings = validate({
      type: AuditLogExportDestinationType.AmazonS3,
      config: { bucket: "acme-audit-logs", accessKeyId: "AKIAEXAMPLE" },
      secrets: S3_SECRETS,
    });

    expect(settings.config).toEqual({
      bucket: "acme-audit-logs",
      accessKeyId: "AKIAEXAMPLE",
    });
    expect(AuditLogExportSettingsUtil.readConfigText(settings, "region")).toBe(
      "us-east-1",
    );
  });

  test.each([
    ["Acme-Logs", "upper case"],
    ["ab", "too short"],
    ["-acme", "a hyphen first"],
    ["acme-", "a hyphen last"],
    ["acme..logs", "two dots"],
    ["acme_logs", "an underscore"],
    ["a".repeat(64), "too long"],
  ])("Amazon S3 refuses the bucket %s (%s)", (bucket: string) => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: { ...S3_CONFIG, bucket },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe(
      "Bucket must be an S3 bucket name: 3 to 63 lowercase letters, digits, dots and hyphens, starting and ending with a letter or digit.",
    );
  });

  test("Amazon S3 asks for each required setting by name", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: { region: "us-east-1", accessKeyId: "AKIAEXAMPLE" },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe("Bucket is required for Amazon S3.");

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: S3_CONFIG,
          secrets: {},
        });
      }),
    ).toBe("Secret access key is required for Amazon S3.");
  });

  test("an update that keeps the stored secret is checked without it", () => {
    expect(
      validate({
        type: AuditLogExportDestinationType.AmazonS3,
        config: S3_CONFIG,
        secrets: {},
        requireRequiredSecrets: false,
      }).secrets,
    ).toEqual({});
  });

  test("refuses a setting the destination does not have", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: { ...S3_CONFIG, acl: "public-read" },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe('Configuration contains an unknown setting "acl" for Amazon S3.');
  });

  test("refuses a region and an access key ID S3 would never take", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: { ...S3_CONFIG, region: "eu west 1" },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe(
      "Region must be a region name such as us-east-1: letters, digits and hyphens.",
    );

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: { ...S3_CONFIG, accessKeyId: "AKIA EXAMPLE" },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe("Access key ID must be the key's ID, without spaces.");
  });

  test("S3-compatible storage needs its endpoint, and takes the bucket names MinIO and Ceph allow", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.S3Compatible,
          config: S3_CONFIG,
          secrets: S3_SECRETS,
        });
      }),
    ).toBe("Endpoint is required for S3-compatible storage.");

    expect(
      validate({
        type: AuditLogExportDestinationType.S3Compatible,
        config: {
          ...S3_CONFIG,
          bucket: "Legacy_Bucket",
          region: "auto",
          endpoint: "https://0123abcd.r2.cloudflarestorage.com",
        },
        secrets: S3_SECRETS,
      }).config["bucket"],
    ).toBe("Legacy_Bucket");
  });

  test("S3-compatible storage refuses a bucket with a slash, and an endpoint with a query", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.S3Compatible,
          config: {
            ...S3_CONFIG,
            bucket: "logs/2026",
            endpoint: "https://minio.example.com:9000",
          },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe("Bucket must be a bucket name, without slashes or spaces.");

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.S3Compatible,
          config: {
            ...S3_CONFIG,
            endpoint: "https://minio.example.com:9000/?region=x",
          },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe(
      "Endpoint must be the storage's address without a query or a fragment, such as https://minio.example.com:9000.",
    );

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.S3Compatible,
          config: { ...S3_CONFIG, endpoint: "ftp://minio.example.com" },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe("Endpoint must be an http or https URL.");

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.S3Compatible,
          config: {
            ...S3_CONFIG,
            endpoint: "https://user:pass@minio.example.com",
          },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe("Endpoint must not embed credentials in the URL.");
  });

  test("Google Cloud Storage takes a service account key and refuses what is not one", () => {
    expect(
      validate({
        type: AuditLogExportDestinationType.GoogleCloudStorage,
        config: { bucket: "acme_audit.logs" },
        secrets: { serviceAccountJson: SERVICE_ACCOUNT_JSON },
      }).config,
    ).toEqual({ bucket: "acme_audit.logs" });

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.GoogleCloudStorage,
          config: { bucket: "acme-audit-logs" },
          secrets: { serviceAccountJson: '{"client_email": "x"}' },
        });
      }),
    ).toBe(
      "Service account JSON must contain client_email and private_key as strings.",
    );

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.GoogleCloudStorage,
          config: { bucket: "acme-audit-logs" },
          secrets: { serviceAccountJson: "not json" },
        });
      }),
    ).toBe("Service account key must be a JSON object.");
  });

  test("Google Cloud Storage refuses a bucket name Google would", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.GoogleCloudStorage,
          config: { bucket: "Acme" },
          secrets: { serviceAccountJson: SERVICE_ACCOUNT_JSON },
        });
      }),
    ).toBe(
      "Bucket must be a Cloud Storage bucket name: 3 to 63 lowercase letters, digits, hyphens, underscores and dots, starting and ending with a letter or digit.",
    );
  });

  test("Azure starts on a SAS token and asks for it, not for an access key", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AzureBlobStorage,
          config: { accountName: "acmeaudit", container: "audit-logs" },
          secrets: {},
        });
      }),
    ).toBe("SAS token is required for Azure Blob Storage.");

    expect(
      validate({
        type: AuditLogExportDestinationType.AzureBlobStorage,
        config: { accountName: "acmeaudit", container: "audit-logs" },
        secrets: { sasToken: "?sv=2022-11-02&sp=cw&sig=abc%2Fdef" },
      }).secrets,
    ).toEqual({ sasToken: "?sv=2022-11-02&sp=cw&sig=abc%2Fdef" });
  });

  test("Azure with an access key keeps the key and drops a SAS token left over from before", () => {
    const settings: AuditLogExportSettings = validate({
      type: AuditLogExportDestinationType.AzureBlobStorage,
      config: {
        accountName: "acmeaudit",
        container: "audit-logs",
        authentication: "access-key",
      },
      secrets: {
        accountKey: AZURE_ACCOUNT_KEY,
        sasToken: "sv=2022-11-02&sig=old",
      },
    });

    expect(settings.secrets).toEqual({ accountKey: AZURE_ACCOUNT_KEY });
  });

  test("Azure refuses names, tokens and keys Azure would", () => {
    const cases: Array<[JSONObject, JSONObject, string]> = [
      [
        { accountName: "Acme-Audit", container: "audit-logs" },
        { sasToken: "sv=1&sig=x" },
        "Storage account must be the account's name: 3 to 24 lowercase letters and digits.",
      ],
      [
        { accountName: "acmeaudit", container: "Audit--Logs" },
        { sasToken: "sv=1&sig=x" },
        "Container must be a container name: 3 to 63 lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
      ],
      [
        { accountName: "acmeaudit", container: "audit-logs" },
        { sasToken: "sv=2022-11-02&sp=cw" },
        "SAS token must be a shared access signature, such as sv=...&sp=cw&...&sig=... - copy it from the storage account's Shared access signature page.",
      ],
      [
        {
          accountName: "acmeaudit",
          container: "audit-logs",
          authentication: "access-key",
        },
        { accountKey: "not a key" },
        "Access key must be one of the storage account's access keys, as the portal shows it.",
      ],
    ];

    for (const [config, secrets, message] of cases) {
      expect(
        refusal(() => {
          return validate({
            type: AuditLogExportDestinationType.AzureBlobStorage,
            config,
            secrets,
          });
        }),
      ).toBe(message);
    }
  });

  test("a webhook needs its URL; its credential, header and signing secret are optional", () => {
    expect(
      validate({
        type: AuditLogExportDestinationType.Webhook,
        config: { url: "https://logs.example.com/oneuptime" },
      }),
    ).toEqual({
      type: "webhook",
      config: { url: "https://logs.example.com/oneuptime" },
      secrets: {},
    });

    expect(
      validate({
        type: AuditLogExportDestinationType.Webhook,
        config: {
          url: "https://http-intake.logs.datadoghq.com/api/v2/logs",
          headerName: "DD-API-KEY",
          bodyFormat: "json-array",
        },
        secrets: { headerValue: "abc123", signingSecret: "long-enough" },
      }).secrets,
    ).toEqual({ headerValue: "abc123", signingSecret: "long-enough" });
  });

  test("a webhook refuses a header name with a space, a credential with a line break and a short signing secret", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.Webhook,
          config: {
            url: "https://logs.example.com",
            headerName: "X Api Key",
          },
        });
      }),
    ).toBe(
      "Header name must be a header name such as Authorization or X-Api-Key: letters, digits and hyphens.",
    );

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.Webhook,
          config: { url: "https://logs.example.com" },
          secrets: { headerValue: "Bearer a\r\nX-Injected: 1" },
        });
      }),
    ).toBe("Credential cannot hold a line break or a control character.");

    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.Webhook,
          config: { url: "https://logs.example.com" },
          secrets: { signingSecret: "short" },
        });
      }),
    ).toBe("Signing secret must be at least 8 characters long.");
  });

  test("syslog defaults to TLS on 6514, and checks its host, port and certificate", () => {
    const settings: AuditLogExportSettings = validate({
      type: AuditLogExportDestinationType.Syslog,
      config: { host: "syslog.example.com" },
    });

    expect(AuditLogExportSettingsUtil.readConfigText(settings, "port")).toBe(
      "6514",
    );
    expect(
      AuditLogExportSettingsUtil.readConfigText(settings, "protocol"),
    ).toBe("tls");
    expect(AuditLogExportSettingsUtil.readConfigText(settings, "framing")).toBe(
      "octet-counting",
    );

    const cases: Array<[JSONObject, string]> = [
      [
        { host: "syslog.example.com:514" },
        "Host must be a host name or an IP address, without a scheme or a port, such as syslog.example.com.",
      ],
      [
        { host: "tcp://syslog.example.com" },
        "Host must be a host name or an IP address, without a scheme or a port, such as syslog.example.com.",
      ],
      [
        { host: "syslog.example.com", port: 70000 },
        "Port must be a whole number from 1 to 65535.",
      ],
      [
        { host: "syslog.example.com", port: "6514.5" },
        "Port must be a whole number from 1 to 65535.",
      ],
      [
        { host: "syslog.example.com", caCertificate: "hello" },
        "CA certificate must be a PEM certificate, starting with -----BEGIN CERTIFICATE-----.",
      ],
    ];

    for (const [config, message] of cases) {
      expect(
        refusal(() => {
          return validate({
            type: AuditLogExportDestinationType.Syslog,
            config,
          });
        }),
      ).toBe(message);
    }
  });

  test("syslog over TCP keeps no CA certificate", () => {
    expect(
      validate({
        type: AuditLogExportDestinationType.Syslog,
        config: {
          host: "10.0.0.5",
          port: 514,
          protocol: "tcp",
          caCertificate: "-----BEGIN CERTIFICATE-----\nabc",
        },
      }).config,
    ).toEqual({ host: "10.0.0.5", port: 514, protocol: "tcp" });
  });

  test("an IPv6 syslog host is a host, not a host with a port", () => {
    expect(isSyslogHost("2001:db8::1")).toBe(true);
    expect(isSyslogHost("syslog.example.com")).toBe(true);
    expect(isSyslogHost("syslog.example.com:514")).toBe(false);
    expect(isSyslogHost("")).toBe(false);
    expect(isSyslogHost("a b")).toBe(false);
  });
});

/*
 * Issue #6392: syslog over UDP, for a receiver that takes nothing else. Its
 * port follows it (514), its framing is the datagram's own, and the longest
 * message it sends is a setting of its own.
 */
describe("syslog over UDP", () => {
  const syslog: (config: JSONObject) => AuditLogExportSettings = (
    config: JSONObject,
  ): AuditLogExportSettings => {
    return validate({ type: AuditLogExportDestinationType.Syslog, config });
  };

  test("takes a host alone, on port 514, and keeps nothing it does not use", () => {
    const settings: AuditLogExportSettings = syslog({
      host: "10.0.0.5",
      protocol: "udp",
    });

    expect(settings.config).toEqual({ host: "10.0.0.5", protocol: "udp" });
    expect(AuditLogExportSettingsUtil.readConfigText(settings, "port")).toBe(
      "514",
    );
    // No size stored: the destination sends at most its own default.
    expect(
      AuditLogExportSettingsUtil.readConfigText(settings, "maxMessageSize"),
    ).toBe("");
  });

  /*
   * A default was filled in for every field before the check, shown or not:
   * framing's, hidden over UDP, came back as a setting Syslog does not have.
   */
  test("is not refused for the framing default a hidden field holds", () => {
    expect((): void => {
      syslog({ host: "10.0.0.5", protocol: "udp" });
    }).not.toThrow();
  });

  test("drops a framing and a CA certificate left over from TLS, rather than refusing them", () => {
    expect(
      syslog({
        host: "syslog.example.com",
        port: 514,
        protocol: "udp",
        framing: "newline",
        caCertificate: "-----BEGIN CERTIFICATE-----\nabc",
        maxMessageSize: 2048,
      }).config,
    ).toEqual({
      host: "syslog.example.com",
      port: 514,
      protocol: "udp",
      maxMessageSize: 2048,
    });
  });

  test("a port typed stays the port, over UDP as over TCP", () => {
    for (const protocol of ["udp", "tcp", "tls"]) {
      expect(
        AuditLogExportSettingsUtil.readConfigText(
          syslog({ host: "10.0.0.5", protocol, port: 1514 }),
          "port",
        ),
      ).toBe("1514");
    }
  });

  test("TCP and TLS keep 6514 when no port is named, as they always have", () => {
    for (const config of [
      { host: "10.0.0.5" },
      { host: "10.0.0.5", protocol: "tls" },
      { host: "10.0.0.5", protocol: "tcp" },
    ]) {
      expect(
        AuditLogExportSettingsUtil.readConfigText(syslog(config), "port"),
      ).toBe("6514");
    }
  });

  test("a maximum message size over TLS or TCP is dropped: a stream has no datagram to fit", () => {
    for (const protocol of ["tls", "tcp"]) {
      expect(
        syslog({ host: "10.0.0.5", protocol, maxMessageSize: 2048 }).config,
      ).toEqual({ host: "10.0.0.5", protocol });
    }
  });

  test("the maximum message size is a whole number from 1024 to 65507, both ends included", () => {
    for (const size of [1024, 1500, 8192, 65507, "4096", " 2048 "]) {
      expect((): void => {
        syslog({ host: "10.0.0.5", protocol: "udp", maxMessageSize: size });
      }).not.toThrow();
    }

    for (const size of [1023, 65508, 0, -1, 2048.5, "2048.5", 1e9, true]) {
      expect(
        refusal(() => {
          return syslog({
            host: "10.0.0.5",
            protocol: "udp",
            maxMessageSize: size,
          });
        }),
      ).toBe("Maximum message size must be a whole number from 1024 to 65507.");
    }

    expect(
      refusal(() => {
        return syslog({
          host: "10.0.0.5",
          protocol: "udp",
          maxMessageSize: "big",
        });
      }),
    ).toBe("Maximum message size must be a number.");
  });

  test("a port out of range is refused in the same words over every protocol", () => {
    for (const protocol of ["udp", "tcp", "tls"]) {
      for (const port of [0, 65536, -514, 514.5, "514.5", true]) {
        expect(
          refusal(() => {
            return syslog({ host: "10.0.0.5", protocol, port });
          }),
        ).toBe("Port must be a whole number from 1 to 65535.");
      }

      for (const port of [1, 65535, "514"]) {
        expect((): void => {
          syslog({ host: "10.0.0.5", protocol, port });
        }).not.toThrow();
      }
    }
  });

  test("a protocol Syslog does not offer is refused, naming the three it does", () => {
    expect(
      refusal(() => {
        return syslog({ host: "10.0.0.5", protocol: "sctp" });
      }),
    ).toBe("Protocol must be one of: tls, tcp, udp.");
  });

  test("its host is checked as over TCP", () => {
    expect(
      refusal(() => {
        return syslog({ host: "udp://10.0.0.5", protocol: "udp" });
      }),
    ).toBe(
      "Host must be a host name or an IP address, without a scheme or a port, such as syslog.example.com.",
    );
  });
});

describe("the folder files go to", () => {
  test("defaults to oneuptime/audit-logs/", () => {
    expect(getAuditLogExportFolder({})).toBe(AUDIT_LOG_EXPORT_DEFAULT_FOLDER);
    expect(getAuditLogExportFolder({ folder: "   " })).toBe(
      AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
    );
    expect(getAuditLogExportFolder({ folder: "/" })).toBe(
      AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
    );
  });

  test("never starts with a slash, and always ends with one", () => {
    expect(getAuditLogExportFolder({ folder: "compliance" })).toBe(
      "compliance/",
    );
    expect(getAuditLogExportFolder({ folder: "/compliance/oneuptime" })).toBe(
      "compliance/oneuptime/",
    );
    expect(getAuditLogExportFolder({ folder: "compliance//" })).toBe(
      "compliance/",
    );
  });

  test("refuses dot parts, backslashes, control characters and an over-long folder", () => {
    expect(describeFolderProblem("a/../b")).toBe(
      'Folder cannot hold a "." or ".." part.',
    );
    expect(describeFolderProblem("./a")).toBe(
      'Folder cannot hold a "." or ".." part.',
    );
    expect(describeFolderProblem("a\\b")).toBe(
      "Folder cannot hold a backslash or a control character.",
    );
    expect(describeFolderProblem("a\tb")).toBe(
      "Folder cannot hold a backslash or a control character.",
    );
    expect(describeFolderProblem("a".repeat(513))).toBe(
      "Folder can be at most 512 characters long.",
    );
    expect(describeFolderProblem("compliance/2026 archive/")).toBeNull();
  });

  test("a save refuses a folder with a dot part", () => {
    expect(
      refusal(() => {
        return validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: { ...S3_CONFIG, folder: "../escape" },
          secrets: S3_SECRETS,
        });
      }),
    ).toBe('Folder cannot hold a "." or ".." part.');
  });
});

describe("the naming rules", () => {
  test("Amazon S3 bucket names", () => {
    expect(isAmazonS3BucketName("acme-audit-logs")).toBe(true);
    expect(isAmazonS3BucketName("acme.audit.logs")).toBe(true);
    expect(isAmazonS3BucketName("a1b")).toBe(true);
    expect(isAmazonS3BucketName("A1b")).toBe(false);
  });

  test("S3-compatible bucket names", () => {
    expect(isS3CompatibleBucketName("Legacy_Bucket")).toBe(true);
    expect(isS3CompatibleBucketName("")).toBe(false);
    expect(isS3CompatibleBucketName("a b")).toBe(false);
    expect(isS3CompatibleBucketName("a/b")).toBe(false);
  });

  test("regions", () => {
    expect(isS3RegionName("us-east-1")).toBe(true);
    expect(isS3RegionName("auto")).toBe(true);
    expect(isS3RegionName("us-west-004")).toBe(true);
    expect(isS3RegionName("")).toBe(false);
    expect(isS3RegionName("us.east")).toBe(false);
  });

  test("Cloud Storage, Azure and header names", () => {
    expect(isGoogleCloudStorageBucketName("acme_audit-logs")).toBe(true);
    expect(isGoogleCloudStorageBucketName("_acme")).toBe(false);
    expect(isAzureStorageAccountName("acmeaudit01")).toBe(true);
    expect(isAzureStorageAccountName("acme-audit")).toBe(false);
    expect(isAzureContainerName("audit-logs")).toBe(true);
    expect(isAzureContainerName("audit--logs")).toBe(false);
    expect(isAzureContainerName("-audit")).toBe(false);
    expect(isHttpHeaderName("DD-API-KEY")).toBe(true);
    expect(isHttpHeaderName("X_Token")).toBe(true);
    expect(isHttpHeaderName("X Token")).toBe(false);
    expect(isHttpHeaderName("X:Token")).toBe(false);
  });

  test("each rule takes time in line with its input, whatever it is", () => {
    const long: string = `${"a.-".repeat(140000)}!`;
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        isAmazonS3BucketName(long);
        isS3CompatibleBucketName(long);
        isS3RegionName(long);
        isGoogleCloudStorageBucketName(long);
        isAzureStorageAccountName(long);
        isAzureContainerName(long);
        isHttpHeaderName(long);
        isSyslogHost(long);
        describeFolderProblem(long);
        getAuditLogExportFolder({ folder: `${"/".repeat(400000)}a` });
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the egress policy on save", () => {
  startEachTestOnSelfHostedEgressPolicy();

  const webhook: (url: string) => AuditLogExportSettings = (
    url: string,
  ): AuditLogExportSettings => {
    return validate({
      type: AuditLogExportDestinationType.Webhook,
      config: { url },
    });
  };

  test("loopback and cloud metadata addresses are refused for every export", async () => {
    for (const isInstanceExport of [false, true]) {
      await expect(
        AuditLogExportSettingsUtil.assertTargetsAllowed(
          webhook("http://127.0.0.1:8080/hook"),
          { isInstanceExport },
        ),
      ).rejects.toThrow("URL host 127.0.0.1 is not allowed");

      await expect(
        AuditLogExportSettingsUtil.assertTargetsAllowed(
          webhook("http://169.254.169.254/latest/meta-data"),
          { isInstanceExport },
        ),
      ).rejects.toThrow("URL host 169.254.169.254 is not allowed");
    }
  });

  test("a self-hosted project may reach its private network", async () => {
    await expect(
      AuditLogExportSettingsUtil.assertTargetsAllowed(
        webhook("http://10.0.0.7:8080/hook"),
        { isInstanceExport: false },
      ),
    ).resolves.toBeUndefined();
  });

  test("on OneUptime Cloud a project may not reach a private address, while the instance's export may", async () => {
    process.env["BILLING_ENABLED"] = "true";

    await expect(
      AuditLogExportSettingsUtil.assertTargetsAllowed(
        webhook("http://10.0.0.7:8080/hook"),
        { isInstanceExport: false },
      ),
    ).rejects.toThrow("10.0.0.7 is not allowed");

    await expect(
      AuditLogExportSettingsUtil.assertTargetsAllowed(
        webhook("http://10.0.0.7:8080/hook"),
        { isInstanceExport: true },
      ),
    ).resolves.toBeUndefined();
  });

  test("an S3-compatible endpoint and a syslog host are checked too", async () => {
    await expect(
      AuditLogExportSettingsUtil.assertTargetsAllowed(
        validate({
          type: AuditLogExportDestinationType.S3Compatible,
          config: { ...S3_CONFIG, endpoint: "http://127.0.0.1:9000" },
          secrets: S3_SECRETS,
        }),
        { isInstanceExport: false },
      ),
    ).rejects.toThrow("Endpoint host 127.0.0.1 is not allowed");

    await expect(
      AuditLogExportSettingsUtil.assertTargetsAllowed(
        validate({
          type: AuditLogExportDestinationType.Syslog,
          config: { host: "127.0.0.1", port: 6514 },
        }),
        { isInstanceExport: true },
      ),
    ).rejects.toThrow("Syslog host 127.0.0.1 is not allowed");

    // Over UDP too: a datagram reaches only where a connection could.
    await expect(
      AuditLogExportSettingsUtil.assertTargetsAllowed(
        validate({
          type: AuditLogExportDestinationType.Syslog,
          config: { host: "169.254.169.254", protocol: "udp" },
        }),
        { isInstanceExport: true },
      ),
    ).rejects.toThrow("Syslog host 169.254.169.254 is not allowed");
  });

  test("Amazon S3, Cloud Storage and Azure have no address of the export's choosing to check", async () => {
    await expect(
      AuditLogExportSettingsUtil.assertTargetsAllowed(
        validate({
          type: AuditLogExportDestinationType.AmazonS3,
          config: S3_CONFIG,
          secrets: S3_SECRETS,
        }),
        { isInstanceExport: false },
      ),
    ).resolves.toBeUndefined();
  });
});
