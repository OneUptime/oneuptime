import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../Utils/NetworkTraffic/NetworkAddressBlock";

/*
 * THE ADDRESSES NO BLOCK EVER TOUCHES (#10338).
 *
 * A block of one of the project's own addresses takes its own site down: a
 * load balancer, a NAT gateway its servers call out through, the probes that
 * check it, the edge in front of it. So a block is refused when it covers -
 * or falls inside - an address that is protected, and the refusal says what
 * protects it: "203.0.113.10 is the address of AWS::ElasticLoadBalancingV2::
 * LoadBalancer prod-alb in AWS account Production."
 *
 * An address is protected by the project's own list (Protected Entities, an
 * address or a range) or automatically: it is worked out, never stored, from
 * what OneUptime knows of the project -
 *
 *   - its hosts, Kubernetes nodes, cloud resources, network devices and
 *     network endpoints, and the addresses its people named;
 *   - its probes, by the address each checks in from, and OneUptime Cloud's
 *     probe addresses;
 *   - private, loopback, link-local and other ranges that are not on the
 *     internet;
 *   - the published ranges of the edge in front of the app, when one is
 *     connected (Cloudflare: blocking it at an origin WAF takes the site down).
 *
 * Here: where a protection comes from, what one says, and the ranges that
 * are not on the internet. The server reads the rest
 * (Server/Utils/SecurityBlocklist/SecurityProtectedAddresses).
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged.
 *
 * The Dashboard's locale extractor reads this file for what it marks and
 * nothing else (a "keys" root of its SOURCE_ROOTS): the Dashboard says why
 * an address is protected in the reader's language, and the server, which
 * answers in English, fills the same sentences as they are.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export enum SecurityProtectedAddressSource {
  // An entry of the project's Protected Entities list.
  ProtectedEntity = "ProtectedEntity",
  // A range that is not on the internet: private, loopback, link-local.
  LocalRange = "LocalRange",
  Host = "Host",
  KubernetesNode = "KubernetesNode",
  CloudResource = "CloudResource",
  NetworkDevice = "NetworkDevice",
  NetworkEndpoint = "NetworkEndpoint",
  // An address or a range someone named (Network > Address Names).
  AddressName = "AddressName",
  // The address one of the project's own probes checks in from.
  Probe = "Probe",
  // The address one of OneUptime's probes checks in from.
  GlobalProbe = "GlobalProbe",
  // OneUptime Cloud's probe addresses (the IP_WHITELIST setting).
  OneUptimeCloud = "OneUptimeCloud",
  // The published ranges of an edge the project has connected (Cloudflare).
  Edge = "Edge",
}

// What protects an address: where it comes from, and what it is.
export interface SecurityAddressProtection {
  source: SecurityProtectedAddressSource;
  // The protected address or range, written as blocks are.
  protectedValue: string;
  // What it is called: a record's name, a range's ("Cloudflare"), an entry's description.
  name?: string | undefined;
  // A cloud resource's kind, as its catalog names it.
  kind?: string | undefined;
  // Where it is: a cloud resource's account.
  where?: string | undefined;
  // The record it is the address of, when there is one.
  recordId?: string | undefined;
}

/*
 * What protects an address, as a sentence about the protected address or
 * range ({{address}}), with the record's name ({{name}}), a cloud
 * resource's kind ({{kind}}) and account ({{where}}). One sentence per
 * source, so a language words each its own way.
 */
export const SECURITY_PROTECTED_ADDRESS_SENTENCES: Readonly<
  Record<SecurityProtectedAddressSource, string>
> = {
  [SecurityProtectedAddressSource.ProtectedEntity]: translationKey(
    "{{address}} is on your Protected Entities list.",
  ),
  [SecurityProtectedAddressSource.LocalRange]: translationKey(
    "{{address}} is not on the internet: it is a private, loopback, link-local or reserved range, which no edge needs to block.",
  ),
  [SecurityProtectedAddressSource.Host]: translationKey(
    "{{address}} is the address of host {{name}}.",
  ),
  [SecurityProtectedAddressSource.KubernetesNode]: translationKey(
    "{{address}} is the address of Kubernetes node {{name}}.",
  ),
  [SecurityProtectedAddressSource.CloudResource]: translationKey(
    "{{address}} is the address of {{kind}} {{name}} in {{where}}.",
  ),
  [SecurityProtectedAddressSource.NetworkDevice]: translationKey(
    "{{address}} is the address of network device {{name}}.",
  ),
  [SecurityProtectedAddressSource.NetworkEndpoint]: translationKey(
    "{{address}} is the address of network endpoint {{name}}.",
  ),
  [SecurityProtectedAddressSource.AddressName]: translationKey(
    "{{address}} is named {{name}} in your Address Names.",
  ),
  [SecurityProtectedAddressSource.Probe]: translationKey(
    "{{address}} is the address your probe {{name}} checks from.",
  ),
  [SecurityProtectedAddressSource.GlobalProbe]: translationKey(
    "{{address}} is the address OneUptime's probe {{name}} checks from.",
  ),
  [SecurityProtectedAddressSource.OneUptimeCloud]: translationKey(
    "{{address}} is one of OneUptime Cloud's probe addresses.",
  ),
  [SecurityProtectedAddressSource.Edge]: translationKey(
    "{{address}} is one of {{name}}'s addresses, and {{name}} is in front of your app: blocking it would take your site down.",
  ),
};

/*
 * A cloud resource whose account OneUptime does not know: the sentence
 * without {{where}}.
 */
export const SECURITY_PROTECTED_CLOUD_RESOURCE_WITHOUT_ACCOUNT: string =
  translationKey("{{address}} is the address of {{kind}} {{name}}.");

/*
 * A record's address, said to someone who may not read that kind of
 * record: that it is the project's own, never which record it is.
 */
export const SECURITY_PROTECTED_OWN_ADDRESS: string = translationKey(
  "{{address}} is one of your project's own addresses.",
);

// The sources that are the project's own records, named only to whoever may read them.
export const SECURITY_PROTECTED_RECORD_SOURCES: ReadonlyArray<SecurityProtectedAddressSource> =
  [
    SecurityProtectedAddressSource.ProtectedEntity,
    SecurityProtectedAddressSource.Host,
    SecurityProtectedAddressSource.KubernetesNode,
    SecurityProtectedAddressSource.CloudResource,
    SecurityProtectedAddressSource.NetworkDevice,
    SecurityProtectedAddressSource.NetworkEndpoint,
    SecurityProtectedAddressSource.AddressName,
    SecurityProtectedAddressSource.Probe,
  ];

// Whether a protection names a record the reader was not shown.
export function isSecurityProtectionWithheld(
  protection: SecurityAddressProtection,
): boolean {
  return (
    SECURITY_PROTECTED_RECORD_SOURCES.includes(protection.source) &&
    !protection.name
  );
}

/*
 * The sentence before it when the block and the protected value are not the
 * same: a range that holds a protected address, or an address inside a
 * protected range.
 */
export const SECURITY_PROTECTED_RANGE_HOLDS: string = translationKey(
  "{{value}} holds {{address}}.",
);
export const SECURITY_PROTECTED_INSIDE_RANGE: string = translationKey(
  "{{value}} is inside {{address}}.",
);

// What a block's value has to do with what protects it.
export enum SecurityProtectionOverlap {
  // The same address or range.
  Same = "Same",
  // The block is a range that holds the protected address or range.
  BlockHoldsProtected = "BlockHoldsProtected",
  // The block is inside the protected range.
  BlockInsideProtected = "BlockInsideProtected",
}

export function getSecurityProtectionOverlap(data: {
  value: NetworkAddressBlock;
  protectedBlock: NetworkAddressBlock;
}): SecurityProtectionOverlap {
  if (
    data.value.prefixLength === data.protectedBlock.prefixLength &&
    NetworkAddressBlockUtil.containsBlock(data.value, data.protectedBlock)
  ) {
    return SecurityProtectionOverlap.Same;
  }

  return NetworkAddressBlockUtil.containsBlock(data.value, data.protectedBlock)
    ? SecurityProtectionOverlap.BlockHoldsProtected
    : SecurityProtectionOverlap.BlockInsideProtected;
}

// A sentence with its {{placeholders}} filled, as the server writes it.
function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [key, value] of Object.entries(values)) {
    text = text.split(`{{${key}}}`).join(value);
  }

  return text;
}

// The sentence that says what protects an address, before it is filled.
export function getSecurityProtectionSentence(
  protection: SecurityAddressProtection,
): string {
  if (isSecurityProtectionWithheld(protection)) {
    return SECURITY_PROTECTED_OWN_ADDRESS;
  }

  if (
    protection.source === SecurityProtectedAddressSource.CloudResource &&
    !protection.where
  ) {
    return SECURITY_PROTECTED_CLOUD_RESOURCE_WITHOUT_ACCOUNT;
  }

  return SECURITY_PROTECTED_ADDRESS_SENTENCES[protection.source];
}

/*
 * Why a block of `value` is refused, in English, as the server answers it:
 * "35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is the address of host
 * web-3."
 */
export function describeSecurityAddressProtection(data: {
  value: string;
  protection: SecurityAddressProtection;
}): string {
  const values: Record<string, string> = {
    value: data.value,
    address: data.protection.protectedValue,
    name: data.protection.name || data.protection.protectedValue,
    kind: data.protection.kind || "resource",
    where: data.protection.where || "",
  };

  const sentence: string = fill(
    getSecurityProtectionSentence(data.protection),
    values,
  );

  const valueBlock: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
    data.value,
  );
  const protectedBlock: NetworkAddressBlock | null =
    NetworkAddressBlockUtil.parse(data.protection.protectedValue);

  if (!valueBlock || !protectedBlock) {
    return sentence;
  }

  switch (getSecurityProtectionOverlap({ value: valueBlock, protectedBlock })) {
    case SecurityProtectionOverlap.BlockHoldsProtected:
      return `${fill(SECURITY_PROTECTED_RANGE_HOLDS, values)} ${sentence}`;
    case SecurityProtectionOverlap.BlockInsideProtected:
      return `${fill(SECURITY_PROTECTED_INSIDE_RANGE, values)} ${sentence}`;
    default:
      return sentence;
  }
}

/*
 * The ranges that are not on the internet, which a block never covers: what
 * getSecurityAddressScope (Utils/SecurityCase/SecurityConnectionMatch) calls
 * Local or Private. An edge never sees a request from them, so a block of
 * one does nothing there, and the project's own machines use them.
 */
export const SECURITY_LOCAL_ADDRESS_RANGES: ReadonlyArray<string> = [
  // IPv4: this network, private networks, shared address space (carrier-grade NAT), loopback, link-local, multicast and reserved.
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
  // IPv6: unspecified, loopback, IPv4-mapped, unique local, link-local, site-local and multicast.
  "::/128",
  "::1/128",
  "::ffff:0:0/96",
  "fc00::/7",
  "fe80::/10",
  "fec0::/10",
  "ff00::/8",
];

// The local range a block overlaps, if any.
export function findLocalRangeProtection(
  block: NetworkAddressBlock,
): SecurityAddressProtection | null {
  for (const range of SECURITY_LOCAL_ADDRESS_RANGES) {
    const parsed: NetworkAddressBlock | null =
      NetworkAddressBlockUtil.parse(range);

    if (parsed && NetworkAddressBlockUtil.overlaps(block, parsed)) {
      return {
        source: SecurityProtectedAddressSource.LocalRange,
        protectedValue: parsed.text,
      };
    }
  }

  return null;
}

/*
 * The protection a block overlaps among a list of protected values (the
 * project's entries, OneUptime Cloud's probe addresses, an edge's ranges):
 * the first one, in the list's order. Values that are not an address or a
 * range are skipped.
 */
export function findProtectionAmong(data: {
  block: NetworkAddressBlock;
  protections: ReadonlyArray<SecurityAddressProtection>;
}): SecurityAddressProtection | null {
  for (const protection of data.protections) {
    const parsed: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
      protection.protectedValue,
    );

    if (parsed && NetworkAddressBlockUtil.overlaps(data.block, parsed)) {
      return { ...protection, protectedValue: parsed.text };
    }
  }

  return null;
}
