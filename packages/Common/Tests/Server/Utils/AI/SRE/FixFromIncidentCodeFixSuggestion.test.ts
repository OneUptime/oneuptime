import AIRunService from "../../../../../Server/Services/AIRunService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import CodeFixStartGate from "../../../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import FixRunBudget from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
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
  latestTurn?: AIRun;
  // Any connected repository; the rules' own allowance below.
  hasRepository?: boolean;
  hasAllowedRepository?: boolean;
  gateBlocker?: CodeTaskBlocker | null;
  rules?: AutomaticFixPullRequestRules | null;
  isWithinBudget?: boolean;
}

interface Spies {
  project: SpyInstance<typeof ProjectService.findOneById>;
  runs: SpyInstance<typeof AIRunService.findOneBy>;
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

  test("the fix's own reads: its first turn, of this record, inside the project", async () => {
    const spies: Spies = install({ activeFix: fixRun() });

    await suggestionFor();

    const fixRead: JSONObject = (
      spies.runs.mock.calls[1]![0] as { query: JSONObject }
    ).query;
    expect(fixRead["projectId"]).toBe(PROJECT_ID);
    expect(fixRead["runType"]).toBe(AIRunType.CodeFix);
    expect(fixRead["codeFixTaskType"]).toBe(CodeFixTaskType.FixFromIncident);
    expect(fixRead["triggeredByIncidentId"]).toBe(INCIDENT_ID);
    expect(fixRead["triggeredByAlertId"]).toBeUndefined();
    expect(sqlOf(fixRead["codeTaskId"])).toBe("(codeTaskId IS NULL)");
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
