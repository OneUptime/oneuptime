import {
  CLOUD_ARMOR_BLOCKLIST,
  CLOUD_AZURE_WAF_BLOCKLIST,
} from "./CloudDocsPages";
import { readPage } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE,
  AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE_NEWER,
  AZURE_FRONT_DOOR_WAF_ADDRESSES_PER_RULE,
  AZURE_WAF_BLOCKLIST_ACTIONS,
  AZURE_WAF_BLOCKLIST_ROLE,
  AZURE_WAF_MAX_ONEUPTIME_RULES,
  getAzureWafRuleName,
} from "Common/Types/CloudConnection/AzureWafBlocklist";
import {
  CLOUD_ARMOR_ADDRESSES_PER_RULE,
  CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY,
  CLOUD_ARMOR_MAX_ONEUPTIME_RULES,
  GCP_CLOUD_ARMOR_BLOCKLIST_PERMISSIONS,
  GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID,
  getCloudArmorAddressGroupNames,
  getCloudArmorRuleDescription,
} from "Common/Types/CloudConnection/CloudArmorBlocklist";
import {
  CloudConnectionField,
  WAF_BLOCKLIST_FIELD_KEY,
  getCloudConnectionDefinition,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { describe, expect, it } from "@jest/globals";

/*
 * Block Addresses in Azure WAF (#10348) and Block Addresses in Cloud Armor
 * (#10349), held to the code they describe: the connection's setting and
 * its choices as the form draws them, the custom role the command adds and
 * every permission it grants, the names of what OneUptime creates, how much
 * a rule or a group holds, and the statuses a policy shows.
 */

const AZURE: string = readPage("en", CLOUD_AZURE_WAF_BLOCKLIST);
const ARMOR: string = readPage("en", CLOUD_ARMOR_BLOCKLIST);

function field(provider: CloudProvider): CloudConnectionField {
  return getCloudConnectionDefinition(provider)!.configFields.find(
    (candidate: CloudConnectionField): boolean => {
      return candidate.key === WAF_BLOCKLIST_FIELD_KEY;
    },
  )!;
}

// The first column of the page's table headed `header`, each cell split at its commas, without backticks.
function listedIn(page: string, header: string): Array<string> {
  const table: Array<Array<string>> | undefined = tables(page).find(
    (candidate: Array<Array<string>>): boolean => {
      return candidate[0]?.[0] === header;
    },
  );

  expect(table).toBeDefined();

  return table!.slice(1).flatMap((row: Array<string>): Array<string> => {
    return (row[0] as string).split(",").map((item: string): string => {
      return item.split("`").join("").trim();
    });
  });
}

function figure(value: number): string {
  return value.toLocaleString("en-US");
}

describe("Block Addresses in Azure WAF", () => {
  it("names the setting and its choices as the connection's form draws them", () => {
    expect(AZURE).toContain(`**${field(CloudProvider.Azure).title}**`);

    for (const option of field(CloudProvider.Azure).options || []) {
      expect(AZURE).toContain(`**${option.label}**`);
    }
  });

  it("names the custom role and every action it grants, and no other", () => {
    expect(AZURE).toContain(`\`${AZURE_WAF_BLOCKLIST_ROLE}\``);
    expect([...listedIn(AZURE, "Action")].sort()).toEqual(
      [...AZURE_WAF_BLOCKLIST_ACTIONS].sort(),
    );
  });

  it("names OneUptime's rules as it names them, and says how much a rule and a policy hold", () => {
    expect(AZURE).toContain(
      `\`${getAzureWafRuleName("1a2b3c4d", 1).split("1a2b3c4d").join("<project>")}\``,
    );
    expect(AZURE).toContain(`at most ${AZURE_WAF_MAX_ONEUPTIME_RULES} of them`);
    expect(AZURE).toContain(
      `${AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE} addresses or ranges on Application Gateway`,
    );
    expect(AZURE).toContain(
      `${AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE_NEWER} with CRS 3.2`,
    );
    expect(AZURE).toContain(
      `${AZURE_FRONT_DOOR_WAF_ADDRESSES_PER_RULE} on Front Door`,
    );
    expect(AZURE).toContain(
      figure(
        AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE *
          AZURE_WAF_MAX_ONEUPTIME_RULES,
      ),
    );
    expect(AZURE).toContain(
      figure(
        AZURE_FRONT_DOOR_WAF_ADDRESSES_PER_RULE * AZURE_WAF_MAX_ONEUPTIME_RULES,
      ),
    );
  });

  it("names the statuses a policy shows, and the address each kind of policy matches", () => {
    for (const status of [
      "**Enforcing**",
      "**No Free Priority**",
      "**Applying**",
      "**Changed by Hand**",
      "**Put It Back**",
      "Not Enforcing",
    ]) {
      expect(AZURE).toContain(status);
    }

    for (const variable of ["SocketAddr", "RemoteAddr", "X-Forwarded-For"]) {
      expect(AZURE).toContain(variable);
    }
  });
});

describe("Block Addresses in Cloud Armor", () => {
  it("names the setting and its choices as the connection's form draws them", () => {
    expect(ARMOR).toContain(`**${field(CloudProvider.GCP).title}**`);

    for (const option of field(CloudProvider.GCP).options || []) {
      expect(ARMOR).toContain(`**${option.label}**`);
    }
  });

  it("names the custom role and every permission it grants, and no other", () => {
    expect(ARMOR).toContain(`\`${GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID}\``);
    expect([...listedIn(ARMOR, "Permission")].sort()).toEqual(
      [...GCP_CLOUD_ARMOR_BLOCKLIST_PERMISSIONS].sort(),
    );
  });

  it("names OneUptime's rules and address groups as it names them, and how much they hold", () => {
    expect(ARMOR).toContain(
      `\`${getCloudArmorRuleDescription("1a2b3c4d", 1)
        .split(".")[0]!
        .split("1a2b3c4d")
        .join("<project>")}\``,
    );

    const groups: { ipv4: string; ipv6: string } =
      getCloudArmorAddressGroupNames("<project>");

    expect(ARMOR).toContain(`\`${groups.ipv4}\``);
    expect(ARMOR).toContain(`\`${groups.ipv6}\``);
    expect(ARMOR).toContain(
      `up to ${CLOUD_ARMOR_ADDRESSES_PER_RULE} addresses or ranges`,
    );
    expect(ARMOR).toContain(
      `at most ${CLOUD_ARMOR_MAX_ONEUPTIME_RULES} of them`,
    );
    expect(ARMOR).toContain(
      `up to ${CLOUD_ARMOR_ADDRESSES_PER_RULE * CLOUD_ARMOR_MAX_ONEUPTIME_RULES} blocks`,
    );
    expect(ARMOR).toContain(
      `${figure(CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv4)} IPv4 and ${figure(CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6)} IPv6 ranges`,
    );
    // An IPv6 range counts three against the project's address group quota.
    expect(ARMOR).toContain(
      figure(
        CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv4 +
          3 * CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY.ipv6,
      ),
    );
  });

  it("names the statuses a policy shows, and where a rule reads the client's address", () => {
    for (const status of [
      "**Enforcing**",
      "**No Free Priority**",
      "**Changed by Hand**",
      "**Put It Back**",
      "Not Enforcing",
    ]) {
      expect(ARMOR).toContain(status);
    }

    for (const attribute of [
      "origin.ip",
      "origin.user_ip",
      "userIpRequestHeaders",
    ]) {
      expect(ARMOR).toContain(attribute);
    }
  });
});
