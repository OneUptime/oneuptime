import crypto from "crypto";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityLogFormat from "../../../../Types/SecurityEvent/SecurityLogFormat";
import { WINDOWS_PROVIDERS } from "../../../../Utils/SecurityEvent/LogParsers/WindowsEventLogParser";
import { SecurityLogLine } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import {
  ScrubbedAddressKind,
  ScrubbedAddressRole,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import {
  IPV4_ADDRESS_MASK,
  IPV6_ADDRESS_MASK,
} from "../../../../Utils/Telemetry/ScrubIpAddress";
import {
  azureActivityExport,
  entraExport,
  entraFailedSignIn,
} from "../Connectors/EntraIdFixtures";
import {
  anonymousStorageRecord,
  batchOf,
  keyVaultRecord,
  sqlDatabaseRecord,
} from "./AzureResourceLogFixtures";
import { panRecord } from "./FirewallFixtures";
import { googleAuditEntry } from "./GoogleCloudAuditFixtures";
import { auditEvent, cloudTrailRecord, logLine } from "./LogParserFixtures";
import {
  collectorOtlpBody,
  failedSignIn,
  nxlogBody,
  successfulSignIn,
  windowsEvent,
} from "./WindowsEventFixtures";

/*
 * ONE LINE OF EACH LOG FORMAT SECURITY EVENTS READS, NAMING THE ADDRESSES
 * IT IS GIVEN (#10419), for the suites that hide those addresses as each
 * scrub rule would: a source the event names as its principal, and - for a
 * format that records one - a destination it names as its target.
 *
 * A scrub rule hides every place a line writes an address, so each line
 * writes the addresses it is given wherever the source would (a FortiGate
 * admin sign-in names its client in srcip, ui and msg).
 *
 * Real shapes, made-up names and documentation addresses (RFC 5737). Not a
 * test file itself.
 */

// The project every token here is keyed for.
export const SCRUBBED_ADDRESS_PROJECT_ID: ObjectID = new ObjectID(
  "10419000-0000-4000-8000-0000000000a1",
);

// The addresses the lines name: both public, so an IP Address rule hides both.
export const SOURCE_ADDRESS: string = "203.0.113.7";
export const DESTINATION_ADDRESS: string = "198.51.100.9";

// A Hash rule's token for an address, as the project's rule makes it (#10394).
export function tokenOf(address: string): string {
  return ScrubHashToken.ofIpAddress({
    projectId: SCRUBBED_ADDRESS_PROJECT_ID,
    address,
  });
}

// A token made before tokens were keyed: 8 hex characters.
export function legacyTokenOf(address: string): string {
  return `[HASHED:${crypto.createHash("sha256").update(address).digest("hex").substring(0, 8)}]`;
}

// What each kind of rule leaves of the source and of the destination.
export interface ScrubbedAddressPair {
  label: string;
  kind: ScrubbedAddressKind;
  source: string;
  destination: string;
}

export const SCRUBBED_ADDRESS_PAIRS: ReadonlyArray<ScrubbedAddressPair> = [
  {
    label: "a Hash rule's token",
    kind: ScrubbedAddressKind.Hashed,
    source: tokenOf(SOURCE_ADDRESS),
    destination: tokenOf(DESTINATION_ADDRESS),
  },
  {
    label: "a token made before tokens were keyed",
    kind: ScrubbedAddressKind.Hashed,
    source: legacyTokenOf(SOURCE_ADDRESS),
    destination: legacyTokenOf(DESTINATION_ADDRESS),
  },
  {
    label: "Redact's [REDACTED]",
    kind: ScrubbedAddressKind.Redacted,
    source: "[REDACTED]",
    destination: "[REDACTED]",
  },
  {
    label: "Mask's IPv4 mask",
    kind: ScrubbedAddressKind.Masked,
    source: IPV4_ADDRESS_MASK,
    destination: IPV4_ADDRESS_MASK,
  },
  {
    label: "Mask's IPv6 mask",
    kind: ScrubbedAddressKind.Masked,
    source: IPV6_ADDRESS_MASK,
    destination: IPV6_ADDRESS_MASK,
  },
];

export interface ScrubbedAddressFormat {
  name: string;
  format: SecurityLogFormat;
  // The addresses the format names: its source always, its destination when it has one.
  roles: ReadonlyArray<ScrubbedAddressRole>;
  line: (addresses: { source: string; destination: string }) => SecurityLogLine;
}

const PRINCIPAL: ReadonlyArray<ScrubbedAddressRole> = [
  ScrubbedAddressRole.Principal,
];

const BOTH: ReadonlyArray<ScrubbedAddressRole> = [
  ScrubbedAddressRole.Principal,
  ScrubbedAddressRole.Target,
];

function jsonLine(record: JSONObject): SecurityLogLine {
  return logLine(JSON.stringify(record));
}

const SYSMON: string = WINDOWS_PROVIDERS.sysmon;

export const SCRUBBED_ADDRESS_FORMATS: ReadonlyArray<ScrubbedAddressFormat> = [
  {
    name: "an SSH failed password",
    format: SecurityLogFormat.SshSignIn,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        `Nov 20 10:00:00 bastion sshd[4242]: Failed password for root from ${source} port 52314 ssh2`,
      );
    },
  },
  {
    name: "a Palo Alto traffic log",
    format: SecurityLogFormat.PaloAlto,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        panRecord("TRAFFIC", {
          "Threat/Content Type": "deny",
          "Source Address": source,
          "Destination Address": destination,
          "Rule Name": "deny-rdp",
          Application: "ms-rdp",
          "Source Port": "40000",
          "Destination Port": "3389",
          Protocol: "tcp",
          Action: "deny",
          "Sequence Number": "8000001",
          "Session End Reason": "policy-deny",
        }),
      );
    },
  },
  {
    name: "a Palo Alto threat: a beacon to its command and control",
    format: SecurityLogFormat.PaloAlto,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        panRecord("THREAT", {
          "Threat/Content Type": "spyware",
          "Source Address": source,
          "Destination Address": destination,
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
      );
    },
  },
  {
    name: "a Palo Alto GlobalProtect sign-in that failed",
    format: SecurityLogFormat.PaloAlto,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        panRecord("GLOBALPROTECT", {
          "Threat/Content Type": "0",
          "Event ID": "gateway-auth",
          Stage: "login",
          "Source User": "alice",
          "Public IP": source,
          Error: "Authentication failed: Invalid username or password",
          Status: "failure",
          Portal: "GP-Portal",
          "Sequence Number": "9000001",
        }),
      );
    },
  },
  {
    name: "a Palo Alto administrator's failed sign-in",
    format: SecurityLogFormat.PaloAlto,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        panRecord("SYSTEM", {
          "Threat/Content Type": "auth",
          "Event ID": "auth-fail",
          Object: "admin",
          Module: "general",
          Severity: "medium",
          Description: `failed authentication for user 'admin'. Reason: Invalid username or password. From: ${source}.`,
          "Sequence Number": "1000001",
        }),
      );
    },
  },
  {
    name: "a FortiGate traffic log",
    format: SecurityLogFormat.FortiGate,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        `date=2026-10-30 time=10:00:06 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0000000013" type="traffic" subtype="forward" level="notice" vd="root" srcip=${source} srcport=40000 srcintf="wan1" dstip=${destination} dstport=3389 dstintf="internal" sessionid=12348 proto=6 action="deny" policyid=0 policytype="policy" service="RDP" trandisp="noop" duration=0 sentbyte=0 rcvdbyte=0`,
      );
    },
  },
  {
    name: "a FortiGate IPS finding, which names its destination as the host too",
    format: SecurityLogFormat.FortiGate,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        `<185>date=2026-10-30 time=10:00:00 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0419016384" type="utm" subtype="ips" eventtype="signature" level="alert" vd="root" severity="critical" srcip=${source} dstip=${destination} srcintf="wan1" dstintf="internal" sessionid=12345 action="dropped" proto=6 service="HTTP" policyid=1 attack="Apache.Log4j.Error.Log.Remote.Code.Execution" srcport=52314 dstport=80 hostname="${destination}" url="/" direction="outgoing" attackid=51006`,
      );
    },
  },
  {
    name: "a FortiGate administrator's failed sign-in",
    format: SecurityLogFormat.FortiGate,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        `date=2026-10-30 time=10:00:08 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0100032002" type="event" subtype="system" level="alert" vd="root" logdesc="Admin login failed" sn="0" user="admin" ui="https(${source})" method="https" srcip=${source} action="login" status="failed" reason="passwd_invalid" msg="Administrator admin login failed from https(${source}) because of invalid password"`,
      );
    },
  },
  {
    name: "a FortiGate SSL VPN sign-in that failed",
    format: SecurityLogFormat.FortiGate,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        `date=2026-10-30 time=10:00:11 devname="FGT60F" devid="FGT60FTK2209A0B1" logid="0101039426" type="event" subtype="vpn" level="alert" vd="root" logdesc="SSL VPN login fail" action="ssl-login-fail" tunneltype="ssl-web" tunnelid=0 remip=${source} user="alice" group="N/A" dst_host="N/A" reason="sslvpn_login_permission_denied" msg="SSL user failed to logged in"`,
      );
    },
  },
  {
    name: "a Cisco ASA connection an access list denied",
    format: SecurityLogFormat.CiscoAsa,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        `<164>Oct 30 2026 10:00:00 asa01 : %ASA-4-106023: Deny tcp src outside:${source}/52314 dst inside:${destination}/443 by access-group "outside_access_in" [0x0, 0x0]`,
      );
    },
  },
  {
    name: "a Cisco ASA access list's denied hit",
    format: SecurityLogFormat.CiscoAsa,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        `%ASA-6-106100: access-list outside_access_in denied tcp outside/${source}(52314) -> inside/${destination}(22) hit-cnt 1 first hit [0x91c26a3, 0x0]`,
      );
    },
  },
  {
    name: "a Cisco ASA AAA sign-in rejected",
    format: SecurityLogFormat.CiscoAsa,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        `%ASA-6-113015: AAA user authentication Rejected : reason = Invalid password : local database : user = alice : user IP = ${source}`,
      );
    },
  },
  {
    name: "a CEF record of a denied connection",
    format: SecurityLogFormat.Cef,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        `CEF:0|Palo Alto Networks|PAN-OS|10.1.0|deny|TRAFFIC|1|rt=1730282400000 src=${source} dst=${destination} spt=40000 dpt=3389 proto=tcp act=deny`,
      );
    },
  },
  {
    name: "a CEF record of an administrator's failed sign-in",
    format: SecurityLogFormat.Cef,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        `CEF:0|Fortinet|Fortigate|v7.0.12|32002|event:system login failed|7|deviceExternalId=FGT60F duser=admin src=${source} act=login outcome=failed msg=Administrator admin login failed from https(${source}) because of invalid password`,
      );
    },
  },
  {
    name: "a LEEF record of a blocked download",
    format: SecurityLogFormat.Leef,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        `<13>LEEF:1.0|Zscaler|NSSWeblog|5.7|Blocked|cat=Malicious Content\tsrc=${source}\tdst=${destination}\tusrName=alice@example.com\taction=Blocked\turl=evil.example/payload.exe\tsev=9`,
      );
    },
  },
  {
    name: "a Windows 4625 failed logon",
    format: SecurityLogFormat.WindowsEvents,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(collectorOtlpBody(failedSignIn({ IpAddress: source })), {
        "host.name": "win-01",
      });
    },
  },
  {
    name: "a Windows 4624 sign-in, as NXLog writes it",
    format: SecurityLogFormat.WindowsEvents,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(nxlogBody(successfulSignIn({ IpAddress: source })), {
        "host.name": "win-01",
      });
    },
  },
  {
    name: "a Sysmon network connection",
    format: SecurityLogFormat.WindowsEvents,
    roles: BOTH,
    line: ({
      source,
      destination,
    }: {
      source: string;
      destination: string;
    }): SecurityLogLine => {
      return logLine(
        collectorOtlpBody(
          windowsEvent(3, SYSMON, "Microsoft-Windows-Sysmon/Operational", [
            ["Image", "C:\\Users\\alice\\AppData\\Local\\Temp\\x.exe"],
            ["User", "CORP\\alice"],
            ["Protocol", "tcp"],
            ["SourceIp", source],
            ["SourcePort", "50100"],
            ["DestinationIp", destination],
            ["DestinationHostname", "c2.example"],
            ["DestinationPort", "443"],
          ]),
        ),
        { "host.name": "win-01" },
      );
    },
  },
  {
    name: "a CloudTrail record sent as a log",
    format: SecurityLogFormat.AwsCloudTrail,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return jsonLine(cloudTrailRecord({ sourceIPAddress: source }));
    },
  },
  {
    name: "a CloudTrail console sign-in that failed, in a file of records",
    format: SecurityLogFormat.AwsCloudTrail,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return jsonLine({
        Records: [
          cloudTrailRecord({
            // A record of its own: one record is stored once, whichever line holds it.
            eventID: "8f1c2e3d-0000-0000-0000-000000000002",
            eventSource: "signin.amazonaws.com",
            eventName: "ConsoleLogin",
            eventType: "AwsConsoleSignIn",
            sourceIPAddress: source,
            requestParameters: null,
            responseElements: { ConsoleLogin: "Failure" },
            errorMessage: "Failed authentication",
          }),
        ],
      });
    },
  },
  {
    name: "a Google Cloud audit log entry",
    format: SecurityLogFormat.GoogleCloudAudit,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return jsonLine(
        googleAuditEntry("activity", {
          requestMetadata: {
            callerIp: source,
            callerSuppliedUserAgent: "google-cloud-sdk",
          },
        }),
      );
    },
  },
  {
    name: "an Azure Activity Log record",
    format: SecurityLogFormat.AzureActivity,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return jsonLine(azureActivityExport({ callerIpAddress: source }));
    },
  },
  {
    name: "a Microsoft Entra ID sign-in that failed, exported by Azure",
    format: SecurityLogFormat.AzureActivity,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return jsonLine(
        entraExport("SignInLogs", entraFailedSignIn({ ipAddress: source }), {
          callerIpAddress: source,
        }),
      );
    },
  },
  {
    name: "an Azure key vault's secret read",
    format: SecurityLogFormat.AzureResourceLogs,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(batchOf([keyVaultRecord({ callerIpAddress: source })]));
    },
  },
  {
    name: "an Azure storage request served anonymously, its address with a port",
    format: SecurityLogFormat.AzureResourceLogs,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        batchOf([anonymousStorageRecord({ callerIpAddress: `${source}:52314` })]),
      );
    },
  },
  {
    name: "an Azure SQL sign-in that failed",
    format: SecurityLogFormat.AzureResourceLogs,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(batchOf([sqlDatabaseRecord({ client_ip: source })]));
    },
  },
  {
    name: "a Kubernetes audit event the API server refused",
    format: SecurityLogFormat.KubernetesAudit,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return jsonLine(
        auditEvent({
          sourceIPs: [source],
          verb: "get",
          objectRef: {
            resource: "secrets",
            namespace: "default",
            name: "db-password",
            apiVersion: "v1",
          },
          responseStatus: { metadata: {}, code: 403 },
        }),
      );
    },
  },
  {
    name: "an OpenStack sign-in that failed",
    format: SecurityLogFormat.OpenStackAudit,
    roles: PRINCIPAL,
    line: ({ source }: { source: string }): SecurityLogLine => {
      return logLine(
        JSON.stringify({
          message_id: "6d3e8f6b-9f4a-4d3d-9a6b-1f1b2a3c4d5e",
          event_type: "identity.authenticate",
          priority: "INFO",
          publisher_id: "identity.controller",
          timestamp: "2026-10-30 10:00:00.000000",
          payload: {
            typeURI: "http://schemas.dmtf.org/cloud/audit/1.0/event",
            eventType: "activity",
            id: "payload-id",
            eventTime: "2026-10-30T10:00:01.000000+0000",
            action: "authenticate",
            outcome: "failure",
            reason: { reasonCode: "401", reasonType: "Unauthorized" },
            initiator: {
              typeURI: "service/security/account/user",
              id: "hashed-initiator-id",
              user_id: "0123456789abcdef0123456789abcdef",
              username: "alice",
              host: { address: source, agent: "curl/8" },
            },
            target: {
              typeURI: "service/security/account/user",
              id: "target-id",
            },
            observer: { typeURI: "service/security", id: "observer-id" },
          },
        }),
        { "resource.openstack.cloud.name": "production" },
      );
    },
  },
];

// A format's line naming the real addresses.
export function lineWithAddresses(
  format: ScrubbedAddressFormat,
): SecurityLogLine {
  return format.line({
    source: SOURCE_ADDRESS,
    destination: DESTINATION_ADDRESS,
  });
}

// The same line with what a rule left in place of each address.
export function lineWithScrubbed(
  format: ScrubbedAddressFormat,
  pair: Pick<ScrubbedAddressPair, "source" | "destination">,
): SecurityLogLine {
  return format.line({ source: pair.source, destination: pair.destination });
}
