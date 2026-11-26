import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import {
  importedAlertRiskEntities,
  riskFindingsForRuleMatches,
} from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntity } from "../../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import WebAttackLogParser from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { readHiddenClientAddress } from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import {
  TraceScanSpan,
  buildTraceSecurityEvents,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { IPV4_ADDRESS_MASK } from "../../../../Utils/Telemetry/ScrubIpAddress";
import { logLine } from "../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * What reads an event's address, once a scrub rule hid it (#10397): the
 * event names none - principalIp is empty and its observables hold no
 * "[REDACTED]", mask or token - so threat intel never looks one up as an
 * indicator, and entity risk never scores one as an address every hidden
 * event would share. The user who signed in is still looked up and scored.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000e001",
);

const KEYED_TOKEN: string = ScrubHashToken.ofIpAddress({
  projectId: PROJECT_ID,
  address: "203.0.113.7",
});

// The events the scans make of requests whose client address a rule hid.
function hiddenEvents(): Array<NormalizedSecurityEvent> {
  const fromLine: NormalizedSecurityEvent = WebAttackLogParser.parse(
    logLine(
      `${KEYED_TOKEN} - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"`,
    ),
  )[0]!;

  const span: TraceScanSpan = {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "",
    sessionId: "",
    name: "GET /download",
    kind: "SPAN_KIND_SERVER",
    durationMs: 12,
    startTime: new Date("2026-11-20T10:00:00.000Z"),
    serviceId: "0192f1a0-0000-7000-8000-00000000e101",
    serviceType: "OpenTelemetry",
    isLlmSpan: false,
    llmUserMessagePreview: "",
    llmUserId: "",
    llmSystem: "",
    llmRequestModel: "",
    llmOperation: "",
    attributes: {
      "url.path": "/download",
      "url.query": "file=../../../../etc/passwd",
      "network.peer.address": IPV4_ADDRESS_MASK,
      "client.address": IPV4_ADDRESS_MASK,
      "enduser.id": "user-42",
    },
  };
  const fromSpan: NormalizedSecurityEvent = buildTraceSecurityEvents(span)[0]!;

  for (const event of [fromLine, fromSpan]) {
    expect(readHiddenClientAddress(event)).not.toBeNull();
  }

  return [fromLine, fromSpan];
}

describe("threat intel", () => {
  beforeEach(() => {
    ThreatIntelEnricher.clearCaches();
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    ThreatIntelEnricher.clearCaches();
  });

  test("never looks up what a scrub rule left as an indicator, and still looks up who signed in", async () => {
    jest
      .spyOn(ThreatIntelIndicatorService, "hasIndicatorsForProject")
      .mockResolvedValue(true as never);
    const lookup: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
      .mockResolvedValue([] as never);

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: hiddenEvents(),
    });

    const looked: Array<string> = lookup.mock.calls.flatMap(
      (call: Array<unknown>): Array<string> => {
        return (call[0] as { values: Array<string> }).values;
      },
    );

    expect(looked).toEqual(["user-42"]);
    expect(looked).not.toContain(KEYED_TOKEN);
    expect(looked).not.toContain("[redacted]");
    expect(looked).not.toContain(IPV4_ADDRESS_MASK);
  });

  test("a page whose only event is a hidden address with nobody signed in asks threat intel nothing", async () => {
    jest
      .spyOn(ThreatIntelIndicatorService, "hasIndicatorsForProject")
      .mockResolvedValue(true as never);
    const lookup: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
      .mockResolvedValue([] as never);

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: [hiddenEvents()[0]!],
    });

    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("entity risk", () => {
  test("scores no address for an event whose address a scrub rule hid", () => {
    const [fromLine, fromSpan] = hiddenEvents();

    expect(importedAlertRiskEntities(fromLine!)).toEqual([]);
    expect(
      importedAlertRiskEntities(fromSpan!).map(
        (entity: SecurityEntity): string => {
          return entity.value;
        },
      ),
    ).toEqual(["user-42"]);
  });

  test("a rule grouped by address finds nobody to score in the events whose address was hidden", () => {
    const rule: DetectionRule = new DetectionRule();
    rule.id = new ObjectID("0192f1a0-0000-7000-8000-00000000e201");
    rule.projectId = PROJECT_ID;
    rule.name = "Path traversal attempts";
    rule.groupByField = "principalIp";

    const findingsFor: (groupValue: string) => Array<unknown> = (
      groupValue: string,
    ): Array<unknown> => {
      return riskFindingsForRuleMatches({
        rule,
        parsedRule: {
          title: "Path traversal attempts",
          level: "medium",
          mitreTactics: [],
          mitreTechniques: [],
        } as never,
        matchedGroups: [{ groupValue, count: 12 } as never],
        seenAt: new Date("2026-11-20T10:05:00.000Z"),
      });
    };

    // An address the events named is scored ...
    expect(findingsFor("203.0.113.7")).toHaveLength(1);
    // ... the group every event with no address falls in is nobody.
    expect(findingsFor("")).toEqual([]);
  });
});
