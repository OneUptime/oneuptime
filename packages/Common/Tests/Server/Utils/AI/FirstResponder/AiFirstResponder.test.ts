import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import User from "../../../../../Models/DatabaseModels/User";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import UserService from "../../../../../Server/Services/UserService";
import AiFirstResponder, {
  AI_HOLD_INVESTIGATION_START_GRACE_IN_MINUTES,
  AI_HOLD_REMEDIATION_GRACE_IN_MINUTES,
  AiHoldAction,
  AiHoldRecordState,
  AiHoldReview,
  AiHoldSuggestionState,
  classifyEndedAiHold,
  reviewAiHold,
} from "../../../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import AiFirstResponderEligibility from "../../../../../Server/Utils/AI/FirstResponder/AiFirstResponderEligibility";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AutoRemediationExecutionMode from "../../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHAT HAPPENS TO A PAGE ONEUPTIME AI HOLDS (AiFirstResponder).
 *
 * Reviewed every minute against what AI did: kept while it investigates or
 * its fix is checked, the record resolved once the fix is verified, and the
 * page handed to people - saying why - the moment AI cannot fix it. Handing
 * off starts each held run once, with the outcome kept on it.
 */

const NOW: Date = new Date("2026-10-20T02:05:00Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("6c000000-0000-4000-8000-000000000003");
const POLICY_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-0000000000a1",
);

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60000);
}

function state(overrides?: Partial<AiHoldRecordState>): AiHoldRecordState {
  return {
    recordKind: "incident",
    now: NOW,
    recordCreatedAt: minutesBefore(5),
    investigationStatus: AIRunStatus.Completed,
    investigationSettledAt: minutesBefore(1),
    isRemediationEvaluated: true,
    suggestions: [],
    ...(overrides || {}),
  };
}

const FIX_RUNNING: AiHoldSuggestionState = {
  status: AutoRemediationSuggestionStatus.Planning,
  executionMode: AutoRemediationExecutionMode.FullAuto,
};

const FIX_VERIFYING: AiHoldSuggestionState = {
  status: AutoRemediationSuggestionStatus.AutoExecuted,
  executionMode: AutoRemediationExecutionMode.FullAuto,
  verificationStatus: AutoRemediationVerificationStatus.Pending,
};

function heldRun(id: string): OnCallDutyPolicyExecutionLog {
  const run: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  run.id = new ObjectID(id);
  run.projectId = PROJECT_ID;
  run.status = OnCallDutyPolicyStatus.Waiting;
  run.aiHoldOutcome = OnCallPolicyAiHoldOutcome.Holding;
  run.onCallDutyPolicyId = POLICY_ID;
  run.triggeredByIncidentId = INCIDENT_ID;
  return run;
}

interface StartCall {
  run: OnCallDutyPolicyExecutionLog;
  startedEarlyReason?: string | undefined;
  aiHoldOutcome?: OnCallPolicyAiHoldOutcome | undefined;
}

interface World {
  findQueries: Array<Record<string, unknown>>;
  starts: Array<StartCall>;
}

function stubHeldRuns(data: {
  runs: Array<OnCallDutyPolicyExecutionLog>;
  claimWins?: boolean | undefined;
  holdCount?: number | undefined;
}): World {
  const world: World = { findQueries: [], starts: [] };

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<OnCallDutyPolicyExecutionLog>> => {
      world.findQueries.push(findBy.query);
      return data.runs;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "startWaitingRun")
    .mockImplementation((async (call: StartCall): Promise<boolean> => {
      world.starts.push(call);
      return data.claimWins !== false;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "countBy")
    .mockResolvedValue(
      new PositiveNumber(
        data.holdCount !== undefined ? data.holdCount : data.runs.length,
      ) as never,
    );

  return world;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the review of one held record", () => {
  test("an AI rule's wait before investigating hands the page off: people do not wait for it", () => {
    const review: AiHoldReview = reviewAiHold(
      state({
        investigationStatus: undefined,
        investigationWaitUntil: new Date(NOW.getTime() + 15 * 60000),
      }),
    );

    expect(review.action).toBe(AiHoldAction.HandOff);
    expect(review.reason).toBe(
      "An AI rule waits 15 minutes before OneUptime AI investigates.",
    );
  });

  test("a wait that is over no longer hands off", () => {
    expect(
      reviewAiHold(
        state({
          investigationWaitUntil: minutesBefore(1),
          suggestions: [FIX_RUNNING],
        }),
      ).action,
    ).toBe(AiHoldAction.Keep);
  });

  test("an investigation that did not start says why, as the record recorded it", () => {
    expect(
      reviewAiHold(
        state({
          investigationStatus: undefined,
          investigationNotStartedTitle: "AI credits ran out",
        }),
      ),
    ).toEqual({
      action: AiHoldAction.HandOff,
      reason:
        "OneUptime AI could not investigate this incident: AI credits ran out.",
    });
  });

  test("an investigation not yet queued is waited for, briefly", () => {
    expect(
      reviewAiHold(
        state({
          investigationStatus: undefined,
          recordCreatedAt: minutesBefore(
            AI_HOLD_INVESTIGATION_START_GRACE_IN_MINUTES - 1,
          ),
        }),
      ).action,
    ).toBe(AiHoldAction.Keep);

    expect(
      reviewAiHold(
        state({
          investigationStatus: undefined,
          recordCreatedAt: minutesBefore(
            AI_HOLD_INVESTIGATION_START_GRACE_IN_MINUTES,
          ),
        }),
      ),
    ).toEqual({
      action: AiHoldAction.HandOff,
      reason: "OneUptime AI could not investigate this incident.",
    });
  });

  test("an investigation that is queued or running keeps the hold", () => {
    for (const status of [AIRunStatus.Queued, AIRunStatus.Running]) {
      expect(reviewAiHold(state({ investigationStatus: status })).action).toBe(
        AiHoldAction.Keep,
      );
    }
  });

  test("an investigation waiting for a person's approval hands off", () => {
    expect(
      reviewAiHold(
        state({ investigationStatus: AIRunStatus.WaitingForApproval }),
      ),
    ).toEqual({
      action: AiHoldAction.HandOff,
      reason: "OneUptime AI's fix needs a person to approve it.",
    });
  });

  test("a verified fix resolves the record", () => {
    expect(
      reviewAiHold(
        state({
          suggestions: [
            {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              executionMode: AutoRemediationExecutionMode.FullAuto,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            },
          ],
        }),
      ).action,
    ).toBe(AiHoldAction.Resolve);
  });

  test("a fix running, or being checked, keeps the hold", () => {
    expect(reviewAiHold(state({ suggestions: [FIX_RUNNING] })).action).toBe(
      AiHoldAction.Keep,
    );
    expect(reviewAiHold(state({ suggestions: [FIX_VERIFYING] })).action).toBe(
      AiHoldAction.Keep,
    );
    expect(
      reviewAiHold(
        state({
          suggestions: [
            {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              executionMode: AutoRemediationExecutionMode.FullAuto,
            },
          ],
        }),
      ).action,
    ).toBe(AiHoldAction.Keep);
  });

  test("a second unattended round after a failed fix keeps the hold", () => {
    expect(
      reviewAiHold(
        state({
          suggestions: [
            FIX_RUNNING,
            {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              executionMode: AutoRemediationExecutionMode.FullAuto,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            },
          ],
        }),
      ).action,
    ).toBe(AiHoldAction.Keep);
  });

  test("a fix that did not bring the monitors back hands off", () => {
    expect(
      reviewAiHold(
        state({
          suggestions: [
            {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              executionMode: AutoRemediationExecutionMode.FullAuto,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            },
          ],
        }),
      ),
    ).toEqual({
      action: AiHoldAction.HandOff,
      reason: "OneUptime AI's fix did not bring the monitors back.",
    });
  });

  test("a fix with no monitor to check it against hands off", () => {
    expect(
      reviewAiHold(
        state({
          suggestions: [
            {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              executionMode: AutoRemediationExecutionMode.FullAuto,
              verificationStatus: AutoRemediationVerificationStatus.Skipped,
            },
          ],
        }),
      ).reason,
    ).toBe("OneUptime AI has no monitor to check its fix against.");
  });

  test("a proposal waiting for approval hands off, while it is written too", () => {
    for (const suggestion of [
      { status: AutoRemediationSuggestionStatus.Suggested },
      {
        status: AutoRemediationSuggestionStatus.Planning,
        executionMode: AutoRemediationExecutionMode.Suggest,
      },
    ]) {
      expect(reviewAiHold(state({ suggestions: [suggestion] }))).toEqual({
        action: AiHoldAction.HandOff,
        reason: "OneUptime AI's fix needs a person to approve it.",
      });
    }
  });

  test("the remediation engine is given a moment to say what it did", () => {
    expect(
      reviewAiHold(
        state({
          isRemediationEvaluated: false,
          investigationSettledAt: minutesBefore(
            AI_HOLD_REMEDIATION_GRACE_IN_MINUTES - 1,
          ),
        }),
      ).action,
    ).toBe(AiHoldAction.Keep);

    expect(
      reviewAiHold(
        state({
          isRemediationEvaluated: false,
          investigationSettledAt: minutesBefore(
            AI_HOLD_REMEDIATION_GRACE_IN_MINUTES,
          ),
        }),
      ).action,
    ).toBe(AiHoldAction.HandOff);
  });

  test("an investigation that did not finish hands off, saying so", () => {
    for (const status of [
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ]) {
      expect(reviewAiHold(state({ investigationStatus: status }))).toEqual({
        action: AiHoldAction.HandOff,
        reason:
          "OneUptime AI could not investigate this incident: its investigation did not finish.",
      });
    }
  });

  test("a failed investigation whose remediation still fixes keeps the hold", () => {
    expect(
      reviewAiHold(
        state({
          investigationStatus: AIRunStatus.Error,
          suggestions: [FIX_RUNNING],
        }),
      ).action,
    ).toBe(AiHoldAction.Keep);
  });

  test("an investigation that ended with no fix AI may run hands off", () => {
    for (const status of [AIRunStatus.Completed, AIRunStatus.NoFixFound]) {
      expect(
        reviewAiHold(
          state({
            investigationStatus: status,
            suggestions: [
              { status: AutoRemediationSuggestionStatus.NoneApplicable },
              { status: AutoRemediationSuggestionStatus.Dismissed },
            ],
          }),
        ),
      ).toEqual({
        action: AiHoldAction.HandOff,
        reason: "OneUptime AI found no fix it may run on its own.",
      });
    }
  });

  test("an alert's reasons name the alert", () => {
    expect(
      reviewAiHold(
        state({
          recordKind: "alert",
          investigationStatus: undefined,
          investigationNotStartedTitle: "Project AI was turned off",
        }),
      ).reason,
    ).toBe(
      "OneUptime AI could not investigate this alert: Project AI was turned off.",
    );
  });
});

describe("how a hold ended when its record was handled while it waited", () => {
  test("a person who acknowledged or resolved it handled it, whatever AI did", () => {
    expect(
      classifyEndedAiHold({
        isHandledByPerson: true,
        suggestions: [
          {
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          },
        ],
      }),
    ).toBe(OnCallPolicyAiHoldOutcome.HandledByPerson);
  });

  test("a verified fix, or one that ran on its own and is being checked, resolved it", () => {
    expect(
      classifyEndedAiHold({
        isHandledByPerson: false,
        suggestions: [
          {
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          },
        ],
      }),
    ).toBe(OnCallPolicyAiHoldOutcome.ResolvedByAI);

    expect(
      classifyEndedAiHold({
        isHandledByPerson: false,
        suggestions: [FIX_VERIFYING],
      }),
    ).toBe(OnCallPolicyAiHoldOutcome.ResolvedByAI);
  });

  test("with no AI fix, or one that failed, it recovered on its own: never credited to AI", () => {
    expect(
      classifyEndedAiHold({ isHandledByPerson: false, suggestions: [] }),
    ).toBe(OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn);

    expect(
      classifyEndedAiHold({
        isHandledByPerson: false,
        suggestions: [
          {
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            executionMode: AutoRemediationExecutionMode.FullAuto,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          },
          { status: AutoRemediationSuggestionStatus.Suggested },
          FIX_RUNNING,
        ],
      }),
    ).toBe(OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn);
  });
});

describe("handing held pages to people", () => {
  test("each held run of the record starts at once, saying why, as handed off", async () => {
    const world: World = stubHeldRuns({
      runs: [
        heldRun("6c000000-0000-4000-8000-0000000000b1"),
        heldRun("6c000000-0000-4000-8000-0000000000b2"),
      ],
    });

    const started: number = await AiFirstResponder.handOff({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      reason: "OneUptime AI found no fix it may run on its own.",
    });

    expect(started).toBe(2);
    expect(world.findQueries[0]).toMatchObject({
      projectId: PROJECT_ID,
      status: OnCallDutyPolicyStatus.Waiting,
      aiHoldOutcome: OnCallPolicyAiHoldOutcome.Holding,
      triggeredByIncidentId: INCIDENT_ID,
    });
    expect(
      world.starts.map((call: StartCall) => {
        return call.startedEarlyReason;
      }),
    ).toEqual([
      "OneUptime AI found no fix it may run on its own.",
      "OneUptime AI found no fix it may run on its own.",
    ]);
    expect(
      world.starts.every((call: StartCall) => {
        return call.aiHoldOutcome === OnCallPolicyAiHoldOutcome.HandedOff;
      }),
    ).toBe(true);
  });

  test("a run another hand-off started first is not counted: each run pages once", async () => {
    stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
      claimWins: false,
    });

    expect(
      await AiFirstResponder.handOff({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        reason: "x",
      }),
    ).toBe(0);
  });

  test("one run that fails to start does not stop the others", async () => {
    const world: World = stubHeldRuns({
      runs: [
        heldRun("6c000000-0000-4000-8000-0000000000b1"),
        heldRun("6c000000-0000-4000-8000-0000000000b2"),
      ],
    });

    let calls: number = 0;
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "startWaitingRun")
      .mockImplementation((async (call: StartCall): Promise<boolean> => {
        calls++;
        world.starts.push(call);

        if (calls === 1) {
          throw new Error("claim failed");
        }

        return true;
      }) as never);

    expect(
      await AiFirstResponder.handOff({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        reason: "x",
      }),
    ).toBe(1);
    expect(world.starts).toHaveLength(2);
  });

  test("a hand-off with no record starts nothing", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });

    expect(
      await AiFirstResponder.handOff({ projectId: PROJECT_ID, reason: "x" }),
    ).toBe(0);
    expect(world.starts).toHaveLength(0);
  });

  test("Page now names who pressed it, and says so on the run", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });

    const user: User = new User();
    user.name = new Name("Sam Doe");
    jest.spyOn(UserService, "findOneById").mockResolvedValue(user);

    expect(
      await AiFirstResponder.pageNow({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        userId: new ObjectID("6c000000-0000-4000-8000-0000000000c1"),
      }),
    ).toBe(1);
    expect(world.starts[0]!.startedEarlyReason).toBe(
      "Sam Doe pressed Page now.",
    );
    expect(world.starts[0]!.aiHoldOutcome).toBe(
      OnCallPolicyAiHoldOutcome.PageNowPressed,
    );
  });

  test("every hold of some policies goes when their rule stops holding", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });

    await AiFirstResponder.onRuleStoppedHolding({
      projectId: PROJECT_ID,
      policyIds: [POLICY_ID],
    });

    expect(world.findQueries[0]!["onCallDutyPolicyId"]).toBeDefined();
    expect(world.starts[0]!.startedEarlyReason).toBe(
      "The on-call rule no longer lets OneUptime AI respond first.",
    );
  });

  test("AI turned off hands off every hold in the project", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });

    await AiFirstResponder.onProjectAiSettingsChanged({
      projectId: PROJECT_ID,
      isAiTurnedOff: true,
      isIncidentFixingTurnedOff: false,
      isAlertFixingTurnedOff: false,
    });

    expect(world.findQueries[0]!["triggeredByIncidentId"]).toBeUndefined();
    expect(world.starts[0]!.startedEarlyReason).toBe(
      "OneUptime AI was turned off for this project.",
    );
  });

  test("fixing turned off for incidents hands off only incidents' holds", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });

    await AiFirstResponder.onProjectAiSettingsChanged({
      projectId: PROJECT_ID,
      isAiTurnedOff: false,
      isIncidentFixingTurnedOff: true,
      isAlertFixingTurnedOff: false,
    });

    expect(world.findQueries).toHaveLength(1);
    expect(world.findQueries[0]!["triggeredByIncidentId"]).toBeDefined();
    expect(world.findQueries[0]!["triggeredByAlertId"]).toBeUndefined();
    expect(world.starts[0]!.startedEarlyReason).toBe(
      "Fixing new incidents automatically was turned off.",
    );
  });
});

describe("what looks like an outage", () => {
  test("enough records at once hand off every hold in the project", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });
    jest
      .spyOn(AiFirstResponderEligibility, "countOtherRecordsOpenedRecently")
      .mockResolvedValue(4 as never);

    await AiFirstResponder.onRecordCreated({ projectId: PROJECT_ID });

    expect(world.starts).toHaveLength(1);
    expect(world.starts[0]!.startedEarlyReason).toBe(
      "4 alerts and incidents opened within 5 minutes, which looks like an outage.",
    );
  });

  test("a few records do not", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });
    jest
      .spyOn(AiFirstResponderEligibility, "countOtherRecordsOpenedRecently")
      .mockResolvedValue(3 as never);

    await AiFirstResponder.onRecordCreated({ projectId: PROJECT_ID });

    expect(world.starts).toHaveLength(0);
  });

  test("a project where AI holds nothing reads nothing more", async () => {
    stubHeldRuns({ runs: [], holdCount: 0 });
    const count: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AiFirstResponderEligibility,
      "countOtherRecordsOpenedRecently",
    );

    await AiFirstResponder.onRecordCreated({ projectId: PROJECT_ID });

    expect(count).not.toHaveBeenCalled();
  });
});

describe("reviewing a held record", () => {
  test("a record someone acknowledged or resolved is the worker's to end: nothing is paged", async () => {
    const world: World = stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")],
    });
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(true);
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AiFirstResponder,
      "readRecordState",
    );

    expect(
      (
        await AiFirstResponder.reviewRecord({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        })
      ).action,
    ).toBe(AiHoldAction.Keep);
    expect(read).not.toHaveBeenCalled();
    expect(world.starts).toHaveLength(0);
  });

  test("a verified fix resolves the incident as OneUptime AI", async () => {
    stubHeldRuns({ runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")] });
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(false);
    jest.spyOn(AiFirstResponder, "readRecordState").mockResolvedValue(
      state({
        suggestions: [
          { verificationStatus: AutoRemediationVerificationStatus.Verified },
        ],
      }) as never,
    );
    const resolvedStateId: ObjectID = new ObjectID(
      "6c000000-0000-4000-8000-0000000000d1",
    );
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(resolvedStateId);
    const created: Array<IncidentStateTimeline> = [];
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation((async (createBy: {
        data: IncidentStateTimeline;
      }): Promise<IncidentStateTimeline> => {
        created.push(createBy.data);
        return createBy.data;
      }) as never);

    expect(
      (
        await AiFirstResponder.reviewRecord({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        })
      ).action,
    ).toBe(AiHoldAction.Resolve);
    expect(created).toHaveLength(1);
    expect(created[0]!.incidentStateId).toBe(resolvedStateId);
    expect(created[0]!.createdByUserId).toBeUndefined();
    expect(created[0]!.rootCause).toContain("Resolved by OneUptime AI");
  });

  test("an incident resolved meanwhile, by the verifier or a person, is left as it is", async () => {
    stubHeldRuns({ runs: [heldRun("6c000000-0000-4000-8000-0000000000b1")] });
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(false);
    jest.spyOn(AiFirstResponder, "readRecordState").mockResolvedValue(
      state({
        suggestions: [
          { verificationStatus: AutoRemediationVerificationStatus.Verified },
        ],
      }) as never,
    );
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(new ObjectID("6c000000-0000-4000-8000-0000000000d1"));
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockRejectedValue(
        new BadDataException(
          "Incident state cannot be same as previous state.",
        ) as never,
      );

    await expect(
      AiFirstResponder.reviewRecord({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).resolves.toEqual({ action: AiHoldAction.Resolve });
  });

  test("no fix hands the alert's held runs to people", async () => {
    const run: OnCallDutyPolicyExecutionLog = heldRun(
      "6c000000-0000-4000-8000-0000000000b1",
    );
    run.triggeredByIncidentId = undefined;
    run.triggeredByAlertId = ALERT_ID;
    const world: World = stubHeldRuns({ runs: [run] });
    jest.spyOn(AlertService, "isAlertAcknowledged").mockResolvedValue(false);
    jest
      .spyOn(AiFirstResponder, "readRecordState")
      .mockResolvedValue(state({ recordKind: "alert" }) as never);

    expect(
      await AiFirstResponder.reviewRecord({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      }),
    ).toEqual({
      action: AiHoldAction.HandOff,
      reason: "OneUptime AI found no fix it may run on its own.",
    });
    expect(world.findQueries[0]!["triggeredByAlertId"]).toBe(ALERT_ID);
    expect(world.starts).toHaveLength(1);
  });

  test("the sweep reviews each held record once, however many runs it has", async () => {
    stubHeldRuns({
      runs: [
        heldRun("6c000000-0000-4000-8000-0000000000b1"),
        heldRun("6c000000-0000-4000-8000-0000000000b2"),
      ],
    });
    const review: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AiFirstResponder, "reviewRecord")
      .mockResolvedValue({ action: AiHoldAction.Keep } as never);

    await AiFirstResponder.reviewHolds();

    expect(review).toHaveBeenCalledTimes(1);
  });

  test("one record that cannot be reviewed does not stop the sweep", async () => {
    const other: OnCallDutyPolicyExecutionLog = heldRun(
      "6c000000-0000-4000-8000-0000000000b2",
    );
    other.triggeredByIncidentId = new ObjectID(
      "6c000000-0000-4000-8000-0000000000e1",
    );
    stubHeldRuns({
      runs: [heldRun("6c000000-0000-4000-8000-0000000000b1"), other],
    });
    const review: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AiFirstResponder, "reviewRecord")
      .mockRejectedValueOnce(new Error("read failed") as never)
      .mockResolvedValue({ action: AiHoldAction.Keep } as never);

    await expect(AiFirstResponder.reviewHolds()).resolves.toBeUndefined();
    expect(review).toHaveBeenCalledTimes(2);
  });
});
