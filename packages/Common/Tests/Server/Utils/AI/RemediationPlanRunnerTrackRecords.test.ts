import RemediationPlanRunner from "../../../../Server/Utils/AI/Remediation/RemediationPlanRunner";
import RemediationTrackRecordReader, {
  RUNBOOK_TRACK_RECORD_PLANNER_NOTE,
} from "../../../../Server/Utils/AI/Remediation/RemediationTrackRecordReader";
import RemediationChatMessage from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ConfidenceSignal } from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import { ObservabilityAssistantResult } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import RunbookService from "../../../../Server/Services/RunbookService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import AutoRemediationAction from "../../../../Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
  parseRemediationTrackRecord,
} from "../../../../Types/AutoRemediation/RemediationTrackRecord";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - a runbook OneUptime AI proposes carries how it went
 * the last times it ran as a fix, as a change of a plan carries its own
 * (RemediationPlanRunner, #5519's follow-up):
 *
 *  - the planner is told each candidate's record, and how to weigh it,
 *    read once for every candidate - never the round's own suggestion or
 *    signal - and nothing more for a runbook that never ran;
 *  - the runbook it proposes keeps its record on the suggestion
 *    (runbookTrackRecord, as the AI card reads it) and in its Slack and
 *    Microsoft Teams message, and so does one it was to start right away
 *    but proposes instead;
 *  - a runbook with no record proposes as it always did.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-2222222222b1",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-8888888888b2");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-7777777777b3",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-1111111111b4");
const RUNBOOK_A: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-3333333333b5",
);
const RUNBOOK_B: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-4444444444b6",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-ccccccccccb7",
);
const EARLIER_INCIDENT: string = "dddddddd-dddd-4ddd-8ddd-ddddddddddb8";

const RECORD: RemediationTrackRecord = {
  workedCount: 3,
  didNotWorkCount: 0,
  runs: [
    {
      subjectKind: "incident",
      subjectId: EARLIER_INCIDENT,
      subjectNumber: "INC-41",
      ranAt: "2026-10-28T10:00:00.000Z",
      outcome: RemediationTrackRecordOutcome.Worked,
    },
  ],
};

function runbook(id: ObjectID, name: string): Runbook {
  return {
    id,
    _id: id.toString(),
    name,
    description: `${name} description`,
  } as unknown as Runbook;
}

interface Recorded {
  context: { value: string };
  transitions: Array<{
    fromStatus: AutoRemediationSuggestionStatus;
    set: Record<string, unknown>;
  }>;
  reads: jest.SpyInstance;
  proposals: jest.SpyInstance;
}

function mockRound(data: {
  executionMode?: AutoRemediationExecutionMode | undefined;
  records?: Map<string, RemediationTrackRecord> | undefined;
  startFails?: boolean | undefined;
}): Recorded {
  const recorded: Recorded = {
    context: { value: "" },
    transitions: [],
    reads: jest
      .spyOn(RemediationTrackRecordReader, "readRunbookTrackRecords")
      .mockResolvedValue(
        data.records ||
          new Map<string, RemediationTrackRecord>([
            [RUNBOOK_A.toString().toLowerCase(), RECORD],
          ]),
      ),
    proposals: jest
      .spyOn(RemediationChatMessage, "getProposalBlocks")
      .mockResolvedValue([]),
  };

  jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      projectId: PROJECT_ID,
      status: AutoRemediationSuggestionStatus.Planning,
      incidentId: INCIDENT_ID,
      autoRemediationRuleId: RULE_ID,
      ruleNameSnapshot: "Restart API pods",
      executionMode: data.executionMode || AutoRemediationExecutionMode.Suggest,
    } as unknown as AutoRemediationSuggestion);

  const rule: AutoRemediationRule = {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    isEnabled: true,
    executionMode: data.executionMode || AutoRemediationExecutionMode.Suggest,
    remediationAction: AutoRemediationAction.OneUptimeAI,
    runbooks: [{ id: RUNBOOK_A, _id: RUNBOOK_A.toString() }],
  } as unknown as AutoRemediationRule;
  jest.spyOn(AutoRemediationRuleService, "findOneById").mockResolvedValue(rule);
  jest
    .spyOn(RunbookService, "findBy")
    .mockResolvedValue([
      runbook(RUNBOOK_A, "Restart pods"),
      runbook(RUNBOOK_B, "Failover database"),
    ]);
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    title: "API error rate is high",
    incidentNumber: 42,
  } as unknown as Incident);
  jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunbookRuleEngineService, "startRunbookFor")
    .mockResolvedValue(
      (data.startFails ? null : { id: ObjectID.generate() }) as never,
    );
  jest
    .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
    .mockImplementation(async (transition: unknown): Promise<number> => {
      recorded.transitions.push(transition as Recorded["transitions"][number]);
      return 1;
    });
  jest
    .spyOn(AIInvestigationEngine, "executeRun")
    .mockImplementation(
      async (run: {
        aiRunId: ObjectID;
        projectId: ObjectID;
        attemptCount: number;
        request: InvestigationRequest;
      }): Promise<void> => {
        recorded.context.value = run.request.contextSummary || "";
        await run.request.postAnalysis({
          analysisMarkdown: `The pods crash-loop.\nSelectedRunbook: ${RUNBOOK_A.toString()}`,
          confidence: {
            confident: true,
            source: "classification",
          } as ConfidenceSignal,
          result: {} as ObservabilityAssistantResult,
        });
      },
    );

  return recorded;
}

async function runRound(): Promise<void> {
  await RemediationPlanRunner.executePlan({
    aiRunId: RUN_ID,
    projectId: PROJECT_ID,
    suggestionId: SUGGESTION_ID,
    attemptCount: 1,
  });
}

describe("a runbook OneUptime AI proposes, and how it went before", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("the planner is told each candidate's record and how to weigh it, read for every candidate but the round's own", async () => {
    const recorded: Recorded = mockRound({});

    await runRound();

    const planning: Record<string, unknown> = recorded.reads.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(planning["projectId"]).toBe(PROJECT_ID);
    expect(
      (planning["runbookIds"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([RUNBOOK_A.toString(), RUNBOOK_B.toString()]);
    expect(planning["excludeSuggestionId"]).toBe(SUGGESTION_ID);
    expect(planning["excludeSubject"]).toEqual({
      incidentId: INCIDENT_ID,
      alertId: undefined,
    });

    expect(recorded.context.value).toContain(RUNBOOK_TRACK_RECORD_PLANNER_NOTE);
    expect(recorded.context.value).toContain(
      `- id: ${RUNBOOK_A.toString()} — "Restart pods": Restart pods description (track record: Worked all 3 times it ran here before (INC-41).)`,
    );
    // A runbook that never ran says nothing more.
    expect(recorded.context.value.split("\n")).toContain(
      `- id: ${RUNBOOK_B.toString()} — "Failover database": Failover database description`,
    );
  });

  it("no candidate with a record: no note, the lines as they always were", async () => {
    const recorded: Recorded = mockRound({
      records: new Map<string, RemediationTrackRecord>(),
    });

    await runRound();

    expect(recorded.context.value).not.toContain("track record");
    expect(recorded.context.value).not.toContain(
      RUNBOOK_TRACK_RECORD_PLANNER_NOTE,
    );
  });

  it("the runbook it proposes keeps its record on the suggestion and in its chat message", async () => {
    const recorded: Recorded = mockRound({});

    await runRound();

    const proposed: Recorded["transitions"][number] | undefined =
      recorded.transitions.find(
        (transition: Recorded["transitions"][number]): boolean => {
          return (
            transition.set["status"] ===
            AutoRemediationSuggestionStatus.Suggested
          );
        },
      );

    expect(proposed?.set["runbookId"]).toBe(RUNBOOK_A.toString());
    expect(
      parseRemediationTrackRecord(proposed?.set["runbookTrackRecord"]),
    ).toEqual(RECORD);

    // The picked runbook's record is read again, for it alone.
    const picked: Record<string, unknown> = recorded.reads.mock
      .calls[1]![0] as Record<string, unknown>;
    expect(
      (picked["runbookIds"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([RUNBOOK_A.toString()]);

    expect(recorded.proposals).toHaveBeenCalledWith(
      expect.objectContaining({
        runbook: { id: RUNBOOK_A, name: "Restart pods" },
        runbookTrackRecord: RECORD,
      }),
    );
  });

  it("a runbook with no record proposes as it always did", async () => {
    const recorded: Recorded = mockRound({
      records: new Map<string, RemediationTrackRecord>(),
    });

    await runRound();

    const proposed: Recorded["transitions"][number] | undefined =
      recorded.transitions.find(
        (transition: Recorded["transitions"][number]): boolean => {
          return (
            transition.set["status"] ===
            AutoRemediationSuggestionStatus.Suggested
          );
        },
      );

    expect(proposed).toBeDefined();
    expect("runbookTrackRecord" in proposed!.set).toBe(false);
    expect(recorded.proposals).toHaveBeenCalledWith(
      expect.objectContaining({ runbookTrackRecord: undefined }),
    );
  });

  it("one it was to start right away, proposed instead, keeps its record too", async () => {
    const recorded: Recorded = mockRound({
      executionMode: AutoRemediationExecutionMode.FullAuto,
      startFails: true,
    });

    await runRound();

    const reverted: Recorded["transitions"][number] | undefined =
      recorded.transitions.find(
        (transition: Recorded["transitions"][number]): boolean => {
          return (
            transition.fromStatus ===
              AutoRemediationSuggestionStatus.AutoExecuted &&
            transition.set["status"] ===
              AutoRemediationSuggestionStatus.Suggested
          );
        },
      );

    expect(
      parseRemediationTrackRecord(reverted?.set["runbookTrackRecord"]),
    ).toEqual(RECORD);
    expect(recorded.proposals).toHaveBeenCalledWith(
      expect.objectContaining({ runbookTrackRecord: RECORD }),
    );
  });

  it("one started right away keeps nothing to approve, so no record is written", async () => {
    const recorded: Recorded = mockRound({
      executionMode: AutoRemediationExecutionMode.FullAuto,
    });

    await runRound();

    const started: Recorded["transitions"][number] | undefined =
      recorded.transitions.find(
        (transition: Recorded["transitions"][number]): boolean => {
          return (
            transition.set["status"] ===
            AutoRemediationSuggestionStatus.AutoExecuted
          );
        },
      );

    expect(started).toBeDefined();
    expect("runbookTrackRecord" in started!.set).toBe(false);
    expect(recorded.proposals).not.toHaveBeenCalled();
  });
});
