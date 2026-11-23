import { beforeAll, describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
} from "Common/Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import { SecurityAttackCampaign } from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import { resolveClientAddress } from "Common/Utils/SecurityEvent/ClientAddressTrust";
import { RequestTraceAssessment } from "Common/Utils/SecurityEvent/RequestOutcome";
import WebAttackLogParser from "Common/Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  HiddenClientAddress,
  ScrubbedAddressKind,
  ScrubbedAddressPlace,
  markClientAddressScrubbed,
  nameClientAddressScrubRule,
} from "Common/Utils/SecurityEvent/ScrubbedAddress";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { IPV4_ADDRESS_MASK as SCRUB_IPV4_MASK } from "Common/Utils/Telemetry/ScrubIpAddress";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";

/*
 * AN ADDRESS A SCRUB RULE HID, ON THE DASHBOARD (#10397): an event's
 * Principal IP and What happened next, a campaign's row, a case's Response
 * Plan where it would say which address to block, and the Overview's setup
 * item - each saying a scrub rule hid the address, which rule when the
 * scan found one, and opening the Scrub Rules it is in. An event that
 * names its address, as the address vault will make it do (#10395), shows
 * the address, never this.
 */

type Copy =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressCopy");
type Model =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressModel");
type RouteModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressRoute");
type ScrubIt =
  typeof import("../../FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryScrubIt");
type Plan =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlan");
type PlanTypes =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseTypes");
type Setup =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel");
type Campaigns =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityAttackCampaignsModel");
type Fields =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields");
type Story =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory");

let copy: Copy;
let model: Model;
let routes: RouteModule;
let scrubIt: ScrubIt;
let plan: Plan;
let planTypes: PlanTypes;
let setup: Setup;
let campaigns: Campaigns;
let fields: Fields;
let story: Story;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RULE_ID: string = "44444444-4444-4444-8444-444444444444";
const ENGLISH: Translator = createTranslator(undefined, "en");

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
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressCopy"
  );
  model = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressModel"
  );
  routes = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenClientAddressRoute"
  );
  scrubIt = await import(
    "../../FeatureSet/Dashboard/src/Components/DataSecurity/TelemetryScrubIt"
  );
  plan = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlan"
  );
  planTypes = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseTypes"
  );
  setup = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel"
  );
  campaigns = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityAttackCampaignsModel"
  );
  fields = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields"
  );
  story = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventRequestStory"
  );
});

// What a scan leaves on an event whose client address a rule hid.
function hiddenAttributes(data: {
  place?: ScrubbedAddressPlace;
  value?: string;
  ruleName?: string;
}): { [key: string]: string } {
  const attributes: JSONObject = {
    "web.attack.kind": "path-traversal",
  };

  markClientAddressScrubbed(attributes, {
    scrubbed:
      data.value === SCRUB_IPV4_MASK
        ? { kind: ScrubbedAddressKind.Masked, value: SCRUB_IPV4_MASK }
        : { kind: ScrubbedAddressKind.Redacted, value: "[REDACTED]" },
    place: data.place || ScrubbedAddressPlace.LogBody,
  });

  if (data.ruleName) {
    nameClientAddressScrubRule(attributes, {
      id: RULE_ID,
      name: data.ruleName,
    });
  }

  return attributes as { [key: string]: string };
}

function matchedEvent(
  overrides: Partial<SecurityCaseMatchedEventJson> = {},
): SecurityCaseMatchedEventJson {
  return {
    time: "2026-11-20T10:00:05.000Z",
    eventUid: "log:abc:0",
    sourceId: "",
    severityName: "Low",
    className: "HTTP Activity",
    categoryName: "",
    activityName: "GET",
    statusName: "Failure",
    message: "Path traversal attempt: GET /static/../../etc/passwd → 404",
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
    attributes: hiddenAttributes({ ruleName: "Scrub IP addresses" }),
    traceId: "",
    spanId: "",
    sessionId: "",
    requestOutcome: SecurityEventRequestOutcome.Rejected,
    hunt: null,
    ...overrides,
  };
}

function detection(
  events: Array<SecurityCaseMatchedEventJson>,
): SecurityCaseMatchedDetectionJson {
  return {
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
}

function matchesOf(
  events: Array<SecurityCaseMatchedEventJson>,
): SecurityCaseMatchesJson {
  return {
    detections: [detection(events)],
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
      matchedEvent({ eventUid: "log:abc:1" }),
    ]),
    playbooks: [],
    ranPlaybookIds: [],
    tasks: [],
    ai: null,
    ...overrides,
  };
}

const HIDDEN_STEP_KEY: string = "contain:hidden-address";

function hiddenStep(built: BuiltPlan): BuiltStep | undefined {
  return built.steps.find((item: BuiltStep): boolean => {
    return item.key === HIDDEN_STEP_KEY;
  });
}

describe("where an address a scrub rule hid links to", () => {
  test("the logs' or the traces' Scrub Rules, the pages Data Security's Scrub It opens", () => {
    expect(model.HIDDEN_ADDRESS_RULES_PAGES).toEqual({
      log: PageMap.LOGS_SETTINGS_SCRUB_RULES,
      trace: PageMap.TRACES_SETTINGS_SCRUB_RULES,
    });
    expect(model.HIDDEN_ADDRESS_RULES_PAGES.log).toBe(
      scrubIt.RULES_PAGE_OF_SIGNAL.log,
    );
    expect(model.HIDDEN_ADDRESS_RULES_PAGES.trace).toBe(
      scrubIt.RULES_PAGE_OF_SIGNAL.trace,
    );

    expect(routes.getHiddenAddressRulesRoute("log")?.toString()).toBe(
      scrubIt.getRulesRoute("log").toString(),
    );
    expect(routes.getHiddenAddressRulesRoute("trace")?.toString()).toBe(
      scrubIt.getRulesRoute("trace").toString(),
    );
    expect(routes.getHiddenAddressRulesRoute("log")?.toString()).toContain(
      PROJECT_ID,
    );
    expect(routes.getHiddenAddressRulesRoute(null)).toBeNull();
  });
});

describe("a case whose every event had its address hidden", () => {
  test("is read so only when every event a detection matched had it hidden, naming the rule when one does", () => {
    const named: SecurityCaseMatchedEventJson = matchedEvent();
    const unnamed: SecurityCaseMatchedEventJson = matchedEvent({
      attributes: hiddenAttributes({}),
    });

    expect(model.getCaseHiddenClientAddress(null)).toBeNull();
    expect(model.getCaseHiddenClientAddress(matchesOf([]))).toBeNull();
    expect(
      model.getCaseHiddenClientAddress(matchesOf([unnamed, named]))?.ruleName,
    ).toBe("Scrub IP addresses");
    expect(
      model.getCaseHiddenClientAddress(matchesOf([unnamed]))?.ruleName,
    ).toBe("");

    // One that names its address, or never had one, is not a hidden one.
    expect(
      model.getCaseHiddenClientAddress(
        matchesOf([named, matchedEvent({ principalIp: "203.0.113.7" })]),
      ),
    ).toBeNull();
    expect(
      model.getCaseHiddenClientAddress(
        matchesOf([named, matchedEvent({ attributes: {} })]),
      ),
    ).toBeNull();
  });

  test("its Response Plan says to find the address where the requests came in, and which rule hid it, where it would say to block it", () => {
    const built: BuiltPlan = plan.buildResponsePlan(planInput());
    const step: BuiltStep | undefined = hiddenStep(built);

    expect(step).toBeDefined();
    expect(step!.phase).toBe(planTypes.ResponsePhase.Contain);
    expect(step!.text).toEqual({
      template: copy.STEP_FIND_HIDDEN_ADDRESS,
      values: {},
    });
    expect(step!.detail).toEqual({
      template: copy.ADDRESS_HIDDEN_FROM_CASE_BY_RULE,
      values: { rule: "Scrub IP addresses" },
    });
    expect(step!.isDetailWarning).toBe(true);
    expect(step!.isOutsideOneUptime).toBe(true);
    expect(step!.copyValue).toBeUndefined();
    expect(step!.action?.kind).toBe(planTypes.ResponseActionKind.OpenRoute);
    expect(step!.action?.title).toBe(copy.OPEN_SCRUB_RULES);
    expect(step!.action?.route?.toString()).toBe(
      routes.getHiddenAddressRulesRoute("log")?.toString(),
    );
    expect(step!.completion).toBe(planTypes.ResponseStepCompletion.ByTask);

    // Where the block step would be: the first of the Contain steps.
    const containKeys: Array<string> = built.steps
      .filter((item: BuiltStep): boolean => {
        return item.phase === planTypes.ResponsePhase.Contain;
      })
      .map((item: BuiltStep): string => {
        return item.key;
      });
    expect(containKeys[0]).toBe(HIDDEN_STEP_KEY);
    expect(
      built.steps.some((item: BuiltStep): boolean => {
        return item.key.startsWith("contain:block-ip");
      }),
    ).toBe(false);
  });

  test("without a rule's name, it says a scrub rule hid it; hidden in a trace, it opens the traces' rules", () => {
    const step: BuiltStep | undefined = hiddenStep(
      plan.buildResponsePlan(
        planInput({
          matches: matchesOf([
            matchedEvent({
              attributes: hiddenAttributes({
                place: ScrubbedAddressPlace.SpanAttributes,
                value: SCRUB_IPV4_MASK,
              }),
            }),
          ]),
        }),
      ),
    );

    expect(step!.detail).toEqual({
      template: copy.ADDRESS_HIDDEN_FROM_CASE,
      values: {},
    });
    expect(step!.action?.route?.toString()).toBe(
      routes.getHiddenAddressRulesRoute("trace")?.toString(),
    );
  });

  test("an event that does not say where has no rules to open, and still says why", () => {
    const attributes: { [key: string]: string } = hiddenAttributes({});
    delete attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbedIn];

    const step: BuiltStep | undefined = hiddenStep(
      plan.buildResponsePlan(
        planInput({ matches: matchesOf([matchedEvent({ attributes })]) }),
      ),
    );

    expect(step).toBeDefined();
    expect(step!.action).toBeUndefined();
  });

  test("a case that names an address to block says to block it, not this", () => {
    expect(
      hiddenStep(
        plan.buildResponsePlan(
          planInput({
            entities: [
              { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
            ],
          }),
        ),
      ),
    ).toBeUndefined();

    expect(
      hiddenStep(
        plan.buildResponsePlan(
          planInput({
            matches: matchesOf([
              matchedEvent(),
              matchedEvent({ principalIp: "35.196.249.14", attributes: {} }),
            ]),
          }),
        ),
      ),
    ).toBeUndefined();

    expect(
      hiddenStep(plan.buildResponsePlan(planInput({ matches: null }))),
    ).toBeUndefined();
  });

  test("marking the case contained waits until the address is found and blocked", () => {
    expect(plan.buildResponsePlan(planInput()).isReadyToMarkContained).toBe(
      false,
    );

    const ready: BuiltPlan = plan.buildResponsePlan(
      planInput({
        tasks: [{ id: "a", responseStepKey: HIDDEN_STEP_KEY, isDone: true }],
      }),
    );

    expect(hiddenStep(ready)!.isDone).toBe(true);
    expect(ready.isReadyToMarkContained).toBe(true);
  });
});

describe("an event's Principal IP", () => {
  function securityEvent(fields: Partial<SecurityEvent>): SecurityEvent {
    return Object.assign(new SecurityEvent(), fields);
  }

  test("says a scrub rule hid it, and filters the list to every event a rule hid the address of", () => {
    const built: ReturnType<Fields["buildSecurityEventOverviewFields"]> =
      fields.buildSecurityEventOverviewFields(
        securityEvent({
          className: "HTTP Activity",
          principalIp: "",
          attributes: hiddenAttributes({ ruleName: "Scrub IP addresses" }),
        }),
      );
    const principalIp: (typeof built)[number] | undefined = built.find(
      (field: (typeof built)[number]): boolean => {
        return field.label === "Principal IP";
      },
    );

    expect(principalIp).toEqual({
      label: "Principal IP",
      value: copy.HIDDEN_BY_A_SCRUB_RULE,
      isValueTranslated: true,
      hiddenAddress: {
        kind: ScrubbedAddressKind.Redacted,
        value: "[REDACTED]",
        place: ScrubbedAddressPlace.LogBody,
        signal: "log",
        ruleId: RULE_ID,
        ruleName: "Scrub IP addresses",
      } as HiddenClientAddress,
      facetKey: "attributes.oneuptime.request.client_address_hidden",
      facetValue: "scrub-rule",
    });
  });

  test("is the address when the event names one, and left out when it says nothing of one", () => {
    const named: ReturnType<Fields["buildSecurityEventOverviewFields"]> =
      fields.buildSecurityEventOverviewFields(
        securityEvent({
          principalIp: "203.0.113.7",
          attributes: hiddenAttributes({}),
        }),
      );

    expect(named).toEqual([
      { label: "Principal IP", value: "203.0.113.7", facetKey: "principalIp" },
    ]);
    expect(
      fields.buildSecurityEventOverviewFields(
        securityEvent({ principalIp: "", attributes: {} }),
      ),
    ).toEqual([]);
    expect(fields.buildHiddenPrincipalIpField(securityEvent({}))).toBeNull();
  });

  test("an event a log line is about to become, as Check a log line reads it, says so too", () => {
    const parsed: NormalizedSecurityEvent = WebAttackLogParser.parse({
      body: '[REDACTED] - - [20/Nov/2026:10:00:05 +0000] "GET /static/../../etc/passwd HTTP/1.1" 404 153 "-" "curl/8.5.0"',
      attributes: {},
      time: new Date("2026-11-20T10:00:05.000Z"),
    })[0]!;

    expect(fields.buildHiddenPrincipalIpField(parsed)?.hiddenAddress).toEqual(
      expect.objectContaining({ value: "[REDACTED]", signal: "log" }),
    );
  });
});

describe("What happened next", () => {
  // A trace whose server span names its client by the connection's own address.
  function assessment(clientAddress: string): RequestTraceAssessment {
    return {
      outcome: SecurityEventRequestOutcome.Rejected,
      serverSpanId: "server",
      statusCode: 404,
      method: "get",
      url: "/static/../../etc/passwd",
      route: "",
      clientAddress,
      client: resolveClientAddress({ peer: clientAddress }),
      userAgent: "curl/8.5.0",
      userId: "",
      durationMs: 3,
      exception: undefined,
      database: undefined,
      requestedDelaySeconds: 0,
    };
  }

  function facts(
    attributes: JSONObject,
    principalIp: string = "",
  ): ReturnType<Story["readSecurityEventRequestFacts"]> {
    return story.readSecurityEventRequestFacts(
      Object.assign(new SecurityEvent(), { attributes, principalIp }),
    );
  }

  test("reads who sent it as an address a scrub rule hid, with the rule", () => {
    const read: ReturnType<Story["readSecurityEventRequestFacts"]> = facts(
      hiddenAttributes({ ruleName: "Scrub IP addresses" }),
    );

    expect(read.clientAddress).toBe("");
    expect(read.hiddenClientAddress).toEqual(
      expect.objectContaining({
        value: "[REDACTED]",
        ruleName: "Scrub IP addresses",
      }),
    );
    expect(facts({}, "203.0.113.7").hiddenClientAddress).toBeNull();
  });

  test("a fresh read of the trace never takes what a trace rule left for an address", () => {
    const merged: ReturnType<Story["mergeAssessment"]> = story.mergeAssessment(
      facts({}),
      assessment("[REDACTED]"),
    );

    expect(merged.clientAddress).toBe("");
    expect(merged.hiddenClientAddress).toEqual({
      kind: ScrubbedAddressKind.Redacted,
      value: "[REDACTED]",
      place: ScrubbedAddressPlace.SpanAttributes,
      signal: "trace",
      ruleId: "",
      ruleName: "",
    });
  });

  test("the trace's address names who sent it once a log rule hid it, and the event's word on a hidden one wins over the trace's", () => {
    const fromLog: ReturnType<Story["readSecurityEventRequestFacts"]> = facts(
      hiddenAttributes({ ruleName: "Scrub IP addresses" }),
    );

    const named: ReturnType<Story["mergeAssessment"]> = story.mergeAssessment(
      fromLog,
      assessment("203.0.113.7"),
    );
    expect(named.clientAddress).toBe("203.0.113.7");
    expect(named.hiddenClientAddress).toBeNull();

    const stillHidden: ReturnType<Story["mergeAssessment"]> =
      story.mergeAssessment(fromLog, assessment(SCRUB_IPV4_MASK));
    expect(stillHidden.hiddenClientAddress?.ruleName).toBe(
      "Scrub IP addresses",
    );
    expect(stillHidden.hiddenClientAddress?.place).toBe(
      ScrubbedAddressPlace.LogBody,
    );
  });
});

describe("a campaign's row", () => {
  function campaign(
    overrides: Partial<SecurityAttackCampaign> = {},
  ): SecurityAttackCampaign {
    return {
      sourceIp: "",
      requestCount: 12,
      rejectedCount: 12,
      reachedAppCount: 0,
      erroredCount: 0,
      reachedDatabaseCount: 0,
      worstOutcome: SecurityEventRequestOutcome.Rejected,
      maxSeverityId: 2,
      attackKinds: ["path-traversal"],
      userAgents: [],
      targetCount: 3,
      sampleTargets: [],
      firstSeen: "2026-11-20T10:00:00.000Z",
      lastSeen: "2026-11-20T10:05:00.000Z",
      ...overrides,
    };
  }

  test("names its address, else says a scrub rule hid it from every request, else that nobody knew it", () => {
    expect(
      campaigns.getCampaignAddressText(
        campaign({ sourceIp: "203.0.113.7", hiddenAddressCount: 0 }),
        ENGLISH,
      ),
    ).toBe("203.0.113.7");
    expect(
      campaigns.getCampaignAddressText(
        campaign({ hiddenAddressCount: 12 }),
        ENGLISH,
      ),
    ).toBe("Hidden by a scrub rule");
    // Some of them hidden, some never had one: nobody knew it for all of them.
    expect(
      campaigns.getCampaignAddressText(
        campaign({ hiddenAddressCount: 5 }),
        ENGLISH,
      ),
    ).toBe("Unknown address");
    expect(campaigns.getCampaignAddressText(campaign(), ENGLISH)).toBe(
      "Unknown address",
    );
    expect(
      campaigns.getCampaignAddressText(
        campaign({ requestCount: 0, hiddenAddressCount: 0 }),
        ENGLISH,
      ),
    ).toBe("Unknown address");
  });

  test("is read in the reader's language", () => {
    const german: Translator = createTranslator((key: string): string => {
      return key === "Hidden by a scrub rule"
        ? "Von einer Bereinigungsregel verborgen"
        : key;
    }, "de");

    expect(
      campaigns.getCampaignAddressText(
        campaign({ hiddenAddressCount: 12 }),
        german,
      ),
    ).toBe("Von einer Bereinigungsregel verborgen");
  });
});

describe("Security Events' setup", () => {
  function status(
    overrides: Partial<ReturnType<Setup["parseSecuritySetupStatus"]>> = {},
  ): ReturnType<Setup["parseSecuritySetupStatus"]> {
    return {
      ...setup.parseSecuritySetupStatus({}),
      ...overrides,
    };
  }

  test("reads the rules that hide attackers' addresses from the server, and none when it names none", () => {
    expect(
      setup.parseSecuritySetupStatus({
        addressScrubRules: [
          {
            signal: "trace",
            ruleId: "t-1",
            ruleName: "Mask IPs in spans",
            scrubAction: LogScrubAction.Mask,
          },
          {
            signal: "log",
            ruleId: "l-1",
            ruleName: "Scrub IP addresses",
            scrubAction: LogScrubAction.Redact,
          },
        ],
      }).addressScrubRules,
    ).toEqual([
      {
        signal: "log",
        ruleId: "l-1",
        ruleName: "Scrub IP addresses",
        scrubAction: LogScrubAction.Redact,
      },
      {
        signal: "trace",
        ruleId: "t-1",
        ruleName: "Mask IPs in spans",
        scrubAction: LogScrubAction.Mask,
      },
    ]);

    expect(setup.parseSecuritySetupStatus({})).not.toHaveProperty(
      "addressScrubRules",
    );
    expect(
      setup.parseSecuritySetupStatus({ addressScrubRules: "garbled" }),
    ).not.toHaveProperty("addressScrubRules");
  });

  test("says, for the logs and the traces it reads, that addresses are scrubbed and which rule does it", () => {
    expect(setup.getSecurityAddressScrubItems(status())).toEqual([]);

    expect(
      setup.getSecurityAddressScrubItems(
        status({
          addressScrubRules: [
            {
              signal: "log",
              ruleId: "l-1",
              ruleName: "Scrub IP addresses",
              scrubAction: LogScrubAction.Redact,
            },
            {
              signal: "trace",
              ruleId: "t-1",
              ruleName: "Mask IPs in spans",
              scrubAction: LogScrubAction.Mask,
            },
          ],
        }),
      ),
    ).toEqual([
      {
        signal: "log",
        sentence: copy.LOG_ADDRESSES_SCRUBBED,
        ruleSentence: copy.SCRUB_RULE_REDACTS_THEM,
        // The rule Hash Instead switches (#10396).
        ruleId: "l-1",
        ruleName: "Scrub IP addresses",
        rulesPage: PageMap.LOGS_SETTINGS_SCRUB_RULES,
      },
      {
        signal: "trace",
        sentence: copy.TRACE_ADDRESSES_SCRUBBED,
        ruleSentence: copy.SCRUB_RULE_MASKS_THEM,
        ruleId: "t-1",
        ruleName: "Mask IPs in spans",
        rulesPage: PageMap.TRACES_SETTINGS_SCRUB_RULES,
      },
    ]);
  });

  test("its words are the issue's, each naming the telemetry it is about", () => {
    expect(copy.LOG_ADDRESSES_SCRUBBED).toBe(
      "IP addresses are scrubbed from your logs, so Security Events can't tell you which address to block.",
    );
    expect(copy.TRACE_ADDRESSES_SCRUBBED).toBe(
      "IP addresses are scrubbed from your traces, so Security Events can't tell you which address to block.",
    );
    expect(copy.OPEN_SCRUB_RULES).toBe("Open Scrub Rules");
  });
});
