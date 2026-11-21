import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import DeclaredCodeChanges from "../../../../../Server/Utils/AutoRemediation/DeclaredCodeChanges";
import { CodeFixAgentSource } from "../../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeFixPullRequestRecord from "../../../../../Server/Utils/AI/CodeFix/CodeFixPullRequestRecord";
import CodeTaskFixRetry, {
  CODE_TASK_FIX_TURN_SELECT,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskFixRetry";
import CodeTaskOrigin, {
  CodeTaskOriginSubjects,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskOrigin";
import { CODE_TASK_TURN_SELECT } from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import AIRunType from "../../../../../Types/AI/AIRunType";
import {
  CodeTaskOriginJSON,
  CodeTaskOriginType,
} from "../../../../../Types/AI/CodeTask";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Fix With AI's code work is the security case's (#10347): the CodeFix run
 * a case's playbook asks for carries the case (AIRun.triggeredBySecurityCaseId),
 * the pull request recorded from that run keeps it
 * (AIAgentTaskPullRequest.securityCaseId) - which is how the case's Fix
 * step finds its fix - a fix asked again keeps it too, and Code says the
 * task started from that case, linked to it, naming it only to a reader
 * who may read the case.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const EXCEPTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("66666666-6666-4666-8666-666666666666"),
  tenantId: PROJECT_ID,
};

afterEach(() => {
  jest.restoreAllMocks();
});

function fixOfCase(setUp?: (run: AIRun) => void): AIRun {
  const run: AIRun = new AIRun();
  run._id = RUN_ID.toString();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = CodeFixTaskType.FixException;
  run.triggeredByTelemetryExceptionId = EXCEPTION_ID;
  run.triggeredBySecurityCaseId = CASE_ID;
  setUp?.(run);
  return run;
}

function subjectsWith(securityCase?: SecurityCase): CodeTaskOriginSubjects {
  const exception: TelemetryException = new TelemetryException();
  exception._id = EXCEPTION_ID.toString();
  exception.exceptionType = "SyntaxError";
  exception.message = "unterminated quoted string";

  return {
    exceptions: new Map([[EXCEPTION_ID.toString(), exception]]),
    incidents: new Map(),
    alerts: new Map(),
    securityCases: new Map(
      securityCase ? [[CASE_ID.toString(), securityCase]] : [],
    ),
  };
}

describe("Code says a fix asked from a security case started from that case", () => {
  test("named by its number and title when the reader may read the case, linked to it, over the exception it fixes", () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.caseNumberWithPrefix = "CASE-52";
    securityCase.title = "SQL injection attempts — 35.196.249.14";

    expect(
      CodeTaskOrigin.describe({
        run: fixOfCase(),
        subjects: subjectsWith(securityCase),
      }),
    ).toEqual({
      type: CodeTaskOriginType.SecurityCase,
      label: "CASE-52: SQL injection attempts — 35.196.249.14",
      recordId: CASE_ID.toString(),
    });
  });

  test("a reader who may not read the case keeps its link, without its title", () => {
    const origin: CodeTaskOriginJSON = CodeTaskOrigin.describe({
      run: fixOfCase(),
      subjects: subjectsWith(),
    });

    expect(origin).toEqual({
      type: CodeTaskOriginType.SecurityCase,
      label: "",
      recordId: CASE_ID.toString(),
    });
  });

  test("a fix of no case is its exception's, as before", () => {
    expect(
      CodeTaskOrigin.describe({
        run: fixOfCase((run: AIRun) => {
          run.triggeredBySecurityCaseId = undefined;
        }),
        subjects: subjectsWith(),
      }),
    ).toMatchObject({
      type: CodeTaskOriginType.Exception,
      label: "SyntaxError: unterminated quoted string",
    });
  });

  test("a person's request in Code is theirs, whatever it names", () => {
    const request: AIRun = fixOfCase((run: AIRun) => {
      run.codeFixTaskType = CodeFixTaskType.CodeRequest;
    });

    expect(CodeTaskOrigin.isFixOfSecurityCase(request)).toBe(false);
    expect(CodeTaskOrigin.isFixOfSecurityCase(fixOfCase())).toBe(true);
    // Its origin is on the run: no task context needs reading.
    expect(CodeTaskOrigin.needsTaskContext(fixOfCase())).toBe(false);
  });

  test("the cases are read as the reader, and a table they may not read names nothing", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseService, "findBy")
      .mockRejectedValue(new Error("You do not have permission to read"));

    const loaded: CodeTaskOriginSubjects = await CodeTaskOrigin.loadSubjects({
      projectId: PROJECT_ID,
      runs: [
        fixOfCase((run: AIRun) => {
          run.triggeredByTelemetryExceptionId = undefined;
        }),
      ],
      props: READER,
    });

    expect(loaded.securityCases?.size).toBe(0);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      props: READER,
    });
  });

  test("a task's turns are read with the case they were asked from", () => {
    expect(CODE_TASK_TURN_SELECT).toMatchObject({
      triggeredBySecurityCaseId: true,
    });
    expect(CODE_TASK_FIX_TURN_SELECT).toMatchObject({
      triggeredBySecurityCaseId: true,
    });
  });
});

describe("the pull request a case's fix opens is kept on the case", () => {
  function stubRecording(run: AIRun | null): {
    created: Array<AIAgentTaskPullRequest>;
  } {
    const created: Array<AIAgentTaskPullRequest> = [];
    const repository: CodeRepository = new CodeRepository();
    repository._id = REPOSITORY_ID.toString();
    repository.projectId = PROJECT_ID;
    repository.organizationName = "acme";
    repository.repositoryName = "search";

    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockResolvedValue(repository);
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(run);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(AIAgentTaskPullRequestService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(AIAgentTaskPullRequestService, "create")
      .mockImplementation(
        async (data: unknown): Promise<AIAgentTaskPullRequest> => {
          const row: AIAgentTaskPullRequest = (
            data as { data: AIAgentTaskPullRequest }
          ).data;
          created.push(row);
          return row;
        },
      );
    jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DeclaredCodeChanges, "onPullRequestOpened")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "held" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    return { created };
  }

  async function record(): Promise<void> {
    await CodeFixPullRequestRecord.record({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      aiAgent: { id: ObjectID.generate(), source: CodeFixAgentSource.Runner },
      fields: {
        codeRepositoryId: REPOSITORY_ID,
        pullRequestUrl: "https://github.com/acme/search/pull/123",
        pullRequestNumber: 123,
        title: "Parameterize the search query",
      },
    });
  }

  test("the run's case is the pull request's", async () => {
    const recorded: { created: Array<AIAgentTaskPullRequest> } =
      stubRecording(fixOfCase());

    await record();

    expect(recorded.created).toHaveLength(1);
    expect(recorded.created[0]!.securityCaseId?.toString()).toBe(
      CASE_ID.toString(),
    );
    expect(recorded.created[0]!.aiRunId?.toString()).toBe(RUN_ID.toString());
  });

  test("a run of no case, or of another project, keeps none", async () => {
    const none: { created: Array<AIAgentTaskPullRequest> } = stubRecording(
      fixOfCase((run: AIRun) => {
        run.triggeredBySecurityCaseId = undefined;
      }),
    );

    await record();
    expect(none.created[0]!.securityCaseId).toBeUndefined();

    jest.restoreAllMocks();

    const foreign: { created: Array<AIAgentTaskPullRequest> } = stubRecording(
      fixOfCase((run: AIRun) => {
        run.projectId = ObjectID.generate();
      }),
    );

    await record();
    expect(foreign.created[0]!.securityCaseId).toBeUndefined();
  });

  test("a run that cannot be read never loses its pull request: it is recorded without the case", async () => {
    const recorded: { created: Array<AIAgentTaskPullRequest> } =
      stubRecording(null);

    jest
      .spyOn(AIRunService, "findOneById")
      .mockRejectedValue(new Error("connection reset"));

    await record();

    expect(recorded.created).toHaveLength(1);
    expect(recorded.created[0]!.securityCaseId).toBeUndefined();
  });
});

describe("a fix asked again stays the case's", () => {
  test("the new turn carries the case its first turn was asked from", () => {
    const task: AIRun = fixOfCase();
    task.id = RUN_ID;

    const turn: AIRun = CodeTaskFixRetry.newTurn({
      projectId: PROJECT_ID,
      userId: ObjectID.generate(),
      task,
      turn: fixOfCase(),
      taskType: CodeFixTaskType.FixException,
    });

    expect(turn.triggeredBySecurityCaseId?.toString()).toBe(CASE_ID.toString());
    expect(turn.triggeredByTelemetryExceptionId?.toString()).toBe(
      EXCEPTION_ID.toString(),
    );
  });
});
