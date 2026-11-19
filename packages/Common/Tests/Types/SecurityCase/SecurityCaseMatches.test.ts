import { JSONObject } from "../../../Types/JSON";
import {
  SECURITY_CASE_MATCHES_API_PATH,
  SecurityCaseMatchBasis,
  SecurityCaseMatchRuleJson,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
  SecurityCaseMatchesSource,
  getOpeningMatchedDetection,
  parseSecurityCaseMatchRule,
  parseSecurityCaseMatches,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import { SECURITY_CASE_CONTEXT_API_PATH } from "../../../Types/SecurityCase/SecurityCaseContext";
import { describe, expect, test } from "@jest/globals";

/*
 * Why a case was opened, and what matched, as the Dashboard reads the
 * route's answer: defensively - a field an older server left out, or one of
 * the wrong shape, reads as nothing, never as a broken page (#9556).
 */

const EVENT: JSONObject = {
  time: "2026-11-17T19:22:14.000Z",
  eventUid: "log:abc:0",
  sourceId: "11111111-1111-4111-8111-111111111111",
  severityName: "Medium",
  className: "HTTP Activity",
  categoryName: "Application Activity",
  activityName: "Get",
  statusName: "Failure",
  message:
    "Path traversal attempt: GET /api/w/admins/jobs_u/get_log_file/../../../../proc/self/environ → 404",
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
  attributes: { "oneuptime.log.id": "abc" },
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  sessionId: "",
  requestOutcome: "Rejected",
  hunt: null,
};

const DETECTION: JSONObject = {
  id: "22222222-2222-4222-8222-222222222222",
  source: "Detection Rule",
  title: "Path traversal attempts — 35.196.249.14",
  severity: "Medium",
  groupValue: "35.196.249.14",
  ruleName: "Path traversal attempts",
  eventCount: 12,
  fireCount: 1,
  firstSeenAt: "2026-11-17T19:28:00.000Z",
  lastSeenAt: "2026-11-17T19:28:00.000Z",
  sampleMessage: "Path traversal attempt: GET /x → 404",
  isOpening: true,
  rule: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Path traversal attempts",
    description: "Three or more requests from one IP address ...",
    isEnabled: true,
    isRealTime: false,
    isCorrelation: false,
    threshold: 3,
    groupByField: "principalIp",
    distinctCountField: "",
    windowInMinutes: 5,
    sigmaRuleYaml: "title: Path traversal attempts",
    falsePositives: ["Vulnerability scanners your team runs"],
    references: ["https://owasp.org/"],
    lookFor: [{ field: "targetResource", values: ["../../"] }],
  },
  threatIntelFeedId: "",
  securityEventConnectionId: "",
  basis: "RuleCondition",
  windowStart: "2026-11-17T19:22:00.000Z",
  windowEnd: "2026-11-17T19:29:00.000Z",
  events: [EVENT],
  matchedEventCount: 12,
  outcomes: { Rejected: 12 },
};

describe("the route", () => {
  test("sits beside the case's Story and Impact", () => {
    expect(SECURITY_CASE_MATCHES_API_PATH).toBe(
      `${SECURITY_CASE_CONTEXT_API_PATH}/matches`,
    );
    expect(SECURITY_CASE_MATCHES_API_PATH).toBe(
      "/security-case-context/matches",
    );
  });
});

describe("reading the answer", () => {
  test("reads every field of a detection, its rule and its events", () => {
    const matches: SecurityCaseMatchesJson = parseSecurityCaseMatches({
      detections: [DETECTION],
      detectionCount: 3,
      unreadableSources: [],
      failedSources: [],
    });

    expect(matches.detectionCount).toBe(3);
    expect(matches.detections).toHaveLength(1);

    const detection: SecurityCaseMatchedDetectionJson = matches.detections[0]!;

    expect(detection.basis).toBe(SecurityCaseMatchBasis.RuleCondition);
    expect(detection.rule?.threshold).toBe(3);
    expect(detection.rule?.groupByField).toBe("principalIp");
    expect(detection.rule?.windowInMinutes).toBe(5);
    expect(detection.rule?.falsePositives).toEqual([
      "Vulnerability scanners your team runs",
    ]);
    expect(detection.rule?.lookFor).toEqual([
      { field: "targetResource", values: ["../../"] },
    ]);
    expect(detection.matchedEventCount).toBe(12);
    expect(detection.outcomes).toEqual({ Rejected: 12 });
    expect(detection.events).toHaveLength(1);
    expect(detection.events[0]!.traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(detection.events[0]!.requestOutcome).toBe("Rejected");
    expect(detection.events[0]!.attributes).toEqual({
      "oneuptime.log.id": "abc",
    });
  });

  test("reads nothing from an answer of the wrong shape", () => {
    for (const body of [null, undefined, {}, { detections: "nope" }]) {
      expect(parseSecurityCaseMatches(body as JSONObject)).toEqual({
        detections: [],
        detectionCount: 0,
        unreadableSources: [],
        failedSources: [],
      });
    }
  });

  test("leaves out a detection with no id, and an event it cannot read", () => {
    const matches: SecurityCaseMatchesJson = parseSecurityCaseMatches({
      detections: [
        { ...DETECTION, id: "" },
        "not a detection",
        { ...DETECTION, events: [EVENT, "x", { nothing: true }] },
      ],
    });

    expect(matches.detections).toHaveLength(1);
    expect(matches.detections[0]!.events).toHaveLength(1);
    // Never fewer than it explains.
    expect(matches.detectionCount).toBe(1);
  });

  test("reads an unknown basis as the events naming what it is about", () => {
    const matches: SecurityCaseMatchesJson = parseSecurityCaseMatches({
      detections: [{ ...DETECTION, basis: "Guesswork" }],
    });

    expect(matches.detections[0]!.basis).toBe(
      SecurityCaseMatchBasis.NamedEntities,
    );
  });

  test("keeps a count it could not read as unknown, never zero", () => {
    const matches: SecurityCaseMatchesJson = parseSecurityCaseMatches({
      detections: [
        {
          ...DETECTION,
          matchedEventCount: null,
          windowStart: null,
          windowEnd: null,
          events: [],
          outcomes: { Rejected: -1, "": "x" },
        },
      ],
    });

    expect(matches.detections[0]!.matchedEventCount).toBeNull();
    expect(matches.detections[0]!.windowStart).toBeNull();
    expect(matches.detections[0]!.outcomes).toEqual({});
  });

  test("reads only the sources it knows", () => {
    const matches: SecurityCaseMatchesJson = parseSecurityCaseMatches({
      detections: [],
      unreadableSources: ["Rules", "Elsewhere"],
      failedSources: ["Events", 4],
    });

    expect(matches.unreadableSources).toEqual([
      SecurityCaseMatchesSource.Rules,
    ]);
    expect(matches.failedSources).toEqual([SecurityCaseMatchesSource.Events]);
  });

  test("reads a rule with no id as none, and holds its counting to sense", () => {
    expect(parseSecurityCaseMatchRule({ name: "x" })).toBeNull();
    expect(parseSecurityCaseMatchRule("x")).toBeNull();

    const rule: ReturnType<typeof parseSecurityCaseMatchRule> =
      parseSecurityCaseMatchRule({
        id: "r",
        threshold: 0,
        windowInMinutes: -4,
        lookFor: [
          { field: "", values: ["a"] },
          { field: "f", values: [] },
        ],
      });

    expect(rule?.threshold).toBe(1);
    expect(rule?.windowInMinutes).toBe(1);
    expect(rule?.lookFor).toEqual([]);
    expect(rule?.isEnabled).toBe(false);
  });
});

describe("the detection that opened the case", () => {
  test("is the one marked so, else the first", () => {
    const matches: SecurityCaseMatchesJson = parseSecurityCaseMatches({
      detections: [
        { ...DETECTION, id: "a", isOpening: false },
        { ...DETECTION, id: "b", isOpening: true },
      ],
    });

    expect(getOpeningMatchedDetection(matches)?.id).toBe("b");

    const unmarked: SecurityCaseMatchesJson = parseSecurityCaseMatches({
      detections: [
        { ...DETECTION, id: "a", isOpening: false },
        { ...DETECTION, id: "b", isOpening: false },
      ],
    });

    expect(getOpeningMatchedDetection(unmarked)?.id).toBe("a");
    expect(getOpeningMatchedDetection({ detections: [] })).toBeNull();
  });
});

/*
 * What a detection kept when it fired (#9619), and a rule's own response
 * steps (#9621), as the Dashboard reads them - defensively, as every field.
 */
describe("what a detection kept, and a rule's steps", () => {
  test("reads whether the events are the ones it kept, how many are past retention and how many are hidden", () => {
    const detection: SecurityCaseMatchedDetectionJson =
      parseSecurityCaseMatches({
        detections: [
          {
            ...DETECTION,
            isKept: true,
            keptPastRetentionCount: 1,
            hiddenEventCount: 2,
            events: [{ ...EVENT, retentionDate: "2026-11-24T19:22:20.000Z" }],
          },
        ],
      }).detections[0]!;

    expect(detection.isKept).toBe(true);
    expect(detection.keptPastRetentionCount).toBe(1);
    expect(detection.hiddenEventCount).toBe(2);
    expect(detection.events[0]!.retentionDate).toBe("2026-11-24T19:22:20.000Z");
  });

  test("an older server's answer reads as events read again, none kept, none hidden", () => {
    const detection: SecurityCaseMatchedDetectionJson =
      parseSecurityCaseMatches({ detections: [DETECTION] }).detections[0]!;

    expect(detection.isKept).toBe(false);
    expect(detection.keptPastRetentionCount).toBe(0);
    expect(detection.hiddenEventCount).toBe(0);
    expect(detection.events[0]!.retentionDate).toBeUndefined();
    expect(detection.rule!.responseSteps).toEqual([]);
  });

  test("reads counts of the wrong shape as none, and a retention date it cannot read as not known", () => {
    const detection: SecurityCaseMatchedDetectionJson =
      parseSecurityCaseMatches({
        detections: [
          {
            ...DETECTION,
            isKept: "yes",
            keptPastRetentionCount: "1",
            hiddenEventCount: -3,
            events: [{ ...EVENT, retentionDate: "soon" }],
          },
        ],
      }).detections[0]!;

    expect(detection.isKept).toBe(false);
    expect(detection.keptPastRetentionCount).toBe(0);
    expect(detection.hiddenEventCount).toBe(0);
    expect(detection.events[0]!.retentionDate).toBeUndefined();
  });

  test("reads a rule's own response steps, leaving out one that does not read", () => {
    const rule: SecurityCaseMatchRuleJson | null = parseSecurityCaseMatchRule({
      ...(DETECTION["rule"] as JSONObject),
      responseSteps: [
        {
          id: "page-payments",
          phase: "Contain",
          text: "Page the payments on-call.",
        },
        { id: "no-phase", text: "A step under no part of the plan." },
        "not a step",
      ],
    });

    expect(rule!.responseSteps).toEqual([
      {
        id: "page-payments",
        phase: "Contain",
        text: "Page the payments on-call.",
      },
    ]);
  });
});
