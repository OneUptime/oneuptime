/*
 * The alert creation path pulls the native isolated-vm addon through its
 * template renderer. Nothing under test here touches the sandbox, so stub
 * the module out before anything imports it (the DetectionRuleEvaluator
 * test discipline).
 */
jest.mock("isolated-vm", () => {
  return {};
});

import ThreatIntelMatcher, {
  MAX_GROUPS_PER_EVALUATION,
  ThreatIntelMatchResult,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../../Server/Services/AlertSeverityService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import ThreatIntelFeedService from "../../../../../Server/Services/ThreatIntelFeedService";
import ThreatIntelIndicatorService, {
  IndicatorMatchGroup,
} from "../../../../../Server/Services/ThreatIntelIndicatorService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import { MAX_CONNECTOR_ERROR_MESSAGE_LENGTH } from "../../../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import logger from "../../../../../Server/Utils/Logger";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
} from "../../../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  THREAT_CONFIDENCE_ATTRIBUTE,
  THREAT_FEED_ID_ATTRIBUTE,
  THREAT_FEED_NAME_ATTRIBUTE,
  THREAT_INDICATOR_ID_ATTRIBUTE,
  THREAT_INDICATOR_TYPE_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
  THREAT_INTEL_PRODUCT_NAME,
  THREAT_MATCH_COUNT_ATTRIBUTE,
} from "../../../../../Types/SecurityEvent/ThreatIntelConstants";
import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../../Types/JSON";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The threat-intel matcher engine: due feeds run one match query, matched
 * indicator groups open deduped alerts through the shared alerting
 * machinery, write Threat Intel finding rows (classUid 2004, threat
 * provenance), and record matcher state on the feed row — with the same
 * one-broken-feed-cannot-stop-the-loop discipline as the Sigma engine.
 * Every service boundary is stubbed.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const FEED_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "OneUptime Threat Intel",
  primaryEntityId: SERVICE_ID,
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
} as TelemetryServiceMetadata;

function buildFeed(
  options: {
    shouldCreateAlert?: boolean;
    shouldCreateIncident?: boolean;
    shouldWriteDetectionFinding?: boolean;
    lastEvaluatedAt?: Date;
    alertSeverityId?: ObjectID;
  } = {},
): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = FEED_ID.toString();
  feed.projectId = PROJECT_ID;
  feed.name = "Test Feed";
  if (options.shouldCreateAlert !== undefined) {
    feed.shouldCreateAlert = options.shouldCreateAlert;
  }
  if (options.shouldCreateIncident !== undefined) {
    feed.shouldCreateIncident = options.shouldCreateIncident;
  }
  if (options.shouldWriteDetectionFinding !== undefined) {
    feed.shouldWriteDetectionFinding = options.shouldWriteDetectionFinding;
  }
  if (options.lastEvaluatedAt) {
    feed.lastEvaluatedAt = options.lastEvaluatedAt;
  }
  if (options.alertSeverityId) {
    feed.alertSeverityId = options.alertSeverityId;
  }
  return feed;
}

function buildMatchGroup(
  overrides: Partial<IndicatorMatchGroup> = {},
): IndicatorMatchGroup {
  return {
    indicatorValue: "evil.example",
    stixId: "indicator--0001",
    indicatorType: "domain-name",
    indicatorName: "Known C2 domain",
    confidence: 85,
    matchCount: 4,
    sampleMessage: "outbound to evil.example",
    sampleObservables: ["evil.example", "web-01"],
    ...overrides,
  };
}

function buildSeverity(name: string): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.name = name;
  return severity;
}

let matchesSpy: Spy;
let feedUpdateSpy: Spy;
let alertFindSpy: Spy;
let alertCreateSpy: Spy;
let alertSeveritiesSpy: Spy;
let insertRowsSpy: Spy;

beforeEach(() => {
  matchesSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "findIndicatorMatches",
  ).mockResolvedValue([] as never);
  feedUpdateSpy = getJestSpyOn(
    ThreatIntelFeedService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
  alertFindSpy = getJestSpyOn(AlertService, "findBy").mockResolvedValue(
    [] as never,
  );
  alertCreateSpy = getJestSpyOn(AlertService, "create").mockResolvedValue(
    new Alert() as never,
  );
  alertSeveritiesSpy = getJestSpyOn(
    AlertSeverityService,
    "findBy",
  ).mockResolvedValue([buildSeverity("High")] as never);
  getJestSpyOn(IncidentService, "findBy").mockResolvedValue([] as never);
  getJestSpyOn(IncidentService, "create").mockResolvedValue({} as never);
  getJestSpyOn(IncidentSeverityService, "findBy").mockResolvedValue([
    buildSeverity("High"),
  ] as never);
  insertRowsSpy = getJestSpyOn(
    SecurityEventService,
    "insertJsonRows",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    SERVICE_METADATA as never,
  );
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ThreatIntelMatcher.evaluateFeed", () => {
  test("no matches: state advances, nothing is created", async () => {
    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(result.matchedIndicators).toBe(0);
    expect(alertCreateSpy).not.toHaveBeenCalled();
    expect(insertRowsSpy).not.toHaveBeenCalled();

    const data: JSONObject = (feedUpdateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["lastEvaluatedAt"]).toBeInstanceOf(Date);
    expect(data["lastMatchError"]).toBeNull();
    expect(data["lastMatchAt"]).toBeUndefined();
  });

  test("the match query is scoped to this feed, window-capped, and group-capped", async () => {
    const lastEvaluatedAt: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -10,
    );

    await ThreatIntelMatcher.evaluateFeed(buildFeed({ lastEvaluatedAt }));

    const call: JSONObject = matchesSpy.mock.calls[0]![0] as JSONObject;
    expect((call["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((call["feedId"] as ObjectID).toString()).toBe(FEED_ID.toString());
    expect(call["startTime"]).toBe(lastEvaluatedAt);
    expect(call["maxGroups"]).toBe(MAX_GROUPS_PER_EVALUATION);
  });

  test("a stale lastEvaluatedAt is capped at 24 hours of lookback", async () => {
    const staleDate: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -30,
    );

    await ThreatIntelMatcher.evaluateFeed(
      buildFeed({ lastEvaluatedAt: staleDate }),
    );

    const call: JSONObject = matchesSpy.mock.calls[0]![0] as JSONObject;
    const startTime: Date = call["startTime"] as Date;
    const hoursBack: number =
      (OneUptimeDate.getCurrentDate().getTime() - startTime.getTime()) /
      (60 * 60 * 1000);
    expect(hoursBack).toBeLessThanOrEqual(24.1);
  });

  test("a match opens a deduped alert and writes a finding row with the threat contract", async () => {
    matchesSpy.mockResolvedValue([buildMatchGroup()] as never);

    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(result.matchedIndicators).toBe(1);
    expect(result.totalMatches).toBe(4);
    expect(result.alertsCreated).toBe(1);
    expect(result.findingsWritten).toBe(1);

    // The alert: fingerprinted per (feed, indicator value), auto-created.
    const alert: Alert = (alertCreateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as Alert;
    expect(alert.title).toBe("[Threat Intel] Test Feed — evil.example");
    expect(alert.seriesFingerprint).toContain(
      `threat-intel:${FEED_ID.toString()}:`,
    );
    expect(alert.isCreatedAutomatically).toBe(true);
    expect(alert.description).toContain("Known C2 domain");
    expect(alert.description).toContain("confidence 85");
    expect(alert.description).toContain("indicator--0001");

    // The finding row: classUid 2004 with the oneuptime.threat.* block.
    const rows: Array<JSONObject> = insertRowsSpy.mock
      .calls[0]![0] as Array<JSONObject>;
    expect(rows).toHaveLength(1);
    const row: JSONObject = rows[0]!;
    expect(row["classUid"]).toBe(DETECTION_FINDING_CLASS_UID);
    expect(row["className"]).toBe(DETECTION_FINDING_CLASS_NAME);
    expect(row["productName"]).toBe(THREAT_INTEL_PRODUCT_NAME);
    expect(row["ruleId"]).toBe("indicator--0001");
    expect(String(row["eventUid"])).toContain(
      `threat-intel:${FEED_ID.toString()}:`,
    );
    expect((row["observables"] as Array<string>)[0]).toBe("evil.example");

    const attributes: JSONObject = row["attributes"] as JSONObject;
    expect(attributes[THREAT_FEED_ID_ATTRIBUTE]).toBe(FEED_ID.toString());
    expect(attributes[THREAT_FEED_NAME_ATTRIBUTE]).toBe("Test Feed");
    expect(attributes[THREAT_INDICATOR_ID_ATTRIBUTE]).toBe("indicator--0001");
    expect(attributes[THREAT_INDICATOR_TYPE_ATTRIBUTE]).toBe("domain-name");
    expect(attributes[THREAT_INDICATOR_VALUE_ATTRIBUTE]).toBe("evil.example");
    expect(attributes[THREAT_CONFIDENCE_ATTRIBUTE]).toBe("85");
    expect(attributes[THREAT_MATCH_COUNT_ATTRIBUTE]).toBe("4");

    // attributeKeys sidecar carries the stamped keys (bloom-index feed).
    expect(row["attributeKeys"]).toContain(THREAT_INDICATOR_VALUE_ATTRIBUTE);

    // lastMatchAt advances alongside lastEvaluatedAt.
    const data: JSONObject = (feedUpdateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["lastMatchAt"]).toBeInstanceOf(Date);
  });

  test("a still-open alert with the same fingerprint suppresses re-alerting", async () => {
    matchesSpy.mockResolvedValue([buildMatchGroup()] as never);

    // First run creates; capture the fingerprint it used.
    await ThreatIntelMatcher.evaluateFeed(buildFeed());
    const fingerprint: string = (
      (alertCreateSpy.mock.calls[0]![0] as JSONObject)["data"] as Alert
    ).seriesFingerprint!;

    alertCreateSpy.mockClear();

    const openAlert: Alert = new Alert();
    openAlert.seriesFingerprint = fingerprint;
    alertFindSpy.mockResolvedValue([openAlert] as never);

    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(result.alertsCreated).toBe(0);
    expect(alertCreateSpy).not.toHaveBeenCalled();
    // The finding is still written — findings are the searchable record.
    expect(result.findingsWritten).toBe(1);
  });

  test("severity partitioning: mixed-confidence matches resolve severities per partition", async () => {
    matchesSpy.mockResolvedValue([
      buildMatchGroup({ indicatorValue: "critical.example", confidence: 95 }),
      buildMatchGroup({ indicatorValue: "low.example", confidence: 10 }),
    ] as never);

    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(result.alertsCreated).toBe(2);
    // One severity resolution per distinct mapped severity (Critical, Low).
    expect(alertSeveritiesSpy).toHaveBeenCalledTimes(2);
  });

  test("alerts off: findings still written; findings off: alerts still open", async () => {
    matchesSpy.mockResolvedValue([buildMatchGroup()] as never);

    const noAlerts: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(
        buildFeed({ shouldCreateAlert: false }),
      );
    expect(noAlerts.alertsCreated).toBe(0);
    expect(noAlerts.findingsWritten).toBe(1);

    insertRowsSpy.mockClear();

    const noFindings: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(
        buildFeed({ shouldWriteDetectionFinding: false }),
      );
    expect(noFindings.alertsCreated).toBe(1);
    expect(noFindings.findingsWritten).toBe(0);
    expect(insertRowsSpy).not.toHaveBeenCalled();
  });

  test("incidents open only on the explicit === true gate", async () => {
    matchesSpy.mockResolvedValue([buildMatchGroup()] as never);

    // Unset flag reads as off — never "probably on".
    const unset: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(buildFeed());
    expect(unset.incidentsCreated).toBe(0);

    const enabled: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(
        buildFeed({ shouldCreateIncident: true }),
      );
    expect(enabled.incidentsCreated).toBe(1);
  });

  test("a project with no alert severities skips alerts with a warning, not a crash", async () => {
    matchesSpy.mockResolvedValue([buildMatchGroup()] as never);
    alertSeveritiesSpy.mockResolvedValue([] as never);

    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(result.alertsCreated).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
    expect(result.findingsWritten).toBe(1);
  });
});

describe("ThreatIntelMatcher.evaluateAllDueFeeds", () => {
  test("one failing feed records lastMatchError and the loop continues", async () => {
    const failing: ThreatIntelFeed = buildFeed();
    const healthy: ThreatIntelFeed = buildFeed();
    healthy._id = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    ).toString();

    getJestSpyOn(ThreatIntelFeedService, "findBy").mockResolvedValue([
      failing,
      healthy,
    ] as never);

    const evaluateSpy: Spy = getJestSpyOn(ThreatIntelMatcher, "evaluateFeed")
      .mockRejectedValueOnce(new Error("match query exploded") as never)
      .mockResolvedValueOnce({} as never);

    await ThreatIntelMatcher.evaluateAllDueFeeds();

    expect(evaluateSpy).toHaveBeenCalledTimes(2);

    expect(feedUpdateSpy).toHaveBeenCalledTimes(1);
    const update: JSONObject = feedUpdateSpy.mock.calls[0]![0] as JSONObject;
    expect((update["id"] as ObjectID).toString()).toBe(FEED_ID.toString());
    const data: JSONObject = update["data"] as JSONObject;
    expect(String(data["lastMatchError"])).toContain("match query exploded");
    expect(String(data["lastMatchError"]).length).toBeLessThanOrEqual(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
  });

  test("a failure-write failure is swallowed — the loop always advances", async () => {
    getJestSpyOn(ThreatIntelFeedService, "findBy").mockResolvedValue([
      buildFeed(),
    ] as never);
    getJestSpyOn(ThreatIntelMatcher, "evaluateFeed").mockRejectedValue(
      new Error("boom") as never,
    );
    feedUpdateSpy.mockRejectedValue(new Error("db down") as never);

    await expect(
      ThreatIntelMatcher.evaluateAllDueFeeds(),
    ).resolves.toBeUndefined();
  });
});
