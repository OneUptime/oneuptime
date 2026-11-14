import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldFix,
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
} from "../../../Types/Monitor/WhoIsTold";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
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
}): Array<WhoIsToldBreak> {
  return getWhoIsToldBreaks({
    criteria: data.criteria,
    channels: data.channels || channels(),
    projectHasIncidentOnCallRules: data.incidentRules ?? true,
    projectHasAlertOnCallRules: data.alertRules ?? true,
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

  test("with no rule for the severity, a page falls back to every verified method", () => {
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
