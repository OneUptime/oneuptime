import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import { AIChatCitation } from "Common/Types/AI/AIChatTypes";
import {
  getAskAiAnswerKindOf,
  getDocsPagesRead,
  isDocsNotCoveredAnswer,
} from "Common/Types/AI/AskAiAnswers";
import { JSONObject } from "Common/Types/JSON";

/*
 * WHAT PEOPLE THINK OF ASK AI'S ANSWERS, AND WHAT THE DOCS MISS (#7064,
 * the events #6830 asks Ask AI to send).
 *
 * - ask_ai/answer_rated: a thumb up or down, or a rating cleared, and what
 *   kind of answer it was - from the docs, the project's data, both, a
 *   setup plan or none - read from the tools it ran
 *   (Types/AI/AskAiAnswers), so the ratings split by kind.
 * - ask_ai/docs_not_covered: an answer that said "The docs do not cover
 *   this.", in any language, with the docs page it read first and how
 *   many it read: the list of docs pages to write next. Counted once per
 *   answer, and only for an answer the person saw being written - an old
 *   conversation opened again counts nothing again.
 *
 * Never the question, the answer or a name: tool names, docs pages'
 * addresses and counts. React-free, so the tests read what is sent
 * without a panel; useAiChat sends them.
 */

export interface AskAiAnswerSeen {
  id?: { toString: () => string } | null | undefined;
  status?: AIChatMessageStatus | undefined;
  contentInMarkdown?: string | undefined;
  citations?: Array<AIChatCitation> | undefined;
  toolActions?: Array<{ toolName: string }> | undefined;
}

// ask_ai/answer_rated: how the answer was rated, and what kind of answer it was.
export function getAnswerRatedEvent(data: {
  feedback: string | null;
  message?: AskAiAnswerSeen | undefined;
}): JSONObject {
  return {
    rating: data.feedback ? String(data.feedback) : "cleared",
    kind: getAskAiAnswerKindOf(data.message || {}),
  };
}

// ask_ai/docs_not_covered: the docs page it read first, and how many it read.
export function getDocsNotCoveredEvent(
  citations: Array<AIChatCitation> | undefined,
): JSONObject {
  const pages: Array<string> = getDocsPagesRead(citations);

  return {
    ...(pages[0] ? { page: pages[0] } : {}),
    page_count: pages.length,
  };
}

// An answer still being written: its words are not its last ones yet.
const BEING_WRITTEN: ReadonlyArray<AIChatMessageStatus> = [
  AIChatMessageStatus.Pending,
  AIChatMessageStatus.InProgress,
  AIChatMessageStatus.WaitingForApproval,
];

/*
 * ask_ai/docs_not_covered, once per answer the person saw written: the
 * event for an answer a poll brought while it was being written, the first
 * poll that brings it finished and saying the docs do not cover it - and
 * null every other time. `writing` holds the answers seen being written,
 * `counted` the ones decided; useAiChat keeps both for the panel's life.
 */
export function takeNewDocsNotCovered(data: {
  message: AskAiAnswerSeen;
  writing: Set<string>;
  counted: Set<string>;
}): JSONObject | null {
  const messageId: string = data.message.id?.toString() || "";

  if (!messageId || data.counted.has(messageId)) {
    return null;
  }

  if (data.message.status && BEING_WRITTEN.includes(data.message.status)) {
    data.writing.add(messageId);
    return null;
  }

  if (
    data.message.status !== AIChatMessageStatus.Completed ||
    !data.writing.has(messageId)
  ) {
    return null;
  }

  data.writing.delete(messageId);
  data.counted.add(messageId);

  return isDocsNotCoveredAnswer(data.message.contentInMarkdown)
    ? getDocsNotCoveredEvent(data.message.citations)
    : null;
}
