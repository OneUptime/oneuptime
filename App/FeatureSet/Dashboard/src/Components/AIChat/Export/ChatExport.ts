import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import OneUptimeDate from "Common/Types/Date";
import convertConversationToMarkdown from "Common/UI/Utils/AIChatExport/ConversationMarkdown";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";
import buildConversationPdf from "./ConversationPdf";

/*
 * The two entry points behind the chat's download menu.
 *
 * Both render from the conversation's stored data rather than the DOM, so the
 * whole thread is exported — not only the part currently scrolled into view —
 * and the export works the same from the slide-over and the full page.
 */

export interface ChatExportOptions {
  title: string;
  messages: Array<AIConversationMessage>;
  latestRun?: AIRun | undefined;
}

export function exportConversationAsMarkdown(options: ChatExportOptions): void {
  const exportedAt: Date = OneUptimeDate.getCurrentDate();

  const markdown: string = convertConversationToMarkdown({
    title: options.title,
    messages: options.messages,
    latestRun: options.latestRun,
    exportedAt: exportedAt,
  });

  downloadFile({
    content: markdown,
    filename: getExportFilename({
      label: options.title,
      extension: "md",
      exportedAt: exportedAt,
    }),
    mimeType: "text/markdown;charset=utf-8;",
  });
}

export async function exportConversationAsPdf(
  options: ChatExportOptions,
): Promise<void> {
  const exportedAt: Date = OneUptimeDate.getCurrentDate();

  const blob: Blob = await buildConversationPdf({
    title: options.title,
    messages: options.messages,
    latestRun: options.latestRun,
    exportedAt: exportedAt,
  });

  downloadFile({
    content: blob,
    filename: getExportFilename({
      label: options.title,
      extension: "pdf",
      exportedAt: exportedAt,
    }),
  });
}
