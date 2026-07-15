import AIConversationMessage from "../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatWidget,
} from "../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../Types/Date";
import neutralizeAssistantMarkdown from "./MarkdownSafety";
import {
  citationsToMarkdown,
  toolActionsToMarkdown,
  widgetsToMarkdown,
} from "./ChatWidgetMarkdown";

/*
 * Renders a whole AI chat conversation as a markdown document.
 *
 * The shape follows the chat itself: alternating turns, each assistant turn
 * carrying the widgets, actions and citations that were shown beneath it. What
 * the reader gets is the transcript plus the evidence behind it, in a file that
 * reads fine in a plain text editor.
 */

export interface ConversationMarkdownOptions {
  title: string;
  messages: Array<AIConversationMessage>;
  latestRun?: AIRun | undefined;
  exportedAt: Date;
}

// Mirrors the cost footer the chat shows under the newest completed answer.
function runFooter(run: AIRun): string {
  const parts: Array<string> = [];

  if (run.egressManifest?.modelName) {
    parts.push(run.egressManifest.modelName);
  }
  if (run.totalTokens) {
    parts.push(`${run.totalTokens.toLocaleString()} tokens`);
  }
  if (run.totalCostInUSDCents) {
    parts.push(`$${(run.totalCostInUSDCents / 100).toFixed(4)}`);
  }
  const toolCallCount: number = run.toolCallCount || 0;
  parts.push(`${toolCallCount} ${toolCallCount === 1 ? "query" : "queries"}`);

  return parts.join(" · ");
}

function messageToMarkdown(
  message: AIConversationMessage,
  isLastCompletedAssistant: boolean,
  latestRun: AIRun | undefined,
): Array<string> {
  const lines: Array<string> = [];
  const timestamp: string = message.createdAt
    ? OneUptimeDate.getDateAsLocalFormattedString(message.createdAt)
    : "";

  if (message.role === AIChatMessageRole.User) {
    lines.push("## You", "");
    /*
     * The user's own words, shown literally on screen. No neutralization: this
     * is the operator's own input, not model output derived from telemetry.
     */
    if (message.contentInMarkdown) {
      lines.push(message.contentInMarkdown.trim(), "");
    }
    if (timestamp) {
      lines.push(`_${timestamp}_`, "");
    }
    return lines;
  }

  lines.push("## AI", "");

  if (message.status === AIChatMessageStatus.Error) {
    lines.push(
      `> **Error:** ${
        message.errorMessage || "Something went wrong generating this response."
      }`,
      "",
    );
    return lines;
  }

  if (message.contentInMarkdown) {
    lines.push(neutralizeAssistantMarkdown(message.contentInMarkdown), "");
  }

  const widgets: Array<AIChatWidget> = message.widgets || [];
  if (widgets.length > 0) {
    lines.push(widgetsToMarkdown(widgets), "");
  }

  const toolActions: Array<AIChatToolAction> = message.toolActions || [];
  if (toolActions.length > 0) {
    lines.push(toolActionsToMarkdown(toolActions), "");
  }

  const citations: Array<AIChatCitation> = message.citations || [];
  if (citations.length > 0) {
    lines.push(citationsToMarkdown(citations), "");
  }

  const footerParts: Array<string> = [];
  if (timestamp) {
    footerParts.push(timestamp);
  }
  if (isLastCompletedAssistant && latestRun) {
    footerParts.push(runFooter(latestRun));
  }
  if (footerParts.length > 0) {
    lines.push(`_${footerParts.join(" · ")}_`, "");
  }

  return lines;
}

export default function convertConversationToMarkdown(
  options: ConversationMarkdownOptions,
): string {
  const lines: Array<string> = [
    `# ${options.title || "AI conversation"}`,
    "",
    `_Exported from OneUptime on ${OneUptimeDate.getDateAsLocalFormattedString(
      options.exportedAt,
    )}_`,
    "",
    "---",
    "",
  ];

  /*
   * The run footer belongs to the newest completed answer, matching where the
   * chat shows it.
   */
  const lastCompletedAssistantId: string | undefined = [...options.messages]
    .reverse()
    .find((message: AIConversationMessage) => {
      return (
        message.role === AIChatMessageRole.Assistant &&
        message.status === AIChatMessageStatus.Completed
      );
    })
    ?.id?.toString();

  for (const message of options.messages) {
    /*
     * An answer still being generated has nothing to export yet; the chat
     * represents it with a live activity feed rather than content.
     */
    if (
      message.role === AIChatMessageRole.Assistant &&
      (message.status === AIChatMessageStatus.InProgress ||
        message.status === AIChatMessageStatus.Pending) &&
      !message.contentInMarkdown &&
      (message.widgets || []).length === 0 &&
      (message.toolActions || []).length === 0
    ) {
      continue;
    }

    lines.push(
      ...messageToMarkdown(
        message,
        message.id?.toString() === lastCompletedAssistantId,
        options.latestRun,
      ),
    );
  }

  return `${lines.join("\n").trim()}\n`;
}
