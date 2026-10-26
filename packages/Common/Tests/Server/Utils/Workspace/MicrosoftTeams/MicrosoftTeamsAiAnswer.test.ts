import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An answer from OneUptime AI in Microsoft Teams (MicrosoftTeamsAiAnswer).
 * Microsoft's store refused the app (policy 1140.4.1.24) until it said what
 * its AI does: an app whose content AI writes must say so where the content
 * is shown, ask its reader to check it, and let them report it to the
 * developer. These pin each answer's label, its line and its buttons, and
 * what a 👍 or 👎 sent with those buttons reaches.
 */

const mockEnvironment: { aiFeedbackWebhook: string } = {
  aiFeedbackWebhook: "https://hooks.slack.test/ai-feedback",
};

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };

  // Live, so a test can unset it.
  Object.defineProperty(mocked, "NotificationSlackWebhookOnAiFeedback", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockEnvironment.aiFeedbackWebhook;
    },
  });

  return mocked;
});

import MicrosoftTeamsAiAnswer, {
  MicrosoftTeamsAiAnswerFeedback,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsAiAnswer";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import OperatorSlackNotice, {
  AiAnswerFeedbackReaction,
} from "../../../../../Server/Utils/OperatorSlackNotice";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import ProjectService from "../../../../../Server/Services/ProjectService";
import logger from "../../../../../Server/Utils/Logger";
import Project from "../../../../../Models/DatabaseModels/Project";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000001",
);

// A feedback invoke, as Teams sends one when 👍 or 👎 is submitted.
function feedbackInvoke(data?: {
  reaction?: unknown;
  feedback?: unknown;
  name?: string;
  actionName?: string;
  omitTenant?: boolean;
}): JSONObject {
  return {
    type: "invoke",
    name: data?.name || "message/submitAction",
    id: "f:feedback-1",
    replyToId: "1761400000000",
    value: {
      actionName: data?.actionName || "feedback",
      actionValue: {
        // What Teams sends may be anything: a test hands over what it likes.
        reaction: (data && "reaction" in data
          ? data.reaction
          : "dislike") as JSONValue,
        feedback: (data && "feedback" in data
          ? data.feedback
          : JSON.stringify({
              feedbackText: "It named a monitor we do not have.",
            })) as JSONValue,
      },
    },
    from: { id: "29:alice", name: "Alice Doe", aadObjectId: "aad-alice" },
    conversation: {
      conversationType: "channel",
      id: "19:ops@thread.tacv2;messageid=1761400000000",
      tenantId: "tenant-from-conversation",
    },
    channelData: data?.omitTenant ? {} : { tenant: { id: "tenant-1" } },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  mockEnvironment.aiFeedbackWebhook = "https://hooks.slack.test/ai-feedback";
});

describe("each answer says it is AI's, and carries Teams' AI label and feedback buttons", () => {
  test("the activity: its text, the AIGeneratedContent message entity, and the default feedback buttons", () => {
    expect(MicrosoftTeamsAiAnswer.toActivity("Two monitors are down.")).toEqual(
      {
        type: "message",
        text: "Two monitors are down.",
        entities: [
          {
            type: "https://schema.org/Message",
            "@type": "Message",
            "@context": "https://schema.org",
            additionalType: ["AIGeneratedContent"],
          },
        ],
        channelData: {
          feedbackLoop: { type: "default" },
        },
      },
    );
  });

  test("each activity has its own entity: changing one answer's never changes the next one's", () => {
    const first: JSONObject = MicrosoftTeamsAiAnswer.toActivity(
      "one",
    ) as unknown as JSONObject;
    (
      (first["entities"] as Array<JSONObject>)[0]![
        "additionalType"
      ] as Array<string>
    ).push("Other");

    expect(
      (
        (MicrosoftTeamsAiAnswer.toActivity("two") as unknown as JSONObject)[
          "entities"
        ] as Array<JSONObject>
      )[0]!["additionalType"],
    ).toEqual(["AIGeneratedContent"]);
  });

  test("the line under every answer: AI wrote it, check it, and report it with 👎 - in the installation's name", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    expect(MicrosoftTeamsAiAnswer.getNotice().toString()).toBe(
      "_Written by Acme Ops AI, which can make mistakes: check important details before you act on them. Use 👎 to report an answer that is wrong or inappropriate._",
    );
  });
});

describe("reading a 👍 or 👎", () => {
  test("Teams' feedback invoke is feedback; a card's button, or another invoke, is not", () => {
    expect(MicrosoftTeamsAiAnswer.isFeedback(feedbackInvoke())).toBe(true);
    expect(
      MicrosoftTeamsAiAnswer.isFeedback(
        feedbackInvoke({ name: "adaptiveCard/action" }),
      ),
    ).toBe(false);
    expect(
      MicrosoftTeamsAiAnswer.isFeedback(
        feedbackInvoke({ actionName: "something-else" }),
      ),
    ).toBe(false);
    expect(
      MicrosoftTeamsAiAnswer.isFeedback({
        type: "message",
        name: "message/submitAction",
        value: { actionName: "feedback" },
      }),
    ).toBe(false);
    expect(MicrosoftTeamsAiAnswer.isFeedback({ type: "invoke" })).toBe(false);
  });

  test("what it says: the reaction, what was written, the answer it is about, and where", () => {
    expect(MicrosoftTeamsAiAnswer.readFeedback(feedbackInvoke())).toEqual({
      reaction: AiAnswerFeedbackReaction.Dislike,
      text: "It named a monitor we do not have.",
      messageId: "1761400000000",
      conversationType: "channel",
      tenantId: "tenant-1",
      userName: "Alice Doe",
    } as MicrosoftTeamsAiAnswerFeedback);
  });

  test.each([
    [
      "a JSON string, as Teams sends it",
      JSON.stringify({ feedbackText: "  Helpful  " }),
      "Helpful",
    ],
    ["the text itself", "  Wrong service named  ", "Wrong service named"],
    ["an object", { feedbackText: "From an object" }, "From an object"],
    ["JSON without the text", JSON.stringify({ other: "x" }), ""],
    ["nothing", undefined, ""],
    ["a number", 42, ""],
  ])(
    "what was written, as %s",
    (_label: string, feedback: unknown, text: string) => {
      expect(
        MicrosoftTeamsAiAnswer.readFeedback(
          feedbackInvoke({ reaction: "like", feedback: feedback }),
        )?.text,
      ).toBe(text);
    },
  );

  test("a novel written in the box is cut to 4,000 characters", () => {
    const written: string = "a".repeat(100000);

    expect(
      MicrosoftTeamsAiAnswer.readFeedback(
        feedbackInvoke({ feedback: JSON.stringify({ feedbackText: written }) }),
      )?.text.length,
    ).toBeLessThanOrEqual(4000);
    expect(
      MicrosoftTeamsAiAnswer.readFeedback(feedbackInvoke({ feedback: written }))
        ?.text.length,
    ).toBe(4000);
  });

  test.each([["love"], [""], [null], [undefined], [1]])(
    "a reaction Teams does not send (%p) is no feedback",
    (reaction: unknown) => {
      expect(
        MicrosoftTeamsAiAnswer.readFeedback(feedbackInvoke({ reaction })),
      ).toBeNull();
    },
  );

  test("an invoke without channelData's tenant is read by the conversation's", () => {
    expect(
      MicrosoftTeamsAiAnswer.readFeedback(feedbackInvoke({ omitTenant: true }))
        ?.tenantId,
    ).toBe("tenant-from-conversation");
  });
});

describe("handleFeedback: the operator is told, on Slack", () => {
  let post: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    post = jest
      .spyOn(OperatorSlackNotice, "post")
      .mockResolvedValue(undefined as never);
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined as never;
    });
  });

  function stubProject(project: Project | null): void {
    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: project
          ? ({ projectId: PROJECT_ID } as unknown as WorkspaceProjectAuthToken)
          : null,
        isAmbiguous: false,
        candidateProjectIds: project ? [PROJECT_ID] : [],
      } as MicrosoftTeamsTenantResolution);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project as never);
  }

  test("a 👎 names the project, where it was, who sent it, the answer's message, and what they wrote", async () => {
    stubProject({ id: PROJECT_ID, name: "Production" } as unknown as Project);

    await MicrosoftTeamsAiAnswer.handleFeedback({ activity: feedbackInvoke() });

    expect(post).toHaveBeenCalledTimes(1);
    const call: JSONObject = post.mock.calls[0]![0] as JSONObject;

    expect(call["webhookUrl"]).toBe("https://hooks.slack.test/ai-feedback");
    expect(call["about"]).toBe("feedback on an AI answer");
    expect(call["projectId"]).toEqual(PROJECT_ID);
    expect(call["text"]).toBe(
      OperatorSlackNotice.getAiAnswerFeedbackText({
        chat: "Microsoft Teams",
        reaction: AiAnswerFeedbackReaction.Dislike,
        feedback: "It named a monitor we do not have.",
        project: { id: PROJECT_ID, name: "Production" } as unknown as Project,
        projectId: PROJECT_ID,
        conversationType: "channel",
        userName: "Alice Doe",
        messageId: "1761400000000",
      }),
    );
  });

  test("the project is the one the tenant and the conversation tell", async () => {
    stubProject({ id: PROJECT_ID, name: "Production" } as unknown as Project);

    await MicrosoftTeamsAiAnswer.handleFeedback({ activity: feedbackInvoke() });

    expect(MicrosoftTeamsUtil.resolveProjectByTenantId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
  });

  test("an organization connected to no project: told without one", async () => {
    stubProject(null);

    await MicrosoftTeamsAiAnswer.handleFeedback({ activity: feedbackInvoke() });

    expect(post).toHaveBeenCalledTimes(1);
    expect((post.mock.calls[0]![0] as JSONObject)["projectId"]).toBeNull();
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
  });

  test("the project cannot be read: still told, without one", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockRejectedValue(new Error("database down"));

    await MicrosoftTeamsAiAnswer.handleFeedback({ activity: feedbackInvoke() });

    expect(post).toHaveBeenCalledTimes(1);
  });

  test("no webhook set: nobody to tell, and nothing read", async () => {
    mockEnvironment.aiFeedbackWebhook = "";
    const resolve: ReturnType<typeof jest.spyOn> = jest.spyOn(
      MicrosoftTeamsUtil,
      "resolveProjectByTenantId",
    );

    await MicrosoftTeamsAiAnswer.handleFeedback({ activity: feedbackInvoke() });

    expect(post).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  test("no reaction: nothing to tell", async () => {
    await MicrosoftTeamsAiAnswer.handleFeedback({
      activity: feedbackInvoke({ reaction: "love" }),
    });

    expect(post).not.toHaveBeenCalled();
  });

  test("never throws: the invoke is answered either way", async () => {
    stubProject(null);
    post.mockRejectedValue(new Error("Slack is down"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    await expect(
      MicrosoftTeamsAiAnswer.handleFeedback({ activity: feedbackInvoke() }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
