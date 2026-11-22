import { CLOUD_AWS_WAF_BLOCKLIST } from "./CloudDocsPages";
import { readPage } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  AWS_WAF_CLOUDFRONT_REGION,
  AWS_WAF_IP_SET_MAX_ADDRESSES,
  getAwsWafBlocklistRuleNames,
  getAwsWafBlocklistSets,
} from "Common/Types/CloudConnection/AwsWafBlocklist";
import {
  WAF_BLOCKLIST_FIELD_KEY,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_READ_ONLY_ACTIONS,
  AWS_WAF_BLOCKLIST_POLICY_NAME,
  AWS_WAF_BLOCKLIST_RULE_ACTIONS,
  getAwsWafBlocklistActions,
  getAwsWafBlocklistGroupName,
  getAwsWafIpSetNamePrefix,
} from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import {
  SECURITY_BLOCK_CLIENT_ADDRESS_HEADERS,
  SecurityBlockCloudWafStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { describe, expect, it } from "@jest/globals";

/*
 * Block Addresses in AWS WAF (#10344), held to the code it describes: the
 * connection's setting and its choices as the form draws them, the policy
 * and group the setup command adds and every action they grant, the names
 * of what OneUptime creates, where CloudFront's sets live, the set's limit,
 * the headers a web ACL reads the client's address from, and the statuses
 * a web ACL shows.
 */

const PAGE: string = readPage("en", CLOUD_AWS_WAF_BLOCKLIST);
// Any project's: the page writes "<project>" where the names hold its suffix.
const EXTERNAL_ID: string = "1a2b3c4d-0000-4000-8000-000000000000";

function withProject(name: string): string {
  return name.split("1a2b3c4d").join("<project>");
}

describe("Block Addresses in AWS WAF", () => {
  it("names the setting and its choices as the connection's form draws them", () => {
    const field: { title?: string; options?: Array<{ label: string }> } =
      getCloudConnectionDefinition(CloudProvider.AWS)!.configFields.find(
        (candidate: { key: string }): boolean => {
          return candidate.key === WAF_BLOCKLIST_FIELD_KEY;
        },
      ) as { title?: string; options?: Array<{ label: string }> };

    expect(PAGE).toContain(`**${field.title}**`);

    for (const option of field.options || []) {
      expect(PAGE).toContain(`**${option.label}**`);
    }
  });

  it("names the policy, the access key's group and every action they grant, the rule's only with OneUptime adding it", () => {
    expect(PAGE).toContain(`\`${AWS_WAF_BLOCKLIST_POLICY_NAME}\``);
    expect(PAGE).toContain(
      `\`${withProject(getAwsWafBlocklistGroupName(EXTERNAL_ID))}\``,
    );

    const rows: Array<Array<string>> = (
      tables(PAGE).find((table: Array<Array<string>>): boolean => {
        return table[0]?.[0] === "Action";
      }) as Array<Array<string>>
    ).slice(1);
    const listed: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return (row[0] as string).split(",").map((action: string): string => {
          return action.split("`").join("").trim();
        });
      },
    );

    expect([...listed].sort()).toEqual(
      [...getAwsWafBlocklistActions("rule")].sort(),
    );
    expect(getAwsWafBlocklistActions("code")).not.toContain(
      AWS_WAF_BLOCKLIST_RULE_ACTIONS[0],
    );
    // Reading a web ACL is the read-only policy's.
    expect(AWS_READ_ONLY_ACTIONS).toContain("wafv2:GetWebACL");
    expect(PAGE).toContain("`wafv2:GetWebACL`");
    expect(PAGE).toContain(
      `\`${withProject(getAwsWafIpSetNamePrefix(EXTERNAL_ID))}-*\``,
    );
  });

  it("names the four IP sets and the two rules as OneUptime makes them", () => {
    for (const set of getAwsWafBlocklistSets(EXTERNAL_ID)) {
      expect(PAGE).toContain(`\`${withProject(set.name)}\``);
    }

    const rules: { block: string; challenge: string } =
      getAwsWafBlocklistRuleNames(EXTERNAL_ID);

    expect(PAGE).toContain(`\`${withProject(rules.block)}\``);
    expect(PAGE).toContain(`\`${withProject(rules.challenge)}\``);
    expect(PAGE).toContain(`\`${AWS_WAF_CLOUDFRONT_REGION}\``);
    expect(PAGE).toContain(
      AWS_WAF_IP_SET_MAX_ADDRESSES.toLocaleString("en-US"),
    );
  });

  it("names every header a web ACL can read the client's address from", () => {
    for (const header of Object.values(SECURITY_BLOCK_CLIENT_ADDRESS_HEADERS)) {
      expect(PAGE).toContain(`\`${header.header}\``);
    }
  });

  it("names the statuses a web ACL shows when it is not enforcing", () => {
    expect(PAGE).toContain("**Enforcing**");
    expect(PAGE).toContain("**Waiting for Your Rule**");
    expect(PAGE).toContain("**No Free Priority**");
    expect(PAGE).toContain("Not Enforcing");
    expect(Object.values(SecurityBlockCloudWafStatus)).toHaveLength(5);
  });
});
