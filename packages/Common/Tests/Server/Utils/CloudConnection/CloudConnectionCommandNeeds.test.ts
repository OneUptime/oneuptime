import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { readCloudSetting } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { getConnectionDataSecurityLevel } from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import {
  DATA_SECURITY_FIELD_KEY,
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  READ_SCOPE_FIELD_KEY,
  WAF_BLOCKLIST_FIELD_KEY,
  doesCloudConnectionWafBlocklistAddRule,
  isCloudConnectionDataSecurityResponseOn,
  isCloudConnectionWafBlocklistOn,
} from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_DATA_SECURITY_RESPONSE_ACTIONS,
  AWS_READ_ONLY_ACTIONS,
  AZURE_DATA_SECURITY_RESPONSE_ACTIONS,
  CloudConnectionCommandSettings,
  CloudConnectionSetupScope,
  GCP_DATA_SECURITY_RESPONSE_PERMISSIONS,
  getAwsWafBlocklistActions,
  getCloudConnectionCommandSettings,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * WHAT THE SERVER USES THROUGH A CONNECTION IS WHAT ITS COMMAND GRANTS
 * (#10336).
 *
 * The form writes a connection's command from the settings it saves, read
 * by getCloudConnectionCommandSettings. Here the server is held to the same
 * reading and the same needs:
 *
 *   - the settings: the connectors read the scope with readCloudSetting,
 *     DataSecurityRunner the level with getConnectionDataSecurityLevel,
 *     and DataSecurityResponse whether it may close an exposure with
 *     isCloudConnectionDataSecurityResponseOn. For every value a
 *     connection could hold, the command's reading and the server's agree,
 *     so a command never grants less than the server will use, nor more;
 *   - the writes: each cloud's responder names the permission of each call
 *     it makes - in the message that says which one a refusal lacked - and
 *     those are exactly what Data security response grants: AWS's policy,
 *     Azure's and Google Cloud's custom roles. A call added to a responder
 *     without its permission in the grant fails here, before a playbook
 *     fails with a permission error in a customer's cloud.
 */

// packages/Common/Tests/Server/Utils/CloudConnection -> packages/Common.
const COMMON: string = path.resolve(__dirname, "..", "..", "..", "..");

function source(file: string): string {
  return fs.readFileSync(path.join(COMMON, file), "utf8");
}

const RESPONDERS: {
  aws: string;
  azure: string;
  gcp: string;
  shared: string;
} = {
  aws: "Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityResponse.ts",
  azure: "Server/Utils/DataSecurity/Cloud/Azure/AzureDataSecurityResponse.ts",
  gcp: "Server/Utils/DataSecurity/Cloud/Gcp/GcpDataSecurityResponse.ts",
  shared: "Server/Utils/DataSecurity/DataSecurityResponse.ts",
};

// A double-quoted string on one line, as written.
const DOUBLE_QUOTED: RegExp = /"([^"\n]*)"/g;

// Every double-quoted string a source holds, as written.
function quotedStrings(code: string): Array<string> {
  return Array.from(code.matchAll(DOUBLE_QUOTED)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// An AWS service's prefix ("s3", "network-firewall"), and an action's name.
const AWS_SERVICE_PREFIX: RegExp = /^[a-z0-9-]+$/;
const AWS_ACTION_NAME: RegExp = /^[A-Z][A-Za-z]+$/;
// What an Azure RBAC action is written in.
const AZURE_ACTION_TEXT: RegExp = /^[A-Za-z./]+$/;
// One part of a Google Cloud IAM permission.
const GCP_PERMISSION_PART: RegExp = /^[a-zA-Z]+$/;

// An AWS IAM action: "s3:PutBucketVersioning".
function isAwsAction(text: string): boolean {
  const parts: Array<string> = text.split(":");

  return (
    parts.length === 2 &&
    AWS_SERVICE_PREFIX.test(parts[0]!) &&
    AWS_ACTION_NAME.test(parts[1]!)
  );
}

// An Azure RBAC action: "Microsoft.Storage/storageAccounts/write".
function isAzureAction(text: string): boolean {
  return (
    text.startsWith("Microsoft.") &&
    text.split("/").length >= 3 &&
    AZURE_ACTION_TEXT.test(text)
  );
}

// A Google Cloud IAM permission: "storage.buckets.update" - not an API's host name.
function isGcpPermission(text: string): boolean {
  const parts: Array<string> = text.split(".");

  return (
    parts.length === 3 &&
    parts[2] !== "com" &&
    parts.every((part: string): boolean => {
      return GCP_PERMISSION_PART.test(part);
    })
  );
}

function unique(items: Array<string>): Array<string> {
  return Array.from(new Set<string>(items)).sort();
}

describe("the server reads a connection's settings as its command does", () => {
  const VALUES: Array<JSONValue | undefined> = [
    undefined,
    null,
    "",
    "off",
    "account",
    "organization",
    " organization ",
    "Organization",
    "configuration",
    "content",
    " content ",
    "Content",
    "block",
    " block ",
    "Block",
    "on",
    true,
    false,
    1,
    0,
    ["content"],
    { value: "block" },
  ];

  test("the scope: every account of the organization exactly when the connectors read one", () => {
    for (const value of VALUES) {
      const config: JSONObject =
        value === undefined ? {} : { [READ_SCOPE_FIELD_KEY]: value };
      const settings: CloudConnectionCommandSettings =
        getCloudConnectionCommandSettings(config);

      expect({
        value,
        organization: settings.scope === CloudConnectionSetupScope.Organization,
      }).toEqual({
        value,
        // As AwsCloudConnector and GcpCloudConnector decide it.
        organization:
          readCloudSetting(config, "readScope") ===
          CloudConnectionSetupScope.Organization,
      });
    }
  });

  test("what Data Security may read: the level DataSecurityRunner reads with", () => {
    for (const value of VALUES) {
      const config: JSONObject =
        value === undefined ? {} : { [DATA_SECURITY_FIELD_KEY]: value };

      expect({
        value,
        level: getCloudConnectionCommandSettings(config).dataSecurity,
      }).toEqual({ value, level: getConnectionDataSecurityLevel(config) });
    }

    expect(getCloudConnectionCommandSettings(undefined).dataSecurity).toBe(
      getConnectionDataSecurityLevel(undefined),
    );
  });

  test("whether it may close an exposure: on exactly when DataSecurityResponse lets it", () => {
    for (const value of VALUES) {
      const config: JSONObject =
        value === undefined
          ? {}
          : { [DATA_SECURITY_RESPONSE_FIELD_KEY]: value };

      expect({
        value,
        on:
          getCloudConnectionCommandSettings(config).dataSecurityResponse ===
          "block",
      }).toEqual({
        value,
        on: isCloudConnectionDataSecurityResponseOn(
          config[DATA_SECURITY_RESPONSE_FIELD_KEY],
        ),
      });
    }
  });

  test("whether the blocklist may write AWS WAF, and add its rule: as the AWS WAF destinations and the web ACLs' service read it (#10344)", () => {
    for (const value of VALUES) {
      const config: JSONObject =
        value === undefined ? {} : { [WAF_BLOCKLIST_FIELD_KEY]: value };
      const settings: CloudConnectionCommandSettings =
        getCloudConnectionCommandSettings(config);

      expect({
        value,
        on: settings.wafBlocklist !== "off",
        rule: settings.wafBlocklist === "rule",
      }).toEqual({
        value,
        on: isCloudConnectionWafBlocklistOn(config[WAF_BLOCKLIST_FIELD_KEY]),
        rule: doesCloudConnectionWafBlocklistAddRule(
          config[WAF_BLOCKLIST_FIELD_KEY],
        ),
      });
    }

    // Each reads the connection's own setting, with those checks, and nothing else.
    for (const [file, check] of [
      [
        "Server/Utils/SecurityBlocklist/AwsWafBlockDestination.ts",
        "doesCloudConnectionWafBlocklistAddRule(",
      ],
      [
        "Server/Utils/SecurityBlocklist/SecurityBlockCloudWafs.ts",
        "doesCloudConnectionWafBlocklistAddRule(",
      ],
      [
        "Server/Services/SecurityBlockCloudWafService.ts",
        "isCloudConnectionWafBlocklistOn(",
      ],
    ] as Array<[string, string]>) {
      const code: string = source(file);

      expect({ file, decides: code.includes(check) }).toEqual({
        file,
        decides: true,
      });
      expect({
        file,
        readsSetting: code.includes("[WAF_BLOCKLIST_FIELD_KEY]"),
      }).toEqual({ file, readsSetting: true });
    }
  });

  test("DataSecurityResponse decides it with that check, of the connection's own setting, wherever it decides", () => {
    const code: string = source(RESPONDERS.shared);
    const decisions: number =
      code.split("isCloudConnectionDataSecurityResponseOn(").length - 1;

    // Offering the actions, and running one: both read the setting the command is written from.
    expect(decisions).toBe(2);
    expect(
      code.split("connection.config[DATA_SECURITY_RESPONSE_FIELD_KEY]").length -
        1,
    ).toBe(decisions);
  });
});

describe("each responder's writes are what Data security response grants, no more and no less", () => {
  test("AWS: the actions AwsDataSecurityResponse names are the OneUptimeDataSecurityResponse policy's", () => {
    const named: Array<string> = unique(
      quotedStrings(source(RESPONDERS.aws)).filter(isAwsAction),
    );

    expect(named).toEqual(unique(AWS_DATA_SECURITY_RESPONSE_ACTIONS));
    // Each call names its own: twelve, a read and a write of each setting.
    expect(named).toHaveLength(12);
  });

  test("Azure: the actions AzureDataSecurityResponse names are the custom role's", () => {
    expect(
      unique(quotedStrings(source(RESPONDERS.azure)).filter(isAzureAction)),
    ).toEqual(unique(AZURE_DATA_SECURITY_RESPONSE_ACTIONS));
  });

  test("Google Cloud: the permissions GcpDataSecurityResponse names are the custom role's", () => {
    expect(
      unique(quotedStrings(source(RESPONDERS.gcp)).filter(isGcpPermission)),
    ).toEqual(unique(GCP_DATA_SECURITY_RESPONSE_PERMISSIONS));
  });

  test("AWS WAF (#10344): every action the blocklist's module names is granted - its policy's, or GetWebACL of the read-only one - and every action its policy grants is named", () => {
    const named: Array<string> = unique(
      quotedStrings(
        source("Server/Utils/CloudConnection/Aws/AwsWaf.ts"),
      ).filter(isAwsAction),
    );
    const granted: Array<string> = getAwsWafBlocklistActions("rule");

    for (const action of named) {
      expect({
        action,
        granted:
          granted.includes(action) || AWS_READ_ONLY_ACTIONS.includes(action),
      }).toEqual({ action, granted: true });
    }

    expect(
      granted.filter((action: string): boolean => {
        return !named.includes(action);
      }),
    ).toEqual([]);
    // Each call names its own: the IP sets' five, the web ACL's two, the samples'.
    expect(named).toEqual(
      unique([
        "wafv2:ListIPSets",
        "wafv2:GetIPSet",
        "wafv2:CreateIPSet",
        "wafv2:UpdateIPSet",
        "wafv2:DeleteIPSet",
        "wafv2:GetWebACL",
        "wafv2:UpdateWebACL",
        "wafv2:GetSampledRequests",
      ]),
    );
    // Only "rule" may write a web ACL.
    expect(getAwsWafBlocklistActions("code")).not.toContain(
      "wafv2:UpdateWebACL",
    );
    expect(getAwsWafBlocklistActions("off")).toEqual([]);
  });

  test("the readers of names find them: a call's permission, and not an API's host name or a resource type", () => {
    expect(isAwsAction("s3:PutBucketVersioning")).toBe(true);
    expect(isAwsAction("x-amz-expected-bucket-owner")).toBe(false);
    expect(isAwsAction("arn:aws:s3:::bucket")).toBe(false);
    expect(isAzureAction("Microsoft.Storage/storageAccounts/write")).toBe(true);
    expect(isAzureAction("Microsoft.Storage")).toBe(false);
    expect(isGcpPermission("storage.buckets.update")).toBe(true);
    expect(isGcpPermission("storage.googleapis.com")).toBe(false);
    expect(
      quotedStrings('const a: string = "one"; const b: string = "two";'),
    ).toEqual(["one", "two"]);
  });
});
