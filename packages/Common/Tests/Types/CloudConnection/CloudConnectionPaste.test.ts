import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AZURE_SECRET_EXPIRES_AT_KEY,
  CloudConnectionAuthMethod,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionPasteResult,
  MAX_PASTE_LENGTH,
  findJsonObjects,
  isAwsRoleArn,
  looksLikeAwsAccessKeyId,
  readCloudConnectionPaste,
} from "../../../Types/CloudConnection/CloudConnectionPaste";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The setup step asks for one paste: everything the cloud's terminal
 * printed. Terminals print more than the values - Azure's warning before
 * its JSON, gcloud's progress lines before the key, the user and policy
 * commands before AWS's access key - so each reader searches the text.
 * These pin each cloud's real output shapes, what is ignored, and that no
 * reader slows down on a long or hostile paste.
 */

const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET_ACCESS_KEY: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const ROLE_ARN: string =
  "arn:aws:iam::123456789012:role/OneUptimeReadOnly-5f3a9c1e";
const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const APP: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const PASSWORD: string = "Q~8Q8.ab-CD{e}fGh~ij_kL}m";

const GCP_KEY: Record<string, string> = {
  type: "service_account",
  project_id: "acme-prod",
  private_key_id: "0123456789abcdef",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg{not}kqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n",
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  client_id: "112233445566778899",
  token_uri: "https://oauth2.googleapis.com/token",
};

function read(
  provider: CloudProvider,
  method: CloudConnectionAuthMethod,
  text: string,
): CloudConnectionPasteResult {
  return readCloudConnectionPaste(provider, method, text);
}

describe("AWS access key", () => {
  test("create-access-key's JSON, after the earlier commands' output", () => {
    const pasted: string = [
      "[cloudshell-user@ip-10-0-1-2 ~]$ aws iam create-user --user-name OneUptimeReadOnly > /dev/null 2>&1 || true",
      "[cloudshell-user@ip-10-0-1-2 ~]$ aws iam put-user-policy ...",
      "[cloudshell-user@ip-10-0-1-2 ~]$ aws iam create-access-key --user-name OneUptimeReadOnly",
      "{",
      '    "AccessKey": {',
      '        "UserName": "OneUptimeReadOnly",',
      `        "AccessKeyId": "${ACCESS_KEY_ID}",`,
      '        "Status": "Active",',
      `        "SecretAccessKey": "${SECRET_ACCESS_KEY}",`,
      '        "CreateDate": "2026-10-21T09:12:44+00:00"',
      "    }",
      "}",
    ].join("\n");

    expect(
      read(CloudProvider.AWS, CloudConnectionAuthMethod.AwsAccessKey, pasted),
    ).toEqual({
      config: { accessKeyId: ACCESS_KEY_ID },
      secrets: { secretAccessKey: SECRET_ACCESS_KEY },
    });
  });

  test("the two values on their own, as --output text prints them", () => {
    expect(
      read(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        `${ACCESS_KEY_ID}\t${SECRET_ACCESS_KEY}\n`,
      ),
    ).toEqual({
      config: { accessKeyId: ACCESS_KEY_ID },
      secrets: { secretAccessKey: SECRET_ACCESS_KEY },
    });
  });

  test("an access key id alone fills the id and leaves the secret to type", () => {
    expect(
      read(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        `key: ${ACCESS_KEY_ID}`,
      ),
    ).toEqual({ config: { accessKeyId: ACCESS_KEY_ID }, secrets: {} });
  });

  test("a word too short to be a secret is not taken for one", () => {
    expect(
      read(
        CloudProvider.AWS,
        CloudConnectionAuthMethod.AwsAccessKey,
        `${ACCESS_KEY_ID} Active`,
      ).secrets,
    ).toEqual({});
  });

  test("a temporary key (ASIA) is an access key id too", () => {
    expect(looksLikeAwsAccessKeyId("ASIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksLikeAwsAccessKeyId("AKIAIOSFODNN7EXAMPL")).toBe(false);
    expect(looksLikeAwsAccessKeyId("AKIAIOSFODNN7EXAMPL!")).toBe(false);
    expect(looksLikeAwsAccessKeyId("XKIAIOSFODNN7EXAMPLE")).toBe(false);
  });

  test("a role ARN is not an access key", () => {
    expect(
      read(CloudProvider.AWS, CloudConnectionAuthMethod.AwsAccessKey, ROLE_ARN),
    ).toEqual({ config: {}, secrets: {} });
  });
});

describe("AWS role", () => {
  test("get-role's ARN, alone or among other output", () => {
    for (const pasted of [
      ROLE_ARN,
      `${ROLE_ARN}\n`,
      `[cloudshell-user@ip ~]$ aws iam get-role ...\n${ROLE_ARN}\n[cloudshell-user@ip ~]$ `,
      `"Arn": "${ROLE_ARN}",`,
    ]) {
      expect(
        read(CloudProvider.AWS, CloudConnectionAuthMethod.AwsRole, pasted),
      ).toEqual({ config: { roleArn: ROLE_ARN }, secrets: {} });
    }
  });

  test("a role with a path, and the GovCloud and China partitions", () => {
    expect(isAwsRoleArn("arn:aws:iam::123456789012:role/ops/OneUptime")).toBe(
      true,
    );
    expect(
      isAwsRoleArn("arn:aws-us-gov:iam::123456789012:role/OneUptime"),
    ).toBe(true);
    expect(isAwsRoleArn("arn:aws-cn:iam::123456789012:role/OneUptime")).toBe(
      true,
    );
  });

  test("anything that is not an IAM role ARN is refused", () => {
    for (const value of [
      "",
      "arn:aws:iam::123456789012:user/OneUptime",
      "arn:aws:iam::12345678901:role/OneUptime",
      "arn:aws:iam::1234567890123:role/OneUptime",
      "arn:aws:iam::12345678901a:role/OneUptime",
      "arn:aws:sts::123456789012:role/OneUptime",
      "arn:aws:iam:us-east-1:123456789012:role/OneUptime",
      "arn:other:iam::123456789012:role/OneUptime",
      "arn:aws:iam::123456789012:role/",
      "arn:aws:iam::123456789012:role/One Uptime",
      "arn:aws:iam::123456789012:role/OneUptime/",
      "arn:aws:iam::123456789012:role/One;Uptime",
      `arn:aws:iam::123456789012:role/${"a".repeat(513)}`,
    ]) {
      expect({ value, ok: isAwsRoleArn(value) }).toEqual({ value, ok: false });
    }
  });
});

describe("Azure", () => {
  test("create-for-rbac's JSON after its warning", () => {
    const pasted: string = [
      "Creating 'Monitoring Reader' role assignment under scope '/subscriptions/d0cfe6b2-9ac0-4464-9919-dccaee2e48c0'",
      "The output includes credentials that you must protect. Be sure that you do not include these credentials in your code or check the credentials into your source control. For more information, see https://aka.ms/azadsp-cli",
      "{",
      `  "appId": "${APP}",`,
      '  "displayName": "OneUptimeReadOnly",',
      `  "password": "${PASSWORD}",`,
      `  "tenant": "${TENANT}"`,
      "}",
    ].join("\n");

    expect(
      read(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
        pasted,
      ),
    ).toEqual({
      config: { tenantId: TENANT, clientId: APP },
      secrets: { clientSecret: PASSWORD },
    });
  });

  test("the catalog's own key names are read too", () => {
    expect(
      read(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
        JSON.stringify({
          tenantId: TENANT,
          clientId: APP,
          clientSecret: PASSWORD,
        }),
      ),
    ).toEqual({
      config: { tenantId: TENANT, clientId: APP },
      secrets: { clientSecret: PASSWORD },
    });
  });

  test("the setup command's endDateTime is kept as when the password expires", () => {
    const pasted: string = JSON.stringify(
      {
        appId: APP,
        displayName: "OneUptimeReadOnly",
        password: PASSWORD,
        tenant: TENANT,
        endDateTime: "2027-10-26T09:41:12.5101234+00:00",
      },
      null,
      2,
    );

    expect(
      read(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
        pasted,
      ),
    ).toEqual({
      config: {
        tenantId: TENANT,
        clientId: APP,
        [AZURE_SECRET_EXPIRES_AT_KEY]: "2027-10-26T09:41:12.510Z",
      },
      secrets: { clientSecret: PASSWORD },
    });
  });

  test("an endDateTime that is not a date is left out", () => {
    expect(
      read(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
        JSON.stringify({
          appId: APP,
          password: PASSWORD,
          tenant: TENANT,
          endDateTime: "",
        }),
      ).config,
    ).toEqual({ tenantId: TENANT, clientId: APP });
  });

  test("a brace inside the password does not end the object early", () => {
    expect(findJsonObjects(`x {"password": "a}b{c", "tenant": "t"} y`)).toEqual(
      [{ password: "a}b{c", tenant: "t" }],
    );
  });

  test("an escaped quote inside a value does not end the string", () => {
    expect(findJsonObjects('{"a": "x\\"}y", "b": 1}')).toEqual([
      { a: 'x"}y', b: 1 },
    ]);
  });

  test("text with no JSON fills nothing", () => {
    expect(
      read(
        CloudProvider.Azure,
        CloudConnectionAuthMethod.AzureClientSecret,
        "ERROR: Insufficient privileges to complete the operation.",
      ),
    ).toEqual({ config: {}, secrets: {} });
  });
});

describe("Google Cloud", () => {
  test("the key file after gcloud's progress lines, as a document of its own", () => {
    const pasted: string = [
      "Operation finished successfully.",
      "Created service account [oneuptime-read-only].",
      "created key [0123456789abcdef] of type [json] as [oneuptime-key.json] for [oneuptime-read-only@acme-prod.iam.gserviceaccount.com]",
      JSON.stringify(GCP_KEY, null, 2),
    ].join("\n");

    const result: CloudConnectionPasteResult = read(
      CloudProvider.GCP,
      CloudConnectionAuthMethod.GcpServiceAccountKey,
      pasted,
    );

    expect(result.config).toEqual({});
    expect(JSON.parse(result.secrets["serviceAccountJson"]!)).toEqual(GCP_KEY);
    // The surrounding lines are not part of what is stored.
    expect(result.secrets["serviceAccountJson"]).not.toContain(
      "Operation finished",
    );
  });

  test("a JSON object that is not a service account key fills nothing", () => {
    expect(
      read(
        CloudProvider.GCP,
        CloudConnectionAuthMethod.GcpServiceAccountKey,
        '{"bindings": [{"role": "roles/monitoring.viewer"}], "etag": "BwX="}',
      ),
    ).toEqual({ config: {}, secrets: {} });
  });
});

describe("any cloud", () => {
  test("an empty or blank paste fills nothing", () => {
    for (const pasted of ["", "   \n\t"]) {
      expect(
        read(
          CloudProvider.Azure,
          CloudConnectionAuthMethod.AzureClientSecret,
          pasted,
        ),
      ).toEqual({ config: {}, secrets: {} });
    }
  });

  test("an unknown cloud fills nothing", () => {
    expect(
      readCloudConnectionPaste(
        "oracle",
        CloudConnectionAuthMethod.AwsAccessKey,
        ACCESS_KEY_ID,
      ),
    ).toEqual({ config: {}, secrets: {} });
  });

  test("only the first MAX_PASTE_LENGTH characters are read", () => {
    const pasted: string = `${" ".repeat(MAX_PASTE_LENGTH)}${ROLE_ARN}`;

    expect(
      read(CloudProvider.AWS, CloudConnectionAuthMethod.AwsRole, pasted),
    ).toEqual({ config: {}, secrets: {} });
  });

  /*
   * What a person pastes is outside text: every reader runs in time linear
   * in it, whatever its shape - here 400,000 characters of the worst ones.
   */
  test.each([
    ["unclosed braces", "{".repeat(400000)],
    ["closed braces", "{}".repeat(200000)],
    ["quotes inside an object", `{${'"'.repeat(400000)}`],
    ["escapes inside a string", `{"${"\\".repeat(400000)}`],
    ["one long word", "a".repeat(400000)],
    ["colons", `arn:${":".repeat(400000)}`],
    ["access key prefixes", "AKIA".repeat(100000)],
  ])("%s stay fast", (_name: string, worst: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (const [provider, method] of [
          [CloudProvider.AWS, CloudConnectionAuthMethod.AwsRole],
          [CloudProvider.AWS, CloudConnectionAuthMethod.AwsAccessKey],
          [CloudProvider.Azure, CloudConnectionAuthMethod.AzureClientSecret],
          [CloudProvider.GCP, CloudConnectionAuthMethod.GcpServiceAccountKey],
        ] as Array<[CloudProvider, CloudConnectionAuthMethod]>) {
          readCloudConnectionPaste(provider, method, worst);
        }

        findJsonObjects(worst);
        isAwsRoleArn(worst);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
