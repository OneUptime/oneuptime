/*
 * A CLOUD WAF THAT ENFORCES THE BLOCKLIST (#10344): one web ACL of an AWS
 * account connected to the project - and, as #10348 and #10349 add them,
 * one Azure WAF policy or one Google Cloud Armor security policy - picked
 * from its cloud connection's inventory on the Blocklist page. Each is a
 * destination of the blocklist of its own ("AWS WAF (prod-alb)"), kept true
 * by the reconciler like every other (Server/Utils/SecurityBlocklist), and
 * enforced through its connection's opt-in ("Block addresses in AWS WAF",
 * CloudConnectionCatalog's wafBlocklist).
 *
 * Here, for every cloud alike: where the WAF reads the client's address
 * from, and where the WAF itself stands - what the Blocklist page shows
 * beside it, written by OneUptime each time it reads the WAF.
 */

/*
 * Where a WAF reads the client's address. A WAF in front of the app sees
 * the client itself, and reads the request's source address (the
 * default). One behind another proxy or CDN sees that proxy's address, so
 * it reads the header the proxy writes the client's address in instead.
 */
export enum SecurityBlockClientAddress {
  SourceIp = "SourceIp",
  XForwardedFor = "XForwardedFor",
  CfConnectingIp = "CfConnectingIp",
  TrueClientIp = "TrueClientIp",
}

export const SECURITY_BLOCK_CLIENT_ADDRESSES: ReadonlyArray<SecurityBlockClientAddress> =
  [
    SecurityBlockClientAddress.SourceIp,
    SecurityBlockClientAddress.XForwardedFor,
    SecurityBlockClientAddress.CfConnectingIp,
    SecurityBlockClientAddress.TrueClientIp,
  ];

export const SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS: SecurityBlockClientAddress =
  SecurityBlockClientAddress.SourceIp;

/*
 * The header each reads, and which of the addresses in it is the client's.
 *
 *   X-Forwarded-For    the last: the address the proxy in front of the WAF
 *                      saw and appended. Every address before it is what
 *                      the request claimed, which its sender wrote (#10416):
 *                      a block of a claimed address is no block.
 *   CF-Connecting-IP,  the one address Cloudflare, Akamai or CloudFront
 *   True-Client-IP     writes, replacing any the request sent.
 */
export interface SecurityBlockClientAddressHeader {
  header: string;
  position: "FIRST" | "LAST";
}

export const SECURITY_BLOCK_CLIENT_ADDRESS_HEADERS: Readonly<
  Record<
    Exclude<SecurityBlockClientAddress, SecurityBlockClientAddress.SourceIp>,
    SecurityBlockClientAddressHeader
  >
> = {
  [SecurityBlockClientAddress.XForwardedFor]: {
    header: "X-Forwarded-For",
    position: "LAST",
  },
  [SecurityBlockClientAddress.CfConnectingIp]: {
    header: "CF-Connecting-IP",
    position: "FIRST",
  },
  [SecurityBlockClientAddress.TrueClientIp]: {
    header: "True-Client-IP",
    position: "FIRST",
  },
};

// The header a WAF reads the client's address from: null for the source address.
export function getSecurityBlockClientAddressHeader(
  clientAddress: SecurityBlockClientAddress | string | undefined | null,
): SecurityBlockClientAddressHeader | null {
  if (
    !isSecurityBlockClientAddress(clientAddress) ||
    clientAddress === SecurityBlockClientAddress.SourceIp
  ) {
    return null;
  }

  return SECURITY_BLOCK_CLIENT_ADDRESS_HEADERS[clientAddress];
}

export function isSecurityBlockClientAddress(
  value: unknown,
): value is SecurityBlockClientAddress {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_CLIENT_ADDRESSES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * Where a cloud WAF stands, as OneUptime last read it:
 *
 *   Checking        added, and not read yet;
 *   Enforcing       OneUptime's IP sets are there and its rule blocks them:
 *                   the blocklist is enforced in it;
 *   WaitingForRule  the IP sets are there, and the rule that blocks them is
 *                   not yet - a WAF its team keeps in code, whose rule they
 *                   add themselves (statusMessage says which sets it lacks);
 *   NoFreePriority  no priority is free below the WAF's first rule for
 *                   OneUptime's, and OneUptime never renumbers a rule of
 *                   the customer's: someone frees one;
 *   Failed          OneUptime could not read or write it: why, and what to
 *                   do, in statusMessage.
 *
 * Only Enforcing enforces anything; the Blocklist page says so of the
 * others, and its blocks say "Not enforced" until a destination holds them.
 */
export enum SecurityBlockCloudWafStatus {
  Checking = "Checking",
  Enforcing = "Enforcing",
  WaitingForRule = "WaitingForRule",
  NoFreePriority = "NoFreePriority",
  Failed = "Failed",
}

export const SECURITY_BLOCK_CLOUD_WAF_STATUSES: ReadonlyArray<SecurityBlockCloudWafStatus> =
  [
    SecurityBlockCloudWafStatus.Checking,
    SecurityBlockCloudWafStatus.Enforcing,
    SecurityBlockCloudWafStatus.WaitingForRule,
    SecurityBlockCloudWafStatus.NoFreePriority,
    SecurityBlockCloudWafStatus.Failed,
  ];

export function isSecurityBlockCloudWafStatus(
  value: unknown,
): value is SecurityBlockCloudWafStatus {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_CLOUD_WAF_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

// The longest status message a cloud WAF keeps.
export const SECURITY_BLOCK_CLOUD_WAF_MESSAGE_MAX_LENGTH: number = 1000;

/*
 * What OneUptime leaves in a cloud WAF it no longer enforces the blocklist
 * in - its rule, kept by "remove from OneUptime only", or an IP set a rule
 * of the team's still references - named for the person to delete there.
 */
export enum SecurityBlockCloudWafLeftKind {
  IpSet = "ipSet",
  Rule = "rule",
}

export interface SecurityBlockCloudWafLeftItem {
  kind: SecurityBlockCloudWafLeftKind;
  // Its name in the WAF: "oneuptime-1a2b3c4d-block-ipv4".
  name: string;
  // A rule's web ACL.
  webAcl?: string | undefined;
}
