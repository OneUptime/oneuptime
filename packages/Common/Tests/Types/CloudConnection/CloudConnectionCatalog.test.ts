import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_CONNECTION_READ_INTERVALS,
  CloudConnectionAuthMethod,
  CloudConnectionCatalog,
  CloudConnectionDefinition,
  CloudConnectionField,
  AZURE_SECRET_EXPIRES_AT_KEY,
  READ_INTERVAL_FIELD_KEY,
  READ_SCOPE_FIELD_KEY,
  getCloudConnectionAuthMethod,
  getCloudConnectionAuthMethodDefinition,
  getCloudConnectionDefinition,
  getCloudConnectionFieldsForMethod,
  getCloudConnectionReadIntervalInMinutes,
  getCloudConnectionTitle,
  isCloudConnectionAuthMethod,
  isCloudConnectionProvider,
  splitCloudConnectionList,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The catalog is what the Connect page, the form, the server's validation
 * and the docs all read. These pin its shape: one entry per cloud in the
 * tiles' order, a guide anchor for each, the sign-in methods each offers
 * (an AWS role first), secrets kept apart from settings, the advanced
 * settings folded, and the helpers the form and the read loop share.
 */

function definitionOf(provider: CloudProvider): CloudConnectionDefinition {
  return getCloudConnectionDefinition(provider)!;
}

function keysOf(fields: Array<CloudConnectionField>): Array<string> {
  return fields.map((field: CloudConnectionField): string => {
    return field.key;
  });
}

describe("the catalog", () => {
  test("one entry per cloud, in the tiles' order", () => {
    expect(
      CloudConnectionCatalog.map((definition: CloudConnectionDefinition) => {
        return [definition.provider, definition.title];
      }),
    ).toEqual([
      [CloudProvider.AWS, "Amazon Web Services"],
      [CloudProvider.Azure, "Microsoft Azure"],
      [CloudProvider.GCP, "Google Cloud"],
    ]);
  });

  test("each guide is a section of the cloud accounts page", () => {
    expect(
      CloudConnectionCatalog.map((definition: CloudConnectionDefinition) => {
        return definition.docsPath;
      }),
    ).toEqual([
      "/docs/telemetry/cloud-accounts#amazon-web-services",
      "/docs/telemetry/cloud-accounts#microsoft-azure",
      "/docs/telemetry/cloud-accounts#google-cloud",
    ]);
  });

  test("each opens its cloud's own browser terminal over https", () => {
    for (const definition of CloudConnectionCatalog) {
      expect(new URL(definition.shellUrl).protocol).toBe("https:");
      expect(definition.shellTitle.length).toBeGreaterThan(0);
    }
    expect(new URL(definitionOf(CloudProvider.AWS).shellUrl).host).toBe(
      "console.aws.amazon.com",
    );
    expect(new URL(definitionOf(CloudProvider.Azure).shellUrl).host).toBe(
      "shell.azure.com",
    );
    expect(new URL(definitionOf(CloudProvider.GCP).shellUrl).host).toBe(
      "shell.cloud.google.com",
    );
  });

  test("AWS offers a role first, then an access key; the others one way each", () => {
    expect(
      CloudConnectionCatalog.map((definition: CloudConnectionDefinition) => {
        return definition.authMethods.map((method: { method: string }) => {
          return method.method;
        });
      }),
    ).toEqual([
      [
        CloudConnectionAuthMethod.AwsRole,
        CloudConnectionAuthMethod.AwsAccessKey,
      ],
      [CloudConnectionAuthMethod.AzureClientSecret],
      [CloudConnectionAuthMethod.GcpServiceAccountKey],
    ]);
  });

  test("every method says what its command does, in which shell", () => {
    for (const definition of CloudConnectionCatalog) {
      for (const method of definition.authMethods) {
        expect(method.title.length).toBeGreaterThan(0);
        expect(method.hint.startsWith("Run this in")).toBe(true);
        expect(method.hint).toContain(
          definition.shellTitle.replace("Google ", "").replace("AWS ", ""),
        );
      }
    }
  });

  test("a field's key is never both a setting and a secret", () => {
    for (const definition of CloudConnectionCatalog) {
      const config: Array<string> = keysOf(definition.configFields);
      for (const key of keysOf(definition.secretFields)) {
        expect(config).not.toContain(key);
      }
    }
  });

  test("secrets are password or JSON fields, and say they are never shown again", () => {
    for (const definition of CloudConnectionCatalog) {
      for (const field of definition.secretFields) {
        expect(["password", "json"]).toContain(field.type);
        expect(field.description).toContain("never shown again");
        expect(field.isAdvanced).toBeFalsy();
      }
    }
  });

  test("every cloud folds how often it is read, with the offered intervals and its default", () => {
    for (const definition of CloudConnectionCatalog) {
      const field: CloudConnectionField | undefined =
        definition.configFields.find((candidate: CloudConnectionField) => {
          return candidate.key === READ_INTERVAL_FIELD_KEY;
        });

      expect(field?.isAdvanced).toBe(true);
      expect(
        (field?.options || []).map((option: { value: string }) => {
          return Number(option.value);
        }),
      ).toEqual(CLOUD_CONNECTION_READ_INTERVALS);
      expect(field?.defaultValue).toBe(
        String(definition.defaultReadIntervalInMinutes),
      );
    }

    // AWS is read less often: CloudWatch charges per metric read.
    expect(definitionOf(CloudProvider.AWS).defaultReadIntervalInMinutes).toBe(
      10,
    );
    expect(definitionOf(CloudProvider.Azure).defaultReadIntervalInMinutes).toBe(
      5,
    );
    expect(definitionOf(CloudProvider.GCP).defaultReadIntervalInMinutes).toBe(
      5,
    );
  });

  test("the settings most people leave alone are folded", () => {
    const folded: (provider: CloudProvider) => Array<string> = (
      provider: CloudProvider,
    ): Array<string> => {
      return keysOf(
        definitionOf(provider).configFields.filter(
          (field: CloudConnectionField): boolean => {
            return Boolean(field.isAdvanced);
          },
        ),
      );
    };

    expect(folded(CloudProvider.AWS)).toEqual([
      "regions",
      READ_INTERVAL_FIELD_KEY,
    ]);
    expect(folded(CloudProvider.Azure)).toEqual([
      "subscriptionIds",
      "cloud",
      READ_INTERVAL_FIELD_KEY,
    ]);
    expect(folded(CloudProvider.GCP)).toEqual([
      "projectIds",
      READ_INTERVAL_FIELD_KEY,
    ]);
  });
});

describe("fields by sign-in method", () => {
  test("an AWS role asks for its ARN only; an access key for its id and secret", () => {
    const aws: CloudConnectionDefinition = definitionOf(CloudProvider.AWS);

    expect(
      keysOf(
        getCloudConnectionFieldsForMethod(
          aws.configFields,
          CloudConnectionAuthMethod.AwsRole,
        ),
      ),
    ).toEqual([
      "roleArn",
      READ_SCOPE_FIELD_KEY,
      "regions",
      READ_INTERVAL_FIELD_KEY,
    ]);
    expect(
      keysOf(
        getCloudConnectionFieldsForMethod(
          aws.secretFields,
          CloudConnectionAuthMethod.AwsRole,
        ),
      ),
    ).toEqual([]);
    expect(
      keysOf(
        getCloudConnectionFieldsForMethod(
          aws.configFields,
          CloudConnectionAuthMethod.AwsAccessKey,
        ),
      ),
    ).toEqual(["accessKeyId", "regions", READ_INTERVAL_FIELD_KEY]);
    expect(
      keysOf(
        getCloudConnectionFieldsForMethod(
          aws.secretFields,
          CloudConnectionAuthMethod.AwsAccessKey,
        ),
      ),
    ).toEqual(["secretAccessKey"]);
  });

  test("what to read - one account or the whole organization - is asked for on the first step, never folded, and an access key's AWS connection never offers it", () => {
    for (const provider of [
      CloudProvider.AWS,
      CloudProvider.Azure,
      CloudProvider.GCP,
    ]) {
      const scope: CloudConnectionField | undefined = definitionOf(
        provider,
      ).configFields.find((field: CloudConnectionField): boolean => {
        return field.key === READ_SCOPE_FIELD_KEY;
      });

      expect(scope).toBeDefined();
      expect(scope!.isAdvanced).toBeFalsy();
      expect(scope!.required).toBe(false);
      expect(scope!.defaultValue).toBe("account");
      expect(
        (scope!.options || []).map((option: { value: string }): string => {
          return option.value;
        }),
      ).toEqual(["account", "organization"]);
    }

    expect(
      keysOf(
        getCloudConnectionFieldsForMethod(
          definitionOf(CloudProvider.AWS).configFields,
          CloudConnectionAuthMethod.AwsAccessKey,
        ),
      ),
    ).not.toContain(READ_SCOPE_FIELD_KEY);
  });

  /*
   * The line under What to read says what its two choices say, in each
   * cloud's own words: an AWS account of an organization, an Azure
   * subscription of a tenant, a Google Cloud project of an organization.
   */
  test("what to read is explained in each cloud's own words, as its choices are", () => {
    const expected: Record<
      string,
      { description: string; one: string; every: string; unit: string }
    > = {
      [CloudProvider.AWS]: {
        description:
          "One account, or every account of the organization. The command changes with it.",
        one: "This account",
        every: "Every account in the organization",
        unit: "account",
      },
      [CloudProvider.Azure]: {
        description:
          "One subscription, or every subscription of the tenant. The command changes with it.",
        one: "This subscription",
        every: "Every subscription in the tenant",
        unit: "subscription",
      },
      [CloudProvider.GCP]: {
        description:
          "One project, or every project of the organization. The command changes with it.",
        one: "This project",
        every: "Every project in the organization",
        unit: "project",
      },
    };

    for (const provider of [
      CloudProvider.AWS,
      CloudProvider.Azure,
      CloudProvider.GCP,
    ]) {
      const scope: CloudConnectionField = definitionOf(
        provider,
      ).configFields.find((field: CloudConnectionField): boolean => {
        return field.key === READ_SCOPE_FIELD_KEY;
      })!;
      const words: {
        description: string;
        one: string;
        every: string;
        unit: string;
      } = expected[provider]!;

      expect(scope.title).toBe("What to read");
      expect(scope.description).toBe(words.description);
      expect(
        (scope.options || []).map((option: { label: string }): string => {
          return option.label;
        }),
      ).toEqual([words.one, words.every]);
      // The line names what the choices name, and no other cloud's unit.
      expect(scope.description).toContain(words.unit);
      expect(words.one.toLowerCase()).toContain(words.unit);
      for (const other of ["account", "subscription", "project"]) {
        if (other !== words.unit) {
          expect(scope.description).not.toContain(other);
        }
      }
    }
  });

  test("the Azure client secret's expiry is a setting kept from the paste, never shown", () => {
    const expiry: CloudConnectionField | undefined = definitionOf(
      CloudProvider.Azure,
    ).configFields.find((field: CloudConnectionField): boolean => {
      return field.key === AZURE_SECRET_EXPIRES_AT_KEY;
    });

    expect(expiry?.isHidden).toBe(true);
    expect(expiry?.required).toBe(false);
  });

  test("Azure and Google Cloud ask for the same fields whatever the method", () => {
    const azure: CloudConnectionDefinition = definitionOf(CloudProvider.Azure);

    expect(
      keysOf(
        getCloudConnectionFieldsForMethod(
          azure.configFields,
          CloudConnectionAuthMethod.AzureClientSecret,
        ),
      ),
    ).toEqual(keysOf(azure.configFields));
    expect(keysOf(definitionOf(CloudProvider.GCP).secretFields)).toEqual([
      "serviceAccountJson",
    ]);
  });
});

describe("the helpers", () => {
  test("a provider is one of the three clouds", () => {
    expect(isCloudConnectionProvider("aws")).toBe(true);
    expect(isCloudConnectionProvider("azure")).toBe(true);
    expect(isCloudConnectionProvider("gcp")).toBe(true);
    expect(isCloudConnectionProvider("oracle")).toBe(false);
    expect(isCloudConnectionProvider(undefined)).toBe(false);
    expect(isCloudConnectionProvider(1)).toBe(false);
  });

  test("a title for every cloud, and the value itself for anything else", () => {
    expect(getCloudConnectionTitle("gcp")).toBe("Google Cloud");
    expect(getCloudConnectionTitle("oracle")).toBe("oracle");
    expect(getCloudConnectionTitle(undefined)).toBe("");
  });

  test("a method is one the cloud offers, else its first", () => {
    const aws: CloudConnectionDefinition = definitionOf(CloudProvider.AWS);

    expect(
      getCloudConnectionAuthMethod(aws, CloudConnectionAuthMethod.AwsAccessKey),
    ).toBe(CloudConnectionAuthMethod.AwsAccessKey);
    expect(getCloudConnectionAuthMethod(aws, "nonsense")).toBe(
      CloudConnectionAuthMethod.AwsRole,
    );
    // Azure does not offer an AWS key.
    expect(
      getCloudConnectionAuthMethod(
        definitionOf(CloudProvider.Azure),
        CloudConnectionAuthMethod.AwsAccessKey,
      ),
    ).toBe(CloudConnectionAuthMethod.AzureClientSecret);
    expect(isCloudConnectionAuthMethod("aws-role")).toBe(true);
    expect(isCloudConnectionAuthMethod("role")).toBe(false);
    expect(
      getCloudConnectionAuthMethodDefinition(
        aws,
        CloudConnectionAuthMethod.AwsRole,
      )?.title,
    ).toBe("IAM role");
  });

  test("a read interval is one of the offered ones, else the cloud's default", () => {
    const aws: CloudConnectionDefinition = definitionOf(CloudProvider.AWS);

    expect(getCloudConnectionReadIntervalInMinutes(aws, "30")).toBe(30);
    expect(getCloudConnectionReadIntervalInMinutes(aws, 60)).toBe(60);
    expect(getCloudConnectionReadIntervalInMinutes(aws, "7")).toBe(10);
    expect(getCloudConnectionReadIntervalInMinutes(aws, undefined)).toBe(10);
    expect(getCloudConnectionReadIntervalInMinutes(aws, "abc")).toBe(10);
  });

  test("a list splits on commas and whitespace, without blanks or repeats", () => {
    expect(
      splitCloudConnectionList(
        " us-east-1, eu-west-1 ,us-east-1\nap-south-1\t sa-east-1,, ",
      ),
    ).toEqual(["us-east-1", "eu-west-1", "ap-south-1", "sa-east-1"]);
    expect(splitCloudConnectionList("")).toEqual([]);
    expect(splitCloudConnectionList(undefined)).toEqual([]);
    expect(splitCloudConnectionList(42)).toEqual([]);
  });

  test("splitting a long list stays fast", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        splitCloudConnectionList(
          `${" ".repeat(200000)},${"\t".repeat(200000)}`,
        );
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});
