jest.mock("../../../../../Server/Utils/Logger", () => {
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

import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import { buildTelemetryLeakFixRequest } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityTelemetryFixPrompt";
import DataSecurityCodeTask, {
  DATA_SECURITY_TELEMETRY_FIX_NO_REPOSITORY_MESSAGE,
  DATA_SECURITY_TELEMETRY_FIX_STARTED_MESSAGE,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import { DataSecurityAiCodeRequest } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { TelemetryLeakFixTaskContext } from "../../../../../Types/AI/CodeFixTaskContext";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityFixResult } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakSignal,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ASKING ONEUPTIME AI FOR A SERVICE'S ONE TELEMETRY FIX (#10367).
 *
 * As the person who asked - the gate, then a repository they may read and
 * ask in - or as OneUptime for an approved proposal made without asking,
 * only in the project's repository it was given. One Code task of its own
 * recipe, carrying the request the builder made and every leak and issue;
 * each issue says on its timeline it was asked - a secret, to be rotated -
 * and keeps the task.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-000000000001",
);
const REPOSITORY_ID: string = "10367000-0000-4000-8000-0000000000c1";
const RUN_ID: ObjectID = new ObjectID("10367000-0000-4000-8000-0000000000f1");
const SPAN_ISSUE: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-0000000000a1",
);
const LOG_ISSUE: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-0000000000a2",
);
const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("10367000-0000-4000-8000-0000000000aa"),
};

const LEAK: TelemetryLeakFixLeak = {
  issueId: SPAN_ISSUE.toString(),
  dataStoreId: "10367000-0000-4000-8000-0000000000b1",
  checkId: "sensitive-data-in-telemetry",
  signal: TelemetryLeakSignal.Spans,
  dataTypeId: "email-address",
  dataTypeName: "Email address",
  isSecret: false,
  location: "attributes.user.email",
  key: "user.email",
  isMaskedByScrubRule: false,
  handling: TelemetryLeakHandling.CallSite,
  places: [{ filePath: "src/signup.js", lineNumber: 10, recordCount: 2 }],
};

function fix(
  data: Partial<TelemetryLeakFixTaskContext> = {},
): Omit<TelemetryLeakFixTaskContext, "request"> {
  return {
    serviceId: "10367000-0000-4000-8000-0000000000e1",
    serviceName: "checkout",
    title: "Stop checkout writing sensitive data to its telemetry",
    strategy: TelemetryLeakFixStrategy.CallSites,
    placeCount: 1,
    leaks: [LEAK],
    issues: [],
    redactionKeys: [],
    redactionDataTypes: [],
    startFiles: ["src/signup.js"],
    hasSecrets: false,
    ...data,
  };
}

function builtRequest(): DataSecurityAiCodeRequest {
  return buildTelemetryLeakFixRequest({
    serviceName: "checkout",
    strategy: TelemetryLeakFixStrategy.CallSites,
    placeCount: 1,
    leaks: [LEAK],
    redactionKeys: [],
    redactionDataTypes: [],
    startFiles: ["src/signup.js"],
  });
}

let queued: SpyInstance<typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun>;
let feed: SpyInstance<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;
let kept: SpyInstance<typeof DataSecurityIssueService.updateBy>;

function repository(): CodeRepository {
  const row: CodeRepository = new CodeRepository(new ObjectID(REPOSITORY_ID));

  row.name = "checkout";

  return row;
}

beforeEach(() => {
  jest.spyOn(CodeTaskGate, "getBlocker").mockResolvedValue(null);
  jest
    .spyOn(CodeTaskAccess, "getReadableRepository")
    .mockResolvedValue(repository());
  jest.spyOn(CodeTaskAccess, "canAskInRepository").mockResolvedValue(true);
  queued = jest
    .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
    .mockResolvedValue(new AIRun(RUN_ID));
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined as never);
  kept = jest
    .spyOn(DataSecurityIssueService, "updateBy")
    .mockResolvedValue(2 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function ask(data: {
  props?: DatabaseCommonInteractionProps;
  fix?: Omit<TelemetryLeakFixTaskContext, "request">;
  repositoryId?: string;
  request?: () => Promise<DataSecurityAiCodeRequest>;
}): Promise<DataSecurityFixResult> {
  return await DataSecurityCodeTask.requestTelemetryLeakFix({
    props: data.props || PERSON,
    projectId: PROJECT_ID,
    issueIds: [SPAN_ISSUE, LOG_ISSUE],
    requestedRepositoryId: data.repositoryId ?? REPOSITORY_ID,
    fix: data.fix || fix(),
    buildMessage:
      data.request ||
      (async (): Promise<DataSecurityAiCodeRequest> => {
        return builtRequest();
      }),
  });
}

describe("a person asks", () => {
  test("one Code task of its own recipe, in the repository they may ask in, carrying the builder's request and every leak", async () => {
    const result: DataSecurityFixResult = await ask({});

    expect(result).toEqual({
      message: DATA_SECURITY_TELEMETRY_FIX_STARTED_MESSAGE,
      aiRunId: RUN_ID.toString(),
    });
    expect(queued).toHaveBeenCalledTimes(1);

    const asked: Parameters<
      typeof SubjectCodeFixRun.enqueueSubjectCodeFixRun
    >[0] = queued.mock.calls[0]![0];

    expect(asked.taskType).toBe(CodeFixTaskType.FixSensitiveDataInTelemetry);
    expect(asked.codeRepositoryId?.toString()).toBe(REPOSITORY_ID);
    expect(asked.userId?.toString()).toBe(PERSON.userId!.toString());

    const context: TelemetryLeakFixTaskContext = (
      asked.taskContext as { telemetryLeakFix: TelemetryLeakFixTaskContext }
    ).telemetryLeakFix;

    expect(context.request).toBe(builtRequest().text);
    expect(context.leaks).toEqual([LEAK]);
  });

  test("each issue says on its timeline it was asked, for itself and the service's others, and keeps the task", async () => {
    await ask({});

    expect(
      feed.mock.calls.map((call: Array<unknown>): string => {
        return (
          call[0] as { dataSecurityIssueId: ObjectID }
        ).dataSecurityIssueId.toString();
      }),
    ).toEqual([SPAN_ISSUE.toString(), LOG_ISSUE.toString()]);
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("for this issue and 1 more of the service's");
    expect(kept).toHaveBeenCalledTimes(1);
    expect(
      (
        kept.mock.calls[0]![0] as unknown as {
          data: { codeFixTaskId: ObjectID };
        }
      ).data.codeFixTaskId.toString(),
    ).toBe(RUN_ID.toString());
  });

  test("a secret among the leaks: each issue says to rotate it", async () => {
    await ask({ fix: fix({ hasSecrets: true }) });

    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("Rotate the secret too");
  });

  test("what stands in the way is said, and nothing is asked", async () => {
    jest.spyOn(CodeTaskGate, "getBlocker").mockResolvedValue({
      message: "No Runner is online.",
    } as never);

    expect(await ask({})).toEqual({ message: "No Runner is online." });
    expect(queued).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("a request the input builder did not make is refused", async () => {
    await expect(
      ask({
        request: async (): Promise<DataSecurityAiCodeRequest> => {
          return { text: "Fix it." } as unknown as DataSecurityAiCodeRequest;
        },
      }),
    ).rejects.toThrow(BadDataException);
    expect(queued).not.toHaveBeenCalled();
  });
});

describe("OneUptime asks, for a proposal approved without asking", () => {
  test("only in the project's repository it was given", async () => {
    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockResolvedValue(repository());

    const result: DataSecurityFixResult = await ask({
      props: { isRoot: true },
    });

    expect(result.aiRunId).toBe(RUN_ID.toString());
    expect(queued.mock.calls[0]![0].userId).toBeUndefined();
  });

  test("with no repository of the project's, nothing is asked, and it says why", async () => {
    jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue(null);

    expect(await ask({ props: { isRoot: true }, repositoryId: "" })).toEqual({
      message: DATA_SECURITY_TELEMETRY_FIX_NO_REPOSITORY_MESSAGE,
    });
    expect(queued).not.toHaveBeenCalled();
  });

  test("for a security case's playbook (#10740), the task is kept on the case; asked otherwise, it names none", async () => {
    const caseId: ObjectID = new ObjectID(
      "10740000-0000-4000-8000-0000000000ca",
    );

    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockResolvedValue(repository());

    await DataSecurityCodeTask.requestTelemetryLeakFix({
      props: { isRoot: true },
      projectId: PROJECT_ID,
      issueIds: [SPAN_ISSUE],
      requestedRepositoryId: REPOSITORY_ID,
      fix: fix(),
      triggeredBySecurityCaseId: caseId,
      buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
        return builtRequest();
      },
    });
    await ask({ props: { isRoot: true } });

    expect(queued.mock.calls[0]![0].triggeredBySecurityCaseId).toEqual(caseId);
    expect(queued.mock.calls[0]![0].userId).toBeUndefined();
    expect(queued.mock.calls[1]![0]).not.toHaveProperty(
      "triggeredBySecurityCaseId",
    );
  });
});
