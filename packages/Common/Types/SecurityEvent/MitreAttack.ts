/*
 * MITRE ATT&CK for Enterprise — the tactics and parent techniques of the
 * current matrix, which the Security product draws its coverage view from
 * and reads every rule's `attack.*` tags against.
 *
 * Version 20. Since v19 there is no Defense Evasion: its TA0005 id now
 * belongs to Stealth (hiding), and TA0112 Defense Impairment holds what
 * breaks defenses (turning off tools and firewalls). The technique lists are
 * copied tactic by tactic from attack.mitre.org/tactics/<id>, so a technique
 * that serves several tactics is listed under each, the way the matrix shows
 * it. Sub-techniques (T1110.003) are not listed: they roll up to their
 * parent, which is what a coverage cell counts.
 */

export const MITRE_ATTACK_VERSION: string = "20";

export interface MitreTactic {
  id: string;
  name: string;
  // The adversary's goal, in one line, as the matrix's column header puts it.
  goal: string;
}

export interface MitreTechnique {
  id: string;
  name: string;
  // Every tactic the technique serves, in matrix order.
  tacticIds: Array<string>;
}

// Matrix order, left to right.
export const MITRE_TACTICS: ReadonlyArray<MitreTactic> = [
  {
    id: "TA0043",
    name: "Reconnaissance",
    goal: "Gather information to plan future operations.",
  },
  {
    id: "TA0042",
    name: "Resource Development",
    goal: "Establish resources to support operations.",
  },
  {
    id: "TA0001",
    name: "Initial Access",
    goal: "Get into your network.",
  },
  {
    id: "TA0002",
    name: "Execution",
    goal: "Run malicious code.",
  },
  {
    id: "TA0003",
    name: "Persistence",
    goal: "Keep a foothold.",
  },
  {
    id: "TA0004",
    name: "Privilege Escalation",
    goal: "Gain higher-level permissions.",
  },
  {
    id: "TA0005",
    name: "Stealth",
    goal: "Hide activity and blend in with normal operations.",
  },
  {
    id: "TA0112",
    name: "Defense Impairment",
    goal: "Disable or weaken security controls and monitoring.",
  },
  {
    id: "TA0006",
    name: "Credential Access",
    goal: "Steal account names and passwords.",
  },
  {
    id: "TA0007",
    name: "Discovery",
    goal: "Figure out your environment.",
  },
  {
    id: "TA0008",
    name: "Lateral Movement",
    goal: "Move through your environment.",
  },
  {
    id: "TA0009",
    name: "Collection",
    goal: "Gather data of interest.",
  },
  {
    id: "TA0011",
    name: "Command and Control",
    goal: "Communicate with compromised systems to control them.",
  },
  {
    id: "TA0010",
    name: "Exfiltration",
    goal: "Steal data.",
  },
  {
    id: "TA0040",
    name: "Impact",
    goal: "Manipulate, interrupt or destroy systems and data.",
  },
];

/*
 * [technique id, name] per tactic, in the order each tactic's page lists
 * them (alphabetical by name).
 */
export const MITRE_TACTIC_TECHNIQUES: Readonly<
  Record<string, ReadonlyArray<readonly [string, string]>>
> = {
  TA0043: [
    ["T1595", "Active Scanning"],
    ["T1592", "Gather Victim Host Information"],
    ["T1589", "Gather Victim Identity Information"],
    ["T1590", "Gather Victim Network Information"],
    ["T1591", "Gather Victim Org Information"],
    ["T1598", "Phishing for Information"],
    ["T1682", "Query Public AI Services"],
    ["T1597", "Search Closed Sources"],
    ["T1596", "Search Open Technical Databases"],
    ["T1593", "Search Open Websites/Domains"],
    ["T1681", "Search Threat Vendor Data"],
    ["T1594", "Search Victim-Owned Websites"],
  ],
  TA0042: [
    ["T1650", "Acquire Access"],
    ["T1583", "Acquire Infrastructure"],
    ["T1586", "Compromise Accounts"],
    ["T1584", "Compromise Infrastructure"],
    ["T1587", "Develop Capabilities"],
    ["T1585", "Establish Accounts"],
    ["T1683", "Generate Content"],
    ["T1588", "Obtain Capabilities"],
    ["T1608", "Stage Capabilities"],
  ],
  TA0001: [
    ["T1659", "Content Injection"],
    ["T1189", "Drive-by Compromise"],
    ["T1190", "Exploit Public-Facing Application"],
    ["T1133", "External Remote Services"],
    ["T1200", "Hardware Additions"],
    ["T1566", "Phishing"],
    ["T1091", "Replication Through Removable Media"],
    ["T1195", "Supply Chain Compromise"],
    ["T1199", "Trusted Relationship"],
    ["T1078", "Valid Accounts"],
    ["T1669", "Wi-Fi Networks"],
  ],
  TA0002: [
    ["T1197", "BITS Jobs"],
    ["T1651", "Cloud Administration Command"],
    ["T1059", "Command and Scripting Interpreter"],
    ["T1609", "Container Administration Command"],
    ["T1610", "Deploy Container"],
    ["T1699", "Direct Prompt Injection"],
    ["T1675", "ESXi Administration Command"],
    ["T1203", "Exploitation for Client Execution"],
    ["T1574", "Hijack Execution Flow"],
    ["T1698", "Indirect Prompt Injection"],
    ["T1674", "Input Injection"],
    ["T1559", "Inter-Process Communication"],
    ["T1106", "Native API"],
    ["T1677", "Poisoned Pipeline Execution"],
    ["T1053", "Scheduled Task/Job"],
    ["T1648", "Serverless Execution"],
    ["T1129", "Shared Modules"],
    ["T1072", "Software Deployment Tools"],
    ["T1569", "System Services"],
    ["T1127", "Trusted Developer Utilities Proxy Execution"],
    ["T1204", "User Execution"],
    ["T1047", "Windows Management Instrumentation"],
  ],
  TA0003: [
    ["T1098", "Account Manipulation"],
    ["T1197", "BITS Jobs"],
    ["T1547", "Boot or Logon Autostart Execution"],
    ["T1037", "Boot or Logon Initialization Scripts"],
    ["T1671", "Cloud Application Integration"],
    ["T1554", "Compromise Host Software Binary"],
    ["T1136", "Create Account"],
    ["T1543", "Create or Modify System Process"],
    ["T1546", "Event Triggered Execution"],
    ["T1668", "Exclusive Control"],
    ["T1133", "External Remote Services"],
    ["T1525", "Implant Internal Image"],
    ["T1556", "Modify Authentication Process"],
    ["T1112", "Modify Registry"],
    ["T1137", "Office Application Startup"],
    ["T1653", "Power Settings"],
    ["T1542", "Pre-OS Boot"],
    ["T1053", "Scheduled Task/Job"],
    ["T1505", "Server Software Component"],
    ["T1176", "Software Extensions"],
    ["T1205", "Traffic Signaling"],
    ["T1078", "Valid Accounts"],
  ],
  TA0004: [
    ["T1548", "Abuse Elevation Control Mechanism"],
    ["T1134", "Access Token Manipulation"],
    ["T1098", "Account Manipulation"],
    ["T1547", "Boot or Logon Autostart Execution"],
    ["T1037", "Boot or Logon Initialization Scripts"],
    ["T1543", "Create or Modify System Process"],
    ["T1484", "Domain or Tenant Policy Modification"],
    ["T1611", "Escape to Host"],
    ["T1546", "Event Triggered Execution"],
    ["T1068", "Exploitation for Privilege Escalation"],
    ["T1055", "Process Injection"],
    ["T1053", "Scheduled Task/Job"],
    ["T1078", "Valid Accounts"],
  ],
  TA0005: [
    ["T1134", "Access Token Manipulation"],
    ["T1696", "Anti-Automation Evasion"],
    ["T1197", "BITS Jobs"],
    ["T1612", "Build Image on Host"],
    ["T1622", "Debugger Evasion"],
    ["T1678", "Delay Execution"],
    ["T1140", "Deobfuscate/Decode Files or Information"],
    ["T1006", "Direct Volume Access"],
    ["T1480", "Execution Guardrails"],
    ["T1211", "Exploitation for Stealth"],
    ["T1564", "Hide Artifacts"],
    ["T1574", "Hijack Execution Flow"],
    ["T1070", "Indicator Removal"],
    ["T1202", "Indirect Command Execution"],
    ["T1036", "Masquerading"],
    ["T1027", "Obfuscated Files or Information"],
    ["T1542", "Pre-OS Boot"],
    ["T1055", "Process Injection"],
    ["T1620", "Reflective Code Loading"],
    ["T1014", "Rootkit"],
    ["T1679", "Selective Exclusion"],
    ["T1684", "Social Engineering"],
    ["T1218", "System Binary Proxy Execution"],
    ["T1216", "System Script Proxy Execution"],
    ["T1221", "Template Injection"],
    ["T1205", "Traffic Signaling"],
    ["T1127", "Trusted Developer Utilities Proxy Execution"],
    ["T1535", "Unused/Unsupported Cloud Regions"],
    ["T1078", "Valid Accounts"],
    ["T1497", "Virtualization/Sandbox Evasion"],
    ["T1220", "XSL Script Processing"],
  ],
  TA0112: [
    ["T1686", "Disable or Modify System Firewall"],
    ["T1685", "Disable or Modify Tools"],
    ["T1484", "Domain or Tenant Policy Modification"],
    ["T1689", "Downgrade Attack"],
    ["T1687", "Exploitation for Defense Impairment"],
    ["T1222", "File and Directory Permissions Modification"],
    ["T1556", "Modify Authentication Process"],
    ["T1578", "Modify Cloud Compute Infrastructure"],
    ["T1666", "Modify Cloud Resource Hierarchy"],
    ["T1112", "Modify Registry"],
    ["T1601", "Modify System Image"],
    ["T1599", "Network Boundary Bridging"],
    ["T1647", "Plist File Modification"],
    ["T1690", "Prevent Command History Logging"],
    ["T1207", "Rogue Domain Controller"],
    ["T1688", "Safe Mode Boot"],
    ["T1553", "Subvert Trust Controls"],
    ["T1600", "Weaken Encryption"],
  ],
  TA0006: [
    ["T1557", "Adversary-in-the-Middle"],
    ["T1110", "Brute Force"],
    ["T1555", "Credentials from Password Stores"],
    ["T1212", "Exploitation for Credential Access"],
    ["T1187", "Forced Authentication"],
    ["T1606", "Forge Web Credentials"],
    ["T1056", "Input Capture"],
    ["T1556", "Modify Authentication Process"],
    ["T1111", "Multi-Factor Authentication Interception"],
    ["T1621", "Multi-Factor Authentication Request Generation"],
    ["T1040", "Network Sniffing"],
    ["T1003", "OS Credential Dumping"],
    ["T1528", "Steal Application Access Token"],
    ["T1697", "Steal Application Specific Passwords"],
    ["T1649", "Steal or Forge Authentication Certificates"],
    ["T1558", "Steal or Forge Kerberos Tickets"],
    ["T1539", "Steal Web Session Cookie"],
    ["T1552", "Unsecured Credentials"],
  ],
  TA0007: [
    ["T1087", "Account Discovery"],
    ["T1010", "Application Window Discovery"],
    ["T1217", "Browser Information Discovery"],
    ["T1580", "Cloud Infrastructure Discovery"],
    ["T1538", "Cloud Service Dashboard"],
    ["T1526", "Cloud Service Discovery"],
    ["T1619", "Cloud Storage Object Discovery"],
    ["T1613", "Container and Resource Discovery"],
    ["T1622", "Debugger Evasion"],
    ["T1652", "Device Driver Discovery"],
    ["T1482", "Domain Trust Discovery"],
    ["T1083", "File and Directory Discovery"],
    ["T1615", "Group Policy Discovery"],
    ["T1680", "Local Storage Discovery"],
    ["T1654", "Log Enumeration"],
    ["T1046", "Network Service Discovery"],
    ["T1135", "Network Share Discovery"],
    ["T1040", "Network Sniffing"],
    ["T1201", "Password Policy Discovery"],
    ["T1120", "Peripheral Device Discovery"],
    ["T1069", "Permission Groups Discovery"],
    ["T1057", "Process Discovery"],
    ["T1012", "Query Registry"],
    ["T1018", "Remote System Discovery"],
    ["T1518", "Software Discovery"],
    ["T1082", "System Information Discovery"],
    ["T1614", "System Location Discovery"],
    ["T1016", "System Network Configuration Discovery"],
    ["T1049", "System Network Connections Discovery"],
    ["T1033", "System Owner/User Discovery"],
    ["T1007", "System Service Discovery"],
    ["T1124", "System Time Discovery"],
    ["T1673", "Virtual Machine Discovery"],
    ["T1497", "Virtualization/Sandbox Evasion"],
  ],
  TA0008: [
    ["T1210", "Exploitation of Remote Services"],
    ["T1534", "Internal Spearphishing"],
    ["T1570", "Lateral Tool Transfer"],
    ["T1563", "Remote Service Session Hijacking"],
    ["T1021", "Remote Services"],
    ["T1091", "Replication Through Removable Media"],
    ["T1072", "Software Deployment Tools"],
    ["T1080", "Taint Shared Content"],
    ["T1550", "Use Alternate Authentication Material"],
  ],
  TA0009: [
    ["T1557", "Adversary-in-the-Middle"],
    ["T1560", "Archive Collected Data"],
    ["T1123", "Audio Capture"],
    ["T1119", "Automated Collection"],
    ["T1185", "Browser Session Hijacking"],
    ["T1115", "Clipboard Data"],
    ["T1530", "Data from Cloud Storage"],
    ["T1602", "Data from Configuration Repository"],
    ["T1213", "Data from Information Repositories"],
    ["T1005", "Data from Local System"],
    ["T1039", "Data from Network Shared Drive"],
    ["T1025", "Data from Removable Media"],
    ["T1074", "Data Staged"],
    ["T1114", "Email Collection"],
    ["T1056", "Input Capture"],
    ["T1113", "Screen Capture"],
    ["T1125", "Video Capture"],
  ],
  TA0011: [
    ["T1071", "Application Layer Protocol"],
    ["T1092", "Communication Through Removable Media"],
    ["T1659", "Content Injection"],
    ["T1132", "Data Encoding"],
    ["T1001", "Data Obfuscation"],
    ["T1568", "Dynamic Resolution"],
    ["T1573", "Encrypted Channel"],
    ["T1008", "Fallback Channels"],
    ["T1665", "Hide Infrastructure"],
    ["T1105", "Ingress Tool Transfer"],
    ["T1104", "Multi-Stage Channels"],
    ["T1095", "Non-Application Layer Protocol"],
    ["T1571", "Non-Standard Port"],
    ["T1572", "Protocol Tunneling"],
    ["T1090", "Proxy"],
    ["T1219", "Remote Access Tools"],
    ["T1205", "Traffic Signaling"],
    ["T1102", "Web Service"],
  ],
  TA0010: [
    ["T1700", "AI-Enabled Exfiltration"],
    ["T1020", "Automated Exfiltration"],
    ["T1030", "Data Transfer Size Limits"],
    ["T1048", "Exfiltration Over Alternative Protocol"],
    ["T1041", "Exfiltration Over C2 Channel"],
    ["T1011", "Exfiltration Over Other Network Medium"],
    ["T1052", "Exfiltration Over Physical Medium"],
    ["T1567", "Exfiltration Over Web Service"],
    ["T1029", "Scheduled Transfer"],
    ["T1537", "Transfer Data to Cloud Account"],
  ],
  TA0040: [
    ["T1531", "Account Access Removal"],
    ["T1485", "Data Destruction"],
    ["T1486", "Data Encrypted for Impact"],
    ["T1565", "Data Manipulation"],
    ["T1491", "Defacement"],
    ["T1561", "Disk Wipe"],
    ["T1667", "Email Bombing"],
    ["T1499", "Endpoint Denial of Service"],
    ["T1657", "Financial Theft"],
    ["T1495", "Firmware Corruption"],
    ["T1490", "Inhibit System Recovery"],
    ["T1498", "Network Denial of Service"],
    ["T1496", "Resource Hijacking"],
    ["T1489", "Service Stop"],
    ["T1529", "System Shutdown/Reboot"],
  ],
};

/*
 * Every parent technique once, with all the tactics it serves. Built from
 * the per-tactic lists so a technique's name and tactics can never disagree
 * with the column it is drawn in.
 */
export const MITRE_TECHNIQUES: ReadonlyArray<MitreTechnique> =
  ((): Array<MitreTechnique> => {
    const byId: Map<string, MitreTechnique> = new Map();

    for (const tactic of MITRE_TACTICS) {
      for (const [id, name] of MITRE_TACTIC_TECHNIQUES[tactic.id] || []) {
        const existing: MitreTechnique | undefined = byId.get(id);

        if (existing) {
          existing.tacticIds.push(tactic.id);
          continue;
        }

        byId.set(id, { id, name, tacticIds: [tactic.id] });
      }
    }

    return Array.from(byId.values()).sort(
      (a: MitreTechnique, b: MitreTechnique): number => {
        return a.id.localeCompare(b.id);
      },
    );
  })();

const TACTICS_BY_ID: Map<string, MitreTactic> = new Map(
  MITRE_TACTICS.map((tactic: MitreTactic): [string, MitreTactic] => {
    return [tactic.id, tactic];
  }),
);

const TECHNIQUES_BY_ID: Map<string, MitreTechnique> = new Map(
  MITRE_TECHNIQUES.map(
    (technique: MitreTechnique): [string, MitreTechnique] => {
      return [technique.id, technique];
    },
  ),
);

/*
 * Sigma rules name tactics by their ATT&CK short name far more often than by
 * id (`attack.credential_access`, not `attack.ta0006`). Rules written before
 * v19 say `defense_evasion`, whose id TA0005 now belongs to Stealth.
 */
export const MITRE_TACTIC_SHORT_NAMES: Readonly<Record<string, string>> = {
  reconnaissance: "TA0043",
  resource_development: "TA0042",
  initial_access: "TA0001",
  execution: "TA0002",
  persistence: "TA0003",
  privilege_escalation: "TA0004",
  stealth: "TA0005",
  defense_evasion: "TA0005",
  defense_impairment: "TA0112",
  credential_access: "TA0006",
  discovery: "TA0007",
  lateral_movement: "TA0008",
  collection: "TA0009",
  command_and_control: "TA0011",
  exfiltration: "TA0010",
  impact: "TA0040",
};

/*
 * Impair Defenses (T1562), which v19 revoked when it split Defense Evasion.
 * The parent and its tool sub-techniques became Disable or Modify Tools
 * (T1685), and the sub-techniques that became techniques of their own map
 * onto them by name. A rule tagged with an old id still counts toward the
 * technique that replaced it, and an old sub-technique missing here falls
 * back to the parent's replacement.
 */
export const MITRE_REVOKED_TECHNIQUES: Readonly<Record<string, string>> = {
  T1562: "T1685",
  "T1562.001": "T1685",
  "T1562.002": "T1685",
  "T1562.003": "T1690",
  "T1562.004": "T1686",
  "T1562.006": "T1685",
  "T1562.007": "T1686",
  "T1562.008": "T1685",
  "T1562.009": "T1688",
  "T1562.010": "T1689",
  "T1562.011": "T1685",
  "T1562.012": "T1685",
};

// Own keys only: "constructor" is not a tactic short name.
function ownValue(
  map: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

export function getMitreTactic(id: string): MitreTactic | undefined {
  return TACTICS_BY_ID.get((id || "").trim().toUpperCase());
}

/*
 * The tactic id a Sigma tactic tag names, whether it is an id (`ta0006`)
 * or a short name in any of the spellings rules use (`credential_access`,
 * `credential-access`, `Credential Access`). Undefined for anything else.
 */
export function resolveMitreTacticId(value: string): string | undefined {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    return undefined;
  }

  const asId: MitreTactic | undefined = getMitreTactic(trimmed);

  if (asId) {
    return asId.id;
  }

  const key: string = trimmed.toLowerCase().replace(/[\s-]+/g, "_");

  return ownValue(MITRE_TACTIC_SHORT_NAMES, key);
}

/*
 * The parent technique a technique or sub-technique id counts toward in the
 * current matrix: `T1110.003` -> `T1110`, a revoked id -> its replacement.
 * Undefined when the id names no technique of this version.
 */
export function resolveMitreTechniqueId(value: string): string | undefined {
  const upper: string = (value || "").trim().toUpperCase();

  if (!upper) {
    return undefined;
  }

  const replaced: string = ownValue(MITRE_REVOKED_TECHNIQUES, upper) || upper;
  const parentId: string = replaced.split(".")[0] || "";

  if (TECHNIQUES_BY_ID.has(parentId)) {
    return parentId;
  }

  const replacedParent: string | undefined = ownValue(
    MITRE_REVOKED_TECHNIQUES,
    parentId,
  );

  if (replacedParent && TECHNIQUES_BY_ID.has(replacedParent)) {
    return replacedParent;
  }

  return undefined;
}

export function getMitreTechnique(id: string): MitreTechnique | undefined {
  const resolved: string | undefined = resolveMitreTechniqueId(id);

  return resolved ? TECHNIQUES_BY_ID.get(resolved) : undefined;
}

/*
 * A readable label for an id the product stores — "T1110 Brute Force",
 * "TA0006 Credential Access" — or the id itself when it names nothing in
 * this version (a sub-technique keeps its own id in front of its parent's
 * name).
 */
export function describeMitreId(id: string): string {
  const upper: string = (id || "").trim().toUpperCase();

  if (upper.startsWith("TA")) {
    const tactic: MitreTactic | undefined = getMitreTactic(upper);
    return tactic ? `${tactic.id} ${tactic.name}` : upper;
  }

  const technique: MitreTechnique | undefined = getMitreTechnique(upper);

  return technique ? `${upper} ${technique.name}` : upper;
}
