import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import CiscoAsaLogParser, {
  CISCO_ASA_MESSAGES,
  CISCO_ASA_PREFILTER_GROUPS,
  CiscoAsaKind,
  readAsaEndpoint,
  readCiscoAsaMessage,
} from "../../../../Utils/SecurityEvent/LogParsers/CiscoAsaLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { ASA_LINES } from "./FirewallFixtures";
import { logLine } from "./LogParserFixtures";

/*
 * Cisco ASA's and Firepower Threat Defense's own syslog: the messages
 * Cisco's guide gives for a denied connection, an attack dropped, what
 * threat detection, IPS signatures and the botnet traffic filter found, a
 * sign-in and an administrator's command become security events; a
 * connection built or torn down stays a log; and every line kept passes
 * the database's prefilter.
 */

function parse(line: string): Array<NormalizedSecurityEvent> {
  return CiscoAsaLogParser.parse(logLine(line));
}

function only(line: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(line);

  expect(events).toHaveLength(1);

  return events[0]!;
}

describe("CiscoAsaLogParser - reading a message", () => {
  test("its prefix, level and id, after any syslog header", () => {
    expect(readCiscoAsaMessage(ASA_LINES.aclDeny)).toMatchObject({
      productName: "Cisco ASA",
      level: 4,
      id: "106023",
      kind: CiscoAsaKind.Denied,
    });
    expect(readCiscoAsaMessage(ASA_LINES.ftdAclDeny)).toMatchObject({
      productName: "Cisco Firepower Threat Defense",
      id: "106023",
    });
  });

  test("a message not read, or one only shaped like one, is none", () => {
    for (const line of [
      ASA_LINES.built,
      ASA_LINES.teardown,
      "%ASA-x-106023: Deny tcp",
      "%ASA-4-1060230: Deny tcp",
      "%ASA-4-10602: Deny tcp",
      "ASA-4-106023 Deny tcp",
      "",
    ]) {
      expect([line, readCiscoAsaMessage(line)]).toEqual([line, null]);
    }
  });

  test("an endpoint, in each way Cisco writes one", () => {
    expect(readAsaEndpoint("outside:203.0.113.7/52314")).toEqual({
      interface: "outside",
      ip: "203.0.113.7",
      port: 52314,
    });
    expect(readAsaEndpoint("outside/203.0.113.7(52314)")).toEqual({
      interface: "outside",
      ip: "203.0.113.7",
      port: 52314,
    });
    expect(readAsaEndpoint("203.0.113.7/52314")).toEqual({
      interface: "",
      ip: "203.0.113.7",
      port: 52314,
    });
    expect(readAsaEndpoint("(10.0.0.1)")).toEqual({
      interface: "",
      ip: "10.0.0.1",
      port: 0,
    });
    expect(readAsaEndpoint("inside:2001:db8:1::5/443")).toEqual({
      interface: "inside",
      ip: "2001:db8:1::5",
      port: 443,
    });
    expect(readAsaEndpoint("2001:db8::7/443")).toEqual({
      interface: "",
      ip: "2001:db8::7",
      port: 443,
    });
    expect(readAsaEndpoint("outside:192.0.2.1/22,")).toEqual({
      interface: "outside",
      ip: "192.0.2.1",
      port: 22,
    });
    expect(readAsaEndpoint("not-an-address")).toEqual({
      interface: "",
      ip: "",
      port: 0,
    });
  });
});

describe("CiscoAsaLogParser - what becomes a security event", () => {
  test("a connection an access list denied is refused network activity naming the list", () => {
    const event: NormalizedSecurityEvent = only(ASA_LINES.aclDeny);

    expect(event).toMatchObject({
      className: "Network Activity",
      activityName: "Refuse",
      statusName: "Blocked",
      severityName: "Low",
      vendorName: "Cisco",
      productName: "Cisco ASA",
      ruleId: "106023",
      ruleName: "outside_access_in",
      principalIp: "203.0.113.7",
      targetIp: "192.0.2.5",
      targetPort: 443,
      message:
        "TCP connection from 203.0.113.7 to 192.0.2.5:443 denied by outside_access_in",
    });
    expect(event.attributes).toMatchObject({
      "asa.message_id": "106023",
      "asa.severity": "4",
      "asa.src_interface": "outside",
      "asa.dst_interface": "inside",
      "asa.acl": "outside_access_in",
      [SECURITY_LOG_FORMAT_ATTRIBUTE]: SecurityLogFormat.CiscoAsa,
    });
  });

  test("an access list's denied hit is read; its permitted hit stays a log", () => {
    expect(only(ASA_LINES.aclDeniedHit)).toMatchObject({
      principalIp: "203.0.113.7",
      targetIp: "192.0.2.5",
      targetPort: 22,
      ruleName: "outside_access_in",
    });
    expect(parse(ASA_LINES.aclPermittedHit)).toEqual([]);
  });

  test("denials at the edge and to the ASA itself", () => {
    expect(only(ASA_LINES.inboundDenied)).toMatchObject({
      message: "TCP connection from 203.0.113.7 to 192.0.2.5:23 denied",
    });
    expect(only(ASA_LINES.udpDenied).targetPort).toBe(161);
    expect(only(ASA_LINES.icmpDenied)).toMatchObject({
      principalIp: "203.0.113.7",
      targetIp: "192.0.2.5",
      message: "ICMP connection from 203.0.113.7 to 192.0.2.5 denied",
    });
    expect(only(ASA_LINES.toTheBoxDenied)).toMatchObject({
      targetIp: "192.0.2.1",
      targetPort: 22,
      message: "TCP connection from 203.0.113.7 to 192.0.2.1:22 denied",
    });
  });

  test("an attack the ASA dropped is Medium, in its own words", () => {
    expect(only(ASA_LINES.spoof)).toMatchObject({
      severityName: "Medium",
      principalIp: "10.0.0.1",
      message: "The ASA denied a spoofed packet from 10.0.0.1 to 192.0.2.5",
    });
    expect(only(ASA_LINES.landAttack).message).toBe(
      "The ASA denied a land attack from 192.0.2.5 to 192.0.2.5",
    );
    expect(only(ASA_LINES.teardrop).message).toBe(
      "The ASA denied a teardrop attack from 203.0.113.7 to 192.0.2.5",
    );
    expect(only(ASA_LINES.reversePath).message).toBe(
      "The ASA denied a packet that failed its reverse path check from 203.0.113.7 to 192.0.2.5",
    );
  });

  test("threat detection, IPS signatures and the botnet traffic filter are findings", () => {
    expect(only(ASA_LINES.scanning)).toMatchObject({
      className: "Detection Finding",
      statusName: "Detected",
      severityName: "Medium",
      ruleName: "Threat detection: [ Scanning] drop rate-1 exceeded",
    });
    expect(only(ASA_LINES.attackingHost).principalIp).toBe("203.0.113.7");
    expect(only(ASA_LINES.shunned)).toMatchObject({
      statusName: "Blocked",
      principalIp: "203.0.113.7",
    });
    expect(only(ASA_LINES.ips)).toMatchObject({
      ruleName: "IPS:2000 ICMP Echo Reply",
      principalIp: "203.0.113.7",
      targetIp: "192.0.2.5",
    });
    expect(only(ASA_LINES.botnet)).toMatchObject({
      ruleName: "Botnet traffic filter: Malware",
      severityName: "Critical",
      principalIp: "203.0.113.66",
      targetIp: "192.0.2.5",
      targetPort: 443,
    });
    expect(only(ASA_LINES.botnet).attributes["asa.threat_level"]).toBe(
      "very-high",
    );
  });

  test("sign-ins, failed or not, with the user and address each message gives", () => {
    expect(only(ASA_LINES.aaaRejected)).toMatchObject({
      className: "Authentication",
      statusName: "Failure",
      // The ASA hid the user's name.
      principalUser: "",
      principalIp: "203.0.113.7",
      message: "Failed AAA sign-in from 203.0.113.7 on the ASA: AAA failure",
    });
    expect(only(ASA_LINES.aaaLocalRejected)).toMatchObject({
      statusName: "Failure",
      principalUser: "alice",
      principalIp: "203.0.113.7",
    });
    expect(only(ASA_LINES.aaaSucceeded)).toMatchObject({
      statusName: "Success",
      principalUser: "bob",
    });
    expect(only(ASA_LINES.anyConnectStarted)).toMatchObject({
      statusName: "Success",
      principalUser: "bob",
      principalIp: "198.51.100.23",
      message: "AnyConnect sign-in for bob from 198.51.100.23 on the ASA",
    });
    expect(only(ASA_LINES.managementDenied)).toMatchObject({
      statusName: "Failure",
      principalUser: "admin",
      principalIp: "203.0.113.7",
      message: "Failed management sign-in for admin from 203.0.113.7 on the ASA",
    });
    expect(only(ASA_LINES.managementPermitted).statusName).toBe("Success");
    expect(only(ASA_LINES.userAuthFailed)).toMatchObject({
      statusName: "Failure",
      principalUser: "admin",
      principalIp: "203.0.113.7",
    });
    expect(only(ASA_LINES.userAuthSucceeded).statusName).toBe("Success");
  });

  test("an administrator's commands and privilege level", () => {
    expect(only(ASA_LINES.commandExecuted)).toMatchObject({
      className: "API Activity",
      principalUser: "admin",
      targetResource: "configure terminal",
      message: "admin ran 'configure terminal' on the ASA",
    });
    expect(only(ASA_LINES.commandFromIp)).toMatchObject({
      principalUser: "admin",
      principalIp: "198.51.100.23",
      targetResource: "access-list outside_access_in permit ip any any",
    });
    expect(only(ASA_LINES.privilegeChanged)).toMatchObject({
      className: "User Access Management",
      severityName: "Low",
      principalUser: "admin",
      message: "admin's privilege level on the ASA changed to 15",
    });
  });

  test("Firepower Threat Defense's messages read the same, as FTD", () => {
    expect(only(ASA_LINES.ftdAclDeny)).toMatchObject({
      productName: "Cisco Firepower Threat Defense",
      targetPort: 53,
      ruleName: "CSM_FW_ACL_",
    });
  });

  test("an IPv6 connection keeps its addresses", () => {
    expect(only(ASA_LINES.ipv6Deny)).toMatchObject({
      principalIp: "2001:db8::7",
      targetIp: "2001:db8:1::5",
      targetPort: 443,
    });
  });

  test("a connection built or torn down stays a log", () => {
    expect(parse(ASA_LINES.built)).toEqual([]);
    expect(parse(ASA_LINES.teardown)).toEqual([]);
  });

  test("the whole parser chain reads an ASA message as the ASA's", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(ASA_LINES.managementDenied),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.CiscoAsa,
    );
  });
});

describe("CiscoAsaLogParser - the database's prefilter holds every message kept", () => {
  test.each(Object.entries(ASA_LINES))("%s", (_name: string, line: string) => {
    if (parse(line).length > 0) {
      expect(matchesSecurityLogPrefilter(line)).toBe(true);
    }
  });

  test("every message read is asked for, 106100 only when it says denied", () => {
    // 35 messages, and the 51 IPS signatures 400000 to 400050.
    expect(CISCO_ASA_MESSAGES.size).toBe(35 + 51);

    for (const id of CISCO_ASA_MESSAGES.keys()) {
      const line: string = `%ASA-4-${id}: something denied happened`;
      const ftd: string = `%FTD-4-${id}: something denied happened`;

      expect([id, matchesSecurityLogPrefilter(line)]).toEqual([id, true]);
      expect([id, matchesSecurityLogPrefilter(ftd)]).toEqual([id, true]);
    }

    expect(
      matchesSecurityLogPrefilter("%ASA-6-106100: access-list x permitted tcp"),
    ).toBe(false);
  });

  test("its words are lowercase, within what one query takes", () => {
    for (const group of CISCO_ASA_PREFILTER_GROUPS) {
      for (const word of [group.requires, ...group.anyOf]) {
        expect(word).toBe(word.toLowerCase());
      }

      expect(group.anyOf.length).toBeLessThan(255);
    }
  });

  test("across thousands of generated messages of every id, level and wording", () => {
    const random: SeededRandom = seededRandom(1060);
    const pick: (items: ReadonlyArray<string>) => string = (
      items: ReadonlyArray<string>,
    ): string => {
      return items[random(items.length)]!;
    };
    const ids: Array<string> = [
      ...Array.from(CISCO_ASA_MESSAGES.keys()),
      "302013",
      "302014",
      "106015",
    ];
    const texts: Array<string> = Object.values(ASA_LINES).map(
      (line: string): string => {
        return line.slice(line.indexOf(": ", line.indexOf("%")) + 2);
      },
    );
    let kept: number = 0;

    for (let index: number = 0; index < 20000; index++) {
      const line: string = `${pick(["", "<164>", "Oct 30 2026 10:00:00 asa01 : "])}${pick(["%ASA-", "%FTD-"])}${random(8)}-${pick(ids)}: ${pick(texts)}`;

      if (parse(line).length > 0) {
        kept++;
        expect([line, matchesSecurityLogPrefilter(line)]).toEqual([line, true]);
      }
    }

    expect(kept).toBeGreaterThan(10000);
  });
});

describe("CiscoAsaLogParser - a long line is read in time in line with it", () => {
  test("400,000 characters after a message id, of prefixes, and of addresses", () => {
    const longText: string = `%ASA-4-106023: Deny tcp src ${"outside:".repeat(50000)} dst x`;
    const prefixes: string = "%ASA-".repeat(80000);
    const words: string = `%ASA-6-113005: ${"user = ".repeat(57000)}`;
    const brackets: string = `%ASA-6-113039: ${"User <".repeat(66000)}`;

    const result: FastestRun<void> = fastestRun({
      run: (): void => {
        parse(longText);
        parse(prefixes);
        parse(words);
        parse(brackets);
      },
      limitInMs: 2000,
    });

    expect(result.inMs).toBeLessThan(2000);
  });
});
