import SlackAPI from "../../../../Server/API/SlackAPI";
import AIService from "../../../../Server/Services/AIService";
import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsConnectPrompt from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsConnectPrompt";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
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
 * ISSUE #11082, WHERE SLACK AND MICROSOFT TEAMS ASK ONEUPTIME AI: each asks
 * for the project's external MCP servers (offersExternalMcpServers), for
 * the person who asked there - the OneUptime account their chat account is
 * linked to, with that account's own permissions in the project
 * (WorkspaceActionAuthorization.getProjectMemberProps), as every answer
 * there is read. That is how a chat user maps to a OneUptime user, as the
 * chat apps already did: a chat account linked to nobody is asked to link
 * it, and a linked account whose user left the project is told so - and
 * neither is answered, so neither reaches a server. Which tools the answer
 * then gets, and that someone who may not read the servers gets none, is
 * ChatMcpAccess's (ChatMcpAccess.test.ts, ObservabilityAssistantMcpServers).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11082000-0000-4000-8000-0000000000a1",
);
const USER_ID: ObjectID = new ObjectID("11082000-0000-4000-8000-0000000000a2");

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

function result(): ObservabilityAssistantResult {
  return {
    contentInMarkdown: "checkout-7f9 was OOMKilled.",
    citations: [],
    totalTokens: 10,
    llmCallCount: 1,
    toolCallCount: 0,
  };
}

let answerQuestion: SpyInstance<typeof ObservabilityAssistant.answerQuestion>;

beforeEach(() => {
  answerQuestion = jest
    .spyOn(ObservabilityAssistant, "answerQuestion")
    .mockResolvedValue(result());
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function askedWith(): ObservabilityAssistantRequest {
  expect(answerQuestion).toHaveBeenCalledTimes(1);
  return answerQuestion.mock.calls[0]![0];
}

async function askSlack(): Promise<string> {
  return await (
    SlackAPI as unknown as {
      getAiOpsAnswerMarkdown: (data: {
        projectId: ObjectID;
        userId: ObjectID;
        question: string;
      }) => Promise<string>;
    }
  ).getAiOpsAnswerMarkdown({
    projectId: PROJECT_ID,
    userId: USER_ID,
    question: "Use the Kubernetes server's k8s_get_resources on pods.",
  });
}

function stubTeamsAnswer(): void {
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockResolvedValue(null as never);
  jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        getConversationHistoryTurns: () => Promise<Array<JSONObject>>;
      },
      "getConversationHistoryTurns",
    )
    .mockResolvedValue([]);
}

async function askTeams(): Promise<Array<unknown>> {
  const sent: Array<unknown> = [];

  await (
    MicrosoftTeamsUtil as unknown as {
      answerObservabilityQuestion: (data: {
        activity: JSONObject;
        turnContext: unknown;
        projectId: ObjectID;
        question: string;
      }) => Promise<void>;
    }
  ).answerObservabilityQuestion({
    activity: { from: { aadObjectId: "aad-user-1" } },
    turnContext: {
      sendActivity: async (activity: unknown): Promise<void> => {
        sent.push(activity);
      },
    },
    projectId: PROJECT_ID,
    question: "Use the Kubernetes server's k8s_get_resources on pods.",
  });

  return sent;
}

describe("Slack", () => {
  test("asks for the project's MCP servers, for the linked account's own permissions", async () => {
    const getProps: SpyInstance<
      typeof WorkspaceActionAuthorization.getProjectMemberProps
    > = jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(MEMBER_PROPS as never);

    await askSlack();

    const request: ObservabilityAssistantRequest = askedWith();
    expect(request.offersExternalMcpServers).toBe(true);
    expect(request.props).toBe(MEMBER_PROPS);
    expect(request.chatApp?.name).toBe("Slack");
    expect(getProps.mock.calls[0]![0]).toEqual({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });

  test("a linked account whose user has left the project is told so, and never reaches a server", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You are no longer a member of this project.",
        ),
      );

    const answer: string = await askSlack();

    expect(answer).toBe("You are no longer a member of this project.");
    expect(answerQuestion).not.toHaveBeenCalled();
  });
});

describe("Microsoft Teams", () => {
  test("asks for the project's MCP servers, for the linked account's own permissions", async () => {
    stubTeamsAnswer();
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(USER_ID);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(MEMBER_PROPS as never);

    await askTeams();

    const request: ObservabilityAssistantRequest = askedWith();
    expect(request.offersExternalMcpServers).toBe(true);
    expect(request.props).toBe(MEMBER_PROPS);
    expect(request.chatApp?.name).toBe("Microsoft Teams");
  });

  test("a Teams account linked to nobody is asked to link it, and never reaches a server", async () => {
    stubTeamsAnswer();
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException(
          "Your Microsoft Teams account is not connected to OneUptime.",
        ),
      );
    const prompt: SpyInstance<typeof MicrosoftTeamsConnectPrompt.promptOnce> =
      jest
        .spyOn(MicrosoftTeamsConnectPrompt, "promptOnce")
        .mockResolvedValue(true);

    await askTeams();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  test("a linked account whose user has left the project is told so, and never reaches a server", async () => {
    stubTeamsAnswer();
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(USER_ID);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You are no longer a member of this project.",
        ),
      );

    const sent: Array<unknown> = await askTeams();

    expect(String(sent[sent.length - 1])).toContain(
      "You are no longer a member of this project.",
    );
    expect(answerQuestion).not.toHaveBeenCalled();
  });
});
