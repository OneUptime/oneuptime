import { describe, expect, test } from "@jest/globals";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AZURE_SECRET_EXPIRES_AT_KEY,
  CloudConnectionAuthMethod,
  CloudConnectionCatalog,
  CloudConnectionDefinition,
  CloudConnectionField,
  DATA_SECURITY_FIELD_KEY,
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  READ_SCOPE_FIELD_KEY,
  WAF_BLOCKLIST_FIELD_KEY,
  getCloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionSetupScope,
  getCloudConnectionCommandSettings,
} from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudConnectionTestResult } from "../../../Types/CloudConnection/CloudConnectionTest";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DOCS_URL } from "../../../UI/Config";
import {
  AUTH_METHOD_FIELD,
  PASTED_FIELD,
  applyCloudConnectionPaste,
  cloudConnectionTestBody,
  configFieldName,
  getCommandSettingFields,
  getCredentialsMoreFields,
  getMissingCloudConnectionFields,
  getPastedFieldTitles,
  getReadScopeField,
  isCredentialValueField,
  readCloudConnectionForm,
  readFormCommandSettings,
  readFormScope,
  readFormText,
  secretFieldName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionForm";
import {
  cloudConnectionDocsUrl,
  readCloudConnectionAwsRoleSetup,
  readCloudConnectionTestResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectApi";

/*
 * The connection form's values, read the way the API stores them, and the
 * answers of the calls Cloud > Connect makes besides its CRUD:
 *
 *   - only the picked sign-in method's settings and credentials are sent;
 *     a blank secret is not sent (on edit, the stored one is kept), and a
 *     pasted key file keeps its newlines;
 *   - one paste fills in every value it names, and says which;
 *   - a test is of the settings never saved, or of the saved connection
 *     with the form's edits over it;
 *   - what the server answers is read as the result it is, or a failure.
 */

const AWS: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.AWS,
)!;
const AZURE: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.Azure,
)!;
const GCP: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.GCP,
)!;

const ROLE_ARN: string =
  "arn:aws:iam::123456789012:role/OneUptimeReadOnly-5f3a9c1e";
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET_ACCESS_KEY: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const APP: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const PASSWORD: string = "Q~8Q8.ab-CD{e}fGh~ij_kL}m";

const AZURE_OUTPUT: string = [
  "WARNING: Creating 'Monitoring Reader' role assignment under scope '/subscriptions/0000'",
  "The output includes credentials that you must protect.",
  "{",
  `  "appId": "${APP}",`,
  '  "displayName": "OneUptimeReadOnly",',
  `  "password": "${PASSWORD}",`,
  `  "tenant": "${TENANT}"`,
  "}",
].join("\n");

function titles(fields: Array<CloudConnectionField>): Array<string> {
  return fields.map((field: CloudConnectionField): string => {
    return field.title;
  });
}

describe("what the form sends", () => {
  test("an AWS role: its ARN and the settings, nothing of the access key", () => {
    expect(
      readCloudConnectionForm(AWS, {
        [AUTH_METHOD_FIELD]: CloudConnectionAuthMethod.AwsRole,
        [configFieldName("roleArn")]: `  ${ROLE_ARN} `,
        [configFieldName("accessKeyId")]: ACCESS_KEY_ID,
        [secretFieldName("secretAccessKey")]: SECRET_ACCESS_KEY,
        [configFieldName("regions")]: "us-east-1, eu-west-1",
        [configFieldName("readIntervalInMinutes")]: {
          label: "30 minutes",
          value: "30",
        },
      }),
    ).toEqual({
      name: "Amazon Web Services",
      config: {
        authMethod: CloudConnectionAuthMethod.AwsRole,
        roleArn: ROLE_ARN,
        regions: "us-east-1, eu-west-1",
        readIntervalInMinutes: "30",
      },
      secrets: {},
    });
  });

  test("an AWS access key: the key id as a setting, the secret as a credential", () => {
    expect(
      readCloudConnectionForm(AWS, {
        [AUTH_METHOD_FIELD]: CloudConnectionAuthMethod.AwsAccessKey,
        name: " Production AWS ",
        [configFieldName("roleArn")]: ROLE_ARN,
        [configFieldName("accessKeyId")]: ACCESS_KEY_ID,
        // BasicForm hands a password field over hashed-string wrapped.
        [secretFieldName("secretAccessKey")]: new HashedString(
          ` ${SECRET_ACCESS_KEY} `,
        ) as unknown as JSONObject,
      }),
    ).toEqual({
      name: "Production AWS",
      config: {
        authMethod: CloudConnectionAuthMethod.AwsAccessKey,
        accessKeyId: ACCESS_KEY_ID,
      },
      secrets: { secretAccessKey: SECRET_ACCESS_KEY },
    });
  });

  test("no method picked: the cloud's first, or the one the form fell back to", () => {
    expect(readCloudConnectionForm(AWS, {}).config["authMethod"]).toBe(
      CloudConnectionAuthMethod.AwsRole,
    );
    expect(
      readCloudConnectionForm(AWS, {}, CloudConnectionAuthMethod.AwsAccessKey)
        .config["authMethod"],
    ).toBe(CloudConnectionAuthMethod.AwsAccessKey);
  });

  test("a blank secret is not sent; a pasted key file keeps its newlines", () => {
    expect(
      readCloudConnectionForm(AZURE, {
        [configFieldName("tenantId")]: TENANT,
        [configFieldName("clientId")]: APP,
        [secretFieldName("clientSecret")]: "   ",
      }).secrets,
    ).toEqual({});

    const key: string =
      '{\n  "type": "service_account",\n  "private_key": "-----BEGIN-----\\nabc\\n-----END-----\\n"\n}\n';

    expect(
      readCloudConnectionForm(GCP, {
        [secretFieldName("serviceAccountJson")]: key,
      }).secrets,
    ).toEqual({ serviceAccountJson: key });
  });

  test("form values read as text, whatever shape the form holds them in", () => {
    expect(readFormText(undefined)).toBe("");
    expect(readFormText(null)).toBe("");
    expect(readFormText(5)).toBe("5");
    expect(readFormText({ label: "Azure public cloud", value: "public" })).toBe(
      "public",
    );
  });
});

describe("what still needs filling in before a test", () => {
  test("a role needs its ARN; a key its id and its secret", () => {
    expect(
      titles(
        getMissingCloudConnectionFields({
          definition: AWS,
          values: { [AUTH_METHOD_FIELD]: CloudConnectionAuthMethod.AwsRole },
          isEditing: false,
        }),
      ),
    ).toEqual(["Role ARN"]);
    expect(
      titles(
        getMissingCloudConnectionFields({
          definition: AWS,
          values: {
            [AUTH_METHOD_FIELD]: CloudConnectionAuthMethod.AwsAccessKey,
          },
          isEditing: false,
        }),
      ),
    ).toEqual(["Access key ID", "Secret access key"]);
  });

  test("on edit a secret is never missing: the stored one is kept", () => {
    expect(
      titles(
        getMissingCloudConnectionFields({
          definition: AZURE,
          values: {
            [configFieldName("tenantId")]: TENANT,
            [configFieldName("clientId")]: APP,
          },
          isEditing: true,
        }),
      ),
    ).toEqual([]);
  });

  test("a setting with a default, or an optional one, is never missing", () => {
    expect(
      titles(
        getMissingCloudConnectionFields({
          definition: GCP,
          values: {},
          isEditing: false,
        }),
      ),
    ).toEqual(["Service account key (JSON)"]);
  });
});

describe("one paste", () => {
  test("fills in every value Azure's command printed, and keeps what was pasted", () => {
    const values: JSONObject | undefined = applyCloudConnectionPaste({
      definition: AZURE,
      method: CloudConnectionAuthMethod.AzureClientSecret,
      values: { name: "Contoso", [configFieldName("tenantId")]: "old" },
      pasted: AZURE_OUTPUT,
    });

    expect(values).toEqual({
      name: "Contoso",
      [PASTED_FIELD]: AZURE_OUTPUT,
      [configFieldName("tenantId")]: TENANT,
      [configFieldName("clientId")]: APP,
      [secretFieldName("clientSecret")]: PASSWORD,
    });
    expect(
      getPastedFieldTitles({
        definition: AZURE,
        method: CloudConnectionAuthMethod.AzureClientSecret,
        pasted: AZURE_OUTPUT,
      }),
    ).toEqual([
      "Directory (tenant) ID",
      "Application (client) ID",
      "Client secret",
    ]);
  });

  test("a paste that names nothing changes nothing", () => {
    expect(
      applyCloudConnectionPaste({
        definition: AZURE,
        method: CloudConnectionAuthMethod.AzureClientSecret,
        values: { name: "Contoso" },
        pasted: "az: command not found",
      }),
    ).toBeUndefined();
    expect(
      getPastedFieldTitles({
        definition: AZURE,
        method: CloudConnectionAuthMethod.AzureClientSecret,
        pasted: "az: command not found",
      }),
    ).toEqual([]);
  });

  test("AWS's access key output fills in the key id and its secret", () => {
    const pasted: string = JSON.stringify({
      AccessKey: {
        UserName: "OneUptimeReadOnly",
        AccessKeyId: ACCESS_KEY_ID,
        Status: "Active",
        SecretAccessKey: SECRET_ACCESS_KEY,
      },
    });

    expect(
      applyCloudConnectionPaste({
        definition: AWS,
        method: CloudConnectionAuthMethod.AwsAccessKey,
        values: {},
        pasted,
      }),
    ).toMatchObject({
      [configFieldName("accessKeyId")]: ACCESS_KEY_ID,
      [secretFieldName("secretAccessKey")]: SECRET_ACCESS_KEY,
    });
  });
});

describe("what a test sends", () => {
  test("settings never saved: the cloud and the form's values", () => {
    expect(
      cloudConnectionTestBody({
        definition: AZURE,
        values: {
          [configFieldName("tenantId")]: TENANT,
          [configFieldName("clientId")]: APP,
          [secretFieldName("clientSecret")]: PASSWORD,
        },
      }),
    ).toEqual({
      provider: CloudProvider.Azure,
      config: {
        authMethod: CloudConnectionAuthMethod.AzureClientSecret,
        tenantId: TENANT,
        clientId: APP,
      },
      secrets: { clientSecret: PASSWORD },
    });
  });

  test("a saved connection: its id and the form's edits, a blank secret left out", () => {
    const connection: CloudConnection = new CloudConnection();
    connection.id = new ObjectID("33333333-3333-4333-8333-333333333333");

    expect(
      cloudConnectionTestBody({
        definition: AZURE,
        connection,
        values: {
          [configFieldName("tenantId")]: TENANT,
          [configFieldName("clientId")]: APP,
          [secretFieldName("clientSecret")]: "",
        },
      }),
    ).toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      config: {
        authMethod: CloudConnectionAuthMethod.AzureClientSecret,
        tenantId: TENANT,
        clientId: APP,
      },
      secrets: {},
    });
  });
});

describe("what the server answers", () => {
  test("a test result, read field by field, counts that are not counts left out", () => {
    const answer: CloudConnectionTestResult = readCloudConnectionTestResult({
      provider: "aws",
      status: "pass",
      message: "Signed in.",
      accounts: ["123456789012", 7, null],
      resourceCount: 3,
      resourceTypes: [
        { type: "AWS::EC2::Instance", count: 2 },
        { type: "AWS::RDS::DBInstance", count: 0 },
        { type: 5, count: 1 },
        "nonsense",
      ],
      regions: [{ region: "us-east-1", count: 3 }],
      isSample: true,
      durationMs: 120,
    } as unknown as JSONObject);

    expect(answer).toEqual({
      provider: "aws",
      status: "pass",
      message: "Signed in.",
      failureKind: undefined,
      accounts: ["123456789012"],
      resourceCount: 3,
      resourceTypes: [{ type: "AWS::EC2::Instance", count: 2 }],
      regions: [{ region: "us-east-1", count: 3 }],
      isSample: true,
      durationMs: 120,
    });
  });

  test("anything that is not a test result is a failed test that says so", () => {
    for (const data of [undefined, {}, { status: "maybe" }]) {
      expect(readCloudConnectionTestResult(data as JSONObject)).toMatchObject({
        status: "fail",
        message:
          "The server did not return a test result. Check the API logs and try again.",
      });
    }
  });

  test("the AWS role setup is available only with what a role must trust and the external id", () => {
    expect(
      readCloudConnectionAwsRoleSetup({
        isAvailable: true,
        trustedPrincipalArn: "arn:aws:iam::999988887777:root",
        externalId: "oneuptime-0123",
      }),
    ).toEqual({
      isAvailable: true,
      trustedPrincipalArn: "arn:aws:iam::999988887777:root",
      externalId: "oneuptime-0123",
    });
    expect(
      readCloudConnectionAwsRoleSetup({
        isAvailable: true,
        externalId: "oneuptime-0123",
      }).isAvailable,
    ).toBe(false);
    expect(readCloudConnectionAwsRoleSetup(undefined)).toEqual({
      isAvailable: false,
      trustedPrincipalArn: undefined,
      externalId: "",
    });
  });

  test("each cloud's guide is a page of this OneUptime's docs", () => {
    for (const definition of [AWS, AZURE, GCP]) {
      expect(cloudConnectionDocsUrl(definition.docsPath).toString()).toBe(
        `${DOCS_URL.toString()}${definition.docsPath.slice("/docs".length)}`,
      );
    }
  });
});

describe("what a connection reads: one account or the organization", () => {
  const scopeKey: string = configFieldName(READ_SCOPE_FIELD_KEY);

  test("every cloud asks it, AWS for a role only", () => {
    expect(getReadScopeField(AWS, CloudConnectionAuthMethod.AwsRole)?.key).toBe(
      READ_SCOPE_FIELD_KEY,
    );
    expect(
      getReadScopeField(AWS, CloudConnectionAuthMethod.AwsAccessKey),
    ).toBeUndefined();
    expect(
      getReadScopeField(AZURE, CloudConnectionAuthMethod.AzureClientSecret)
        ?.defaultValue,
    ).toBe(CloudConnectionSetupScope.Account);
    expect(
      getReadScopeField(GCP, CloudConnectionAuthMethod.GcpServiceAccountKey),
    ).toBeDefined();
  });

  test("the organization only when it is picked and the method can read one", () => {
    expect(readFormScope(AZURE, {})).toBe(CloudConnectionSetupScope.Account);
    expect(
      readFormScope(AZURE, {
        [scopeKey]: CloudConnectionSetupScope.Organization,
      }),
    ).toBe(CloudConnectionSetupScope.Organization);
    // A dropdown value not unwrapped yet reads the same.
    expect(
      readFormScope(GCP, {
        [scopeKey]: { label: "Every project", value: "organization" },
      }),
    ).toBe(CloudConnectionSetupScope.Organization);
    // Anything else is the one account.
    expect(readFormScope(GCP, { [scopeKey]: "everything" })).toBe(
      CloudConnectionSetupScope.Account,
    );
    // An access key reads its own account, whatever the form held.
    expect(
      readFormScope(AWS, {
        [AUTH_METHOD_FIELD]: CloudConnectionAuthMethod.AwsAccessKey,
        [scopeKey]: CloudConnectionSetupScope.Organization,
      }),
    ).toBe(CloudConnectionSetupScope.Account);
    expect(
      readFormScope(
        AWS,
        { [scopeKey]: CloudConnectionSetupScope.Organization },
        CloudConnectionAuthMethod.AwsRole,
      ),
    ).toBe(CloudConnectionSetupScope.Organization);
  });

  test("the values a paste fills in are asked on the Credentials step; the scope and the hidden expiry are not", () => {
    const asked: Array<string> = [...AZURE.configFields, ...AZURE.secretFields]
      .filter(isCredentialValueField)
      .map((field: CloudConnectionField): string => {
        return field.key;
      });

    expect(asked).toEqual(
      expect.arrayContaining(["tenantId", "clientId", "clientSecret"]),
    );
    expect(asked).not.toContain(READ_SCOPE_FIELD_KEY);
    expect(asked).not.toContain(AZURE_SECRET_EXPIRES_AT_KEY);
    expect(asked).not.toContain("cloud");
  });

  test("the scope and the hidden expiry are still saved with the rest", () => {
    const submission: { config: JSONObject } = readCloudConnectionForm(AZURE, {
      [configFieldName("tenantId")]: "tenant",
      [configFieldName("clientId")]: "app",
      [scopeKey]: CloudConnectionSetupScope.Organization,
      [configFieldName(AZURE_SECRET_EXPIRES_AT_KEY)]:
        "2027-04-01T00:00:00.000Z",
      [secretFieldName("clientSecret")]: "secret",
    });

    expect(submission.config).toMatchObject({
      readScope: CloudConnectionSetupScope.Organization,
      [AZURE_SECRET_EXPIRES_AT_KEY]: "2027-04-01T00:00:00.000Z",
    });
  });
});

/*
 * What the Access step's command is written from (#10336): the settings
 * the form would save, read as the server reads them - so the command is
 * never written from a value the form shows but would not save, nor
 * misses one it would.
 */
describe("what the command is written from", () => {
  const securityKey: string = configFieldName(DATA_SECURITY_FIELD_KEY);
  const responseKey: string = configFieldName(DATA_SECURITY_RESPONSE_FIELD_KEY);
  const scopeKey: string = configFieldName(READ_SCOPE_FIELD_KEY);

  test("the form's picks, as it would save them", () => {
    expect(
      readFormCommandSettings(AZURE, {
        [scopeKey]: CloudConnectionSetupScope.Organization,
        [securityKey]: "content",
        [responseKey]: "block",
      }),
    ).toEqual({
      scope: CloudConnectionSetupScope.Organization,
      dataSecurity: "content",
      dataSecurityResponse: "block",
      // AWS's alone, and off on every other cloud (#10344).
      wafBlocklist: "off",
    });
    // Nothing picked yet: the one account, every setting off.
    expect(readFormCommandSettings(GCP, {})).toEqual({
      scope: CloudConnectionSetupScope.Account,
      dataSecurity: "off",
      dataSecurityResponse: "off",
      wafBlocklist: "off",
    });
  });

  test("is exactly what is saved, read as the server reads it, whatever shape the form holds a value in", () => {
    const forms: Array<JSONObject> = [
      {
        [securityKey]: { label: "Configuration only", value: "configuration" },
        [responseKey]: {
          label: "Close exposures and fix settings",
          value: "block",
        },
      },
      // A picker's value with space around it is saved trimmed, and read so.
      { [securityKey]: " content ", [responseKey]: " block " },
      { [securityKey]: "everything", [responseKey]: "on" },
      { [scopeKey]: " organization " },
    ];

    for (const values of forms) {
      for (const definition of [AWS, AZURE, GCP]) {
        expect(readFormCommandSettings(definition, values)).toEqual(
          getCloudConnectionCommandSettings(
            readCloudConnectionForm(definition, values).config,
          ),
        );
      }
    }

    expect(
      readFormCommandSettings(AZURE, {
        [securityKey]: " content ",
        [responseKey]: " block ",
      }),
    ).toMatchObject({ dataSecurity: "content", dataSecurityResponse: "block" });
    expect(
      readFormCommandSettings(AZURE, { [scopeKey]: " organization " }).scope,
    ).toBe(CloudConnectionSetupScope.Organization);
  });

  test("an AWS access key's command is its own account's, whatever the form held, and keeps Data Security's settings", () => {
    const values: JSONObject = {
      [AUTH_METHOD_FIELD]: CloudConnectionAuthMethod.AwsAccessKey,
      [scopeKey]: CloudConnectionSetupScope.Organization,
      [securityKey]: "configuration",
      [responseKey]: "block",
    };

    expect(readFormCommandSettings(AWS, values)).toEqual({
      scope: CloudConnectionSetupScope.Account,
      dataSecurity: "configuration",
      dataSecurityResponse: "block",
      wafBlocklist: "off",
    });
    // Blocking addresses in AWS WAF is kept too: the access key's command grants it.
    expect(
      readFormCommandSettings(AWS, {
        ...values,
        [configFieldName(WAF_BLOCKLIST_FIELD_KEY)]: "rule",
      }).wafBlocklist,
    ).toBe("rule");
    expect(readFormScope(AWS, values)).toBe(CloudConnectionSetupScope.Account);
  });

  test("the first step folds the settings that change the command under it - Data Security's two, and on AWS blocking addresses in AWS WAF; the Credentials step's More fields keeps the rest", () => {
    for (const definition of CloudConnectionCatalog) {
      const command: Array<string> = getCommandSettingFields(definition).map(
        (field: CloudConnectionField): string => {
          return field.key;
        },
      );
      const credentials: Array<string> = getCredentialsMoreFields(
        definition,
      ).map((field: CloudConnectionField): string => {
        return field.key;
      });
      const folded: Array<string> = definition.configFields
        .filter((field: CloudConnectionField): boolean => {
          return Boolean(field.isAdvanced);
        })
        .map((field: CloudConnectionField): string => {
          return field.key;
        });

      expect(command).toEqual([
        DATA_SECURITY_FIELD_KEY,
        DATA_SECURITY_RESPONSE_FIELD_KEY,
        ...(definition.provider === CloudProvider.AWS
          ? [WAF_BLOCKLIST_FIELD_KEY]
          : []),
      ]);
      // Every folded setting in one of the two, none in both, in the catalog's order.
      expect([...credentials, ...command].sort()).toEqual([...folded].sort());
      expect(
        credentials.filter((key: string): boolean => {
          return command.includes(key);
        }),
      ).toEqual([]);
      expect(credentials).toEqual(
        folded.filter((key: string): boolean => {
          return !command.includes(key);
        }),
      );
    }
  });

  test("no setting the command is written from is asked on the Credentials step", () => {
    for (const definition of CloudConnectionCatalog) {
      const asked: Array<CloudConnectionField> = [
        ...definition.configFields,
        ...definition.secretFields,
      ].filter(isCredentialValueField);

      expect(
        asked.filter((field: CloudConnectionField): boolean => {
          return Boolean(field.changesSetupCommand);
        }),
      ).toEqual([]);
      expect(titles(asked)).not.toContain("What to read");
    }
  });
});
