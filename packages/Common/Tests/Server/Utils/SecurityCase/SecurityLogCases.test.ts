import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityLogCases, {
  LOG_THREATS_PER_SCAN_LIMIT,
  SECURITY_DEVICE_LOG_FORMATS,
  SecurityLogThreatsResult,
  getLogThreatProductName,
  isSecurityDeviceThreat,
  logThreatMarkdown,
  logThreatSignal,
} from "../../../../Server/Utils/SecurityCase/SecurityLogCases";
import SecurityEntityRiskRecorder from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import {
  IMPORTED_ALERT_RISK_LIMIT,
  SecurityRiskFinding,
  riskFindingsForLogThreats,
} from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { getJestSpyOn } from "../../../Spy";
import {
  ASA_LINES,
  FORTIGATE_LINES,
  PAN_LINES,
} from "../../../Utils/SecurityEvent/LogParsers/FirewallFixtures";
import {
  SSH_LINES,
  SUDO_LINES,
  WEB_LINES,
  logLine,
} from "../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";
import { DEVICE_LINES } from "../../../Utils/SecurityEvent/LogParsers/SecurityDeviceFixtures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a security product wrote in the logs opens a case, as its alert
 * through a connection does: the threats Your logs reads in a firewall's,
 * an IDS's or an endpoint product's CEF, LEEF or own syslog, at or above
 * Your logs' Open Cases From Severity, become detections; every one of them
 * adds to the risk of who it names; a sign-in, a blocked connection or any
 * other kind of log stays an event.
 *
 * The events are the parsers' own, read from each vendor's documented lines.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4c0a1e55-0000-4000-8000-0000000000c5",
);

let nextLogId: number = 0;

// Each line read as its own log record, as a scan reads it.
function read(body: string): Array<NormalizedSecurityEvent> {
  nextLogId++;

  return SecurityLogParser.parse(
    logLine(
      body,
      { "host.name": "fw-01" },
      `0192f1a0-0000-7000-8000-${String(nextLogId).padStart(12, "0")}`,
    ),
  );
}

function readOne(body: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = read(body);

  expect(events).toHaveLength(1);

  return events[0]!;
}

function formatOf(event: NormalizedSecurityEvent): string {
  return String(event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] || "");
}

// The threats in the fixtures, by line: the ones a product found.
const THREAT_LINES: Record<string, string> = {
  cefPaloAltoThreat: DEVICE_LINES.paloAltoThreat,
  cefFortiGateIps: DEVICE_LINES.fortiGateIps,
  cefImpervaSqlInjection: DEVICE_LINES.impervaSqlInjection,
  cefCrowdStrike: DEVICE_LINES.crowdStrikeDetection,
  cefTrendMicro: DEVICE_LINES.trendMicroMalware,
  cefHighSeverityAlone: DEVICE_LINES.highSeverityAlone,
  leefZscalerBlocked: DEVICE_LINES.zscalerLeefBlocked,
  leefQradar: DEVICE_LINES.qradarLeef2,
  panVulnerability: PAN_LINES.threatVulnerability,
  panSpyware: PAN_LINES.threatSpyware,
  panVirus: PAN_LINES.threatVirus,
  panWildfire: PAN_LINES.threatWildfireMalicious,
  panFileBlocked: PAN_LINES.threatFileBlocked,
  fortiGateIps: FORTIGATE_LINES.ips,
  fortiGateVirus: FORTIGATE_LINES.virus,
  fortiGateAnomaly: FORTIGATE_LINES.anomaly,
  fortiGateOlderIps: FORTIGATE_LINES.olderIps,
  asaScanning: ASA_LINES.scanning,
  asaAttackingHost: ASA_LINES.attackingHost,
  asaShunned: ASA_LINES.shunned,
  asaIps: ASA_LINES.ips,
  asaBotnet: ASA_LINES.botnet,
};

// What the same products recorded that is no finding of theirs.
const RECORD_LINES: Record<string, string> = {
  cefPaloAltoDeny: DEVICE_LINES.paloAltoDeny,
  cefFortiGateAdminLoginFailed: DEVICE_LINES.fortiGateAdminLoginFailed,
  cefCheckPointDrop: DEVICE_LINES.checkPointDrop,
  cefMikroTikLoginFailure: DEVICE_LINES.mikroTikLoginFailure,
  cefVpnLoginSucceeded: DEVICE_LINES.vpnLoginSucceeded,
  leefPaloAltoDeny: DEVICE_LINES.paloAltoLeefDeny,
  panTrafficDeny: PAN_LINES.trafficDeny,
  panUrlBlocked: PAN_LINES.threatUrlBlocked,
  panGlobalProtectFailed: PAN_LINES.globalProtectFailed,
  panSystemAuthFail: PAN_LINES.systemAuthFail,
  panConfigSet: PAN_LINES.configSet,
  fortiGateWebfilterBlocked: FORTIGATE_LINES.webfilterBlocked,
  fortiGateTrafficDeny: FORTIGATE_LINES.trafficDeny,
  fortiGateAdminLoginFailed: FORTIGATE_LINES.adminLoginFailed,
  fortiGateConfigChanged: FORTIGATE_LINES.configChanged,
  asaAclDeny: ASA_LINES.aclDeny,
  asaSpoof: ASA_LINES.spoof,
  asaAaaRejected: ASA_LINES.aaaRejected,
  asaCommandExecuted: ASA_LINES.commandExecuted,
  asaPrivilegeChanged: ASA_LINES.privilegeChanged,
};

// The other kinds Your logs reads: a system's own records, never a product's verdict.
const SYSTEM_LINES: Record<string, string> = {
  sshFailed: SSH_LINES.failedPasswordInvalidUser,
  sudo: SUDO_LINES.commandRun,
  webAttack: WEB_LINES.sqlInjectionEncoded,
};

function threat(
  overrides: Partial<NormalizedSecurityEvent> = {},
): NormalizedSecurityEvent {
  return {
    ...readOne(PAN_LINES.threatVulnerability),
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityLogCases - which events are a security product's threats", () => {
  test("the Security devices kinds are the ones whose records are a product's own", () => {
    expect([...SECURITY_DEVICE_LOG_FORMATS].sort()).toEqual(
      [
        SecurityLogFormat.Cef,
        SecurityLogFormat.Leef,
        SecurityLogFormat.PaloAlto,
        SecurityLogFormat.FortiGate,
        SecurityLogFormat.CiscoAsa,
      ].sort(),
    );
  });

  test.each(Object.entries(THREAT_LINES))(
    "%s is a threat a product found",
    (_name: string, line: string) => {
      const event: NormalizedSecurityEvent = readOne(line);

      expect(event.classUid).toBe(2004);
      expect(SECURITY_DEVICE_LOG_FORMATS).toContain(formatOf(event));
      expect(isSecurityDeviceThreat(event)).toBe(true);
    },
  );

  test.each(Object.entries(RECORD_LINES))(
    "%s is the product recording what happened, and stays an event",
    (_name: string, line: string) => {
      for (const event of read(line)) {
        expect(SECURITY_DEVICE_LOG_FORMATS).toContain(formatOf(event));
        expect(isSecurityDeviceThreat(event)).toBe(false);
      }
    },
  );

  test.each(Object.entries(SYSTEM_LINES))(
    "%s is a system's own record, never a product's threat",
    (_name: string, line: string) => {
      const events: Array<NormalizedSecurityEvent> = read(line);

      expect(events.length).toBeGreaterThan(0);

      for (const event of events) {
        expect(isSecurityDeviceThreat(event)).toBe(false);
        // Even were it a finding: its kind is not a security product's.
        expect(isSecurityDeviceThreat({ ...event, classUid: 2004 })).toBe(
          false,
        );
      }
    },
  );

  test("a finding of a kind no parser stamped, or with no id to be one detection by, is none", () => {
    expect(isSecurityDeviceThreat(threat({ attributes: {} }))).toBe(false);
    expect(isSecurityDeviceThreat(threat({ eventUid: "" }))).toBe(false);
    // An Incident Finding is an alert too, as a connection's is.
    expect(isSecurityDeviceThreat(threat({ classUid: 2005 }))).toBe(true);
  });
});

describe("SecurityLogCases - a threat as a detection", () => {
  test("is the product's, about the entity it names, once per record", () => {
    const event: NormalizedSecurityEvent = readOne(PAN_LINES.threatSpyware);
    const signal: SecurityDetectionSignal = logThreatSignal({
      projectId: PROJECT_ID,
      event,
    });

    expect(signal).toMatchObject({
      projectId: PROJECT_ID,
      source: SecurityDetectionSource.ConnectedProduct,
      fingerprint: `logs:${event.eventUid}`,
      title: "Cobalt Strike Beacon C2 — corp\\alice",
      severity: OcsfSeverity.High,
      eventCount: 1,
      groupValue: "corp\\alice",
      ruleName: "Cobalt Strike Beacon C2",
      eventUid: event.eventUid,
      seenAt: event.time,
    });
    // No connection brought it: nothing to close back in a product.
    expect(signal.securityEventConnectionId).toBeUndefined();
    expect(signal.entities).toEqual(
      expect.arrayContaining([
        { type: SecurityEntityType.User, value: "corp\\alice" },
        { type: SecurityEntityType.IpAddress, value: "192.0.2.10" },
        { type: SecurityEntityType.IpAddress, value: "203.0.113.50" },
      ]),
    );
    // PAN-OS names the record itself: the same threat read again is the same detection.
    expect(event.eventUid).toBe("panos:012801000000:THREAT:7000001235");
    expect(
      logThreatSignal({
        projectId: PROJECT_ID,
        event: readOne(PAN_LINES.threatSpyware),
      }).fingerprint,
    ).toBe(signal.fingerprint);
  });

  test("a threat that names its group already is not named twice", () => {
    const signal: SecurityDetectionSignal = logThreatSignal({
      projectId: PROJECT_ID,
      event: threat({
        ruleName: "Brute force on gw-01",
        principalHost: "gw-01",
      }),
    });

    expect(signal.title).toBe("Brute force on gw-01");
  });

  test("names the product as the line does, or by its kind when the line names none", () => {
    expect(getLogThreatProductName(readOne(FORTIGATE_LINES.ips))).toBe(
      "Fortinet FortiGate",
    );
    // A product named after its vendor is not named twice.
    expect(getLogThreatProductName(readOne(ASA_LINES.botnet))).toBe(
      "Cisco ASA",
    );
    expect(
      getLogThreatProductName(readOne(DEVICE_LINES.impervaSqlInjection)),
    ).toBe("Imperva Inc. SecureSphere");
    expect(
      getLogThreatProductName(threat({ vendorName: "", productName: "" })),
    ).toBe("Palo Alto Networks");
    expect(
      getLogThreatProductName(
        threat({ vendorName: " ", productName: "", attributes: {} }),
      ),
    ).toBe("Security product");
  });

  test("says what found it, where and which rule, with the line's words as code", () => {
    const event: NormalizedSecurityEvent = readOne(FORTIGATE_LINES.ips);
    const markdown: string = logThreatMarkdown(event).toString();

    // The product's own syslog: its name says the kind of log already.
    expect(markdown.split("\n\n")[0]).toBe(
      "A threat reported by **Fortinet FortiGate** in the project's logs, read by **Your logs**.",
    );
    expect(markdown).not.toContain("(Fortinet FortiGate)");
    expect(markdown).toContain(
      "`Apache.Log4j.Error.Log.Remote.Code.Execution`",
    );

    // Markdown in a line is shown, never followed.
    const crafted: string = logThreatMarkdown(
      threat({ ruleName: "[click](https://evil.example)", message: "" }),
    ).toString();

    expect(crafted).toContain("Rule: `[click](https://evil.example)`");
  });

  test("names the kind of log only where the product's name does not say it", () => {
    const firstLine: (event: NormalizedSecurityEvent) => string = (
      event: NormalizedSecurityEvent,
    ): string => {
      return logThreatMarkdown(event).toString().split("\n\n")[0] || "";
    };

    // A product's CEF: the kind is news.
    expect(firstLine(readOne(DEVICE_LINES.impervaSqlInjection))).toContain(
      "in the project's logs (CEF), read by **Your logs**.",
    );
    // A firewall's own syslog: its name is the kind already.
    for (const event of [
      readOne(PAN_LINES.threatSpyware),
      readOne(ASA_LINES.botnet),
      threat({ vendorName: "", productName: "" }),
    ]) {
      expect(firstLine(event)).toMatch(
        /^A threat reported by \*\*[^*]+\*\* in the project's logs, read by \*\*Your logs\*\*\.$/,
      );
    }
  });
});

describe("SecurityLogCases.recordThreats", () => {
  let signals: Array<SecurityDetectionSignal>;
  let risks: Array<SecurityRiskFinding>;
  let order: Array<string>;

  beforeEach(() => {
    signals = [];
    risks = [];
    order = [];

    getJestSpyOn(SecurityCaseIngest, "recordDetections").mockImplementation(
      (async (sent: Array<SecurityDetectionSignal>) => {
        order.push("cases");
        signals.push(...sent);
        return {
          casesOpened: sent.length,
          detectionsAdded: sent.length,
          detectionsRepeated: 0,
        };
      }) as never,
    );
    getJestSpyOn(SecurityEntityRiskRecorder, "record").mockImplementation(
      (async (findings: Array<SecurityRiskFinding>) => {
        order.push("risk");
        risks.push(...findings);
        return { entitiesUpdated: findings.length, riskCasesRaised: 0 };
      }) as never,
    );
  });

  function scanEvents(): Array<NormalizedSecurityEvent> {
    return [
      ...Object.values(THREAT_LINES),
      ...Object.values(RECORD_LINES),
      ...Object.values(SYSTEM_LINES),
    ].flatMap(read);
  }

  test("High, the default: the High and Critical threats open cases, and nothing else does", async () => {
    const events: Array<NormalizedSecurityEvent> = scanEvents();
    const result: SecurityLogThreatsResult =
      await SecurityLogCases.recordThreats({
        projectId: PROJECT_ID,
        caseMinimumSeverity: "High",
        events,
      });

    const expected: Array<NormalizedSecurityEvent> = events.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return (
          isSecurityDeviceThreat(event) &&
          (event.severityName === OcsfSeverity.High ||
            event.severityName === OcsfSeverity.Critical)
        );
      },
    );

    expect(expected.length).toBeGreaterThanOrEqual(8);
    expect(
      signals.map((signal: SecurityDetectionSignal) => {
        return signal.eventUid;
      }),
    ).toEqual(
      expected.map((event: NormalizedSecurityEvent) => {
        return event.eventUid;
      }),
    );
    expect(result).toEqual({
      casesOpened: expected.length,
      detections: expected.length,
    });

    // Each kind's own threats are among them: CEF, LEEF and each firewall's syslog.
    expect(
      new Set(
        expected.map((event: NormalizedSecurityEvent) => {
          return formatOf(event);
        }),
      ),
    ).toEqual(
      new Set([
        SecurityLogFormat.Cef,
        SecurityLogFormat.Leef,
        SecurityLogFormat.PaloAlto,
        SecurityLogFormat.FortiGate,
        SecurityLogFormat.CiscoAsa,
      ]),
    );

    for (const signal of signals) {
      expect(signal.source).toBe(SecurityDetectionSource.ConnectedProduct);
      expect(signal.fingerprint).toBe(`logs:${signal.eventUid}`);
    }
  });

  test.each([
    ["Critical", [OcsfSeverity.Critical]],
    ["Medium", [OcsfSeverity.Medium, OcsfSeverity.High, OcsfSeverity.Critical]],
    [
      "low",
      [
        OcsfSeverity.Low,
        OcsfSeverity.Medium,
        OcsfSeverity.High,
        OcsfSeverity.Critical,
      ],
    ],
  ])(
    "from %s, the threats at or above it",
    async (minimum: string, severities: Array<OcsfSeverity>) => {
      const events: Array<NormalizedSecurityEvent> = scanEvents();

      await SecurityLogCases.recordThreats({
        projectId: PROJECT_ID,
        caseMinimumSeverity: minimum,
        events,
      });

      const expected: number = events.filter(
        (event: NormalizedSecurityEvent): boolean => {
          return (
            isSecurityDeviceThreat(event) &&
            severities.includes(event.severityName)
          );
        },
      ).length;

      expect(expected).toBeGreaterThan(0);
      expect(signals).toHaveLength(expected);

      for (const signal of signals) {
        expect(severities).toContain(signal.severity);
      }
    },
  );

  test.each([
    ["empty", ""],
    ["unset", null],
    ["a severity no one has", "whenever"],
  ])(
    "%s opens none, and every threat still adds risk",
    async (_name: string, minimum: string | null) => {
      const events: Array<NormalizedSecurityEvent> = scanEvents();
      const result: SecurityLogThreatsResult =
        await SecurityLogCases.recordThreats({
          projectId: PROJECT_ID,
          caseMinimumSeverity: minimum,
          events,
        });

      expect(SecurityCaseIngest.recordDetections).not.toHaveBeenCalled();
      expect(result).toEqual({ casesOpened: 0, detections: 0 });
      expect(order).toEqual(["risk"]);
      expect(risks.length).toBeGreaterThan(0);
    },
  );

  test("every threat adds risk, below the threshold too, after the cases", async () => {
    const low: NormalizedSecurityEvent = readOne(PAN_LINES.threatFileBlocked);
    const critical: NormalizedSecurityEvent = readOne(
      PAN_LINES.threatVulnerability,
    );

    expect(low.severityName).toBe(OcsfSeverity.Low);

    await SecurityLogCases.recordThreats({
      projectId: PROJECT_ID,
      caseMinimumSeverity: "High",
      events: [low, critical],
    });

    expect(order).toEqual(["cases", "risk"]);
    expect(signals).toHaveLength(1);
    expect(
      risks.map((finding: SecurityRiskFinding) => {
        return finding.severity;
      }),
    ).toEqual([OcsfSeverity.Critical, OcsfSeverity.Low]);
  });

  test("a scan with no threat opens nothing and adds no risk", async () => {
    const result: SecurityLogThreatsResult =
      await SecurityLogCases.recordThreats({
        projectId: PROJECT_ID,
        caseMinimumSeverity: "Low",
        events: [
          ...Object.values(RECORD_LINES),
          ...Object.values(SYSTEM_LINES),
        ].flatMap(read),
      });

    expect(result).toEqual({ casesOpened: 0, detections: 0 });
    expect(order).toEqual([]);
  });

  test("sends at most the scan's limit, the rest still adding risk", async () => {
    const many: Array<NormalizedSecurityEvent> = [];

    for (
      let index: number = 0;
      index < LOG_THREATS_PER_SCAN_LIMIT + 50;
      index++
    ) {
      many.push(
        threat({
          eventUid: `panos:012801000000:THREAT:${9000000 + index}`,
          principalIp: `203.0.113.${index % 250}`,
        }),
      );
    }

    const full: SecurityLogThreatsResult = await SecurityLogCases.recordThreats(
      { projectId: PROJECT_ID, caseMinimumSeverity: "High", events: many },
    );

    expect(full.detections).toBe(LOG_THREATS_PER_SCAN_LIMIT);
    expect(signals).toHaveLength(LOG_THREATS_PER_SCAN_LIMIT);

    signals = [];

    const rest: SecurityLogThreatsResult = await SecurityLogCases.recordThreats(
      {
        projectId: PROJECT_ID,
        caseMinimumSeverity: "High",
        events: many,
        limit: 3,
      },
    );

    expect(rest.detections).toBe(3);
    expect(signals).toHaveLength(3);

    signals = [];
    order = [];

    const spent: SecurityLogThreatsResult =
      await SecurityLogCases.recordThreats({
        projectId: PROJECT_ID,
        caseMinimumSeverity: "High",
        events: many,
        limit: 0,
      });

    expect(spent).toEqual({ casesOpened: 0, detections: 0 });
    expect(order).toEqual(["risk"]);
  });

  test("never fails the scan that stored the events", async () => {
    const errors: Array<unknown> = [];

    getJestSpyOn(logger, "error").mockImplementation(((value: unknown) => {
      errors.push(value);
    }) as never);
    getJestSpyOn(SecurityCaseIngest, "recordDetections").mockRejectedValue(
      new Error("queue unavailable") as never,
    );

    await expect(
      SecurityLogCases.recordThreats({
        projectId: PROJECT_ID,
        caseMinimumSeverity: "High",
        events: [threat()],
      }),
    ).resolves.toEqual({ casesOpened: 0, detections: 0 });
    expect(String(errors[0])).toContain(PROJECT_ID.toString());

    // Cases opened before the risk failed are still counted.
    getJestSpyOn(SecurityCaseIngest, "recordDetections").mockResolvedValue({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    } as never);
    getJestSpyOn(SecurityEntityRiskRecorder, "record").mockRejectedValue(
      new Error("risk unavailable") as never,
    );

    await expect(
      SecurityLogCases.recordThreats({
        projectId: PROJECT_ID,
        caseMinimumSeverity: "High",
        events: [threat()],
      }),
    ).resolves.toEqual({ casesOpened: 1, detections: 1 });
  });
});

describe("riskFindingsForLogThreats", () => {
  test("each product's rule is a source of its own, the most severe first", () => {
    const findings: Array<SecurityRiskFinding> = riskFindingsForLogThreats({
      projectId: PROJECT_ID,
      threats: [
        readOne(FORTIGATE_LINES.virus),
        readOne(PAN_LINES.threatVulnerability),
        readOne(PAN_LINES.threatSpyware),
      ],
      getProductName: getLogThreatProductName,
    });

    expect(
      findings.map((finding: SecurityRiskFinding) => {
        return [
          finding.severity,
          finding.points,
          finding.sourceKey,
          finding.sourceName,
        ];
      }),
    ).toEqual([
      [
        OcsfSeverity.Critical,
        75,
        "logs:palo alto networks pan-os:apache log4j remote code execution vulnerability",
        "Apache Log4j Remote Code Execution Vulnerability (Palo Alto Networks PAN-OS)",
      ],
      [
        OcsfSeverity.High,
        50,
        "logs:palo alto networks pan-os:cobalt strike beacon c2",
        "Cobalt Strike Beacon C2 (Palo Alto Networks PAN-OS)",
      ],
      [
        OcsfSeverity.Medium,
        25,
        "logs:fortinet fortigate:w32/agent.abc!tr",
        "W32/Agent.ABC!tr (Fortinet FortiGate)",
      ],
    ]);

    for (const finding of findings) {
      expect(finding.projectId).toBe(PROJECT_ID);
      expect(finding.source).toBe(SecurityDetectionSource.ConnectedProduct);
      expect(finding.securityEventConnectionId).toBeUndefined();
    }
  });

  test("adds to who acted - the user, else the address - never every address named", () => {
    const [spyware, vulnerability] = riskFindingsForLogThreats({
      projectId: PROJECT_ID,
      threats: [
        readOne(PAN_LINES.threatSpyware),
        readOne(PAN_LINES.threatVulnerability),
      ],
      getProductName: getLogThreatProductName,
    }).sort((a: SecurityRiskFinding, b: SecurityRiskFinding) => {
      return a.points - b.points;
    });

    expect(spyware!.entities).toEqual([
      { type: SecurityEntityType.User, value: "corp\\alice" },
    ]);
    expect(vulnerability!.entities).toEqual([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ]);
  });

  test("a threat that names no one, or is worth no points, adds nothing", () => {
    expect(
      riskFindingsForLogThreats({
        projectId: PROJECT_ID,
        threats: [
          threat({
            principalUser: "",
            principalHost: "",
            principalIp: "",
            targetUser: "",
            targetHost: "",
            targetIp: "",
          }),
          threat({ severityName: OcsfSeverity.Informational }),
        ],
        getProductName: getLogThreatProductName,
      }),
    ).toEqual([]);
  });

  test("reads at most the most severe IMPORTED_ALERT_RISK_LIMIT of a scan", () => {
    const many: Array<NormalizedSecurityEvent> = [];

    for (
      let index: number = 0;
      index < IMPORTED_ALERT_RISK_LIMIT + 20;
      index++
    ) {
      many.push(
        threat({
          severityName: index < 20 ? OcsfSeverity.Critical : OcsfSeverity.Low,
          principalIp: `198.51.100.${index % 250}`,
        }),
      );
    }

    many.reverse();

    const findings: Array<SecurityRiskFinding> = riskFindingsForLogThreats({
      projectId: PROJECT_ID,
      threats: many,
      getProductName: getLogThreatProductName,
    });

    expect(findings).toHaveLength(IMPORTED_ALERT_RISK_LIMIT);
    expect(
      findings.slice(0, 20).every((finding: SecurityRiskFinding) => {
        return finding.severity === OcsfSeverity.Critical;
      }),
    ).toBe(true);
  });
});
