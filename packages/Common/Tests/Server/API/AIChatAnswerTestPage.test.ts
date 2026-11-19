import { mockRouter } from "./Helpers";
import "../../../Server/API/AIChatAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AIConversationService from "../../../Server/Services/AIConversationService";
import AIConversationMessageService from "../../../Server/Services/AIConversationMessageService";
import OnCallTestPageService from "../../../Server/Services/OnCallTestPageService";
import UpdateByID from "../../../Server/Types/Database/UpdateByID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIConversation from "../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../Models/DatabaseModels/AIConversationMessage";
import { getAnswerTestPageSent } from "../../../Types/AI/AIChatTestPage";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import {
  AIChatTestPageOffer,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import Permission from "../../../Types/Permission";
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

/*
 * A TEST PAGE SENT FROM AN ANSWER IS KEPT ON THE ANSWER (#7249).
 *
 * POST /ai-chat/message-test-page records the run of a test page sent from
 * an answer's offer on the card that offered it, so the line under the
 * answer still says what became of it after a reload, and the model reads
 * it in the next turn. It holds:
 *
 *   - ownership as message-feedback's: the message and its conversation
 *     resolve under the person's props, and only an answer takes one;
 *   - the run is one the person may read (OnCallTestPageService.getResult,
 *     as them), of the test page the answer offers - that policy's test,
 *     or one to themselves - and nothing is written otherwise;
 *   - what is kept is the run and when it started: the answer's cards are
 *     otherwise as they were.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const CONVERSATION_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const MESSAGE_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const RUN_ID: ObjectID = new ObjectID("72490000-0000-4000-8000-0000000000d1");
const POLICY_ID: string = "72490000-0000-4000-8000-0000000000d2";
const STARTED_AT: string = "2026-11-19T10:15:00.000Z";

const props: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
        },
      ],
    },
  },
} as unknown as DatabaseCommonInteractionProps;

const MONITOR_CARD: AIChatWidget = {
  id: "W1",
  type: AIChatWidgetType.ResourceCard,
  title: "Monitor set up",
  data: { heading: "example.com", testPage: { kind: "self" } },
};

const POLICY_CARD: AIChatWidget = {
  id: "W2",
  type: AIChatWidgetType.ResourceCard,
  title: "On-call policy created",
  data: {
    heading: "Default on-call policy",
    testPage: {
      kind: "policy",
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
    },
  },
};

function answerWith(widgets: Array<AIChatWidget>): AIConversationMessage {
  const message: AIConversationMessage = new AIConversationMessage(MESSAGE_ID);
  message.conversationId = CONVERSATION_ID;
  message.role = AIChatMessageRole.Assistant;
  message.widgets = widgets;
  return message;
}

function policyTest(policyId: string = POLICY_ID): OnCallTestPageResult {
  return {
    executionLogId: RUN_ID.toString(),
    kind: OnCallTestPageKind.Policy,
    policyId: policyId,
    policyName: "Default on-call policy",
    recordKind: OnCallTestPageRecordKind.Incident,
    severityName: "Critical",
    walksEscalation: false,
    status: OnCallTestPageStatus.Paging,
    statusMessage: "",
    startedAt: STARTED_AT,
    endsAt: "2026-11-19T10:45:00.000Z",
    steps: [],
  };
}

async function callRoute(body: JSONObject): Promise<NextFunction> {
  const req: ExpressRequest = { body } as unknown as ExpressRequest;
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter
    .match("post", "/ai-chat/message-test-page")
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return next as unknown as NextFunction;
}

function writtenWidgets(): Array<AIChatWidget> {
  const update: UpdateByID<AIConversationMessage> = (
    AIConversationMessageService.updateOneById as unknown as jest.Mock
  ).mock.calls[0]![0] as UpdateByID<AIConversationMessage>;

  return (update.data as JSONObject)[
    "widgets"
  ] as unknown as Array<AIChatWidget>;
}

describe("POST /ai-chat/message-test-page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(answerWith([MONITOR_CARD, POLICY_CARD]));
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(new AIConversation(CONVERSATION_ID));
    jest
      .spyOn(AIConversationMessageService, "updateOneById")
      .mockResolvedValue(1);
    jest
      .spyOn(OnCallTestPageService, "getResult")
      .mockResolvedValue(policyTest());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps the policy's test on the card that offered it, read as the person", async () => {
    const next: NextFunction = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: RUN_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();

    // The answer and the run are read as the person: the privacy pin, and the test page's own check.
    expect(AIConversationMessageService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ id: MESSAGE_ID, props: props }),
    );
    expect(AIConversationService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONVERSATION_ID, props: props }),
    );
    expect(OnCallTestPageService.getResult).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      executionLogId: RUN_ID,
      props: props,
    });

    const widgets: Array<AIChatWidget> = writtenWidgets();

    expect(widgets[0]).toEqual(MONITOR_CARD);
    expect(widgets[1]!.data.testPage).toEqual({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: "Default on-call policy",
      sent: { executionLogId: RUN_ID.toString(), sentAt: STARTED_AT },
    });
    expect(getAnswerTestPageSent(widgets)).toEqual({
      executionLogId: RUN_ID.toString(),
      sentAt: STARTED_AT,
    });
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2],
    ).toEqual({
      messageId: MESSAGE_ID.toString(),
      testPage: { executionLogId: RUN_ID.toString(), sentAt: STARTED_AT },
    });
  });

  it("keeps a test page to yourself on an answer that offers one", async () => {
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(answerWith([MONITOR_CARD]));
    jest.spyOn(OnCallTestPageService, "getResult").mockResolvedValue({
      ...policyTest(),
      kind: OnCallTestPageKind.Self,
      policyId: undefined,
      steps: [
        {
          id: "s1",
          userId: USER_ID.toString(),
          status: "Paged" as never,
          statusMessage: "",
          deliveries: [],
        },
      ],
    });

    const next: NextFunction = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: RUN_ID.toString(),
    });

    expect(next).not.toHaveBeenCalled();
    expect(
      (writtenWidgets()[0]!.data.testPage as AIChatTestPageOffer).sent,
    ).toEqual({ executionLogId: RUN_ID.toString(), sentAt: STARTED_AT });
  });

  it("refuses another policy's test, and writes nothing", async () => {
    jest
      .spyOn(OnCallTestPageService, "getResult")
      .mockResolvedValue(policyTest("72490000-0000-4000-8000-0000000000d9"));

    const next: NextFunction = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: RUN_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });

  it("refuses a run the person may not read, and writes nothing", async () => {
    jest
      .spyOn(OnCallTestPageService, "getResult")
      .mockRejectedValue(new BadDataException("Test page not found."));

    const next: NextFunction = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: RUN_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });

  it("refuses an answer that offers no test page, before reading the run", async () => {
    jest.spyOn(AIConversationMessageService, "findOneById").mockResolvedValue(
      answerWith([
        {
          id: "W1",
          type: AIChatWidgetType.ResourceCard,
          title: "Incident created",
          data: { heading: "INC-1" },
        },
      ]),
    );

    const next: NextFunction = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: RUN_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(OnCallTestPageService.getResult).not.toHaveBeenCalled();
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });

  it("refuses a message of another person's, or a question, as not found", async () => {
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(null);

    let next: NextFunction = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: RUN_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));

    const question: AIConversationMessage = answerWith([POLICY_CARD]);
    question.role = AIChatMessageRole.User;
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(question);

    next = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: RUN_ID.toString(),
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(OnCallTestPageService.getResult).not.toHaveBeenCalled();
    expect(AIConversationMessageService.updateOneById).not.toHaveBeenCalled();
  });

  it("refuses an id that is not one before any read", async () => {
    const next: NextFunction = await callRoute({
      messageId: MESSAGE_ID.toString(),
      executionLogId: "1 OR 1=1",
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(AIConversationMessageService.findOneById).not.toHaveBeenCalled();
    expect(OnCallTestPageService.getResult).not.toHaveBeenCalled();
  });
});
