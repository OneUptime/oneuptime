/*
 * What a network device's SNMP system description says about it (OneUptime
 * issue #4569).
 *
 * ENTITY-MIB is where a device publishes its hardware identity - its
 * manufacturer, model, serial number and firmware - and the poller reads it
 * on every walk. Plenty of devices do not implement it. A Cisco Meraki MX
 * answers SNMP with the system group and the interface tables and nothing
 * else, so its inventory record used to read "Meraki MX85" under the system
 * description and nothing at all under make or model. Its sysDescr, though,
 * NAMES the model, and the sysDescr of most network operating systems names
 * the operating system and the version it runs ("Cisco IOS Software, ...,
 * Version 15.2(4)E10", "Juniper Networks, Inc. ex2200-24t-4g Ethernet
 * Switch, kernel JUNOS 12.3R6.6").
 *
 * This reads those facts out of it, for the platforms whose sysDescr has a
 * fixed, documented shape. It is a fallback and nothing more:
 *
 *   - a value ENTITY-MIB reported always wins (NetworkDeviceAssetFacts);
 *   - a platform it does not recognise yields nothing - never a guess. A
 *     model or a version read off the wrong token is worse than an honest
 *     "Unknown", because a CMDB would believe it;
 *   - each platform is one rule, tried in order, and the first rule whose
 *     pattern matches answers for the whole description, so two rules can
 *     never mix their answers.
 *
 * Manufacturer names are spelled as the sysObjectID vendor table spells them
 * (SnmpVendorTemplate's ENTERPRISE_VENDOR_NAMES), so a device reads the same
 * whichever of the two named its maker.
 *
 * Pure and dependency-free: it runs in the inventory mirror on the server
 * and on the device's own page in the dashboard, and the tests drive it with
 * the descriptions real devices send.
 */

export interface SystemDescriptionFacts {
  manufacturer?: string | undefined;
  model?: string | undefined;
  // The operating system's name ("Cisco IOS", "Junos OS", "Linux").
  operatingSystem?: string | undefined;
  // The release of that operating system ("15.2(4)E10", "12.3R6.6").
  osVersion?: string | undefined;
  /*
   * The firmware, where the platform calls its release that (Ubiquiti), or
   * reports a boot ROM beside its software (HPE / Aruba switches).
   */
  firmwareVersion?: string | undefined;
}

/*
 * The poller keeps 500 characters of sysDescr. Anything longer than this was
 * not written by a poller, and is cut before any pattern reads it - every
 * pattern below has bounded quantifiers, and this bounds the text they scan.
 */
export const MAX_SYSTEM_DESCRIPTION_LENGTH: number = 1024;

// The longest value any single fact may be; a longer token is not a fact.
const MAX_FACT_LENGTH: number = 80;

const CARRIAGE_RETURNS: RegExp = /\r/g;
const TRAILING_SWITCH_WORD: RegExp = /\s+Switch$/;
const TRAILING_PUNCTUATION: RegExp = /[.,;:]+$/;

// --- Cisco Meraki ------------------------------------------------------------

// "Meraki MX85", "Meraki MS220-8P Cloud Managed Switch", "Meraki MR42 Cloud Managed AP".
const MERAKI: RegExp =
  /^(?:Cisco\s{1,4})?Meraki\s{1,4}([A-Za-z]{1,4}\d{1,4}[A-Za-z0-9+-]{0,24})/;

// --- Cisco --------------------------------------------------------------------

// "Cisco Adaptive Security Appliance Version 9.8(4)32"
const CISCO_ASA: RegExp =
  /Cisco Adaptive Security Appliance Version\s{1,4}([^\s,]{1,40})/;

// "Cisco Firepower Threat Defense, Version 6.6.1 (Build 91), ASA Version 9.14(1)150"
const CISCO_FTD: RegExp =
  /Cisco Firepower Threat Defense,?\s{1,4}Version\s{1,4}([^\s,]{1,40})/;

// "Cisco NX-OS(tm) n9000, Software (n9000-dk9), Version 9.3(5), RELEASE SOFTWARE"
const CISCO_NX_OS: RegExp = /\bNX-OS\b/;

// "Cisco IOS XR Software (Cisco ASR9K Series),  Version 6.1.4[Default]"
const CISCO_IOS_XR: RegExp = /\bIOS XR\b/;

/*
 * IOS XE says so ("IOS-XE Software", "Cisco IOS XE Software"), except from
 * 16.x on, where it names its release train in brackets instead:
 * "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software ...".
 */
const CISCO_IOS_XE: RegExp = /\bIOS[- ]XE\b|^Cisco IOS Software \[[A-Za-z]{2,20}\]/;

// "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11, ..."
const CISCO_IOS: RegExp =
  /\bCisco IOS Software\b|\bCisco Internetwork Operating System\b|\bIOS \(tm\)/;

/*
 * The release after "Version". It runs to the next space or comma; IOS XR
 * also appends its package set in brackets ("6.1.4[Default]"), which is not
 * part of the release.
 */
const CISCO_VERSION: RegExp = /\bVersion\s{1,4}(\d[^\s,[\]]{0,39})/;

// --- Juniper -----------------------------------------------------------------

// "Juniper Networks, Inc. ex2200-24t-4g Ethernet Switch, kernel JUNOS 12.3R6.6, ..."
const JUNIPER: RegExp =
  /^Juniper Networks,?\s{1,4}Inc\.\s{1,4}([A-Za-z0-9][\w+-]{0,39})/;
const JUNOS_VERSION: RegExp = /\bJUNOS\s{1,4}(\d[^\s,]{0,39})/i;

// --- Arista ------------------------------------------------------------------

// "Arista Networks EOS version 4.20.1F running on an Arista Networks DCS-7050SX-64"
const ARISTA: RegExp =
  /Arista Networks EOS version\s{1,4}([^\s,]{1,40})(?:\s{1,4}running on an?\s{1,4}Arista Networks\s{1,4}([A-Za-z0-9][\w+-]{0,39}))?/;

// --- MikroTik ----------------------------------------------------------------

// "RouterOS CCR1036-12G-4S", "RouterOS RB4011iGS+"
const MIKROTIK: RegExp = /^RouterOS\s{1,4}([A-Za-z0-9][\w+-]{0,39})/;

// --- HPE / Aruba switches (ProVision, ArubaOS-Switch) ------------------------

/*
 * "HP J9774A 2530-8G-PoEP Switch, revision YA.16.02.0012, ROM YA.15.20 (...)"
 * "Aruba JL258A 2930F-8G-PoE+-2SFP+ Switch, revision WC.16.10.0012, ROM ..."
 * "ProCurve J9086A Switch 2610-24/12PWR, revision R.11.72, ROM R.10.06 (...)"
 */
const HPE_SWITCH: RegExp =
  /^(HPE?|Hewlett[- ]Packard(?: Enterprise)?|Aruba|ProCurve)\s{1,4}([^,]{1,80}?),\s{0,4}revision\s{1,4}([^\s,]{1,40})(?:,\s{0,4}ROM\s{1,4}([^\s,(]{1,40}))?/;

// --- Huawei ------------------------------------------------------------------

// "Huawei Versatile Routing Platform Software VRP (R) software,Version 5.170 (S5720 V200R011C10SPC500) ..."
const HUAWEI_VRP: RegExp = /Huawei Versatile Routing Platform/i;
const HUAWEI_VERSION: RegExp =
  /\bVersion\s{1,4}(\d[\w.]{0,20})(?:\s{1,4}\(([^)]{1,60})\))?/;
// A line of its own naming the chassis: "HUAWEI CE6810-48S4Q-EI".
const HUAWEI_MODEL_LINE: RegExp = /^HUAWEI\s{1,4}([A-Za-z0-9][\w+-]{1,40})[ \t]*$/m;
// Or the description's first line is the model itself: "S5720-28X-PWR-SI-AC".
const HUAWEI_MODEL_FIRST_LINE: RegExp = /^([A-Za-z]{1,6}\d[\w+-]{1,40})[ \t]*(?:\n|$)/;

// --- Palo Alto Networks ------------------------------------------------------

// "Palo Alto Networks PA-220 series firewall", "Palo Alto Networks VM-Series firewall"
const PALO_ALTO: RegExp = /^Palo Alto Networks\s{1,4}([A-Za-z0-9][\w+-]{0,39})/;

// --- F5 ----------------------------------------------------------------------

// "BIG-IP 10350v : Linux 3.10.0-862.14.4.el7.ve.x86_64 : BIG-IP software release 15.1.0.4, build 0.0.6"
const F5_BIG_IP: RegExp = /^BIG-IP\s{1,4}([\w-]{1,40})\s{0,4}:/;
const F5_VERSION: RegExp = /BIG-IP software release\s{1,4}([^\s,]{1,40})/;

// --- Extreme Networks --------------------------------------------------------

// "ExtremeXOS (X440G2-48p-10G4) version 22.6.1.4 22.6.1.4 by release-manager on ..."
const EXTREME_XOS: RegExp =
  /ExtremeXOS(?:\s{0,4}\(([^)]{1,40})\))?\s{1,4}version\s{1,4}([^\s,]{1,40})/i;

// --- Dell OS10 ---------------------------------------------------------------

// "Dell EMC Networking OS10 Enterprise. ... OS Version: 10.5.1.3. System Type: S4148F-ON"
const DELL_OS10: RegExp = /\bDell\b[^\n]{0,60}\bOS10\b/i;
const DELL_OS10_VERSION: RegExp = /OS Version:\s{0,4}(\d[\w.-]{0,39})/;
const DELL_OS10_MODEL: RegExp = /System Type:\s{0,4}([A-Za-z0-9][\w+-]{0,39})/;

// --- Ubiquiti ----------------------------------------------------------------

// "EdgeSwitch 24-Port Lite, 1.9.3.5089037, Linux 3.6.5-f4a26ed5, 0.0.00.0000"
// "USW-24-PoE, 6.5.59.14773, Linux 3.6.5"
const UBIQUITI_SWITCH: RegExp =
  /^((?:EdgeSwitch|USW|US)\b[^,]{0,60}),\s{0,4}(\d[\d.]{1,30}),\s{0,4}Linux\b/;

/*
 * A UniFi access point or gateway: its model and its firmware and nothing
 * else ("U6+ 6.6.62", "U7-Pro 7.0.66", "UAP-AC-Pro-Gen2 6.5.62.14789").
 * Anchored at both ends and held to UniFi's model prefixes, so "Ubuntu
 * 22.04.3" is not read as a model called Ubuntu.
 */
const UNIFI_DEVICE: RegExp =
  /^((?:UAP|U6|U7|UK|UAL|UBB|UDM|UXG|UCG|UDR|E7)[\w+-]{0,30})\s{1,4}(\d{1,3}\.\d{1,3}\.\d{1,5}(?:\.\d{1,8})?)$/;

// "EdgeOS v2.0.9-hotfix.6.5574651.221230.1015"
const EDGE_OS: RegExp = /^EdgeOS\s{1,4}v?(\d[^\s]{0,60})/;

// --- General-purpose operating systems ---------------------------------------

// "VMware ESXi 7.0.3 build-21424296 VMware, Inc. x86_64"
const VMWARE_ESXI: RegExp =
  /^VMware ESXi\s{1,4}(\d[\d.]{0,20})(?:\s{1,4}build-(\d{1,12}))?/;

// "pfSense fw.example.com 2.6.0-RELEASE FreeBSD 12.3-STABLE amd64"
const PFSENSE: RegExp = /^pfSense\s{1,4}\S{1,253}\s{1,4}(\d[^\s]{0,40})/;

// "OPNsense opnsense.localdomain 23.1 FreeBSD 13.1-RELEASE-p6 amd64"
const OPNSENSE: RegExp = /^OPNsense\s{1,4}\S{1,253}\s{1,4}(\d[^\s]{0,40})/;

// "FreeBSD host 13.2-RELEASE FreeBSD 13.2-RELEASE releng/13.2-n254617 GENERIC amd64"
const FREEBSD: RegExp = /^FreeBSD\s{1,4}\S{1,253}\s{1,4}(\d[^\s]{0,40})/;

/*
 * "Hardware: Intel64 Family 6 Model 85 Stepping 7 AT/AT COMPATIBLE -
 * Software: Windows Version 6.3 (Build 17763 Multiprocessor Free)". The
 * Windows SNMP service has reported 6.3 for every release since 8.1; the
 * build number is what tells them apart, so it is kept. Older releases name
 * themselves first ("Software: Windows 2000 Version 5.0 (Build 2195 ...)").
 */
const WINDOWS: RegExp =
  /Software:\s{0,4}Windows(?:\s{1,4}(?:\d{4}|NT|XP|Server|Vista)){0,2}(?:\s{1,4}Version\s{1,4}([\d.]{1,20}))?(?:\s{0,4}\(Build\s{1,4}(\d{1,10}))?/;

// "Linux fw01 5.10.0-21-amd64 #1 SMP Debian 5.10.162-1 (2023-01-21) x86_64"
const LINUX_WITH_HOST: RegExp = /^Linux\s{1,4}\S{1,253}\s{1,4}(\d[^\s]{0,60})/;

// "Linux 4.4.153 #1 SMP PREEMPT ..." - no host name in between.
const LINUX_BARE: RegExp = /^Linux\s{1,4}(\d[^\s]{0,60})/;

/*
 * One platform: the pattern that recognises it, and what it reads. `read`
 * runs only when `recognise` matched, gets the same normalised text, and
 * returns every fact it can find - possibly none beyond the platform's name.
 */
interface SystemDescriptionRule {
  recognise: RegExp;
  read: (text: string, match: RegExpExecArray) => SystemDescriptionFacts;
}

/*
 * A captured token as a fact: trimmed, without trailing punctuation a
 * sentence put after it, and undefined when empty or implausibly long.
 */
function fact(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const text: string = value.trim().replace(TRAILING_PUNCTUATION, "");

  if (!text || text.length > MAX_FACT_LENGTH) {
    return undefined;
  }

  return text;
}

function firstGroup(pattern: RegExp, text: string): string | undefined {
  const match: RegExpExecArray | null = pattern.exec(text);
  return match ? fact(match[1]) : undefined;
}

function ciscoRule(
  recognise: RegExp,
  operatingSystem: string,
  version: RegExp = CISCO_VERSION,
): SystemDescriptionRule {
  return {
    recognise: recognise,
    read: (text: string): SystemDescriptionFacts => {
      return {
        manufacturer: "Cisco",
        operatingSystem: operatingSystem,
        osVersion: firstGroup(version, text),
      };
    },
  };
}

/*
 * Most specific first. The Cisco rules are ordered so that a description
 * naming two of them is read as the more specific one: an FTD names its ASA
 * engine, and IOS XE descriptions say "Cisco IOS Software".
 */
const RULES: ReadonlyArray<SystemDescriptionRule> = [
  {
    recognise: MERAKI,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return { manufacturer: "Cisco Meraki", model: fact(match[1]) };
    },
  },
  ciscoRule(CISCO_FTD, "Cisco Firepower Threat Defense", CISCO_FTD),
  ciscoRule(CISCO_ASA, "Cisco ASA", CISCO_ASA),
  ciscoRule(CISCO_NX_OS, "Cisco NX-OS"),
  ciscoRule(CISCO_IOS_XR, "Cisco IOS XR"),
  ciscoRule(CISCO_IOS_XE, "Cisco IOS XE"),
  ciscoRule(CISCO_IOS, "Cisco IOS"),
  {
    recognise: JUNIPER,
    read: (text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "Juniper",
        model: fact(match[1]),
        operatingSystem: "Junos OS",
        osVersion: firstGroup(JUNOS_VERSION, text),
      };
    },
  },
  {
    recognise: ARISTA,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "Arista",
        model: fact(match[2]),
        operatingSystem: "Arista EOS",
        osVersion: fact(match[1]),
      };
    },
  },
  {
    recognise: MIKROTIK,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "MikroTik",
        model: fact(match[1]),
        operatingSystem: "RouterOS",
      };
    },
  },
  {
    recognise: HPE_SWITCH,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      const brand: string = match[1] || "";
      return {
        manufacturer: brand === "Aruba" ? "Aruba" : "HPE",
        model: fact((match[2] || "").replace(TRAILING_SWITCH_WORD, "")),
        operatingSystem: "ArubaOS-Switch",
        osVersion: fact(match[3]),
        firmwareVersion: fact(match[4]),
      };
    },
  },
  {
    recognise: HUAWEI_VRP,
    read: (text: string): SystemDescriptionFacts => {
      const version: RegExpExecArray | null = HUAWEI_VERSION.exec(text);
      const release: string | undefined = version ? fact(version[1]) : undefined;
      const build: string | undefined = version ? fact(version[2]) : undefined;

      const modelLine: RegExpExecArray | null = HUAWEI_MODEL_LINE.exec(text);
      const firstLine: RegExpExecArray | null =
        HUAWEI_MODEL_FIRST_LINE.exec(text);

      return {
        manufacturer: "Huawei",
        model: modelLine ? fact(modelLine[1]) : firstLine ? fact(firstLine[1]) : undefined,
        operatingSystem: "Huawei VRP",
        osVersion: release && build ? `${release} (${build})` : release,
      };
    },
  },
  {
    recognise: PALO_ALTO,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "Palo Alto Networks",
        model: fact(match[1]),
        operatingSystem: "PAN-OS",
      };
    },
  },
  {
    recognise: F5_BIG_IP,
    read: (text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      const model: string | undefined = fact(match[1]);
      return {
        manufacturer: "F5",
        model: model ? `BIG-IP ${model}` : undefined,
        operatingSystem: "BIG-IP",
        osVersion: firstGroup(F5_VERSION, text),
      };
    },
  },
  {
    recognise: EXTREME_XOS,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "Extreme Networks",
        model: fact(match[1]),
        operatingSystem: "ExtremeXOS",
        osVersion: fact(match[2]),
      };
    },
  },
  {
    recognise: DELL_OS10,
    read: (text: string): SystemDescriptionFacts => {
      return {
        manufacturer: "Dell",
        model: firstGroup(DELL_OS10_MODEL, text),
        operatingSystem: "Dell OS10",
        osVersion: firstGroup(DELL_OS10_VERSION, text),
      };
    },
  },
  {
    recognise: UBIQUITI_SWITCH,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "Ubiquiti",
        model: fact(match[1]),
        firmwareVersion: fact(match[2]),
      };
    },
  },
  {
    recognise: UNIFI_DEVICE,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "Ubiquiti",
        model: fact(match[1]),
        firmwareVersion: fact(match[2]),
      };
    },
  },
  {
    recognise: EDGE_OS,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return {
        manufacturer: "Ubiquiti",
        operatingSystem: "EdgeOS",
        osVersion: fact(match[1]),
      };
    },
  },
  {
    recognise: VMWARE_ESXI,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      const release: string | undefined = fact(match[1]);
      const build: string | undefined = fact(match[2]);
      return {
        operatingSystem: "VMware ESXi",
        osVersion: release && build ? `${release} (build ${build})` : release,
      };
    },
  },
  {
    recognise: PFSENSE,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return { operatingSystem: "pfSense", osVersion: fact(match[1]) };
    },
  },
  {
    recognise: OPNSENSE,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return { operatingSystem: "OPNsense", osVersion: fact(match[1]) };
    },
  },
  {
    recognise: FREEBSD,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return { operatingSystem: "FreeBSD", osVersion: fact(match[1]) };
    },
  },
  {
    recognise: WINDOWS,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      const release: string | undefined = fact(match[1]);
      const build: string | undefined = fact(match[2]);
      let osVersion: string | undefined = release;

      if (release && build) {
        osVersion = `${release} (Build ${build})`;
      } else if (build) {
        osVersion = `Build ${build}`;
      }

      return { operatingSystem: "Windows", osVersion: osVersion };
    },
  },
  {
    recognise: LINUX_WITH_HOST,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return { operatingSystem: "Linux", osVersion: fact(match[1]) };
    },
  },
  {
    recognise: LINUX_BARE,
    read: (_text: string, match: RegExpExecArray): SystemDescriptionFacts => {
      return { operatingSystem: "Linux", osVersion: fact(match[1]) };
    },
  },
];

/**
 * The text a rule reads: a string, cut to MAX_SYSTEM_DESCRIPTION_LENGTH,
 * without carriage returns (Cisco ends every line with CRLF) and trimmed.
 * Empty for anything that is not a string.
 */
export function readSystemDescription(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const cut: string =
    value.length > MAX_SYSTEM_DESCRIPTION_LENGTH
      ? value.substring(0, MAX_SYSTEM_DESCRIPTION_LENGTH)
      : value;

  return cut.replace(CARRIAGE_RETURNS, "").trim();
}

/**
 * The facts a device's sysDescr states, for the platforms whose sysDescr has
 * a known shape. An object with no keys set for anything else - including a
 * value that is not a string. Never throws.
 */
export function parseSystemDescription(value: unknown): SystemDescriptionFacts {
  const text: string = readSystemDescription(value);

  if (!text) {
    return {};
  }

  for (const rule of RULES) {
    const match: RegExpExecArray | null = rule.recognise.exec(text);

    if (!match) {
      continue;
    }

    const facts: SystemDescriptionFacts = rule.read(text, match);
    const out: SystemDescriptionFacts = {};

    // Only the facts the rule found; an absent fact is no key at all.
    for (const key of Object.keys(facts) as Array<
      keyof SystemDescriptionFacts
    >) {
      const factValue: string | undefined = facts[key];

      if (factValue) {
        out[key] = factValue;
      }
    }

    return out;
  }

  return {};
}

export default parseSystemDescription;
