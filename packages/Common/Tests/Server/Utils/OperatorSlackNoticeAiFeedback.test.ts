import { describe, expect, test } from "@jest/globals";
import OperatorSlackNotice, {
  AiAnswerFeedbackNotice,
  AiAnswerFeedbackReaction,
} from "../../../Server/Utils/OperatorSlackNotice";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { shownInSlack, shownLines } from "../TestingUtils/SlackWebhookMessages";

/*
 * What the operator's Slack channel is told of a 👍 or 👎 on an answer from
 * OneUptime AI in Microsoft Teams (NOTIFICATION_SLACK_WEBHOOK_ON_AI_FEEDBACK):
 * the reports of answers that are wrong or inappropriate Microsoft's store
 * requires the developer to receive and act on. Everything in it but its
 * labels is text OneUptime did not write - the project's name, the sender's
 * name, what they wrote - so none of it may notify the channel, mention
 * anyone or link anywhere.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000001",
);

function notice(
  overrides?: Partial<AiAnswerFeedbackNotice>,
): AiAnswerFeedbackNotice {
  return {
    chat: "Microsoft Teams",
    reaction: AiAnswerFeedbackReaction.Dislike,
    feedback: "It named a monitor we do not have.",
    project: { id: PROJECT_ID, name: "Production" } as unknown as Project,
    projectId: PROJECT_ID,
    conversationType: "channel",
    userName: "Alice Doe",
    messageId: "1761400000000",
    ...overrides,
  };
}

describe("OperatorSlackNotice.getAiAnswerFeedbackText", () => {
  test("a 👎: reported, the project, where, who, the answer's message, and what they wrote - quoted, last", () => {
    expect(
      shownLines(OperatorSlackNotice.getAiAnswerFeedbackText(notice())),
    ).toEqual([
      "*OneUptime AI Answer Reported 👎:*",
      "*Project Name:* Production",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Where:* Microsoft Teams, channel",
      "*From:* Alice Doe",
      "*Message ID:* 1761400000000",
      "*Feedback:*",
      "> It named a monitor we do not have.",
    ]);
  });

  test("a 👍 is a like, not a report", () => {
    expect(
      shownLines(
        OperatorSlackNotice.getAiAnswerFeedbackText(
          notice({ reaction: AiAnswerFeedbackReaction.Like }),
        ),
      )[0],
    ).toBe("*OneUptime AI Answer Liked 👍:*");
  });

  test("a personal chat and a group chat are named as people say them", () => {
    expect(
      shownInSlack(
        OperatorSlackNotice.getAiAnswerFeedbackText(
          notice({ conversationType: "personal" }),
        ),
      ),
    ).toContain("*Where:* Microsoft Teams, personal chat");
    expect(
      shownInSlack(
        OperatorSlackNotice.getAiAnswerFeedbackText(
          notice({ conversationType: "groupChat" }),
        ),
      ),
    ).toContain("*Where:* Microsoft Teams, group chat");
  });

  test("nothing written, no project, nobody named: said so, and nothing left out of order", () => {
    expect(
      shownLines(
        OperatorSlackNotice.getAiAnswerFeedbackText(
          notice({
            feedback: "   ",
            project: null,
            projectId: null,
            conversationType: undefined,
            userName: "",
            messageId: "",
          }),
        ),
      ),
    ).toEqual([
      "*OneUptime AI Answer Reported 👎:*",
      "*Project Name:* N/A",
      "*Project ID:* N/A",
      "*Where:* Microsoft Teams",
      "*Feedback:* _None given_",
    ]);
  });

  test("what they wrote, their name and the project's can neither notify the channel nor link anywhere", () => {
    const text: string = OperatorSlackNotice.getAiAnswerFeedbackText(
      notice({
        feedback:
          "<!channel> this is wrong\n<@U012AB3CD> see <https://evil.example|here>",
        userName: "<!here> Mallory",
        project: {
          id: PROJECT_ID,
          name: "<!everyone> Prod",
        } as unknown as Project,
      }),
    );

    // No "<" anybody typed reaches Slack: no mention, no link.
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<!here>");
    expect(text).not.toContain("<!everyone>");
    expect(text).not.toContain("<@U012AB3CD>");
    expect(text).not.toContain("<https://evil.example");

    // What they wrote is shown as they wrote it.
    expect(shownLines(text)).toEqual(
      expect.arrayContaining([
        "*Project Name:* <!everyone> Prod",
        "*From:* <!here> Mallory",
        "> <!channel> this is wrong",
        "> <@U012AB3CD> see <https://evil.example|here>",
      ]),
    );
  });
});
