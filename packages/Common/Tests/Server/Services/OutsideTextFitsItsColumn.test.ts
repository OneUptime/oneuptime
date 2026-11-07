import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import RumSessionErasureRequestService from "../../../Server/Services/RumSessionErasureRequestService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import CodeTaskLive from "../../../Server/Utils/AI/CodeTask/CodeTaskLive";
import logger from "../../../Server/Utils/Logger";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { RumSessionErasureRequestStatus } from "../../../Models/DatabaseModels/RumSessionErasureRequest";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What someone else said, kept where it fits.
 *
 * A Runner's report of a git failure overflowed AIRun.errorMessage
 * (varchar(500)) and left the run Running (issue #6144). The same kind of
 * text - an error a database, an agent, a cluster or a Runner wrote - went
 * unclamped into other short columns, and each refusal lost more than the
 * text:
 *
 *   - a remediation's verification note, written by a raw UPDATE that each
 *     sweep repeated: the verification stayed Pending for ever;
 *   - a session-replay erasure request's failure reason, refused inside the
 *     job's catch: the request never counted the attempt, and was never
 *     marked Failed;
 *   - a cluster's or a resource's AI access "last error", cut to 2000 for a
 *     column that takes 500: the page kept the error before it;
 *   - an AI run event's tool name, from the Runner's log line: the step was
 *     dropped.
 *
 * Each is now held to its column.
 */

const LONG_ERROR: string = `ClickHouse error: ${"Code: 241. DB::Exception: Memory limit (total) exceeded. ".repeat(40)}`;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a remediation's verification note", () => {
  function mockUpdateQueryBuilder(): { set: Record<string, unknown> | null } {
    const recorded: { set: Record<string, unknown> | null } = { set: null };

    const builder: Record<string, unknown> = {
      update: () => {
        return builder;
      },
      set: (values: Record<string, unknown>) => {
        recorded.set = values;
        return builder;
      },
      where: () => {
        return builder;
      },
      andWhere: () => {
        return builder;
      },
      execute: async () => {
        return { affected: 1 };
      },
    };

    jest
      .spyOn(AutoRemediationSuggestionService, "getRepository")
      .mockReturnValue({
        createQueryBuilder: () => {
          return builder;
        },
      } as never);

    return recorded;
  }

  test("is held to its column by the verification's own transition, and the verification still settles", async () => {
    const recorded: { set: Record<string, unknown> | null } =
      mockUpdateQueryBuilder();
    const completedAt: Date = new Date();
    const note: string = `Argo CD put the change back: ${"kubectl -n checkout set resources deployment/checkout-api --limits=memory=1Gi ".repeat(10)}`;
    const set: {
      verificationStatus: AutoRemediationVerificationStatus;
      verificationCompletedAt: Date;
      verificationNote: string;
    } = {
      verificationStatus: AutoRemediationVerificationStatus.Failed,
      verificationCompletedAt: completedAt,
      verificationNote: note,
    };

    const changed: number =
      await AutoRemediationSuggestionService.attemptVerificationTransition({
        suggestionId: ObjectID.generate(),
        fromVerificationStatus: AutoRemediationVerificationStatus.Pending,
        set,
      });

    expect(changed).toBe(1);
    expect(recorded.set!["verificationStatus"]).toBe(
      AutoRemediationVerificationStatus.Failed,
    );
    expect(recorded.set!["verificationCompletedAt"]).toBe(completedAt);
    expect((recorded.set!["verificationNote"] as string).length).toBe(
      ColumnLength.LongText,
    );
    expect(note.startsWith(recorded.set!["verificationNote"] as string)).toBe(
      true,
    );
    // The caller's own values are left as they were.
    expect(set.verificationNote).toBe(note);
  });

  test("a note that fits is written whole", async () => {
    const recorded: { set: Record<string, unknown> | null } =
      mockUpdateQueryBuilder();

    await AutoRemediationSuggestionService.attemptVerificationTransition({
      suggestionId: ObjectID.generate(),
      fromVerificationStatus: AutoRemediationVerificationStatus.Pending,
      set: {
        verificationStatus: AutoRemediationVerificationStatus.Verified,
        verificationNote: "The monitor recovered.",
      },
    });

    expect(recorded.set!["verificationNote"]).toBe("The monitor recovered.");
  });
});

describe("a session-replay erasure request's failure reason", () => {
  test("markFailed holds it to its column", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(RumSessionErasureRequestService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await RumSessionErasureRequestService.markFailed({
      requestId: ObjectID.generate(),
      failureReason: LONG_ERROR,
    });

    const data: Record<string, unknown> = (
      update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(data["status"]).toBe(RumSessionErasureRequestStatus.Failed);
    expect((data["failureReason"] as string).length).toBe(
      ColumnLength.LongText,
    );
    expect(LONG_ERROR.startsWith(data["failureReason"] as string)).toBe(true);
  });

  test("a reason that fits is kept whole", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(RumSessionErasureRequestService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await RumSessionErasureRequestService.markFailed({
      requestId: ObjectID.generate(),
      failureReason: "Redis is not reachable.",
    });

    expect(
      (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data[
        "failureReason"
      ],
    ).toBe("Redis is not reachable.");
  });
});

describe("the AI access 'last error' of a cluster or a resource", () => {
  test("a cluster's is held to its column, not to 2000", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(KubernetesClusterService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await KubernetesClusterAiAccessService.recordCommandOutcome({
      clusterId: ObjectID.generate(),
      succeeded: false,
      errorMessage: LONG_ERROR,
    });

    const data: Record<string, unknown> = (
      update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect((data["aiAccessLastError"] as string).length).toBe(
      ColumnLength.LongText,
    );
  });

  test("a resource's is held to its column, not to 2000", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(DockerHostService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await ResourceAiAccessService.recordCommandOutcome({
      resourceType: AiResourceType.DockerHost,
      resourceId: ObjectID.generate(),
      succeeded: false,
      errorMessage: LONG_ERROR,
    });

    const data: Record<string, unknown> = (
      update.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect((data["aiAccessLastError"] as string).length).toBe(
      ColumnLength.LongText,
    );
  });

  test("a short error, or none, is kept as it was", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(KubernetesClusterService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await KubernetesClusterAiAccessService.recordCommandOutcome({
      clusterId: ObjectID.generate(),
      succeeded: false,
      errorMessage: "forbidden: User cannot list pods",
    });
    await KubernetesClusterAiAccessService.recordCommandOutcome({
      clusterId: ObjectID.generate(),
      succeeded: false,
    });

    expect(
      (update.mock.calls[0]![0] as { data: Record<string, unknown> }).data[
        "aiAccessLastError"
      ],
    ).toBe("forbidden: User cannot list pods");
    expect(
      (update.mock.calls[1]![0] as { data: Record<string, unknown> }).data[
        "aiAccessLastError"
      ],
    ).toBe("Command failed.");
  });
});

describe("an AI run event's tool name", () => {
  test("a Runner's tool name longer than its column is cut, and the step is kept", async () => {
    const created: Array<AIRunEvent> = [];

    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (createBy: CreateBy<AIRunEvent>) => {
        created.push(createBy.data);
        return createBy.data;
      });
    jest.spyOn(CodeTaskLive, "announce").mockResolvedValue(undefined as never);
    const errors: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        // Asserted below.
      });

    await AIRunEventService.appendEventToRun({
      projectId: ObjectID.generate(),
      aiRunId: ObjectID.generate(),
      eventType: AIRunEventType.ProgressLog,
      toolName: `run_command_${"x".repeat(300)}`,
      resultSummary: { message: "Ran the tests." },
    });

    expect(errors).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]!.toolName!.length).toBe(ColumnLength.ShortText);
    expect(created[0]!.toolName!.startsWith("run_command_")).toBe(true);
  });

  test("an ordinary tool name is kept whole", async () => {
    const created: Array<AIRunEvent> = [];

    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (createBy: CreateBy<AIRunEvent>) => {
        created.push(createBy.data);
        return createBy.data;
      });
    jest.spyOn(CodeTaskLive, "announce").mockResolvedValue(undefined as never);

    await AIRunEventService.appendEventToRun({
      projectId: ObjectID.generate(),
      aiRunId: ObjectID.generate(),
      eventType: AIRunEventType.ProgressLog,
      toolName: "write_file",
    });

    expect(created[0]!.toolName).toBe("write_file");
  });
});
