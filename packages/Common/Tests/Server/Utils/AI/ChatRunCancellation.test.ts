import ChatRunCancellation, {
  CANCEL_EVENT_SEQUENCE,
  ChatRunCancellationResult,
  STOPPED_BY_USER_TEXT,
} from "../../../../Server/Utils/AI/Chat/ChatRunCancellation";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Stop, shared by the personal Ask AI chat and an incident's shared thread.
 * Every write is guarded on the row's current status so racing the runner
 * is safe, and the terminal event is emitted only by the side that actually
 * took the run.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const CONVERSATION_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();

function install(data: {
  activeRun: AIRun | null;
  runningMatches?: number;
  waitingMatches?: number;
  eventFails?: boolean;
}): {
  runUpdate: jest.SpyInstance;
  messageUpdate: jest.SpyInstance;
  eventCreate: jest.SpyInstance;
} {
  jest
    .spyOn(AIRunService, "findOneBy")
    .mockResolvedValue(data.activeRun as never);

  const runUpdate: jest.SpyInstance = jest
    .spyOn(AIRunService, "updateOneBy")
    .mockImplementation(((args: { query: JSONObject }) => {
      return Promise.resolve(
        args.query["status"] === AIRunStatus.Running
          ? data.runningMatches ?? 1
          : data.waitingMatches ?? 0,
      );
    }) as never);

  const messageUpdate: jest.SpyInstance = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);

  const eventCreate: jest.SpyInstance = jest.spyOn(AIRunEventService, "create");
  if (data.eventFails) {
    eventCreate.mockRejectedValue(new Error("events down") as never);
  } else {
    eventCreate.mockResolvedValue(new AIRunEvent() as never);
  }

  return { runUpdate, messageUpdate, eventCreate };
}

describe("ChatRunCancellation.cancelActiveRun", () => {
  test("returns null when nothing is in flight, touching nothing", async () => {
    const spies: ReturnType<typeof install> = install({ activeRun: null });

    await expect(
      ChatRunCancellation.cancelActiveRun({
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      }),
    ).resolves.toBeNull();

    expect(spies.runUpdate).not.toHaveBeenCalled();
    expect(spies.messageUpdate).not.toHaveBeenCalled();
  });

  test("looks the run up inside this conversation and project only", async () => {
    install({ activeRun: new AIRun(RUN_ID) });

    await ChatRunCancellation.cancelActiveRun({
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    const query: JSONObject = (
      (AIRunService.findOneBy as unknown as jest.SpyInstance).mock
        .calls[0]![0] as { query: JSONObject }
    ).query;
    expect(query["conversationId"]).toBe(CONVERSATION_ID);
    expect(query["projectId"]).toBe(PROJECT_ID);
  });

  test("cancels a running answer, finalizes its message and emits a terminal event", async () => {
    const spies: ReturnType<typeof install> = install({
      activeRun: new AIRun(RUN_ID),
    });

    const result: ChatRunCancellationResult | null =
      await ChatRunCancellation.cancelActiveRun({
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      });

    expect(result).toEqual({ aiRunId: RUN_ID, cancelled: true });

    // Guarded on both in-flight statuses, and never resumable afterwards.
    const guards: Array<unknown> = spies.runUpdate.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { query: JSONObject }).query["status"];
      },
    );
    expect(guards).toEqual([
      AIRunStatus.Running,
      AIRunStatus.WaitingForApproval,
    ]);
    const data: JSONObject = (
      spies.runUpdate.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(data["status"]).toBe(AIRunStatus.Cancelled);
    expect(data["pausedState"]).toBeNull();
    expect(data["errorMessage"]).toBe(STOPPED_BY_USER_TEXT);

    const messageData: JSONObject = (
      spies.messageUpdate.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(messageData["status"]).toBe(AIChatMessageStatus.Cancelled);
    expect(messageData["contentInMarkdown"]).toBe(STOPPED_BY_USER_TEXT);

    const event: AIRunEvent = (
      spies.eventCreate.mock.calls[0]![0] as { data: AIRunEvent }
    ).data;
    expect(event.eventType).toBe(AIRunEventType.RunFailed);
    expect(event.sequence).toBe(CANCEL_EVENT_SEQUENCE);
    expect(event.userId).toBe(USER_ID);
  });

  test("stops an answer paused for approval too", async () => {
    install({
      activeRun: new AIRun(RUN_ID),
      runningMatches: 0,
      waitingMatches: 1,
    });

    await expect(
      ChatRunCancellation.cancelActiveRun({
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      }),
    ).resolves.toEqual({ aiRunId: RUN_ID, cancelled: true });
  });

  test("a run the runner finished in the meantime is left alone, with no terminal event", async () => {
    const spies: ReturnType<typeof install> = install({
      activeRun: new AIRun(RUN_ID),
      runningMatches: 0,
      waitingMatches: 0,
    });

    await expect(
      ChatRunCancellation.cancelActiveRun({
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      }),
    ).resolves.toEqual({ aiRunId: RUN_ID, cancelled: false });

    expect(spies.eventCreate).not.toHaveBeenCalled();
  });

  test("a failed event write never fails the stop", async () => {
    install({ activeRun: new AIRun(RUN_ID), eventFails: true });

    await expect(
      ChatRunCancellation.cancelActiveRun({
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      }),
    ).resolves.toEqual({ aiRunId: RUN_ID, cancelled: true });
  });
});
