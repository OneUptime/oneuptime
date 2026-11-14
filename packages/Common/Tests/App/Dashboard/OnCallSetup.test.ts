import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  NoAnswerChoice,
  ON_CALL_POLICY_NAME,
  ON_CALL_SETUP,
  ON_CALL_SETUP_COPY,
  ON_CALL_SETUP_STEPS,
  OnCallPolicyRecord,
  OnCallProgressFacts,
  OnCallSetupStep,
  OnCallSummaryRow,
  PHONE_BALANCE_FLOOR_IN_USD_CENTS,
  PhoneChannelFacts,
  ResponderReach,
  canAddPhone,
  describeFirstLevel,
  describeResponder,
  formatUsdCents,
  getDefaultNoAnswerChoice,
  getMissingRuleKinds,
  getOnCallProgress,
  getOnCallSummaryRows,
  getPhoneBreaks,
  getPolicyBreaks,
  getVerifiedMethodsOfType,
  isOnCallSetupFinished,
  isPhoneBalanceTooLow,
  isServerWithoutTwilio,
  parsePhoneNumber,
  parseRepeatTimes,
  parseWaitMinutes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetup";
import {
  WEBSITE_DOWN_COPY,
  WEBSITE_DOWN_POLICY_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldPersonProblem,
  WhoIsToldServerChannel,
} from "../../../Types/Monitor/WhoIsTold";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * The on-call guided setup's rules and words (issue #6805): which step a
 * returning person lands on, what stops a phone being paged on this project
 * and this server (each channel state: on, off, no balance, no Twilio), the
 * breaks between a policy and its people in #6810's words, what the
 * "nobody answers" step starts on, and a summary whose every claim comes
 * from the records it is handed.
 */

const english: Translator = createTranslator(undefined, "en");

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const kinds: (breaks: Array<WhoIsToldBreak>) => Array<string> = (
  breaks: Array<WhoIsToldBreak>,
): Array<string> => {
  return breaks.map((brk: WhoIsToldBreak): string => {
    return brk.channel ? `${brk.kind}:${brk.channel}` : brk.kind;
  });
};

const cloud: (overrides?: Partial<PhoneChannelFacts>) => PhoneChannelFacts = (
  overrides?: Partial<PhoneChannelFacts>,
): PhoneChannelFacts => {
  return {
    isBillingEnabled: true,
    isSmsOn: true,
    isCallOn: true,
    balanceInUSDCents: 2000,
    serverCanSendSms: null,
    serverCanCall: null,
    ...overrides,
  };
};

const selfHosted: (
  overrides?: Partial<PhoneChannelFacts>,
) => PhoneChannelFacts = (
  overrides?: Partial<PhoneChannelFacts>,
): PhoneChannelFacts => {
  return {
    isBillingEnabled: false,
    isSmsOn: true,
    isCallOn: true,
    balanceInUSDCents: null,
    serverCanSendSms: true,
    serverCanCall: true,
    ...overrides,
  };
};

const ana: ResponderReach = {
  userId: "user-ana",
  name: "Ana Lopez",
  isReachable: true,
  channels: ["Email", "SMS", "Call"],
};

const ben: ResponderReach = {
  userId: "user-ben",
  name: "Ben Ito",
  isReachable: false,
  channels: [],
};

const policyRecord: (
  overrides?: Partial<OnCallPolicyRecord>,
) => OnCallPolicyRecord = (
  overrides?: Partial<OnCallPolicyRecord>,
): OnCallPolicyRecord => {
  return {
    id: "policy-1",
    name: "Default on-call policy",
    levels: [
      {
        id: "level-1",
        order: 1,
        escalateAfterInMinutes: 30,
        userIds: ["user-ana"],
        names: ["Ana Lopez"],
        responderCount: 1,
      },
    ],
    repeatTimes: 0,
    incidentRuleCount: 1,
    alertRuleCount: 1,
    ...overrides,
  };
};

const acknowledged: OnCallTestPageResult = {
  executionLogId: "log-1",
  kind: "Policy",
  recordKind: OnCallTestPageRecordKind.Incident,
  severityName: "Critical",
  walksEscalation: false,
  status: OnCallTestPageStatus.Acknowledged,
  statusMessage: "",
  startedAt: "2026-11-12T10:00:00.000Z",
  endsAt: "2026-11-12T10:15:00.000Z",
  steps: [],
} as unknown as OnCallTestPageResult;

describe("the setup", () => {
  test("is named on_call in its events, with four steps in order", () => {
    expect(ON_CALL_SETUP).toBe("on_call");
    expect(ON_CALL_SETUP_STEPS).toEqual([
      "reach_you",
      "who_else",
      "no_answer",
      "test",
    ]);
  });

  test("makes the policy under the website setup's name: one name per thing", () => {
    expect(ON_CALL_POLICY_NAME).toBe(WEBSITE_DOWN_POLICY_NAME);
    expect(ON_CALL_POLICY_NAME).toBe("Default on-call policy");
  });

  test("waits the escalation form's default before someone else is paged", () => {
    expect(DEFAULT_ESCALATE_AFTER_IN_MINUTES).toBe(30);
  });
});

describe("which step a returning person lands on", () => {
  const nothing: OnCallProgressFacts = {
    isReachConfirmed: false,
    hasPolicy: false,
    isNoAnswerDone: false,
    testStatus: null,
    isTestSkipped: false,
  };

  const doneKeys: (facts: OnCallProgressFacts) => Array<string> = (
    facts: OnCallProgressFacts,
  ): Array<string> => {
    return getOnCallProgress(facts)
      .filter((step: { isDone: boolean }): boolean => {
        return step.isDone;
      })
      .map((step: { key: string }): string => {
        return step.key;
      });
  };

  test("a new run has nothing done", () => {
    expect(doneKeys(nothing)).toEqual([]);
  });

  test("each step is done once the one before it is", () => {
    expect(doneKeys({ ...nothing, isReachConfirmed: true })).toEqual([
      OnCallSetupStep.ReachYou,
    ]);
    expect(
      doneKeys({ ...nothing, isReachConfirmed: true, hasPolicy: true }),
    ).toEqual([OnCallSetupStep.ReachYou, OnCallSetupStep.WhoElse]);
    expect(
      doneKeys({
        ...nothing,
        isReachConfirmed: true,
        hasPolicy: true,
        isNoAnswerDone: true,
        testStatus: OnCallTestPageStatus.Acknowledged,
      }),
    ).toEqual(ON_CALL_SETUP_STEPS);
  });

  test("a policy deleted since undoes every step after who is reached", () => {
    expect(
      doneKeys({
        isReachConfirmed: true,
        hasPolicy: false,
        isNoAnswerDone: true,
        testStatus: OnCallTestPageStatus.Acknowledged,
        isTestSkipped: false,
      }),
    ).toEqual([OnCallSetupStep.ReachYou]);
  });

  test("a policy without a confirmed first step does not count", () => {
    expect(doneKeys({ ...nothing, hasPolicy: true })).toEqual([]);
  });

  test("the test step is done when acknowledged or skipped, not while it is out", () => {
    const ready: OnCallProgressFacts = {
      ...nothing,
      isReachConfirmed: true,
      hasPolicy: true,
      isNoAnswerDone: true,
    };

    expect(
      doneKeys({ ...ready, testStatus: OnCallTestPageStatus.Paging }),
    ).not.toContain(OnCallSetupStep.Test);
    expect(doneKeys({ ...ready, isTestSkipped: true })).toContain(
      OnCallSetupStep.Test,
    );
  });

  test("finishes only on an acknowledged test page, never on a skipped one", () => {
    const ready: OnCallProgressFacts = {
      ...nothing,
      isReachConfirmed: true,
      hasPolicy: true,
      isNoAnswerDone: true,
    };

    expect(
      isOnCallSetupFinished({
        ...ready,
        testStatus: OnCallTestPageStatus.Acknowledged,
      }),
    ).toBe(true);
    expect(isOnCallSetupFinished({ ...ready, isTestSkipped: true })).toBe(
      false,
    );
    expect(
      isOnCallSetupFinished({
        ...ready,
        hasPolicy: false,
        testStatus: OnCallTestPageStatus.Acknowledged,
      }),
    ).toBe(false);
  });
});

describe("what stops a phone being paged", () => {
  test("Cloud, on and paid for: nothing, and a number can be added", () => {
    expect(getPhoneBreaks(cloud())).toEqual([]);
    expect(canAddPhone(cloud())).toBe(true);
  });

  test("Cloud, SMS and calls off: both named, and no number until SMS is on", () => {
    const facts: PhoneChannelFacts = cloud({ isSmsOn: false, isCallOn: false });

    expect(kinds(getPhoneBreaks(facts))).toEqual([
      `${WhoIsToldBreakKind.ChannelOff}:${OnCallPageChannel.SMS}`,
      `${WhoIsToldBreakKind.ChannelOff}:${OnCallPageChannel.Call}`,
    ]);
    expect(canAddPhone(facts)).toBe(false);
  });

  test("calls off alone still lets a number be added for SMS", () => {
    const facts: PhoneChannelFacts = cloud({ isCallOn: false });

    expect(kinds(getPhoneBreaks(facts))).toEqual([
      `${WhoIsToldBreakKind.ChannelOff}:${OnCallPageChannel.Call}`,
    ]);
    expect(canAddPhone(facts)).toBe(true);
  });

  test("Cloud, no balance: named, and no number (its code is a paid text)", () => {
    const facts: PhoneChannelFacts = cloud({ balanceInUSDCents: 0 });

    expect(kinds(getPhoneBreaks(facts))).toEqual([
      WhoIsToldBreakKind.NoBalance,
    ]);
    expect(isPhoneBalanceTooLow(facts)).toBe(true);
    expect(canAddPhone(facts)).toBe(false);
  });

  test("the balance floor is the server's: at it is too low, a cent above is not", () => {
    expect(PHONE_BALANCE_FLOOR_IN_USD_CENTS).toBe(100);
    expect(isPhoneBalanceTooLow(cloud({ balanceInUSDCents: 100 }))).toBe(true);
    expect(isPhoneBalanceTooLow(cloud({ balanceInUSDCents: 101 }))).toBe(false);
  });

  test("a balance not known is never called too low", () => {
    expect(isPhoneBalanceTooLow(cloud({ balanceInUSDCents: null }))).toBe(
      false,
    );
    expect(canAddPhone(cloud({ balanceInUSDCents: null }))).toBe(true);
  });

  test("self-hosted pays no balance: a zero balance stops nothing", () => {
    expect(getPhoneBreaks(selfHosted({ balanceInUSDCents: 0 }))).toEqual([]);
  });

  test("self-hosted without Twilio: the server is named for SMS and calls", () => {
    const facts: PhoneChannelFacts = selfHosted({
      serverCanSendSms: false,
      serverCanCall: false,
    });

    expect(kinds(getPhoneBreaks(facts))).toEqual([
      `${WhoIsToldBreakKind.ServerCannotSend}:${WhoIsToldServerChannel.SMS}`,
      `${WhoIsToldBreakKind.ServerCannotSend}:${WhoIsToldServerChannel.Call}`,
    ]);
    expect(isServerWithoutTwilio(facts)).toBe(true);
    expect(canAddPhone(facts)).toBe(false);
  });

  test("the server comes before the project's switches", () => {
    expect(
      kinds(
        getPhoneBreaks(selfHosted({ serverCanSendSms: false, isSmsOn: false })),
      ),
    ).toEqual([
      `${WhoIsToldBreakKind.ServerCannotSend}:${WhoIsToldServerChannel.SMS}`,
      `${WhoIsToldBreakKind.ChannelOff}:${OnCallPageChannel.SMS}`,
    ]);
  });

  test("a server status nobody told us (not a master admin) is not a break", () => {
    const facts: PhoneChannelFacts = selfHosted({
      serverCanSendSms: null,
      serverCanCall: null,
    });

    expect(getPhoneBreaks(facts)).toEqual([]);
    expect(isServerWithoutTwilio(facts)).toBe(false);
    expect(canAddPhone(facts)).toBe(true);
  });

  test("OneUptime Cloud always has Twilio: a server status there is ignored", () => {
    expect(isServerWithoutTwilio(cloud({ serverCanSendSms: false }))).toBe(
      false,
    );
    expect(canAddPhone(cloud({ serverCanSendSms: false }))).toBe(true);
    expect(
      getPhoneBreaks(cloud({ serverCanSendSms: false, serverCanCall: false })),
    ).toEqual([]);
  });

  test("switches not known are the server's to refuse, not a break", () => {
    expect(getPhoneBreaks(cloud({ isSmsOn: null, isCallOn: null }))).toEqual(
      [],
    );
    expect(canAddPhone(cloud({ isSmsOn: null }))).toBe(true);
  });

  test("each break carries #6810's sentence and fix", () => {
    const [off, balance]: Array<WhoIsToldBreak> = getPhoneBreaks(
      cloud({ isSmsOn: false, isCallOn: true, balanceInUSDCents: 0 }),
    );

    expect(off!.fix).toBe("ProjectNotificationSettings");
    expect(off!.message).toContain("SMS");
    expect(balance!.fix).toBe("ProjectBilling");
    expect(balance!.message).toContain("balance");
  });
});

describe("a phone number as typed", () => {
  test.each([
    ["+15551234567", "+15551234567"],
    ["+1 (555) 123-4567", "+15551234567"],
    ["15551234567", "+15551234567"],
    ["+44 20 7946 0958", "+442079460958"],
    ["  +4915112345678 ", "+4915112345678"],
  ])("%s is %s", (input: string, expected: string) => {
    expect(parsePhoneNumber(input)).toBe(expected);
  });

  test.each(["", "abc", "+1", "12345", "+1234567890123456", "555-CALL-NOW"])(
    "%s is not a number",
    (input: string) => {
      expect(parsePhoneNumber(input)).toBeNull();
    },
  );
});

describe("the methods a page reaches", () => {
  test("only verified methods of the types asked for count", () => {
    expect(
      getVerifiedMethodsOfType(
        [
          {
            methodType: "Email",
            maskedIdentifier: "a***@x.com",
            isVerified: true,
          },
          { methodType: "SMS", maskedIdentifier: "•••4821", isVerified: false },
          { methodType: "Call", maskedIdentifier: "•••4821", isVerified: true },
          { methodType: "Push", maskedIdentifier: "Pixel", isVerified: true },
        ],
        ["SMS", "Call"],
      ),
    ).toEqual([
      { methodType: "Call", maskedIdentifier: "•••4821", isVerified: true },
    ]);
  });

  test("an amount is shown as the balance pages show it", () => {
    expect(formatUsdCents(0)).toBe("0.00 USD");
    expect(formatUsdCents(1250)).toBe("12.50 USD");
  });
});

describe("the breaks between a policy and its people", () => {
  test("a policy that runs and reaches its people has none", () => {
    expect(
      getPolicyBreaks({ policy: policyRecord(), responders: [ana] }),
    ).toEqual([]);
  });

  test("nothing runs it: nobody is paged", () => {
    expect(
      kinds(
        getPolicyBreaks({
          policy: policyRecord({ incidentRuleCount: 0, alertRuleCount: 0 }),
          responders: [ana],
        }),
      ),
    ).toEqual([WhoIsToldBreakKind.NobodyPaged]);
  });

  test("only incidents run it: alerts page nobody", () => {
    expect(
      kinds(
        getPolicyBreaks({
          policy: policyRecord({ alertRuleCount: 0 }),
          responders: [ana],
        }),
      ),
    ).toEqual([WhoIsToldBreakKind.OnlyIncidentsHaveRules]);
  });

  test("no escalation rule: it pages nobody", () => {
    expect(
      kinds(
        getPolicyBreaks({
          policy: policyRecord({ levels: [] }),
          responders: [],
        }),
      ),
    ).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
  });

  test("a first level nobody is on reaches nobody", () => {
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels[0]!.responderCount = 0;
    policy.levels[0]!.names = [];

    expect(kinds(getPolicyBreaks({ policy: policy, responders: [] }))).toEqual([
      WhoIsToldBreakKind.PolicyReachesNobody,
    ]);
  });

  test("each person a page can't reach is named, and nobody reachable at all is said", () => {
    const breaks: Array<WhoIsToldBreak> = getPolicyBreaks({
      policy: policyRecord(),
      responders: [ben],
    });

    expect(kinds(breaks)).toEqual([
      WhoIsToldBreakKind.PolicyReachesNobody,
      WhoIsToldBreakKind.PersonUnreachable,
    ]);
    expect(breaks[1]!.userName).toBe("Ben Ito");
    expect(breaks[1]!.problem).toBe(WhoIsToldPersonProblem.NoVerifiedMethod);
  });

  test("one unreachable person beside a reachable one is named alone", () => {
    expect(
      kinds(
        getPolicyBreaks({ policy: policyRecord(), responders: [ana, ben] }),
      ),
    ).toEqual([WhoIsToldBreakKind.PersonUnreachable]);
  });

  test("a first level that names a team is never said to reach nobody for its people's sake", () => {
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels[0]!.userIds = [];
    policy.levels[0]!.names = ["Platform"];

    expect(
      kinds(getPolicyBreaks({ policy: policy, responders: [ben] })),
    ).toEqual([WhoIsToldBreakKind.PersonUnreachable]);
  });

  test("someone reachable on a later level does not make the first level reach anyone", () => {
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels[0]!.userIds = ["user-ben"];
    policy.levels[0]!.names = ["Ben Ito"];
    policy.levels.push({
      id: "level-2",
      order: 2,
      escalateAfterInMinutes: 30,
      userIds: ["user-ana"],
      names: ["Ana Lopez"],
      responderCount: 1,
    });

    expect(
      kinds(getPolicyBreaks({ policy: policy, responders: [ana, ben] })),
    ).toEqual([
      WhoIsToldBreakKind.PolicyReachesNobody,
      WhoIsToldBreakKind.PersonUnreachable,
    ]);
  });

  test("the rules still to add are the kinds nothing runs it for", () => {
    expect(getMissingRuleKinds(policyRecord())).toEqual({
      incident: false,
      alert: false,
    });
    expect(getMissingRuleKinds(policyRecord({ alertRuleCount: 0 }))).toEqual({
      incident: false,
      alert: true,
    });
    expect(
      getMissingRuleKinds(
        policyRecord({ incidentRuleCount: 0, alertRuleCount: 0 }),
      ),
    ).toEqual({ incident: true, alert: true });
  });
});

describe("what if nobody answers", () => {
  test("starts on someone else, or on paging again where a second level is not allowed", () => {
    expect(getDefaultNoAnswerChoice({ maySecondLevel: true })).toBe(
      NoAnswerChoice.Escalate,
    );
    expect(getDefaultNoAnswerChoice({ maySecondLevel: false })).toBe(
      NoAnswerChoice.Repeat,
    );
  });

  test.each([
    ["30", 30],
    [" 5 ", 5],
    ["1", 1],
    ["1440", 1440],
  ])("%s minutes is %s", (input: string, expected: number) => {
    expect(parseWaitMinutes(input)).toBe(expected);
  });

  test.each(["", "0", "-5", "1441", "2.5", "half an hour"])(
    "%s minutes is refused",
    (input: string) => {
      expect(parseWaitMinutes(input)).toBeNull();
    },
  );

  test("repeats from 1 to 10 times", () => {
    expect(parseRepeatTimes("2")).toBe(2);
    expect(parseRepeatTimes("10")).toBe(10);
    expect(parseRepeatTimes("0")).toBeNull();
    expect(parseRepeatTimes("11")).toBeNull();
    expect(parseRepeatTimes("x")).toBeNull();
  });
});

describe("the summary", () => {
  const rows: (
    policy: OnCallPolicyRecord,
    responders: Array<ResponderReach>,
    testResult?: OnCallTestPageResult | null,
    isCatchAll?: boolean,
  ) => Record<string, string> = (
    policy: OnCallPolicyRecord,
    responders: Array<ResponderReach>,
    testResult?: OnCallTestPageResult | null,
    isCatchAll: boolean = true,
  ): Record<string, string> => {
    const result: Record<string, string> = {};

    for (const row of getOnCallSummaryRows(english, {
      policy: policy,
      responders: responders,
      breaks: [],
      isCatchAll: isCatchAll,
      testResult: testResult || null,
      testResultSentence: testResult
        ? "Ana Lopez acknowledged it by SMS."
        : null,
    })) {
      result[row.key] = row.text;
    }

    return result;
  };

  test("says who any new incident or alert pages, and by what", () => {
    expect(rows(policyRecord(), [ana])["first"]).toBe(
      'Any new incident or alert runs "Default on-call policy", which pages Ana Lopez (Email, SMS, Phone call).',
    );
  });

  test("a policy the project had is run by its own rules: never claimed for any incident", () => {
    expect(rows(policyRecord(), [ana], null, false)["first"]).toBe(
      'Its on-call rules decide which incidents and alerts run "Default on-call policy", which pages Ana Lopez (Email, SMS, Phone call).',
    );
  });

  test("names only the first level's people as paged first, never a later level's", () => {
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels.push({
      id: "level-2",
      order: 2,
      escalateAfterInMinutes: 30,
      userIds: ["user-ben"],
      names: ["Ben Ito"],
      responderCount: 1,
    });

    const first: string = rows(policy, [
      ana,
      { ...ben, isReachable: true, channels: ["Email"] },
    ])["first"]!;

    expect(first).toContain("Ana Lopez (Email, SMS, Phone call)");
    expect(first).not.toContain("Ben Ito");
  });

  test("names a team as it is, beside the people it describes", () => {
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels[0]!.names = ["Ana Lopez", "Platform"];

    expect(rows(policy, [ana])["first"]).toContain(
      "Ana Lopez (Email, SMS, Phone call), Platform",
    );
  });

  test("says when only incidents run it, and that alerts page nobody", () => {
    expect(rows(policyRecord({ alertRuleCount: 0 }), [ana])["first"]).toBe(
      'Any new incident runs "Default on-call policy", which pages Ana Lopez (Email, SMS, Phone call). Alerts page nobody.',
    );
  });

  test("never claims a run when no rule runs it", () => {
    const text: string = rows(
      policyRecord({ incidentRuleCount: 0, alertRuleCount: 0 }),
      [ana],
    )["first"]!;

    expect(text).not.toContain("Any new");
    expect(text).toContain("once an on-call rule runs it");
  });

  test("a policy that pages nobody says so", () => {
    expect(rows(policyRecord({ levels: [] }), [])["first"]).toBe(
      'The on-call policy "Default on-call policy" pages nobody yet.',
    );
  });

  test("an unreachable person is said to be", () => {
    expect(describeResponder(english, ben)).toBe("Ben Ito (not reachable yet)");
  });

  test("the second level, after the first level's wait", () => {
    const policy: OnCallPolicyRecord = policyRecord();
    policy.levels.push({
      id: "level-2",
      order: 2,
      escalateAfterInMinutes: 30,
      userIds: ["user-ben"],
      names: ["Ben Ito"],
      responderCount: 1,
    });
    policy.levels[0]!.escalateAfterInMinutes = 15;

    expect(rows(policy, [ana])["no_answer"]).toBe(
      "If nobody acknowledges within 15 minutes, Ben Ito is paged.",
    );
  });

  test("a repeat, with how often at most", () => {
    expect(rows(policyRecord({ repeatTimes: 2 }), [ana])["no_answer"]).toBe(
      "If nobody acknowledges within 30 minutes, the page starts again (2 more times at most).",
    );
  });

  test("nobody else, when it neither escalates nor repeats", () => {
    expect(rows(policyRecord(), [ana])["no_answer"]).toBe(
      "Nobody else is paged.",
    );
  });

  test("the test's own sentence once acknowledged, and 'not tested' otherwise", () => {
    expect(rows(policyRecord(), [ana], acknowledged)["tested"]).toBe(
      "Ana Lopez acknowledged it by SMS.",
    );
    expect(rows(policyRecord(), [ana])["tested"]).toBe(
      ON_CALL_SETUP_COPY.summaryNotTested,
    );
  });

  test("rows come in reading order with their labels", () => {
    const summary: Array<OnCallSummaryRow> = getOnCallSummaryRows(english, {
      policy: policyRecord(),
      responders: [ana],
      breaks: [],
      isCatchAll: true,
      testResult: null,
      testResultSentence: null,
    });

    expect(
      summary.map((row: OnCallSummaryRow): string => {
        return `${row.key}:${row.label}`;
      }),
    ).toEqual([
      "first:Who is paged",
      "no_answer:If nobody answers",
      "tested:Tested",
    ]);
  });

  test("the first level's names stand in when readiness could not be read", () => {
    expect(
      describeFirstLevel(english, {
        level: policyRecord().levels[0],
        responders: [],
      }),
    ).toBe("Ana Lopez");
  });
});

describe("its words", () => {
  test("a policy made meanwhile, and a read that failed, are said in the website-down setup's words (#7252)", () => {
    // Two setups, one product: the same moment reads the same in both.
    expect(ON_CALL_SETUP_COPY.policyMadeElsewhere).toBe(
      WEBSITE_DOWN_COPY.policyMadeElsewhere,
    );
    expect(ON_CALL_SETUP_COPY.policyMadeElsewhere).toBe(
      "An on-call policy was added to this project while this page was open, so no new policy was made.",
    );
    expect(ON_CALL_SETUP_COPY.couldNotSave).toBe(
      WEBSITE_DOWN_COPY.couldNotSave,
    );
    expect(ON_CALL_SETUP_COPY.couldNotSave).toBe(
      "That did not save. Check your connection and try again.",
    );
  });

  const words: Array<string> = Array.from(
    new Set(Object.values(ON_CALL_SETUP_COPY)),
  );

  const languages: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(".json", "");
    });

  test("every one is a key of en.json", () => {
    const en: Record<string, string> = readLocale("en");

    for (const word of words) {
      expect({ word, isKey: en[word] === word }).toEqual({
        word,
        isKey: true,
      });
    }
  });

  test("and is translated in every language", () => {
    expect(languages.length).toBe(17);

    for (const language of languages) {
      const table: Record<string, string> = readLocale(language);
      const untranslated: Array<string> = words.filter(
        (word: string): boolean => {
          return !table[word] || table[word] === word;
        },
      );

      expect({ language, untranslated }).toEqual({
        language,
        untranslated: [],
      });
    }
  });

  test("a translation keeps every placeholder of its sentence", () => {
    for (const language of languages) {
      const table: Record<string, string> = readLocale(language);

      for (const word of words) {
        const placeholders: Array<string> = word.match(/{{\w+}}/g) || [];

        for (const placeholder of placeholders) {
          expect({
            language,
            word,
            kept: (table[word] || "").includes(placeholder),
          }).toEqual({ language, word, kept: true });
        }
      }
    }
  });
});
