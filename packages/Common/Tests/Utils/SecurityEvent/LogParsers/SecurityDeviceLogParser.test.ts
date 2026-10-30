import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import SecurityDeviceLogParser, {
  BLOCK_ACTIONS,
  DETECT_ACTIONS,
  SECURITY_DEVICE_PREFILTER_WORDS,
  SIGN_IN_MARKERS,
  THREAT_MARKERS,
  readActionStatus,
  readDeviceSeverity,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityDeviceLogParser";
import SecurityLogParser, {
  matchesSecurityLogPrefilter,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { LOG_TIME, logLine } from "./LogParserFixtures";
import { DEVICE_LINES } from "./SecurityDeviceFixtures";

/*
 * Contract under test - security products' CEF and LEEF records in a
 * project's logs become security events when they are threats, something
 * blocked or detected, sign-ins or rated High, and stay logs otherwise
 * (SecurityDeviceLogParser).
 *
 * The lines follow each vendor's documented layout; addresses are RFC 5737
 * documentation addresses and the accounts made up.
 */

function parse(body: string): Array<NormalizedSecurityEvent> {
  return SecurityDeviceLogParser.parse(logLine(body, { "host.name": "fw-01" }));
}

function only(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = parse(body);

  expect(events).toHaveLength(1);

  return events[0]!;
}

describe("SecurityDeviceLogParser - what becomes a security event", () => {
  test("a threat a firewall found is a Detection Finding naming the device and what it did", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.paloAltoThreat);

    expect({
      className: event.className,
      activityName: event.activityName,
      statusName: event.statusName,
      severityName: event.severityName,
      vendorName: event.vendorName,
      productName: event.productName,
      ruleName: event.ruleName,
      ruleId: event.ruleId,
      principalUser: event.principalUser,
      principalIp: event.principalIp,
      targetIp: event.targetIp,
      targetPort: event.targetPort,
      targetResource: event.targetResource,
    }).toEqual({
      className: "Detection Finding",
      activityName: "Create",
      statusName: "Blocked",
      severityName: "Medium",
      vendorName: "Palo Alto Networks",
      productName: "PAN-OS",
      ruleName: "THREAT",
      ruleId: "spyware",
      principalUser: "corp\\alice",
      principalIp: "192.0.2.10",
      targetIp: "203.0.113.50",
      targetPort: 443,
      targetResource: "evil.example/beacon",
    });
    expect(event.attributes["cef.cat"]).toBe("Cobalt Strike Beacon C2(86245)");
    expect(event.attributes["cef.vendor"]).toBe("Palo Alto Networks");
    expect(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE]).toBe(
      SecurityLogFormat.Cef,
    );
    expect(event.time.toISOString()).toBe("2024-10-30T10:00:00.000Z");
  });

  test("a connection a firewall refused is a refused Network Activity", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.paloAltoDeny);

    expect(event.className).toBe("Network Activity");
    expect(event.activityName).toBe("Refuse");
    expect(event.statusName).toBe("Blocked");
    expect(event.principalIp).toBe("203.0.113.99");
    expect(event.targetPort).toBe(3389);
    expect(event.message).toBe(
      "TRAFFIC from 203.0.113.99 to 192.0.2.5:3389 (deny)",
    );
  });

  test.each([
    ["Palo Alto's allowed traffic", "paloAltoAllow"],
    ["FortiGate's accepted traffic", "fortiGateAccept"],
    ["a UniFi client disconnecting", "uniFiClientDisconnected"],
    ["Zscaler's allowed request", "zscalerLeefAllowed"],
  ])(
    "%s stays a log, and never leaves the database",
    (_name: string, key: string) => {
      const line: string = DEVICE_LINES[key as keyof typeof DEVICE_LINES];

      expect(parse(line)).toEqual([]);
      expect(matchesSecurityLogPrefilter(line)).toBe(false);
    },
  );

  test("an IPS signature FortiGate dropped is a finding, its signature name kept", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.fortiGateIps);

    expect(event.className).toBe("Detection Finding");
    expect(event.statusName).toBe("Blocked");
    expect(event.attributes["cef.cs4"]).toBe(
      "Apache.Log4j.Error.Log.Remote.Code.Execution",
    );
  });

  test("an administrator's failed sign-in is a failed Authentication, not a refused connection", () => {
    const event: NormalizedSecurityEvent = only(
      DEVICE_LINES.fortiGateAdminLoginFailed,
    );

    expect(event.className).toBe("Authentication");
    expect(event.statusName).toBe("Failure");
    expect(event.principalUser).toBe("admin");
    expect(event.principalIp).toBe("203.0.113.7");
    expect(event.severityName).toBe("High");
    expect(event.ruleName).toBe("");
  });

  test("a VPN sign-in that worked is a successful Authentication", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.vpnLoginSucceeded);

    expect(event.className).toBe("Authentication");
    expect(event.statusName).toBe("Success");
    expect(event.severityName).toBe("Low");
    expect(event.principalUser).toBe("bob");
    expect(event.message).toBe(
      "Sign-in for bob from 198.51.100.23 on Fortigate",
    );
  });

  test("a router's failed sign-in told only in its message is read as one", () => {
    const event: NormalizedSecurityEvent = only(
      DEVICE_LINES.mikroTikLoginFailure,
    );

    expect(event.className).toBe("Authentication");
    expect(event.statusName).toBe("Failure");
    expect(event.principalUser).toBe("guest");
    expect(event.principalIp).toBe("192.168.88.17");
    expect(event.targetHost).toBe("MikroTik");
  });

  test("a Check Point drop, its product's name and all", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.checkPointDrop);

    expect(event.vendorName).toBe("Check Point");
    expect(event.productName).toBe("VPN-1 & FireWall-1");
    expect(event.severityName).toBe("Medium");
  });

  test("a WAF's blocked attack keeps its request and the product's own id", () => {
    const event: NormalizedSecurityEvent = only(
      DEVICE_LINES.impervaSqlInjection,
    );

    expect(event.targetResource).toBe("/item?id=1' or 1=1");
    expect(event.eventUid).toBe("cef:Imperva Inc.:SecureSphere:7718");
    expect(event.severityName).toBe("High");
  });

  test("an EDR's detection at Medium is a finding about the user and host it names", () => {
    const event: NormalizedSecurityEvent = only(
      DEVICE_LINES.crowdStrikeDetection,
    );

    expect(event.className).toBe("Detection Finding");
    expect(event.targetUser).toBe("alice");
    expect(event.targetResource).toBe("powershell.exe");
  });

  test("antivirus deleting a file is something it blocked", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.trendMicroMalware);

    expect(event.statusName).toBe("Blocked");
    expect(event.targetHost).toBe("web-02");
    expect(event.targetResource).toBe("Eicar.exe");
  });

  test("a record the product rates High is an event even with nothing else to go on", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.highSeverityAlone);

    expect(event.className).toBe("Detection Finding");
    expect(event.severityName).toBe("High");
  });

  test("a High rating with a space around it in the header is not read as one", () => {
    expect(
      parse(
        "CEF:0|Acme|Gateway|1.0|900|Tunnel endpoint unreachable| 8 |dvchost=gw-01",
      ),
    ).toEqual([]);
  });
});

describe("SecurityDeviceLogParser - LEEF", () => {
  test("Zscaler's blocked download is a Critical finding about the user", () => {
    const event: NormalizedSecurityEvent = only(
      DEVICE_LINES.zscalerLeefBlocked,
    );

    expect({
      className: event.className,
      statusName: event.statusName,
      severityName: event.severityName,
      vendorName: event.vendorName,
      productName: event.productName,
      principalUser: event.principalUser,
      principalIp: event.principalIp,
      targetResource: event.targetResource,
      format: event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE],
      action: event.attributes["leef.action"],
    }).toEqual({
      className: "Detection Finding",
      statusName: "Blocked",
      severityName: "Critical",
      vendorName: "Zscaler",
      productName: "NSSWeblog",
      principalUser: "alice@example.com",
      principalIp: "192.0.2.15",
      targetResource: "evil.example/payload.exe",
      format: SecurityLogFormat.Leef,
      action: "Blocked",
    });
  });

  test("Palo Alto's denied connection in LEEF, its time from devTime", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.paloAltoLeefDeny);

    expect(event.className).toBe("Network Activity");
    expect(event.targetPort).toBe(22);
    expect(event.time.toISOString()).toBe("2024-10-30T10:00:00.000Z");
  });

  test("a LEEF 2.0 record separated by its own character", () => {
    const event: NormalizedSecurityEvent = only(DEVICE_LINES.qradarLeef2);

    expect(event.className).toBe("Detection Finding");
    expect(event.severityName).toBe("High");
    expect(event.principalIp).toBe("203.0.113.44");
    expect(event.targetPort).toBe(22);
  });
});

describe("SecurityDeviceLogParser - severities, statuses and times", () => {
  test.each([
    ["0", OcsfSeverity.Informational],
    ["1", OcsfSeverity.Low],
    ["3", OcsfSeverity.Low],
    ["4", OcsfSeverity.Medium],
    ["6", OcsfSeverity.Medium],
    ["7", OcsfSeverity.High],
    ["8", OcsfSeverity.High],
    ["9", OcsfSeverity.Critical],
    ["10", OcsfSeverity.Critical],
    ["Low", OcsfSeverity.Low],
    ["MEDIUM", OcsfSeverity.Medium],
    ["High", OcsfSeverity.High],
    ["Very-High", OcsfSeverity.Critical],
    [" very high ", OcsfSeverity.Critical],
    ["11", OcsfSeverity.Unknown],
    ["", OcsfSeverity.Unknown],
    ["urgent", OcsfSeverity.Unknown],
    ["1.5", OcsfSeverity.Unknown],
  ])(
    "a product severity of %p is %s",
    (severity: string, expected: OcsfSeverity) => {
      expect(readDeviceSeverity(severity)).toBe(expected);
    },
  );

  test.each([
    ["block", "Blocked"],
    ["reset-both", "Blocked"],
    ["Prevent", "Blocked"],
    ["quarantined", "Blocked"],
    ["alert", "Detected"],
    ["Detected", "Detected"],
    ["allow", "Allowed"],
    ["accepted", "Allowed"],
    ["login", "Login"],
    ["", ""],
  ])("an action of %p reads as %p", (action: string, status: string) => {
    expect(readActionStatus(action)).toBe(status);
  });

  test("a device's own date with no time zone leaves the log's time", () => {
    const event: NormalizedSecurityEvent = only(
      "CEF:0|Acme|Gateway|1.0|1|Port scan|5|rt=Oct 30 2026 10:00:00 src=203.0.113.9",
    );

    expect(event.time.toISOString()).toBe(LOG_TIME.toISOString());
  });

  test("an ISO 8601 time is the event's", () => {
    const event: NormalizedSecurityEvent = only(
      "CEF:0|Acme|Gateway|1.0|1|Port scan|5|rt=2026-10-30T09:59:58Z src=203.0.113.9",
    );

    expect(event.time.toISOString()).toBe("2026-10-30T09:59:58.000Z");
  });

  test("loopback is never an entity", () => {
    const event: NormalizedSecurityEvent = only(
      "CEF:0|Acme|Gateway|1.0|1|Port scan|5|src=127.0.0.1 dst=192.0.2.1",
    );

    expect(event.principalIp).toBe("");
  });
});

describe("SecurityDeviceLogParser - the whole log parser and its prefilter", () => {
  test.each(
    Object.entries(DEVICE_LINES).filter(([name]: [string, string]): boolean => {
      return ![
        "paloAltoAllow",
        "fortiGateAccept",
        "uniFiClientDisconnected",
        "zscalerLeefAllowed",
      ].includes(name);
    }),
  )(
    "%s passes the prefilter and becomes one event",
    (_name: string, line: string) => {
      expect(matchesSecurityLogPrefilter(line)).toBe(true);

      const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
        logLine(line),
      );

      expect(events).toHaveLength(1);
      expect([SecurityLogFormat.Cef, SecurityLogFormat.Leef]).toContain(
        events[0]!.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE],
      );
    },
  );

  test("a WAF's CEF record of an attack is one event, not a second for the attack string in it", () => {
    expect(
      SecurityLogParser.parse(logLine(DEVICE_LINES.impervaSqlInjection)),
    ).toHaveLength(1);
  });

  test("its words are lowercase, as the case-insensitive match needs", () => {
    for (const word of SECURITY_DEVICE_PREFILTER_WORDS) {
      expect(word).toBe(word.toLowerCase());
    }

    expect(SECURITY_DEVICE_PREFILTER_WORDS.length).toBeLessThan(255);
  });

  test("every marker and action the rules read is a prefilter word", () => {
    for (const word of [
      ...SIGN_IN_MARKERS,
      ...THREAT_MARKERS,
      ...BLOCK_ACTIONS,
      ...DETECT_ACTIONS,
    ]) {
      expect(SECURITY_DEVICE_PREFILTER_WORDS).toContain(word);
    }
  });
});

/*
 * CEF and LEEF arrive from whoever can reach a syslog port: the time to
 * read one must grow in line with it.
 */
describe("SecurityDeviceLogParser - long lines", () => {
  const LENGTH: number = 400000;
  const SHAPES: Array<[string, string]> = [
    ["many threat words", `CEF:0|a|b|c|d|${"attack ".repeat(LENGTH / 7)}|5|`],
    [
      "many action words",
      `CEF:0|a|b|c|d|e|5|act=${"block ".repeat(LENGTH / 6)}`,
    ],
    ["many pairs", `CEF:0|a|b|c|d|e|5|${"k=v ".repeat(LENGTH / 4)}`],
    [
      "a message of sign-in words",
      `CEF:0|a|b|c|d|e|5|msg=${"log in ".repeat(LENGTH / 7)}`,
    ],
    ["LEEF of many parts", `LEEF:2.0|a|b|c|d|^|${"k=v^".repeat(LENGTH / 4)}`],
  ];

  test.each(SHAPES)("%s", (_name: string, line: string) => {
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return SecurityDeviceLogParser.parse(logLine(line)).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
  });
});
