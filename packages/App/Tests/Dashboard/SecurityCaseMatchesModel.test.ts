import { beforeAll, describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchRuleJson,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
} from "Common/Types/SecurityCase/SecurityCaseMatches";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * Why a case was opened, as the "Why This Case Was Opened" card says it
 * (#9556): when a detection's rule fires, how many events it matched from
 * what and over when, how far the requests got, what each event's row says
 * it came from and opens, and where to look next - each link to the right
 * page, on the right value, over the detection's window.
 */

type Model =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Matches/SecurityCaseMatchesModel");
type Copy =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Matches/SecurityCaseMatchesCopy");

let model: Model;
let copy: Copy;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const BASE: string = `/dashboard/${PROJECT_ID}`;
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const LOG_ID: string = "0192f1a0-0000-7000-8000-000000000001";

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `${BASE}/security-events/cases`,
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  model = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Matches/SecurityCaseMatchesModel"
  );
  copy = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Matches/SecurityCaseMatchesCopy"
  );
});

function open(route: Route | null | undefined): {
  path: string;
  query: Record<string, string>;
} {
  expect(route).toBeTruthy();

  const url: globalThis.URL = new globalThis.URL(
    route!.toString(),
    "https://oneuptime.example",
  );
  const query: Record<string, string> = {};

  url.searchParams.forEach((value: string, key: string) => {
    query[key] = value;
  });

  return { path: url.pathname, query };
}

function rule(
  overrides: Partial<SecurityCaseMatchRuleJson> = {},
): SecurityCaseMatchRuleJson {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Path traversal attempts",
    description:
      "Three or more requests from one IP address within five minutes.",
    isEnabled: true,
    isRealTime: false,
    isCorrelation: false,
    threshold: 3,
    groupByField: "principalIp",
    distinctCountField: "",
    windowInMinutes: 5,
    sigmaRuleYaml: "title: Path traversal attempts",
    falsePositives: [],
    references: [],
    lookFor: [{ field: "targetResource", values: ["../../"] }],
    responseSteps: [],
    ...overrides,
  };
}

function event(
  overrides: Partial<SecurityCaseMatchedEventJson> = {},
): SecurityCaseMatchedEventJson {
  return {
    time: "2026-11-17T19:22:14.000Z",
    eventUid: "log:abc:0",
    sourceId: "55555555-5555-4555-8555-555555555555",
    severityName: "Medium",
    className: "HTTP Activity",
    categoryName: "Application Activity",
    activityName: "Get",
    statusName: "Failure",
    message:
      "Path traversal attempt: GET /api/get_log_file/../../proc/self/environ → 404",
    vendorName: "OneUptime",
    productName: "Your logs",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: "35.196.249.14",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: null,
    processName: "",
    processCommandLine: "",
    observables: ["35.196.249.14"],
    mitreTactics: [],
    mitreTechniques: [],
    attributes: {
      "oneuptime.log.id": "abc",
      "oneuptime.log.service": "oneuptime-nginx",
      "oneuptime.log.resource.id": SERVICE_ID,
      "oneuptime.log.resource.type": ServiceType.OpenTelemetry,
    },
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
    sessionId: "",
    requestOutcome: SecurityEventRequestOutcome.Rejected,
    hunt: null,
    ...overrides,
  };
}

function detection(
  overrides: Partial<SecurityCaseMatchedDetectionJson> = {},
): SecurityCaseMatchedDetectionJson {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: "Path traversal attempts — 35.196.249.14",
    severity: "Medium",
    groupValue: "35.196.249.14",
    ruleName: "Path traversal attempts",
    eventCount: 12,
    fireCount: 1,
    firstSeenAt: "2026-11-17T19:28:00.000Z",
    lastSeenAt: "2026-11-17T19:28:00.000Z",
    sampleMessage: "",
    isOpening: true,
    rule: rule(),
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: "2026-11-17T19:22:00.000Z",
    windowEnd: "2026-11-17T19:29:00.000Z",
    events: [event()],
    isKept: false,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: 12,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: 12 },
    ...overrides,
  };
}

describe("when a rule fires", () => {
  test("a rule that counts for a group says its threshold, its field and its window", () => {
    expect(model.getRuleCountingSentence(rule())).toEqual({
      template: copy.FIRES_WHEN_EVENTS_FOR_SAME,
      fields: { groupBy: "principalIp" },
      count: 3,
      windowInSeconds: 300,
    });
  });

  test("a rule that counts without a group, a distinct count, and one that fires on each match", () => {
    expect(
      model.getRuleCountingSentence(rule({ groupByField: "" }))?.template,
    ).toBe(copy.FIRES_WHEN_EVENTS);
    expect(
      model.getRuleCountingSentence(
        rule({ distinctCountField: "principalUser", threshold: 5 }),
      ),
    ).toEqual({
      template: copy.FIRES_WHEN_SAME_SHOWS_VALUES,
      fields: { groupBy: "principalIp", fields: "principalUser" },
      count: 5,
      windowInSeconds: 300,
    });
    expect(
      model.getRuleCountingSentence(
        rule({ distinctCountField: "principalUser", groupByField: "" }),
      )?.template,
    ).toBe(copy.FIRES_WHEN_VALUES);
    expect(
      model.getRuleCountingSentence(rule({ threshold: 1 }))?.template,
    ).toBe(copy.FIRES_ON_EACH_MATCH);
  });

  test("says nothing for a correlation, which says it itself, or for no rule", () => {
    expect(
      model.getRuleCountingSentence(rule({ isCorrelation: true })),
    ).toBeNull();
    expect(model.getRuleCountingSentence(null)).toBeNull();
  });

  test("words the counting the way a correlation's sentence words it, so a language words it once", () => {
    expect(copy.FIRES_WHEN_EVENTS_FOR_SAME).toBe(
      "Fires when {{count}} events happen for the same {{groupBy}} within {{timespan}}.",
    );
    expect(copy.FIRES_WHEN_SAME_SHOWS_VALUES).toBe(
      "Fires when the same {{groupBy}} shows {{count}} different {{fields}} values within {{timespan}}.",
    );
  });
});

describe("what it matched", () => {
  test("events from the address a rule groups by who acted, over the window", () => {
    const sentence: ReturnType<typeof model.getMatchedSentence> =
      model.getMatchedSentence(detection());

    expect(sentence?.template).toBe(copy.MATCHED_FROM_BETWEEN);
    expect(sentence?.count).toBe(12);
    expect(sentence?.value).toBe("35.196.249.14");
    expect(sentence?.start.toISOString()).toBe("2026-11-17T19:22:00.000Z");
    expect(sentence?.end.toISOString()).toBe("2026-11-17T19:29:00.000Z");
  });

  test("events naming a value grouped by anything else, or found another way", () => {
    expect(
      model.getMatchedSentence(
        detection({ rule: rule({ groupByField: "targetUser" }) }),
      )?.template,
    ).toBe(copy.MATCHED_NAMING_BETWEEN);
    expect(
      model.getMatchedSentence(
        detection({ basis: SecurityCaseMatchBasis.Indicator, rule: null }),
      )?.template,
    ).toBe(copy.MATCHED_NAMING_BETWEEN);
    expect(
      model.getMatchedSentence(detection({ groupValue: "" }))?.template,
    ).toBe(copy.MATCHED_BETWEEN);
  });

  test("nothing said when the events were not read", () => {
    expect(
      model.getMatchedSentence(detection({ matchedEventCount: null })),
    ).toBeNull();
    expect(
      model.getMatchedSentence(detection({ windowStart: null })),
    ).toBeNull();
  });

  test("says what the events are when they are not exactly what the rule matched", () => {
    expect(model.getBasisNote(detection())).toBe("");
    expect(
      model.getBasisNote(
        detection({ basis: SecurityCaseMatchBasis.NamedEntities }),
      ),
    ).toBe(copy.BASIS_NOTES[SecurityCaseMatchBasis.NamedEntities]);
    expect(
      model.getBasisNote(
        detection({ basis: SecurityCaseMatchBasis.RecordedEvent }),
      ),
    ).toBe(copy.BASIS_NOTES[SecurityCaseMatchBasis.RecordedEvent]);
    // A note about a value says nothing without one.
    expect(
      model.getBasisNote(
        detection({
          basis: SecurityCaseMatchBasis.NamedEntities,
          groupValue: " ",
        }),
      ),
    ).toBe("");
  });
});

describe("how far the requests got", () => {
  test("every request turned away", () => {
    const summary: ReturnType<typeof model.getRequestOutcomeSummary> =
      model.getRequestOutcomeSummary({ Rejected: 12, "": 3 });

    expect(summary).toEqual({
      kind: model.RequestOutcomeSummaryKind.AllTurnedAway,
      followed: 12,
      through: 0,
      tally: [{ outcome: SecurityEventRequestOutcome.Rejected, count: 12 }],
    });
    expect(model.getRequestOutcomeSentence(summary)).toBe(
      copy.REQUESTS_ALL_TURNED_AWAY,
    );
  });

  test("some got through: the most serious first", () => {
    const summary: ReturnType<typeof model.getRequestOutcomeSummary> =
      model.getRequestOutcomeSummary({
        Rejected: 9,
        "Reached App": 2,
        "Reached Database": 1,
      });

    expect(summary.kind).toBe(model.RequestOutcomeSummaryKind.SomeGotThrough);
    expect(summary.through).toBe(3);
    expect(summary.followed).toBe(12);
    expect(
      summary.tally.map((entry: { outcome: string }): string => {
        return entry.outcome;
      }),
    ).toEqual([
      SecurityEventRequestOutcome.ReachedDatabase,
      SecurityEventRequestOutcome.ReachedApp,
      SecurityEventRequestOutcome.Rejected,
    ]);
    expect(model.getRequestOutcomeSentence(summary)).toBe(
      copy.REQUESTS_GOT_THROUGH,
    );
  });

  test("no request followed into its trace says nothing", () => {
    const summary: ReturnType<typeof model.getRequestOutcomeSummary> =
      model.getRequestOutcomeSummary({ "": 4 });

    expect(summary.kind).toBe(model.RequestOutcomeSummaryKind.NotFollowed);
    expect(summary.tally).toEqual([]);
    expect(model.getRequestOutcomeSentence(summary)).toBeNull();
  });
});

describe("an event's row", () => {
  test("says the log line and the service it was sent under", () => {
    expect(model.getEventSourceLabel(event())).toEqual({
      template: copy.EVENT_FROM_LOG_LINE_OF,
      values: { service: "oneuptime-nginx" },
    });
    expect(model.getEventLogService(event())).toEqual({
      id: SERVICE_ID,
      name: "oneuptime-nginx",
    });
  });

  test("a log line with no service, and an event a product sent", () => {
    expect(
      model.getEventSourceLabel(
        event({ attributes: { "oneuptime.log.id": "abc" } }),
      ),
    ).toEqual({ template: copy.EVENT_FROM_LOG_LINE, values: {} });
    expect(
      model.getEventSourceLabel(
        event({
          attributes: {},
          vendorName: "Okta",
          productName: "Okta",
        }),
      ),
    ).toEqual({
      template: copy.EVENT_FROM_PRODUCT,
      values: { product: "Okta" },
    });
    expect(
      model.getEventSourceLabel(
        event({ attributes: {}, vendorName: "", productName: "" }),
      ),
    ).toBeNull();
  });

  test("reads its message, else the address it asked for, else its class", () => {
    expect(model.getEventRowText(event())).toContain("../../proc/self/environ");
    expect(
      model.getEventRowText(
        event({ message: "", attributes: { "url.original": "/x?y=1" } }),
      ),
    ).toBe("/x?y=1");
    expect(model.getEventRowText(event({ message: "", attributes: {} }))).toBe(
      "HTTP Activity",
    );
  });

  test("opens the request's trace at the span that answered it, its logs, and its exception", () => {
    const links: ReturnType<typeof model.getEventLinks> = model.getEventLinks(
      event({
        attributes: {
          "oneuptime.log.id": "abc",
          "oneuptime.request.span_id": "a1b2c3d4e5f60718",
          "oneuptime.exception.fingerprint": "fp-1",
        },
      }),
    );

    // "abc" is not a line's id: there is no line to open.
    expect(
      links.map((link: { key: string }): string => {
        return link.key;
      }),
    ).toEqual(["trace", "logs", "exception"]);

    const trace: { path: string; query: Record<string, string> } = open(
      links[0]!.route,
    );

    expect(trace.path).toContain(TRACE_ID);
    expect(links[0]!.route.toString()).toContain("a1b2c3d4e5f60718");
    expect(links[0]!.icon).toBe(IconProp.Waterfall);
    expect(open(links[1]!.route).path).toBe(`${BASE}/logs`);
    expect(links[2]!.route.toString()).toContain("fp-1");
  });

  /*
   * #9620: the line an event was read from is its row's first link - named
   * as the row named where it came from - opening the Logs explorer on the
   * line itself, by its id, with its service's lines around it.
   */
  test("names the log line it was read from, and opens the Logs explorer on it", () => {
    const fromLine: SecurityCaseMatchedEventJson = event({
      attributes: { ...event().attributes, "oneuptime.log.id": LOG_ID },
    });
    const links: ReturnType<typeof model.getEventLinks> =
      model.getEventLinks(fromLine);

    expect(
      links.map((link: { key: string }): string => {
        return link.key;
      }),
    ).toEqual(["logLine", "trace", "logs"]);
    expect(links[0]).toMatchObject({
      label: copy.EVENT_FROM_LOG_LINE_OF,
      values: { service: "oneuptime-nginx" },
      icon: IconProp.DocumentText,
    });

    const line: { path: string; query: Record<string, string> } = open(
      links[0]!.route,
    );

    expect(line.path).toBe(`${BASE}/logs`);
    expect(line.query["log"]).toBe(LOG_ID);
    expect(new Date(line.query["logTime"]!).toISOString()).toBe(
      "2026-11-17T19:22:14.000Z",
    );
    expect(JSON.parse(line.query["filters"]!)).toEqual([
      ["primaryEntityId", [SERVICE_ID]],
    ]);
  });

  test("a line sent under no service is named a log line, and still opens", () => {
    const links: ReturnType<typeof model.getEventLinks> = model.getEventLinks(
      event({
        traceId: "",
        spanId: "",
        attributes: { "oneuptime.log.id": LOG_ID },
      }),
    );

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      key: "logLine",
      label: copy.EVENT_FROM_LOG_LINE,
      values: {},
    });
    expect(open(links[0]!.route).query["log"]).toBe(LOG_ID);
  });

  test("an event with no request opens nothing it cannot", () => {
    expect(
      model.getEventLinks(event({ traceId: "", attributes: {}, spanId: "" })),
    ).toEqual([]);
  });
});

/*
 * #9619: a detection keeps the events it matched when it fires. Those past
 * the events table's retention are listed as kept, and said to be; those of
 * sources the reader's role cannot read are counted, never shown.
 */
describe("what a detection kept", () => {
  test("says how many of its events are past their retention, shown as kept", () => {
    expect(
      model.getKeptPastRetentionNote(
        detection({ isKept: true, keptPastRetentionCount: 2 }),
      ),
    ).toEqual({ template: copy.KEPT_PAST_RETENTION, count: 2 });
  });

  test("says nothing when none is past, or the events were read again rather than kept", () => {
    expect(
      model.getKeptPastRetentionNote(
        detection({ isKept: true, keptPastRetentionCount: 0 }),
      ),
    ).toBeNull();
    expect(
      model.getKeptPastRetentionNote(
        detection({ isKept: false, keptPastRetentionCount: 3 }),
      ),
    ).toBeNull();
  });

  test("counts the ones the reader's role cannot read", () => {
    expect(
      model.getHiddenEventsNote(detection({ hiddenEventCount: 4 })),
    ).toEqual({ template: copy.HIDDEN_EVENTS, count: 4 });
    expect(model.getHiddenEventsNote(detection())).toBeNull();
  });

  test("the words are a plural each, counting what they say", () => {
    for (const template of [copy.KEPT_PAST_RETENTION, copy.HIDDEN_EVENTS]) {
      expect(template.one).toContain("{{count}}");
      expect(template.other).toContain("{{count}}");
    }
  });
});

describe("where to look next", () => {
  test("everything about the address, the events and log lines naming it, its service's logs, the traces, the story and the connected signals", () => {
    const links: ReturnType<typeof model.getLookNextLinks> =
      model.getLookNextLinks({ detection: detection(), caseId: CASE_ID });

    expect(
      links.map((link: { key: string }): string => {
        return link.key;
      }),
    ).toEqual([
      "entity",
      "events",
      "logLines",
      "serviceLogs",
      "traces",
      "story",
      "connected",
    ]);

    const entity: { path: string; query: Record<string, string> } = open(
      links[0]!.route,
    );

    expect(entity.path).toBe(`${BASE}/security-events/entity-risk/entity`);
    expect(Object.values(entity.query)).toContain("35.196.249.14");

    const events: { path: string; query: Record<string, string> } = open(
      links[1]!.route,
    );

    expect(events.path).toBe(`${BASE}/security-events`);
    expect(events.query["search"]).toBe("observable:35.196.249.14");
    // The detection's window, five minutes either side.
    expect(events.query["start"]).toBe("2026-11-17T19:17:00.000Z");
    expect(events.query["end"]).toBe("2026-11-17T19:34:00.000Z");

    expect(open(links[2]!.route).path).toBe(`${BASE}/logs`);
    expect(links[2]!.route.toString()).toContain("35.196.249.14");
    expect(links[3]!.values).toEqual({ service: "oneuptime-nginx" });
    expect(links[3]!.route.toString()).toContain(SERVICE_ID);
    expect(open(links[4]!.route).path).toBe(`${BASE}/traces`);
    expect(links[4]!.route.toString()).toContain(TRACE_ID);
    expect(links[4]!.count).toBe(1);
    expect(open(links[5]!.route).path).toBe(
      `${BASE}/security-events/cases/${CASE_ID.toString()}/story`,
    );
    expect(open(links[6]!.route).path).toBe(
      `${BASE}/security-events/cases/${CASE_ID.toString()}/connected-signals`,
    );
  });

  test("a detection about nothing in particular leaves out what it has nothing to go on for", () => {
    const links: ReturnType<typeof model.getLookNextLinks> =
      model.getLookNextLinks({
        detection: detection({ groupValue: "", events: [] }),
        caseId: CASE_ID,
      });

    expect(
      links.map((link: { key: string }): string => {
        return link.key;
      }),
    ).toEqual(["story", "connected"]);
  });

  test("a case with no detection still offers its story and its connected signals", () => {
    expect(
      model
        .getLookNextLinks({ detection: null, caseId: CASE_ID })
        .map((link: { key: string }): string => {
          return link.key;
        }),
    ).toEqual(["story", "connected"]);
  });

  test("the entity is typed by the field the rule groups by, else by its shape; a correlation's pair is none", () => {
    expect(model.getDetectionEntity(detection())).toEqual({
      type: SecurityEntityType.IpAddress,
      value: "35.196.249.14",
    });
    expect(
      model.getDetectionEntity(
        detection({
          groupValue: "k.morgan@acme.example",
          rule: rule({ groupByField: "targetUser" }),
        }),
      ),
    ).toEqual({
      type: SecurityEntityType.User,
      value: "k.morgan@acme.example",
    });
    expect(
      model.getDetectionEntity(detection({ groupValue: "1.2.3.4 / bob" })),
    ).toBeNull();
    expect(model.getDetectionEntity(detection({ groupValue: "" }))).toBeNull();
  });

  test("the case's Detections and Evidence pages", () => {
    expect(open(model.getCaseDetectionsRoute(CASE_ID)).path).toBe(
      `${BASE}/security-events/cases/${CASE_ID.toString()}/detections`,
    );
    expect(open(model.getCaseEvidenceRoute(CASE_ID)).path).toBe(
      `${BASE}/security-events/cases/${CASE_ID.toString()}/evidence`,
    );
  });
});
