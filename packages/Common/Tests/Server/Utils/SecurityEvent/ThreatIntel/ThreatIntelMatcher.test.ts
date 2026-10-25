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
  THREAT_INTEL_MATCH_PROJECT_WORK,
  ThreatIntelMatchResult,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";
import SecurityProjectWork, {
  SecurityProjectWorkLease,
} from "../../../../../Server/Utils/SecurityEvent/SecurityProjectWork";
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
  THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION,
  THREAT_INTEL_PRODUCT_NAME,
  THREAT_MATCH_COUNT_ATTRIBUTE,
} from "../../../../../Types/SecurityEvent/ThreatIntelConstants";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../../Types/JSON";
import { getJestSpyOn } from "../../../../Spy";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityEntityRiskRecorder from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { SecurityRiskFinding } from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import SecurityDetectionSource from "../../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { mockProjectStates } from "../../../TestingUtils/Services/ProjectStatesHelper";

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
  /*
   * The project's incident and alert states: open records are read by
   * the states that are not resolved (Common/Utils/ResolvedState).
   */
  mockProjectStates();
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
  // Feeds open security cases unless switched off; SecurityCaseIngest has its own suite.
  getJestSpyOn(SecurityCaseIngest, "recordDetections").mockResolvedValue({
    casesOpened: 0,
    detectionsAdded: 0,
    detectionsRepeated: 0,
  } as never);
  // So is entity risk (SecurityEntityRiskRecorder).
  getJestSpyOn(SecurityEntityRiskRecorder, "record").mockResolvedValue({
    entitiesUpdated: 0,
    riskCasesRaised: 0,
  } as never);
});

/*
 * Each indicator a check opens adds to the risk of the address it names
 * (SecurityEntityRiskRecorder), after the check's cases and whether the
 * feed opens cases or not; a domain or a file hash is threat intel's to
 * judge and adds none.
 */
describe("ThreatIntelMatcher: entity risk", () => {
  test("an address indicator adds risk to the address, at its confidence's points, after the cases", async () => {
    matchesSpy.mockResolvedValue([
      buildMatchGroup({
        indicatorValue: "203.0.113.7",
        indicatorType: "ipv4-addr",
        confidence: 95,
      }),
      buildMatchGroup({ indicatorValue: "evil.example" }),
    ] as never);

    const order: Array<string> = [];

    getJestSpyOn(SecurityCaseIngest, "recordDetections").mockImplementation(
      async () => {
        order.push("cases");
        return {
          casesOpened: 2,
          detectionsAdded: 2,
          detectionsRepeated: 0,
        } as never;
      },
    );

    const risk: Spy = getJestSpyOn(
      SecurityEntityRiskRecorder,
      "record",
    ).mockImplementation(async () => {
      order.push("risk");
      return { entitiesUpdated: 1, riskCasesRaised: 0 } as never;
    });

    await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(order).toEqual(["cases", "risk"]);

    const findings: Array<SecurityRiskFinding> = risk.mock
      .calls[0]![0] as Array<SecurityRiskFinding>;

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: SecurityDetectionSource.ThreatIntel,
      sourceKey: `intel:${FEED_ID.toString()}`,
      sourceName: "Test Feed",
      severity: OcsfSeverity.Critical,
      points: 75,
      entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.7" }],
    });
    expect(findings[0]!.threatIntelFeedId?.toString()).toBe(FEED_ID.toString());
  });

  test("a feed that opens no cases still adds risk", async () => {
    matchesSpy.mockResolvedValue([
      buildMatchGroup({ indicatorValue: "198.51.100.4", confidence: 70 }),
    ] as never);

    const feed: ThreatIntelFeed = buildFeed({ shouldCreateAlert: false });
    feed.shouldCreateCase = false;

    const cases: Spy = getJestSpyOn(SecurityCaseIngest, "recordDetections");
    const risk: Spy = getJestSpyOn(SecurityEntityRiskRecorder, "record");

    await ThreatIntelMatcher.evaluateFeed(feed);

    expect(cases).not.toHaveBeenCalled();
    expect(
      (risk.mock.calls[0]![0] as Array<SecurityRiskFinding>)[0],
    ).toMatchObject({ points: 50, severity: OcsfSeverity.High });
  });

  test("a check that matched nothing adds nothing", async () => {
    const risk: Spy = getJestSpyOn(SecurityEntityRiskRecorder, "record");

    await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(risk).not.toHaveBeenCalled();
  });
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

  test("the match query is scoped to this feed, window-capped, and asks for one value more than a check records", async () => {
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
    expect(call["maxGroups"]).toBe(
      THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION + 1,
    );
    expect(THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION).toBe(10000);
    expect(MAX_GROUPS_PER_EVALUATION).toBe(100);
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

describe("ThreatIntelMatcher.evaluateFeedsForProject", () => {
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

    await ThreatIntelMatcher.evaluateFeedsForProject(PROJECT_ID);

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
      ThreatIntelMatcher.evaluateFeedsForProject(PROJECT_ID),
    ).resolves.toBeUndefined();
  });

  function feedChecked(idSuffix: string, minutesAgo?: number): ThreatIntelFeed {
    const feed: ThreatIntelFeed = buildFeed(
      minutesAgo === undefined
        ? {}
        : {
            lastEvaluatedAt: OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              -minutesAgo,
            ),
          },
    );
    feed._id = `66666666-6666-4666-8666-${idSuffix}`;
    return feed;
  }

  function evaluatedFeedIds(evaluateSpy: Spy): Array<string> {
    return evaluateSpy.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as ThreatIntelFeed).id!.toString();
    });
  }

  test("reads the project's enabled feeds page by page, and checks the longest unchecked first", async () => {
    const recent: ThreatIntelFeed = feedChecked("666666666661", 1);
    const never: ThreatIntelFeed = feedChecked("666666666662");
    const older: ThreatIntelFeed = feedChecked("666666666663", 30);

    const findAll: Spy = getJestSpyOn(
      ThreatIntelFeedService,
      "findAllBy",
    ).mockResolvedValue([recent, never, older] as never);
    const evaluateSpy: Spy = getJestSpyOn(
      ThreatIntelMatcher,
      "evaluateFeed",
    ).mockResolvedValue({} as never);

    await ThreatIntelMatcher.evaluateFeedsForProject(PROJECT_ID);

    expect(evaluatedFeedIds(evaluateSpy)).toEqual([
      never.id!.toString(),
      older.id!.toString(),
      recent.id!.toString(),
    ]);

    const args: { query: JSONObject; sort: JSONObject; limit?: unknown } =
      findAll.mock.calls[0]![0] as {
        query: JSONObject;
        sort: JSONObject;
        limit?: unknown;
      };
    expect(args.query).toEqual({ projectId: PROJECT_ID, isEnabled: true });
    expect(args.sort).toEqual({ _id: SortOrder.Ascending });
    // findAllBy pages through in LIMIT_MAX batches; a limit would cap it again.
    expect(args.limit).toBeUndefined();
  });

  test("a turn that runs out of time, or loses its lease, leaves the rest for the next one", async () => {
    getJestSpyOn(ThreatIntelFeedService, "findAllBy").mockResolvedValue([
      feedChecked("666666666664", 3),
      feedChecked("666666666665", 2),
      feedChecked("666666666666", 1),
    ] as never);
    const evaluateSpy: Spy = getJestSpyOn(
      ThreatIntelMatcher,
      "evaluateFeed",
    ).mockResolvedValue({} as never);

    let checks: number = 0;
    const outOfTime: SecurityProjectWorkLease = {
      hasTimeLeft: (): boolean => {
        checks++;
        return checks <= 2;
      },
      keep: async (): Promise<boolean> => {
        return true;
      },
    };

    await ThreatIntelMatcher.evaluateFeedsForProject(PROJECT_ID, outOfTime);
    expect(evaluateSpy).toHaveBeenCalledTimes(2);

    evaluateSpy.mockClear();

    const lost: SecurityProjectWorkLease = {
      hasTimeLeft: (): boolean => {
        return true;
      },
      keep: async (): Promise<boolean> => {
        return false;
      },
    };

    await ThreatIntelMatcher.evaluateFeedsForProject(PROJECT_ID, lost);
    // Another worker may hold the project now: the feed in hand, then it lets go.
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ThreatIntelMatcher.enqueueProjectsWithEnabledFeeds", () => {
  test("queues each project with an enabled feed, read page by page, and checks none itself", async () => {
    const otherProject: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );
    const inOtherProject: ThreatIntelFeed = buildFeed();
    inOtherProject.projectId = otherProject;

    const findAll: Spy = getJestSpyOn(
      ThreatIntelFeedService,
      "findAllBy",
    ).mockResolvedValue([buildFeed(), buildFeed(), inOtherProject] as never);
    const enqueue: Spy = getJestSpyOn(
      SecurityProjectWork,
      "enqueueProjects",
    ).mockResolvedValue(2 as never);
    const evaluateSpy: Spy = getJestSpyOn(ThreatIntelMatcher, "evaluateFeed");

    await expect(
      ThreatIntelMatcher.enqueueProjectsWithEnabledFeeds(),
    ).resolves.toBe(2);

    expect(enqueue.mock.calls[0]![0]).toBe(THREAT_INTEL_MATCH_PROJECT_WORK);
    const queued: Array<string> = (
      enqueue.mock.calls[0]![1] as Array<ObjectID>
    ).map((projectId: ObjectID): string => {
      return projectId.toString();
    });
    expect(Array.from(new Set(queued)).sort()).toEqual(
      [PROJECT_ID.toString(), otherProject.toString()].sort(),
    );
    expect(evaluateSpy).not.toHaveBeenCalled();

    expect(findAll).toHaveBeenCalledWith({
      query: { isEnabled: true },
      select: { _id: true, projectId: true },
      sort: { _id: SortOrder.Ascending },
      props: { isRoot: true },
    });
  });
});

/*
 * A feed whose indicators match everyday values used to stop at
 * MAX_GROUPS_PER_EVALUATION and drop the rest without a word. Now every
 * matched value up to THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION is a
 * finding, the ones seen in the most events open alerts and cases of their
 * own, and the rest share one case about the feed - whose Last Match Error
 * says how many matched.
 */
describe("ThreatIntelMatcher: a check that matches more values than it opens cases for", () => {
  const OVERFLOW_FINGERPRINT: string = `threat-intel:${FEED_ID.toString()}:overflow`;

  // Seen in the most events first, as the match query orders them.
  function manyMatches(count: number): Array<IndicatorMatchGroup> {
    const matches: Array<IndicatorMatchGroup> = [];

    for (let index: number = 0; index < count; index++) {
      matches.push(
        buildMatchGroup({
          indicatorValue: `host-${index}.example`,
          stixId: `indicator--${index}`,
          matchCount: count - index + 1,
          // The strongest indicator is among the rest: the case takes its severity.
          confidence: index === count - 1 ? 95 : 40,
        }),
      );
    }

    return matches;
  }

  function recordCases(): Spy {
    return getJestSpyOn(
      SecurityCaseIngest,
      "recordDetections",
    ).mockResolvedValue({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    } as never);
  }

  function storedLastMatchError(): unknown {
    return (
      (feedUpdateSpy.mock.calls[0]![0] as JSONObject)["data"] as JSONObject
    )["lastMatchError"];
  }

  test("every value is a finding; the top ones open alerts and cases, the rest share one case", async () => {
    const matches: Array<IndicatorMatchGroup> = manyMatches(
      MAX_GROUPS_PER_EVALUATION + 50,
    );
    matchesSpy.mockResolvedValue(matches as never);
    const record: Spy = recordCases();

    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(buildFeed());

    expect(result.matchedIndicators).toBe(150);
    expect(result.overflowIndicators).toBe(50);
    expect(result.findingsWritten).toBe(150);
    expect(result.alertsCreated).toBe(MAX_GROUPS_PER_EVALUATION);

    const signals: Array<SecurityDetectionSignal> = record.mock
      .calls[0]![0] as Array<SecurityDetectionSignal>;

    // One per value with a case of its own, and one about the feed.
    expect(signals).toHaveLength(MAX_GROUPS_PER_EVALUATION + 1);

    const overflow: SecurityDetectionSignal = signals[signals.length - 1]!;
    let overflowEvents: number = 0;

    for (const match of matches.slice(MAX_GROUPS_PER_EVALUATION)) {
      overflowEvents += match.matchCount;
    }

    expect(overflow.fingerprint).toBe(OVERFLOW_FINGERPRINT);
    // It is about the feed, not an entity: nothing for a playbook to contain.
    expect(overflow.entities).toEqual([]);
    expect(overflow.eventCount).toBe(overflowEvents);
    expect(overflow.threatIntelFeedId?.toString()).toBe(FEED_ID.toString());
    expect(overflow.title).toBe(
      "Test Feed — more matches than one check opens cases for",
    );
    expect(overflow.description).toContain("`host-100.example`");
    expect(overflow.description).not.toContain("`host-99.example`");

    expect(storedLastMatchError()).toBe(
      "This check matched 150 indicator values. Alerts, incidents and cases opened for the 100 with the most matches; every one of them is a Detection Finding. Check the feed for indicators that match everyday values, or raise its Minimum Confidence.",
    );
  });

  test("the case about the rest takes the severity of the strongest indicator among them", async () => {
    matchesSpy.mockResolvedValue(
      manyMatches(MAX_GROUPS_PER_EVALUATION + 2) as never,
    );
    const record: Spy = recordCases();

    await ThreatIntelMatcher.evaluateFeed(
      buildFeed({ shouldCreateAlert: false }),
    );

    const signals: Array<SecurityDetectionSignal> = record.mock
      .calls[0]![0] as Array<SecurityDetectionSignal>;
    const overflow: SecurityDetectionSignal = signals[signals.length - 1]!;
    // A value with a case of its own, at confidence 40.
    const ordinary: SecurityDetectionSignal = signals[0]!;

    expect(overflow.fingerprint).toBe(OVERFLOW_FINGERPRINT);
    expect(ordinary.severity).toBe(OcsfSeverity.Medium);
    expect(overflow.severity).toBe(OcsfSeverity.Critical);
  });

  test("past what a check reads, findings stop at the cap and Last Match Error says there were more", async () => {
    matchesSpy.mockResolvedValue(
      manyMatches(THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION + 1) as never,
    );
    recordCases();

    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(
        buildFeed({ shouldCreateAlert: false }),
      );

    expect(result.matchedIndicators).toBe(
      THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION,
    );
    expect(result.findingsWritten).toBe(
      THREAT_INTEL_MAX_FINDINGS_PER_EVALUATION,
    );
    // Written a thousand rows at a time, not in one insert of ten thousand.
    expect(insertRowsSpy).toHaveBeenCalledTimes(10);

    for (const call of insertRowsSpy.mock.calls) {
      expect((call[0] as Array<JSONObject>).length).toBe(1000);
    }

    expect(storedLastMatchError()).toBe(
      "This check matched more than 10,000 indicator values. Alerts, incidents and cases opened for the 100 with the most matches; the 10,000 with the most matches are Detection Findings, and the rest were not recorded. Check the feed for indicators that match everyday values, or raise its Minimum Confidence.",
    );
  });

  test("a feed that writes no findings says the rest were not recorded", async () => {
    matchesSpy.mockResolvedValue(
      manyMatches(MAX_GROUPS_PER_EVALUATION + 1) as never,
    );
    recordCases();

    await ThreatIntelMatcher.evaluateFeed(
      buildFeed({
        shouldCreateAlert: false,
        shouldWriteDetectionFinding: false,
      }),
    );

    expect(insertRowsSpy).not.toHaveBeenCalled();
    expect(storedLastMatchError()).toBe(
      "This check matched 101 indicator values. Alerts, incidents and cases opened for the 100 with the most matches; the rest were not recorded, because Write Detection Finding on Match is off for this feed. Check the feed for indicators that match everyday values, or raise its Minimum Confidence.",
    );
  });

  test("exactly as many values as a check opens cases for is no overflow", async () => {
    matchesSpy.mockResolvedValue(
      manyMatches(MAX_GROUPS_PER_EVALUATION) as never,
    );
    const record: Spy = recordCases();

    const result: ThreatIntelMatchResult =
      await ThreatIntelMatcher.evaluateFeed(
        buildFeed({ shouldCreateAlert: false }),
      );

    expect(result.overflowIndicators).toBe(0);

    const signals: Array<SecurityDetectionSignal> = record.mock
      .calls[0]![0] as Array<SecurityDetectionSignal>;

    expect(signals).toHaveLength(MAX_GROUPS_PER_EVALUATION);
    expect(
      signals.some((signal: SecurityDetectionSignal): boolean => {
        return signal.fingerprint === OVERFLOW_FINGERPRINT;
      }),
    ).toBe(false);
    // Explicitly null, so an overflow on an earlier check is cleared.
    expect(storedLastMatchError()).toBeNull();
  });
});
