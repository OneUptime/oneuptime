import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import FortiGateLogParser, {
  FORTIGATE_BLOCK_ACTIONS,
  FORTIGATE_PREFILTER_GROUPS,
  FORTIGATE_THREAT_SUBTYPES,
  readFortiGatePairs,
  readFortiGateRecord,
  uiAddress,
} from "../../../../Utils/SecurityEvent/LogParsers/FortiGateLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { FORTIGATE_LINES } from "./FirewallFixtures";
import { logLine } from "./LogParserFixtures";

/*
 * Fortinet FortiGate's own syslog: a UTM finding, a denied session, a
 * sign-in and a configuration change become security events with
 * FortiGate's own keys; an accepted session, a web page passed and a
 * routine system message stay logs; and every line kept passes the
 * database's prefilter.
 */

function parse(line: string): Array<NormalizedSecurityEvent> {
  return FortiGateLogParser.parse(logLine(line));
}

function only(line: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(line);

  expect(events).toHaveLength(1);

  return events[0]!;
}

describe("FortiGateLogParser - reading key=value pairs", () => {
  test("quoted values keep their spaces, bare values end at a space, keys are lowercase", () => {
    expect(
      readFortiGatePairs(
        'date=2026-10-30 Logid="0100032002" msg="Administrator admin login failed" user=admin',
      ),
    ).toEqual({
      date: "2026-10-30",
      logid: "0100032002",
      msg: "Administrator admin login failed",
      user: "admin",
    });
  });

  test("an escaped quote inside a value is part of it; the first of two keys is kept", () => {
    expect(
      readFortiGatePairs('msg="say \\"hi\\" now" user=a user=b'),
    ).toEqual({ msg: 'say "hi" now', user: "a" });
  });

  test("a key starts the line or follows a space: a=b inside a value is not a key", () => {
    expect(readFortiGatePairs('url="/a?b=c&d=e" x=1')).toEqual({
      url: "/a?b=c&d=e",
      x: "1",
    });
    expect(readFortiGatePairs("<185>date=2026-10-30 logid=1")).toEqual({
      logid: "1",
    });
  });

  test("a record needs a log id, a type and the device that wrote it", () => {
    expect(readFortiGateRecord(FORTIGATE_LINES.ips)?.pairs["subtype"]).toBe(
      "ips",
    );
    expect(readFortiGateRecord("logid=1 type=utm")).toBeNull();
    expect(readFortiGateRecord('devname="x" type=utm')).toBeNull();
    expect(readFortiGateRecord("just text")).toBeNull();
  });

  test("an interface names the address an administrator came from", () => {
    expect(uiAddress("https(203.0.113.7)")).toBe("203.0.113.7");
    expect(uiAddress("GUI(198.51.100.23)")).toBe("198.51.100.23");
    expect(uiAddress("console")).toBe("");
    expect(uiAddress("ssh(127.0.0.1)")).toBe("");
  });
});

describe("FortiGateLogParser - what becomes a security event", () => {
  test("an IPS signature is a Detection Finding with the attack's name, id and severity", () => {
    const event: NormalizedSecurityEvent = only(FORTIGATE_LINES.ips);

    expect(event).toMatchObject({
      className: "Detection Finding",
      activityName: "Create",
      statusName: "Blocked",
      severityName: "Critical",
      ruleName: "Apache.Log4j.Error.Log.Remote.Code.Execution",
      ruleId: "51006",
      vendorName: "Fortinet",
      productName: "FortiGate",
      principalIp: "203.0.113.7",
      targetIp: "192.0.2.20",
      targetPort: 80,
      message:
        "Apache.Log4j.Error.Log.Remote.Code.Execution from 203.0.113.7 to 192.0.2.20:80 (dropped)",
    });
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.FortiGate,
    );
    expect(event.attributes["fortigate.attackid"]).toBe("51006");
    // eventtime, in nanoseconds since the epoch.
    expect(event.time.toISOString()).toBe("2026-10-30T10:00:00.123Z");
  });

  test("a virus found and an anomaly are findings, by their own names", () => {
    expect(only(FORTIGATE_LINES.virus)).toMatchObject({
      ruleName: "W32/Agent.ABC!tr",
      ruleId: "8015001",
      statusName: "Blocked",
      principalUser: "alice",
      targetResource: "http://203.0.113.80/invoice.exe",
      severityName: "Medium",
    });
    expect(only(FORTIGATE_LINES.anomaly)).toMatchObject({
      ruleName: "tcp_syn_flood",
      severityName: "Critical",
    });
  });

  test("a web page the web filter blocked is a refused request; one it passed stays a log", () => {
    expect(only(FORTIGATE_LINES.webfilterBlocked)).toMatchObject({
      className: "HTTP Activity",
      activityName: "Request",
      statusName: "Blocked",
      principalUser: "alice",
      targetHost: "malware.example",
      targetResource: "/payload",
      message:
        "Request to malware.example/payload blocked from 192.0.2.10 (Malicious Websites)",
    });
    expect(parse(FORTIGATE_LINES.webfilterPassthrough)).toEqual([]);
    expect(parse(FORTIGATE_LINES.appControlPass)).toEqual([]);
  });

  test("a denied session is refused network activity; an accepted one stays a log", () => {
    expect(only(FORTIGATE_LINES.trafficDeny)).toMatchObject({
      className: "Network Activity",
      activityName: "Refuse",
      statusName: "Blocked",
      principalIp: "203.0.113.99",
      targetIp: "192.0.2.5",
      targetPort: 3389,
      message: "RDP from 203.0.113.99 to 192.0.2.5:3389 blocked (deny, policy 0)",
    });
    expect(parse(FORTIGATE_LINES.trafficAccept)).toEqual([]);
  });

  test("an administrator's and an SSL VPN user's sign-ins are Authentications; a logout is not", () => {
    expect(only(FORTIGATE_LINES.adminLoginFailed)).toMatchObject({
      className: "Authentication",
      statusName: "Failure",
      severityName: "Low",
      principalUser: "admin",
      principalIp: "203.0.113.7",
      targetHost: "FGT60F",
      message:
        "Admin login failed for admin from 203.0.113.7 on FGT60F: passwd_invalid",
    });
    expect(only(FORTIGATE_LINES.adminLoginSucceeded)).toMatchObject({
      statusName: "Success",
      principalIp: "198.51.100.23",
    });
    expect(only(FORTIGATE_LINES.sslVpnLoginFailed)).toMatchObject({
      statusName: "Failure",
      principalUser: "alice",
      principalIp: "203.0.113.44",
    });
    expect(parse(FORTIGATE_LINES.adminLogout)).toEqual([]);
  });

  test("an administrator's configuration change is API Activity naming what changed", () => {
    expect(only(FORTIGATE_LINES.configChanged)).toMatchObject({
      className: "API Activity",
      activityName: "Edit",
      principalUser: "admin",
      principalIp: "198.51.100.23",
      targetResource: "firewall.policy 7",
      message: "admin edit firewall.policy 7 from 198.51.100.23 on FGT60F",
    });
  });

  test("a routine system message stays a log", () => {
    expect(parse(FORTIGATE_LINES.systemPerformance)).toEqual([]);
  });

  test("older FortiOS's fewer quotes read the same", () => {
    expect(only(FORTIGATE_LINES.olderIps)).toMatchObject({
      ruleName: "SQL.Injection",
      statusName: "Detected",
      severityName: "High",
      targetHost: "",
    });
    expect(only(FORTIGATE_LINES.olderIps).time.toISOString()).toBe(
      "2026-10-30T10:00:14.000Z",
    );
  });

  test("the whole parser chain reads a FortiGate record as FortiGate", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(FORTIGATE_LINES.adminLoginFailed),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.FortiGate,
    );
  });
});

describe("FortiGateLogParser - the database's prefilter holds every record kept", () => {
  test.each(Object.entries(FORTIGATE_LINES))(
    "%s",
    (_name: string, line: string) => {
      if (parse(line).length > 0) {
        expect(matchesSecurityLogPrefilter(line)).toBe(true);
      }
    },
  );

  test("its words are lowercase, within what one query takes", () => {
    for (const group of FORTIGATE_PREFILTER_GROUPS) {
      for (const word of [group.requires, ...group.anyOf]) {
        expect(word).toBe(word.toLowerCase());
      }

      expect(group.anyOf.length).toBeLessThan(255);
    }
  });

  test("across thousands of generated records of every type, subtype, action and quoting", () => {
    const random: SeededRandom = seededRandom(7001);
    const pick: (items: ReadonlyArray<string>) => string = (
      items: ReadonlyArray<string>,
    ): string => {
      return items[random(items.length)]!;
    };
    const quote: (value: string) => string = (value: string): string => {
      return random(2) === 0 ? `"${value}"` : value;
    };
    const types: Array<string> = ["utm", "UTM", "traffic", "event", "other"];
    const subtypes: Array<string> = [
      ...FORTIGATE_THREAT_SUBTYPES,
      "webfilter",
      "app-ctrl",
      "dns",
      "forward",
      "system",
      "vpn",
      "user",
    ];
    const actions: Array<string> = [
      ...FORTIGATE_BLOCK_ACTIONS,
      "accept",
      "passthrough",
      "pass",
      "login",
      "logout",
      "Edit",
      "Add",
      "ssl-login-fail",
      "",
    ];
    const descriptions: Array<string> = [
      "Admin login failed",
      "Admin login successful",
      "Admin logout successful",
      "SSL VPN login fail",
      "Authentication success",
      "Object attribute configured",
      "System performance statistics",
      "",
    ];
    let kept: number = 0;

    for (let index: number = 0; index < 20000; index++) {
      const pairs: Array<string> = [
        `logid=${quote("0100032002")}`,
        `type=${quote(pick(types))}`,
        `subtype=${quote(pick(subtypes))}`,
        `devname=${quote("FGT60F")}`,
      ];

      if (random(3) !== 0) {
        pairs.push(`action=${quote(pick(actions))}`);
      }

      if (random(2) === 0) {
        pairs.push(`logdesc="${pick(descriptions)}"`);
      }

      if (random(3) === 0) {
        pairs.push(`cfgpath=${quote("firewall.policy")}`);
      }

      pairs.push("srcip=203.0.113.7", "dstip=192.0.2.5");

      for (let shuffle: number = pairs.length - 1; shuffle > 0; shuffle--) {
        const other: number = random(shuffle + 1);
        const held: string = pairs[shuffle]!;
        pairs[shuffle] = pairs[other]!;
        pairs[other] = held;
      }

      const line: string = `${pick(["", "<185>", "Oct 30 10:00:00 fw-01 "])}${pairs.join(" ")}`;

      if (parse(line).length > 0) {
        kept++;
        expect([line, matchesSecurityLogPrefilter(line)]).toEqual([line, true]);
      }
    }

    expect(kept).toBeGreaterThan(3000);
  });
});

describe("FortiGateLogParser - a long line is read in time in line with it", () => {
  test("400,000 characters of keys, of one quoted value, and of equals signs", () => {
    const keys: string = `logid=1 type=utm devname=x ${"a=b ".repeat(100000)}`;
    const quoted: string = `logid=1 type=utm devname=x msg="${"x".repeat(400000)}`;
    const equals: string = `logid=1 type=utm devname=x ${"=".repeat(400000)}`;
    const escapes: string = `logid=1 type=utm devname=x msg="${"\\".repeat(400000)}"`;

    const result: FastestRun<void> = fastestRun({
      run: (): void => {
        parse(keys);
        parse(quoted);
        parse(equals);
        parse(escapes);
      },
      limitInMs: 2000,
    });

    expect(result.inMs).toBeLessThan(2000);
  });
});
