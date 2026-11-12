import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import {
  AIChatTestPageOffer,
  AIChatToolAction,
  AIChatToolActionStatus,
} from "Common/Types/AI/AIChatTypes";
import {
  getAISetupPlanParts,
  isAISetupAction,
} from "Common/Types/AI/AISetupActions";
import { JSONObject } from "Common/Types/JSON";

/*
 * WHAT PEOPLE DO WITH ASK AI'S SETUP PLANS (issue #6829, the events #6830
 * asks each flow to send): a plan proposed on a card, the card answered -
 * how many parts were approved and how many skipped - and a test page sent
 * from under the answer. Never a name, an address or the question: the
 * parts by the word analytics names each by (AISetupActions), and counts.
 *
 * React-free, so the tests read what is sent without a panel; useAiChat
 * and AskAiTestPageOffer send them.
 */

// The setup actions of a message still waiting for the person's decision.
export function getPendingSetupActions(message: {
  status?: AIChatMessageStatus | undefined;
  toolActions?: Array<AIChatToolAction> | undefined;
}): Array<AIChatToolAction> {
  if (message.status !== AIChatMessageStatus.WaitingForApproval) {
    return [];
  }

  return (message.toolActions || []).filter(
    (action: AIChatToolAction): boolean => {
      return (
        action.status === AIChatToolActionStatus.Pending &&
        action.requiresApproval &&
        isAISetupAction(action.toolName)
      );
    },
  );
}

/*
 * ask_ai/setup_proposed: the parts a plan proposes, once per message, as
 * its card is first drawn. Null when the message waits on no setup action.
 */
export function getSetupProposedEvent(data: {
  message: {
    status?: AIChatMessageStatus | undefined;
    toolActions?: Array<AIChatToolAction> | undefined;
  };
  permissionMode: string;
}): JSONObject | null {
  const pending: Array<AIChatToolAction> = getPendingSetupActions(data.message);

  if (pending.length === 0) {
    return null;
  }

  return {
    parts: getAISetupPlanParts(
      pending.map((action: AIChatToolAction): string => {
        return action.toolName;
      }),
    ).join("."),
    part_count: pending.length,
    permission_mode: data.permissionMode,
  };
}

/*
 * ask_ai/setup_proposed, once per answer: the event for a message whose
 * plan waits on its card, the first time a poll brings it, and null every
 * time after. `seen` holds the answers already counted (useAiChat keeps it
 * for the panel's life), and the message is added to it once counted.
 */
export function takeNewSetupProposal(data: {
  message: {
    id?: { toString: () => string } | null | undefined;
    status?: AIChatMessageStatus | undefined;
    toolActions?: Array<AIChatToolAction> | undefined;
  };
  seen: Set<string>;
  permissionMode: string;
}): JSONObject | null {
  const messageId: string = data.message.id?.toString() || "";

  if (!messageId || data.seen.has(messageId)) {
    return null;
  }

  const proposed: JSONObject | null = getSetupProposedEvent({
    message: data.message,
    permissionMode: data.permissionMode,
  });

  if (proposed) {
    data.seen.add(messageId);
  }

  return proposed;
}

/*
 * ask_ai/setup_approved: a plan's card answered - the parts approved, and
 * how many were approved and skipped. Null when the decisions are about no
 * setup action.
 */
export function getSetupApprovedEvent(data: {
  toolActions: ReadonlyArray<AIChatToolAction>;
  decisions: ReadonlyArray<{ toolCallId: string; approved: boolean }>;
}): JSONObject | null {
  const setupDecisions: Array<{ toolName: string; approved: boolean }> = [];

  for (const decision of data.decisions) {
    const action: AIChatToolAction | undefined = data.toolActions.find(
      (each: AIChatToolAction): boolean => {
        return each.id === decision.toolCallId;
      },
    );

    if (action && isAISetupAction(action.toolName)) {
      setupDecisions.push({
        toolName: action.toolName,
        approved: decision.approved,
      });
    }
  }

  if (setupDecisions.length === 0) {
    return null;
  }

  const approved: Array<string> = setupDecisions
    .filter((decision: { approved: boolean }): boolean => {
      return decision.approved;
    })
    .map((decision: { toolName: string }): string => {
      return decision.toolName;
    });

  return {
    parts: getAISetupPlanParts(approved).join("."),
    approved_count: approved.length,
    skipped_count: setupDecisions.length - approved.length,
  };
}

// ask_ai/setup_test_page_sent: who the test page from under the answer went to.
export function getSetupTestPageSentEvent(
  offer: AIChatTestPageOffer,
): JSONObject {
  return { target: offer.kind };
}
