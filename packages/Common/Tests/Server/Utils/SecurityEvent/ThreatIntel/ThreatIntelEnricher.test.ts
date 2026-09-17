import ThreatIntelEnricher, {
  EnrichmentResult,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
} from "../../../../../Server/Services/ThreatIntelIndicatorService";
import logger from "../../../../../Server/Utils/Logger";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import ObjectID from "../../../../../Types/ObjectID";
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
 * The ingest-time enricher's contract: matched events get the threat.*
 * stamps (highest confidence winning), unmatched events are untouched,
 * the has-indicators probe short-circuits and caches per project, and NO
 * failure inside enrichment may ever surface to the ingest path — the
 * worst allowed outcome is an unenriched batch.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function buildEvent(observables: Array<string>): NormalizedSecurityEvent {
  return {
    time: new Date("2026-08-27T12:00:00.000Z"),
    eventUid: "evt-1",
    categoryUid: 4,
    categoryName: "Network Activity",
    classUid: 4001,
    className: "Network Activity",
    activityName: "Traffic",
    severityId: 2,
    severityName: OcsfSeverity.Low,
    statusName: "",
    message: "outbound connection",
    vendorName: "test",
    productName: "test",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "",
    principalHost: "",
    principalIp: "",
    principalProcess: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables,
    attributes: { "source.key": "kept" },
  };
}

function buildIndicator(
  value: string,
  confidence: number,
  overrides: Partial<ActiveIndicator> = {},
): ActiveIndicator {
  return {
    indicatorValue: value,
    feedId: "feed-1",
    feedName: "Test Feed",
    stixId: `indicator--${value}`,
    indicatorType: "ipv4-addr",
    indicatorName: "",
    confidence,
    ...overrides,
  };
}

let hasIndicatorsSpy: Spy;
let lookupSpy: Spy;

beforeEach(() => {
  ThreatIntelEnricher.clearCaches();
  hasIndicatorsSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "hasIndicatorsForProject",
  ).mockResolvedValue(true as never);
  lookupSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "findActiveIndicatorsByValues",
  ).mockResolvedValue([] as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  ThreatIntelEnricher.clearCaches();
});

describe("ThreatIntelEnricher.enrichNormalizedEvents", () => {
  test("stamps threat.* attributes on the matched event and leaves others alone", async () => {
    lookupSpy.mockResolvedValue([buildIndicator("198.51.100.7", 85)] as never);

    const matched: NormalizedSecurityEvent = buildEvent([
      "198.51.100.7",
      "alice",
    ]);
    const unmatched: NormalizedSecurityEvent = buildEvent(["10.0.0.1"]);

    const result: EnrichmentResult =
      await ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: PROJECT_ID,
        events: [matched, unmatched],
      });

    expect(result.eventsMatched).toBe(1);

    expect(matched.attributes["threat.matched"]).toBe("true");
    expect(matched.attributes["threat.indicator_id"]).toBe(
      "indicator--198.51.100.7",
    );
    expect(matched.attributes["threat.indicator_type"]).toBe("ipv4-addr");
    expect(matched.attributes["threat.indicator_value"]).toBe("198.51.100.7");
    expect(matched.attributes["threat.feed"]).toBe("Test Feed");
    expect(matched.attributes["threat.feed_id"]).toBe("feed-1");
    expect(matched.attributes["threat.confidence"]).toBe("85");
    expect(matched.attributes["threat.match_count"]).toBe("1");
    // Existing attributes survive the stamp.
    expect(matched.attributes["source.key"]).toBe("kept");

    expect(unmatched.attributes["threat.matched"]).toBeUndefined();
  });

  test("matches case-insensitively — observables keep source casing, indicators are canonical", async () => {
    lookupSpy.mockResolvedValue([
      buildIndicator("evil.example", 60, { indicatorType: "domain-name" }),
    ] as never);

    const event: NormalizedSecurityEvent = buildEvent(["EVIL.Example"]);

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes["threat.matched"]).toBe("true");

    // The lookup was fed the canonical (lowercased) value.
    const lookupCall: { values: Array<string> } = lookupSpy.mock
      .calls[0]![0] as {
      values: Array<string>;
    };
    expect(lookupCall.values).toContain("evil.example");
  });

  test("when several indicators match one event, the highest confidence wins the scalar stamps", async () => {
    lookupSpy.mockResolvedValue([
      buildIndicator("198.51.100.7", 40),
      buildIndicator("evil.example", 95, {
        feedId: "feed-2",
        feedName: "Better Feed",
        indicatorType: "domain-name",
      }),
    ] as never);

    const event: NormalizedSecurityEvent = buildEvent([
      "198.51.100.7",
      "evil.example",
    ]);

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes["threat.indicator_value"]).toBe("evil.example");
    expect(event.attributes["threat.feed"]).toBe("Better Feed");
    expect(event.attributes["threat.confidence"]).toBe("95");
    expect(event.attributes["threat.match_count"]).toBe("2");
  });

  test("one value carried by two feeds: the higher-confidence feed wins", async () => {
    lookupSpy.mockResolvedValue([
      buildIndicator("198.51.100.7", 40, { feedId: "feed-low" }),
      buildIndicator("198.51.100.7", 90, { feedId: "feed-high" }),
    ] as never);

    const event: NormalizedSecurityEvent = buildEvent(["198.51.100.7"]);

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: [event],
    });

    expect(event.attributes["threat.feed_id"]).toBe("feed-high");
    expect(event.attributes["threat.match_count"]).toBe("1");
  });

  test("a project with no indicators short-circuits before any value lookup", async () => {
    hasIndicatorsSpy.mockResolvedValue(false as never);

    const result: EnrichmentResult =
      await ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: PROJECT_ID,
        events: [buildEvent(["198.51.100.7"])],
      });

    expect(result.eventsMatched).toBe(0);
    expect(result.valuesLookedUp).toBe(0);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("the has-indicators probe is cached per project and invalidated by the poller", async () => {
    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: [buildEvent(["a"])],
    });
    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: [buildEvent(["b"])],
    });

    expect(hasIndicatorsSpy).toHaveBeenCalledTimes(1);

    ThreatIntelEnricher.invalidateProjectCache(PROJECT_ID);

    await ThreatIntelEnricher.enrichNormalizedEvents({
      projectId: PROJECT_ID,
      events: [buildEvent(["c"])],
    });

    expect(hasIndicatorsSpy).toHaveBeenCalledTimes(2);
  });

  test("distinct observables across the batch are looked up once, chunked", async () => {
    const events: Array<NormalizedSecurityEvent> = [
      buildEvent(["a.example", "b.example"]),
      buildEvent(["b.example", "c.example"]),
    ];

    const result: EnrichmentResult =
      await ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: PROJECT_ID,
        events,
      });

    expect(result.valuesLookedUp).toBe(3);
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    const lookupCall: { values: Array<string> } = lookupSpy.mock
      .calls[0]![0] as {
      values: Array<string>;
    };
    expect(lookupCall.values.sort()).toEqual([
      "a.example",
      "b.example",
      "c.example",
    ]);
  });

  test("an empty batch and events with no observables cost nothing", async () => {
    const noEvents: EnrichmentResult =
      await ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: PROJECT_ID,
        events: [],
      });
    expect(noEvents.valuesLookedUp).toBe(0);
    expect(hasIndicatorsSpy).not.toHaveBeenCalled();

    const noObservables: EnrichmentResult =
      await ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: PROJECT_ID,
        events: [buildEvent([])],
      });
    expect(noObservables.valuesLookedUp).toBe(0);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("a lookup failure logs, returns unenriched, and never throws into ingest", async () => {
    lookupSpy.mockRejectedValue(new Error("clickhouse down") as never);

    const event: NormalizedSecurityEvent = buildEvent(["198.51.100.7"]);

    const result: EnrichmentResult =
      await ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: PROJECT_ID,
        events: [event],
      });

    expect(result.eventsMatched).toBe(0);
    expect(event.attributes["threat.matched"]).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("a probe failure is equally contained", async () => {
    hasIndicatorsSpy.mockRejectedValue(new Error("timeout") as never);

    await expect(
      ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: PROJECT_ID,
        events: [buildEvent(["198.51.100.7"])],
      }),
    ).resolves.toEqual({ eventsMatched: 0, valuesLookedUp: 0 });
  });
});
