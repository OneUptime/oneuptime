import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldFix,
  WhoIsToldOwnersSource,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldServerChannel,
  getWhoIsToldBreaks,
  makeWhoIsToldBreak,
} from "../../../Types/Monitor/WhoIsTold";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  DOMAIN_VERIFICATION_GRACE_IN_MS,
  MONITOR_OFF_FOR_LONG_IN_DAYS,
  SETUP_HEALTH_CHECK_ORDER,
  SETUP_HEALTH_LEVEL_ORDER,
  SETUP_HEALTH_LEVELS_ON_HOME,
  SETUP_HEALTH_RESPONDER_REASON_ORDER,
  SETUP_HEALTH_WORDS,
  SetupHealthCheck,
  SetupHealthDismissal,
  SetupHealthEventKind,
  SetupHealthFacts,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthMonitorFact,
  SetupHealthMonitorReason,
  SetupHealthReadable,
  SetupHealthRecord,
  SetupHealthRecordKind,
  SetupHealthResponderReason,
  SetupHealthScheduleReason,
  applySetupHealthDismissals,
  compareSetupHealthFindings,
  findSetupHealthDismissal,
  formatEnglishTime,
  formatEnglishUsd,
  getChainFindings,
  getSetupHealthCounts,
  getSetupHealthDismissalId,
  getSetupHealthFindingKey,
  getSetupHealthFindings,
  getSetupHealthRecordIds,
  isSetupHealthFindingReadable,
  makeSetupHealthFinding,
  redactSetupHealthFindings,
  usesPaidMessages,
} from "../../../Types/SetupHealth/SetupHealth";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * SETUP HEALTH (#6812): every rule, with a project that breaks it and one
 * that does not; how the findings are merged, ordered, dismissed and
 * redacted; and the words each finding says.
 */

const PROJECT: string = "68120000-0000-4000-8000-000000000001";
const NOW: string = "2026-11-12T12:00:00.000Z";
const CHECKOUT: string = "68120000-0000-4000-8000-0000000000a1";
const BILLING: string = "68120000-0000-4000-8000-0000000000a2";
const PRIMARY: string = "68120000-0000-4000-8000-0000000000b1";
const SECONDARY: string = "68120000-0000-4000-8000-0000000000b2";
const ANA: string = "68120000-0000-4000-8000-0000000000c1";
const BEN: string = "68120000-0000-4000-8000-0000000000c2";
const SCHEDULE: string = "68120000-0000-4000-8000-0000000000d1";
const STATUS_PAGE: string = "68120000-0000-4000-8000-0000000000e1";
const DOMAIN: string = "68120000-0000-4000-8000-0000000000e2";

function facts(overrides: Partial<SetupHealthFacts> = {}): SetupHealthFacts {
  return {
    projectId: PROJECT,
    now: NOW,
    chains: [],
    channels: null,
    policies: [],
    policyIdsRunByRules: [],
    responders: [],
    schedules: [],
    balance: null,
    serverCanSendEmail: null,
    monitors: [],
    statusPages: [],
    statusPageDomains: [],
    owners: null,
    workspaces: [],
    telemetry: null,
    ...overrides,
  };
}

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
    serverCanSendEmail: null,
    serverCanSendSms: null,
    serverCanCall: null,
    ...overrides,
  };
}

function brk(data: Omit<WhoIsToldBreak, "message" | "fix">): WhoIsToldBreak {
  return makeWhoIsToldBreak({ fix: WhoIsToldFix.MonitorCriteria, ...data });
}

function chain(data: {
  monitorId?: string;
  monitorName?: string;
  breaks?: Array<WhoIsToldBreak>;
  criteria?: Array<WhoIsToldCriteria>;
  channels?: WhoIsToldChannels;
}): WhoIsToldResult {
  return {
    monitorId: data.monitorId || CHECKOUT,
    monitorName: data.monitorName || "Checkout API",
    checkedAt: NOW,
    criteria: data.criteria || [],
    channels: data.channels || channels(),
    breaks: data.breaks || [],
  };
}

function criteriaPaging(data: {
  policyId: string;
  isNamedByCriteria?: boolean;
  personChannels?: Array<OnCallPageChannel>;
}): WhoIsToldCriteria {
  const policy: WhoIsToldPolicy = {
    id: data.policyId,
    name: "Primary",
    isHidden: false,
    isNamedByCriteria: Boolean(data.isNamedByCriteria),
    ruleIds: [],
    levelCount: 1,
    people: [
      {
        userId: ANA,
        name: "Ana Lopez",
        channels: data.personChannels || [OnCallPageChannel.Email],
        isFallback: false,
        isReachable: true,
      },
    ],
    notPaged: [],
  };

  return {
    id: "offline",
    name: "Offline",
    statusName: "Offline",
    events: [
      {
        kind: OnCallTestPageRecordKind.Incident,
        title: "Checkout API is offline",
        severityName: "Critical",
        owners: {
          source: WhoIsToldOwnersSource.ProjectOwners,
          userNames: [],
          teamNames: [],
        },
        ownerRules: [],
        rules: [],
        policies: [policy],
        statusPages: [],
      },
    ],
  };
}

function monitorFact(
  overrides: Partial<SetupHealthMonitorFact> = {},
): SetupHealthMonitorFact {
  return {
    id: CHECKOUT,
    name: "Checkout API",
    isCheckedByProbes: true,
    isTurnedOff: false,
    updatedAt: NOW,
    hasNoProbeOn: false,
    areAllProbesDisconnected: false,
    isTelemetryMonitor: false,
    ...overrides,
  };
}

function only(
  findings: Array<SetupHealthFinding>,
  check: SetupHealthCheck,
): Array<SetupHealthFinding> {
  return findings.filter((finding: SetupHealthFinding): boolean => {
    return finding.check === check;
  });
}

function daysAgo(days: number): string {
  return new Date(
    new Date(NOW).getTime() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

describe("the monitors' chains, as findings", () => {
  test("a monitor whose criteria do nothing tells nobody: worth fixing, on its Criteria page", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({
            breaks: [brk({ kind: WhoIsToldBreakKind.NothingHappens })],
          }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.MonitorTellsNobody,
      level: SetupHealthLevel.WorthFixing,
      record: {
        kind: SetupHealthRecordKind.Monitor,
        id: CHECKOUT,
        name: "Checkout API",
      },
      fix: SetupHealthFix.MonitorCriteria,
      fixRecordId: CHECKOUT,
    });
    expect(findings[0]!.sentence).toBe(
      "Checkout API tells nobody when it goes down: none of its criteria changes its status or opens an incident or an alert.",
    );
  });

  test("a monitor with no break has no finding", () => {
    expect(
      getSetupHealthFindings(facts({ chains: [chain({ breaks: [] })] })),
    ).toEqual([]);
  });

  test("a monitor whose incidents page nobody is worth fixing in a project with an on-call policy", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        policies: [{ id: PRIMARY, name: "Primary" }],
        policyIdsRunByRules: [PRIMARY],
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.NobodyPaged,
                recordKind: OnCallTestPageRecordKind.Incident,
              }),
            ],
          }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.MonitorPagesNobody,
      level: SetupHealthLevel.WorthFixing,
      subject: SetupHealthEventKind.Incident,
      fix: SetupHealthFix.IncidentOnCallRules,
      fixRecordId: "",
    });
    expect(findings[0]!.sentence).toBe(
      "Nobody is paged when Checkout API goes down: no on-call rule matches its incidents.",
    );
  });

  test("in a project with no on-call policy yet, a monitor that pages nobody is only a suggestion", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.NobodyPaged,
                recordKind: OnCallTestPageRecordKind.Incident,
              }),
            ],
          }),
        ],
      }),
    );

    expect(findings[0]!.level).toBe(SetupHealthLevel.Suggestion);
  });

  test("alerts that page nobody have their own words and the alert rules as the fix, beside the incidents'", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        policies: [{ id: PRIMARY, name: "Primary" }],
        policyIdsRunByRules: [PRIMARY],
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.NobodyPaged,
                recordKind: OnCallTestPageRecordKind.Incident,
              }),
              brk({
                kind: WhoIsToldBreakKind.NobodyPaged,
                recordKind: OnCallTestPageRecordKind.Alert,
              }),
            ],
          }),
        ],
      }),
    );

    expect(
      findings.map((finding: SetupHealthFinding): string => {
        return `${finding.subject}:${finding.fix}`;
      }),
    ).toEqual([
      `${SetupHealthEventKind.Alert}:${SetupHealthFix.AlertOnCallRules}`,
      `${SetupHealthEventKind.Incident}:${SetupHealthFix.IncidentOnCallRules}`,
    ]);
    expect(findings[0]!.sentence).toBe(
      "Nobody is paged when Checkout API goes down: no on-call rule matches its alerts.",
    );
  });

  test("a monitor that opens alerts while only incidents have on-call rules: pages will not arrive", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.OnlyIncidentsHaveRules,
                recordKind: OnCallTestPageRecordKind.Alert,
              }),
            ],
          }),
        ],
      }),
    );

    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.MonitorAlertsPageNobody,
      level: SetupHealthLevel.PagesWillNotArrive,
      fix: SetupHealthFix.AlertOnCallRules,
    });
    expect(findings[0]!.sentence).toBe(
      "Nobody is paged for the alerts of Checkout API: only incidents have on-call rules.",
    );
  });

  test("a policy with no escalation rules is the policy's finding, said once with every monitor that runs it", () => {
    const noLevels: WhoIsToldBreak = brk({
      kind: WhoIsToldBreakKind.PolicyHasNoLevels,
      policyId: PRIMARY,
      policyName: "Primary",
    });

    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        policies: [{ id: PRIMARY, name: "Primary" }],
        policyIdsRunByRules: [PRIMARY],
        chains: [
          chain({ breaks: [noLevels] }),
          chain({
            monitorId: BILLING,
            monitorName: "Billing API",
            breaks: [noLevels],
          }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.PolicyHasNoEscalationRules,
      level: SetupHealthLevel.PagesWillNotArrive,
      record: {
        kind: SetupHealthRecordKind.OnCallDutyPolicy,
        id: PRIMARY,
        name: "Primary",
      },
      fix: SetupHealthFix.OnCallPolicy,
      fixRecordId: PRIMARY,
    });
    expect(
      findings[0]!.related.map((record: { id: string }): string => {
        return record.id;
      }),
    ).toEqual([CHECKOUT, BILLING]);
    expect(findings[0]!.sentence).toBe(
      "On-call policy Primary has no escalation rules, so it pages nobody.",
    );
  });

  test("a policy that reaches nobody right now names the policy, by the project's name when the break has none", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        policies: [{ id: SECONDARY, name: "Secondary" }],
        policyIdsRunByRules: [SECONDARY],
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.PolicyReachesNobody,
                policyId: SECONDARY,
              }),
            ],
          }),
        ],
      }),
    );

    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.PolicyReachesNobody,
      record: { id: SECONDARY, name: "Secondary" },
    });
    expect(findings[0]!.sentence).toBe(
      "On-call policy Secondary reaches nobody right now: nobody is on call in its first escalation rule.",
    );
  });

  test("a policy break without a policy says nothing", () => {
    expect(
      getChainFindings(
        facts(),
        chain({
          breaks: [brk({ kind: WhoIsToldBreakKind.PolicyHasNoLevels })],
        }),
      ),
    ).toEqual([]);
  });

  test.each([
    [
      WhoIsToldPersonProblem.NoVerifiedMethod,
      SetupHealthResponderReason.NoVerifiedMethod,
      "Ana Lopez has no verified notification method, so pages don't reach them.",
    ],
    [
      WhoIsToldPersonProblem.NoRuleNoFallback,
      SetupHealthResponderReason.NoRuleNoFallback,
      "Ana Lopez has no on-call rule for some pages an on-call policy sends them, and this project doesn't fall back to verified methods.",
    ],
    [
      WhoIsToldPersonProblem.OptedOut,
      SetupHealthResponderReason.OptedOut,
      "Ana Lopez opted out of some pages an on-call policy sends them.",
    ],
  ])(
    "a person a policy can't page (%s) is the person's finding, on Readiness",
    (
      problem: WhoIsToldPersonProblem,
      reason: SetupHealthResponderReason,
      sentence: string,
    ) => {
      const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
        facts({
          policies: [{ id: PRIMARY, name: "Primary" }],
          policyIdsRunByRules: [PRIMARY],
          chains: [
            chain({
              breaks: [
                brk({
                  kind: WhoIsToldBreakKind.PersonUnreachable,
                  policyId: PRIMARY,
                  policyName: "Primary",
                  userId: ANA,
                  userName: "Ana Lopez",
                  problem: problem,
                }),
              ],
            }),
          ],
        }),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        check: SetupHealthCheck.ResponderCannotBePaged,
        level: SetupHealthLevel.PagesWillNotArrive,
        reason: reason,
        record: { kind: SetupHealthRecordKind.User, id: ANA },
        related: [
          {
            kind: SetupHealthRecordKind.OnCallDutyPolicy,
            id: PRIMARY,
            name: "Primary",
          },
        ],
        fix: SetupHealthFix.OnCallReadiness,
      });
      expect(findings[0]!.sentence).toBe(sentence);
    },
  );

  test("a person reached only by switched-off channels is the switch's finding, not theirs", () => {
    expect(
      getChainFindings(
        facts(),
        chain({
          breaks: [
            brk({
              kind: WhoIsToldBreakKind.PersonUnreachable,
              userId: ANA,
              problem: WhoIsToldPersonProblem.ChannelsOff,
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a channel switched off is the project's, by its name, once however many monitors use it", () => {
    const off: WhoIsToldBreak = brk({
      kind: WhoIsToldBreakKind.ChannelOff,
      channel: OnCallPageChannel.Call,
    });

    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({ breaks: [off] }),
          chain({ monitorId: BILLING, monitorName: "Billing", breaks: [off] }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.ChannelOff,
      level: SetupHealthLevel.PagesWillNotArrive,
      subject: OnCallPageChannel.Call,
      record: { kind: SetupHealthRecordKind.Project, id: PROJECT },
      fix: SetupHealthFix.ProjectNotificationSettings,
    });
    expect(findings[0]!.related).toHaveLength(2);
    expect(findings[0]!.sentence).toBe(
      "Phone call is off in this project, so pages that use it are not sent.",
    );
  });

  test("two channels off are two findings", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.ChannelOff,
                channel: OnCallPageChannel.SMS,
              }),
              brk({
                kind: WhoIsToldBreakKind.ChannelOff,
                channel: OnCallPageChannel.Call,
              }),
            ],
          }),
        ],
      }),
    );

    expect(only(findings, SetupHealthCheck.ChannelOff)).toHaveLength(2);
  });

  test("an empty balance on OneUptime Cloud is the project's, on Billing", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({ breaks: [brk({ kind: WhoIsToldBreakKind.NoBalance })] }),
        ],
      }),
    );

    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.NoBalance,
      level: SetupHealthLevel.PagesWillNotArrive,
      fix: SetupHealthFix.ProjectBilling,
    });
    expect(findings[0]!.sentence).toBe(
      "This project has no balance left for SMS and calls, so they are not sent.",
    );
  });

  test("a server that can't send SMS, which a page uses, is said for the server's admin", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.ServerCannotSend,
                channel: WhoIsToldServerChannel.SMS,
              }),
            ],
          }),
        ],
      }),
    );

    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.ServerCannotSend,
      subject: WhoIsToldServerChannel.SMS,
      fix: SetupHealthFix.ServerSettings,
    });
    expect(findings[0]!.sentence).toBe(
      "This server can't send SMS yet, so SMS pages are not sent.",
    );
  });

  test("every break the card can show becomes a finding of the list, so the two never disagree", () => {
    const kinds: Array<WhoIsToldBreakKind> = Object.values(WhoIsToldBreakKind);

    for (const kind of kinds) {
      const found: Array<SetupHealthFinding> = getChainFindings(
        facts(),
        chain({
          breaks: [
            brk({
              kind: kind,
              recordKind: OnCallTestPageRecordKind.Incident,
              policyId: PRIMARY,
              policyName: "Primary",
              userId: ANA,
              userName: "Ana Lopez",
              problem: WhoIsToldPersonProblem.NoVerifiedMethod,
              channel: OnCallPageChannel.SMS,
            }),
          ],
        }),
      );

      expect({ kind: kind, findings: found.length }).toEqual({
        kind: kind,
        findings: 1,
      });
    }
  });

  test("the breaks the resolver's own rules find for a chain are the ones the list says", () => {
    const criteria: Array<WhoIsToldCriteria> = [
      {
        id: "offline",
        name: "Offline",
        statusName: "Offline",
        events: [
          {
            kind: OnCallTestPageRecordKind.Alert,
            title: "Checkout API is slow",
            severityName: "Warning",
            owners: {
              source: WhoIsToldOwnersSource.ProjectOwners,
              userNames: [],
              teamNames: [],
            },
            ownerRules: [],
            rules: [],
            policies: [],
            statusPages: [],
          },
        ],
      },
    ];
    const breaks: Array<WhoIsToldBreak> = getWhoIsToldBreaks({
      criteria: criteria,
      channels: channels(),
      projectHasIncidentOnCallRules: true,
      projectHasAlertOnCallRules: false,
    });

    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({ chains: [chain({ criteria: criteria, breaks: breaks })] }),
    );

    expect(
      breaks.map((item: WhoIsToldBreak) => {
        return item.kind;
      }),
    ).toEqual([WhoIsToldBreakKind.OnlyIncidentsHaveRules]);
    expect(
      findings.map((item: SetupHealthFinding) => {
        return item.check;
      }),
    ).toEqual([SetupHealthCheck.MonitorAlertsPageNobody]);
  });
});

describe("responders, from Readiness", () => {
  test.each([
    [
      SetupHealthResponderReason.NotAMember,
      "Ben Ito is no longer a member of this project, but an on-call policy still pages them.",
    ],
    [
      SetupHealthResponderReason.InvitationNotAccepted,
      "Ben Ito hasn't accepted the invitation to this project, so pages don't reach them.",
    ],
    [
      SetupHealthResponderReason.NoVerifiedMethod,
      "Ben Ito has no verified notification method, so pages don't reach them.",
    ],
  ])(
    "somebody nothing reaches (%s), on any policy, can't be paged",
    (reason: SetupHealthResponderReason, sentence: string) => {
      const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
        facts({
          responders: [
            {
              userId: BEN,
              name: "Ben Ito",
              isNotReachable: true,
              reason: reason,
            },
          ],
        }),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        check: SetupHealthCheck.ResponderCannotBePaged,
        reason: reason,
        record: { kind: SetupHealthRecordKind.User, id: BEN },
      });
      expect(findings[0]!.sentence).toBe(sentence);
    },
  );

  test("somebody who can be reached is no finding", () => {
    expect(
      getSetupHealthFindings(
        facts({
          responders: [
            {
              userId: BEN,
              name: "Ben Ito",
              isNotReachable: false,
              reason: SetupHealthResponderReason.NoVerifiedMethod,
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("found by Readiness and by a chain, a person is one finding with the worst reason and every policy", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.PersonUnreachable,
                policyId: PRIMARY,
                policyName: "Primary",
                userId: BEN,
                userName: "Ben Ito",
                problem: WhoIsToldPersonProblem.NoRuleNoFallback,
              }),
            ],
          }),
        ],
        responders: [
          {
            userId: BEN,
            name: "Ben Ito",
            isNotReachable: true,
            reason: SetupHealthResponderReason.InvitationNotAccepted,
          },
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.reason).toBe(
      SetupHealthResponderReason.InvitationNotAccepted,
    );
    expect(findings[0]!.related).toEqual([
      {
        kind: SetupHealthRecordKind.OnCallDutyPolicy,
        id: PRIMARY,
        name: "Primary",
      },
    ]);
  });

  test("a person with no name is said as someone", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        responders: [
          {
            userId: BEN,
            name: "",
            isNotReachable: true,
            reason: SetupHealthResponderReason.NoVerifiedMethod,
          },
        ],
      }),
    );

    expect(findings[0]!.sentence).toBe(
      "Someone has no verified notification method, so pages don't reach them.",
    );
  });

  test("the reasons go worst first", () => {
    expect(SETUP_HEALTH_RESPONDER_REASON_ORDER[0]).toBe(
      SetupHealthResponderReason.NotAMember,
    );
    expect([...SETUP_HEALTH_RESPONDER_REASON_ORDER].sort()).toEqual(
      Object.values(SetupHealthResponderReason).sort(),
    );
  });
});

describe("the server", () => {
  test("a self-hosted server that can't send email: every project relies on it, monitors or not", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({ serverCanSendEmail: false }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.ServerCannotSend,
      subject: WhoIsToldServerChannel.Email,
      level: SetupHealthLevel.PagesWillNotArrive,
      fix: SetupHealthFix.ServerSettings,
    });
    expect(findings[0]!.sentence).toBe(
      "This server can't send email yet, so nobody is emailed.",
    );
  });

  test("a server that can send, or OneUptime Cloud, says nothing", () => {
    expect(getSetupHealthFindings(facts({ serverCanSendEmail: true }))).toEqual(
      [],
    );
    expect(getSetupHealthFindings(facts({ serverCanSendEmail: null }))).toEqual(
      [],
    );
  });

  test("the server's email found by a chain and by the server is one finding", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        serverCanSendEmail: false,
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.ServerCannotSend,
                channel: WhoIsToldServerChannel.Email,
              }),
            ],
          }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(
      findings[0]!.related.map((item: { id: string }) => {
        return item.id;
      }),
    ).toEqual([CHECKOUT]);
  });
});

describe("on-call policies nothing runs", () => {
  test("a policy no rule and no monitor runs pages nobody: worth fixing, fixed by an on-call rule", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({ policies: [{ id: PRIMARY, name: "Primary" }] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.PolicyNotRun,
      level: SetupHealthLevel.WorthFixing,
      record: { kind: SetupHealthRecordKind.OnCallDutyPolicy, id: PRIMARY },
      fix: SetupHealthFix.IncidentOnCallRules,
    });
    expect(findings[0]!.sentence).toBe(
      "On-call policy Primary pages nobody: no on-call rule and no monitor runs it.",
    );
  });

  test("a policy an enabled rule runs is run", () => {
    expect(
      getSetupHealthFindings(
        facts({
          policies: [{ id: PRIMARY, name: "Primary" }],
          policyIdsRunByRules: [PRIMARY],
        }),
      ),
    ).toEqual([]);
  });

  test("a policy a monitor's criteria names is run", () => {
    expect(
      only(
        getSetupHealthFindings(
          facts({
            policies: [{ id: PRIMARY, name: "Primary" }],
            chains: [
              chain({
                criteria: [
                  criteriaPaging({
                    policyId: PRIMARY,
                    isNamedByCriteria: true,
                  }),
                ],
              }),
            ],
          }),
        ),
        SetupHealthCheck.PolicyNotRun,
      ),
    ).toEqual([]);
  });

  test("a policy a monitor reaches only through a rule is not named by it", () => {
    expect(
      only(
        getSetupHealthFindings(
          facts({
            policies: [{ id: PRIMARY, name: "Primary" }],
            chains: [
              chain({
                criteria: [
                  criteriaPaging({
                    policyId: PRIMARY,
                    isNamedByCriteria: false,
                  }),
                ],
              }),
            ],
          }),
        ),
        SetupHealthCheck.PolicyNotRun,
      ),
    ).toHaveLength(1);
  });
});

describe("on-call schedules", () => {
  test.each([
    [
      SetupHealthScheduleReason.NoRotations,
      null,
      "On-call schedule Primary rota has no rotations, so nobody is ever on call in it.",
    ],
    [
      SetupHealthScheduleReason.NobodyInRotations,
      null,
      "Nobody is in the rotations of on-call schedule Primary rota, so nobody is ever on call in it.",
    ],
    [
      SetupHealthScheduleReason.NobodyNow,
      null,
      "Nobody is on call in on-call schedule Primary rota right now.",
    ],
    [
      SetupHealthScheduleReason.GapAhead,
      "2026-11-14T03:00:00.000Z",
      "Nobody will be on call in on-call schedule Primary rota from 2026-11-14 03:00 UTC.",
    ],
  ])(
    "a schedule a policy pages with %s is worth fixing, on the schedule",
    (
      reason: SetupHealthScheduleReason,
      gapStartsAt: string | null,
      sentence: string,
    ) => {
      const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
        facts({
          schedules: [
            {
              id: SCHEDULE,
              name: "Primary rota",
              reason: reason,
              gapStartsAt: gapStartsAt,
            },
          ],
        }),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        check: SetupHealthCheck.ScheduleHasNobodyOnCall,
        level: SetupHealthLevel.WorthFixing,
        reason: reason,
        fix: SetupHealthFix.OnCallSchedule,
        fixRecordId: SCHEDULE,
      });
      expect(findings[0]!.sentence).toBe(sentence);
      expect(findings[0]!.startsAt).toBe(gapStartsAt || undefined);
    },
  );

  test("a schedule with somebody always on call is no finding", () => {
    expect(
      getSetupHealthFindings(
        facts({
          schedules: [
            { id: SCHEDULE, name: "Primary", reason: null, gapStartsAt: null },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a gap ahead with no start is not said", () => {
    expect(
      getSetupHealthFindings(
        facts({
          schedules: [
            {
              id: SCHEDULE,
              name: "Primary",
              reason: SetupHealthScheduleReason.GapAhead,
              gapStartsAt: null,
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("the balance on OneUptime Cloud", () => {
  const paging: WhoIsToldResult = chain({
    criteria: [
      criteriaPaging({
        policyId: PRIMARY,
        personChannels: [OnCallPageChannel.SMS],
      }),
    ],
  });

  test("pages by SMS, a low balance and auto-recharge off: worth fixing, with the balance", () => {
    const findings: Array<SetupHealthFinding> = only(
      getSetupHealthFindings(
        facts({
          chains: [paging],
          channels: channels(),
          balance: {
            balanceInUSDCents: 420,
            isAutoRechargeOn: false,
            lowBalanceInUSDCents: 1000,
          },
        }),
      ),
      SetupHealthCheck.LowBalance,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      level: SetupHealthLevel.WorthFixing,
      fix: SetupHealthFix.ProjectBilling,
      balanceInUSDCents: 420,
    });
    expect(findings[0]!.sentence).toBe(
      "This project's balance for SMS and calls is low ($4.20) and auto-recharge is off, so they stop when it runs out.",
    );
  });

  test.each([
    ["auto-recharge on", 420, true],
    ["an empty balance, the chain's to say", 0, false],
    ["a balance at the threshold", 1000, false],
  ])(
    "%s is no low balance",
    (_label: string, cents: number, isAutoRechargeOn: boolean) => {
      expect(
        only(
          getSetupHealthFindings(
            facts({
              chains: [paging],
              channels: channels(),
              balance: {
                balanceInUSDCents: cents,
                isAutoRechargeOn: isAutoRechargeOn,
                lowBalanceInUSDCents: 1000,
              },
            }),
          ),
          SetupHealthCheck.LowBalance,
        ),
      ).toEqual([]);
    },
  );

  test("no balance read (self-hosted) is no finding", () => {
    expect(
      only(
        getSetupHealthFindings(facts({ chains: [paging], balance: null })),
        SetupHealthCheck.LowBalance,
      ),
    ).toEqual([]);
  });

  test("what is paid from the balance: SMS and calls not sent through the project's Twilio, WhatsApp, Telegram", () => {
    const pagingBy: (channel: OnCallPageChannel) => WhoIsToldResult = (
      channel: OnCallPageChannel,
    ): WhoIsToldResult => {
      return chain({
        criteria: [
          criteriaPaging({ policyId: PRIMARY, personChannels: [channel] }),
        ],
      });
    };

    expect(
      usesPaidMessages(
        facts({
          chains: [pagingBy(OnCallPageChannel.SMS)],
          channels: channels(),
        }),
      ),
    ).toBe(true);
    expect(
      usesPaidMessages(
        facts({
          chains: [pagingBy(OnCallPageChannel.SMS)],
          channels: channels({ hasOwnTwilioForSms: true }),
        }),
      ),
    ).toBe(false);
    expect(
      usesPaidMessages(
        facts({
          chains: [pagingBy(OnCallPageChannel.Call)],
          channels: channels({ hasOwnTwilioForCalls: true }),
        }),
      ),
    ).toBe(false);
    expect(
      usesPaidMessages(
        facts({
          chains: [pagingBy(OnCallPageChannel.WhatsApp)],
          channels: channels(),
        }),
      ),
    ).toBe(true);
    expect(
      usesPaidMessages(
        facts({
          chains: [pagingBy(OnCallPageChannel.Telegram)],
          channels: channels(),
        }),
      ),
    ).toBe(true);
    expect(
      usesPaidMessages(
        facts({
          chains: [pagingBy(OnCallPageChannel.Email)],
          channels: channels(),
        }),
      ),
    ).toBe(false);
  });

  test("a low balance nothing pays from is no finding", () => {
    expect(
      only(
        getSetupHealthFindings(
          facts({
            chains: [
              chain({
                criteria: [
                  criteriaPaging({
                    policyId: PRIMARY,
                    personChannels: [OnCallPageChannel.Email],
                  }),
                ],
              }),
            ],
            channels: channels(),
            balance: {
              balanceInUSDCents: 420,
              isAutoRechargeOn: false,
              lowBalanceInUSDCents: 1000,
            },
          }),
        ),
        SetupHealthCheck.LowBalance,
      ),
    ).toEqual([]);
  });
});

describe("monitors that are not checked, or off for long", () => {
  test("a monitor checked by probes with no probe on is never checked: worth fixing, on its Probes", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({ monitors: [monitorFact({ hasNoProbeOn: true })] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.MonitorNotChecked,
      level: SetupHealthLevel.WorthFixing,
      reason: SetupHealthMonitorReason.NoProbe,
      fix: SetupHealthFix.MonitorProbes,
      fixRecordId: CHECKOUT,
    });
    expect(findings[0]!.sentence).toBe(
      "Checkout API is never checked: no probe is turned on for it.",
    );
  });

  test("every probe disconnected: not checked right now", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({ monitors: [monitorFact({ areAllProbesDisconnected: true })] }),
    );

    expect(findings[0]!.reason).toBe(
      SetupHealthMonitorReason.ProbesDisconnected,
    );
    expect(findings[0]!.sentence).toBe(
      "Checkout API is not checked right now: every probe it uses is disconnected.",
    );
  });

  test("no probe on is said before disconnected ones", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        monitors: [
          monitorFact({ hasNoProbeOn: true, areAllProbesDisconnected: true }),
        ],
      }),
    );

    expect(findings[0]!.reason).toBe(SetupHealthMonitorReason.NoProbe);
  });

  test("a monitor turned off, or one no probe checks, is not said to be unchecked", () => {
    expect(
      only(
        getSetupHealthFindings(
          facts({
            monitors: [
              monitorFact({ hasNoProbeOn: true, isTurnedOff: true }),
              monitorFact({
                id: BILLING,
                hasNoProbeOn: true,
                isCheckedByProbes: false,
              }),
            ],
          }),
        ),
        SetupHealthCheck.MonitorNotChecked,
      ),
    ).toEqual([]);
  });

  test("a monitor off and unchanged for more than 30 days is a suggestion, on its overview", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        monitors: [
          monitorFact({
            isTurnedOff: true,
            updatedAt: daysAgo(MONITOR_OFF_FOR_LONG_IN_DAYS + 1),
          }),
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.MonitorOffForLong,
      level: SetupHealthLevel.Suggestion,
      fix: SetupHealthFix.MonitorOverview,
      fixRecordId: CHECKOUT,
    });
    expect(findings[0]!.sentence).toBe(
      "Checkout API has been turned off for more than 30 days.",
    );
  });

  test.each([
    ["off for 29 days", true, daysAgo(MONITOR_OFF_FOR_LONG_IN_DAYS - 1)],
    ["on, unchanged for a year", false, daysAgo(365)],
    ["off, with no date", true, null],
  ])(
    "a monitor %s is not off for long",
    (_label: string, isTurnedOff: boolean, updatedAt: string | null) => {
      expect(
        only(
          getSetupHealthFindings(
            facts({
              monitors: [
                monitorFact({ isTurnedOff: isTurnedOff, updatedAt: updatedAt }),
              ],
            }),
          ),
          SetupHealthCheck.MonitorOffForLong,
        ),
      ).toEqual([]);
    },
  );
});

describe("status pages", () => {
  test("a status page that shows nothing is worth fixing, where monitors are added", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        statusPages: [
          { id: STATUS_PAGE, name: "Acme Status", resourceCount: 0 },
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.StatusPageShowsNoMonitor,
      level: SetupHealthLevel.WorthFixing,
      record: { kind: SetupHealthRecordKind.StatusPage, id: STATUS_PAGE },
      fix: SetupHealthFix.StatusPageResources,
      fixRecordId: STATUS_PAGE,
    });
    expect(findings[0]!.sentence).toBe(
      "Status page Acme Status shows no monitors yet.",
    );
  });

  test("a status page that shows something is no finding, from one monitor or group up", () => {
    for (const resourceCount of [1, 2, 40]) {
      expect(
        getSetupHealthFindings(
          facts({
            statusPages: [
              {
                id: STATUS_PAGE,
                name: "Acme Status",
                resourceCount: resourceCount,
              },
            ],
          }),
        ),
      ).toEqual([]);
    }
  });

  const domain: (
    overrides: Partial<SetupHealthFacts["statusPageDomains"][number]>,
  ) => SetupHealthFacts["statusPageDomains"][number] = (
    overrides: Partial<SetupHealthFacts["statusPageDomains"][number]>,
  ): SetupHealthFacts["statusPageDomains"][number] => {
    return {
      id: DOMAIN,
      fullDomain: "status.acme.com",
      statusPageId: STATUS_PAGE,
      statusPageName: "Acme Status",
      isCnameVerified: false,
      createdAt: daysAgo(1),
      ...overrides,
    };
  };

  test("a custom domain whose CNAME isn't verified an hour on is worth fixing, on the status page's domains", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({ statusPageDomains: [domain({})] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.StatusPageDomainNotVerified,
      level: SetupHealthLevel.WorthFixing,
      record: {
        kind: SetupHealthRecordKind.StatusPageDomain,
        id: DOMAIN,
        name: "status.acme.com",
      },
      related: [
        {
          kind: SetupHealthRecordKind.StatusPage,
          id: STATUS_PAGE,
          name: "Acme Status",
        },
      ],
      fix: SetupHealthFix.StatusPageDomains,
      fixRecordId: STATUS_PAGE,
    });
    expect(findings[0]!.sentence).toBe(
      "status.acme.com doesn't open status page Acme Status yet: its CNAME record isn't verified.",
    );
  });

  test("a domain added within the hour, or verified, is no finding; one with no date is", () => {
    const tenMinutesAgo: string = new Date(
      new Date(NOW).getTime() - DOMAIN_VERIFICATION_GRACE_IN_MS / 6,
    ).toISOString();

    expect(
      getSetupHealthFindings(
        facts({ statusPageDomains: [domain({ createdAt: tenMinutesAgo })] }),
      ),
    ).toEqual([]);
    expect(
      getSetupHealthFindings(
        facts({ statusPageDomains: [domain({ isCnameVerified: true })] }),
      ),
    ).toEqual([]);
    expect(
      getSetupHealthFindings(
        facts({ statusPageDomains: [domain({ createdAt: null })] }),
      ),
    ).toHaveLength(1);
  });
});

describe("the project", () => {
  test("one owner of a project of several people is a suggestion", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({ owners: { ownerCount: 1, memberCount: 3 } }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.OneOwner,
      level: SetupHealthLevel.Suggestion,
      fix: SetupHealthFix.ProjectOwners,
    });
  });

  test.each([
    ["two owners", { ownerCount: 2, memberCount: 3 }],
    ["one person on their own", { ownerCount: 1, memberCount: 1 }],
  ])(
    "%s is no finding",
    (_label: string, owners: SetupHealthFacts["owners"]) => {
      expect(getSetupHealthFindings(facts({ owners: owners }))).toEqual([]);
    },
  );

  test("a chat workspace with no notification rule is a suggestion, by its name", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        workspaces: [
          {
            workspaceType: "Slack",
            workspaceName: "Slack",
            ruleCount: 0,
          },
          {
            workspaceType: "MicrosoftTeams",
            workspaceName: "Microsoft Teams",
            ruleCount: 2,
          },
        ],
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: SetupHealthCheck.WorkspaceNotUsed,
      level: SetupHealthLevel.Suggestion,
      subject: "Slack",
      fix: SetupHealthFix.WorkspaceNotificationRules,
    });
    expect(findings[0]!.sentence).toBe(
      "Slack is connected, but no notification rule posts to it.",
    );
  });

  test("telemetry no monitor watches is a suggestion; a telemetry monitor watches it", () => {
    expect(
      getSetupHealthFindings(
        facts({ telemetry: { receivesTelemetry: true } }),
      ).map((finding: SetupHealthFinding) => {
        return finding.check;
      }),
    ).toEqual([SetupHealthCheck.TelemetryNotWatched]);

    expect(
      getSetupHealthFindings(
        facts({
          telemetry: { receivesTelemetry: true },
          monitors: [
            monitorFact({ isTelemetryMonitor: true, isCheckedByProbes: false }),
          ],
        }),
      ),
    ).toEqual([]);

    expect(
      getSetupHealthFindings(
        facts({ telemetry: { receivesTelemetry: false } }),
      ),
    ).toEqual([]);
  });

  test("a new project with nothing in it has nothing to fix", () => {
    expect(getSetupHealthFindings(facts())).toEqual([]);
  });
});

describe("the list", () => {
  function busyProject(): SetupHealthFacts {
    return facts({
      policies: [
        { id: PRIMARY, name: "Primary" },
        { id: SECONDARY, name: "Secondary" },
      ],
      policyIdsRunByRules: [PRIMARY],
      chains: [
        chain({
          breaks: [
            brk({
              kind: WhoIsToldBreakKind.NobodyPaged,
              recordKind: OnCallTestPageRecordKind.Incident,
            }),
          ],
        }),
        chain({
          monitorId: BILLING,
          monitorName: "Billing API",
          breaks: [
            brk({
              kind: WhoIsToldBreakKind.ChannelOff,
              channel: OnCallPageChannel.SMS,
            }),
          ],
        }),
      ],
      owners: { ownerCount: 1, memberCount: 2 },
    });
  }

  test("worst first, then by check, then by name", () => {
    const findings: Array<SetupHealthFinding> =
      getSetupHealthFindings(busyProject());

    expect(
      findings.map((finding: SetupHealthFinding): string => {
        return `${finding.level}/${finding.check}`;
      }),
    ).toEqual([
      `${SetupHealthLevel.PagesWillNotArrive}/${SetupHealthCheck.ChannelOff}`,
      `${SetupHealthLevel.WorthFixing}/${SetupHealthCheck.MonitorPagesNobody}`,
      `${SetupHealthLevel.WorthFixing}/${SetupHealthCheck.PolicyNotRun}`,
      `${SetupHealthLevel.Suggestion}/${SetupHealthCheck.OneOwner}`,
    ]);
  });

  test("the level comes before the check: a monitor that pages nobody is a suggestion before any policy, after an unchecked monitor", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        chains: [
          chain({
            breaks: [
              brk({
                kind: WhoIsToldBreakKind.NobodyPaged,
                recordKind: OnCallTestPageRecordKind.Incident,
              }),
            ],
          }),
        ],
        monitors: [
          monitorFact({ id: BILLING, name: "Billing API", hasNoProbeOn: true }),
        ],
      }),
    );

    // By check alone, "pages nobody" would come first.
    expect(
      SETUP_HEALTH_CHECK_ORDER.indexOf(SetupHealthCheck.MonitorPagesNobody),
    ).toBeLessThan(
      SETUP_HEALTH_CHECK_ORDER.indexOf(SetupHealthCheck.MonitorNotChecked),
    );
    expect(
      findings.map((finding: SetupHealthFinding): string => {
        return `${finding.level}/${finding.check}`;
      }),
    ).toEqual([
      `${SetupHealthLevel.WorthFixing}/${SetupHealthCheck.MonitorNotChecked}`,
      `${SetupHealthLevel.Suggestion}/${SetupHealthCheck.MonitorPagesNobody}`,
    ]);
  });

  test("the same project gives the same findings, with the same keys, every time", () => {
    expect(getSetupHealthFindings(busyProject())).toEqual(
      getSetupHealthFindings(busyProject()),
    );
  });

  test("records of one check are in name order", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        statusPages: [
          { id: "b", name: "Zeta", resourceCount: 0 },
          { id: "a", name: "Alpha", resourceCount: 0 },
        ],
      }),
    );

    expect(
      findings.map((finding: SetupHealthFinding) => {
        return finding.record.name;
      }),
    ).toEqual(["Alpha", "Zeta"]);
    expect(compareSetupHealthFindings(findings[0]!, findings[1]!)).toBeLessThan(
      0,
    );
  });

  test("a key is the check, the subject and the record", () => {
    expect(
      getSetupHealthFindingKey({
        check: SetupHealthCheck.ChannelOff,
        subject: "SMS",
        record: { kind: SetupHealthRecordKind.Project, id: PROJECT },
      }),
    ).toBe(`channel_off|SMS|Project|${PROJECT}`);
  });

  test("every check has an order, and every level", () => {
    expect([...SETUP_HEALTH_CHECK_ORDER].sort()).toEqual(
      Object.values(SetupHealthCheck).sort(),
    );
    expect([...SETUP_HEALTH_LEVEL_ORDER].sort()).toEqual(
      Object.values(SetupHealthLevel).sort(),
    );
    expect(SETUP_HEALTH_LEVELS_ON_HOME).toEqual([
      SetupHealthLevel.PagesWillNotArrive,
      SetupHealthLevel.WorthFixing,
    ]);
  });

  test("the counts Home says are the first two levels", () => {
    expect(getSetupHealthCounts(getSetupHealthFindings(busyProject()))).toEqual(
      {
        pagesWillNotArrive: 1,
        worthFixing: 2,
        suggestion: 1,
        needsALook: 3,
      },
    );
    expect(getSetupHealthCounts([])).toEqual({
      pagesWillNotArrive: 0,
      worthFixing: 0,
      suggestion: 0,
      needsALook: 0,
    });
  });
});

describe("dismissing a finding", () => {
  function dismissal(
    overrides: Partial<SetupHealthDismissal>,
  ): SetupHealthDismissal {
    return {
      id: "68120000-0000-4000-8000-0000000000f1",
      recommendationId: SetupHealthCheck.MonitorPagesNobody + ":incident",
      resourceType: SetupHealthRecordKind.Monitor,
      resourceId: CHECKOUT,
      reason: "We don't page for staging.",
      dismissedByName: "Ana Lopez",
      dismissedAt: NOW,
      ...overrides,
    };
  }

  const pagesNobody: SetupHealthFinding = makeSetupHealthFinding({
    check: SetupHealthCheck.MonitorPagesNobody,
    level: SetupHealthLevel.WorthFixing,
    subject: SetupHealthEventKind.Incident,
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: CHECKOUT,
      name: "Checkout API",
    },
    fix: SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.monitorPagesNobody.incident,
    values: { monitor: "Checkout API" },
  });

  const otherMonitor: SetupHealthFinding = makeSetupHealthFinding({
    check: SetupHealthCheck.MonitorPagesNobody,
    level: SetupHealthLevel.WorthFixing,
    subject: SetupHealthEventKind.Incident,
    record: {
      kind: SetupHealthRecordKind.Monitor,
      id: BILLING,
      name: "Billing API",
    },
    fix: SetupHealthFix.IncidentOnCallRules,
    words: SETUP_HEALTH_WORDS.monitorPagesNobody.incident,
    values: { monitor: "Billing API" },
  });

  test("a dismissal names the check with its subject, and the record", () => {
    expect(getSetupHealthDismissalId(pagesNobody)).toBe(
      "monitor_pages_nobody:incident",
    );
    expect(
      getSetupHealthDismissalId({
        check: SetupHealthCheck.PolicyNotRun,
        subject: "",
      }),
    ).toBe("policy_not_run");
  });

  test("a dismissed finding is set apart with its dismissal, for one record only", () => {
    const split: ReturnType<typeof applySetupHealthDismissals> =
      applySetupHealthDismissals([pagesNobody, otherMonitor], [dismissal({})]);

    expect(split.findings).toEqual([otherMonitor]);
    expect(split.dismissed).toEqual([
      { finding: pagesNobody, dismissal: dismissal({}) },
    ]);
  });

  test("a dismissal of another check, subject or kind of record hides nothing", () => {
    for (const other of [
      dismissal({ recommendationId: "monitor_pages_nobody:alert" }),
      dismissal({ recommendationId: "monitor_tells_nobody" }),
      dismissal({ resourceType: SetupHealthRecordKind.StatusPage }),
      dismissal({ resourceId: BILLING + "0" }),
    ]) {
      expect(findSetupHealthDismissal(pagesNobody, [other])).toBeNull();
    }
  });

  test("a dismissal of a finding that is gone is not listed", () => {
    expect(
      applySetupHealthDismissals([otherMonitor], [dismissal({})]).dismissed,
    ).toEqual([]);
  });
});

describe("what one person may see", () => {
  function readable(
    overrides: Partial<SetupHealthReadable> = {},
  ): SetupHealthReadable {
    return {
      monitorIds: new Set<string>(),
      policyIds: new Set<string>(),
      scheduleIds: new Set<string>(),
      statusPageIds: new Set<string>(),
      canReadResponders: false,
      ...overrides,
    };
  }

  const all: Array<SetupHealthFinding> = getSetupHealthFindings(
    facts({
      policies: [{ id: PRIMARY, name: "Primary" }],
      chains: [
        chain({
          breaks: [
            brk({
              kind: WhoIsToldBreakKind.PolicyHasNoLevels,
              policyId: PRIMARY,
              policyName: "Primary",
            }),
            brk({
              kind: WhoIsToldBreakKind.NothingHappens,
            }),
            brk({
              kind: WhoIsToldBreakKind.ChannelOff,
              channel: OnCallPageChannel.SMS,
            }),
          ],
        }),
      ],
      responders: [
        {
          userId: BEN,
          name: "Ben Ito",
          isNotReachable: true,
          reason: SetupHealthResponderReason.NoVerifiedMethod,
        },
      ],
      schedules: [
        {
          id: SCHEDULE,
          name: "Primary rota",
          reason: SetupHealthScheduleReason.NobodyNow,
          gapStartsAt: null,
        },
      ],
      statusPages: [{ id: STATUS_PAGE, name: "Acme Status", resourceCount: 0 }],
      statusPageDomains: [
        {
          id: DOMAIN,
          fullDomain: "status.acme.com",
          statusPageId: STATUS_PAGE,
          statusPageName: "Acme Status",
          isCnameVerified: false,
          createdAt: null,
        },
      ],
    }),
  );

  function checksSeen(by: SetupHealthReadable): Array<SetupHealthCheck> {
    return redactSetupHealthFindings(all, by)
      .map((finding: SetupHealthFinding) => {
        return finding.check;
      })
      .sort();
  }

  test("somebody who may read nothing sees only the project's own findings", () => {
    expect(checksSeen(readable())).toEqual([SetupHealthCheck.ChannelOff]);
  });

  test("somebody who may read everything sees everything", () => {
    expect(
      checksSeen(
        readable({
          monitorIds: new Set<string>([CHECKOUT]),
          policyIds: new Set<string>([PRIMARY]),
          scheduleIds: new Set<string>([SCHEDULE]),
          statusPageIds: new Set<string>([STATUS_PAGE]),
          canReadResponders: true,
        }),
      ),
    ).toEqual(
      all
        .map((finding: SetupHealthFinding) => {
          return finding.check;
        })
        .sort(),
    );
  });

  test("a policy finding needs the policy; what it concerns is cut to what may be read", () => {
    const seen: Array<SetupHealthFinding> = redactSetupHealthFindings(
      all,
      readable({ policyIds: new Set<string>([PRIMARY]) }),
    );
    const policyFinding: SetupHealthFinding | undefined = seen.find(
      (finding: SetupHealthFinding): boolean => {
        return finding.check === SetupHealthCheck.PolicyHasNoEscalationRules;
      },
    );

    expect(policyFinding).toBeDefined();
    expect(policyFinding!.related).toEqual([]);

    const withMonitor: SetupHealthFinding | undefined =
      redactSetupHealthFindings(
        all,
        readable({
          policyIds: new Set<string>([PRIMARY]),
          monitorIds: new Set<string>([CHECKOUT]),
        }),
      ).find((finding: SetupHealthFinding): boolean => {
        return finding.check === SetupHealthCheck.PolicyHasNoEscalationRules;
      });

    expect(
      withMonitor!.related.map((record: SetupHealthRecord): string => {
        return record.id;
      }),
    ).toEqual([CHECKOUT]);
  });

  test("a domain is read through its status page, a person through the on-call policies", () => {
    const domainFinding: SetupHealthFinding = all.find(
      (finding: SetupHealthFinding): boolean => {
        return finding.check === SetupHealthCheck.StatusPageDomainNotVerified;
      },
    )!;
    const personFinding: SetupHealthFinding = all.find(
      (finding: SetupHealthFinding): boolean => {
        return finding.check === SetupHealthCheck.ResponderCannotBePaged;
      },
    )!;

    expect(isSetupHealthFindingReadable(domainFinding, readable())).toBe(false);
    expect(
      isSetupHealthFindingReadable(
        domainFinding,
        readable({ statusPageIds: new Set<string>([STATUS_PAGE]) }),
      ),
    ).toBe(true);
    expect(isSetupHealthFindingReadable(personFinding, readable())).toBe(false);
    expect(
      isSetupHealthFindingReadable(
        personFinding,
        readable({ canReadResponders: true }),
      ),
    ).toBe(true);
  });

  test("the ids of a kind the findings name, each once, records and related alike", () => {
    expect(
      getSetupHealthRecordIds(all, SetupHealthRecordKind.StatusPage).sort(),
    ).toEqual([STATUS_PAGE]);
    expect(getSetupHealthRecordIds(all, SetupHealthRecordKind.Monitor)).toEqual(
      [CHECKOUT],
    );
  });
});

describe("the words", () => {
  function everyTemplate(): Array<string> {
    const templates: Array<string> = [];

    const collect: (value: unknown) => void = (value: unknown): void => {
      if (typeof value === "string") {
        templates.push(value);
        return;
      }

      if (value && typeof value === "object") {
        for (const inner of Object.values(value as Record<string, unknown>)) {
          collect(inner);
        }
      }
    };

    collect(SETUP_HEALTH_WORDS);

    return templates;
  }

  test("every finding is a whole sentence that ends in a full stop", () => {
    for (const template of everyTemplate()) {
      expect(template).toMatch(/^[{A-Z].*\.$/);
    }
  });

  test("every placeholder a finding's words name, the finding fills", () => {
    const findings: Array<SetupHealthFinding> = getSetupHealthFindings(
      facts({
        policies: [{ id: PRIMARY, name: "Primary" }],
        chains: Object.values(WhoIsToldBreakKind).map(
          (kind: WhoIsToldBreakKind, index: number): WhoIsToldResult => {
            return chain({
              monitorId: `68120000-0000-4000-8000-00000000010${index}`,
              breaks: [
                brk({
                  kind: kind,
                  recordKind: OnCallTestPageRecordKind.Alert,
                  policyId: PRIMARY,
                  policyName: "Primary",
                  userId: ANA,
                  userName: "Ana Lopez",
                  problem: WhoIsToldPersonProblem.OptedOut,
                  channel:
                    kind === WhoIsToldBreakKind.ServerCannotSend
                      ? WhoIsToldServerChannel.Call
                      : OnCallPageChannel.WhatsApp,
                }),
              ],
            });
          },
        ),
        schedules: [
          {
            id: SCHEDULE,
            name: "Rota",
            reason: SetupHealthScheduleReason.GapAhead,
            gapStartsAt: NOW,
          },
        ],
        balance: {
          balanceInUSDCents: 1,
          isAutoRechargeOn: false,
          lowBalanceInUSDCents: 1000,
        },
        serverCanSendEmail: false,
        monitors: [
          monitorFact({ hasNoProbeOn: true }),
          monitorFact({
            id: BILLING,
            isTurnedOff: true,
            updatedAt: daysAgo(90),
          }),
        ],
        statusPages: [{ id: STATUS_PAGE, name: "Acme", resourceCount: 0 }],
        statusPageDomains: [
          {
            id: DOMAIN,
            fullDomain: "status.acme.com",
            statusPageId: STATUS_PAGE,
            statusPageName: "Acme",
            isCnameVerified: false,
            createdAt: null,
          },
        ],
        owners: { ownerCount: 1, memberCount: 2 },
        workspaces: [
          { workspaceType: "Slack", workspaceName: "Slack", ruleCount: 0 },
        ],
        telemetry: { receivesTelemetry: true },
      }),
    );

    expect(findings.length).toBeGreaterThan(12);

    for (const finding of findings) {
      for (const placeholder of getTemplatePlaceholders(finding.words)) {
        expect({
          check: finding.check,
          placeholder: placeholder,
          filled: Object.prototype.hasOwnProperty.call(
            finding.values,
            placeholder,
          ),
        }).toEqual({
          check: finding.check,
          placeholder: placeholder,
          filled: true,
        });
      }

      expect(finding.sentence).not.toContain("{{");
    }
  });

  test("a time and an amount are written for English readers", () => {
    expect(formatEnglishTime("2026-11-14T03:00:00.000Z")).toBe(
      "2026-11-14 03:00 UTC",
    );
    expect(formatEnglishTime("not a date")).toBe("not a date");
    expect(formatEnglishUsd(420)).toBe("$4.20");
    expect(formatEnglishUsd(-5)).toBe("$0.00");
  });
});
