import Queue from "../../../../Server/Infrastructure/Queue";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookActions, {
  PlaybookStepContext,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookEngine from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import SecurityCaseAiHold from "../../../../Server/Utils/SecurityCase/SecurityCaseAiHold";
import SecurityCaseStepChecks from "../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import ObjectID from "../../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { SecurityCaseAiHoldOutcome } from "../../../../Types/SecurityCase/SecurityCaseAiHold";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookStepResult,
  buildPendingStepResults,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A PLAYBOOK'S PAGE ON-CALL STEP WHILE ONEUPTIME AI RESPONDS FIRST (#10353):
 * a run that started on its own waits at the step, in Waiting for OneUptime
 * AI, while the case is held; once the hold ends it carries on from the
 * step - paging when people were alerted, skipping the page when the case
 * was resolved with nobody alerted or a person took it. A run a person
 * started, and a case never held, page as they always did.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const PERSON_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function step(action: SecurityPlaybookActionType): SecurityPlaybookStep {
  return {
    id: ObjectID.generate().toString(),
    action,
    config:
      action === SecurityPlaybookActionType.PageOnCall
        ? { onCallPolicyId: "77777777-7777-4777-8777-777777777777" }
        : action === SecurityPlaybookActionType.AddCaseNote
          ? { note: "n" }
          : {},
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  };
}

interface RunState {
  status: SecurityPlaybookRunStatus;
  steps: Array<SecurityPlaybookStep>;
  stepResults: Array<SecurityPlaybookStepResult>;
  currentStepIndex: number;
  trigger: SecurityPlaybookTrigger;
  triggeredByUserId?: ObjectID | undefined;
  createdAt: Date;
}

let run: RunState;
let hold: { outcome: SecurityCaseAiHoldOutcome | null; endedAt: Date | null };
let executed: Array<SecurityPlaybookActionType>;
let feed: Array<string>;
let carriedOn: number;

function useRun(
  overrides: Partial<RunState> = {},
  steps: Array<SecurityPlaybookStep> = [
    step(SecurityPlaybookActionType.AddCaseNote),
    step(SecurityPlaybookActionType.PageOnCall),
    step(SecurityPlaybookActionType.AddCaseNote),
  ],
): void {
  run = {
    status: SecurityPlaybookRunStatus.Queued,
    steps,
    stepResults: buildPendingStepResults(steps),
    currentStepIndex: 0,
    trigger: SecurityPlaybookTrigger.CaseOpened,
    createdAt: new Date("2026-11-23T03:00:05.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  executed = [];
  feed = [];
  carriedOn = 0;
  hold = { outcome: SecurityCaseAiHoldOutcome.Holding, endedAt: null };
  useRun();

  getJestSpyOn(Queue, "addJob").mockResolvedValue(undefined as never);

  getJestSpyOn(
    SecurityPlaybookRunService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockImplementation(async (input: unknown) => {
    const { data, expectedData } = input as {
      data: Partial<RunState>;
      expectedData: Partial<RunState>;
    };

    if (expectedData.status !== run.status) {
      return false as never;
    }

    Object.assign(run, data);
    return true as never;
  });

  getJestSpyOn(SecurityPlaybookRunService, "findOneById").mockImplementation(
    async () => {
      const model: SecurityPlaybookRun = new SecurityPlaybookRun();
      model._id = RUN_ID.toString();
      model.projectId = PROJECT_ID;
      model.securityCaseId = CASE_ID;
      model.playbookName = "Page the security on-call";
      model.status = run.status;
      model.steps = run.steps as unknown as JSONArray;
      model.stepResults = run.stepResults as unknown as JSONArray;
      model.currentStepIndex = run.currentStepIndex;
      model.trigger = run.trigger;
      model.createdAt = run.createdAt;

      if (run.triggeredByUserId) {
        model.triggeredByUserId = run.triggeredByUserId;
      }

      return model as never;
    },
  );

  getJestSpyOn(SecurityPlaybookRunService, "updateOneById").mockImplementation(
    async (input: unknown) => {
      const data: JSONObject = (input as { data: JSONObject }).data;

      if (data["stepResults"]) {
        run.stepResults = data[
          "stepResults"
        ] as unknown as Array<SecurityPlaybookStepResult>;
      }

      if (typeof data["currentStepIndex"] === "number") {
        run.currentStepIndex = data["currentStepIndex"] as number;
      }

      return 1 as never;
    },
  );

  getJestSpyOn(
    SecurityPlaybookRunService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(async () => {
    return undefined as never;
  });

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async () => {
      const securityCase: SecurityCase = new SecurityCase();
      securityCase._id = CASE_ID.toString();
      securityCase.projectId = PROJECT_ID;

      if (hold.outcome) {
        securityCase.aiHoldOutcome = hold.outcome;
      }

      if (hold.endedAt) {
        securityCase.aiHoldEndedAt = hold.endedAt;
      }

      return securityCase as never;
    },
  );

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockImplementation(async (input: unknown) => {
    feed.push((input as { feedInfoInMarkdown: string }).feedInfoInMarkdown);
  });

  getJestSpyOn(SecurityCaseStepChecks, "requestCheck").mockResolvedValue(
    undefined as never,
  );

  getJestSpyOn(SecurityCaseAiHold, "carryOnWaitingRuns").mockImplementation(
    async () => {
      carriedOn++;
      return 0;
    },
  );

  getJestSpyOn(SecurityPlaybookActions, "execute").mockImplementation(
    async (context: unknown) => {
      executed.push((context as PlaybookStepContext).step.action);
      return {
        status: SecurityPlaybookStepStatus.Succeeded,
        summary: mdText`Done.`,
      } as never;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function statuses(): Array<string> {
  return run.stepResults.map((result: SecurityPlaybookStepResult): string => {
    return result.status;
  });
}

describe("while OneUptime AI responds first", () => {
  test("the run does the steps before the page, then waits at it in Waiting for OneUptime AI", async () => {
    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.AddCaseNote]);
    expect(run.status).toBe(SecurityPlaybookRunStatus.WaitingForOneUptimeAi);
    expect(run.currentStepIndex).toBe(1);
    expect(statuses()).toEqual([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.WaitingForOneUptimeAi,
      SecurityPlaybookStepStatus.Pending,
    ]);
    expect(feed[feed.length - 1]).toContain("waits while OneUptime AI responds first");
    // Still held after it came to wait: nothing to carry on yet.
    expect(carriedOn).toBe(0);
  });

  test("a hold that ended just as the run came to wait carries the run on at once", async () => {
    let reads: number = 0;

    getJestSpyOn(SecurityCaseAiHold, "isHeld").mockImplementation(async () => {
      reads++;
      return false;
    });

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(reads).toBe(1);
    expect(carriedOn).toBe(1);
  });

  test("Detection Added and Triaged as Likely Malicious runs wait too", async () => {
    for (const trigger of [
      SecurityPlaybookTrigger.DetectionAdded,
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    ]) {
      useRun({ trigger });
      executed = [];

      await SecurityPlaybookEngine.executeRun(RUN_ID);

      expect(run.status).toBe(SecurityPlaybookRunStatus.WaitingForOneUptimeAi);
      expect(executed).not.toContain(SecurityPlaybookActionType.PageOnCall);
    }
  });

  test("a run a person started pages at once: they asked for it", async () => {
    useRun({ trigger: SecurityPlaybookTrigger.Manual, triggeredByUserId: PERSON_ID });

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([
      SecurityPlaybookActionType.AddCaseNote,
      SecurityPlaybookActionType.PageOnCall,
      SecurityPlaybookActionType.AddCaseNote,
    ]);
    expect(run.status).toBe(SecurityPlaybookRunStatus.Succeeded);
  });
});

describe("once the hold ends, the run that waited carries on from its page", () => {
  test("people were alerted: it pages, then does the rest", async () => {
    await SecurityPlaybookEngine.executeRun(RUN_ID);
    expect(run.status).toBe(SecurityPlaybookRunStatus.WaitingForOneUptimeAi);

    // The hold's end queues it again (SecurityCaseAiHold.carryOnWaitingRuns).
    hold = {
      outcome: SecurityCaseAiHoldOutcome.NeedsApproval,
      endedAt: new Date("2026-11-23T03:02:00.000Z"),
    };
    run.status = SecurityPlaybookRunStatus.Queued;
    executed = [];

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([
      SecurityPlaybookActionType.PageOnCall,
      SecurityPlaybookActionType.AddCaseNote,
    ]);
    expect(run.status).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(statuses()).toEqual([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Succeeded,
    ]);
  });

  test("the case was resolved with nobody alerted: the page is skipped, saying why, and the rest runs", async () => {
    await SecurityPlaybookEngine.executeRun(RUN_ID);

    hold = {
      outcome: SecurityCaseAiHoldOutcome.Resolved,
      endedAt: new Date("2026-11-23T03:02:00.000Z"),
    };
    run.status = SecurityPlaybookRunStatus.Queued;
    executed = [];

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.AddCaseNote]);
    expect(run.status).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(statuses()).toEqual([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Skipped,
      SecurityPlaybookStepStatus.Succeeded,
    ]);
    expect(run.stepResults[1]!.message).toBe(
      "Skipped: the case was resolved while OneUptime AI responded first, so nobody had to be paged.",
    );
    expect(feed.join("\n")).toContain(
      "Skipped: the case was resolved while OneUptime AI responded first",
    );
  });

  test("a person took the case: the page is skipped", async () => {
    await SecurityPlaybookEngine.executeRun(RUN_ID);

    hold = {
      outcome: SecurityCaseAiHoldOutcome.TakenByPerson,
      endedAt: new Date("2026-11-23T03:02:00.000Z"),
    };
    run.status = SecurityPlaybookRunStatus.Queued;
    executed = [];

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).not.toContain(SecurityPlaybookActionType.PageOnCall);
    expect(run.stepResults[1]!.message).toContain("a person took the case");
  });
});

describe("a case OneUptime AI does not hold", () => {
  test("pages as it always did", async () => {
    hold = { outcome: null, endedAt: null };

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([
      SecurityPlaybookActionType.AddCaseNote,
      SecurityPlaybookActionType.PageOnCall,
      SecurityPlaybookActionType.AddCaseNote,
    ]);
    expect(run.status).toBe(SecurityPlaybookRunStatus.Succeeded);
  });

  test("a run that started after its hold ended pages, whatever the hold came to", async () => {
    hold = {
      outcome: SecurityCaseAiHoldOutcome.Resolved,
      endedAt: new Date("2026-11-23T03:02:00.000Z"),
    };
    useRun({
      trigger: SecurityPlaybookTrigger.DetectionAdded,
      createdAt: new Date("2026-11-23T05:00:00.000Z"),
    });

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toContain(SecurityPlaybookActionType.PageOnCall);
  });
});
