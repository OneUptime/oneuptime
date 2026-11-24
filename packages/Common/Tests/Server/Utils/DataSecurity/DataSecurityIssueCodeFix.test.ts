jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import AIRunService from "../../../../Server/Services/AIRunService";
import DataSecurityIssueGroupService from "../../../../Server/Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskListRows from "../../../../Server/Utils/AI/CodeTask/CodeTaskListRows";
import CodeTaskThread from "../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import DataSecurityIssueCodeFix from "../../../../Server/Utils/DataSecurity/DataSecurityIssueCodeFix";
import ProjectDataTypeNames from "../../../../Server/Utils/DataSecurity/ProjectDataTypeNames";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskState,
  CodeTaskStateUtil,
} from "../../../../Types/AI/CodeTask";
import FixProductionCheck from "../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityIssueCodeFixResult } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { SECRETS_IN_TELEMETRY_CHECK_ID } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakFixStrategy,
  TelemetryLeakSignal,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import { DeclaredCodeChangeState } from "../../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE AN ISSUE'S FIX IN CODE STANDS, FOR THE READER (#10367): THE ISSUE
 * KEEPS ITS FIX.
 *
 * The issue's own task (kept on it when the fix was asked), else the newest
 * fix Fix with AI asked for it, else its group's; read as the reader may
 * read it: being written, open, waiting for them, ended or failed, and the
 * pull request's own state - open, merged or closed - with its link only
 * for a reader of its repository, and what production showed once merged.
 * A task a private record was carried into is there, and nothing more. A
 * secret's issue lists where the secret was seen, read with the reader's
 * own permissions.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-000000000001",
);
const ISSUE_ID: ObjectID = new ObjectID("10367000-0000-4000-8000-0000000000a1");
const TASK_ID: ObjectID = new ObjectID("10367000-0000-4000-8000-0000000000f1");
const REPOSITORY_ID: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-0000000000c1",
);
const STORE_ID: ObjectID = new ObjectID("10367000-0000-4000-8000-0000000000b1");
const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("10367000-0000-4000-8000-0000000000aa"),
};

let issue: Partial<DataSecurityIssue> | null;
let hidden: Set<string>;
let pullRequest: AIAgentTaskPullRequest | undefined;
let state: CodeTaskState;
let readable: Array<CodeRepository>;

function task(): AIRun {
  const run: AIRun = new AIRun(TASK_ID);

  run.codeFixTaskType = CodeFixTaskType.FixSensitiveDataInTelemetry;
  run.codeRepositoryId = REPOSITORY_ID;
  run.taskContext = {
    telemetryLeakFix: {
      serviceId: "10367000-0000-4000-8000-0000000000e1",
      serviceName: "checkout",
      title: "Stop checkout writing sensitive data to its telemetry",
      request: "Stop the service writing its leaks.",
      strategy: TelemetryLeakFixStrategy.CallSites,
      placeCount: 2,
      leaks: [
        {
          issueId: ISSUE_ID.toString(),
          dataStoreId: STORE_ID.toString(),
          checkId: "sensitive-data-in-telemetry",
          signal: TelemetryLeakSignal.Spans,
          dataTypeId: "email-address",
          location: "attributes.user.email",
          handling: "CallSite",
          places: [],
        },
      ],
      issues: [
        { issueId: ISSUE_ID.toString(), signal: TelemetryLeakSignal.Spans },
        {
          issueId: "10367000-0000-4000-8000-0000000000a2",
          signal: TelemetryLeakSignal.Logs,
        },
        {
          issueId: "10367000-0000-4000-8000-0000000000a3",
          signal: TelemetryLeakSignal.Logs,
        },
      ],
      redactionKeys: [],
      redactionDataTypes: [],
      startFiles: [],
      hasSecrets: false,
    },
  } as never;

  return run;
}

function pullRequestRow(
  state: string,
  merged?: boolean,
): AIAgentTaskPullRequest {
  const row: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();

  row.pullRequestState = state as never;
  row.pullRequestNumber = 42;
  row.pullRequestUrl = "https://github.com/acme/checkout/pull/42" as never;
  row.title = "fix: Stop checkout writing sensitive data to its telemetry";

  if (merged) {
    row.productionStatus = FixProductionStatus.Verified;
    row.productionCheck = FixProductionCheck.TelemetryLeak;
    row.productionSummary =
      "Version 2.4.1 wrote no user.email in a day of as much traffic.";
  }

  return row;
}

function repository(): CodeRepository {
  const row: CodeRepository = new CodeRepository(REPOSITORY_ID);

  row.name = "checkout";
  row.organizationName = "acme";
  row.repositoryName = "checkout";

  return row;
}

beforeEach(() => {
  issue = {
    _id: ISSUE_ID.toString(),
    checkId: "sensitive-data-in-telemetry",
    dataStoreId: STORE_ID,
    codeFixTaskId: TASK_ID,
  };
  hidden = new Set();
  pullRequest = undefined;
  state = CodeTaskState.Working;
  readable = [repository()];

  jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async () => {
      if (!issue) {
        return null;
      }

      const row: DataSecurityIssue = new DataSecurityIssue(ISSUE_ID);

      Object.assign(row, issue);

      return row;
    }) as never);
  jest.spyOn(AIRunService, "findOneBy").mockImplementation((async () => {
    return task();
  }) as never);
  jest
    .spyOn(CodeTaskThread, "findTasksHiddenFrom")
    .mockImplementation((async () => {
      return hidden;
    }) as never);
  jest.spyOn(CodeTaskListRows, "readReplies").mockResolvedValue(new Map());
  jest
    .spyOn(CodeTaskListRows, "readPullRequests")
    .mockImplementation((async () => {
      return pullRequest
        ? new Map([[CodeTaskListRows.key(TASK_ID), pullRequest]])
        : new Map();
    }) as never);
  jest.spyOn(CodeTaskStateUtil, "fromRun").mockImplementation(() => {
    return state;
  });
  jest
    .spyOn(CodeTaskAccess, "listReadableRepositories")
    .mockImplementation((async () => {
      return readable;
    }) as never);
  jest
    .spyOn(ProjectDataTypeNames, "read")
    .mockResolvedValue(DataTypeNamer.withoutCustomTypes());
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function read(): Promise<DataSecurityIssueCodeFixResult> {
  return await DataSecurityIssueCodeFix.read({
    projectId: PROJECT_ID,
    issueId: ISSUE_ID,
    props: READER,
  });
}

describe("the issue's fix", () => {
  test("being written: its repository, the service and how many issues it fixes", async () => {
    expect((await read()).fix).toEqual({
      taskId: TASK_ID.toString(),
      recipe: CodeFixTaskType.FixSensitiveDataInTelemetry,
      state: DeclaredCodeChangeState.Writing,
      issueCount: 3,
      repositoryName: "acme/checkout",
      serviceName: "checkout",
    });
  });

  test("each state of its task, as a fix in code beside a remediation step says it", async () => {
    const states: Array<[CodeTaskState, DeclaredCodeChangeState]> = [
      [CodeTaskState.Working, DeclaredCodeChangeState.Writing],
      [CodeTaskState.WaitingForYou, DeclaredCodeChangeState.WaitingForYou],
      [CodeTaskState.Failed, DeclaredCodeChangeState.Failed],
      [CodeTaskState.Stopped, DeclaredCodeChangeState.Failed],
      [CodeTaskState.Done, DeclaredCodeChangeState.Ended],
    ];

    for (const [taskState, shown] of states) {
      state = taskState;
      expect((await read()).fix?.state).toBe(shown);
    }
  });

  test("open: the pull request's own state, its number, and its link", async () => {
    pullRequest = pullRequestRow("open");

    expect((await read()).fix).toEqual(
      expect.objectContaining({
        state: DeclaredCodeChangeState.Opened,
        pullRequest: {
          state: "open",
          number: 42,
          url: "https://github.com/acme/checkout/pull/42",
          title: "fix: Stop checkout writing sensitive data to its telemetry",
        },
      }),
    );
  });

  test("merged: what production showed once it shipped", async () => {
    pullRequest = pullRequestRow("merged", true);

    const shown: DataSecurityIssueCodeFixResult = await read();

    expect(shown.fix?.pullRequest?.state).toBe("merged");
    expect(shown.fix?.pullRequest?.production).toEqual(
      expect.objectContaining({
        status: FixProductionStatus.Verified,
        check: FixProductionCheck.TelemetryLeak,
      }),
    );
  });

  test("the pull request's link and its repository's name go only to a reader of the repository", async () => {
    pullRequest = pullRequestRow("closed");
    readable = [];

    const shown: DataSecurityIssueCodeFixResult = await read();

    expect(shown.fix?.repositoryName).toBeUndefined();
    expect(shown.fix?.pullRequest).toEqual({
      state: "closed",
      number: 42,
      title: "fix: Stop checkout writing sensitive data to its telemetry",
    });
  });

  test("a task a private record was carried into is there, and nothing more", async () => {
    hidden = new Set([TASK_ID.toString().toLowerCase()]);
    pullRequest = pullRequestRow("open");

    expect((await read()).fix).toEqual({
      taskId: "",
      recipe: CodeFixTaskType.FixSensitiveDataInTelemetry,
      state: DeclaredCodeChangeState.Hidden,
      issueCount: 1,
    });
  });

  test("an issue no fix was asked for has none", async () => {
    issue = {
      _id: ISSUE_ID.toString(),
      checkId: "sensitive-data-in-telemetry",
      dataStoreId: STORE_ID,
    };
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);

    expect(await read()).toEqual({ fix: null });
  });

  test("an issue the reader may not read is not found", async () => {
    issue = null;

    await expect(read()).rejects.toThrow(NotFoundException);
  });
});

describe("which task is the issue's fix", () => {
  test("its own, else the newest Fix with AI asked for it, else its group's", async () => {
    expect(
      (
        await DataSecurityIssueCodeFix.findTaskId({
          projectId: PROJECT_ID,
          issue: { _id: ISSUE_ID.toString(), codeFixTaskId: TASK_ID } as never,
        })
      )?.toString(),
    ).toBe(TASK_ID.toString());

    const reply: AIRun = new AIRun(
      new ObjectID("10367000-0000-4000-8000-0000000000f2"),
    );

    reply.codeTaskId = TASK_ID;
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(reply);

    expect(
      (
        await DataSecurityIssueCodeFix.findTaskId({
          projectId: PROJECT_ID,
          issue: { _id: ISSUE_ID.toString() } as never,
        })
      )?.toString(),
    ).toBe(TASK_ID.toString());

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);

    const group: DataSecurityIssueGroup = new DataSecurityIssueGroup();

    group.codeTaskId = new ObjectID("10367000-0000-4000-8000-0000000000f3");
    jest
      .spyOn(DataSecurityIssueGroupService, "findOneBy")
      .mockResolvedValue(group);

    expect(
      (
        await DataSecurityIssueCodeFix.findTaskId({
          projectId: PROJECT_ID,
          issue: {
            _id: ISSUE_ID.toString(),
            dataSecurityIssueGroupId: new ObjectID(
              "10367000-0000-4000-8000-0000000000d9",
            ),
          } as never,
        })
      )?.toString(),
    ).toBe("10367000-0000-4000-8000-0000000000f3");

    expect(
      await DataSecurityIssueCodeFix.findTaskId({
        projectId: PROJECT_ID,
        issue: { _id: ISSUE_ID.toString() } as never,
      }),
    ).toBeNull();
  });
});

describe("a secret's issue", () => {
  function finding(dataTypeId: string, location: string): DataStoreFinding {
    const row: DataStoreFinding = new DataStoreFinding();

    row.dataTypeId = dataTypeId;
    row.location = location;
    row.firstSeenAt = new Date("2026-11-20T10:00:00.000Z");
    row.lastSeenAt = new Date("2026-11-23T10:00:00.000Z");

    return row;
  }

  beforeEach(() => {
    issue = { ...issue, checkId: SECRETS_IN_TELEMETRY_CHECK_ID };

    const store: DataStore = new DataStore(STORE_ID);

    store.name = "payments · Exceptions";
    store.kind = DataStoreKind.TelemetryExceptions;
    jest.spyOn(DataStoreService, "findOneBy").mockResolvedValue(store);
  });

  test("lists where the secret was seen - its secrets only - read with the reader's own permissions", async () => {
    const findings: jest.SpiedFunction<typeof DataStoreFindingService.findBy> =
      jest
        .spyOn(DataStoreFindingService, "findBy")
        .mockResolvedValue([
          finding("aws-access-key-id", "message"),
          finding("email-address", "attributes.user.email"),
        ]);

    const shown: DataSecurityIssueCodeFixResult = await read();

    expect(shown.secretSightings).toEqual([
      {
        dataTypeName:
          DataTypeNamer.withoutCustomTypes().nameOf("aws-access-key-id"),
        location: "message",
        storeName: "payments · Exceptions",
        signal: TelemetryLeakSignal.Exceptions,
        firstSeenAt: "2026-11-20T10:00:00.000Z",
        lastSeenAt: "2026-11-23T10:00:00.000Z",
      },
    ]);
    expect(
      (findings.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toBe(READER);
  });

  test("none for a reader who may not read the store's findings", async () => {
    jest
      .spyOn(DataStoreFindingService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No."));

    expect((await read()).secretSightings).toEqual([]);
  });

  test("an issue of another check lists none", async () => {
    issue = { ...issue, checkId: "sensitive-data-in-telemetry" };

    expect((await read()).secretSightings).toBeUndefined();
  });
});
