import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import { getAnswerTestPageSent } from "../../../../Types/AI/AIChatTestPage";
import { AIChatTestPageSent } from "../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  OnCallTestPageDelivery,
  OnCallTestPageKind,
  OnCallTestPageResult,
  OnCallTestPageStep,
} from "../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import OnCallTestPageService from "../../../Services/OnCallTestPageService";
import logger from "../../Logger";
import ToolResultSerializer, { SerializedResult } from "../Toolbox/Serializer";

/*
 * A TEST PAGE SENT FROM AN ANSWER, AS THE MODEL READS IT IN THE NEXT TURN
 * (#7249).
 *
 * The answer that set something up offers #6811's test page, and the run
 * of one sent from it is recorded on that answer. When the conversation
 * goes on, the model reads what became of it, as it stands now - who it
 * paged, how, and who acknowledged it - so "did the test page reach Ana?"
 * is answered from it. It is read as the person asking (the test page's
 * own check of who may read a result), and serialized as every tool result
 * is: capped, and with what looks like a secret or personal data redacted.
 */

// The newest answers whose test pages are read again, each turn.
export const MAX_TEST_PAGE_NOTES: number = 3;

// The people of one test page the model is shown.
export const MAX_TEST_PAGE_STEPS_IN_NOTE: number = 10;

function describeDeliveries(deliveries: Array<OnCallTestPageDelivery>): string {
  return deliveries
    .map((delivery: OnCallTestPageDelivery): string => {
      return `${delivery.channel || "no method"} ${delivery.status}`;
    })
    .join("; ");
}

// The rows the model reads: the test page, then each person or target of it.
export function getTestPageNoteRows(data: {
  sent: AIChatTestPageSent;
  result: OnCallTestPageResult;
}): Array<JSONObject> {
  const result: OnCallTestPageResult = data.result;
  const steps: Array<OnCallTestPageStep> = result.steps || [];
  const rows: Array<JSONObject> = [
    {
      testPage: "sent from this answer",
      sentAt: data.sent.sentAt,
      to:
        result.kind === OnCallTestPageKind.Policy
          ? `on-call policy ${result.policyName || result.policyId || ""}`.trim()
          : "the person asking",
      walksEveryLevel: result.walksEscalation ? "yes" : undefined,
      standsInFor: `${result.recordKind} of severity ${result.severityName}`,
      status: result.status,
      statusMessage: result.statusMessage || undefined,
      acknowledgedBy: result.acknowledgedByName,
      acknowledgedFrom: result.acknowledgedChannel,
      acknowledgedAfterSeconds: result.acknowledgedAfterSeconds,
      endsAt: result.endsAt,
    } as JSONObject,
  ];

  for (const step of steps.slice(0, MAX_TEST_PAGE_STEPS_IN_NOTE)) {
    rows.push({
      level: step.levelOrder,
      person: step.userName,
      throughTeam: step.teamName,
      throughSchedule: step.scheduleName,
      coveringFor: step.coveringForName,
      status: step.status,
      statusMessage: step.statusMessage || undefined,
      messages: describeDeliveries(step.deliveries || []) || undefined,
    } as JSONObject);
  }

  if (steps.length > MAX_TEST_PAGE_STEPS_IN_NOTE) {
    rows.push({
      more: `${steps.length - MAX_TEST_PAGE_STEPS_IN_NOTE} more people or targets of this test page are not shown`,
    });
  }

  return rows;
}

// What the model is told of a test page sent from an answer.
export function buildTestPageNote(data: {
  sent: AIChatTestPageSent;
  result: OnCallTestPageResult;
}): string {
  const serialized: SerializedResult = ToolResultSerializer.serializeRows(
    getTestPageNoteRows(data),
  );

  return `[A test page was sent from this answer. What became of it, read now:\n${serialized.text}]`;
}

// What the model is told of one whose result the person may not read now.
export function buildUnreadableTestPageNote(sent: AIChatTestPageSent): string {
  return `[A test page was sent from this answer at ${sent.sentAt}; what became of it can't be read now.]`;
}

/*
 * The notes of the newest answers with a test page sent from them, by
 * answer. The messages are the conversation's, newest first.
 */
export async function readTestPageNotes(data: {
  messages: ReadonlyArray<AIConversationMessage>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Map<AIConversationMessage, string>> {
  const notes: Map<AIConversationMessage, string> = new Map<
    AIConversationMessage,
    string
  >();
  const answers: Array<{
    message: AIConversationMessage;
    sent: AIChatTestPageSent;
  }> = [];

  for (const message of data.messages) {
    if (answers.length >= MAX_TEST_PAGE_NOTES) {
      break;
    }

    if (message.role !== AIChatMessageRole.Assistant) {
      continue;
    }

    const sent: AIChatTestPageSent | null = getAnswerTestPageSent(
      message.widgets,
    );

    if (sent) {
      answers.push({ message: message, sent: sent });
    }
  }

  await Promise.all(
    answers.map(
      async (answer: {
        message: AIConversationMessage;
        sent: AIChatTestPageSent;
      }): Promise<void> => {
        try {
          const result: OnCallTestPageResult =
            await OnCallTestPageService.getResult({
              projectId: data.projectId,
              executionLogId: new ObjectID(answer.sent.executionLogId),
              props: data.props,
            });

          notes.set(
            answer.message,
            buildTestPageNote({ sent: answer.sent, result: result }),
          );
        } catch (error) {
          logger.debug(
            `Ask AI could not read a test page sent from an answer: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          notes.set(answer.message, buildUnreadableTestPageNote(answer.sent));
        }
      },
    ),
  );

  return notes;
}
