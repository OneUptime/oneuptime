import { NetworkTopologyDeviceRole } from "../../Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Works out what a node on the network topology map DOES — router, switch,
 * firewall, access point, load balancer, server, storage, or one of the
 * leaf roles (printer, camera, phone, plain host).
 *
 * Why derive it rather than store it: nothing in SNMP hands us a role. The
 * evidence we already collect does, though, and it arrives in a strict
 * order of trustworthiness:
 *
 *   1. the product family in sysDescr / model / the CDP platform string
 *      ("Catalyst 2960", "FortiGate-60F", "SRX340") — a named family is
 *      the closest thing to a declaration of purpose,
 *   2. the sysObjectId enterprise arc, for the vendors whose entire
 *      catalogue is one role (Palo Alto, F5, NetApp, ...),
 *   3. the generic words in sysDescr ("... Switch ...", "Load Balancer"),
 *   4. the naming convention in the hostname ("core-sw-1", "edge-fw01"),
 *   5. last and weakest, a general-purpose OS or SNMP agent in sysDescr —
 *      "it is a computer", which loses to a hostname that says otherwise
 *      because switches and firewalls announce Linux kernels too.
 *
 * Each tier is weaker than the one above it, so they are tried in order
 * and the first answer wins. When nothing matches the answer is "unknown",
 * which is deliberate: a neutral node is honest, and a router drawn as a
 * firewall because its hostname happened to contain "fw" is not. This is
 * also why unmanaged CDP/LLDP peers — for which we have a platform string
 * and a name and nothing else — mostly come back "unknown", and should.
 *
 * Pure and dependency-free so it runs identically in the topology builder
 * on the server and in the unit tests.
 */

/** Everything the classifier is allowed to look at. All best-effort. */
export interface DeviceRoleSignals {
  sysDescr?: string | undefined;
  sysObjectId?: string | undefined;
  vendor?: string | undefined;
  /** NetworkDevice.deviceModel for managed nodes. */
  deviceModel?: string | undefined;
  /** The CDP platform string an unmanaged peer advertises about itself. */
  platform?: string | undefined;
  name?: string | undefined;
  sysName?: string | undefined;
}

/** What a discovered (ARP/FDB) endpoint tells us about itself. */
export interface EndpointRoleSignals {
  /** User-editable free text: "POS", "Camera", "Printer", ... */
  classification?: string | undefined;
  vendor?: string | undefined;
  name?: string | undefined;
}

interface RoleRule {
  role: NetworkTopologyDeviceRole;
  pattern: RegExp;
  /*
   * Only applied when the vendor evidence matches. This is what keeps
   * Juniper's MX960 (a core router) apart from Meraki's MX64 (a security
   * appliance) — the model strings are otherwise the same shape.
   */
  vendor?: RegExp | undefined;
}

/** Human-readable role names. One source of truth for UI and tests. */
export const DEVICE_ROLE_LABELS: Record<NetworkTopologyDeviceRole, string> = {
  router: "Router",
  switch: "Switch",
  firewall: "Firewall",
  wirelessAccessPoint: "Wireless AP",
  loadBalancer: "Load balancer",
  server: "Server",
  storage: "Storage",
  printer: "Printer",
  camera: "Camera",
  phone: "IP phone",
  host: "Host",
  unknown: "Unknown type",
};

/** Every role except "unknown", in the order a legend should list them. */
export const DEVICE_ROLES_IN_LEGEND_ORDER: ReadonlyArray<NetworkTopologyDeviceRole> =
  [
    "router",
    "switch",
    "firewall",
    "wirelessAccessPoint",
    "loadBalancer",
    "server",
    "storage",
    "printer",
    "camera",
    "phone",
    "host",
  ];

/*
 * Tier 1 — named product families. Ordered most specific first, because
 * the first match wins: the leaf roles come before the infrastructure
 * ones so "Cisco IP Phone 7961" is a phone rather than being swallowed by
 * a later Cisco rule.
 *
 * A note on the boundaries. Every pattern is anchored with a LEADING \b
 * and, for the model-code alternatives, deliberately no trailing one:
 * real model strings run straight on into suffixes ("AIR-CAP3702I-A-K9",
 * "C9300L-24P", "DCS-7050SX3-48YC8"), and a closing \b silently refuses
 * to match every one of them. Alternatives that are ordinary words keep
 * their own trailing \b, so "nas" cannot match "nasa".
 */
const PRODUCT_RULES: ReadonlyArray<RoleRule> = [
  // --- leaf devices that also speak SNMP ---
  {
    role: "camera",
    pattern:
      /\b(?:ip[- ]?camera|network camera|cctv\b|nvr\b|hikvision|dahua|axis [pqmf]\d{4})/,
  },
  { role: "camera", pattern: /\bmv\d{2}/, vendor: /meraki|cisco/ },
  {
    role: "phone",
    pattern:
      /\b(?:ip phone|voip phone|desk phone|polycom|yealink|grandstream|snom\b|spa\d{3}|cp-\d{4})/,
  },
  {
    role: "printer",
    pattern:
      /\b(?:laserjet|officejet|deskjet|designjet|jetdirect|imagerunner|workcentre|workcenter|bizhub|kyocera|lexmark|mfp\b|multifunction printer)/,
  },

  // --- firewalls / security appliances ---
  { role: "firewall", pattern: /\b(?:fortigate|fortiwifi|forti-gate)/ },
  {
    role: "firewall",
    pattern: /\b(?:palo alto|pan-?os\b|pa-\d{3,4})/,
  },
  {
    role: "firewall",
    pattern:
      /\b(?:adaptive security appliance|cisco asa\b|asa\d{4}|firepower|ftd\b|pix\b)/,
  },
  { role: "firewall", pattern: /\bsrx ?\d{2,4}|\bsrx\b/ },
  {
    role: "firewall",
    pattern:
      /\b(?:sonicwall|watchguard|check ?point|gaia\b|pfsense|opnsense|untangle|barracuda)/,
  },
  { role: "firewall", pattern: /\bsophos (?:xg|xgs|utm|sg)\b/ },
  {
    role: "firewall",
    pattern: /\bmx\d{2,3}|\bz\d{1,2}\b/,
    vendor: /meraki/,
  },

  // --- load balancers / application delivery ---
  {
    role: "loadBalancer",
    pattern:
      /\b(?:big-?ip|f5 networks|tmos\b|netscaler|citrix adc|a10 thunder|ax\d{4}|loadmaster|avi vantage|haproxy)/,
  },

  // --- wireless ---
  {
    role: "wirelessAccessPoint",
    pattern:
      /\b(?:aironet|air-(?:cap|ap|lap|sap|ct)|wlc\b|wireless lan controller|wireless controller)/,
  },
  /*
   * Cisco recycled "Catalyst" across three roles, so the two that are not
   * switches have to be claimed before the blanket Catalyst rule below:
   * a 9800 is a wireless controller and an 8000 is a router.
   */
  {
    role: "wirelessAccessPoint",
    pattern: /\b(?:catalyst 98\d{2}|c98\d{2})/,
  },
  {
    role: "wirelessAccessPoint",
    pattern:
      /\b(?:unifi ap|uap[- ]|u6-|nanostation|instant ap|iap\b|aruba ap|ap-\d{3}|fortiap|omada|eap\d{3}|cw9\d{3})/,
  },
  {
    role: "wirelessAccessPoint",
    pattern: /\bmr\d{2,3}/,
    vendor: /meraki/,
  },

  /*
   * --- switches ---
   * First, the other half of the Catalyst disambiguation above.
   */
  {
    role: "router",
    pattern: /\b(?:catalyst 8\d{3}|c8\d{3})/,
  },
  {
    role: "switch",
    pattern:
      /\b(?:catalyst|nexus|ws-c\d|c9[2345]\d{2}|c1000|c2960|c3[578]\d{2}|me-\d{4})/,
  },
  {
    role: "switch",
    pattern: /\b(?:ex\d{4}|qfx\d{4})/,
  },
  {
    role: "switch",
    pattern: /\bms\d{2,3}/,
    vendor: /meraki/,
  },
  {
    role: "switch",
    pattern:
      /\b(?:fortiswitch|procurve|powerconnect|force10|dcs-\d{4}|icx\d{4}|edgeswitch|unifi switch|usw-|crs\d{3}|css\d{3}|sg\d{3}|gs\d{3}|jl\d{3}[a-z]|s\d{4}-on|n\d{4}-on)/,
  },

  // --- routers ---
  {
    role: "router",
    pattern: /\b(?:isr ?\d{3,4}|isr\b|asr ?\d{3,4}|c11\d{2}|c89\d\b|csr1000v)/,
  },
  {
    role: "router",
    pattern: /\b(?:mx\d{2,4}|ptx\d{4}|acx\d{4})/,
    vendor: /juniper|junos/,
  },
  {
    role: "router",
    pattern:
      /\b(?:routeros|mikrotik|ccr\d{4}|rb\d{3,4}|edgerouter|vyos\b|vsr\b)/,
  },

  // --- storage ---
  {
    role: "storage",
    pattern:
      /\b(?:netapp|data ontap|isilon|powerstore|powervault|unity xt|synology|qnap|truenas|freenas|pure ?storage|nimble storage|storwize|nas\b|san\b)/,
  },

  // --- servers / hypervisors / lights-out controllers ---
  {
    role: "server",
    pattern:
      /\b(?:esxi|vmware|proxmox|hyper-?v\b|xenserver|idrac\b|ilo\b|integrated lights-out|cimc\b|poweredge|proliant|thinksystem|primergy)/,
  },
];

/*
 * Tier 3 — the generic words. Only consulted when no product family
 * matched, and only against sysDescr, which is the one field vendors
 * write a sentence into.
 */
const GENERIC_RULES: ReadonlyArray<RoleRule> = [
  {
    role: "firewall",
    pattern: /\b(firewall|security appliance|utm appliance)\b/,
  },
  {
    role: "loadBalancer",
    pattern: /\b(load ?balancer|application delivery controller)\b/,
  },
  {
    role: "wirelessAccessPoint",
    pattern: /\b(access point|wireless|wi-?fi|wlan)\b/,
  },
  { role: "printer", pattern: /\b(printer|print server|copier|scanner)\b/ },
  { role: "camera", pattern: /\bcamera\b/ },
  { role: "phone", pattern: /\b(phone|voip)\b/ },
  { role: "switch", pattern: /\b(switch|switching)\b/ },
  { role: "router", pattern: /\b(router|routing|gateway)\b/ },
  { role: "storage", pattern: /\b(storage array|storage system|filer)\b/ },
];

/*
 * The weakest evidence there is: a general-purpose operating system in
 * sysDescr. It says the box is a computer, not what job it does — plenty
 * of switches and firewalls announce a Linux kernel — so it is consulted
 * only after the hostname has had its say. A machine called "gw-1" that
 * runs Linux is a router; a machine called "app-3" that runs Linux is a
 * server.
 */
const OPERATING_SYSTEM_RULES: ReadonlyArray<RoleRule> = [
  {
    role: "server",
    pattern:
      /\b(linux|windows|ubuntu|debian|centos|red ?hat|freebsd|solaris|net-snmp|\bserver\b)\b/,
  },
];

/*
 * Tier 2 — sysObjectId enterprise arcs, for vendors that only make one
 * kind of box. Deliberately short: a vendor with a mixed catalogue (Cisco,
 * Juniper, HPE, Ubiquiti) tells us nothing here, and a wrong shape is
 * worse than a neutral one. Matched on dotted-prefix boundaries so
 * ".1.3.6.1.4.1.11" cannot swallow ".1.3.6.1.4.1.1124".
 */
const SYS_OBJECT_ID_RULES: ReadonlyArray<{
  prefix: string;
  role: NetworkTopologyDeviceRole;
}> = [
  // Printers, most specific arcs first (HP's printer arc sits under HP's).
  { prefix: "1.3.6.1.4.1.11.2.3.9", role: "printer" },
  { prefix: "1.3.6.1.4.1.641", role: "printer" }, // Lexmark
  { prefix: "1.3.6.1.4.1.1602", role: "printer" }, // Canon
  { prefix: "1.3.6.1.4.1.367", role: "printer" }, // Ricoh
  { prefix: "1.3.6.1.4.1.253", role: "printer" }, // Xerox
  { prefix: "1.3.6.1.4.1.1248", role: "printer" }, // Epson
  { prefix: "1.3.6.1.4.1.236", role: "printer" }, // Samsung printers
  // Firewalls.
  { prefix: "1.3.6.1.4.1.12356", role: "firewall" }, // Fortinet
  { prefix: "1.3.6.1.4.1.25461", role: "firewall" }, // Palo Alto
  { prefix: "1.3.6.1.4.1.2620", role: "firewall" }, // Check Point
  { prefix: "1.3.6.1.4.1.8741", role: "firewall" }, // SonicWall
  { prefix: "1.3.6.1.4.1.3097", role: "firewall" }, // WatchGuard
  { prefix: "1.3.6.1.4.1.2604", role: "firewall" }, // Sophos / Astaro
  // Load balancers.
  { prefix: "1.3.6.1.4.1.3375", role: "loadBalancer" }, // F5
  { prefix: "1.3.6.1.4.1.5951", role: "loadBalancer" }, // Citrix NetScaler
  { prefix: "1.3.6.1.4.1.22610", role: "loadBalancer" }, // A10
  // Storage.
  { prefix: "1.3.6.1.4.1.789", role: "storage" }, // NetApp
  // Switching / routing houses.
  { prefix: "1.3.6.1.4.1.30065", role: "switch" }, // Arista
  { prefix: "1.3.6.1.4.1.6027", role: "switch" }, // Force10 / Dell
  { prefix: "1.3.6.1.4.1.14988", role: "router" }, // MikroTik
];

/*
 * Generic SNMP agents. These identify the AGENT, not the appliance — a
 * Linux firewall answers on Net-SNMP just as readily as a database server
 * does — so, like the OS rules, they are consulted only after the
 * hostname.
 */
const GENERIC_AGENT_SYS_OBJECT_ID_RULES: ReadonlyArray<{
  prefix: string;
  role: NetworkTopologyDeviceRole;
}> = [
  { prefix: "1.3.6.1.4.1.8072", role: "server" }, // Net-SNMP
  { prefix: "1.3.6.1.4.1.2021", role: "server" }, // UCD-SNMP
  { prefix: "1.3.6.1.4.1.311", role: "server" }, // Microsoft
  { prefix: "1.3.6.1.4.1.6876", role: "server" }, // VMware
];

/*
 * Tier 4 — hostname conventions. Whole tokens only ("core-sw-1" → "sw",
 * "edge-fw01" → "fw01"), never substrings, so "swan" is not a switch and
 * "apex" is not an access point.
 */
const NAME_RULES: ReadonlyArray<RoleRule> = [
  { role: "router", pattern: /^(rtr|router|rt|gw|gwy|gateway)\d*$/ },
  {
    role: "switch",
    pattern: /^(sw|swi|switch|sws|dsw|asw|csw|tor|leaf|spine)\d*$/,
  },
  { role: "firewall", pattern: /^(fw|fwl|firewall|asa|ngfw|utm)\d*$/ },
  { role: "wirelessAccessPoint", pattern: /^(ap|wap|wifi|wlan|wlc)\d*$/ },
  { role: "loadBalancer", pattern: /^(lb|slb|adc|vip)\d*$/ },
  { role: "server", pattern: /^(srv|server|esx|esxi|vmhost)\d*$/ },
  { role: "storage", pattern: /^(nas|san|stor|storage|filer)\d*$/ },
  { role: "camera", pattern: /^(cam|camera|ipcam|cctv)\d*$/ },
  { role: "printer", pattern: /^(prn|print|printer|mfp)\d*$/ },
  { role: "phone", pattern: /^(phone|voip|sip)\d*$/ },
];

/*
 * Endpoint classifications are free text a human typed, so they are
 * matched loosely — but still whole-word, and still ordered so the
 * specific ones win.
 */
const ENDPOINT_RULES: ReadonlyArray<RoleRule> = [
  {
    role: "camera",
    pattern:
      /\b(camera|cam|cctv|nvr|dvr|hikvision|dahua|axis communications)\b/,
  },
  {
    role: "printer",
    pattern:
      /\b(printer|print|mfp|copier|scanner|label|zebra|brother|lexmark|kyocera|ricoh|xerox|epson)\b/,
  },
  {
    role: "phone",
    pattern:
      /\b(phone|voip|sip|handset|intercom|polycom|yealink|avaya|mitel)\b/,
  },
  {
    role: "wirelessAccessPoint",
    pattern: /\b(access point|\bap\b|wireless|wi-?fi)\b/,
  },
  { role: "switch", pattern: /\bswitch\b/ },
  { role: "router", pattern: /\b(router|gateway)\b/ },
  { role: "server", pattern: /\b(server|nas|hypervisor)\b/ },
];

/** Lowercase, whitespace-collapsed, and safe on undefined. */
function normalize(value: string | undefined): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function firstMatch(
  rules: ReadonlyArray<RoleRule>,
  haystack: string,
  vendorText: string,
): NetworkTopologyDeviceRole | undefined {
  if (!haystack) {
    return undefined;
  }
  for (const rule of rules) {
    if (rule.vendor && !rule.vendor.test(vendorText)) {
      continue;
    }
    if (rule.pattern.test(haystack)) {
      return rule.role;
    }
  }
  return undefined;
}

/*
 * Dotted-prefix containment: the arc must end at a dot or at the end of
 * the OID. Leading dots (".1.3.6.1...", which plenty of agents emit) are
 * stripped first.
 */
function roleForSysObjectId(
  sysObjectId: string | undefined,
  rules: ReadonlyArray<{ prefix: string; role: NetworkTopologyDeviceRole }>,
): NetworkTopologyDeviceRole | undefined {
  const oid: string = normalize(sysObjectId).replace(/^\.+/, "");
  if (!oid) {
    return undefined;
  }
  for (const rule of rules) {
    if (oid === rule.prefix || oid.startsWith(`${rule.prefix}.`)) {
      return rule.role;
    }
  }
  return undefined;
}

function roleForNameText(
  value: string | undefined,
): NetworkTopologyDeviceRole | undefined {
  const text: string = normalize(value);
  if (!text) {
    return undefined;
  }
  /*
   * Split on anything that is not a letter or a digit, which is how the
   * separators people actually use ("-", ".", "_", " ") all behave.
   */
  for (const token of text.split(/[^a-z0-9]+/)) {
    if (!token) {
      continue;
    }
    for (const rule of NAME_RULES) {
      if (rule.pattern.test(token)) {
        return rule.role;
      }
    }
  }
  return undefined;
}

/**
 * The role of one network device (managed) or discovery-protocol peer
 * (unmanaged).
 *
 * Total: always returns a role, "unknown" when nothing is conclusive.
 */
export function classifyDeviceRole(
  signals: DeviceRoleSignals,
): NetworkTopologyDeviceRole {
  const model: string = normalize(
    [signals.deviceModel, signals.platform].filter(Boolean).join(" "),
  );
  const sysDescr: string = normalize(signals.sysDescr);
  /*
   * Vendor guards read every identity field, not just `vendor` — the word
   * "Meraki" usually arrives inside sysDescr or the platform string, and
   * `vendor` itself is often empty on an unmanaged peer.
   */
  const vendorText: string = normalize(
    [signals.vendor, signals.deviceModel, signals.platform, signals.sysDescr]
      .filter(Boolean)
      .join(" "),
  );

  return (
    firstMatch(PRODUCT_RULES, model, vendorText) ??
    firstMatch(PRODUCT_RULES, sysDescr, vendorText) ??
    roleForSysObjectId(signals.sysObjectId, SYS_OBJECT_ID_RULES) ??
    firstMatch(GENERIC_RULES, sysDescr, vendorText) ??
    roleForNameText(signals.sysName) ??
    roleForNameText(signals.name) ??
    roleForSysObjectId(
      signals.sysObjectId,
      GENERIC_AGENT_SYS_OBJECT_ID_RULES,
    ) ??
    firstMatch(OPERATING_SYSTEM_RULES, sysDescr, vendorText) ??
    "unknown"
  );
}

/**
 * The role of a discovered (ARP/FDB) endpoint.
 *
 * An endpoint is a host until something says otherwise — that is what
 * being on the far side of an access port means — so this never returns
 * "unknown". The classification field is a human's own words about the
 * thing, so it is read first, then the OUI vendor, then the name.
 */
export function classifyEndpointRole(
  signals: EndpointRoleSignals,
): NetworkTopologyDeviceRole {
  const classification: string = normalize(signals.classification);
  const vendor: string = normalize(signals.vendor);
  const name: string = normalize(signals.name);

  return (
    firstMatch(ENDPOINT_RULES, classification, classification) ??
    firstMatch(ENDPOINT_RULES, vendor, vendor) ??
    firstMatch(ENDPOINT_RULES, name, name) ??
    "host"
  );
}

/** Display name for a role. Falls back to the "unknown" label. */
export function labelForDeviceRole(
  role: NetworkTopologyDeviceRole | undefined,
): string {
  if (!role) {
    return DEVICE_ROLE_LABELS.unknown;
  }
  return DEVICE_ROLE_LABELS[role] || DEVICE_ROLE_LABELS.unknown;
}

/**
 * Read an operator's stored role override off a NetworkDevice row.
 *
 * The classifier above is evidence-driven, and its evidence is SNMP: a
 * device nothing walks — a ping-only device imported by discovery, say —
 * offers it a hostname and nothing else, so it comes back "unknown" and
 * stays there forever. The role an operator ASSIGNED the device
 * (NetworkDevice.networkDeviceRole, whose key is what arrives here) is them saying
 * what the box actually is, and it is the only statement about a role that
 * is not an inference, so it outranks everything the classifier can find.
 *
 * Undefined means "no override" — NOT "unknown". The two are different
 * answers and the difference decides whether the classifier gets to run at
 * all, which is why an unrecognised or empty column reads as undefined
 * rather than falling back to a role. "unknown" is itself refused as an
 * override for the same reason: storing it would silently disable the
 * classifier on a device the operator was only declining to classify.
 */
export function parseDeviceRoleOverride(
  value: string | undefined | null,
): NetworkTopologyDeviceRole | undefined {
  const normalized: string = (value || "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return DEVICE_ROLES_IN_LEGEND_ORDER.find(
    (role: NetworkTopologyDeviceRole) => {
      return role.toLowerCase() === normalized;
    },
  );
}

/**
 * The role to draw a managed device with: the operator's override when
 * there is one, otherwise whatever the evidence supports.
 *
 * One function so the topology builder, the forms and the tests cannot
 * drift about which of the two wins.
 */
export function resolveDeviceRole(
  roleOverride: string | undefined | null,
  signals: DeviceRoleSignals,
): NetworkTopologyDeviceRole {
  return parseDeviceRoleOverride(roleOverride) ?? classifyDeviceRole(signals);
}
