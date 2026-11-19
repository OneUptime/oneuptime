import {
  MAX_TEST_PAGE_NOTES,
  MAX_TEST_PAGE_STEPS_IN_NOTE,
  buildTestPageNote,
  buildUnreadableTestPageNote,
  readTestPageNotes,
} from "../../../../Server/Utils/AI/Chat/ChatTestPageNotes";
import OnCallTestPageService from "../../../../Server/Services/OnCallTestPageService";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import {
  AIChatTestPageSent,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  OnCallTestPageDeliveryStatus,
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
  OnCallTestPageStep,
  OnCallTestPageStepStatus,
} from "../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A TEST PAGE SENT FROM AN ANSWER, AS THE NEXT TURN'S MODEL READS IT (#7249).
 *
 *   - What became of it, read now: where it stands, who acknowledged it, by
 *     what and how fast, and each person it paged with their messages -
 *     serialized as every tool result is, so an address that looks like an
 *     email is redacted.
 *   - Read as the person asking: OnCallTestPageService.getResult with their
 *     props, which refuses a result they may not read - then the model is
 *     told only that it can't be read now.
 *   - Only the newest answers' test pages are read again, each turn.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72490000-0000-4000-8000-0000000000c1",
);
const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("72490000-0000-4000-8000-0000000000c2"),
  tenantId: PROJECT_ID,
};
const SENT: AIChatTestPageSent = {
  executionLogId: "72490000-0000-4000-8000-0000000000c3",
  sentAt: "2026-11-19T10:15:00.000Z",
};

function step(data: Partial<OnCallTestPageStep>): OnCallTestPageStep {
  return {
    id: data.id || "s1",
    status: data.status || OnCallTestPageStepStatus.Paged,
    statusMessage: data.statusMessage || "",
    deliveries: data.deliveries || [],
    ...data,
  };
}

function testPageResult(
  data: Partial<OnCallTestPageResult>,
): OnCallTestPageResult {
  return {
    executionLogId: SENT.executionLogId,
    kind: OnCallTestPageKind.Policy,
    policyId: "72490000-0000-4000-8000-0000000000c4",
    policyName: "Default on-call policy",
    recordKind: OnCallTestPageRecordKind.Incident,
    severityName: "Critical",
    walksEscalation: false,
    status: OnCallTestPageStatus.Paging,
    statusMessage: "",
    startedAt: SENT.sentAt,
    endsAt: "2026-11-19T10:45:00.000Z",
    steps: [],
    ...data,
  };
}

function answer(sent?: AIChatTestPageSent): AIConversationMessage {
  const message: AIConversationMessage = new AIConversationMessage();
  const widget: AIChatWidget = {
    id: "W1",
    type: AIChatWidgetType.ResourceCard,
    title: "Created",
    data: {
      heading: "Default on-call policy",
      testPage: {
        kind: "policy",
        policyId: "72490000-0000-4000-8000-0000000000c4",
        ...(sent ? { sent: sent } : {}),
      },
    },
  };

  message.role = AIChatMessageRole.Assistant;
  message.widgets = [widget];
  return message;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the model is told of a test page sent from an answer", () => {
  test("where it stands, who acknowledged it, and each person it paged with their messages", () => {
    const note: string = buildTestPageNote({
      sent: SENT,
      result: testPageResult({
        status: OnCallTestPageStatus.Acknowledged,
        acknowledgedByName: "Ana",
        acknowledgedChannel: OnCallPageChannel.SMS,
        acknowledgedAfterSeconds: 42,
        steps: [
          step({
            levelOrder: 1,
            userName: "Ana",
            teamName: "SRE",
            status: OnCallTestPageStepStatus.Acknowledged,
            deliveries: [
              {
                id: "d1",
                channel: OnCallPageChannel.SMS,
                status: OnCallTestPageDeliveryStatus.Delivered,
                statusMessage: "",
                canAcknowledge: true,
                sentAt: SENT.sentAt,
              },
              {
                id: "d2",
                channel: OnCallPageChannel.Email,
                status: OnCallTestPageDeliveryStatus.Sent,
                statusMessage: "",
                canAcknowledge: true,
                sentAt: SENT.sentAt,
              },
            ],
          }),
        ],
      }),
    });

    expect(note.startsWith("[A test page was sent from this answer.")).toBe(
      true,
    );
    expect(note.endsWith("]")).toBe(true);
    expect(note).toContain("sentAt=2026-11-19T10:15:00.000Z");
    expect(note).toContain("to=on-call policy Default on-call policy");
    expect(note).toContain("status=Acknowledged");
    expect(note).toContain("acknowledgedBy=Ana");
    expect(note).toContain(`acknowledgedFrom=${OnCallPageChannel.SMS}`);
    expect(note).toContain("acknowledgedAfterSeconds=42");
    expect(note).toContain("level=1 | person=Ana | throughTeam=SRE");
    expect(note).toContain(
      `messages=${OnCallPageChannel.SMS} Delivered; ${OnCallPageChannel.Email} Sent`,
    );
  });

  test("a test page to the person asking says so, and one still paging says it pages", () => {
    const note: string = buildTestPageNote({
      sent: SENT,
      result: testPageResult({
        kind: OnCallTestPageKind.Self,
        policyId: undefined,
        policyName: undefined,
      }),
    });

    expect(note).toContain("to=the person asking");
    expect(note).toContain("status=Paging");
    expect(note).not.toContain("acknowledgedBy=");
  });

  test("is redacted as every tool result is", () => {
    const note: string = buildTestPageNote({
      sent: SENT,
      result: testPageResult({
        status: OnCallTestPageStatus.Acknowledged,
        acknowledgedByName: "ana@acme.com",
        steps: [step({ userName: "ana@acme.com" })],
      }),
    });

    expect(note).not.toContain("ana@acme.com");
    expect(note).toContain("[redacted-email]");
  });

  test("shows the first people of a large test page, and says how many more there are", () => {
    const steps: Array<OnCallTestPageStep> = [];

    for (let i: number = 0; i < MAX_TEST_PAGE_STEPS_IN_NOTE + 3; i++) {
      steps.push(step({ id: `s${i}`, userName: `Person ${i}` }));
    }

    const note: string = buildTestPageNote({
      sent: SENT,
      result: testPageResult({ steps: steps }),
    });

    expect(note).toContain(`person=Person ${MAX_TEST_PAGE_STEPS_IN_NOTE - 1}`);
    expect(note).not.toContain(`person=Person ${MAX_TEST_PAGE_STEPS_IN_NOTE} `);
    expect(note).toContain(
      "3 more people or targets of this test page are not shown",
    );
  });
});

describe("the notes of a conversation's answers", () => {
  test("are read as the person asking, for answers a test page was sent from", async () => {
    const getResult: jest.SpiedFunction<
      typeof OnCallTestPageService.getResult
    > = jest.spyOn(OnCallTestPageService, "getResult").mockResolvedValue(
      testPageResult({ status: OnCallTestPageStatus.Ended }),
    );
    const tested: AIConversationMessage = answer(SENT);
    const untested: AIConversationMessage = answer();
    const question: AIConversationMessage = new AIConversationMessage();

    question.role = AIChatMessageRole.User;

    const notes: Map<AIConversationMessage, string> = await readTestPageNotes(
      {
        messages: [question, tested, untested],
        projectId: PROJECT_ID,
        props: PROPS,
      },
    );

    expect(getResult).toHaveBeenCalledTimes(1);
    expect(getResult.mock.calls[0]![0].props).toBe(PROPS);
    expect(getResult.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect(getResult.mock.calls[0]![0].executionLogId.toString()).toBe(
      SENT.executionLogId,
    );
    expect(notes.size).toBe(1);
    expect(notes.get(tested)).toContain("status=Ended");
    expect(notes.has(untested)).toBe(false);
    expect(notes.has(question)).toBe(false);
  });

  test("one the person may not read is only said to have been sent", async () => {
    jest
      .spyOn(OnCallTestPageService, "getResult")
      .mockRejectedValue(new BadDataException("Test page not found."));

    const tested: AIConversationMessage = answer(SENT);
    const notes: Map<AIConversationMessage, string> = await readTestPageNotes(
      { messages: [tested], projectId: PROJECT_ID, props: PROPS },
    );

    expect(notes.get(tested)).toBe(buildUnreadableTestPageNote(SENT));
    expect(notes.get(tested)).toBe(
      "[A test page was sent from this answer at 2026-11-19T10:15:00.000Z; what became of it can't be read now.]",
    );
  });

  test("only the newest answers' test pages are read again", async () => {
    const getResult: jest.SpiedFunction<
      typeof OnCallTestPageService.getResult
    > = jest
      .spyOn(OnCallTestPageService, "getResult")
      .mockResolvedValue(testPageResult({}));
    const answers: Array<AIConversationMessage> = [];

    for (let i: number = 0; i < MAX_TEST_PAGE_NOTES + 2; i++) {
      answers.push(answer(SENT));
    }

    const notes: Map<AIConversationMessage, string> = await readTestPageNotes(
      { messages: answers, projectId: PROJECT_ID, props: PROPS },
    );

    expect(getResult).toHaveBeenCalledTimes(MAX_TEST_PAGE_NOTES);
    expect(notes.size).toBe(MAX_TEST_PAGE_NOTES);
    // Newest first: the first answers given are the ones read.
    expect(notes.has(answers[0]!)).toBe(true);
    expect(notes.has(answers[MAX_TEST_PAGE_NOTES]!)).toBe(false);
  });
});
