import { CloudProvider } from "../Cloud/CloudPlatform";
import { parseAwsWafArn } from "../CloudConnection/AwsWafBlocklist";
import {
  AZURE_WAF_CLIENT_ADDRESSES,
  AzureWafPolicyKind,
  AzureWafPolicyRef,
  parseAzureWafPolicyId,
} from "../CloudConnection/AzureWafBlocklist";
import {
  getCloudArmorClientAddresses,
  parseCloudArmorPolicyId,
} from "../CloudConnection/CloudArmorBlocklist";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockClientAddress,
} from "./SecurityBlockCloudWaf";

/*
 * THE KINDS OF CLOUD WAF THE BLOCKLIST IS ENFORCED IN (#10344, #10348,
 * #10349): an AWS WAF web ACL, an Azure Application Gateway or Front Door
 * WAF policy, a Google Cloud Armor security policy. One row of
 * SecurityBlockCloudWaf is one of them, told apart by its cloud and the id
 * it keeps; each reads the client's address its own ways, so the page
 * offers - and the server takes - only the ones its kind can read.
 */

export enum SecurityBlockCloudWafKind {
  AwsWebAcl = "awsWebAcl",
  AzureApplicationGateway = "azureApplicationGateway",
  AzureFrontDoor = "azureFrontDoor",
  CloudArmor = "cloudArmor",
}

// The client addresses AWS WAF can read: the source address, or a header a proxy writes.
const AWS_CLIENT_ADDRESSES: ReadonlyArray<SecurityBlockClientAddress> = [
  SecurityBlockClientAddress.SourceIp,
  SecurityBlockClientAddress.XForwardedFor,
  SecurityBlockClientAddress.CfConnectingIp,
  SecurityBlockClientAddress.TrueClientIp,
];

// A row's kind, from its cloud and the id it keeps; null for one OneUptime cannot read.
export function getSecurityBlockCloudWafKind(data: {
  cloudProvider: string | undefined | null;
  wafId: string | undefined | null;
}): SecurityBlockCloudWafKind | null {
  if (data.cloudProvider === CloudProvider.AWS) {
    return parseAwsWafArn(data.wafId)
      ? SecurityBlockCloudWafKind.AwsWebAcl
      : null;
  }

  if (data.cloudProvider === CloudProvider.Azure) {
    const policy: AzureWafPolicyRef | null = parseAzureWafPolicyId(data.wafId);

    if (!policy) {
      return null;
    }

    return policy.kind === AzureWafPolicyKind.ApplicationGateway
      ? SecurityBlockCloudWafKind.AzureApplicationGateway
      : SecurityBlockCloudWafKind.AzureFrontDoor;
  }

  if (data.cloudProvider === CloudProvider.GCP) {
    return parseCloudArmorPolicyId(data.wafId)
      ? SecurityBlockCloudWafKind.CloudArmor
      : null;
  }

  return null;
}

/*
 * The client addresses a WAF of a kind can read, the default first. A
 * Cloud Armor policy's depend on its type (an edge policy reads no user
 * IP): passed when known.
 */
export function getSecurityBlockCloudWafClientAddresses(data: {
  kind: SecurityBlockCloudWafKind | null;
  cloudArmorPolicyType?: string | undefined | null;
}): ReadonlyArray<SecurityBlockClientAddress> {
  switch (data.kind) {
    case SecurityBlockCloudWafKind.AwsWebAcl:
      return AWS_CLIENT_ADDRESSES;
    case SecurityBlockCloudWafKind.AzureApplicationGateway:
      return AZURE_WAF_CLIENT_ADDRESSES[AzureWafPolicyKind.ApplicationGateway];
    case SecurityBlockCloudWafKind.AzureFrontDoor:
      return AZURE_WAF_CLIENT_ADDRESSES[AzureWafPolicyKind.FrontDoor];
    case SecurityBlockCloudWafKind.CloudArmor:
      return getCloudArmorClientAddresses(data.cloudArmorPolicyType);
    default:
      return [SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS];
  }
}

// Whether a WAF of a kind can read the client's address where a person asked.
export function canSecurityBlockCloudWafReadClientAddress(data: {
  kind: SecurityBlockCloudWafKind | null;
  cloudArmorPolicyType?: string | undefined | null;
  clientAddress: SecurityBlockClientAddress | string | undefined | null;
}): boolean {
  return (
    getSecurityBlockCloudWafClientAddresses(data) as ReadonlyArray<string>
  ).includes(String(data.clientAddress || ""));
}

// The product each kind is, as a destination's name starts: "Azure WAF (prod-waf)".
export const SECURITY_BLOCK_CLOUD_WAF_PRODUCTS: Readonly<
  Record<SecurityBlockCloudWafKind, string>
> = {
  [SecurityBlockCloudWafKind.AwsWebAcl]: "AWS WAF",
  [SecurityBlockCloudWafKind.AzureApplicationGateway]: "Azure WAF",
  [SecurityBlockCloudWafKind.AzureFrontDoor]: "Azure WAF",
  [SecurityBlockCloudWafKind.CloudArmor]: "Cloud Armor",
};
