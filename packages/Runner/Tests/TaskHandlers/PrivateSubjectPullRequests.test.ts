/*
 * ---------------------------------------------------------------------------
 * A fix about a private incident or alert leaves the record out of what it
 * writes on the code host (#9165).
 *
 * A private record is seen only by its owners, and a repository's readers are
 * not its owners: everyone with access to the repository reads the pull
 * request, its commit and its branch. A fix OneUptime AI opened from a
 * private incident's investigation wrote the incident's title into the pull
 * request's title and its commit, and the investigation's whole analysis into
 * its description. For a private subject (the task details say
 * subjectIsPrivate) none of them does any more, and the code agent is asked
 * to keep the record out of its summary - the description - and its comments.
 *
 * The whole pipeline runs, with Git, the workspace, the build checks and the
 * code agent stubbed: what is pinned is what reached the code agent, the
 * commit and the pull request. A public subject's text is pinned beside it,
 * unchanged, so the private one is never what every fix writes.
 * ---------------------------------------------------------------------------
 */

import FixFromIncidentTaskHandler from "../../TaskHandlers/FixFromIncidentTaskHandler";
import ImproveInstrumentationTaskHandler from "../../TaskHandlers/ImproveInstrumentationTaskHandler";
import SubjectPullRequestTaskHandler from "../../TaskHandlers/SubjectPullRequestTaskHandler";
import { TaskContext } from "../../TaskHandlers/TaskHandlerInterface";
import BackendAPI, {
  CodeRepositoryInfo,
  SubjectTaskDetails,
} from "../../Utils/BackendAPI";
import BuildVerification, {
  VerificationOutcome,
} from "../../Utils/BuildVerification";
import RepositoryManager from "../../Utils/RepositoryManager";
import TaskLogger from "../../Utils/TaskLogger";
import WorkspaceManager from "../../Utils/WorkspaceManager";
import { RUNNER_CODE_FIX_CAPABILITIES } from "../../Utils/RunnerAPIRequest";
import { CodeAgentFactory } from "../../CodeAgents/Index";
import {
  CodeAgent,
  CodeAgentResult,
  CodeAgentTask,
} from "../../CodeAgents/CodeAgentInterface";
import FixVerificationStatus from "Common/Types/AI/FixVerificationStatus";
import RunnerCodeFixCapability from "Common/Types/Runner/RunnerCodeFixCapability";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

// What only the record's owners may read: none of it may reach the code host.
const INCIDENT_TITLE: string = "Acme Bank checkout outage for Jane Doe";
const ANALYSIS_SENTENCE: string =
  "The payments-db connection pool was exhausted after the 14:02 deploy of acme-bank-settlement";
const SERVICE_NAME: string = "acme-bank-checkout";

const AGENT_SUMMARY: string =
  "Raised the connection pool's limit and released connections in a finally block.";

const REPOSITORY: CodeRepositoryInfo = {
  id: "repo-id",
  name: "checkout",
  repositoryHostedAt: "GitHub",
  organizationName: "acme",
  repositoryName: "checkout",
  mainBranchName: "main",
  setupCommand: null,
  buildCommand: null,
  testCommand: null,
  servicePathInRepository: null,
  gitHubAppInstallationId: "installation-id",
};

function detailsOf(data: {
  subjectType: "incident" | "alert";
  isPrivate: boolean;
}): SubjectTaskDetails {
  return {
    subjectType: data.subjectType,
    subjectTitle: INCIDENT_TITLE,
    analysisMarkdown: `## Root Cause\n\n${ANALYSIS_SENTENCE}.`,
    serviceName: SERVICE_NAME,
    subjectIsPrivate: data.isPrivate,
    repositories: [REPOSITORY],
    resolutionError: null,
    traceId: null,
    performanceFindings: [],
    spanSummaries: [],
  };
}

interface Written {
  prompt: string;
  commitMessage: string;
  title: string;
  body: string;
}

const NOT_VERIFIED: VerificationOutcome = {
  status: FixVerificationStatus.Skipped,
  summary: "",
  repairAttemptsUsed: 0,
  repairSummaries: [],
  repairPaths: [],
};

// The seam a pull request is opened through, protected on the handler.
interface FinishSeam {
  finishPushedChange: (
    context: TaskContext,
    data: { title: string; body: string },
  ) => Promise<string | null>;
}

// Runs the handler on `details`, and reads back what it wrote.
async function writtenBy(
  handler: SubjectPullRequestTaskHandler,
  details: SubjectTaskDetails,
): Promise<Written> {
  const executeTask: jest.Mock = jest.fn().mockResolvedValue({
    success: true,
    filesModified: ["src/pool.ts"],
    summary: AGENT_SUMMARY,
    logs: [],
  } as CodeAgentResult);

  jest.spyOn(CodeAgentFactory, "createDefaultAgent").mockReturnValue({
    name: "InHouse",
    initialize: jest.fn().mockResolvedValue(undefined),
    executeTask: executeTask,
    onProgress: jest.fn(),
    isAvailable: jest.fn().mockResolvedValue(true),
    abort: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
  } as unknown as CodeAgent);
  jest.spyOn(WorkspaceManager, "createWorkspace").mockResolvedValue({
    workspacePath: "/tmp/oneuptime-private",
    taskId: "task-id",
    createdAt: new Date(0),
  });
  jest.spyOn(WorkspaceManager, "deleteWorkspace").mockResolvedValue(undefined);
  jest.spyOn(RepositoryManager.prototype, "cloneRepository").mockResolvedValue({
    repositoryPath: "/tmp/oneuptime-private/checkout",
    baseBranch: "main",
  } as never);
  jest
    .spyOn(RepositoryManager.prototype, "createBranch")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RepositoryManager.prototype, "addPaths")
    .mockResolvedValue(undefined);

  const commit: jest.SpyInstance = jest
    .spyOn(RepositoryManager.prototype, "commitChanges")
    .mockResolvedValue(undefined);

  jest
    .spyOn(RepositoryManager.prototype, "pushBranch")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(BuildVerification, "verifyWithRepairs")
    .mockResolvedValue(NOT_VERIFIED);

  const finish: jest.SpyInstance = jest
    .spyOn(handler as unknown as FinishSeam, "finishPushedChange")
    .mockResolvedValue("https://github.com/acme/checkout/pull/7");

  const context: TaskContext = {
    taskId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    taskType: handler.taskType,
    logger: {
      info: jest.fn().mockResolvedValue(undefined),
      debug: jest.fn().mockResolvedValue(undefined),
      warning: jest.fn().mockResolvedValue(undefined),
      error: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      logProcessOutput: jest.fn(),
    } as unknown as TaskLogger,
    backendAPI: {
      getSubjectTaskDetails: jest.fn().mockResolvedValue(details),
      getRepositoryToken: jest.fn().mockResolvedValue({
        token: "ghs_test",
        expiresAt: new Date(0),
        repositoryUrl: "https://github.com/acme/checkout.git",
        organizationName: "acme",
        repositoryName: "checkout",
      }),
    } as unknown as BackendAPI,
    startedAt: new Date(0),
  };

  await handler.execute(context);

  expect(executeTask).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledTimes(1);

  const opened: { title: string; body: string } = finish.mock.calls[0]![1] as {
    title: string;
    body: string;
  };

  return {
    prompt: (executeTask.mock.calls[0]![0] as CodeAgentTask).prompt,
    commitMessage: commit.mock.calls[0]![1] as string,
    title: opened.title,
    body: opened.body,
  };
}

const RECIPES: Array<{
  recipe: string;
  handler: () => SubjectPullRequestTaskHandler;
}> = [
  {
    recipe: "FixFromIncident",
    handler: (): SubjectPullRequestTaskHandler => {
      return new FixFromIncidentTaskHandler();
    },
  },
  {
    recipe: "ImproveInstrumentation",
    handler: (): SubjectPullRequestTaskHandler => {
      return new ImproveInstrumentationTaskHandler();
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("this Runner says it keeps private records out of its pull requests", () => {
  test("it declares the capability, so the server hands it a private record's fix", () => {
    expect(RUNNER_CODE_FIX_CAPABILITIES).toContain(
      RunnerCodeFixCapability.KeepsPrivateRecordsOutOfPullRequests,
    );
  });
});

describe.each(RECIPES)(
  "$recipe about a private record",
  (recipe: {
    recipe: string;
    handler: () => SubjectPullRequestTaskHandler;
  }) => {
    test.each(["incident", "alert"] as const)(
      "a private %s: the commit, the title and the description name nothing of it",
      async (subjectType: "incident" | "alert") => {
        const written: Written = await writtenBy(
          recipe.handler(),
          detailsOf({ subjectType, isPrivate: true }),
        );

        for (const text of [
          written.commitMessage,
          written.title,
          written.body,
        ]) {
          expect(text).not.toContain(INCIDENT_TITLE);
          expect(text).not.toContain(ANALYSIS_SENTENCE);
          expect(text).not.toContain(SERVICE_NAME);
          expect(text).not.toContain("Root Cause");
          expect(text.toLowerCase()).not.toContain(subjectType);
        }

        // What the change does, in the code agent's own words, stays.
        expect(written.body).toContain(AGENT_SUMMARY);
        expect(written.body).toContain("stay in OneUptime");
        expect(written.body.toLowerCase()).toContain("review");
        expect(written.title.length).toBeGreaterThan(0);
        expect(written.commitMessage.split("\n")[0]).toBe(written.title);
      },
    );

    test("the code agent still reads the analysis, and is asked to keep the record out", async () => {
      const written: Written = await writtenBy(
        recipe.handler(),
        detailsOf({ subjectType: "incident", isPrivate: true }),
      );

      // It needs the analysis to find the code to fix.
      expect(written.prompt).toContain(ANALYSIS_SENTENCE);
      expect(written.prompt).toContain(
        SubjectPullRequestTaskHandler.getPrivateSubjectInstruction("incident"),
      );
      expect(written.prompt).toContain("## This incident is private");
      expect(written.prompt).toContain("comments you write in the code");
    });

    test("a public record's fix writes as before: its title and its analysis", async () => {
      const written: Written = await writtenBy(
        recipe.handler(),
        detailsOf({ subjectType: "incident", isPrivate: false }),
      );

      expect(written.title).toContain(INCIDENT_TITLE.substring(0, 20));
      expect(written.commitMessage).toContain(INCIDENT_TITLE.substring(0, 20));
      expect(written.body).toContain(INCIDENT_TITLE);
      expect(written.body).toContain(ANALYSIS_SENTENCE);
      expect(written.prompt).not.toContain("is private");
    });
  },
);

describe("the private wording is each recipe's own", () => {
  test("a fix and an instrumentation change are told apart", async () => {
    const fix: Written = await writtenBy(
      new FixFromIncidentTaskHandler(),
      detailsOf({ subjectType: "incident", isPrivate: true }),
    );

    jest.restoreAllMocks();

    const instrumentation: Written = await writtenBy(
      new ImproveInstrumentationTaskHandler(),
      detailsOf({ subjectType: "incident", isPrivate: true }),
    );

    expect(fix.title).toBe("fix: cause found by an AI investigation");
    expect(instrumentation.title).toBe(
      "chore(observability): add telemetry an AI investigation lacked",
    );
    expect(instrumentation.body).toContain("Instrumentation only");
    expect(fix.body).not.toContain("Instrumentation only");
  });
});
