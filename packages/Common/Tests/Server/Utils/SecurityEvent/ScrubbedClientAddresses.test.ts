import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import LogScrubRuleService from "../../../../Server/Services/LogScrubRuleService";
import { TelemetryServiceMetadata } from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import SpanService from "../../../../Server/Services/SpanService";
import TraceScrubRuleService from "../../../../Server/Services/TraceScrubRuleService";
import logger from "../../../../Server/Utils/Logger";
import OpenStackAuditJoin from "../../../../Server/Utils/SecurityEvent/LogScan/OpenStackAuditJoin";
import SecurityLogScanner from "../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import RealTimeDetections from "../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityRequestTrace from "../../../../Server/Utils/SecurityEvent/RequestTrace/SecurityRequestTrace";
import ScrubbedClientAddresses, {
  ADDRESS_SCRUB_RULES_CACHE_TTL_MS,
} from "../../../../Server/Utils/SecurityEvent/ScrubbedClientAddresses";
import { TelemetryScanWindow } from "../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import { TelemetryWindowRead } from "../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanTypes";
import TraceSecurityScan from "../../../../Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import TraceScrubField from "../../../../Types/Trace/TraceScrubField";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import WebAttackLogParser from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  AddressScrubRule,
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  markClientAddressScrubbed,
  readHiddenClientAddress,
} from "../../../../Utils/SecurityEvent/ScrubbedAddress";
import { IPV4_ADDRESS_MASK as SCRUB_IPV4_MASK } from "../../../../Utils/Telemetry/ScrubIpAddress";
import { logLine } from "../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * Which of a project's scrub rules hid an event's client address (#10397):
 * read before a page's events are stored, from the project's enabled IP
 * Address rules of the record's kind - in the order ingest runs them, as
 * OneUptime, a minute at a time - and written on each event the rule
 * explains. An event no rule explains still says a scrub rule hid its
 * address. A read that fails leaves the events as the scan marked them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000d001",
);

const LOG_RULE_ID: string = "0192f1a0-0000-7000-8000-00000000d101";
const TRACE_RULE_ID: string = "0192f1a0-0000-7000-8000-00000000d201";

function logRule(
  overrides: Partial<{
    id: string;
    name: string;
    scrubAction: string;
    fieldsToScrub: string;
  }> = {},
): LogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.id = new ObjectID(overrides.id || LOG_RULE_ID);
  rule.name = overrides.name ?? "Scrub IP addresses";
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = overrides.scrubAction ?? LogScrubAction.Redact;
  rule.fieldsToScrub = overrides.fieldsToScrub ?? LogScrubField.Both;
  return rule;
}

function traceRule(
  overrides: Partial<{ scrubAction: string; fieldsToScrub: string }> = {},
): TraceScrubRule {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.id = new ObjectID(TRACE_RULE_ID);
  rule.name = "Scrub IP addresses in spans";
  rule.patternType = LogScrubPatternType.IPAddress;
  rule.scrubAction = overrides.scrubAction ?? LogScrubAction.Mask;
  rule.fieldsToScrub = overrides.fieldsToScrub ?? TraceScrubField.All;
  return rule;
}

// A web attack event whose client address a rule hid, as a scan marks one.
function hiddenEvent(
  place: ScrubbedAddressPlace,
  value: string = "[REDACTED]",
): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(
    logLine("WARN rejected /static/../../etc/passwd"),
  );
  const event: NormalizedSecurityEvent = events[0]!;

  markClientAddressScrubbed(event.attributes, {
    scrubbed:
      value === SCRUB_IPV4_MASK
        ? { kind: ScrubbedAddressKind.Masked, value }
        : { kind: ScrubbedAddressKind.Redacted, value },
    place,
  });

  return event;
}

describe("ScrubbedClientAddresses.getAddressScrubRules", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the project's enabled IP Address rules, in the order ingest runs them, with the props it is given", async () => {
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([
        logRule(),
        logRule({ id: "0192f1a0-0000-7000-8000-00000000d102", name: "" }),
      ] as never);

    const rules: Array<AddressScrubRule> =
      await ScrubbedClientAddresses.getAddressScrubRules({
        projectId: PROJECT_ID,
        signal: "log",
        props: { isRoot: true },
      });

    expect(rules).toEqual([
      {
        id: LOG_RULE_ID,
        name: "Scrub IP addresses",
        patternType: LogScrubPatternType.IPAddress,
        scrubAction: LogScrubAction.Redact,
        fieldsToScrub: LogScrubField.Both,
      },
      expect.objectContaining({
        id: "0192f1a0-0000-7000-8000-00000000d102",
        name: "",
      }),
    ]);

    const query: JSONObject = find.mock.calls[0]![0] as JSONObject;

    expect(query).toEqual(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          isEnabled: true,
          patternType: LogScrubPatternType.IPAddress,
        },
        sort: { sortOrder: SortOrder.Ascending },
        props: { isRoot: true },
      }),
    );
    expect(query["select"]).toEqual(
      expect.objectContaining({
        _id: true,
        name: true,
        patternType: true,
        scrubAction: true,
        fieldsToScrub: true,
      }),
    );
  });

  test("a trace's rules are the trace scrub rules", async () => {
    const logs: ReturnType<typeof jest.spyOn> = jest.spyOn(
      LogScrubRuleService,
      "findBy",
    );
    jest
      .spyOn(TraceScrubRuleService, "findBy")
      .mockResolvedValue([traceRule()] as never);

    const rules: Array<AddressScrubRule> =
      await ScrubbedClientAddresses.getAddressScrubRules({
        projectId: PROJECT_ID,
        signal: "trace",
        props: { isRoot: true },
      });

    expect(
      rules.map((rule: AddressScrubRule): string => {
        return rule.id;
      }),
    ).toEqual([TRACE_RULE_ID]);
    expect(logs).not.toHaveBeenCalled();
  });
});

describe("ScrubbedClientAddresses.nameScrubRules", () => {
  beforeEach(() => {
    ScrubbedClientAddresses.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    ScrubbedClientAddresses.clearCache();
  });

  test("names the rule of the record's kind that explains each event, as OneUptime reads it", async () => {
    const logs: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([logRule()] as never);
    const traces: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TraceScrubRuleService, "findBy")
      .mockResolvedValue([traceRule()] as never);

    const fromLine: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressPlace.LogBody,
    );
    const fromSpan: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressPlace.SpanAttributes,
      SCRUB_IPV4_MASK,
    );

    await ScrubbedClientAddresses.nameScrubRules({
      projectId: PROJECT_ID,
      events: [fromLine, fromSpan],
    });

    expect(readHiddenClientAddress(fromLine)).toEqual(
      expect.objectContaining({
        ruleId: LOG_RULE_ID,
        ruleName: "Scrub IP addresses",
      }),
    );
    expect(readHiddenClientAddress(fromSpan)).toEqual(
      expect.objectContaining({
        ruleId: TRACE_RULE_ID,
        ruleName: "Scrub IP addresses in spans",
      }),
    );
    expect((logs.mock.calls[0]![0] as { props: JSONObject }).props).toEqual({
      isRoot: true,
    });
    expect((traces.mock.calls[0]![0] as { props: JSONObject }).props).toEqual({
      isRoot: true,
    });
  });

  test("names none where no enabled rule leaves what the record holds, and says it is hidden still", async () => {
    jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([
        logRule({ scrubAction: LogScrubAction.Hash }),
        logRule({ fieldsToScrub: LogScrubField.Body }),
      ] as never);

    const event: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressPlace.LogAttributes,
    );

    await ScrubbedClientAddresses.nameScrubRules({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(readHiddenClientAddress(event)).toEqual({
      kind: ScrubbedAddressKind.Redacted,
      value: "[REDACTED]",
      place: ScrubbedAddressPlace.LogAttributes,
      signal: "log",
      ruleId: "",
      ruleName: "",
    } as HiddenClientAddress);
  });

  test("reads nothing for a page none of whose addresses a rule hid, and only the kind of rules it needs", async () => {
    const logs: ReturnType<typeof jest.spyOn> = jest.spyOn(
      LogScrubRuleService,
      "findBy",
    );
    const traces: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TraceScrubRuleService, "findBy")
      .mockResolvedValue([] as never);
    const plain: NormalizedSecurityEvent = WebAttackLogParser.parse(
      logLine(
        '203.0.113.41 - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
      ),
    )[0]!;

    await ScrubbedClientAddresses.nameScrubRules({
      projectId: PROJECT_ID,
      events: [plain],
    });

    expect(logs).not.toHaveBeenCalled();
    expect(traces).not.toHaveBeenCalled();

    await ScrubbedClientAddresses.nameScrubRules({
      projectId: PROJECT_ID,
      events: [plain, hiddenEvent(ScrubbedAddressPlace.SpanAttributes)],
    });

    expect(logs).not.toHaveBeenCalled();
    expect(traces).toHaveBeenCalledTimes(1);
  });

  test("reads a project's rules once a minute, as ingest does", async () => {
    const logs: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([logRule()] as never);

    for (let page: number = 0; page < 3; page++) {
      await ScrubbedClientAddresses.nameScrubRules({
        projectId: PROJECT_ID,
        events: [hiddenEvent(ScrubbedAddressPlace.LogBody)],
      });
    }

    expect(logs).toHaveBeenCalledTimes(1);
    expect(ADDRESS_SCRUB_RULES_CACHE_TTL_MS).toBe(60 * 1000);

    // Another project's are its own.
    await ScrubbedClientAddresses.nameScrubRules({
      projectId: new ObjectID("0192f1a0-0000-7000-8000-00000000d002"),
      events: [hiddenEvent(ScrubbedAddressPlace.LogBody)],
    });

    expect(logs).toHaveBeenCalledTimes(2);
  });

  test("a read that fails leaves the events as the scan marked them", async () => {
    jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockRejectedValue(new Error("down"));
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const event: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressPlace.LogBody,
    );

    await expect(
      ScrubbedClientAddresses.nameScrubRules({
        projectId: PROJECT_ID,
        events: [event],
      }),
    ).resolves.toBeUndefined();

    expect(readHiddenClientAddress(event)).toEqual(
      expect.objectContaining({ ruleId: "", value: "[REDACTED]" }),
    );
    expect(warn).toHaveBeenCalled();
  });

  test("an event that names its address, or carries no place, is no event to name a rule for", async () => {
    const logs: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([logRule()] as never);
    const named: NormalizedSecurityEvent = hiddenEvent(
      ScrubbedAddressPlace.LogBody,
    );
    named.principalIp = "203.0.113.7";

    await ScrubbedClientAddresses.nameScrubRules({
      projectId: PROJECT_ID,
      events: [named],
    });

    expect(logs).not.toHaveBeenCalled();
  });
});

const WINDOW: TelemetryScanWindow = {
  projectId: PROJECT_ID,
  arrivedAfter: new Date("2026-11-20T10:00:00.000Z"),
  arrivedUntil: new Date("2026-11-20T10:05:00.000Z"),
  happenedAfter: new Date("2026-11-20T09:00:00.000Z"),
};

function answer(rows: Array<JSONObject>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

describe("both scans name the rule before a page is stored", () => {
  beforeEach(() => {
    ScrubbedClientAddresses.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    ScrubbedClientAddresses.clearCache();
  });

  test("the trace scan: a span whose client address a trace rule masked", async () => {
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);
    jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
    jest.spyOn(SpanService, "executeQuery").mockResolvedValue(
      answer([
        {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
          name: "GET /download",
          kind: "SPAN_KIND_SERVER",
          durationUnixNano: "12000000",
          startTime: "2026-11-20 10:00:00.000000000",
          attributes: {
            "url.path": "/download",
            "url.query": "file=../../../../etc/passwd",
            "network.peer.address": SCRUB_IPV4_MASK,
            "client.address": SCRUB_IPV4_MASK,
          },
        },
      ]) as never,
    );
    jest
      .spyOn(TraceScrubRuleService, "findBy")
      .mockResolvedValue([
        traceRule({ fieldsToScrub: TraceScrubField.Name }),
        traceRule(),
      ] as never);

    const read: TelemetryWindowRead = await TraceSecurityScan.readWindow({
      window: WINDOW,
      offset: 0,
      pageSize: 100,
    });
    const prepared: Array<NormalizedSecurityEvent> =
      await TraceSecurityScan.prepareEvents({
        projectId: PROJECT_ID,
        events: read.events,
      });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]!.principalIp).toBe("");
    expect(readHiddenClientAddress(prepared[0]!)).toEqual({
      kind: ScrubbedAddressKind.Masked,
      value: SCRUB_IPV4_MASK,
      place: ScrubbedAddressPlace.SpanAttributes,
      signal: "trace",
      ruleId: TRACE_RULE_ID,
      ruleName: "Scrub IP addresses in spans",
    });
  });

  test("the log scan: an access log line whose client a log rule redacted, as its row is stored", async () => {
    jest
      .spyOn(OpenStackAuditJoin, "enrichEvents")
      .mockResolvedValue(undefined as never);
    jest.spyOn(SecurityRequestTrace, "followEvents").mockResolvedValue(0);
    jest
      .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
      .mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 } as never);
    jest
      .spyOn(RealTimeDetections, "screen")
      .mockResolvedValue(undefined as never);
    const inserted: Array<JSONObject> = [];
    jest
      .spyOn(SecurityEventService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        inserted.push(...rows);
      });
    jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([logRule()] as never);

    const events: Array<NormalizedSecurityEvent> = WebAttackLogParser.parse(
      logLine(
        '[REDACTED] - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
      ),
    );

    await SecurityLogScanner.storeEvents({
      projectId: PROJECT_ID,
      events,
      serviceMetadata: {
        serviceName: "OneUptime Logs",
        primaryEntityId: new ObjectID("0192f1a0-0000-7000-8000-00000000d301"),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 15,
        projectRetentionConfig: null,
        projectRetentionInDays: 30,
      } as unknown as TelemetryServiceMetadata,
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["principalIp"]).toBe("");
    expect(inserted[0]!["attributes"]).toEqual(
      expect.objectContaining({
        "oneuptime.request.client_address_hidden": "scrub-rule",
        "oneuptime.request.client_address_scrubbed": "[REDACTED]",
        "oneuptime.request.client_address_scrubbed_in": "log-body",
        "oneuptime.request.client_address_scrub_rule_id": LOG_RULE_ID,
        "oneuptime.request.client_address_scrub_rule": "Scrub IP addresses",
      }),
    );
    expect(inserted[0]!["observables"]).not.toContain("[REDACTED]");
  });
});
