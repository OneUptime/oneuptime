import AIRunService from "../../../../../Server/Services/AIRunService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import CodeFixStartGate from "../../../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import FixRunBudget from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import CodeTaskThread from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FixFromIncidentTaskTrigger from "../../../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import RemediationRulePullRequests from "../../../../../Server/Utils/AI/SRE/RemediationRulePullRequests";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRunCodeFixRecommendation from "../../../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import { AutomaticFixPullRequestRules } from "../../../../../Types/AI/AutomaticFixPullRequests";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../../Types/AI/CodeTask";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { CodeRepositoryAllowance } from "../../../../../Types/CodeRepository/CodeRepositoryAllowance";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { FinishedFixOutcome } from "../../../../../Utils/Suggestions/CodeFixSuggestion";
import {
  AutomaticCodeFixBlocker,
  HIDDEN_INVESTIGATION_CODE_FIX_SUGGESTION,
  InvestigationCodeFixSuggestion,
  NO_INVESTIGATION_CODE_FIX_SUGGESTION,
} from "../../../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "../../../../../Utils/Suggestions/SuggestionOffer";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * FixFromIncidentTaskTrigger.getSuggestionForSubject: what the Remediation
 * step says about the fix in the code an investigation recommends (block
 * 43). The automatic trigger used to stop with a debug line and nothing
 * else; now the step is told, with the settings of now:
 *
 *   - nothing while AI is off, or the latest investigation recommends no
 *     change in the code (not finished, not recommended, none at all);
 *   - the pull request being written or done, who asked for it, and how it
 *     came out - its first turn read, its replies through its latest turn;
 *   - else the one setup step (a repository, then Code's gate) or Act -
 *     and why it was not opened on its own, in the automatic trigger's own
 *     order: the fixing switch, the AI rules, a repository they allow, the
 *     day's share, else "the settings changed since".
 *
 * Every read is as OneUptime and inside the project; the route checks the
 * reader may read the record.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ALERT_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const INVESTIGATION_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const FIX_ID: ObjectID = new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
const USER_ID: ObjectID = new ObjectID("ffffffff-ffff-4fff-8fff-ffffffffffff");
const REPOSITORY_ID: string = "12121212-1212-4212-8212-121212121212";

function project(overrides: Partial<Project> = {}): Project {
  const row: Project = new Project();
  row.enableAi = true;
  row.enableAutomaticIncidentRemediation = true;
  row.enableAutomaticAlertRemediation = true;
  Object.assign(row, overrides);
  return row;
}

function investigation(overrides: Partial<AIRun> = {}): AIRun {
  const run: AIRun = new AIRun();
  run.id = INVESTIGATION_ID;
  run.status = AIRunStatus.Completed;
  run.codeFixRecommendation = AIRunCodeFixRecommendation.Recommended;
  Object.assign(run, overrides);
  return run;
}

function fixRun(overrides: Partial<AIRun> = {}): AIRun {
  const run: AIRun = new AIRun();
  run.id = FIX_ID;
  run.status = AIRunStatus.Running;
  Object.assign(run, overrides);
  return run;
}

// The SQL a QueryHelper filter writes for a column (a TypeORM Raw operator).
function sqlOf(filter: unknown): string {
  const getSql: ((alias: string) => string) | undefined = (
    filter as { getSql?: (alias: string) => string } | undefined
  )?.getSql;

  return getSql ? getSql("codeTaskId") : "";
}

interface Setup {
  project?: Project | null;
  investigation?: AIRun | null;
  activeFix?: AIRun | null;
  finishedFix?: AIRun | null;
  // The fix's task carries a private record the reader may not open.
  isFixHidden?: boolean;
  latestTurn?: AIRun;
  // Any connected repository; the rules' own allowance below.
  hasRepository?: boolean;
  hasAllowedRepository?: boolean;
  gateBlocker?: CodeTaskBlocker | null;
  rules?: AutomaticFixPullRequestRules | null;
  isWithinBudget?: boolean;
}

// Who reads the record's page: a member, who may read its fix unless a test says.
const READER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

interface Spies {
  project: SpyInstance<typeof ProjectService.findOneById>;
  runs: SpyInstance<typeof AIRunService.findOneBy>;
  hiddenFrom: SpyInstance<typeof CodeTaskThread.findTasksHiddenFrom>;
  latestTurn: SpyInstance<typeof CodeTaskRuns.getLatestTurn>;
  hasRepository: SpyInstance<typeof SubjectCodeFixRun.hasConnectedRepository>;
  gate: SpyInstance<typeof CodeFixStartGate.check>;
  rules: SpyInstance<typeof RemediationRulePullRequests.getRulesForSignal>;
  budget: SpyInstance<typeof FixRunBudget.getBudgetStatus>;
}

function install(setup: Setup = {}): Spies {
  const has: (key: keyof Setup) => boolean = (key: keyof Setup): boolean => {
    return Object.prototype.hasOwnProperty.call(setup, key);
  };

  return {
    project: jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue((has("project") ? setup.project : project()) as never),
    runs: jest
      .spyOn(AIRunService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: JSONObject;
      }): Promise<AIRun | null> => {
        if (findOneBy.query["runType"] === AIRunType.Investigation) {
          return has("investigation")
            ? setup.investigation || null
            : investigation();
        }

        // The fix's own reads: still working (NOT IN terminal), or finished.
        return sqlOf(findOneBy.query["status"]).includes("NOT IN")
          ? setup.activeFix || null
          : setup.finishedFix || null;
      }) as never),
    hiddenFrom: jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(
        new Set<string>(
          setup.isFixHidden ? [FIX_ID.toString().toLowerCase()] : [],
        ),
      ),
    latestTurn: jest
      .spyOn(CodeTaskRuns, "getLatestTurn")
      .mockResolvedValue(
        (setup.latestTurn ||
          fixRun({ status: AIRunStatus.Completed })) as never,
      ),
    hasRepository: jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockImplementation((async (
        _projectId: ObjectID,
        allowance?: CodeRepositoryAllowance,
      ): Promise<boolean> => {
        return allowance
          ? setup.hasAllowedRepository ?? setup.hasRepository ?? true
          : setup.hasRepository ?? true;
      }) as never),
    gate: jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: new ObjectID(REPOSITORY_ID),
      blocker: setup.gateBlocker || null,
    } as never),
    rules: jest
      .spyOn(RemediationRulePullRequests, "getRulesForSignal")
      .mockResolvedValue(
        (has("rules")
          ? setup.rules
          : { rulesSetUp: false, matchingRules: [] }) as never,
      ),
    budget: jest.spyOn(FixRunBudget, "getBudgetStatus").mockResolvedValue({
      allowed: setup.isWithinBudget ?? true,
      limit: 5,
      paused: false,
      runsToday: setup.isWithinBudget === false ? 5 : 0,
    } as never),
  };
}

async function suggestionFor(
  subject: { incidentId?: ObjectID; alertId?: ObjectID } = {
    incidentId: INCIDENT_ID,
  },
): Promise<InvestigationCodeFixSuggestion> {
  return await FixFromIncidentTaskTrigger.getSuggestionForSubject({
    projectId: PROJECT_ID,
    ...subject,
    reader: READER,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("nothing to say", () => {
  test("while AI is off: nothing else is read", async () => {
    const spies: Spies = install({ project: project({ enableAi: false }) });

    expect(await suggestionFor()).toEqual(NO_INVESTIGATION_CODE_FIX_SUGGESTION);
    expect(spies.runs).not.toHaveBeenCalled();
  });

  test("for a project that cannot be read", async () => {
    install({ project: null });

    expect(await suggestionFor()).toEqual(NO_INVESTIGATION_CODE_FIX_SUGGESTION);
  });

  test("without exactly one incident or alert", async () => {
    const spies: Spies = install();

    expect(await suggestionFor({})).toEqual(
      NO_INVESTIGATION_CODE_FIX_SUGGESTION,
    );
    expect(
      await suggestionFor({ incidentId: INCIDENT_ID, alertId: ALERT_ID }),
    ).toEqual(NO_INVESTIGATION_CODE_FIX_SUGGESTION);
    expect(spies.project).not.toHaveBeenCalled();
  });

  test.each([
    ["no investigation", null],
    [
      "an investigation still running",
      investigation({ status: AIRunStatus.Running }),
    ],
    [
      "one that recommends no change in the code",
      investigation({
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
      }),
    ],
    [
      "one still deciding",
      investigation({
        codeFixRecommendation: AIRunCodeFixRecommendation.Pending,
      }),
    ],
  ])("after %s: no fix is read", async (_case: string, run: AIRun | null) => {
    const spies: Spies = install({ investigation: run });

    expect(await suggestionFor()).toEqual(NO_INVESTIGATION_CODE_FIX_SUGGESTION);
    // Only the investigation itself was read.
    expect(spies.runs).toHaveBeenCalledTimes(1);
    expect(spies.hasRepository).not.toHaveBeenCalled();
  });
});

describe("a fix pull request that exists", () => {
  test("one being written that OneUptime AI opened on its own", async () => {
    const spies: Spies = install({ activeFix: fixRun() });

    expect(await suggestionFor()).toEqual({
      offer: SuggestionOffer.InProgress,
      fixOutcome: null,
      blocker: null,
      aiRunId: FIX_ID.toString(),
      isAutomatic: true,
      automaticBlocker: null,
    });
    // A fix on its way: no gate, no repository, no rule is asked.
    expect(spies.gate).not.toHaveBeenCalled();
    expect(spies.hasRepository).not.toHaveBeenCalled();
    expect(spies.rules).not.toHaveBeenCalled();
  });

  test("one a person asked for", async () => {
    install({ activeFix: fixRun({ userId: USER_ID }) });

    expect((await suggestionFor()).isAutomatic).toBe(false);
  });

  /*
   * Any turn of a fix task of this record: its first, or the fix asked
   * again from Code (#6509) - a later turn of the same task, with the same
   * recipe and record - each with the task it is of.
   */
  test("the fix's own reads: a turn of a fix task of this record, with its task, inside the project", async () => {
    const spies: Spies = install({ activeFix: fixRun() });

    await suggestionFor();

    const fixRead: { query: JSONObject; select: JSONObject } = spies.runs.mock
      .calls[1]![0] as { query: JSONObject; select: JSONObject };
    expect(fixRead.query["projectId"]).toBe(PROJECT_ID);
    expect(fixRead.query["runType"]).toBe(AIRunType.CodeFix);
    expect(fixRead.query["codeFixTaskType"]).toBe(
      CodeFixTaskType.FixFromIncident,
    );
    expect(fixRead.query["triggeredByIncidentId"]).toBe(INCIDENT_ID);
    expect(fixRead.query["triggeredByAlertId"]).toBeUndefined();
    expect(fixRead.query["codeTaskId"]).toBeUndefined();
    expect(fixRead.select["codeTaskId"]).toBe(true);
  });

  test.each([
    [
      "its pull request is open",
      fixRun({ status: AIRunStatus.Completed }),
      FinishedFixOutcome.Fixed,
    ],
    [
      "it found nothing to change",
      fixRun({ status: AIRunStatus.NoFixFound }),
      FinishedFixOutcome.NothingToChange,
    ],
    [
      "it waits for an answer in Code",
      fixRun({ status: AIRunStatus.Completed, needsUserInput: true }),
      FinishedFixOutcome.WaitingForYou,
    ],
  ])(
    "one done: %s",
    async (_case: string, latestTurn: AIRun, outcome: FinishedFixOutcome) => {
      const finished: AIRun = fixRun({
        status:
          outcome === FinishedFixOutcome.NothingToChange
            ? AIRunStatus.NoFixFound
            : AIRunStatus.Completed,
        userId: USER_ID,
      });
      install({ finishedFix: finished, latestTurn });

      expect(await suggestionFor()).toEqual({
        offer: SuggestionOffer.Done,
        fixOutcome: outcome,
        blocker: null,
        aiRunId: FIX_ID.toString(),
        isAutomatic: false,
        automaticBlocker: null,
      });
    },
  );

  test("one done with a reply under way in Code is work in progress again", async () => {
    install({
      finishedFix: fixRun({ status: AIRunStatus.Completed }),
      latestTurn: fixRun({ status: AIRunStatus.Running }),
    });

    const suggestion: InvestigationCodeFixSuggestion = await suggestionFor();
    expect(suggestion.offer).toBe(SuggestionOffer.InProgress);
    expect(suggestion.aiRunId).toBe(FIX_ID.toString());
  });
});

/*
 * #6509: a fix whose first turn failed is asked again from Code (Try
 * again) - a later turn of the same task, with its recipe and its record.
 * The step reads it as the fix: on its way, or done once it did its work,
 * linked to its task - never offering a second fix beside it, which could
 * open a second pull request.
 */
describe("a fix asked again from Code", () => {
  const RETRY_ID: ObjectID = new ObjectID(
    "13131313-1313-4313-8313-131313131313",
  );

  test("on its way: the fix being written, by whoever asked it again, linked to its task", async () => {
    const spies: Spies = install({
      activeFix: fixRun({
        id: RETRY_ID,
        codeTaskId: FIX_ID,
        status: AIRunStatus.Queued,
        userId: USER_ID,
      }),
    });

    const suggestion: InvestigationCodeFixSuggestion = await suggestionFor();

    expect(suggestion.offer).toBe(SuggestionOffer.InProgress);
    expect(suggestion.aiRunId).toBe(FIX_ID.toString());
    expect(suggestion.isAutomatic).toBe(false);
    // The task is the one asked whether the reader may see it.
    expect(spies.hiddenFrom).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      taskIds: [FIX_ID],
      reader: READER,
    });
    expect(spies.gate).not.toHaveBeenCalled();
  });

  test("done: its pull request, read through its task's latest turn, linked to its task", async () => {
    const spies: Spies = install({
      finishedFix: fixRun({
        id: RETRY_ID,
        codeTaskId: FIX_ID,
        status: AIRunStatus.Completed,
        userId: USER_ID,
      }),
      latestTurn: fixRun({ id: RETRY_ID, status: AIRunStatus.Completed }),
    });

    expect(await suggestionFor()).toEqual({
      offer: SuggestionOffer.Done,
      fixOutcome: FinishedFixOutcome.Fixed,
      blocker: null,
      aiRunId: FIX_ID.toString(),
      isAutomatic: false,
      automaticBlocker: null,
    });

    // The task's latest turn is read by the task, not by the turn.
    const read: { task: AIRun } = spies.latestTurn.mock.calls[0]![0] as {
      task: AIRun;
    };
    expect(read.task.id?.toString()).toBe(FIX_ID.toString());
    expect(spies.hiddenFrom).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      taskIds: [FIX_ID],
      reader: READER,
    });
  });

  test("hidden from the reader: there, and nothing of it", async () => {
    install({
      activeFix: fixRun({ id: RETRY_ID, codeTaskId: FIX_ID }),
      isFixHidden: true,
    });

    expect(await suggestionFor()).toEqual(
      HIDDEN_INVESTIGATION_CODE_FIX_SUGGESTION,
    );
  });
});

/*
 * A fix whose task a reply carried a private incident or alert into, which
 * the reader may not open, read as its task's own page reads it: it is
 * there - no second one is offered - and nothing of how it stands, who
 * asked for it, or where it is.
 */
describe("a fix pull request in a task hidden from the reader", () => {
  test.each([
    ["being written", { activeFix: fixRun() }],
    [
      "done",
      {
        finishedFix: fixRun({
          status: AIRunStatus.Completed,
          userId: USER_ID,
        }),
      },
    ],
  ])("one %s: there, and nothing of it", async (_name: string, fix: Setup) => {
    const spies: Spies = install({ ...fix, isFixHidden: true });

    const suggestion: InvestigationCodeFixSuggestion = await suggestionFor();

    expect(suggestion).toEqual(HIDDEN_INVESTIGATION_CODE_FIX_SUGGESTION);
    expect(suggestion).toEqual({
      offer: SuggestionOffer.Done,
      fixOutcome: FinishedFixOutcome.Hidden,
      blocker: null,
      aiRunId: null,
      isAutomatic: false,
      automaticBlocker: null,
    });
    // Asked of the fix, as the reader; nothing else is read for it.
    expect(spies.hiddenFrom).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      taskIds: [FIX_ID],
      reader: READER,
    });
    expect(spies.latestTurn).not.toHaveBeenCalled();
    expect(spies.gate).not.toHaveBeenCalled();
    expect(spies.rules).not.toHaveBeenCalled();
  });

  test("no fix yet: the reader's sight of a task is never asked", async () => {
    const spies: Spies = install({ activeFix: null, finishedFix: null });

    expect((await suggestionFor()).offer).toBe(SuggestionOffer.Act);
    expect(spies.hiddenFrom).not.toHaveBeenCalled();
  });
});

describe("no fix yet: the one step in the way, and why it did not open on its own", () => {
  test("no repository connected: connect one", async () => {
    const spies: Spies = install({
      hasRepository: false,
      hasAllowedRepository: false,
    });

    expect(await suggestionFor()).toEqual({
      offer: SuggestionOffer.SetUp,
      fixOutcome: null,
      blocker: null,
      aiRunId: null,
      isAutomatic: false,
      automaticBlocker: AutomaticCodeFixBlocker.NoRepository,
    });
    // Code's gate needs a repository to be asked about.
    expect(spies.gate).not.toHaveBeenCalled();
  });

  test("a repository, and Code's gate in the way: its words", async () => {
    const blocker: CodeTaskBlocker = {
      type: CodeTaskBlockerType.NoAiCredits,
      message: "This project's AI credits are used up.",
    };
    const spies: Spies = install({ gateBlocker: blocker });

    const suggestion: InvestigationCodeFixSuggestion = await suggestionFor();

    expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
    expect(suggestion.blocker).toEqual({
      ...blocker,
      repositoryId: REPOSITORY_ID,
    });
    // The gate is asked about the run a click would queue.
    const asked: {
      projectId: ObjectID;
      taskType: CodeFixTaskType;
      taskContext: JSONObject;
    } = spies.gate.mock.calls[0]![0] as never;
    expect(asked.projectId).toBe(PROJECT_ID);
    expect(asked.taskType).toBe(CodeFixTaskType.FixFromIncident);
    expect(asked.taskContext["sourceInvestigationRunId"]).toBe(
      INVESTIGATION_ID.toString(),
    );
  });

  test("Fix new incidents automatically is off: the rules are never read", async () => {
    const spies: Spies = install({
      project: project({ enableAutomaticIncidentRemediation: false }),
    });

    const suggestion: InvestigationCodeFixSuggestion = await suggestionFor();

    expect(suggestion.offer).toBe(SuggestionOffer.Act);
    expect(suggestion.automaticBlocker).toBe(AutomaticCodeFixBlocker.FixOff);
    expect(spies.rules).not.toHaveBeenCalled();
  });

  test("an alert reads the alert's switch, not the incident's", async () => {
    install({
      project: project({
        enableAutomaticIncidentRemediation: true,
        enableAutomaticAlertRemediation: false,
      }),
    });

    expect((await suggestionFor({ alertId: ALERT_ID })).automaticBlocker).toBe(
      AutomaticCodeFixBlocker.FixOff,
    );
  });

  test("AI rules set up, and none matches", async () => {
    install({ rules: { rulesSetUp: true, matchingRules: [] } });

    expect((await suggestionFor()).automaticBlocker).toBe(
      AutomaticCodeFixBlocker.NoMatchingRule,
    );
  });

  test("the matching rules have fix pull requests off", async () => {
    install({
      rules: {
        rulesSetUp: true,
        matchingRules: [
          { name: "Checkout", openCodeFixPullRequests: false },
          { name: "Payments", openCodeFixPullRequests: false },
        ],
      },
    });

    expect((await suggestionFor()).automaticBlocker).toBe(
      AutomaticCodeFixBlocker.PullRequestOff,
    );
  });

  test("the rules could not be read", async () => {
    install({ rules: null });

    expect((await suggestionFor()).automaticBlocker).toBe(
      AutomaticCodeFixBlocker.RulesUnreadable,
    );
  });

  test("none of the repositories the rules allow is connected", async () => {
    const spies: Spies = install({
      hasRepository: true,
      hasAllowedRepository: false,
      rules: {
        rulesSetUp: true,
        matchingRules: [
          {
            name: "Checkout",
            openCodeFixPullRequests: true,
            codeRepositories: [{ _id: REPOSITORY_ID }],
          },
        ],
      },
    });

    const suggestion: InvestigationCodeFixSuggestion = await suggestionFor();

    // A person may still open it in any connected repository.
    expect(suggestion.offer).toBe(SuggestionOffer.Act);
    expect(suggestion.automaticBlocker).toBe(
      AutomaticCodeFixBlocker.NoRepository,
    );
    // Asked about the rules' repositories the second time.
    const allowance: CodeRepositoryAllowance = spies.hasRepository.mock
      .calls[1]![1] as CodeRepositoryAllowance;
    expect(allowance.isEveryRepository).toBe(false);
  });

  test("the day's share of fix pull requests is used up", async () => {
    install({ isWithinBudget: false });

    expect((await suggestionFor()).automaticBlocker).toBe(
      AutomaticCodeFixBlocker.DailyLimit,
    );
  });

  test("nothing stops it now: the settings changed since the investigation ended", async () => {
    install();

    expect(await suggestionFor()).toEqual({
      offer: SuggestionOffer.Act,
      fixOutcome: null,
      blocker: null,
      aiRunId: null,
      isAutomatic: false,
      automaticBlocker: AutomaticCodeFixBlocker.ChangedSince,
    });
  });
});
