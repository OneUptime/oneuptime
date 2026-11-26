import SecurityCaseStepCheck from "../../Models/DatabaseModels/SecurityCaseStepCheck";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { ResponseLinkKind } from "../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchesJson,
} from "../../Types/SecurityCase/SecurityCaseMatches";
import { SecurityCaseStepCheckEvidence } from "../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  CHECK_FIX_CANNOT_NO_DEPLOYS,
  CHECK_FIX_FACT_BEFORE_DATABASE,
  CHECK_FIX_FACT_MFA_OFF,
  CHECK_FIX_FACT_MFA_ON,
  CHECK_FIX_FACT_WATCHING_DATABASE,
  CHECK_FIX_MFA_MISSING,
  CHECK_FIX_PASSWORD_RESET,
  CHECK_FIX_ROUTE_NO_ATTEMPTS,
  CHECK_FIX_ROUTE_REGRESSED_DATABASE,
  CHECK_FIX_ROUTE_STILL_DATABASE,
  CHECK_FIX_ROUTE_TURNED_AWAY,
} from "../../Utils/SecurityCase/ResponsePlan/StepCheckWords";

/*
 * What OneUptime writes of a case's Fix steps (#10347), as their rows reach
 * the Response Plan's card: the route's fix in each state it can be in,
 * the password reset, and the accounts' MFA - with the evidence the checks
 * write, in their words. Shared by the card's tests in English and in
 * every language.
 */

export const FIX_ROUTE: string = "/api/search";
export const FIX_CHANGE: string = "v2.4.1";
export const FIX_USER: string = "alice@acme.com";
export const FIX_SHIPPED_AT: string = "2026-11-17T20:00:00.000Z";
export const FIX_PULL_REQUEST_URL: string =
  "https://github.com/acme/search/pull/123";

// A case about a SQL injection on the route that went after an account.
export const FIX_CASE_TECHNIQUES: Array<string> = ["T1190", "T1110", "T1078"];

export function fixCaseMatches(): SecurityCaseMatchesJson {
  return {
    detections: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        source: "Detection Rule",
        title: "SQL injection attempts — 35.196.249.14",
        severity: "High",
        groupValue: "35.196.249.14",
        ruleName: "SQL injection attempts",
        eventCount: 1,
        fireCount: 1,
        firstSeenAt: "2026-11-17T19:28:00.000Z",
        lastSeenAt: "2026-11-17T19:28:00.000Z",
        sampleMessage: "",
        isOpening: true,
        rule: null,
        threatIntelFeedId: "",
        securityEventConnectionId: "",
        basis: SecurityCaseMatchBasis.RuleCondition,
        windowStart: "2026-11-17T19:22:00.000Z",
        windowEnd: "2026-11-17T19:29:00.000Z",
        events: [
          {
            time: "2026-11-17T19:28:00.000Z",
            eventUid: "event-1",
            sourceId: "",
            severityName: "High",
            className: "HTTP Activity",
            categoryName: "Network Activity",
            activityName: "GET",
            statusName: "Success",
            message: "SQL injection attempt",
            vendorName: "",
            productName: "",
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
            observables: [],
            mitreTactics: ["TA0001"],
            mitreTechniques: ["T1190"],
            attributes: {
              [SECURITY_REQUEST_ATTRIBUTES.url]: `${FIX_ROUTE}?q=1%27%20OR%201%3D1`,
            },
            traceId: "trace-1",
            spanId: "",
            sessionId: "",
            requestOutcome: "Reached Database",
            hunt: null,
          },
        ],
        isKept: true,
        keptPastRetentionCount: 0,
        hiddenEventCount: 0,
        matchedEventCount: 1,
        outcomes: { "Reached Database": 1 },
      },
    ],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

export function fixStepCheckRow(data: {
  key: string;
  state: SecurityCaseStepCheckState;
  evidence: SecurityCaseStepCheckEvidence;
}): SecurityCaseStepCheck {
  const check: SecurityCaseStepCheck = new SecurityCaseStepCheck();
  check._id = ObjectID.generate().toString();
  check.stepKey = data.key;
  check.state = data.state;
  check.evidence = data.evidence as unknown as JSONObject;
  check.checkedAt = new Date("2026-11-17T21:00:00.000Z");
  check.stateSince = new Date("2026-11-17T21:00:00.000Z");
  return check;
}

const BEFORE: SecurityCaseStepCheckEvidence["facts"][number] = {
  template: CHECK_FIX_FACT_BEFORE_DATABASE,
  values: {},
  numbers: { through: 6 },
  count: 24,
};

const SHIPPED: Record<string, string> = {
  route: FIX_ROUTE,
  change: FIX_CHANGE,
};

// The route's fix, in each state its check writes.
export const ROUTE_FIX_EVIDENCE: Record<
  string,
  { state: SecurityCaseStepCheckState; evidence: SecurityCaseStepCheckEvidence }
> = {
  verified: {
    state: SecurityCaseStepCheckState.Verified,
    evidence: {
      sentence: {
        template: CHECK_FIX_ROUTE_TURNED_AWAY,
        values: SHIPPED,
        times: { time: FIX_SHIPPED_AT },
        count: 18,
      },
      facts: [BEFORE],
      links: [
        {
          kind: ResponseLinkKind.OpenProvider,
          provider: "GitHub",
          url: FIX_PULL_REQUEST_URL,
        },
      ],
      data: { route: FIX_ROUTE, change: FIX_CHANGE },
    },
  },
  noAttempts: {
    state: SecurityCaseStepCheckState.LooksDone,
    evidence: {
      sentence: {
        template: CHECK_FIX_ROUTE_NO_ATTEMPTS,
        values: SHIPPED,
        times: { time: FIX_SHIPPED_AT },
      },
      facts: [
        {
          template: CHECK_FIX_FACT_WATCHING_DATABASE,
          values: { route: FIX_ROUTE },
          times: { until: "2026-11-24T20:00:00.000Z" },
          count: 11,
        },
        BEFORE,
      ],
      links: [],
      data: { route: FIX_ROUTE, change: FIX_CHANGE },
    },
  },
  notFixed: {
    state: SecurityCaseStepCheckState.NotDone,
    evidence: {
      sentence: {
        template: CHECK_FIX_ROUTE_STILL_DATABASE,
        values: SHIPPED,
        numbers: { through: 3 },
        times: { time: FIX_SHIPPED_AT },
        count: 5,
      },
      facts: [BEFORE],
      links: [
        {
          kind: ResponseLinkKind.OpenTraces,
          traceIds: ["still-0", "still-1", "still-2"],
          startTime: "2026-11-17T20:10:00.000Z",
          endTime: "2026-11-17T21:00:00.000Z",
        },
      ],
      data: { route: FIX_ROUTE, change: FIX_CHANGE },
    },
  },
  regressed: {
    state: SecurityCaseStepCheckState.Regressed,
    evidence: {
      sentence: {
        template: CHECK_FIX_ROUTE_REGRESSED_DATABASE,
        values: SHIPPED,
        times: { time: "2026-11-17T20:40:00.000Z" },
      },
      facts: [BEFORE],
      links: [],
      data: { regressedAt: "2026-11-17T20:40:00.000Z" },
    },
  },
  cannotTell: {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: {
      sentence: {
        template: CHECK_FIX_CANNOT_NO_DEPLOYS,
        values: { service: "search-api" },
      },
      facts: [],
      links: [],
      docsPath: "/telemetry/security-cases#how-oneuptime-checks-a-step",
      data: { reason: "NoDeploys" },
    },
  },
};

// The password reset and checked, and MFA missing on one of two accounts.
export function accountFixRows(): Array<SecurityCaseStepCheck> {
  return [
    fixStepCheckRow({
      key: "fix:credentials",
      state: SecurityCaseStepCheckState.Verified,
      evidence: {
        sentence: {
          template: CHECK_FIX_PASSWORD_RESET,
          values: { user: FIX_USER, provider: "Okta" },
          times: {
            time: "2026-11-17T20:05:00.000Z",
            ended: "2026-11-17T20:06:00.000Z",
          },
        },
        facts: [],
        links: [],
        data: {},
      },
    }),
    fixStepCheckRow({
      key: "fix:brute-force",
      state: SecurityCaseStepCheckState.NotDone,
      evidence: {
        sentence: {
          template: CHECK_FIX_MFA_MISSING,
          values: { user: "bob@acme.com" },
          numbers: { total: 2 },
          count: 1,
        },
        facts: [
          {
            template: CHECK_FIX_FACT_MFA_OFF,
            values: { user: "bob@acme.com", provider: "Microsoft Entra ID" },
          },
          {
            template: CHECK_FIX_FACT_MFA_ON,
            values: { user: FIX_USER, provider: "Okta" },
          },
        ],
        links: [],
        data: {},
      },
    }),
  ];
}
