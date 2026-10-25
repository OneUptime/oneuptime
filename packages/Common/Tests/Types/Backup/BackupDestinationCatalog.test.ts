import { describe, expect, test } from "@jest/globals";
import { AuditLogExportAzureAuthentication } from "../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import BackupDestinationType, {
  AllBackupDestinationTypes,
  isBackupDestinationType,
  isS3ProtocolBackupDestination,
} from "../../../Types/Backup/BackupDestinationType";
import {
  BACKUP_DEFAULT_FOLDER,
  BACKUP_DOCS_PATH,
  BackupDestinationCatalog,
  BackupDestinationDefinition,
  BackupDestinationField,
  BackupProvider,
  BackupProviderCatalog,
  BackupProviderDefinition,
  getBackupDestinationDefinition,
  getBackupDestinationTitle,
  getBackupProviderDefinition,
  inferS3RegionFromEndpoint,
  isBackupFieldShown,
  resolveBackupProvider,
} from "../../../Types/Backup/BackupDestinationCatalog";

/*
 * Where backups can go: four kinds of storage, and the products people
 * know (the recommended destinations) as providers of one of them. The
 * form, the server's validation and the docs all read this catalog, so it
 * is held here to what each of them relies on.
 */

function definitionOf(
  type: BackupDestinationType,
): BackupDestinationDefinition {
  const definition: BackupDestinationDefinition | undefined =
    getBackupDestinationDefinition(type);

  if (!definition) {
    throw new Error(`No definition for ${type}`);
  }

  return definition;
}

function fieldOf(
  definition: BackupDestinationDefinition,
  key: string,
): BackupDestinationField {
  const field: BackupDestinationField | undefined = [
    ...definition.configFields,
    ...definition.secretFields,
  ].find((candidate: BackupDestinationField): boolean => {
    return candidate.key === key;
  });

  if (!field) {
    throw new Error(`No field ${key} on ${definition.type}`);
  }

  return field;
}

describe("BackupDestinationCatalog", () => {
  test("has one definition for each kind of storage, and no other", () => {
    expect(
      BackupDestinationCatalog.map(
        (definition: BackupDestinationDefinition) => {
          return definition.type;
        },
      ),
    ).toEqual([...AllBackupDestinationTypes]);

    for (const type of AllBackupDestinationTypes) {
      expect(isBackupDestinationType(type)).toBe(true);
    }

    expect(isBackupDestinationType("ftp")).toBe(false);
    expect(isBackupDestinationType(undefined)).toBe(false);
  });

  test("the storages OneUptime and ClickHouse reach through the S3 API", () => {
    expect(isS3ProtocolBackupDestination(BackupDestinationType.AmazonS3)).toBe(
      true,
    );
    expect(
      isS3ProtocolBackupDestination(BackupDestinationType.S3Compatible),
    ).toBe(true);
    expect(
      isS3ProtocolBackupDestination(BackupDestinationType.GoogleCloudStorage),
    ).toBe(true);
    expect(
      isS3ProtocolBackupDestination(BackupDestinationType.AzureBlobStorage),
    ).toBe(false);
    expect(isS3ProtocolBackupDestination(null)).toBe(false);
  });

  test.each(BackupDestinationCatalog)(
    "$title: every field has a key, a title and a description short enough for the form",
    (definition: BackupDestinationDefinition) => {
      const keys: Array<string> = [];

      for (const field of [
        ...definition.configFields,
        ...definition.secretFields,
      ]) {
        expect(field.key).toMatch(/^[a-z][A-Za-z]+$/);
        expect(field.title.length).toBeGreaterThan(0);
        expect(field.description.length).toBeGreaterThan(10);
        // A form field's line under its title: at most 150 characters.
        expect([field.key, field.description.length <= 150]).toEqual([
          field.key,
          true,
        ]);
        keys.push(field.key);
      }

      expect(new Set(keys).size).toBe(keys.length);
    },
  );

  test.each(BackupDestinationCatalog)(
    "$title: every secret is a password field, and no config field is",
    (definition: BackupDestinationDefinition) => {
      for (const field of definition.secretFields) {
        expect(field.type).toBe("password");
      }

      for (const field of definition.configFields) {
        expect(field.type).not.toBe("password");
      }
    },
  );

  test.each(BackupDestinationCatalog)(
    "$title: the folder is optional, under More fields, and defaults to oneuptime/backups/",
    (definition: BackupDestinationDefinition) => {
      const folder: BackupDestinationField = fieldOf(definition, "folder");

      expect(folder.required).toBe(false);
      expect(folder.isAdvanced).toBe(true);
      expect(folder.placeholder).toBe(BACKUP_DEFAULT_FOLDER);
      expect(BACKUP_DEFAULT_FOLDER).toBe("oneuptime/backups/");
    },
  );

  test("Amazon S3 asks for a bucket, a region (us-east-1 when left alone), a key ID and its secret", () => {
    const definition: BackupDestinationDefinition = definitionOf(
      BackupDestinationType.AmazonS3,
    );

    expect(
      definition.configFields.map((field: BackupDestinationField) => {
        return field.key;
      }),
    ).toEqual(["bucket", "region", "accessKeyId", "folder"]);
    expect(
      definition.secretFields.map((field: BackupDestinationField) => {
        return field.key;
      }),
    ).toEqual(["secretAccessKey"]);
    expect(fieldOf(definition, "region").defaultValue).toBe("us-east-1");
  });

  test("S3-compatible storage asks for its endpoint first, and its region only under More fields", () => {
    const definition: BackupDestinationDefinition = definitionOf(
      BackupDestinationType.S3Compatible,
    );

    expect(definition.configFields[0]!.key).toBe("endpoint");
    expect(fieldOf(definition, "endpoint").type).toBe("url");
    expect(fieldOf(definition, "region").required).toBe(false);
    expect(fieldOf(definition, "region").isAdvanced).toBe(true);
  });

  test("Google Cloud Storage signs with an HMAC key, through the S3 XML API", () => {
    const definition: BackupDestinationDefinition = definitionOf(
      BackupDestinationType.GoogleCloudStorage,
    );

    expect(fieldOf(definition, "accessKeyId").title).toBe("HMAC access key");
    expect(fieldOf(definition, "secretAccessKey").title).toBe("HMAC secret");
  });

  test("Azure Blob Storage asks for a SAS token, or an access key, never both", () => {
    const definition: BackupDestinationDefinition = definitionOf(
      BackupDestinationType.AzureBlobStorage,
    );
    const sas: BackupDestinationField = fieldOf(definition, "sasToken");
    const key: BackupDestinationField = fieldOf(definition, "accountKey");

    expect(fieldOf(definition, "authentication").defaultValue).toBe(
      AuditLogExportAzureAuthentication.SasToken,
    );

    // Left alone, the authentication is a SAS token.
    expect(isBackupFieldShown({ definition, field: sas, config: {} })).toBe(
      true,
    );
    expect(isBackupFieldShown({ definition, field: key, config: {} })).toBe(
      false,
    );

    const withKey: Record<string, string> = {
      authentication: AuditLogExportAzureAuthentication.AccessKey,
    };

    expect(
      isBackupFieldShown({ definition, field: sas, config: withKey }),
    ).toBe(false);
    expect(
      isBackupFieldShown({ definition, field: key, config: withKey }),
    ).toBe(true);
  });
});

describe("the recommended destinations", () => {
  test("are the products people know, in the order the form offers them", () => {
    expect(
      BackupProviderCatalog.map((provider: BackupProviderDefinition) => {
        return provider.title;
      }),
    ).toEqual([
      "Amazon S3",
      "Cloudflare R2",
      "Backblaze B2",
      "Wasabi",
      "MinIO",
      "Google Cloud Storage",
      "Azure Blob Storage",
      "Other S3-compatible storage",
    ]);
  });

  test.each(BackupProviderCatalog)(
    "$title is one of the four storages, says what tells it apart, and has a setup guide",
    (provider: BackupProviderDefinition) => {
      expect(getBackupDestinationDefinition(provider.type)).toBeDefined();
      expect(provider.description.length).toBeGreaterThan(10);
      expect(provider.description.length).toBeLessThanOrEqual(150);
      expect(provider.docsPath.startsWith(`${BACKUP_DOCS_PATH}#`)).toBe(true);
      expect(getBackupProviderDefinition(provider.provider)).toBe(provider);
    },
  );

  test("each one is named once", () => {
    const values: Array<string> = BackupProviderCatalog.map(
      (provider: BackupProviderDefinition) => {
        return provider.provider;
      },
    );

    expect(new Set(values).size).toBe(values.length);
    expect(values.sort()).toEqual(Object.values(BackupProvider).sort());
  });

  test("an S3-compatible provider suggests its own endpoint", () => {
    for (const provider of BackupProviderCatalog) {
      if (provider.type === BackupDestinationType.S3Compatible) {
        expect([provider.title, Boolean(provider.endpointPlaceholder)]).toEqual(
          [provider.title, true],
        );
      } else {
        expect(provider.endpointPlaceholder).toBeUndefined();
      }
    }

    expect(
      getBackupProviderDefinition(BackupProvider.CloudflareR2)!
        .endpointPlaceholder,
    ).toBe("https://<account-id>.r2.cloudflarestorage.com");
  });

  test("a setting resolves to the provider it names, when that provider is of its storage", () => {
    expect(
      resolveBackupProvider({
        type: BackupDestinationType.S3Compatible,
        provider: BackupProvider.Wasabi,
      })!.provider,
    ).toBe(BackupProvider.Wasabi);
  });

  test("a setting saved without a provider, or naming another storage's, resolves to its storage's own", () => {
    expect(
      resolveBackupProvider({
        type: BackupDestinationType.S3Compatible,
        provider: null,
      })!.provider,
    ).toBe(BackupProvider.OtherS3Compatible);
    expect(
      resolveBackupProvider({
        type: BackupDestinationType.S3Compatible,
        provider: BackupProvider.AmazonS3,
      })!.provider,
    ).toBe(BackupProvider.OtherS3Compatible);
    expect(
      resolveBackupProvider({
        type: BackupDestinationType.AmazonS3,
        provider: "nonsense",
      })!.provider,
    ).toBe(BackupProvider.AmazonS3);
    expect(
      resolveBackupProvider({
        type: BackupDestinationType.AzureBlobStorage,
        provider: undefined,
      })!.provider,
    ).toBe(BackupProvider.AzureBlobStorage);
    expect(
      resolveBackupProvider({ type: "ftp", provider: undefined }),
    ).toBeUndefined();
  });

  test("a destination is called by its provider's name", () => {
    expect(
      getBackupDestinationTitle({
        type: BackupDestinationType.S3Compatible,
        provider: BackupProvider.MinIO,
      }),
    ).toBe("MinIO");
    expect(
      getBackupDestinationTitle({ type: BackupDestinationType.S3Compatible }),
    ).toBe("Other S3-compatible storage");
    expect(getBackupDestinationTitle({ type: "ftp" })).toBe("");
  });
});

describe("inferS3RegionFromEndpoint", () => {
  test.each<[string, string]>([
    ["https://0123abc.r2.cloudflarestorage.com", "auto"],
    ["https://0123abc.eu.r2.cloudflarestorage.com", "auto"],
    ["https://s3.us-west-004.backblazeb2.com", "us-west-004"],
    ["https://s3.eu-central-003.backblazeb2.com", "eu-central-003"],
    ["https://s3.eu-central-1.wasabisys.com", "eu-central-1"],
    ["https://s3.wasabisys.com", "us-east-1"],
    ["https://fra1.digitaloceanspaces.com", "fra1"],
    ["https://s3.eu-west-2.amazonaws.com", "eu-west-2"],
    ["https://minio.example.com:9000", "us-east-1"],
    ["http://10.0.0.5:9000", "us-east-1"],
    ["https://evil-r2.cloudflarestorage.com.example.com", "us-east-1"],
    ["not a url", "us-east-1"],
    ["", "us-east-1"],
  ])("%s signs for %s", (endpoint: string, region: string) => {
    expect(inferS3RegionFromEndpoint(endpoint)).toBe(region);
  });
});
