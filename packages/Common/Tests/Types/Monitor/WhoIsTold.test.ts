import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerKind,
  WhoIsToldOwnerProblem,
  WhoIsToldOwnersSource,
  WhoIsToldPagingState,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldServerChannel,
  getChannelsSwitchedOff,
  getReachablePeople,
  getWhoIsToldBreakMessage,
  getWhoIsToldBreaks,
  getWhoIsToldHeadline,
  getWhoIsToldPagingState,
  getWhoIsToldPersonReach,
  makeWhoIsToldBreak,
  redactWhoIsTold,
  canWhoIsToldChannelSendNow,
  getWhoIsToldOwnersAsTold,
  isWhoIsToldPersonPagedAtOnce,
} from "../../../Types/Monitor/WhoIsTold";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { getWhoCanTurnOnSentence } from "../../../Utils/Project/NotificationChannels";
import {
  OnCallTestPageNotPagedCode,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO IS TOLD WHEN A MONITOR GOES DOWN, AND WHERE THE CHAIN BREAKS (#6810).
 *
 * The pure half of the resolver: how a page of one severity reaches one
 * person, every break a chain can have (each break #6805 lists has a case
 * here), what a caller who may not read a policy is told, and what the
 * card's sentences are about.
 */

const POLICY_ID: string = "6810aaaa-0000-4000-8000-000000000001";
const OTHER_POLICY_ID: string = "6810aaaa-0000-4000-8000-000000000002";
const RULE_ID: string = "6810bbbb-0000-4000-8000-000000000001";
const OWNER_RULE_ID: string = "6810bbbb-0000-4000-8000-000000000002";
const STATUS_PAGE_ID: string = "6810dddd-0000-4000-8000-000000000001";
const OTHER_STATUS_PAGE_ID: string = "6810dddd-0000-4000-8000-000000000002";
const ANA: string = "6810cccc-0000-4000-8000-000000000001";
const BEN: string = "6810cccc-0000-4000-8000-000000000002";

function channels(
  overrides: Partial<WhoIsToldChannels> = {},
): WhoIsToldChannels {
  return {
    isBillingEnabled: false,
    isSmsOn: true,
    isCallOn: true,
    isWhatsAppOn: true,
    isTelegramOn: true,
    hasOwnTwilioForSms: false,
    hasOwnTwilioForCalls: false,
    serverCanSendEmail: true,
    serverCanSendSms: true,
    serverCanCall: true,
    ...overrides,
  };
}

function person(overrides: Partial<WhoIsToldPerson> = {}): WhoIsToldPerson {
  return {
    userId: ANA,
    name: "Ana Lopez",
    channels: [OnCallPageChannel.Email],
    isFallback: false,
    isReachable: true,
    ...overrides,
  };
}

function policy(overrides: Partial<WhoIsToldPolicy> = {}): WhoIsToldPolicy {
  return {
    id: POLICY_ID,
    name: "Primary",
    isHidden: false,
    isNamedByCriteria: false,
    ruleIds: [RULE_ID],
    levelCount: 1,
    people: [person()],
    notPaged: [],
    ...overrides,
  };
}

function event(overrides: Partial<WhoIsToldEvent> = {}): WhoIsToldEvent {
  return {
    kind: OnCallTestPageRecordKind.Incident,
    title: "Checkout API is offline",
    severityName: "Critical",
    owners: {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: ["Ana Lopez"],
      teamNames: [],
    },
    ownerRules: [],
    rules: [{ id: RULE_ID, name: "Every incident" }],
    policies: [policy()],
    statusPages: [],
    ...overrides,
  };
}

function criteria(
  overrides: Partial<WhoIsToldCriteria> = {},
): WhoIsToldCriteria {
  return {
    id: "offline",
    name: "Offline",
    statusName: "Offline",
    events: [event()],
    ...overrides,
  };
}

function breaksOf(data: {
  criteria: Array<WhoIsToldCriteria>;
  channels?: WhoIsToldChannels;
  incidentRules?: boolean;
  alertRules?: boolean;
  policies?: boolean;
}): Array<WhoIsToldBreak> {
  return getWhoIsToldBreaks({
    criteria: data.criteria,
    channels: data.channels || channels(),
    projectHasIncidentOnCallRules: data.incidentRules ?? true,
    projectHasAlertOnCallRules: data.alertRules ?? true,
    projectHasOnCallPolicies: data.policies ?? true,
  });
}

function kindsOf(breaks: Array<WhoIsToldBreak>): Array<WhoIsToldBreakKind> {
  return breaks.map((brk: WhoIsToldBreak): WhoIsToldBreakKind => {
    return brk.kind;
  });
}

describe("how a page of one severity reaches one person", () => {
  const base: Parameters<typeof getWhoIsToldPersonReach>[0] = {
    ruleMethods: [
      { channel: OnCallPageChannel.SMS, isVerified: true },
      { channel: OnCallPageChannel.Email, isVerified: true },
    ],
    hasNoRule: false,
    isOptedOut: false,
    fallbackChannels: [OnCallPageChannel.Push],
    verifiedChannels: [OnCallPageChannel.Push],
    isFallbackEnabled: true,
    channelsOff: [],
  };

  test("through the verified methods their rules for the severity use, in order", () => {
    expect(getWhoIsToldPersonReach(base)).toEqual({
      channels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
      isFallback: false,
      isReachable: true,
    });
  });

  test("an unverified method of a rule sends nothing", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        ruleMethods: [
          { channel: OnCallPageChannel.SMS, isVerified: false },
          { channel: OnCallPageChannel.Email, isVerified: true },
        ],
      }).channels,
    ).toEqual([OnCallPageChannel.Email]);
  });

  test("a channel two rules use is said once", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        ruleMethods: [
          { channel: OnCallPageChannel.Email, isVerified: true },
          { channel: OnCallPageChannel.Email, isVerified: true },
        ],
      }).channels,
    ).toEqual([OnCallPageChannel.Email]);
  });

  test("with rules but none verified, nobody is reached: no verified method", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        ruleMethods: [{ channel: OnCallPageChannel.SMS, isVerified: false }],
      }),
    ).toEqual({
      channels: [],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
    });
  });

  test("with no rule for the severity, a page goes to what the fallback picks", () => {
    expect(
      getWhoIsToldPersonReach({ ...base, ruleMethods: [], hasNoRule: true }),
    ).toEqual({
      channels: [OnCallPageChannel.Push],
      isFallback: true,
      isReachable: true,
    });
  });

  test("with no rule and no verified method, the fallback reaches nobody", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        ruleMethods: [],
        hasNoRule: true,
        fallbackChannels: [],
        verifiedChannels: [],
      }),
    ).toEqual({
      channels: [],
      isFallback: true,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
    });
  });

  test("with no rule, and the project's fallback off, nothing is sent", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        ruleMethods: [],
        hasNoRule: true,
        isFallbackEnabled: false,
      }),
    ).toEqual({
      channels: [],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoRuleNoFallback,
    });
  });

  test("somebody who opted out of the severity is not paged, whatever falls back", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        ruleMethods: [],
        hasNoRule: true,
        isOptedOut: true,
      }).problem,
    ).toBe(WhoIsToldPersonProblem.OptedOut);
  });

  test("a channel the project switched off sends nothing; the others still do", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        channelsOff: [OnCallPageChannel.SMS],
      }),
    ).toEqual({
      channels: [OnCallPageChannel.Email],
      isFallback: false,
      isReachable: true,
    });
  });

  test("reached only by switched-off channels, nobody is reached, and the channels are kept to name", () => {
    expect(
      getWhoIsToldPersonReach({
        ...base,
        ruleMethods: [{ channel: OnCallPageChannel.SMS, isVerified: true }],
        channelsOff: [OnCallPageChannel.SMS],
      }),
    ).toEqual({
      channels: [OnCallPageChannel.SMS],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.ChannelsOff,
    });
  });
});

/*
 * #7528: a person with no rule for the severity is reached by what the
 * project's fallback picks (UserNotificationRuleService
 * .executeFallbackNotification) - every free verified method, or else ONE
 * paid one, or else a webhook - never by every method they verified. The
 * card listed "Email, SMS and Phone call" for somebody a High page only
 * emails.
 */
describe("a person with no rule for the severity is reached by what the fallback picks (#7528)", () => {
  const noRule: Parameters<typeof getWhoIsToldPersonReach>[0] = {
    ruleMethods: [],
    hasNoRule: true,
    isOptedOut: false,
    fallbackChannels: [],
    verifiedChannels: [],
    isFallbackEnabled: true,
    channelsOff: [],
  };

  test("a verified email, number and phone: the fallback emails them, and only that is said", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [OnCallPageChannel.Email],
        verifiedChannels: [
          OnCallPageChannel.Email,
          OnCallPageChannel.SMS,
          OnCallPageChannel.Call,
        ],
      }),
    ).toEqual({
      channels: [OnCallPageChannel.Email],
      isFallback: true,
      isReachable: true,
    });
  });

  test("no free method: the one paid method it picks, a text", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [OnCallPageChannel.SMS],
        verifiedChannels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
      }).channels,
    ).toEqual([OnCallPageChannel.SMS]);
  });

  test("texts off in the project: the call it picks instead", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [OnCallPageChannel.Call],
        verifiedChannels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
        channelsOff: [OnCallPageChannel.SMS],
      }),
    ).toEqual({
      channels: [OnCallPageChannel.Call],
      isFallback: true,
      isReachable: true,
    });
  });

  test("only a webhook: the webhook", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [OnCallPageChannel.Webhook],
      }).channels,
    ).toEqual([OnCallPageChannel.Webhook]);
  });

  test("every free method, in the order the fallback sends them, each once", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [
          OnCallPageChannel.Push,
          OnCallPageChannel.Email,
          OnCallPageChannel.Slack,
          OnCallPageChannel.Email,
        ],
      }).channels,
    ).toEqual([
      OnCallPageChannel.Push,
      OnCallPageChannel.Email,
      OnCallPageChannel.Slack,
    ]);
  });

  test("nothing verified: unreachable, with no verified method", () => {
    expect(getWhoIsToldPersonReach(noRule)).toEqual({
      channels: [],
      isFallback: true,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
    });
  });

  test("the fallback picks nothing as their only method's channel is off: that switch is the break, as for a rule", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        verifiedChannels: [OnCallPageChannel.SMS, OnCallPageChannel.SMS],
        channelsOff: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
      }),
    ).toEqual({
      channels: [OnCallPageChannel.SMS],
      isFallback: true,
      isReachable: false,
      problem: WhoIsToldPersonProblem.ChannelsOff,
    });
  });

  test("a verified method the fallback does not pick, on a channel that is on, is never said", () => {
    const reach: ReturnType<typeof getWhoIsToldPersonReach> =
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [OnCallPageChannel.Email],
        verifiedChannels: [
          OnCallPageChannel.Email,
          OnCallPageChannel.SMS,
          OnCallPageChannel.Call,
          OnCallPageChannel.WhatsApp,
        ],
      });

    expect(reach.channels).not.toContain(OnCallPageChannel.SMS);
    expect(reach.channels).not.toContain(OnCallPageChannel.Call);
    expect(reach.channels).not.toContain(OnCallPageChannel.WhatsApp);
  });

  test("the fallback off: unchanged - nothing is sent, whatever it would pick", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [OnCallPageChannel.Email],
        verifiedChannels: [OnCallPageChannel.Email],
        isFallbackEnabled: false,
      }),
    ).toEqual({
      channels: [],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoRuleNoFallback,
    });
  });

  test("opted out: unchanged - nothing is sent, whatever it would pick", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        fallbackChannels: [OnCallPageChannel.Email],
        verifiedChannels: [OnCallPageChannel.Email],
        isOptedOut: true,
      }),
    ).toEqual({
      channels: [],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.OptedOut,
    });
  });

  test("somebody with a rule is reached by their rule, never by what the fallback would pick", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        hasNoRule: false,
        ruleMethods: [{ channel: OnCallPageChannel.Call, isVerified: true }],
        fallbackChannels: [OnCallPageChannel.Email],
        verifiedChannels: [OnCallPageChannel.Email, OnCallPageChannel.Call],
      }),
    ).toEqual({
      channels: [OnCallPageChannel.Call],
      isFallback: false,
      isReachable: true,
    });
  });

  test("somebody with a rule whose method is unverified is not reached through the fallback's pick", () => {
    expect(
      getWhoIsToldPersonReach({
        ...noRule,
        hasNoRule: false,
        ruleMethods: [{ channel: OnCallPageChannel.SMS, isVerified: false }],
        fallbackChannels: [OnCallPageChannel.Email],
        verifiedChannels: [OnCallPageChannel.Email],
        channelsOff: [OnCallPageChannel.Email],
      }),
    ).toEqual({
      channels: [],
      isFallback: false,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
    });
  });
});

describe("the channels a project switched off", () => {
  test("every switch that is off, and none that is on", () => {
    expect(
      getChannelsSwitchedOff(channels({ isSmsOn: false, isTelegramOn: false })),
    ).toEqual([OnCallPageChannel.SMS, OnCallPageChannel.Telegram]);
    expect(getChannelsSwitchedOff(channels())).toEqual([]);
    expect(
      getChannelsSwitchedOff(
        channels({ isCallOn: false, isWhatsAppOn: false }),
      ),
    ).toEqual([OnCallPageChannel.Call, OnCallPageChannel.WhatsApp]);
  });
});

describe("every break in a monitor's chain", () => {
  test("a chain that reaches somebody has no break", () => {
    expect(breaksOf({ criteria: [criteria()] })).toEqual([]);
  });

  test("a monitor whose criteria do nothing tells nobody, and says to add one on the Criteria page", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({ criteria: [] });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NothingHappens]);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.MonitorCriteria);
    expect(breaks[0]!.message).toContain("Criteria page");
  });

  test("a criteria that only changes the status is not the nothing break", () => {
    expect(kindsOf(breaksOf({ criteria: [criteria({ events: [] })] }))).toEqual(
      [],
    );
  });

  test("an incident no rule matches and the criteria names no policy pages nobody: set up incident on-call rules", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [criteria({ events: [event({ rules: [], policies: [] })] })],
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.IncidentOnCallRules);
    expect(breaks[0]!.recordKind).toBe(OnCallTestPageRecordKind.Incident);
    expect(breaks[0]!.message).toContain(
      "no on-call rule matches incidents from this monitor",
    );
  });

  test("a monitor that opens an alert while only incidents have on-call rules says exactly that", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              kind: OnCallTestPageRecordKind.Alert,
              rules: [],
              policies: [],
            }),
          ],
        }),
      ],
      incidentRules: true,
      alertRules: false,
    });

    expect(kindsOf(breaks)).toEqual([
      WhoIsToldBreakKind.OnlyIncidentsHaveRules,
    ]);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.AlertOnCallRules);
    expect(breaks[0]!.message).toContain("only incidents have on-call rules");
  });

  test("an alert that pages nobody in a project with no rules at all is the plain nobody-paged break, for alerts", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              kind: OnCallTestPageRecordKind.Alert,
              rules: [],
              policies: [],
            }),
          ],
        }),
      ],
      incidentRules: false,
      alertRules: false,
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.AlertOnCallRules);
    expect(breaks[0]!.message).toContain("alerts from this monitor");
  });

  test("an alert whose project has alert rules that don't match it is the nobody-paged break too", () => {
    expect(
      kindsOf(
        breaksOf({
          criteria: [
            criteria({
              events: [
                event({
                  kind: OnCallTestPageRecordKind.Alert,
                  rules: [],
                  policies: [],
                }),
              ],
            }),
          ],
          incidentRules: true,
          alertRules: true,
        }),
      ),
    ).toEqual([WhoIsToldBreakKind.NobodyPaged]);
  });

  /*
   * #7369: in a project with no on-call policy yet - a new project's first
   * monitor - "Set Up Paging" opened the incident on-call rules builder,
   * whose rules page policies the project does not have. The fix is the
   * on-call guided setup there, which makes the first policy with the
   * rules that run it for every new incident and alert; a project with a
   * policy keeps the rules.
   */
  describe("nobody paged in a project with no on-call policy yet (#7369)", () => {
    test("an incident: the fix is the on-call guided setup, and the sentence says why", () => {
      const breaks: Array<WhoIsToldBreak> = breaksOf({
        criteria: [criteria({ events: [event({ rules: [], policies: [] })] })],
        incidentRules: false,
        alertRules: false,
        policies: false,
      });

      expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
      expect(breaks[0]!.fix).toBe(WhoIsToldFix.OnCallGuidedSetup);
      expect(breaks[0]!.recordKind).toBe(OnCallTestPageRecordKind.Incident);
      expect(breaks[0]!.message).toBe(
        "Nobody is paged: this project has no on-call policy yet. Set up paging to make one that pages someone for every new incident and alert.",
      );
    });

    test("an alert: the same fix, as the setup adds the alert rule too", () => {
      const breaks: Array<WhoIsToldBreak> = breaksOf({
        criteria: [
          criteria({
            events: [
              event({
                kind: OnCallTestPageRecordKind.Alert,
                rules: [],
                policies: [],
              }),
            ],
          }),
        ],
        incidentRules: false,
        alertRules: false,
        policies: false,
      });

      expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
      expect(breaks[0]!.fix).toBe(WhoIsToldFix.OnCallGuidedSetup);
      expect(breaks[0]!.recordKind).toBe(OnCallTestPageRecordKind.Alert);
    });

    test("an incident and an alert from one monitor: each is its own break, both to the setup", () => {
      const breaks: Array<WhoIsToldBreak> = breaksOf({
        criteria: [
          criteria({
            events: [
              event({ rules: [], policies: [] }),
              event({
                kind: OnCallTestPageRecordKind.Alert,
                rules: [],
                policies: [],
              }),
            ],
          }),
        ],
        incidentRules: false,
        alertRules: false,
        policies: false,
      });

      expect(
        breaks.map((brk: WhoIsToldBreak): Array<unknown> => {
          return [brk.kind, brk.recordKind, brk.fix];
        }),
      ).toEqual([
        [
          WhoIsToldBreakKind.NobodyPaged,
          OnCallTestPageRecordKind.Incident,
          WhoIsToldFix.OnCallGuidedSetup,
        ],
        [
          WhoIsToldBreakKind.NobodyPaged,
          OnCallTestPageRecordKind.Alert,
          WhoIsToldFix.OnCallGuidedSetup,
        ],
      ]);
    });

    test("a project with a policy keeps the rules as the fix, for incidents and alerts", () => {
      const incident: Array<WhoIsToldBreak> = breaksOf({
        criteria: [criteria({ events: [event({ rules: [], policies: [] })] })],
        incidentRules: false,
        alertRules: false,
        policies: true,
      });
      const alert: Array<WhoIsToldBreak> = breaksOf({
        criteria: [
          criteria({
            events: [
              event({
                kind: OnCallTestPageRecordKind.Alert,
                rules: [],
                policies: [],
              }),
            ],
          }),
        ],
        incidentRules: true,
        alertRules: true,
        policies: true,
      });

      expect(incident[0]!.fix).toBe(WhoIsToldFix.IncidentOnCallRules);
      expect(incident[0]!.message).toContain(
        "Add an on-call rule for incidents.",
      );
      expect(alert[0]!.fix).toBe(WhoIsToldFix.AlertOnCallRules);
    });

    /*
     * Incident rules whose policies were all deleted page nobody either: the
     * missing policy is the break, not the missing alert rule, as an alert
     * rule would have no policy to page.
     */
    test("alerts while only incidents have rules, and no policy: the policy is what is missing", () => {
      const breaks: Array<WhoIsToldBreak> = breaksOf({
        criteria: [
          criteria({
            events: [
              event({
                kind: OnCallTestPageRecordKind.Alert,
                rules: [],
                policies: [],
              }),
            ],
          }),
        ],
        incidentRules: true,
        alertRules: false,
        policies: false,
      });

      expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
      expect(breaks[0]!.fix).toBe(WhoIsToldFix.OnCallGuidedSetup);
    });

    test("alerts while only incidents have rules, with a policy: the alert rules, as before", () => {
      const breaks: Array<WhoIsToldBreak> = breaksOf({
        criteria: [
          criteria({
            events: [
              event({
                kind: OnCallTestPageRecordKind.Alert,
                rules: [],
                policies: [],
              }),
            ],
          }),
        ],
        incidentRules: true,
        alertRules: false,
        policies: true,
      });

      expect(kindsOf(breaks)).toEqual([
        WhoIsToldBreakKind.OnlyIncidentsHaveRules,
      ]);
      expect(breaks[0]!.fix).toBe(WhoIsToldFix.AlertOnCallRules);
    });

    test("a chain that pages somebody has no break, policies or none", () => {
      expect(breaksOf({ criteria: [criteria()], policies: false })).toEqual([]);
    });

    test("a monitor whose criteria do nothing is the criteria's break, not the setup's", () => {
      const breaks: Array<WhoIsToldBreak> = breaksOf({
        criteria: [],
        policies: false,
      });

      expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NothingHappens]);
      expect(breaks[0]!.fix).toBe(WhoIsToldFix.MonitorCriteria);
    });
  });

  test("a policy with no escalation rules pages nobody, and names the policy", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({ policies: [policy({ levelCount: 0, people: [] })] }),
          ],
        }),
      ],
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
    expect(breaks[0]!.policyId).toBe(POLICY_ID);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.OnCallPolicy);
    expect(breaks[0]!.message).toContain("On-call policy Primary");
  });

  test("a schedule with nobody on it: the policy's first level reaches nobody right now", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              policies: [
                policy({
                  people: [],
                  notPaged: ["Nobody is on call in schedule Primary now."],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.PolicyReachesNobody]);
    expect(breaks[0]!.message).toContain("reaches nobody right now");
  });

  test("a person with no verified method is named, with Readiness to fix it", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              policies: [
                policy({
                  people: [
                    person({
                      isReachable: false,
                      channels: [],
                      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.PersonUnreachable]);
    expect(breaks[0]!.userId).toBe(ANA);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.OnCallReadiness);
    expect(breaks[0]!.message).toBe(
      "Ana Lopez has no verified notification method, so a page won't reach them.",
    );
  });

  test("one person reachable and one not: only the one who can't be paged is a break", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              policies: [
                policy({
                  people: [
                    person(),
                    person({
                      userId: BEN,
                      name: "Ben Ito",
                      isReachable: false,
                      channels: [],
                      problem: WhoIsToldPersonProblem.OptedOut,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.userId).toBe(BEN);
    expect(breaks[0]!.message).toContain("opted out of pages of this severity");
  });

  test("SMS switched off for the project, while a page would use it, is the switch's break, said once", () => {
    const off: WhoIsToldPerson = person({
      isReachable: false,
      channels: [OnCallPageChannel.SMS],
      problem: WhoIsToldPersonProblem.ChannelsOff,
    });

    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              policies: [
                policy({ people: [off, { ...off, userId: BEN, name: "Ben" }] }),
              ],
            }),
          ],
        }),
      ],
      channels: channels({ isSmsOn: false }),
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.ChannelOff]);
    expect(breaks[0]!.channel).toBe(OnCallPageChannel.SMS);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.ProjectNotificationSettings);
    expect(breaks[0]!.message).toContain("SMS is off in this project");
  });

  test("a channel switched off that no page would use is no break", () => {
    expect(
      breaksOf({
        criteria: [criteria()],
        channels: channels({ isSmsOn: false, isCallOn: false }),
      }),
    ).toEqual([]);
  });

  test("an empty balance on OneUptime Cloud, while pages would send SMS, is a break with Billing to fix it", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              policies: [
                policy({
                  people: [person({ channels: [OnCallPageChannel.SMS] })],
                }),
              ],
            }),
          ],
        }),
      ],
      channels: channels({
        isBillingEnabled: true,
        balanceInUSDCents: 0,
        isAutoRechargeOn: false,
        serverCanSendEmail: null,
        serverCanSendSms: null,
        serverCanCall: null,
      }),
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.NoBalance]);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.ProjectBilling);
  });

  test("an empty balance is no break with auto-recharge on, with balance left, with the project's own Twilio, or with email only", () => {
    const sms: Array<WhoIsToldCriteria> = [
      criteria({
        events: [
          event({
            policies: [
              policy({
                people: [person({ channels: [OnCallPageChannel.SMS] })],
              }),
            ],
          }),
        ],
      }),
    ];
    const cloud: WhoIsToldChannels = channels({
      isBillingEnabled: true,
      balanceInUSDCents: 0,
      isAutoRechargeOn: false,
    });

    expect(
      breaksOf({
        criteria: sms,
        channels: { ...cloud, isAutoRechargeOn: true },
      }),
    ).toEqual([]);
    expect(
      breaksOf({
        criteria: sms,
        channels: { ...cloud, balanceInUSDCents: 500 },
      }),
    ).toEqual([]);
    expect(
      breaksOf({
        criteria: sms,
        channels: { ...cloud, hasOwnTwilioForSms: true },
      }),
    ).toEqual([]);
    expect(breaksOf({ criteria: [criteria()], channels: cloud })).toEqual([]);
  });

  test("a self-hosted server that can't send email tells nobody of an owner email", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [criteria()],
      channels: channels({ serverCanSendEmail: false }),
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.ServerCannotSend]);
    expect(breaks[0]!.channel).toBe(WhoIsToldServerChannel.Email);
    expect(breaks[0]!.fix).toBe(WhoIsToldFix.ServerSettings);
  });

  test("a server that can't send SMS or call is a break only for pages that would use them, and not with the project's own Twilio", () => {
    const smsAndCall: Array<WhoIsToldCriteria> = [
      criteria({
        events: [
          event({
            policies: [
              policy({
                people: [
                  person({
                    channels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const serverCannot: WhoIsToldChannels = channels({
      serverCanSendSms: false,
      serverCanCall: false,
    });

    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: smsAndCall,
      channels: serverCannot,
    });

    expect(
      breaks.map((brk: WhoIsToldBreak): string => {
        return String(brk.channel);
      }),
    ).toEqual([WhoIsToldServerChannel.SMS, WhoIsToldServerChannel.Call]);
    expect(
      breaksOf({ criteria: [criteria()], channels: serverCannot }),
    ).toEqual([]);
    expect(
      breaksOf({
        criteria: smsAndCall,
        channels: {
          ...serverCannot,
          hasOwnTwilioForSms: true,
          hasOwnTwilioForCalls: true,
        },
      }),
    ).toEqual([]);
  });

  test("what the server can't say (OneUptime Cloud) is no break", () => {
    expect(
      breaksOf({
        criteria: [criteria()],
        channels: channels({
          serverCanSendEmail: null,
          serverCanSendSms: null,
          serverCanCall: null,
        }),
      }),
    ).toEqual([]);
  });

  test("the same break met twice - two criteria opening the same unpaged incident - is said once", () => {
    const unpaged: WhoIsToldCriteria = criteria({
      events: [event({ rules: [], policies: [] })],
    });

    expect(
      breaksOf({ criteria: [unpaged, { ...unpaged, id: "degraded" }] }),
    ).toHaveLength(1);
  });

  test("an incident paged and an alert not are told apart", () => {
    expect(
      kindsOf(
        breaksOf({
          criteria: [
            criteria({
              events: [
                event(),
                event({
                  kind: OnCallTestPageRecordKind.Alert,
                  rules: [],
                  policies: [],
                }),
              ],
            }),
          ],
          alertRules: false,
        }),
      ),
    ).toEqual([WhoIsToldBreakKind.OnlyIncidentsHaveRules]);
  });

  test("breaks come in the order a reader meets them: the criteria, the policies, then the channels", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            event({
              policies: [
                policy({
                  people: [
                    person({
                      isReachable: false,
                      channels: [],
                      problem: WhoIsToldPersonProblem.NoVerifiedMethod,
                    }),
                  ],
                }),
              ],
            }),
            event({
              kind: OnCallTestPageRecordKind.Alert,
              rules: [],
              policies: [],
            }),
          ],
        }),
      ],
      channels: channels({ serverCanSendEmail: false }),
      alertRules: false,
    });

    expect(kindsOf(breaks)).toEqual([
      WhoIsToldBreakKind.PersonUnreachable,
      WhoIsToldBreakKind.OnlyIncidentsHaveRules,
      WhoIsToldBreakKind.ServerCannotSend,
    ]);
  });

  test("the inside of a policy the caller may not read is never a break", () => {
    expect(
      breaksOf({
        criteria: [
          criteria({
            events: [
              event({
                policies: [
                  policy({ isHidden: true, levelCount: 0, people: [] }),
                ],
              }),
            ],
          }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("a break's sentence", () => {
  test("names what it is about, and leaves out a name it doesn't have", () => {
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.PolicyHasNoLevels,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: POLICY_ID,
        policyName: "Primary",
      }),
    ).toContain("On-call policy Primary has no escalation rules");
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.PolicyHasNoLevels,
        fix: WhoIsToldFix.OnCallPolicy,
        policyId: POLICY_ID,
      }),
    ).toContain("An on-call policy has no escalation rules");
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.PersonUnreachable,
        fix: WhoIsToldFix.OnCallReadiness,
        problem: WhoIsToldPersonProblem.NoRuleNoFallback,
      }),
    ).toContain("Someone this policy pages has no on-call rule");
  });

  test("nobody paged says why by its fix: no policy yet, or no rule that matches (#7369)", () => {
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.OnCallGuidedSetup,
        recordKind: OnCallTestPageRecordKind.Alert,
      }),
    ).toBe(
      "Nobody is paged: this project has no on-call policy yet. Set up paging to make one that pages someone for every new incident and alert.",
    );
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.AlertOnCallRules,
        recordKind: OnCallTestPageRecordKind.Alert,
      }),
    ).toBe(
      "Nobody is paged: no on-call rule matches alerts from this monitor, and its criteria names no on-call policy. Add an on-call rule for alerts.",
    );
  });

  test("every kind of break says something, and what to change", () => {
    for (const kind of Object.values(WhoIsToldBreakKind)) {
      const message: string = getWhoIsToldBreakMessage({
        kind: kind,
        fix: WhoIsToldFix.MonitorCriteria,
      });

      expect(message.length).toBeGreaterThan(20);
      expect(message.endsWith(".")).toBe(true);
    }
  });

  /*
   * A channel costs money, so its switch is billing: a Project Admin may
   * not flip it. The sentence said "A Project Owner or Project Admin turns
   * it on", and began "phone call is off" in lower case.
   */
  test("a channel switched off says who may turn it on, as the switch's own permissions say, and starts with a capital", () => {
    const call: string = getWhoIsToldBreakMessage({
      kind: WhoIsToldBreakKind.ChannelOff,
      fix: WhoIsToldFix.ProjectNotificationSettings,
      channel: OnCallPageChannel.Call,
    });

    expect(call).toBe(
      `Phone call is off in this project, so pages that use it are not sent. ${getWhoCanTurnOnSentence("it")}`,
    );
    expect(call).not.toContain("Project Admin");
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
        channel: OnCallPageChannel.SMS,
      }),
    ).toMatch(/^SMS is off in this project/);
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.ChannelOff,
        fix: WhoIsToldFix.ProjectNotificationSettings,
      }),
    ).toMatch(/^A channel is off in this project/);
  });

  test("the server's break names the channel it can't send by", () => {
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.ServerCannotSend,
        fix: WhoIsToldFix.ServerSettings,
        channel: WhoIsToldServerChannel.Call,
      }),
    ).toContain("can't make phone calls");
    expect(
      getWhoIsToldBreakMessage({
        kind: WhoIsToldBreakKind.ServerCannotSend,
        fix: WhoIsToldFix.ServerSettings,
        channel: WhoIsToldServerChannel.SMS,
      }),
    ).toContain("can't send SMS");
  });

  test("a made break carries no empty fields", () => {
    const brk: WhoIsToldBreak = makeWhoIsToldBreak({
      kind: WhoIsToldBreakKind.NoBalance,
      fix: WhoIsToldFix.ProjectBilling,
      policyId: undefined,
    });

    expect(Object.keys(brk).sort()).toEqual(["fix", "kind", "message"]);
  });
});

function resultWith(criteriaList: Array<WhoIsToldCriteria>): WhoIsToldResult {
  return {
    monitorId: "m",
    monitorName: "Checkout API",
    checkedAt: "2026-11-12T10:00:00.000Z",
    criteria: criteriaList,
    channels: channels(),
    breaks: breaksOf({ criteria: criteriaList }),
  };
}

describe("the answer as one caller may see it", () => {
  // Why each is paged and who is not, in English and as codes (#7261).
  const unreachable: WhoIsToldPolicy = policy({
    people: [
      person({
        isReachable: false,
        channels: [],
        problem: WhoIsToldPersonProblem.NoVerifiedMethod,
        reachedThrough: "Schedule Primary",
        reachedThroughCode: {
          code: OnCallTestPageReachedThroughCode.Schedule,
          name: "Primary",
        },
      }),
    ],
    notPaged: ["Team Platform has no members."],
    notPagedCodes: [
      {
        code: OnCallTestPageNotPagedCode.TeamHasNoMembers,
        teamName: "Platform",
        message: "Team Platform has no members.",
      },
    ],
  });

  test("a policy they may read is told whole", () => {
    const result: WhoIsToldResult = resultWith([
      criteria({ events: [event({ policies: [unreachable] })] }),
    ]);

    expect(
      redactWhoIsTold({
        result: result,
        readablePolicyIds: new Set<string>([POLICY_ID]),
        readableRuleIds: new Set<string>([RULE_ID]),
        readableOwnerRuleIds: new Set<string>(),
        readableStatusPageIds: new Set<string>(),
      }),
    ).toEqual(result);
  });

  test("a policy they may not read says paging is set up, and nothing of who", () => {
    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: resultWith([
        criteria({ events: [event({ policies: [unreachable] })] }),
      ]),
      readablePolicyIds: new Set<string>(),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });

    const hidden: WhoIsToldPolicy =
      redacted.criteria[0]!.events[0]!.policies[0]!;

    expect(hidden).toStrictEqual({
      id: POLICY_ID,
      name: "",
      isHidden: true,
      isNamedByCriteria: false,
      ruleIds: [RULE_ID],
      levelCount: 0,
      people: [],
      notPaged: [],
      notPagedCodes: [],
    });
    expect(JSON.stringify(redacted)).not.toContain("Ana Lopez has");
    expect(JSON.stringify(redacted)).not.toContain("Primary");
    expect(JSON.stringify(redacted)).not.toContain("Team Platform");
    // Nor the names its codes carry.
    expect(JSON.stringify(redacted)).not.toContain("Platform");
    expect(JSON.stringify(redacted)).not.toContain(
      OnCallTestPageNotPagedCode.TeamHasNoMembers,
    );
    expect(redacted.breaks).toEqual([]);
  });

  test("a policy break they may not read keeps its kind and loses the policy's name", () => {
    const result: WhoIsToldResult = resultWith([
      criteria({
        events: [event({ policies: [policy({ levelCount: 0, people: [] })] })],
      }),
    ]);

    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: result,
      readablePolicyIds: new Set<string>(),
      readableRuleIds: new Set<string>(),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });

    expect(redacted.breaks).toHaveLength(1);
    expect(redacted.breaks[0]!.kind).toBe(WhoIsToldBreakKind.PolicyHasNoLevels);
    expect(redacted.breaks[0]!.policyName).toBeUndefined();
    expect(redacted.breaks[0]!.message).toContain("An on-call policy");
    expect(redacted.breaks[0]!.message).not.toContain("Primary");
  });

  test("a rule they may not read keeps its place without its name", () => {
    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: resultWith([criteria()]),
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>(),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });

    expect(redacted.criteria[0]!.events[0]!.rules).toEqual([
      { id: RULE_ID, name: "" },
    ]);
  });

  /*
   * Owner rules and status pages are read with their own permissions, and
   * status pages are label-scoped: one the caller may not read keeps its
   * place, so the card still says it is there, without its name.
   */
  function withOwnerRuleAndPages(): WhoIsToldResult {
    return resultWith([
      criteria({
        events: [
          event({
            owners: {
              source: WhoIsToldOwnersSource.OwnerRules,
              userNames: ["Ben Ito"],
              teamNames: ["Checkout SRE"],
            },
            ownerRules: [{ id: OWNER_RULE_ID, name: "Checkout monitors" }],
            statusPages: [
              { id: STATUS_PAGE_ID, name: "Public Status" },
              { id: OTHER_STATUS_PAGE_ID, name: "Payments Status" },
            ],
          }),
        ],
      }),
    ]);
  }

  test("owner rules and status pages they may read are told whole", () => {
    const result: WhoIsToldResult = withOwnerRuleAndPages();

    expect(
      redactWhoIsTold({
        result: result,
        readablePolicyIds: new Set<string>([POLICY_ID]),
        readableRuleIds: new Set<string>([RULE_ID]),
        readableOwnerRuleIds: new Set<string>([OWNER_RULE_ID]),
        readableStatusPageIds: new Set<string>([
          STATUS_PAGE_ID,
          OTHER_STATUS_PAGE_ID,
        ]),
      }),
    ).toEqual(result);
  });

  test("an owner rule they may not read keeps its place without its name", () => {
    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: withOwnerRuleAndPages(),
      readablePolicyIds: new Set<string>([POLICY_ID]),
      // An on-call rule's permission is not an owner rule's.
      readableRuleIds: new Set<string>([RULE_ID, OWNER_RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>([
        STATUS_PAGE_ID,
        OTHER_STATUS_PAGE_ID,
      ]),
    });
    const redactedEvent: WhoIsToldEvent = redacted.criteria[0]!.events[0]!;

    expect(redactedEvent.ownerRules).toEqual([{ id: OWNER_RULE_ID, name: "" }]);
    expect(JSON.stringify(redacted)).not.toContain("Checkout monitors");
    // Who it emails is what the incident says, and stays.
    expect(redactedEvent.owners.userNames).toEqual(["Ben Ito"]);
    expect(redactedEvent.rules).toEqual([
      { id: RULE_ID, name: "Every incident" },
    ]);
  });

  test("a status page they may not read keeps its place without its name, and only that one", () => {
    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: withOwnerRuleAndPages(),
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>([OWNER_RULE_ID]),
      readableStatusPageIds: new Set<string>([STATUS_PAGE_ID]),
    });

    expect(redacted.criteria[0]!.events[0]!.statusPages).toEqual([
      { id: STATUS_PAGE_ID, name: "Public Status" },
      { id: OTHER_STATUS_PAGE_ID, name: "" },
    ]);
    expect(JSON.stringify(redacted)).not.toContain("Payments Status");
    expect(redacted.criteria[0]!.events[0]!.ownerRules[0]!.name).toBe(
      "Checkout monitors",
    );
  });

  test("redacting leaves the answer it was handed as it was", () => {
    const result: WhoIsToldResult = withOwnerRuleAndPages();
    const before: string = JSON.stringify(result);

    redactWhoIsTold({
      result: result,
      readablePolicyIds: new Set<string>(),
      readableRuleIds: new Set<string>(),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });

    // The cached answer every caller is handed their own view of.
    expect(JSON.stringify(result)).toBe(before);
  });

  test("breaks about no policy at all are told to everybody", () => {
    const result: WhoIsToldResult = resultWith([
      criteria({ events: [event({ rules: [], policies: [] })] }),
    ]);

    expect(
      redactWhoIsTold({
        result: result,
        readablePolicyIds: new Set<string>(),
        readableRuleIds: new Set<string>(),
        readableOwnerRuleIds: new Set<string>(),
        readableStatusPageIds: new Set<string>(),
      }).breaks,
    ).toEqual(result.breaks);
  });

  test("only the unreadable of two policies is hidden", () => {
    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: resultWith([
        criteria({
          events: [
            event({
              policies: [
                policy(),
                policy({ id: OTHER_POLICY_ID, name: "Secret" }),
              ],
            }),
          ],
        }),
      ]),
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });

    const policies: Array<WhoIsToldPolicy> =
      redacted.criteria[0]!.events[0]!.policies;

    expect(policies[0]!.isHidden).toBe(false);
    expect(policies[0]!.name).toBe("Primary");
    expect(policies[1]!.isHidden).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain("Secret");
  });
});

describe("what the card's sentences are about", () => {
  test("the first criteria that opens something, not an earlier one that only sets a status", () => {
    const online: WhoIsToldCriteria = criteria({
      id: "online",
      name: "Online",
      statusName: "Operational",
      events: [],
    });
    const offline: WhoIsToldCriteria = criteria();

    expect(getWhoIsToldHeadline({ criteria: [online, offline] })).toEqual({
      criteria: offline,
      event: offline.events[0],
    });
  });

  test("none, when no criteria opens anything", () => {
    expect(
      getWhoIsToldHeadline({ criteria: [criteria({ events: [] })] }),
    ).toBeNull();
    expect(getWhoIsToldHeadline({ criteria: [] })).toBeNull();
  });

  test("how paging stands: pages, nobody, hidden, unreachable", () => {
    expect(getWhoIsToldPagingState(event())).toBe(WhoIsToldPagingState.Pages);
    expect(getWhoIsToldPagingState(event({ policies: [] }))).toBe(
      WhoIsToldPagingState.Nobody,
    );
    expect(
      getWhoIsToldPagingState(
        event({ policies: [policy({ isHidden: true, people: [] })] }),
      ),
    ).toBe(WhoIsToldPagingState.Hidden);
    expect(
      getWhoIsToldPagingState(
        event({
          policies: [
            policy({ people: [person({ isReachable: false, channels: [] })] }),
          ],
        }),
      ),
    ).toBe(WhoIsToldPagingState.Unreachable);
    expect(
      getWhoIsToldPagingState(
        event({ policies: [policy({ isHidden: true }), policy()] }),
      ),
    ).toBe(WhoIsToldPagingState.Pages);
  });

  test("the people paged are each named once, the reachable ones only", () => {
    const people: Array<WhoIsToldPerson> = getReachablePeople([
      policy(),
      policy({
        id: OTHER_POLICY_ID,
        people: [
          person(),
          person({ userId: BEN, name: "Ben", isReachable: false }),
        ],
      }),
    ]);

    expect(
      people.map((item: WhoIsToldPerson): string => {
        return item.userId;
      }),
    ).toEqual([ANA]);
  });
});

/*
 * AN OWNER THE PAGE REACHES FIRST IS NOT EMAILED AS AN OWNER TOO (#8860).
 *
 * The owners' "created" email leaves out an owner the record's on-call page
 * reached already (#7987). The card says so only where the job will in fact
 * leave them out: someone a readable policy's first level pages at once, by
 * a notification that goes out then - matched by user id, through a team
 * too - and nobody else. A policy the reader may not read says nothing.
 */
describe("the owners a page reaches first, whom the Created email leaves out", () => {
  const CARA: string = "6810cccc-0000-4000-8000-000000000003";

  type Recipient = {
    userId: string;
    name: string;
    isNamed: boolean;
    teamNames: Array<string>;
  };

  const ANA_OWNER: Recipient = {
    userId: ANA,
    name: "Ana Lopez",
    isNamed: true,
    teamNames: [],
  };
  const BEN_OWNER: Recipient = {
    userId: BEN,
    name: "Ben Ito",
    isNamed: true,
    teamNames: [],
  };

  // Ana, paged at once by email through Primary, which pages at once.
  function pagedAtOnce(
    overrides: Partial<WhoIsToldPerson> = {},
  ): WhoIsToldPerson {
    return person({ channelsAtOnce: [OnCallPageChannel.Email], ...overrides });
  }

  function primary(overrides: Partial<WhoIsToldPolicy> = {}): WhoIsToldPolicy {
    return policy({ pagesAtOnce: true, people: [pagedAtOnce()], ...overrides });
  }

  function ownersOf(data: {
    userNames?: Array<string>;
    teamNames?: Array<string>;
    source?: WhoIsToldOwnersSource;
    recipients?: Array<Recipient>;
  }): WhoIsToldEvent["owners"] {
    return {
      source: data.source || WhoIsToldOwnersSource.Named,
      userNames: data.userNames || ["Ana Lopez", "Ben Ito"],
      teamNames: data.teamNames || [],
      recipients: data.recipients || [ANA_OWNER, BEN_OWNER],
    };
  }

  function told(data: {
    owners?: WhoIsToldEvent["owners"];
    policies?: Array<WhoIsToldPolicy>;
    channels?: WhoIsToldChannels;
  }): WhoIsToldEvent["owners"] {
    return getWhoIsToldOwnersAsTold({
      owners: data.owners || ownersOf({}),
      policies: data.policies || [primary()],
      channels: data.channels || channels(),
    });
  }

  test("an owner the first level pages at once is left out of the email, by id, and named as paged", () => {
    expect(told({})).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ben Ito"],
      teamNames: [],
      pagedOwners: [{ userId: ANA, name: "Ana Lopez" }],
    });
  });

  test("the one-person project: its owner, on call, is paged and not emailed - the email reaches nobody", () => {
    expect(
      told({
        owners: ownersOf({
          source: WhoIsToldOwnersSource.ProjectOwners,
          userNames: ["Ana Lopez"],
          recipients: [ANA_OWNER],
        }),
      }),
    ).toEqual({
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: [],
      teamNames: [],
      pagedOwners: [{ userId: ANA, name: "Ana Lopez" }],
    });
  });

  test("the email's recipients never leave the server", () => {
    expect(told({}).recipients).toBeUndefined();
    expect(
      told({ policies: [primary({ pagesAtOnce: false })] }).recipients,
    ).toBeUndefined();
  });

  test("matched by user id, never by name: somebody of an owner's name on call is no owner", () => {
    const owners: WhoIsToldEvent["owners"] = told({
      policies: [
        primary({
          people: [pagedAtOnce({ userId: CARA, name: "Ana Lopez" })],
        }),
      ],
    });

    expect(owners.userNames).toEqual(["Ana Lopez", "Ben Ito"]);
    expect(owners.pagedOwners).toBeUndefined();
  });

  test.each<[string, Partial<WhoIsToldPolicy>, Partial<WhoIsToldPerson>]>([
    [
      "a policy held for working hours or for OneUptime AI",
      { pagesAtOnce: false },
      {},
    ],
    [
      "a policy an older server says nothing of",
      { pagesAtOnce: undefined },
      {},
    ],
    [
      "a person who cannot be reached (opted out, no rule and no fallback, no verified method)",
      {},
      {
        isReachable: false,
        problem: WhoIsToldPersonProblem.OptedOut,
        channelsAtOnce: [],
      },
    ],
    [
      "a person the answer says can't be reached, whatever channels it lists",
      {},
      {
        isReachable: false,
        problem: WhoIsToldPersonProblem.NoVerifiedMethod,
        channelsAtOnce: [OnCallPageChannel.Email],
      },
    ],
    ["a person whose first notification waits", {}, { channelsAtOnce: [] }],
    [
      "a person an older server says nothing of",
      {},
      { channelsAtOnce: undefined },
    ],
  ])(
    "%s: they are still emailed as an owner",
    (
      _name: string,
      policyOverrides: Partial<WhoIsToldPolicy>,
      personOverrides: Partial<WhoIsToldPerson>,
    ) => {
      const owners: WhoIsToldEvent["owners"] = told({
        policies: [
          primary({
            ...policyOverrides,
            people: [pagedAtOnce(personOverrides)],
          }),
        ],
      });

      expect(owners.userNames).toEqual(["Ana Lopez", "Ben Ito"]);
      expect(owners.pagedOwners).toBeUndefined();
    },
  );

  test("on a later level only, they are no first-level person: still emailed", () => {
    expect(
      told({ policies: [primary({ people: [], levelCount: 2 })] }).pagedOwners,
    ).toBeUndefined();
  });

  test("a policy the reader may not read says nothing of whom it pages: they read as emailed, as before", () => {
    const owners: WhoIsToldEvent["owners"] = told({
      policies: [primary({ isHidden: true })],
    });

    expect(owners.userNames).toEqual(["Ana Lopez", "Ben Ito"]);
    expect(owners.pagedOwners).toBeUndefined();
  });

  test("an owner through a team is left out; the team stays while it has a member the email still reaches", () => {
    const owners: WhoIsToldEvent["owners"] = told({
      owners: ownersOf({
        userNames: [],
        teamNames: ["Platform", "Checkout SRE"],
        recipients: [
          {
            userId: ANA,
            name: "Ana Lopez",
            isNamed: false,
            teamNames: ["Platform", "Checkout SRE"],
          },
          {
            userId: BEN,
            name: "Ben Ito",
            isNamed: false,
            teamNames: ["Checkout SRE"],
          },
        ],
      }),
    });

    expect(owners.teamNames).toEqual(["Checkout SRE"]);
    expect(owners.pagedOwners).toEqual([{ userId: ANA, name: "Ana Lopez" }]);
  });

  test("a team whose every member the page reaches first is emailed nobody through", () => {
    const owners: WhoIsToldEvent["owners"] = told({
      owners: ownersOf({
        userNames: [],
        teamNames: ["Platform"],
        recipients: [
          {
            userId: ANA,
            name: "Ana Lopez",
            isNamed: false,
            teamNames: ["Platform"],
          },
        ],
      }),
    });

    expect(owners.teamNames).toEqual([]);
    expect(owners.userNames).toEqual([]);
  });

  test("a team none of whose members is listed stays: nothing says otherwise", () => {
    expect(
      told({
        owners: ownersOf({
          userNames: ["Ana Lopez"],
          teamNames: ["Platform"],
          recipients: [ANA_OWNER],
        }),
      }).teamNames,
    ).toEqual(["Platform"]);
  });

  test("an owner named and a member of a team: left out of both", () => {
    const owners: WhoIsToldEvent["owners"] = told({
      owners: ownersOf({
        userNames: ["Ana Lopez"],
        teamNames: ["Platform"],
        recipients: [
          {
            userId: ANA,
            name: "Ana Lopez",
            isNamed: true,
            teamNames: ["Platform"],
          },
          {
            userId: BEN,
            name: "Ben Ito",
            isNamed: false,
            teamNames: ["Platform"],
          },
        ],
      }),
    });

    expect(owners.userNames).toEqual([]);
    expect(owners.teamNames).toEqual(["Platform"]);
    expect(owners.pagedOwners).toEqual([{ userId: ANA, name: "Ana Lopez" }]);
  });

  test("two owners of one name, one paged: the name stays for the other", () => {
    const owners: WhoIsToldEvent["owners"] = told({
      owners: ownersOf({
        userNames: ["Ana Lopez"],
        recipients: [ANA_OWNER, { ...ANA_OWNER, userId: CARA }],
      }),
    });

    expect(owners.userNames).toEqual(["Ana Lopez"]);
    expect(owners.pagedOwners).toEqual([{ userId: ANA, name: "Ana Lopez" }]);
  });

  test("any policy paging them at once is enough, and they are named once", () => {
    const owners: WhoIsToldEvent["owners"] = told({
      policies: [
        primary({ pagesAtOnce: false }),
        primary({ id: OTHER_POLICY_ID }),
        primary(),
      ],
    });

    expect(owners.pagedOwners).toEqual([{ userId: ANA, name: "Ana Lopez" }]);
  });

  test.each<[string, Partial<WhoIsToldChannels>, OnCallPageChannel]>([
    [
      "email a self-hosted server can't send yet",
      { serverCanSendEmail: false },
      OnCallPageChannel.Email,
    ],
    [
      "SMS a self-hosted server can't send yet",
      { serverCanSendSms: false },
      OnCallPageChannel.SMS,
    ],
    [
      "a call a self-hosted server can't make yet",
      { serverCanCall: false },
      OnCallPageChannel.Call,
    ],
    [
      "SMS on OneUptime Cloud with no balance",
      { isBillingEnabled: true, balanceInUSDCents: 0 },
      OnCallPageChannel.SMS,
    ],
    [
      "WhatsApp on OneUptime Cloud with no balance",
      { isBillingEnabled: true, balanceInUSDCents: 0 },
      OnCallPageChannel.WhatsApp,
    ],
    [
      "SMS switched off in the project",
      { isSmsOn: false },
      OnCallPageChannel.SMS,
    ],
  ])(
    "a first notification by %s fails: they are still emailed as an owner",
    (
      _name: string,
      channelOverrides: Partial<WhoIsToldChannels>,
      channel: OnCallPageChannel,
    ) => {
      expect(
        told({
          policies: [
            primary({ people: [pagedAtOnce({ channelsAtOnce: [channel] })] }),
          ],
          channels: channels(channelOverrides),
        }).pagedOwners,
      ).toBeUndefined();
    },
  );

  test("SMS and calls the project's own Twilio sends go out, and so do paid ones with balance or auto-recharge", () => {
    const cases: Array<[Partial<WhoIsToldChannels>, OnCallPageChannel]> = [
      [
        { serverCanSendSms: false, hasOwnTwilioForSms: true },
        OnCallPageChannel.SMS,
      ],
      [
        { serverCanCall: false, hasOwnTwilioForCalls: true },
        OnCallPageChannel.Call,
      ],
      [
        { isBillingEnabled: true, balanceInUSDCents: 500 },
        OnCallPageChannel.SMS,
      ],
      [
        {
          isBillingEnabled: true,
          balanceInUSDCents: 0,
          isAutoRechargeOn: true,
        },
        OnCallPageChannel.Call,
      ],
      [
        { isBillingEnabled: true, balanceInUSDCents: 0 },
        OnCallPageChannel.Push,
      ],
    ];

    for (const [overrides, channel] of cases) {
      expect(canWhoIsToldChannelSendNow(channel, channels(overrides))).toBe(
        true,
      );
    }
  });

  test("one first notification that goes out is enough", () => {
    expect(
      told({
        policies: [
          primary({
            people: [
              pagedAtOnce({
                channelsAtOnce: [OnCallPageChannel.SMS, OnCallPageChannel.Push],
              }),
            ],
          }),
        ],
        channels: channels({ serverCanSendSms: false }),
      }).pagedOwners,
    ).toEqual([{ userId: ANA, name: "Ana Lopez" }]);
  });

  test("an older server's owners, with no recipients, are told as they were", () => {
    const owners: WhoIsToldEvent["owners"] = {
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ana Lopez"],
      teamNames: [],
    };

    expect(
      getWhoIsToldOwnersAsTold({
        owners: owners,
        policies: [primary()],
        channels: channels(),
      }),
    ).toEqual(owners);
  });

  test("whether a policy's first level pages a person at once", () => {
    expect(
      isWhoIsToldPersonPagedAtOnce({
        policy: { isHidden: false, pagesAtOnce: true },
        person: { isReachable: true, channelsAtOnce: [OnCallPageChannel.Push] },
        channels: channels(),
      }),
    ).toBe(true);
    expect(
      isWhoIsToldPersonPagedAtOnce({
        policy: { isHidden: true, pagesAtOnce: true },
        person: { isReachable: true, channelsAtOnce: [OnCallPageChannel.Push] },
        channels: channels(),
      }),
    ).toBe(false);
  });

  test("as the answer is handed to a reader: worked out from the policies they may read", () => {
    const result: WhoIsToldResult = resultWith([
      criteria({
        events: [event({ owners: ownersOf({}), policies: [primary()] })],
      }),
    ]);

    const asReadable: WhoIsToldResult = redactWhoIsTold({
      result: result,
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });
    const asHidden: WhoIsToldResult = redactWhoIsTold({
      result: result,
      readablePolicyIds: new Set<string>(),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });

    expect(asReadable.criteria[0]!.events[0]!.owners).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ben Ito"],
      teamNames: [],
      pagedOwners: [{ userId: ANA, name: "Ana Lopez" }],
    });
    expect(asHidden.criteria[0]!.events[0]!.owners).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ana Lopez", "Ben Ito"],
      teamNames: [],
    });
    // A hidden policy says nothing of whether it pages at once either.
    expect(
      asHidden.criteria[0]!.events[0]!.policies[0]!.pagesAtOnce,
    ).toBeUndefined();
    // And nobody's recipients leave the server.
    expect(JSON.stringify(asReadable)).not.toContain("recipients");
    expect(JSON.stringify(asHidden)).not.toContain("recipients");
  });
});

/*
 * THE INCIDENT AN ALERT BECOMES (#7216), A PRIVATE RECORD A READER MAY NOT
 * SEE (#7213), AND THE NAMES THE CHAIN GAINED (#7212, #7214, #7572).
 */
describe("an alert an alert incident rule declares an incident from", () => {
  const DECLARING_RULE_ID: string = "6810bbbb-0000-4000-8000-000000000009";

  function alertThatDeclares(
    incident: WhoIsToldEvent,
    alertOverrides: Partial<WhoIsToldEvent> = {},
  ): WhoIsToldEvent {
    return event({
      kind: OnCallTestPageRecordKind.Alert,
      rules: [],
      policies: [],
      declares: {
        rule: { id: DECLARING_RULE_ID, name: "Database alerts" },
        waitInMinutes: 30,
        incident: incident,
      },
      ...alertOverrides,
    });
  }

  test("an alert that pages nobody is no break when the incident it becomes pages somebody", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [criteria({ events: [alertThatDeclares(event())] })],
      alertRules: false,
    });

    expect(breaks).toEqual([]);
  });

  test("not even only incidents having rules, the break of the set-up that means alerts to become incidents", () => {
    expect(
      breaksOf({
        criteria: [criteria({ events: [alertThatDeclares(event())] })],
        incidentRules: true,
        alertRules: false,
      }),
    ).toEqual([]);
  });

  test("when the incident pages nobody either, the alert's break stays, said once", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [alertThatDeclares(event({ rules: [], policies: [] }))],
        }),
      ],
      incidentRules: true,
      alertRules: false,
    });

    expect(kindsOf(breaks)).toEqual([
      WhoIsToldBreakKind.OnlyIncidentsHaveRules,
    ]);
  });

  test("the incident's own policies and people are breaks of the chain", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            alertThatDeclares(
              event({
                policies: [policy({ levelCount: 0, people: [] })],
              }),
            ),
          ],
        }),
      ],
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
  });

  test("an alert that pages somebody itself keeps its people's breaks too", () => {
    const breaks: Array<WhoIsToldBreak> = breaksOf({
      criteria: [
        criteria({
          events: [
            alertThatDeclares(event({ rules: [], policies: [] }), {
              policies: [
                policy({
                  people: [
                    person({
                      isReachable: false,
                      channels: [],
                      problem: WhoIsToldPersonProblem.OptedOut,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(kindsOf(breaks)).toEqual([WhoIsToldBreakKind.PersonUnreachable]);
  });
});

describe("a private record a reader may not see (#7213)", () => {
  const secret: WhoIsToldEvent = event({
    isPrivate: true,
    title: "Payroll export failed",
    privacyRules: [{ id: RULE_ID, name: "Payroll is private" }],
    policies: [policy({ levelCount: 0, people: [] })],
    rules: [],
    ownerIds: { userIds: [ANA], teamIds: [] },
  });

  function resultOf(events: Array<WhoIsToldEvent>): WhoIsToldResult {
    const criteriaList: Array<WhoIsToldCriteria> = [
      criteria({ events: events }),
    ];

    return {
      ...resultWith(criteriaList),
      facts: {
        projectHasIncidentOnCallRules: true,
        projectHasAlertOnCallRules: true,
        projectHasOnCallPolicies: true,
      },
    };
  }

  function redactFor(
    result: WhoIsToldResult,
    canRead: boolean,
  ): WhoIsToldResult {
    return redactWhoIsTold({
      result: result,
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
      readablePrivacyRuleIds: new Set<string>([RULE_ID]),
      canReadPrivateEvent: (): boolean => {
        return canRead;
      },
    });
  }

  test("is told it opens, private, its severity and the rule that made it so, and nothing of whom it tells", () => {
    const redacted: WhoIsToldResult = redactFor(resultOf([secret]), false);

    expect(redacted.criteria[0]!.events[0]).toEqual({
      kind: OnCallTestPageRecordKind.Incident,
      title: "",
      severityName: "Critical",
      owners: {
        source: WhoIsToldOwnersSource.Named,
        userNames: [],
        teamNames: [],
      },
      ownerRules: [],
      rules: [],
      policies: [],
      statusPages: [],
      isPrivate: true,
      privacyRules: [{ id: RULE_ID, name: "Payroll is private" }],
      isHidden: true,
    });
    // Its policy has no levels: not the reader's to know.
    expect(redacted.breaks).toEqual([]);
    expect(JSON.stringify(redacted)).not.toContain("Payroll export failed");
    expect(JSON.stringify(redacted)).not.toContain("Primary");
  });

  test("a reader who may read it is told it whole, its break included", () => {
    const redacted: WhoIsToldResult = redactFor(resultOf([secret]), true);

    expect(redacted.criteria[0]!.events[0]!.isHidden).toBeUndefined();
    expect(redacted.criteria[0]!.events[0]!.title).toBe(
      "Payroll export failed",
    );
    expect(kindsOf(redacted.breaks)).toEqual([
      WhoIsToldBreakKind.PolicyHasNoLevels,
    ]);
  });

  test("nobody reads a private record without being said to: no canReadPrivateEvent, no reader", () => {
    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: resultOf([secret]),
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
    });

    expect(redacted.criteria[0]!.events[0]!.isHidden).toBe(true);
    // And a privacy rule they were not said to read has no name.
    expect(redacted.criteria[0]!.events[0]!.privacyRules).toEqual([
      { id: RULE_ID, name: "" },
    ]);
  });

  test("a public record beside it keeps its own breaks, and nothing of its owners' ids leaves", () => {
    const open: WhoIsToldEvent = event({
      rules: [],
      policies: [],
      ownerIds: { userIds: [BEN], teamIds: [] },
    });
    const redacted: WhoIsToldResult = redactFor(
      resultOf([secret, open]),
      false,
    );

    expect(kindsOf(redacted.breaks)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
    expect(JSON.stringify(redacted)).not.toContain("ownerIds");
    expect(JSON.stringify(redacted)).not.toContain("facts");
  });

  test("a hidden private alert hides the incident it would become too", () => {
    const alert: WhoIsToldEvent = event({
      kind: OnCallTestPageRecordKind.Alert,
      isPrivate: true,
      declares: {
        rule: { id: RULE_ID, name: "Every alert" },
        waitInMinutes: 0,
        incident: event({ isPrivate: true, title: "Payroll incident" }),
      },
    });

    const redacted: WhoIsToldResult = redactFor(resultOf([alert]), false);

    expect(redacted.criteria[0]!.events[0]!.declares).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain("Payroll incident");
  });

  test("a visible alert's private incident is hidden on its own", () => {
    const alert: WhoIsToldEvent = event({
      kind: OnCallTestPageRecordKind.Alert,
      declares: {
        rule: { id: RULE_ID, name: "Every alert" },
        waitInMinutes: 0,
        incident: event({ isPrivate: true, title: "Payroll incident" }),
      },
    });

    const redacted: WhoIsToldResult = redactWhoIsTold({
      result: resultOf([alert]),
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(),
      readableStatusPageIds: new Set<string>(),
      readableAlertIncidentRuleIds: new Set<string>([RULE_ID]),
      canReadPrivateEvent: (item: WhoIsToldEvent): boolean => {
        return item.kind === OnCallTestPageRecordKind.Alert;
      },
    });

    const declares: WhoIsToldEvent["declares"] =
      redacted.criteria[0]!.events[0]!.declares;

    expect(declares?.rule).toEqual({ id: RULE_ID, name: "Every alert" });
    expect(declares?.incident.isHidden).toBe(true);
    expect(declares?.incident.title).toBe("");
  });

  test("redacting leaves the resolver's answer as it was", () => {
    const result: WhoIsToldResult = resultOf([secret]);
    const before: string = JSON.stringify(result);

    redactFor(result, false);

    expect(JSON.stringify(result)).toBe(before);
  });
});

describe("the names the chain gained, as one caller may see them", () => {
  const GROUP_ID: string = "6810eeee-0000-4000-8000-000000000001";
  const LABEL_RULE_ID: string = "6810bbbb-0000-4000-8000-000000000005";

  const named: WhoIsToldEvent = event({
    statusPages: [
      {
        id: STATUS_PAGE_ID,
        name: "Payments status",
        groups: [{ id: GROUP_ID, name: "Checkout" }],
      },
    ],
    labelRules: [{ id: LABEL_RULE_ID, name: "Checkout labels" }],
    owners: {
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ben Ito"],
      teamNames: [],
      notReached: [
        {
          kind: WhoIsToldOwnerKind.User,
          id: ANA,
          name: "",
          problem: WhoIsToldOwnerProblem.NotInProject,
          addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
          rule: { id: OWNER_RULE_ID, name: "Checkout owners" },
        },
      ],
    },
  });

  function redacted(readable: {
    groups?: Array<string>;
    labelRules?: Array<string>;
    ownerRules?: Array<string>;
  }): WhoIsToldEvent {
    return redactWhoIsTold({
      result: resultWith([criteria({ events: [named] })]),
      readablePolicyIds: new Set<string>([POLICY_ID]),
      readableRuleIds: new Set<string>([RULE_ID]),
      readableOwnerRuleIds: new Set<string>(readable.ownerRules || []),
      readableStatusPageIds: new Set<string>([STATUS_PAGE_ID]),
      readableMonitorGroupIds: new Set<string>(readable.groups || []),
      readableLabelRuleIds: new Set<string>(readable.labelRules || []),
    }).criteria[0]!.events[0]!;
  }

  test("read whole by a reader who may read them", () => {
    const shown: WhoIsToldEvent = redacted({
      groups: [GROUP_ID],
      labelRules: [LABEL_RULE_ID],
      ownerRules: [OWNER_RULE_ID],
    });

    expect(shown.statusPages[0]!.groups).toEqual([
      { id: GROUP_ID, name: "Checkout" },
    ]);
    expect(shown.labelRules).toEqual([
      { id: LABEL_RULE_ID, name: "Checkout labels" },
    ]);
    expect(shown.owners.notReached?.[0]?.rule).toEqual({
      id: OWNER_RULE_ID,
      name: "Checkout owners",
    });
  });

  test("a group, a label rule or an owner rule they may not read keeps its place without its name", () => {
    const shown: WhoIsToldEvent = redacted({});

    expect(shown.statusPages[0]!.groups).toEqual([{ id: GROUP_ID, name: "" }]);
    expect(shown.labelRules).toEqual([{ id: LABEL_RULE_ID, name: "" }]);
    expect(shown.owners.notReached?.[0]?.rule).toEqual({
      id: OWNER_RULE_ID,
      name: "",
    });
    expect(JSON.stringify(shown)).not.toContain("Checkout labels");
    expect(JSON.stringify(shown)).not.toContain("Checkout owners");
    expect(JSON.stringify(shown)).not.toContain('"name":"Checkout"');
    // The owner they are told of was never named: a person not in the project.
    expect(shown.owners.notReached?.[0]?.name).toBe("");
  });
});
