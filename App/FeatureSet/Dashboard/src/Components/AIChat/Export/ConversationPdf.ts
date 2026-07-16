import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
} from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import parseMarkdownBlocks, {
  MarkdownBlock,
} from "Common/UI/Utils/AIChatExport/MarkdownBlocks";
import neutralizeAssistantMarkdown from "Common/UI/Utils/AIChatExport/MarkdownSafety";
import { formatToolArguments } from "Common/UI/Utils/AIChatExport/ChatWidgetData";
import PdfDocument, { PAGE_MARGIN, PDF_COLORS } from "./PdfDocument";
import PdfMarkdownRenderer from "./PdfMarkdown";
import { AutoTableFunction, PdfTable } from "./PdfTable";
import PdfWidgets from "./PdfWidgets";

/*
 * Builds the PDF export of an AI chat conversation.
 *
 * jsPDF and its table plugin are pulled in with a dynamic import rather than a
 * top-level one so that roughly 400KB of PDF machinery stays out of the main
 * dashboard bundle and is only fetched when somebody actually exports. (The
 * project convention is top-level imports; this is a deliberate exception for
 * code splitting, which the esbuild config already supports via
 * `splitting: true`.)
 */

// The chip colours the chat uses for tool action status.
const STATUS_COLORS: {
  [key in AIChatToolActionStatus]: { fill: string; text: string };
} = {
  [AIChatToolActionStatus.Pending]: { fill: "#fef3c7", text: "#b45309" },
  [AIChatToolActionStatus.Approved]: { fill: "#e0f2fe", text: "#0369a1" },
  [AIChatToolActionStatus.Executed]: { fill: "#d1fae5", text: "#047857" },
  [AIChatToolActionStatus.Denied]: { fill: "#e5e7eb", text: "#4b5563" },
  [AIChatToolActionStatus.Failed]: { fill: "#ffe4e6", text: "#be123c" },
  [AIChatToolActionStatus.Skipped]: { fill: "#f3f4f6", text: "#6b7280" },
};

export interface ConversationPdfOptions {
  title: string;
  messages: Array<AIConversationMessage>;
  latestRun?: AIRun | undefined;
  exportedAt: Date;
}

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

  return parts.join("  ·  ");
}

class ConversationPdfBuilder {
  private readonly pdf: PdfDocument;
  private readonly markdown: PdfMarkdownRenderer;
  private readonly widgets: PdfWidgets;
  private readonly table: PdfTable;

  public constructor(pdf: PdfDocument, autoTable: AutoTableFunction) {
    this.pdf = pdf;
    this.table = new PdfTable(pdf, autoTable);
    this.markdown = new PdfMarkdownRenderer(pdf, this.table);
    this.widgets = new PdfWidgets(pdf, this.table);
  }

  private drawTitle(options: ConversationPdfOptions): void {
    this.pdf.paragraph(options.title || "AI conversation", {
      size: 17,
      fontStyle: "bold",
      color: PDF_COLORS.heading,
    });

    this.pdf.paragraph(
      `Exported from OneUptime on ${OneUptimeDate.getDateAsLocalFormattedString(
        options.exportedAt,
      )}`,
      { size: 8, color: PDF_COLORS.faint },
    );

    this.pdf.moveDown(6);
    this.pdf.hairline(
      this.pdf.left,
      this.pdf.y,
      this.pdf.right,
      this.pdf.y,
      PDF_COLORS.border,
    );
    this.pdf.moveDown(12);
  }

  private drawSpeaker(label: string): void {
    this.pdf.ensureSpace(30);
    this.pdf.setStyle({ size: 7, fontStyle: "bold", color: PDF_COLORS.faint });
    this.pdf.drawLine(label.toUpperCase(), this.pdf.left, this.pdf.y);
    this.pdf.moveDown(11);
  }

  /*
   * The user's turn, on the tinted surface the chat gives it. Not neutralized:
   * these are the operator's own words, not model output derived from
   * telemetry.
   */
  private drawUserMessage(message: AIConversationMessage): void {
    this.drawSpeaker("You");

    const text: string = this.pdf.sanitize(message.contentInMarkdown || "");
    const padding: number = 8;

    this.pdf.setStyle({ size: 9.5, color: PDF_COLORS.heading });
    const lines: Array<string> = this.pdf.wrap(
      text,
      this.pdf.contentWidth - padding * 2,
    );
    const lineHeight: number = this.pdf.lineHeight(9.5);

    for (const line of lines) {
      this.pdf.ensureSpace(lineHeight + padding);
      // The surface is drawn per line so it can flow across a page break.
      this.pdf.rect(
        this.pdf.left,
        this.pdf.y - 2,
        this.pdf.contentWidth,
        lineHeight + 2,
        { fill: PDF_COLORS.surface },
      );
      this.pdf.setStyle({ size: 9.5, color: PDF_COLORS.heading });
      this.pdf.drawLine(line, this.pdf.left + padding, this.pdf.y);
      this.pdf.y += lineHeight;
    }

    this.pdf.moveDown(4);
    this.drawTimestamp(message);
  }

  private drawTimestamp(message: AIConversationMessage, extra?: string): void {
    const parts: Array<string> = [];

    if (message.createdAt) {
      parts.push(
        OneUptimeDate.getDateAsLocalFormattedString(message.createdAt),
      );
    }
    if (extra) {
      parts.push(extra);
    }
    if (parts.length === 0) {
      return;
    }

    this.pdf.paragraph(parts.join("  ·  "), {
      size: 7,
      color: PDF_COLORS.faint,
    });
    this.pdf.moveDown(6);
  }

  private drawToolActions(toolActions: Array<AIChatToolAction>): void {
    if (toolActions.length === 0) {
      return;
    }

    this.pdf.moveDown(4);
    this.pdf.paragraph("Actions", {
      size: 8,
      fontStyle: "bold",
      color: PDF_COLORS.muted,
    });
    this.pdf.moveDown(2);

    for (const action of toolActions) {
      this.pdf.ensureSpace(24);

      const status: AIChatToolActionStatus =
        action.status || AIChatToolActionStatus.Pending;
      const colors: { fill: string; text: string } =
        STATUS_COLORS[status] || STATUS_COLORS[AIChatToolActionStatus.Pending];

      const chipText: string = this.pdf.sanitize(status);
      this.pdf.setStyle({ size: 6.5, fontStyle: "bold", color: colors.text });
      const chipWidth: number = this.pdf.textWidth(chipText) + 10;

      this.pdf.rect(this.pdf.left, this.pdf.y - 1, chipWidth, 10, {
        fill: colors.fill,
        radius: 5,
      });
      this.pdf.setStyle({ size: 6.5, fontStyle: "bold", color: colors.text });
      this.pdf.drawLine(chipText, this.pdf.left + 5, this.pdf.y + 1.5);

      this.pdf.setStyle({ size: 8.5, color: PDF_COLORS.heading });
      const titleLines: Array<string> = this.pdf.wrap(
        this.pdf.sanitize(action.title || action.toolName || ""),
        this.pdf.contentWidth - chipWidth - 6,
      );
      this.pdf.drawLine(
        titleLines[0] || "",
        this.pdf.left + chipWidth + 6,
        this.pdf.y,
      );

      this.pdf.y += 12;

      const args: string = formatToolArguments(action.arguments || {});
      if (args) {
        this.pdf.paragraph(
          args,
          {
            size: 7,
            color: PDF_COLORS.muted,
          },
          { indent: chipWidth + 6 },
        );
      }

      if (action.resultSummary) {
        this.pdf.paragraph(
          action.resultSummary,
          {
            size: 7,
            fontStyle: "italic",
            color: PDF_COLORS.faint,
          },
          { indent: chipWidth + 6 },
        );
      }

      this.pdf.moveDown(4);
    }
  }

  /*
   * Citations are the receipts behind an answer: the tool, the query as it was
   * actually executed, and how many rows came back. A zero row count is
   * evidence in its own right, so it is spelled out.
   */
  private drawCitations(citations: Array<AIChatCitation>): void {
    if (citations.length === 0) {
      return;
    }

    this.pdf.moveDown(4);
    this.pdf.paragraph("Sources", {
      size: 8,
      fontStyle: "bold",
      color: PDF_COLORS.muted,
    });
    this.pdf.moveDown(2);

    for (const citation of citations) {
      this.pdf.ensureSpace(22);

      const badge: string = this.pdf.sanitize(citation.id || "");
      this.pdf.setStyle({ size: 6.5, fontStyle: "bold", color: "#ffffff" });
      const badgeWidth: number = Math.max(this.pdf.textWidth(badge) + 8, 16);

      this.pdf.rect(this.pdf.left, this.pdf.y - 1, badgeWidth, 10, {
        fill: citation.rowCount === 0 ? PDF_COLORS.faint : PDF_COLORS.accent,
        radius: 2,
      });
      this.pdf.setStyle({ size: 6.5, fontStyle: "bold", color: "#ffffff" });
      this.pdf.drawLine(badge, this.pdf.left + 4, this.pdf.y + 1.5);

      const rows: string =
        citation.rowCount === 0
          ? "checked, found nothing"
          : `${citation.rowCount} ${citation.rowCount === 1 ? "row" : "rows"}`;

      this.pdf.setStyle({ size: 8, color: PDF_COLORS.heading });
      this.pdf.drawLine(
        this.pdf.sanitize(`${citation.label || citation.toolName} — ${rows}`),
        this.pdf.left + badgeWidth + 6,
        this.pdf.y,
      );

      this.pdf.y += 11;

      this.pdf.paragraph(
        `${citation.toolName}  ·  ${JSON.stringify(
          citation.queryArguments || {},
        )}`,
        { size: 6.5, color: PDF_COLORS.faint },
        { indent: badgeWidth + 6 },
      );

      this.pdf.moveDown(3);
    }
  }

  private drawAssistantMessage(
    message: AIConversationMessage,
    isLastCompleted: boolean,
    latestRun: AIRun | undefined,
  ): void {
    this.drawSpeaker("AI");

    if (message.status === AIChatMessageStatus.Error) {
      this.pdf.paragraph(
        message.errorMessage ||
          "Something went wrong generating this response.",
        { size: 9, color: PDF_COLORS.error },
      );
      this.pdf.moveDown(8);
      return;
    }

    if (message.contentInMarkdown) {
      /*
       * Neutralized before parsing, so the blocks that reach the renderer no
       * longer contain link or image destinations at all.
       */
      const safe: string = neutralizeAssistantMarkdown(
        message.contentInMarkdown,
      );
      const blocks: Array<MarkdownBlock> = parseMarkdownBlocks(safe);
      this.markdown.drawBlocks(blocks);
    }

    const widgets: Array<AIChatWidget> = message.widgets || [];
    if (widgets.length > 0) {
      this.widgets.drawAll(widgets);
    }

    this.drawToolActions(message.toolActions || []);
    this.drawCitations(message.citations || []);

    this.drawTimestamp(
      message,
      isLastCompleted && latestRun ? runFooter(latestRun) : undefined,
    );
  }

  public build(options: ConversationPdfOptions): void {
    this.drawTitle(options);

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
      if (message.role === AIChatMessageRole.User) {
        this.drawUserMessage(message);
        continue;
      }

      /*
       * An answer still in flight has nothing to export: on screen it is the
       * live activity feed, not content.
       */
      if (
        (message.status === AIChatMessageStatus.InProgress ||
          message.status === AIChatMessageStatus.Pending) &&
        !message.contentInMarkdown &&
        (message.widgets || []).length === 0 &&
        (message.toolActions || []).length === 0
      ) {
        continue;
      }

      this.drawAssistantMessage(
        message,
        message.id?.toString() === lastCompletedAssistantId,
        options.latestRun,
      );

      this.pdf.moveDown(6);
    }

    this.pdf.stampFooters();
  }
}

export default async function buildConversationPdf(
  options: ConversationPdfOptions,
): Promise<Blob> {
  const [jsPdfModule, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc: import("jspdf").jsPDF = new jsPdfModule.jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });

  doc.setProperties({
    title: options.title || "AI conversation",
    creator: "OneUptime",
  });

  const pdf: PdfDocument = new PdfDocument(doc);
  pdf.y = PAGE_MARGIN.top;

  const builder: ConversationPdfBuilder = new ConversationPdfBuilder(
    pdf,
    autoTableModule.default as AutoTableFunction,
  );

  builder.build(options);

  return doc.output("blob");
}
