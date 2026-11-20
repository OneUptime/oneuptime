import { beforeAll, describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { JSONObject } from "Common/Types/JSON";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
} from "Common/Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  markClientAddressTrust,
  resolveClientAddress,
} from "Common/Utils/SecurityEvent/ClientAddressTrust";
import { RequestTraceAssessment } from "Common/Utils/SecurityEvent/RequestOutcome";
import {
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  markClientAddressScrubbed,
} from "Common/Utils/SecurityEvent/ScrubbedAddress";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * AN ADDRESS A REQUEST ONLY CLAIMED (#10416), WHERE A PERSON MEETS IT.
 *
 * Whoever sends a request writes its X-Forwarded-For, and instrumentations
 * fill client.address from it, so Security Events keeps such an address as
 * a claim and blames none of it. The case's Response Plan never offers to
 * block it - not even when something else names it as the case's entity -
 * and says to find the real address where the requests came in. An event
 * shows it as Claimed IP, "Claimed by the request, not verified", and What
 * happened next says so too.
 */

type Copy =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/ClaimedClientAddressCopy");
type HiddenCopy =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressCopy");
type Model =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/ClaimedClientAddressModel");
type Plan =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlan");
type PlanTypes =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseTypes");
type Fields =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields");
type Story =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory");

let copy: Copy;
let hiddenCopy: HiddenCopy;
let model: Model;
let plan: Plan;
let planTypes: PlanTypes;
let fields: Fields;
let story: Story;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ENGLISH: Translator = createTranslator(undefined, "en");

// The address the sender wrote, and the one its connection came from.
const CLAIMED: string = "192.0.2.44";
const ATTACKER: string = "203.0.113.7";

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `/dashboard/${PROJECT_ID}/security-events/cases`,
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

  copy = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ClaimedClientAddressCopy"
  );
  hiddenCopy = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressCopy"
  );
  model = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/ClaimedClientAddressModel"
  );
  plan = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlan"
  );
  planTypes = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseTypes"
  );
  fields = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields"
  );
  story = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory"
  );
});

// What the scans leave on an event whose request claimed an address.
function claimedAttributes(evidence: {
  peer?: string;
  forwardedClient?: string;
  forwardedFor?: string;
}): { [key: string]: string } {
  const attributes: JSONObject = { "web.attack.kind": "path-traversal" };

  markClientAddressTrust(
    attributes,
    resolveClientAddress({
      ...evidence,
      forwardedClientFrom: evidence.forwardedClient ? "client.address" : "",
    }),
  );

  return attributes as { [key: string]: string };
}

function matchedEvent(
  overrides: Partial<SecurityCaseMatchedEventJson> = {},
): SecurityCaseMatchedEventJson {
  return {
    time: "2026-11-20T10:00:05.000Z",
    eventUid: "span:abc:0",
    sourceId: "",
    severityName: "Low",
    className: "HTTP Activity",
    categoryName: "",
    activityName: "GET",
    statusName: "Failure",
    message:
      "Path traversal attempt: GET /download?file=../../etc/passwd → 404",
    vendorName: "",
    productName: "",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: null,
    processName: "",
    processCommandLine: "",
    observables: [],
    mitreTactics: [],
    mitreTechniques: [],
    attributes: claimedAttributes({ forwardedClient: CLAIMED }),
    traceId: "",
    spanId: "",
    sessionId: "",
    requestOutcome: SecurityEventRequestOutcome.Rejected,
    hunt: null,
    ...overrides,
  };
}

function matchesOf(
  events: Array<SecurityCaseMatchedEventJson>,
): SecurityCaseMatchesJson {
  const detection: SecurityCaseMatchedDetectionJson = {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: "Path traversal attempts",
    severity: "Medium",
    groupValue: "",
    ruleName: "Path traversal attempts",
    eventCount: events.length,
    fireCount: 1,
    firstSeenAt: "2026-11-20T10:01:00.000Z",
    lastSeenAt: "2026-11-20T10:01:00.000Z",
    sampleMessage: "",
    isOpening: true,
    rule: null,
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: "2026-11-20T10:00:00.000Z",
    windowEnd: "2026-11-20T10:02:00.000Z",
    events,
    isKept: true,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: events.length,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: events.length },
  };

  return {
    detections: [detection],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

type PlanInput = Parameters<Plan["buildResponsePlan"]>[0];
type BuiltPlan = ReturnType<Plan["buildResponsePlan"]>;
type BuiltStep = BuiltPlan["steps"][number];

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    entities: [],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1190"],
    isAssigned: false,
    hasIncident: false,
    stage: SecurityCaseStage.New,
    hasContainedStatus: true,
    matches: matchesOf([
      matchedEvent(),
      matchedEvent({ eventUid: "span:abc:1" }),
    ]),
    playbooks: [],
    ranPlaybookIds: [],
    tasks: [],
    ai: null,
    ...overrides,
  };
}

const CLAIMED_STEP_KEY: string = "contain:claimed-address";

function step(built: BuiltPlan, key: string): BuiltStep | undefined {
  return built.steps.find((item: BuiltStep): boolean => {
    return item.key === key;
  });
}

function blockSteps(built: BuiltPlan): Array<string> {
  return built.steps
    .filter((item: BuiltStep): boolean => {
      return item.key.startsWith("contain:block-ip");
    })
    .map((item: BuiltStep): string => {
      return item.key;
    });
}

describe("the case's Response Plan never offers to block an address the sender wrote", () => {
  test("a case whose requests only claimed an address says to find the real one, naming the claim as claimed", () => {
    const built: BuiltPlan = plan.buildResponsePlan(planInput());
    const claimed: BuiltStep | undefined = step(built, CLAIMED_STEP_KEY);

    expect(claimed).toBeDefined();
    expect(claimed!.phase).toBe(planTypes.ResponsePhase.Contain);
    expect(claimed!.text).toEqual({
      template: hiddenCopy.STEP_FIND_HIDDEN_ADDRESS,
      values: {},
    });
    expect(claimed!.detail).toEqual({
      template: copy.CLAIMED_ADDRESS_NOT_VERIFIED,
      values: { address: CLAIMED },
    });
    expect(claimed!.isDetailWarning).toBe(true);
    expect(claimed!.isOutsideOneUptime).toBe(true);
    // Nothing to paste into a firewall: it is not the address to block.
    expect(claimed!.copyValue).toBeUndefined();
    expect(blockSteps(built)).toEqual([]);
  });

  test("even an entity that names the claimed address - wherever it came from - is never offered for blocking", () => {
    const built: BuiltPlan = plan.buildResponsePlan(
      planInput({
        entities: [{ type: SecurityEntityType.IpAddress, value: CLAIMED }],
      }),
    );

    expect(blockSteps(built)).toEqual([]);
    expect(
      built.steps.some((item: BuiltStep): boolean => {
        return item.copyValue === CLAIMED;
      }),
    ).toBe(false);
    // With no address left to block, it says to find the real one.
    expect(step(built, CLAIMED_STEP_KEY)).toBeDefined();
  });

  test("a verified address is blocked as always; the claim beside it never is", () => {
    const built: BuiltPlan = plan.buildResponsePlan(
      planInput({
        entities: [
          { type: SecurityEntityType.IpAddress, value: ATTACKER },
          { type: SecurityEntityType.IpAddress, value: CLAIMED },
        ],
        matches: matchesOf([
          matchedEvent({
            principalIp: ATTACKER,
            attributes: claimedAttributes({
              peer: ATTACKER,
              forwardedClient: CLAIMED,
            }),
          }),
        ]),
      }),
    );

    expect(blockSteps(built)).toEqual([
      plan.getResponseStepKey("contain:block-ip", ATTACKER),
    ]);
    expect(step(built, CLAIMED_STEP_KEY)).toBeUndefined();
  });

  test("an address one event verifies stays blockable, though another event only claimed it", () => {
    const built: BuiltPlan = plan.buildResponsePlan(
      planInput({
        entities: [{ type: SecurityEntityType.IpAddress, value: ATTACKER }],
        matches: matchesOf([
          matchedEvent({
            attributes: claimedAttributes({ forwardedClient: ATTACKER }),
          }),
          matchedEvent({
            eventUid: "span:abc:1",
            principalIp: ATTACKER,
            attributes: claimedAttributes({ peer: ATTACKER }),
          }),
        ]),
      }),
    );

    expect(blockSteps(built)).toEqual([
      plan.getResponseStepKey("contain:block-ip", ATTACKER),
    ]);
  });

  test("a claim a scrub rule hid says only that it was claimed", () => {
    const built: BuiltPlan = plan.buildResponsePlan(
      planInput({
        matches: matchesOf([
          matchedEvent({
            attributes: claimedAttributes({
              peer: "10.0.0.5",
              forwardedClient: "[REDACTED]",
            }),
          }),
        ]),
      }),
    );

    expect(step(built, CLAIMED_STEP_KEY)!.detail).toEqual({
      template: copy.CLAIMED_NOT_VERIFIED,
      values: {},
    });
  });

  test("a case whose addresses a scrub rule hid says that instead, once", () => {
    const attributes: JSONObject = {};
    markClientAddressScrubbed(attributes, {
      scrubbed: { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
      place: ScrubbedAddressPlace.SpanAttributes,
    });

    const built: BuiltPlan = plan.buildResponsePlan(
      planInput({
        matches: matchesOf([
          matchedEvent({ attributes: attributes as { [key: string]: string } }),
        ]),
      }),
    );

    expect(step(built, "contain:hidden-address")).toBeDefined();
    expect(step(built, CLAIMED_STEP_KEY)).toBeUndefined();
  });

  test("a case with no event names nothing claimed", () => {
    expect(model.getCaseClaimedClientAddress(null)).toBeNull();
    expect(
      step(
        plan.buildResponsePlan(planInput({ matches: null })),
        CLAIMED_STEP_KEY,
      ),
    ).toBeUndefined();
    expect(model.getCaseClaimedOnlyAddresses(null).size).toBe(0);
  });
});

describe("an event's Claimed IP", () => {
  function securityEvent(values: Partial<SecurityEvent>): SecurityEvent {
    return Object.assign(new SecurityEvent(), values);
  }

  test("shows what the request claimed beside the address it came from, and filters by it", () => {
    const overview: Array<
      ReturnType<Fields["buildSecurityEventOverviewFields"]>[number]
    > = fields.buildSecurityEventOverviewFields(
      securityEvent({
        principalIp: ATTACKER,
        attributes: claimedAttributes({
          peer: ATTACKER,
          forwardedClient: CLAIMED,
        }),
      }),
    );
    const labels: Array<string> = overview.map(
      (field: { label: string }): string => {
        return field.label;
      },
    );

    expect(labels).toContain("Principal IP");
    expect(labels.indexOf(copy.CLAIMED_IP)).toBe(
      labels.indexOf("Principal IP") + 1,
    );

    const claimed: { value: string; facetKey?: string; facetValue?: string } =
      overview[labels.indexOf(copy.CLAIMED_IP)]!;

    expect(claimed.value).toBe(CLAIMED);
    expect(claimed.facetKey).toBe(
      `attributes.${SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress}`,
    );
    expect(claimed.facetValue).toBe(CLAIMED);
  });

  test("is all an event shows of an address it only claimed: no Principal IP", () => {
    const labels: Array<string> = fields
      .buildSecurityEventOverviewFields(
        securityEvent({
          attributes: claimedAttributes({ forwardedClient: CLAIMED }),
        }),
      )
      .map((field: { label: string }): string => {
        return field.label;
      });

    expect(labels).not.toContain("Principal IP");
    expect(labels).toContain(copy.CLAIMED_IP);
  });

  test("says a scrub rule hid a claim it cannot show, and offers no filter for it", () => {
    const field: ReturnType<Fields["buildClaimedIpField"]> =
      fields.buildClaimedIpField(
        securityEvent({
          attributes: claimedAttributes({
            peer: "10.0.0.5",
            forwardedClient: "[REDACTED]",
          }),
        }),
      );

    expect(field).toEqual(
      expect.objectContaining({
        label: copy.CLAIMED_IP,
        value: hiddenCopy.HIDDEN_BY_A_SCRUB_RULE,
        isValueTranslated: true,
      }),
    );
    expect(field!.facetKey).toBeUndefined();
  });

  test("an event whose request claimed nothing beside its address has no Claimed IP", () => {
    expect(
      fields.buildClaimedIpField(
        securityEvent({
          principalIp: ATTACKER,
          attributes: claimedAttributes({
            peer: ATTACKER,
            forwardedClient: ATTACKER,
          }),
        }),
      ),
    ).toBeNull();
  });
});

describe("What happened next", () => {
  test("reads the claim the event kept, and a fresh read of the trace never makes it who sent it", () => {
    const facts: ReturnType<Story["readSecurityEventRequestFacts"]> =
      story.readSecurityEventRequestFacts(
        Object.assign(new SecurityEvent(), {
          attributes: claimedAttributes({ forwardedClient: CLAIMED }),
        }),
      );

    expect(facts.clientAddress).toBe("");
    expect(facts.claimedClientAddress).toEqual(
      expect.objectContaining({ address: CLAIMED, isOnlyAddress: true }),
    );

    // The trace's server span only claims too.
    const assessment: RequestTraceAssessment = {
      outcome: SecurityEventRequestOutcome.Rejected,
      serverSpanId: "server",
      statusCode: 404,
      method: "get",
      url: "/download",
      route: "",
      clientAddress: "",
      client: resolveClientAddress({
        forwardedClient: "198.51.100.9",
        forwardedClientFrom: "client.address",
      }),
      userAgent: "",
      userId: "",
      durationMs: 3,
      exception: undefined,
      database: undefined,
      requestedDelaySeconds: 0,
    };

    const fresh: ReturnType<Story["mergeAssessment"]> = story.mergeAssessment(
      story.readSecurityEventRequestFacts(new SecurityEvent()),
      assessment,
    );

    expect(fresh.clientAddress).toBe("");
    expect(fresh.claimedClientAddress).toEqual(
      expect.objectContaining({ address: "198.51.100.9" }),
    );
  });

  test("its words are the issue's", () => {
    expect(copy.CLAIMED_NOT_VERIFIED).toBe(
      "Claimed by the request, not verified",
    );
    expect(
      ENGLISH.translateTemplate(copy.CLAIMED_ADDRESS_NOT_VERIFIED, {
        address: CLAIMED,
      }),
    ).toBe(`Claimed by the request, not verified: ${CLAIMED}`);
  });
});
