import { describe, expect, test } from "@jest/globals";
import AuditLogExportDestinationType, {
  AllAuditLogExportDestinationTypes,
  isAuditLogExportDestinationType,
} from "../../../../Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
  AUDIT_LOG_EXPORT_DOCS_PATH,
  AuditLogExportAzureAuthentication,
  AuditLogExportDestinationCatalog,
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationField,
  AuditLogExportDestinationKind,
  getAuditLogExportDestinationDefinition,
  getAuditLogExportDestinationTitle,
  isAuditLogExportFieldShown,
  readAuditLogExportConfigValue,
} from "../../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import { DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES } from "../../../../Types/DataSource/DataSourceLimits";

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
