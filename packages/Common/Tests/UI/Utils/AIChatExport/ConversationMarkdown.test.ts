import { describe, expect, jest, test } from "@jest/globals";

/*
 * MarkdownSafety pulls in the ESM-only mdast/unified stack, which this repo's
 * jest config does not transform, and it is a separately unit-tested
 * collaborator. Stub it with an identity that tags its input, so these tests
 * can assert the one thing convertConversationToMarkdown owns about it: that
 * assistant prose is routed THROUGH neutralization while the user's own words
 * are not. The tag makes that routing observable without depending on the real
 * neutralizer's output.
 */
jest.mock("../../../../UI/Utils/AIChatExport/MarkdownSafety", () => {
  return {
    __esModule: true,
    default: (text: string): string => {
      return `NEUTRALIZED<<${text}>>`;
    },
  };
});

import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import convertConversationToMarkdown, {
  ConversationMarkdownOptions,
} from "../../../../UI/Utils/AIChatExport/ConversationMarkdown";

/*
 * convertConversationToMarkdown turns a persisted AI chat (the ordered list of
 * user/assistant messages plus the cost of the newest answer) into a single
 * shareable markdown document. These tests pin the structural decisions that
 * matter once the file leaves the app:
 *
 *   - the document scaffold (title fallback, export stamp, trailing newline);
 *   - per-role rendering, including the security-critical asymmetry that the
 *     user's own words are kept literal while assistant prose is neutralized;
 *   - the terminal-status short circuits (Error / Cancelled) and their
 *     precedence over content, widgets and the cost footer;
 *   - which turns are dropped as "still generating", and the narrow shape of
 *     that skip (InProgress/Pending only, and blind to citations);
 *   - the run footer, which must attach to exactly the newest completed answer.
 */

interface MessageFields {
  id?: string | undefined;
  role: AIChatMessageRole;
  status?: AIChatMessageStatus | undefined;
  content?: string | undefined;
  createdAt?: Date | undefined;
  errorMessage?: string | undefined;
  widgets?: Array<AIChatWidget> | undefined;
  toolActions?: Array<AIChatToolAction> | undefined;
  citations?: Array<AIChatCitation> | undefined;
}

function makeMessage(fields: MessageFields): AIConversationMessage {
  const message: AIConversationMessage = new AIConversationMessage();
  if (fields.id !== undefined) {
    message.id = new ObjectID(fields.id);
  }
  message.role = fields.role;
  if (fields.status !== undefined) {
    message.status = fields.status;
  }
  if (fields.content !== undefined) {
    message.contentInMarkdown = fields.content;
  }
  if (fields.createdAt !== undefined) {
    message.createdAt = fields.createdAt;
  }
  if (fields.errorMessage !== undefined) {
    message.errorMessage = fields.errorMessage;
  }
  if (fields.widgets !== undefined) {
    message.widgets = fields.widgets;
  }
  if (fields.toolActions !== undefined) {
    message.toolActions = fields.toolActions;
  }
  if (fields.citations !== undefined) {
    message.citations = fields.citations;
  }
  return message;
}

interface RunFields {
  modelName?: string | undefined;
  totalTokens?: number | undefined;
  totalCostInUSDCents?: number | undefined;
  toolCallCount?: number | undefined;
}

function makeRun(fields: RunFields): AIRun {
  const run: AIRun = new AIRun();
  if (fields.modelName !== undefined) {
    run.egressManifest = {
      llmCallCount: 1,
      totalTokens: fields.totalTokens || 0,
      toolDataSentToLlm: [],
      modelName: fields.modelName,
    };
  }
  if (fields.totalTokens !== undefined) {
    run.totalTokens = fields.totalTokens;
  }
  if (fields.totalCostInUSDCents !== undefined) {
    run.totalCostInUSDCents = fields.totalCostInUSDCents;
  }
  if (fields.toolCallCount !== undefined) {
    run.toolCallCount = fields.toolCallCount;
  }
  return run;
}

const EXPORTED_AT: Date = new Date("2026-08-20T10:20:30.000Z");
const CREATED_AT: Date = new Date("2026-08-20T09:00:00.000Z");

function convert(
  messages: Array<AIConversationMessage>,
  overrides: Partial<ConversationMarkdownOptions> = {},
): string {
  const options: ConversationMarkdownOptions = {
    title: overrides.title !== undefined ? overrides.title : "Session",
    messages: messages,
    latestRun: overrides.latestRun,
    exportedAt:
      overrides.exportedAt !== undefined ? overrides.exportedAt : EXPORTED_AT,
  };
  return convertConversationToMarkdown(options);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("convertConversationToMarkdown", () => {
  describe("document scaffold", () => {
    test("renders the title, the export stamp, and a divider", () => {
      const doc: string = convert([], { title: "Payment outage" });

      expect(doc).toContain("# Payment outage");
      expect(doc).toContain(
        `_Exported from OneUptime on ${OneUptimeDate.getDateAsLocalFormattedString(
          EXPORTED_AT,
        )}_`,
      );
      expect(doc).toContain("---");
    });

    test("falls back to a generic title when the title is empty", () => {
      const doc: string = convert([], { title: "" });

      expect(doc).toContain("# AI conversation");
    });

    test("an empty conversation is just the header, no message blocks", () => {
      const doc: string = convert([], { title: "Empty" });

      expect(doc).not.toContain("## You");
      expect(doc).not.toContain("## AI");
      expect(doc.endsWith("---\n")).toBe(true);
    });

    test("the document always ends in exactly one trailing newline", () => {
      const doc: string = convert([
        makeMessage({
          id: "u1",
          role: AIChatMessageRole.User,
          content: "hello   ",
        }),
      ]);

      expect(doc.endsWith("\n")).toBe(true);
      expect(doc.endsWith("\n\n")).toBe(false);
    });
  });

  describe("user turns", () => {
    test("renders the You heading, the trimmed content, and the timestamp", () => {
      const doc: string = convert([
        makeMessage({
          id: "u1",
          role: AIChatMessageRole.User,
          content: "   Why is checkout down?   ",
          createdAt: CREATED_AT,
        }),
      ]);

      expect(doc).toContain("## You");
      expect(doc).toContain("## You\n\nWhy is checkout down?\n");
      expect(doc).toContain(
        `_${OneUptimeDate.getDateAsLocalFormattedString(CREATED_AT)}_`,
      );
    });

    test("keeps the user's own markdown literal — no link neutralization", () => {
      const doc: string = convert([
        makeMessage({
          id: "u1",
          role: AIChatMessageRole.User,
          content: "see [dash](http://internal.example/dash)",
        }),
      ]);

      /*
       * The operator's own input is trusted, so the live link syntax survives
       * verbatim and is never sent through the neutralizer. This is the exact
       * opposite of the assistant path.
       */
      expect(doc).toContain("[dash](http://internal.example/dash)");
      expect(doc).not.toContain("NEUTRALIZED");
    });

    test("a user turn with no content still emits the heading only", () => {
      const doc: string = convert([
        makeMessage({ id: "u1", role: AIChatMessageRole.User }),
      ]);

      expect(doc).toContain("## You");
      expect(doc).not.toContain("_MMM");
    });

    test("omits the timestamp line when the message has no createdAt", () => {
      const doc: string = convert([
        makeMessage({
          id: "u1",
          role: AIChatMessageRole.User,
          content: "no date here",
        }),
      ]);

      const afterContent: string = doc.substring(doc.indexOf("no date here"));
      expect(afterContent).not.toContain("_");
    });
  });

  describe("assistant terminal statuses", () => {
    test("an errored turn renders the error message and nothing else", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Error,
          content: "leaked partial answer",
          errorMessage: "Model timed out",
          widgets: [
            {
              id: "W1",
              type: AIChatWidgetType.StatCards,
              title: "Should not appear",
              data: { stats: [{ label: "Errors", value: 3 }] },
            },
          ],
          createdAt: CREATED_AT,
        }),
      ]);

      expect(doc).toContain("> **Error:** Model timed out");
      /*
       * The error branch returns early, so neither the (already-generated)
       * content nor any attached widget is exported, and there is no footer.
       */
      expect(doc).not.toContain("leaked partial answer");
      expect(doc).not.toContain("Should not appear");
    });

    test("an errored turn without a message uses the default error text", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Error,
        }),
      ]);

      expect(doc).toContain(
        "> **Error:** Something went wrong generating this response.",
      );
    });

    test("a cancelled turn renders its finalizer text as a stop marker", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Cancelled,
          content: "Stopped mid-thought.",
          widgets: [
            {
              id: "W1",
              type: AIChatWidgetType.StatCards,
              title: "Hidden widget",
              data: { stats: [{ label: "Errors", value: 3 }] },
            },
          ],
        }),
      ]);

      expect(doc).toContain("> _Stopped mid-thought._");
      expect(doc).not.toContain("Hidden widget");
    });

    test("a cancelled turn with no content falls back to Stopped by user", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Cancelled,
        }),
      ]);

      expect(doc).toContain("> _Stopped by user._");
    });
  });

  describe("completed assistant turns", () => {
    test("routes assistant prose through the markdown neutralizer", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Completed,
          content: "click [here](http://evil.example/steal)",
        }),
      ]);

      /*
       * Assistant prose is attacker-influenceable, so it must pass through
       * neutralizeAssistantMarkdown. The stub tags whatever it receives, which
       * proves the content took that path rather than being emitted raw.
       */
      expect(doc).toContain(
        "NEUTRALIZED<<click [here](http://evil.example/steal)>>",
      );
      expect(doc).toContain("## AI");
    });

    test("renders attached widgets, tool actions and citations in order", () => {
      const widgets: Array<AIChatWidget> = [
        {
          id: "W1",
          type: AIChatWidgetType.StatCards,
          title: "Summary",
          data: { stats: [{ label: "Errors", value: 3 }] },
        },
      ];
      const toolActions: Array<AIChatToolAction> = [
        {
          id: "t1",
          toolName: "restart",
          title: "Restart payment-svc",
          arguments: { service: "payment-svc" },
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Executed,
        },
      ];
      const citations: Array<AIChatCitation> = [
        {
          id: "C1",
          toolName: "logs.query",
          label: "Logs for payment-svc",
          queryArguments: { service: "payment-svc" },
          rowCount: 4,
        },
      ];

      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Completed,
          content: "Here is what I found.",
          widgets: widgets,
          toolActions: toolActions,
          citations: citations,
        }),
      ]);

      expect(doc).toContain("Here is what I found.");
      expect(doc).toContain("#### Summary");
      expect(doc).toContain("| Errors | 3 |");
      expect(doc).toContain("#### Actions");
      expect(doc).toContain("Restart payment-svc");
      expect(doc).toContain("#### Sources");
      expect(doc).toContain("Logs for payment-svc");

      const bodyIndex: number = doc.indexOf("Here is what I found.");
      const widgetIndex: number = doc.indexOf("#### Summary");
      const actionsIndex: number = doc.indexOf("#### Actions");
      const sourcesIndex: number = doc.indexOf("#### Sources");
      expect(bodyIndex).toBeLessThan(widgetIndex);
      expect(widgetIndex).toBeLessThan(actionsIndex);
      expect(actionsIndex).toBeLessThan(sourcesIndex);
    });

    test("a completed turn with only a timestamp footer omits the run line", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Completed,
          content: "done",
          createdAt: CREATED_AT,
        }),
      ]);

      expect(doc).toContain(
        `_${OneUptimeDate.getDateAsLocalFormattedString(CREATED_AT)}_`,
      );
      expect(doc).not.toContain("queries");
    });

    test("a completed turn carrying only citations is not skipped", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Completed,
          citations: [
            {
              id: "C1",
              toolName: "logs.query",
              label: "Logs",
              queryArguments: {},
              rowCount: 0,
            },
          ],
        }),
      ]);

      expect(doc).toContain("## AI");
      expect(doc).toContain("#### Sources");
    });
  });

  describe("skipping still-generating turns", () => {
    test("drops an InProgress assistant that has no content yet", () => {
      const doc: string = convert([
        makeMessage({
          id: "u1",
          role: AIChatMessageRole.User,
          content: "question",
        }),
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.InProgress,
        }),
      ]);

      expect(doc).toContain("## You");
      expect(doc).not.toContain("## AI");
    });

    test("drops a Pending assistant with no content", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Pending,
        }),
      ]);

      expect(doc).not.toContain("## AI");
    });

    test("keeps an InProgress assistant once it has streamed some content", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.InProgress,
          content: "partial but present",
        }),
      ]);

      expect(doc).toContain("## AI");
      expect(doc).toContain("partial but present");
    });

    test("keeps an InProgress assistant that already has a widget", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.InProgress,
          widgets: [
            {
              id: "W1",
              type: AIChatWidgetType.StatCards,
              title: "Early widget",
              data: { stats: [{ label: "Errors", value: 3 }] },
            },
          ],
        }),
      ]);

      expect(doc).toContain("## AI");
      expect(doc).toContain("#### Early widget");
    });

    test("citations alone do not save an InProgress turn from being skipped", () => {
      const doc: string = convert([
        makeMessage({
          id: "u1",
          role: AIChatMessageRole.User,
          content: "question",
        }),
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.InProgress,
          citations: [
            {
              id: "C1",
              toolName: "logs.query",
              label: "Logs",
              queryArguments: {},
              rowCount: 2,
            },
          ],
        }),
      ]);

      /*
       * The skip condition inspects content, widgets and toolActions but NOT
       * citations, so a turn that has only citations is still dropped.
       */
      expect(doc).not.toContain("## AI");
      expect(doc).not.toContain("#### Sources");
    });

    test("a WaitingForApproval turn is rendered, never skipped", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.WaitingForApproval,
          toolActions: [
            {
              id: "t1",
              toolName: "restart",
              title: "Restart payment-svc",
              arguments: {},
              isMutation: true,
              requiresApproval: true,
              status: AIChatToolActionStatus.Pending,
            },
          ],
        }),
      ]);

      expect(doc).toContain("## AI");
      expect(doc).toContain("#### Actions");
    });
  });

  describe("run footer", () => {
    test("renders the model, tokens, cost and query count on the newest answer", () => {
      const run: AIRun = makeRun({
        modelName: "gpt-test",
        totalTokens: 1234567,
        totalCostInUSDCents: 12345,
        toolCallCount: 3,
      });

      const doc: string = convert(
        [
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "answer",
            createdAt: CREATED_AT,
          }),
        ],
        { latestRun: run },
      );

      const tokensText: string = (1234567).toLocaleString();
      const timestamp: string =
        OneUptimeDate.getDateAsLocalFormattedString(CREATED_AT);
      expect(doc).toContain(
        `_${timestamp} · gpt-test · ${tokensText} tokens · $123.4500 · 3 queries_`,
      );
    });

    test("uses the singular query label for exactly one tool call", () => {
      const doc: string = convert(
        [
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "answer",
          }),
        ],
        { latestRun: makeRun({ toolCallCount: 1 }) },
      );

      expect(doc).toContain("_1 query_");
    });

    test("defaults an absent tool-call count to zero queries", () => {
      const doc: string = convert(
        [
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "answer",
          }),
        ],
        { latestRun: makeRun({}) },
      );

      expect(doc).toContain("_0 queries_");
    });

    test("drops zero token and zero cost parts from the footer", () => {
      const doc: string = convert(
        [
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "answer",
          }),
        ],
        {
          latestRun: makeRun({
            totalTokens: 0,
            totalCostInUSDCents: 0,
            toolCallCount: 2,
          }),
        },
      );

      expect(doc).toContain("_2 queries_");
      expect(doc).not.toContain("tokens");
      expect(doc).not.toContain("$");
    });

    test("omits the model name when there is no egress manifest", () => {
      const doc: string = convert(
        [
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "answer",
          }),
        ],
        { latestRun: makeRun({ totalTokens: 500, toolCallCount: 1 }) },
      );

      expect(doc).toContain(`_${(500).toLocaleString()} tokens · 1 query_`);
    });

    test("attaches the footer to only the last completed assistant", () => {
      const run: AIRun = makeRun({ modelName: "gpt-test", toolCallCount: 1 });

      const doc: string = convert(
        [
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "First answer",
            createdAt: CREATED_AT,
          }),
          makeMessage({
            id: "a2",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "Second answer",
            createdAt: CREATED_AT,
          }),
        ],
        { latestRun: run },
      );

      expect(doc.indexOf("First answer")).toBeLessThan(
        doc.indexOf("Second answer"),
      );
      expect(occurrences(doc, "gpt-test")).toBe(1);
      const footerIndex: number = doc.indexOf("gpt-test");
      expect(footerIndex).toBeGreaterThan(doc.indexOf("Second answer"));
    });

    test("no run footer appears when there is no completed assistant", () => {
      const doc: string = convert(
        [
          makeMessage({
            id: "u1",
            role: AIChatMessageRole.User,
            content: "question",
          }),
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Error,
            errorMessage: "boom",
          }),
        ],
        { latestRun: makeRun({ modelName: "gpt-test", toolCallCount: 3 }) },
      );

      expect(doc).not.toContain("gpt-test");
      expect(doc).not.toContain("queries");
    });

    test("no run footer when latestRun is undefined", () => {
      const doc: string = convert([
        makeMessage({
          id: "a1",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.Completed,
          content: "answer",
          createdAt: CREATED_AT,
        }),
      ]);

      expect(doc).not.toContain("queries");
    });
  });

  describe("whole-conversation ordering", () => {
    test("emits turns in message order with a completed run footer at the end", () => {
      const doc: string = convert(
        [
          makeMessage({
            id: "u1",
            role: AIChatMessageRole.User,
            content: "Why is checkout down?",
            createdAt: CREATED_AT,
          }),
          makeMessage({
            id: "a1",
            role: AIChatMessageRole.Assistant,
            status: AIChatMessageStatus.Completed,
            content: "A dependency was failing.",
            createdAt: CREATED_AT,
          }),
        ],
        {
          title: "Checkout incident",
          latestRun: makeRun({ modelName: "gpt-test", toolCallCount: 2 }),
        },
      );

      const titleIndex: number = doc.indexOf("# Checkout incident");
      const youIndex: number = doc.indexOf("## You");
      const aiIndex: number = doc.indexOf("## AI");
      const footerIndex: number = doc.indexOf("gpt-test");

      expect(titleIndex).toBeGreaterThanOrEqual(0);
      expect(titleIndex).toBeLessThan(youIndex);
      expect(youIndex).toBeLessThan(aiIndex);
      expect(aiIndex).toBeLessThan(footerIndex);
    });
  });
});
