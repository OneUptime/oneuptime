import { mockRouter } from "./Helpers";
import "../../../Server/API/AIChatAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIConversationService from "../../../Server/Services/AIConversationService";
import AIConversationMessageService from "../../../Server/Services/AIConversationMessageService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import UpdateOneBy from "../../../Server/Types/Database/UpdateOneBy";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIConversation from "../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage, {
  AIConversationMessageFeedback,
} from "../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const CONVERSATION_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RUN_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const MESSAGE_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);

const props: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

function requestFor(body: JSONObject): ExpressRequest {
  return {
    body,
  } as unknown as ExpressRequest;
}

function response(): ExpressResponse {
  return {} as ExpressResponse;
}

function sentPayload(): JSONObject {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as JSONObject;
}

function activeChatRun(status: AIRunStatus): AIRun {
  const run: AIRun = new AIRun(RUN_ID);
  run.status = status;
  return run;
}

function assistantMessage(): AIConversationMessage {
  const message: AIConversationMessage = new AIConversationMessage(MESSAGE_ID);
  message.conversationId = CONVERSATION_ID;
  message.role = AIChatMessageRole.Assistant;
  return message;
}

async function callCancelRoute(body?: JSONObject): Promise<NextFunction> {
  const req: ExpressRequest = requestFor(
    body || { conversationId: CONVERSATION_ID.toString() },
  );
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter
    .match("post", "/ai-chat/cancel-run")
    .handlerFunction(req, response(), next as unknown as NextFunction);

  return next as unknown as NextFunction;
}

async function callFeedbackRoute(body: JSONObject): Promise<NextFunction> {
  const req: ExpressRequest = requestFor(body);
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter
    .match("post", "/ai-chat/message-feedback")
    .handlerFunction(req, response(), next as unknown as NextFunction);

  return next as unknown as NextFunction;
}

describe("POST /ai-chat/cancel-run", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(new AIConversation(CONVERSATION_ID));
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(activeChatRun(AIRunStatus.Running));

    /*
     * The status-guarded run flip: only the Running-guard matches (the run
     * really is Running), the WaitingForApproval-guard matches zero rows —
     * exactly what the database would report.
     */
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockImplementation((update: UpdateOneBy<AIRun>) => {
        return Promise.resolve(
          (update.query as JSONObject)["status"] === AIRunStatus.Running
            ? 1
            : 0,
        );
      });
    jest
      .spyOn(AIConversationMessageService, "updateOneBy")
      .mockResolvedValue(1);
    jest.spyOn(AIRunEventService, "create").mockResolvedValue(new AIRunEvent());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("cancels the active run, finalizes the message and emits a terminal event", async () => {
    const next: NextFunction = await callCancelRoute();

    expect(next).not.toHaveBeenCalled();

    /*
     * The active-run lookup is tenant-scoped and only matches live statuses.
     * QueryHelper.any builds a Raw FindOperator with a RANDOM parameter name,
     * so it cannot be compared structurally — assert on the operator's
     * parameter values instead.
     */
    expect(AIRunService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          conversationId: CONVERSATION_ID,
          projectId: PROJECT_ID,
        }),
      }),
    );

    const findRunQuery: JSONObject = (
      (AIRunService.findOneBy as unknown as jest.Mock).mock
        .calls[0]![0] as JSONObject
    )["query"] as JSONObject;
    const statusOperatorParameters: Array<unknown> = Object.values(
      (
        findRunQuery["status"] as {
          _objectLiteralParameters?: Record<string, unknown>;
        }
      )._objectLiteralParameters || {},
    );
    expect(statusOperatorParameters).toEqual([
      [AIRunStatus.Running, AIRunStatus.WaitingForApproval],
    ]);

    // The run flip is guarded on the run still being in flight.
    expect(AIRunService.updateOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: RUN_ID.toString(), status: AIRunStatus.Running },
        data: expect.objectContaining({
          status: AIRunStatus.Cancelled,
          errorMessage: "Stopped by user.",
          pausedState: null,
        }),
      }),
    );

    // The message finalization is guarded on both in-flight statuses.
    for (const inFlightStatus of [
      AIChatMessageStatus.InProgress,
      AIChatMessageStatus.WaitingForApproval,
    ]) {
      expect(AIConversationMessageService.updateOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { aiRunId: RUN_ID, status: inFlightStatus },
          data: expect.objectContaining({
            status: AIChatMessageStatus.Cancelled,
            contentInMarkdown: "Stopped by user.",
          }),
        }),
      );
    }

    // Terminal closure event for the polling UI.
    expect(AIRunEventService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          userId: USER_ID,
          eventType: AIRunEventType.RunFailed,
          resultSummary: { errorMessage: "Stopped by user." },
        }),
      }),
    );

    expect(sentPayload()).toEqual({
      conversationId: CONVERSATION_ID.toString(),
      aiRunId: RUN_ID.toString(),
      cancelled: true,
    });
  });

  it("rejects when the conversation has no active run — a finished run is never touched", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);

    const next: NextFunction = await callCancelRoute();

    expect(next).toHaveBeenCalledWith(
      new BadDataException(
        "No response is being generated in this conversation.",
      ),
    );
    expect(AIRunService.updateOneBy).not.toHaveBeenCalled();
    expect(AIConversationMessageService.updateOneBy).not.toHaveBeenCalled();
    expect(AIRunEventService.create).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("reports cancelled: false and emits no event when the runner finalized first", async () => {
    // Both status guards match zero rows: the run completed in the race window.
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(0);

    const next: NextFunction = await callCancelRoute();

    expect(next).not.toHaveBeenCalled();

    /*
     * Every write stays status-guarded, so the completed run and its
     * completed message are untouched even though the writes were attempted.
     */
    const runUpdateCalls: Array<Array<unknown>> = (
      AIRunService.updateOneBy as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;
    for (const call of runUpdateCalls) {
      const query: JSONObject = (call[0] as UpdateOneBy<AIRun>)
        .query as JSONObject;
      expect([AIRunStatus.Running, AIRunStatus.WaitingForApproval]).toContain(
        query["status"],
      );
    }

    expect(AIRunEventService.create).not.toHaveBeenCalled();
    expect(sentPayload()).toEqual(
      expect.objectContaining({ cancelled: false }),
    );
  });

  it("rejects another user's conversation before reading any run", async () => {
    // The privacy pin returns null for a conversation this user does not own.
    jest.spyOn(AIConversationService, "findOneById").mockResolvedValue(null);

    const next: NextFunction = await callCancelRoute();

    expect(next).toHaveBeenCalledWith(
      new BadDataException("Conversation not found."),
    );
    expect(AIRunService.findOneBy).not.toHaveBeenCalled();
    expect(AIRunService.updateOneBy).not.toHaveBeenCalled();
    expect(AIConversationMessageService.updateOneBy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("requires a conversationId", async () => {
    const next: NextFunction = await callCancelRoute({});

    expect(next).toHaveBeenCalledWith(
      new BadDataException("conversationId is required."),
    );
    expect(AIConversationService.findOneById).not.toHaveBeenCalled();
    expect(AIRunService.updateOneBy).not.toHaveBeenCalled();
  });
});

describe("POST /ai-chat/message-feedback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(assistantMessage());
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(new AIConversation(CONVERSATION_ID));
    jest
      .spyOn(AIConversationMessageService, "updateOneById")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("stores thumbs-up feedback on an assistant message the user owns", async () => {
    const next: NextFunction = await callFeedbackRoute({
      messageId: MESSAGE_ID.toString(),
      feedback: "Up",
    });

    expect(next).not.toHaveBeenCalled();

    // The message is read under the USER's props: the privacy pin applies.
    expect(AIConversationMessageService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ props: props }),
    );

    expect(AIConversationMessageService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MESSAGE_ID,
        data: { userFeedback: AIConversationMessageFeedback.Up },
      }),
    );
    expect(sentPayload()).toEqual({
      messageId: MESSAGE_ID.toString(),
      feedback: AIConversationMessageFeedback.Up,
    });
  });

  it("clears feedback when null is sent", async () => {
    const next: NextFunction = await callFeedbackRoute({
      messageId: MESSAGE_ID.toString(),
      feedback: null,
    });

    expect(next).not.toHaveBeenCalled();
    expect(AIConversationMessageService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MESSAGE_ID,
        data: { userFeedback: null },
      }),
    );
    expect(sentPayload()).toEqual({
      messageId: MESSAGE_ID.toString(),
      feedback: null,
    });
  });

  it("rejects an invalid feedback value before any read", async () => {
    const next: NextFunction = await callFeedbackRoute({
      messageId: MESSAGE_ID.toString(),
      feedback: "Sideways",
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(AIConversationMessageService.findOneById).not.toHaveBeenCalled();
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });

  it("rejects feedback on a user-role message", async () => {
    const userMessage: AIConversationMessage = assistantMessage();
    userMessage.role = AIChatMessageRole.User;
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(userMessage);

    const next: NextFunction = await callFeedbackRoute({
      messageId: MESSAGE_ID.toString(),
      feedback: "Down",
    });

    expect(next).toHaveBeenCalledWith(
      new BadDataException("Feedback can only be left on assistant messages."),
    );
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });

  it("rejects a message the privacy pin hides (another user's row)", async () => {
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(null);

    const next: NextFunction = await callFeedbackRoute({
      messageId: MESSAGE_ID.toString(),
      feedback: "Up",
    });

    expect(next).toHaveBeenCalledWith(
      new BadDataException("Message not found."),
    );
    expect(AIConversationService.findOneById).not.toHaveBeenCalled();
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });

  it("rejects a message whose conversation does not resolve for this user", async () => {
    jest.spyOn(AIConversationService, "findOneById").mockResolvedValue(null);

    const next: NextFunction = await callFeedbackRoute({
      messageId: MESSAGE_ID.toString(),
      feedback: "Up",
    });

    expect(next).toHaveBeenCalledWith(
      new BadDataException("Message not found."),
    );
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });
});
