import { describe, expect, test } from "@jest/globals";
import AuditLogExportDestinationType, {
  AllAuditLogExportDestinationTypes,
  isAuditLogExportDestinationType,
} from "../../../../Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
  AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT,
  AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_DOCS_PATH,
  AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_PORT,
  AuditLogExportAzureAuthentication,
  AuditLogExportDestinationCatalog,
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationField,
  AuditLogExportDestinationKind,
  AuditLogExportSyslogFraming,
  AuditLogExportSyslogProtocol,
  getAuditLogExportDestinationDefinition,
  getAuditLogExportDestinationTitle,
  getAuditLogExportFieldDefault,
  isAuditLogExportFieldShown,
  readAuditLogExportConfigValue,
} from "../../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import { DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES } from "../../../../Types/DataSource/DataSourceLimits";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The catalog of audit log destinations: what the form asks for, what the
 * server checks on save and what the docs guide names. These pin what the
 * rest of the product reads from it, so a destination added or changed here
 * cannot leave the form, the server or the docs behind.
 */

const definitionOf: (
  type: AuditLogExportDestinationType,
) => AuditLogExportDestinationDefinition = (
  type: AuditLogExportDestinationType,
): AuditLogExportDestinationDefinition => {
  const definition: AuditLogExportDestinationDefinition | undefined =
    getAuditLogExportDestinationDefinition(type);

  if (!definition) {
    throw new Error(`No definition for ${type}`);
  }

  return definition;
};

const allFields: (
  definition: AuditLogExportDestinationDefinition,
) => Array<AuditLogExportDestinationField> = (
  definition: AuditLogExportDestinationDefinition,
): Array<AuditLogExportDestinationField> => {
  return [...definition.configFields, ...definition.secretFields];
};

describe("the recommended audit log destinations", () => {
  test("are the six, in the order the form offers them", () => {
    expect(
      AuditLogExportDestinationCatalog.map(
        (definition: AuditLogExportDestinationDefinition): string => {
          return definition.type;
        },
      ),
    ).toEqual([
      "s3",
      "s3-compatible",
      "google-cloud-storage",
      "azure-blob-storage",
      "webhook",
      "syslog",
    ]);
    expect([...AllAuditLogExportDestinationTypes]).toEqual(
      AuditLogExportDestinationCatalog.map(
        (definition: AuditLogExportDestinationDefinition): string => {
          return definition.type;
        },
      ),
    );
  });

  test("the type values are the stored ones and never change", () => {
    expect(AuditLogExportDestinationType.AmazonS3).toBe("s3");
    expect(AuditLogExportDestinationType.S3Compatible).toBe("s3-compatible");
    expect(AuditLogExportDestinationType.GoogleCloudStorage).toBe(
      "google-cloud-storage",
    );
    expect(AuditLogExportDestinationType.AzureBlobStorage).toBe(
      "azure-blob-storage",
    );
    expect(AuditLogExportDestinationType.Webhook).toBe("webhook");
    expect(AuditLogExportDestinationType.Syslog).toBe("syslog");
  });

  test("isAuditLogExportDestinationType takes the six and nothing else", () => {
    for (const type of AllAuditLogExportDestinationTypes) {
      expect(isAuditLogExportDestinationType(type)).toBe(true);
    }

    for (const other of [
      "S3",
      "google-secops",
      "",
      undefined,
      null,
      7,
      {},
      "webhook ",
    ]) {
      expect(isAuditLogExportDestinationType(other)).toBe(false);
    }
  });

  test("the four storage destinations write files and the other two stream", () => {
    const kindOf: (type: AuditLogExportDestinationType) => string = (
      type: AuditLogExportDestinationType,
    ): string => {
      return definitionOf(type).kind;
    };

    expect(kindOf(AuditLogExportDestinationType.AmazonS3)).toBe(
      AuditLogExportDestinationKind.Files,
    );
    expect(kindOf(AuditLogExportDestinationType.S3Compatible)).toBe(
      AuditLogExportDestinationKind.Files,
    );
    expect(kindOf(AuditLogExportDestinationType.GoogleCloudStorage)).toBe(
      AuditLogExportDestinationKind.Files,
    );
    expect(kindOf(AuditLogExportDestinationType.AzureBlobStorage)).toBe(
      AuditLogExportDestinationKind.Files,
    );
    expect(kindOf(AuditLogExportDestinationType.Webhook)).toBe(
      AuditLogExportDestinationKind.Stream,
    );
    expect(kindOf(AuditLogExportDestinationType.Syslog)).toBe(
      AuditLogExportDestinationKind.Stream,
    );
  });

  test.each(AuditLogExportDestinationCatalog)(
    "$title has a title, a one-line description, an icon and a guide on the export page",
    (definition: AuditLogExportDestinationDefinition) => {
      expect(definition.title.length).toBeGreaterThan(2);
      expect(definition.description.length).toBeGreaterThan(10);
      expect(definition.description.length).toBeLessThanOrEqual(150);
      expect(definition.icon).toBeTruthy();
      expect(
        definition.docsPath.startsWith(`${AUDIT_LOG_EXPORT_DOCS_PATH}#`),
      ).toBe(true);
    },
  );

  test("titles and guide anchors are unique", () => {
    const titles: Array<string> = AuditLogExportDestinationCatalog.map(
      (definition: AuditLogExportDestinationDefinition): string => {
        return definition.title;
      },
    );
    const anchors: Array<string> = AuditLogExportDestinationCatalog.map(
      (definition: AuditLogExportDestinationDefinition): string => {
        return definition.docsPath;
      },
    );

    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  test.each(AuditLogExportDestinationCatalog)(
    "$title: every field has a unique key, a title and a short description",
    (definition: AuditLogExportDestinationDefinition) => {
      const keys: Array<string> = allFields(definition).map(
        (field: AuditLogExportDestinationField): string => {
          return field.key;
        },
      );

      expect(new Set(keys).size).toBe(keys.length);

      for (const field of allFields(definition)) {
        expect(field.title.length).toBeGreaterThan(1);
        expect(field.description.length).toBeGreaterThan(10);
        expect([field.key, field.description.length <= 150]).toEqual([
          field.key,
          true,
        ]);
      }
    },
  );

  test.each(AuditLogExportDestinationCatalog)(
    "$title: a secret is a password or a JSON key, and says it is never returned",
    (definition: AuditLogExportDestinationDefinition) => {
      for (const field of definition.secretFields) {
        expect(["password", "json"]).toContain(field.type);
      }

      // No config field holds something secret.
      for (const field of definition.configFields) {
        expect(field.type).not.toBe("password");
      }
    },
  );

  test.each(AuditLogExportDestinationCatalog)(
    "$title: a dropdown's default is one of its options, and showWhen names a dropdown of the same destination",
    (definition: AuditLogExportDestinationDefinition) => {
      for (const field of allFields(definition)) {
        if (field.type === "dropdown") {
          const values: Array<string> = (field.options || []).map(
            (option: { value: string }): string => {
              return option.value;
            },
          );

          expect(values.length).toBeGreaterThan(1);

          if (field.defaultValue !== undefined) {
            expect(values).toContain(field.defaultValue);
          }
        }

        if (field.showWhen) {
          const controller: AuditLogExportDestinationField | undefined =
            definition.configFields.find(
              (candidate: AuditLogExportDestinationField): boolean => {
                return candidate.key === field.showWhen!.key;
              },
            );

          expect(controller?.type).toBe("dropdown");

          for (const value of field.showWhen.values) {
            expect(
              (controller?.options || []).map(
                (option: { value: string }): string => {
                  return option.value;
                },
              ),
            ).toContain(value);
          }
        }
      }
    },
  );

  test.each(AuditLogExportDestinationCatalog)(
    "$title: a range is a number field's, holds its default, and a followed default follows a dropdown's choices",
    (definition: AuditLogExportDestinationDefinition) => {
      for (const field of allFields(definition)) {
        if (field.minValue !== undefined || field.maxValue !== undefined) {
          expect([field.key, field.type]).toEqual([field.key, "number"]);
          expect(field.minValue).toBeDefined();
          expect(field.maxValue).toBeDefined();
          expect(field.minValue!).toBeLessThanOrEqual(field.maxValue!);

          const defaults: Array<string | number> = [
            ...(field.defaultValue === undefined ? [] : [field.defaultValue]),
            ...Object.values(field.defaultFollows?.values || {}),
            ...(field.placeholder ? [Number(field.placeholder)] : []),
          ] as Array<string | number>;

          for (const value of defaults) {
            expect(Number(value)).toBeGreaterThanOrEqual(field.minValue!);
            expect(Number(value)).toBeLessThanOrEqual(field.maxValue!);
          }
        }

        if (!field.defaultFollows) {
          continue;
        }

        const controller: AuditLogExportDestinationField | undefined =
          definition.configFields.find(
            (candidate: AuditLogExportDestinationField): boolean => {
              return candidate.key === field.defaultFollows!.key;
            },
          );
        const choices: Array<string> = (controller?.options || []).map(
          (option: { value: string }): string => {
            return option.value;
          },
        );

        expect(controller?.type).toBe("dropdown");

        for (const choice of Object.keys(field.defaultFollows.values)) {
          expect(choices).toContain(choice);
        }

        /*
         * The field's own default is the one of the controller's default
         * choice, so a config that names no choice reads the same default
         * either way.
         */
        const defaultChoice: string = String(controller?.defaultValue);

        if (
          Object.prototype.hasOwnProperty.call(
            field.defaultFollows.values,
            defaultChoice,
          )
        ) {
          expect(field.defaultFollows.values[defaultChoice]).toBe(
            field.defaultValue,
          );
        }
      }
    },
  );

  test.each(AuditLogExportDestinationCatalog)(
    "$title: a batch fits one request the egress-guarded client sends",
    (definition: AuditLogExportDestinationDefinition) => {
      expect(definition.maxEntriesPerBatch).toBeGreaterThan(0);
      expect(definition.maxBytesPerBatch).toBeGreaterThan(64 * 1024);
      expect(definition.maxBytesPerBatch).toBeLessThan(
        DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES,
      );
    },
  );

  test("a webhook batch stays well under the 1 MB request limit most receivers start with", () => {
    expect(
      definitionOf(AuditLogExportDestinationType.Webhook).maxBytesPerBatch,
    ).toBeLessThanOrEqual(1024 * 1024);
  });

  test("every file destination offers a folder, defaulting to the documented one", () => {
    for (const definition of AuditLogExportDestinationCatalog) {
      if (definition.kind !== AuditLogExportDestinationKind.Files) {
        continue;
      }

      const folder: AuditLogExportDestinationField | undefined =
        definition.configFields.find(
          (field: AuditLogExportDestinationField): boolean => {
            return field.key === "folder";
          },
        );

      expect(folder?.isAdvanced).toBe(true);
      expect(folder?.required).toBe(false);
      expect(folder?.placeholder).toBe(AUDIT_LOG_EXPORT_DEFAULT_FOLDER);
    }
  });

  test("Amazon S3 asks for no endpoint; S3-compatible storage requires one first", () => {
    expect(
      definitionOf(AuditLogExportDestinationType.AmazonS3).configFields.map(
        (field: AuditLogExportDestinationField): string => {
          return field.key;
        },
      ),
    ).toEqual(["bucket", "region", "accessKeyId", "folder"]);

    const compatible: Array<AuditLogExportDestinationField> = definitionOf(
      AuditLogExportDestinationType.S3Compatible,
    ).configFields;

    expect(compatible[0]?.key).toBe("endpoint");
    expect(compatible[0]?.required).toBe(true);
    expect(compatible[0]?.type).toBe("url");
  });

  test("getAuditLogExportDestinationTitle names each type, and nothing for an unknown one", () => {
    expect(getAuditLogExportDestinationTitle("s3")).toBe("Amazon S3");
    expect(getAuditLogExportDestinationTitle("syslog")).toBe("Syslog");
    expect(getAuditLogExportDestinationTitle("nope")).toBe("");
    expect(getAuditLogExportDestinationTitle(undefined)).toBe("");
  });
});

describe("which fields apply to a config", () => {
  const azure: AuditLogExportDestinationDefinition = definitionOf(
    AuditLogExportDestinationType.AzureBlobStorage,
  );
  const sasToken: AuditLogExportDestinationField = azure.secretFields.find(
    (field: AuditLogExportDestinationField): boolean => {
      return field.key === "sasToken";
    },
  )!;
  const accountKey: AuditLogExportDestinationField = azure.secretFields.find(
    (field: AuditLogExportDestinationField): boolean => {
      return field.key === "accountKey";
    },
  )!;

  test("Azure starts on a SAS token: the access key is not asked", () => {
    expect(
      isAuditLogExportFieldShown({
        definition: azure,
        field: sasToken,
        config: {},
      }),
    ).toBe(true);
    expect(
      isAuditLogExportFieldShown({
        definition: azure,
        field: accountKey,
        config: {},
      }),
    ).toBe(false);
  });

  test("Sign in with an access key asks for the key and not the token", () => {
    const config: { authentication: string } = {
      authentication: AuditLogExportAzureAuthentication.AccessKey,
    };

    expect(
      isAuditLogExportFieldShown({
        definition: azure,
        field: sasToken,
        config,
      }),
    ).toBe(false);
    expect(
      isAuditLogExportFieldShown({
        definition: azure,
        field: accountKey,
        config,
      }),
    ).toBe(true);
  });

  test("a field with no condition always applies", () => {
    for (const field of azure.configFields) {
      if (!field.showWhen) {
        expect(
          isAuditLogExportFieldShown({
            definition: azure,
            field,
            config: { authentication: "anything" },
          }),
        ).toBe(true);
      }
    }
  });

  test("the syslog CA certificate is asked over TLS only", () => {
    const syslog: AuditLogExportDestinationDefinition = definitionOf(
      AuditLogExportDestinationType.Syslog,
    );
    const ca: AuditLogExportDestinationField = syslog.configFields.find(
      (field: AuditLogExportDestinationField): boolean => {
        return field.key === "caCertificate";
      },
    )!;

    expect(ca.isMultiline).toBe(true);
    expect(
      isAuditLogExportFieldShown({ definition: syslog, field: ca, config: {} }),
    ).toBe(true);
    expect(
      isAuditLogExportFieldShown({
        definition: syslog,
        field: ca,
        config: { protocol: "tcp" },
      }),
    ).toBe(false);
  });

  test("syslog framing is asked over TLS and TCP, the maximum message size over UDP only", () => {
    const syslog: AuditLogExportDestinationDefinition = definitionOf(
      AuditLogExportDestinationType.Syslog,
    );
    const shown: (key: string, config: JSONObject) => boolean = (
      key: string,
      config: JSONObject,
    ): boolean => {
      return isAuditLogExportFieldShown({
        definition: syslog,
        field: syslog.configFields.find(
          (field: AuditLogExportDestinationField): boolean => {
            return field.key === key;
          },
        )!,
        config,
      });
    };

    // No protocol named is TLS, the default.
    expect(shown("framing", {})).toBe(true);
    expect(shown("framing", { protocol: "tcp" })).toBe(true);
    expect(shown("framing", { protocol: "udp" })).toBe(false);

    expect(shown("maxMessageSize", {})).toBe(false);
    expect(shown("maxMessageSize", { protocol: "tcp" })).toBe(false);
    expect(shown("maxMessageSize", { protocol: "udp" })).toBe(true);

    expect(shown("caCertificate", { protocol: "udp" })).toBe(false);

    // Host, port and protocol are asked whatever the protocol.
    for (const protocol of ["tls", "tcp", "udp"]) {
      for (const key of ["host", "port", "protocol"]) {
        expect([key, protocol, shown(key, { protocol })]).toEqual([
          key,
          protocol,
          true,
        ]);
      }
    }
  });

  test("readAuditLogExportConfigValue falls back to the default for empty values", () => {
    const region: AuditLogExportDestinationField = definitionOf(
      AuditLogExportDestinationType.AmazonS3,
    ).configFields.find((field: AuditLogExportDestinationField): boolean => {
      return field.key === "region";
    })!;

    expect(readAuditLogExportConfigValue({}, region)).toBe("us-east-1");
    expect(readAuditLogExportConfigValue({ region: "  " }, region)).toBe(
      "us-east-1",
    );
    expect(readAuditLogExportConfigValue({ region: null }, region)).toBe(
      "us-east-1",
    );
    expect(readAuditLogExportConfigValue(null, region)).toBe("us-east-1");
    expect(readAuditLogExportConfigValue({ region: "eu-west-1" }, region)).toBe(
      "eu-west-1",
    );
  });
});

/*
 * Issue #6392: syslog over UDP, for receivers that take nothing else - one
 * datagram per message (RFC 5426), on port 514 unless the export says
 * another, at most Maximum message size bytes each.
 */
describe("syslog over UDP", () => {
  const syslog: AuditLogExportDestinationDefinition = definitionOf(
    AuditLogExportDestinationType.Syslog,
  );
  const fieldOf: (key: string) => AuditLogExportDestinationField = (
    key: string,
  ): AuditLogExportDestinationField => {
    return syslog.configFields.find(
      (field: AuditLogExportDestinationField): boolean => {
        return field.key === key;
      },
    )!;
  };

  test("the protocol offers TLS, TCP and UDP, stored as they always will be; TLS stays the default", () => {
    expect(AuditLogExportSyslogProtocol.Tls).toBe("tls");
    expect(AuditLogExportSyslogProtocol.Tcp).toBe("tcp");
    expect(AuditLogExportSyslogProtocol.Udp).toBe("udp");
    expect(fieldOf("protocol").options).toEqual([
      { label: "TLS", value: "tls" },
      { label: "TCP", value: "tcp" },
      { label: "UDP", value: "udp" },
    ]);
    expect(fieldOf("protocol").defaultValue).toBe("tls");
    expect(syslog.description).toBe(
      "One RFC 5424 message per entry to a syslog receiver, over TLS, TCP or UDP.",
    );
  });

  test("the protocol's description says UDP is plain text, and confirms nothing", () => {
    expect(fieldOf("protocol").description).toBe(
      "TLS encrypts the audit log on the way. TCP sends it as plain text. UDP sends it as plain text, with nothing to confirm it arrived.",
    );
  });

  test("the numbers RFC 5426 and rsyslog set", () => {
    expect(AUDIT_LOG_EXPORT_SYSLOG_UDP_PORT).toBe(514);
    expect(AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT).toBe(6514);
    // rsyslog's own default: what it keeps of a message unless told otherwise.
    expect(AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE).toBe(8192);
    // The 1024 bytes of BSD syslog (RFC 3164), which older receivers still read by.
    expect(AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE).toBe(1024);
    // 65,535 bytes less the IPv4 header (20) and the UDP header (8).
    expect(AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE).toBe(65535 - 20 - 8);
  });

  test("the port is a number from 1 to 65535 whose default follows the protocol: 514 over UDP", () => {
    const port: AuditLogExportDestinationField = fieldOf("port");

    expect(port.type).toBe("number");
    expect([port.minValue, port.maxValue]).toEqual([1, 65535]);
    expect(port.defaultValue).toBe(6514);
    expect(port.defaultFollows).toEqual({
      key: "protocol",
      values: { tls: 6514, udp: 514 },
    });
    expect(port.description).toBe(
      "The receiver's port: 6514 for syslog over TLS, 514 over UDP, often 514 or 601 over TCP.",
    );
  });

  test("a port nobody named reads the protocol's default; TCP keeps 6514, as it always has", () => {
    const port: AuditLogExportDestinationField = fieldOf("port");
    const cases: Array<[JSONObject | null, number]> = [
      [null, 6514],
      [{}, 6514],
      [{ protocol: "tls" }, 6514],
      [{ protocol: "tcp" }, 6514],
      [{ protocol: "udp" }, 514],
      [{ protocol: " udp " }, 514],
      [{ protocol: "udp", port: "" }, 514],
      [{ protocol: "udp", port: "  " }, 514],
      [{ protocol: "udp", port: null }, 514],
      // A choice the catalog does not know keeps the field's own default.
      [{ protocol: "sctp" }, 6514],
      [{ protocol: 17 }, 6514],
      // A name every object holds is never read as a choice.
      [{ protocol: "constructor" }, 6514],
      [{ protocol: "__proto__" }, 6514],
      [{ protocol: "toString" }, 6514],
    ];

    for (const [config, expected] of cases) {
      expect([config, readAuditLogExportConfigValue(config, port)]).toEqual([
        config,
        expected,
      ]);
    }

    // A port someone named is the port, whatever the protocol.
    expect(
      readAuditLogExportConfigValue({ protocol: "udp", port: 1514 }, port),
    ).toBe(1514);
    expect(
      readAuditLogExportConfigValue({ protocol: "tls", port: 514 }, port),
    ).toBe(514);
  });

  test("getAuditLogExportFieldDefault is a field's own default when it follows nothing", () => {
    expect(
      getAuditLogExportFieldDefault({ protocol: "udp" }, fieldOf("framing")),
    ).toBe(AuditLogExportSyslogFraming.OctetCounting);
    expect(
      getAuditLogExportFieldDefault({ protocol: "udp" }, fieldOf("host")),
    ).toBeUndefined();
    expect(getAuditLogExportFieldDefault(null, fieldOf("port"))).toBe(6514);
    expect(getAuditLogExportFieldDefault(undefined, fieldOf("port"))).toBe(
      6514,
    );
  });

  test("the maximum message size: optional, folded, UDP only, from 1024 to 65507, 8192 when left empty", () => {
    const size: AuditLogExportDestinationField = fieldOf("maxMessageSize");

    expect(size.title).toBe("Maximum message size");
    expect(size.type).toBe("number");
    expect(size.required).toBe(false);
    expect(size.isAdvanced).toBe(true);
    expect(size.showWhen).toEqual({ key: "protocol", values: ["udp"] });
    expect([size.minValue, size.maxValue]).toEqual([1024, 65507]);
    // Nothing is stored for it: an export that names no size follows the release's default.
    expect(size.defaultValue).toBeUndefined();
    expect(size.placeholder).toBe("8192");
    expect(size.description).toBe(
      "The longest message the receiver takes, in bytes. A longer entry is shortened to fit, and says so. Leave empty for 8192.",
    );
  });

  test("framing is folded and asked over TLS and TCP only: a datagram is its own frame", () => {
    expect(fieldOf("framing").isAdvanced).toBe(true);
    expect(fieldOf("framing").showWhen).toEqual({
      key: "protocol",
      values: ["tls", "tcp"],
    });
  });

  test("the form asks host, port and protocol first, then folds framing, the size and the CA certificate", () => {
    expect(
      syslog.configFields.map(
        (field: AuditLogExportDestinationField): [string, boolean] => {
          return [field.key, Boolean(field.isAdvanced)];
        },
      ),
    ).toEqual([
      ["host", false],
      ["port", false],
      ["protocol", false],
      ["framing", true],
      ["maxMessageSize", true],
      ["caCertificate", true],
    ]);
  });
});
