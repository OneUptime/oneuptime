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
  /*
   * Azure Front Door's RemoteAddr (#10348): the original client, which
   * Front Door takes from X-Forwarded-For - for a Front Door behind another
   * proxy or CDN that writes it. A client that reaches Front Door directly
   * writes that header itself.
   */
  ForwardedClient = "ForwardedClient",
  /*
   * Google Cloud Armor's origin.user_ip (#10349): the address in the first
   * of the policy's user IP request headers that holds one, or the
   * connecting address when none does.
   */
  UserIp = "UserIp",
}

export const SECURITY_BLOCK_CLIENT_ADDRESSES: ReadonlyArray<SecurityBlockClientAddress> =
  [
    SecurityBlockClientAddress.SourceIp,
    SecurityBlockClientAddress.XForwardedFor,
    SecurityBlockClientAddress.CfConnectingIp,
    SecurityBlockClientAddress.TrueClientIp,
    SecurityBlockClientAddress.ForwardedClient,
    SecurityBlockClientAddress.UserIp,
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

// The client addresses AWS WAF reads from a header (a forwarded IP configuration).
export type SecurityBlockClientAddressHeaderChoice =
  | SecurityBlockClientAddress.XForwardedFor
  | SecurityBlockClientAddress.CfConnectingIp
  | SecurityBlockClientAddress.TrueClientIp;

export const SECURITY_BLOCK_CLIENT_ADDRESS_HEADERS: Readonly<
  Record<
    SecurityBlockClientAddressHeaderChoice,
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

/*
 * The header AWS WAF reads the client's address from: null for the source
 * address, and for a choice another cloud reads its own way (Front Door's
 * RemoteAddr, Cloud Armor's user IP).
 */
export function getSecurityBlockClientAddressHeader(
  clientAddress: SecurityBlockClientAddress | string | undefined | null,
): SecurityBlockClientAddressHeader | null {
  if (
    clientAddress === SecurityBlockClientAddress.XForwardedFor ||
    clientAddress === SecurityBlockClientAddress.CfConnectingIp ||
    clientAddress === SecurityBlockClientAddress.TrueClientIp
  ) {
    return SECURITY_BLOCK_CLIENT_ADDRESS_HEADERS[clientAddress];
  }

  return null;
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
 *   Applying        the WAF holds OneUptime's latest change and is still
 *                   applying it everywhere (Azure Front Door and
 *                   Application Gateway's provisioning, #10348): its new
 *                   blocks are Pending there until it is done;
 *   Drifted         a rule of OneUptime's was turned off, changed or
 *                   deleted by hand (#10348, #10349): OneUptime never puts
 *                   it back behind the person's back, and the blocks it held
 *                   are not enforced until someone selects Put It Back;
 *   Failed          OneUptime could not read or write it, or the WAF itself
 *                   blocks nothing (turned off, in Detection mode, attached
 *                   to nothing): why, and what to do, in statusMessage.
 *
 * Only Enforcing enforces anything; the Blocklist page says so of the
 * others, and its blocks say "Not enforced" until a destination holds them.
 */
export enum SecurityBlockCloudWafStatus {
  Checking = "Checking",
  Enforcing = "Enforcing",
  WaitingForRule = "WaitingForRule",
  NoFreePriority = "NoFreePriority",
  Applying = "Applying",
  Drifted = "Drifted",
  Failed = "Failed",
}

export const SECURITY_BLOCK_CLOUD_WAF_STATUSES: ReadonlyArray<SecurityBlockCloudWafStatus> =
  [
    SecurityBlockCloudWafStatus.Checking,
    SecurityBlockCloudWafStatus.Enforcing,
    SecurityBlockCloudWafStatus.WaitingForRule,
    SecurityBlockCloudWafStatus.NoFreePriority,
    SecurityBlockCloudWafStatus.Applying,
    SecurityBlockCloudWafStatus.Drifted,
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
 * Azure WAF's rules are named rules (#10348); Cloud Armor's are known by
 * their priority, and its address groups by name (#10349).
 */
export enum SecurityBlockCloudWafLeftKind {
  IpSet = "ipSet",
  Rule = "rule",
  PriorityRule = "priorityRule",
  AddressGroup = "addressGroup",
}

export interface SecurityBlockCloudWafLeftItem {
  kind: SecurityBlockCloudWafLeftKind;
  // Its name in the WAF: "oneuptime-1a2b3c4d-block-ipv4", "OneUptime1a2b3c4dBlock1".
  name: string;
  // A rule's web ACL or policy.
  webAcl?: string | undefined;
  // A Cloud Armor rule's priority.
  priority?: number | undefined;
}

export function isSecurityBlockCloudWafLeftKind(
  value: unknown,
): value is SecurityBlockCloudWafLeftKind {
  return (
    typeof value === "string" &&
    (Object.values(SecurityBlockCloudWafLeftKind) as Array<string>).includes(
      value,
    )
  );
}
