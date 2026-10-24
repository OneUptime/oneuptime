import { describe, expect, test } from "@jest/globals";
import {
  AuditLogExportCopy,
  AuditLogExportHealth,
} from "../../../Dashboard/AuditLogExport/AuditLogExportCopy";
import {
  AuditLogExportFormSubmission,
  auditLogExportTestBody,
  auditLogExportTestDisabledReason,
  auditLogExportUpdatePayload,
  describeAuditLogExportTarget,
  exportConfigFieldName,
  exportSecretFieldName,
  formatAuditLogExportDuration,
  getAuditLogExportHealth,
  getAuditLogExportInitialValues,
  readAuditLogExportForm,
} from "../../../Dashboard/AuditLogExport/AuditLogExportForm";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AuditLogExportDestinationCatalog,
  AuditLogExportDestinationDefinition,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * The audit log export form and table without React: what the form's
 * values become when they are saved or tested, and what the table says about
 * an export. A credential is sent only when typed, never read back into the
 * form, and never shown in the table; a field another field turns off is
 * not sent; Export From restarts an export only when it moved; the form
 * never writes the on/off switch, which is the row's Turn on and Turn off.
 */

const S3: AuditLogExportDestinationType =
  AuditLogExportDestinationType.AmazonS3;
const AZURE: AuditLogExportDestinationType =
  AuditLogExportDestinationType.AzureBlobStorage;
const SYSLOG: AuditLogExportDestinationType =
  AuditLogExportDestinationType.Syslog;
const GCS: AuditLogExportDestinationType =
  AuditLogExportDestinationType.GoogleCloudStorage;
const WEBHOOK: AuditLogExportDestinationType =
  AuditLogExportDestinationType.Webhook;

const EXPORT_ID: string = "7a000000-0000-4000-8000-000000000001";

function s3Values(extra: JSONObject = {}): JSONObject {
  return {
    destinationType: S3,
    [exportConfigFieldName(S3, "bucket")]: "  acme-audit-logs  ",
    [exportConfigFieldName(S3, "region")]: "eu-west-1",
    [exportConfigFieldName(S3, "accessKeyId")]: "AKIAIOSFODNN7EXAMPLE",
    [exportSecretFieldName(S3, "secretAccessKey")]: new HashedString(
      "wJalrXUtnFEMI/K7MDENG",
    ) as unknown as JSONObject,
    ...extra,
  };
}

function savedExport(fields: Partial<Record<string, unknown>>): AuditLogExport {
  const item: AuditLogExport = new AuditLogExport();
  item.id = new ObjectID(EXPORT_ID);

  for (const key of Object.keys(fields)) {
    (item as unknown as Record<string, unknown>)[key] = fields[key];
  }

  return item;
}

describe("the form's field names", () => {
  test("each destination's fields are named apart, so S3's bucket is never Google Cloud Storage's", () => {
    expect(exportConfigFieldName(S3, "bucket")).not.toBe(
      exportConfigFieldName(GCS, "bucket"),
    );
    expect(exportConfigFieldName(S3, "bucket")).not.toBe(
      exportSecretFieldName(S3, "bucket"),
    );
  });
});

describe("readAuditLogExportForm", () => {
  test("reads the picked destination's config and the typed credentials, trimmed", () => {
    const submission: AuditLogExportFormSubmission =
      readAuditLogExportForm(s3Values());

    expect(submission).toEqual({
      destinationType: S3,
      name: "Amazon S3",
      config: {
        bucket: "acme-audit-logs",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
      secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG" },
      startsAt: null,
    });
  });

  test("keeps a typed name, and leaves out another destination's values", () => {
    const submission: AuditLogExportFormSubmission = readAuditLogExportForm(
      s3Values({
        name: "Compliance archive",
        [exportConfigFieldName(GCS, "bucket")]: "someone-else",
      }),
    );

    expect(submission.name).toBe("Compliance archive");
    expect(submission.config).not.toHaveProperty("someone-else");
    expect(Object.values(submission.config)).not.toContain("someone-else");
  });

  test("an edit keeps its destination whatever the values say", () => {
    expect(
      readAuditLogExportForm(
        { destinationType: GCS, [exportConfigFieldName(S3, "bucket")]: "b" },
        S3,
      ).destinationType,
    ).toBe(S3);
  });

  test("refuses to read a form with no destination", () => {
    expect(() => {
      return readAuditLogExportForm({});
    }).toThrow(AuditLogExportCopy.testChooseDestinationFirst);
  });

  test("a field another field turns off is not sent: Azure's access key with a SAS token, and the other way round", () => {
    const base: JSONObject = {
      destinationType: AZURE,
      [exportConfigFieldName(AZURE, "accountName")]: "acmeauditlogs",
      [exportConfigFieldName(AZURE, "container")]: "audit-logs",
      [exportSecretFieldName(AZURE, "sasToken")]: "sv=2022&sig=abc",
      [exportSecretFieldName(AZURE, "accountKey")]: "a-whole-account-key",
    };

    const withSas: AuditLogExportFormSubmission = readAuditLogExportForm({
      ...base,
      [exportConfigFieldName(AZURE, "authentication")]: "sas",
    });
    const withKey: AuditLogExportFormSubmission = readAuditLogExportForm({
      ...base,
      [exportConfigFieldName(AZURE, "authentication")]: {
        label: "Access key",
        value: "access-key",
      },
    });

    expect(withSas.secrets).toEqual({ sasToken: "sv=2022&sig=abc" });
    expect(withKey.config["authentication"]).toBe("access-key");
    expect(withKey.secrets).toEqual({ accountKey: "a-whole-account-key" });
  });

  test("a syslog CA certificate is sent only over TLS, kept byte for byte, and the port is a number", () => {
    const certificate: string =
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    const values: JSONObject = {
      destinationType: SYSLOG,
      [exportConfigFieldName(SYSLOG, "host")]: "siem.acme.internal",
      [exportConfigFieldName(SYSLOG, "port")]: "6514",
      [exportConfigFieldName(SYSLOG, "caCertificate")]: certificate,
    };

    const overTls: AuditLogExportFormSubmission = readAuditLogExportForm({
      ...values,
      [exportConfigFieldName(SYSLOG, "protocol")]: "tls",
    });
    const overTcp: AuditLogExportFormSubmission = readAuditLogExportForm({
      ...values,
      [exportConfigFieldName(SYSLOG, "protocol")]: "tcp",
    });

    expect(overTls.config["caCertificate"]).toBe(certificate);
    expect(overTls.config["port"]).toBe(6514);
    expect(overTcp.config).not.toHaveProperty("caCertificate");
  });

  test("a pasted service account key is sent as pasted, newlines included", () => {
    const key: string = '{\n  "client_email": "x@y.iam.gserviceaccount.com"\n}';

    expect(
      readAuditLogExportForm({
        destinationType: GCS,
        [exportConfigFieldName(GCS, "bucket")]: "b",
        [exportSecretFieldName(GCS, "serviceAccountJson")]: key,
      }).secrets,
    ).toEqual({ serviceAccountJson: key });
  });

  test("Export From is read as a date, and only when one was picked", () => {
    expect(
      readAuditLogExportForm(s3Values({ startsAt: "2026-10-01T00:00:00.000Z" }))
        .startsAt,
    ).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(readAuditLogExportForm(s3Values({ startsAt: "" })).startsAt).toBe(
      null,
    );
    expect(
      readAuditLogExportForm(s3Values({ startsAt: "not a date" })).startsAt,
    ).toBe(null);
  });
});

describe("what the form's test sends", () => {
  test("a new export sends its destination and the settings as typed", () => {
    expect(auditLogExportTestBody({ values: s3Values() })).toEqual({
      destinationType: S3,
      config: {
        bucket: "acme-audit-logs",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
      secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG" },
    });
  });

  test("an edit sends the saved export's id, its edits, and only the credentials typed", () => {
    const body: JSONObject = auditLogExportTestBody({
      values: s3Values({
        [exportSecretFieldName(S3, "secretAccessKey")]: "",
      }),
      auditLogExport: savedExport({ destinationType: S3 }),
    });

    expect(body).toEqual({
      exportId: EXPORT_ID,
      config: {
        bucket: "acme-audit-logs",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
      secrets: {},
    });
    expect(body).not.toHaveProperty("destinationType");
  });
});

describe("why the form's test cannot run yet", () => {
  test("no destination, then a missing setting, then a missing credential", () => {
    expect(auditLogExportTestDisabledReason({ values: {} })).toBe(
      AuditLogExportCopy.testChooseDestinationFirst,
    );
    expect(
      auditLogExportTestDisabledReason({ values: { destinationType: S3 } }),
    ).toBe(AuditLogExportCopy.testFillSettingsFirst);
    expect(
      auditLogExportTestDisabledReason({
        values: s3Values({
          [exportSecretFieldName(S3, "secretAccessKey")]: "",
        }),
      }),
    ).toBe(AuditLogExportCopy.testPasteCredentialsFirst);
    expect(
      auditLogExportTestDisabledReason({ values: s3Values() }),
    ).toBeUndefined();
  });

  test("a setting with a default is never missing: the region starts on us-east-1", () => {
    expect(
      auditLogExportTestDisabledReason({
        values: s3Values({ [exportConfigFieldName(S3, "region")]: "" }),
      }),
    ).toBeUndefined();
  });

  test("an edit tests with the stored credential, so none has to be pasted", () => {
    expect(
      auditLogExportTestDisabledReason({
        values: s3Values({
          [exportSecretFieldName(S3, "secretAccessKey")]: "",
        }),
        auditLogExport: savedExport({ destinationType: S3 }),
      }),
    ).toBeUndefined();
  });

  test("a credential another field turns off is never asked for", () => {
    expect(
      auditLogExportTestDisabledReason({
        values: {
          destinationType: AZURE,
          [exportConfigFieldName(AZURE, "accountName")]: "acmeauditlogs",
          [exportConfigFieldName(AZURE, "container")]: "audit-logs",
          [exportConfigFieldName(AZURE, "authentication")]: "access-key",
          [exportSecretFieldName(AZURE, "accountKey")]: "k",
        },
      }),
    ).toBeUndefined();
  });

  test("a webhook needs no credential, a syslog receiver none at all", () => {
    expect(
      auditLogExportTestDisabledReason({
        values: {
          destinationType: WEBHOOK,
          [exportConfigFieldName(WEBHOOK, "url")]: "https://logs.example.com",
        },
      }),
    ).toBeUndefined();
    expect(
      auditLogExportTestDisabledReason({
        values: {
          destinationType: SYSLOG,
          [exportConfigFieldName(SYSLOG, "host")]: "siem.acme.internal",
        },
      }),
    ).toBeUndefined();
  });
});

describe("what an edit saves", () => {
  const stored: AuditLogExport = savedExport({
    destinationType: S3,
    startsAt: new Date("2026-10-01T12:00:00.250Z"),
  });

  test("a blank credential keeps the stored one: it is left out", () => {
    const payload: JSONObject = auditLogExportUpdatePayload({
      submission: readAuditLogExportForm(
        s3Values({ [exportSecretFieldName(S3, "secretAccessKey")]: "" }),
        S3,
      ),
      auditLogExport: stored,
    });

    expect(payload).not.toHaveProperty("secrets");
    expect(payload).toEqual({
      name: "Amazon S3",
      config: {
        bucket: "acme-audit-logs",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
    });
  });

  test("a typed credential replaces it", () => {
    expect(
      auditLogExportUpdatePayload({
        submission: readAuditLogExportForm(s3Values(), S3),
        auditLogExport: stored,
      })["secrets"],
    ).toBe(JSON.stringify({ secretAccessKey: "wJalrXUtnFEMI/K7MDENG" }));
  });

  test("Export From is sent only when it moved - sending it starts the export again", () => {
    const unchanged: JSONObject = auditLogExportUpdatePayload({
      submission: readAuditLogExportForm(
        // The field shows seconds: the stored milliseconds are not a move.
        s3Values({ startsAt: "2026-10-01T12:00:00.000Z" }),
        S3,
      ),
      auditLogExport: stored,
    });
    const moved: JSONObject = auditLogExportUpdatePayload({
      submission: readAuditLogExportForm(
        s3Values({ startsAt: "2026-09-01T00:00:00.000Z" }),
        S3,
      ),
      auditLogExport: stored,
    });

    expect(unchanged).not.toHaveProperty("startsAt");
    expect(moved["startsAt"]).toBe("2026-09-01T00:00:00.000Z");
  });

  test("never writes the on/off switch: a switch flipped in the row while the form was open stays flipped", () => {
    for (const isEnabled of [true, false]) {
      expect(
        auditLogExportUpdatePayload({
          submission: readAuditLogExportForm(s3Values({ isEnabled }), S3),
          auditLogExport: savedExport({
            destinationType: S3,
            isEnabled: !isEnabled,
          }),
        }),
      ).not.toHaveProperty("isEnabled");
    }
  });
});

describe("the form's values for a saved export", () => {
  test("hold its config and name, never a credential", () => {
    const values: JSONObject = getAuditLogExportInitialValues(
      savedExport({
        name: "Compliance archive",
        destinationType: SYSLOG,
        config: { host: "siem.acme.internal", port: 6514, protocol: "tls" },
        secrets: JSON.stringify({ secret: "never" }),
        isEnabled: false,
        startsAt: new Date("2026-10-01T12:00:00.000Z"),
      }),
      SYSLOG,
    );

    expect(values).toEqual({
      name: "Compliance archive",
      destinationType: SYSLOG,
      startsAt: "2026-10-01T12:00:00.000Z",
      [exportConfigFieldName(SYSLOG, "host")]: "siem.acme.internal",
      [exportConfigFieldName(SYSLOG, "port")]: "6514",
      [exportConfigFieldName(SYSLOG, "protocol")]: "tls",
    });
    expect(JSON.stringify(values)).not.toContain("never");
  });

  test("a new export starts unnamed, with no destination picked", () => {
    expect(getAuditLogExportInitialValues(undefined, undefined)).toEqual({
      name: "",
    });
  });
});

describe("where an export sends, under its name", () => {
  test.each<[AuditLogExportDestinationType, JSONObject, string]>([
    [S3, { bucket: "acme", region: "eu-west-1" }, "acme/oneuptime/audit-logs/"],
    // S3-compatible storage names its endpoint's host, as a path-style address does.
    [
      AuditLogExportDestinationType.S3Compatible,
      {
        endpoint: "https://minio.acme.internal:9000",
        bucket: "acme",
        folder: "/audit/",
      },
      "minio.acme.internal:9000/acme/audit/",
    ],
    [
      AuditLogExportDestinationType.S3Compatible,
      {
        endpoint: "https://0123abcd.r2.cloudflarestorage.com/",
        bucket: "acme",
      },
      "0123abcd.r2.cloudflarestorage.com/acme/oneuptime/audit-logs/",
    ],
    // An endpoint that is not a URL reads as typed; none, as the bucket alone.
    [
      AuditLogExportDestinationType.S3Compatible,
      { endpoint: "minio", bucket: "acme", folder: "a/" },
      "minio/acme/a/",
    ],
    [
      AuditLogExportDestinationType.S3Compatible,
      { bucket: "acme", folder: "/audit/" },
      "acme/audit/",
    ],
    [GCS, { bucket: "acme-lake", folder: "a/b/" }, "acme-lake/a/b/"],
    [
      AZURE,
      { accountName: "acct", container: "logs", folder: "x/" },
      "acct/logs/x/",
    ],
    [
      WEBHOOK,
      { url: "https://http-inputs-acme.splunkcloud.com/services/collector" },
      "http-inputs-acme.splunkcloud.com",
    ],
    [WEBHOOK, { url: "not a url" }, "not a url"],
    [SYSLOG, { host: "10.20.0.15", port: 6514 }, "10.20.0.15:6514"],
    [SYSLOG, { host: "siem" }, "siem"],
  ])(
    "%s %j -> %s",
    (
      type: AuditLogExportDestinationType,
      config: JSONObject,
      expected: string,
    ) => {
      expect(
        describeAuditLogExportTarget({
          destinationType: type,
          config,
        } as AuditLogExport),
      ).toBe(expected);
    },
  );

  test("never a credential, for any destination", () => {
    for (const definition of AuditLogExportDestinationCatalog as Array<AuditLogExportDestinationDefinition>) {
      const config: JSONObject = {};

      for (const field of definition.configFields) {
        config[field.key] = "visible";
      }

      for (const field of definition.secretFields) {
        config[field.key] = "SECRET-VALUE";
      }

      expect(
        describeAuditLogExportTarget({
          destinationType: definition.type,
          config,
        } as AuditLogExport),
      ).not.toContain("SECRET-VALUE");
    }
  });
});

describe("how long an export has been failing, in the reader's language", () => {
  const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
  // French puts a no-break space between a number and its unit.
  const ANY_SPACE: RegExp = /\s/gu;
  const before: (seconds: number) => Date = (seconds: number): Date => {
    return new Date(NOW.getTime() - seconds * 1000);
  };

  test.each<[string, number, string]>([
    // A span, never "ago": it fills "Failing for {{duration}}".
    ["en", 2 * 60 * 60, "2 hours"],
    ["en", 60 * 60, "1 hour"],
    ["en", 3 * 24 * 60 * 60, "3 days"],
    // Rounded as the table's "3 minutes ago" is, and never under a minute.
    ["en", 20, "1 minute"],
    ["en", 7 * 60 + 20, "7 minutes"],
    // Each language words its own unit: "seit 2 Stunden", never "seit vor 2 Stunden".
    ["de", 2 * 60 * 60, "2 Stunden"],
    ["fr", 2 * 60 * 60, "2 heures"],
    ["ru", 5 * 60 * 60, "5 часов"],
    ["ja", 2 * 60 * 60, "2 時間"],
  ])(
    "%s, %i seconds -> %s",
    (language: string, seconds: number, expected: string) => {
      expect(
        formatAuditLogExportDuration({
          since: before(seconds),
          now: NOW,
          language,
        }).replace(ANY_SPACE, " "),
      ).toBe(expected);
    },
  );

  test("digits are Latin in every language, as every other date on the page", () => {
    expect(
      formatAuditLogExportDuration({
        since: before(2 * 60 * 60),
        now: NOW,
        language: "fa",
      }),
    ).toContain("2");
  });

  test("a clock a little ahead of the server's still reads one minute", () => {
    expect(
      formatAuditLogExportDuration({
        since: new Date(NOW.getTime() + 30 * 1000),
        now: NOW,
        language: "en",
      }),
    ).toBe("1 minute");
  });

  test("a date that is not one says nothing", () => {
    expect(
      formatAuditLogExportDuration({
        since: new Date("not a date"),
        now: NOW,
        language: "en",
      }),
    ).toBe("");
  });
});

describe("how an export is doing", () => {
  test.each<[string, Record<string, unknown>, AuditLogExportHealth]>([
    ["off", { isEnabled: false, lastError: "x" }, AuditLogExportHealth.Paused],
    [
      "failing",
      { isEnabled: true, lastError: "403", lastExportedAt: new Date() },
      AuditLogExportHealth.Failing,
    ],
    [
      "delivered",
      { isEnabled: true, lastExportedAt: new Date() },
      AuditLogExportHealth.Exporting,
    ],
    [
      "tried, nothing to send",
      { isEnabled: true, lastAttemptAt: new Date() },
      AuditLogExportHealth.Waiting,
    ],
    ["never tried", { isEnabled: true }, AuditLogExportHealth.Starting],
  ])(
    "%s",
    (
      _name: string,
      fields: Record<string, unknown>,
      health: AuditLogExportHealth,
    ) => {
      expect(getAuditLogExportHealth(fields as unknown as AuditLogExport)).toBe(
        health,
      );
    },
  );
});
