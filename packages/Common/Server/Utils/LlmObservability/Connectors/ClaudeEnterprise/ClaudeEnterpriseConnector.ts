import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectionKind } from "../../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmChatMessage,
  LlmChatPart,
  LlmChatPartType,
  LlmChatRole,
  LlmChatTurn,
  LlmConnectionPullState,
} from "../../../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmConnectionTestResult } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import {
  LlmChatFetchOptions,
  LlmChatFetchResult,
  LlmCompanyToolConnector,
  LlmConnectionSettings,
  LlmConnectorCallOptions,
  getSecretValues,
  readSetting,
} from "../../LlmConnectorTypes";
import LlmConnectorTestResults, {
  LLM_CONNECTION_TEST_DAYS,
} from "../../LlmConnectorTestResults";
import { readArray, readObject, readText } from "../../LlmProviderHttp";
import ClaudeComplianceClient, {
  ClaudeChatsPage,
} from "./ClaudeComplianceClient";

/*
 * Claude Enterprise: every claude.ai chat of the organization, read through
 * the Compliance API, as conversations by person. Each answer becomes one
 * AI call carrying the questions asked since the previous answer
 * (LlmChatSpanPayload); a question that has had no answer for an hour is
 * imported on its own, so a chat Claude never answered still shows.
 *
 * Read by the chats' update time, oldest first: a chat comes back whenever
 * it gets a new message, and its turns already imported are recognized by
 * their ids. claude.ai is paid per seat, so these calls carry no tokens and
 * no cost.
 */

// How far before the cursor each read starts again, for late updates.
const CURSOR_OVERLAP_IN_MS: number = 10 * 60 * 1000;
// A question with no answer for this long is imported without one.
const UNANSWERED_AFTER_IN_MS: number = 60 * 60 * 1000;

export default class ClaudeEnterpriseConnector
  implements LlmCompanyToolConnector
{
  public provider: LlmConnectionProvider =
    LlmConnectionProvider.ClaudeEnterprise;
  public kind: LlmConnectionKind.CompanyTool = LlmConnectionKind.CompanyTool;

  public validateSettings(settings: LlmConnectionSettings): void {
    ClaudeComplianceClient.validateKey(
      readSetting(settings.secrets, "complianceAccessKey"),
    );
  }

  private createClient(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): ClaudeComplianceClient {
    return new ClaudeComplianceClient({
      complianceAccessKey: readSetting(settings.secrets, "complianceAccessKey"),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  // The text of a tool result: a string, or a list of text blocks.
  private static readToolResult(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    return readArray(content)
      .map((block: unknown): string => {
        return readText(readObject(block)["text"]);
      })
      .filter((text: string): boolean => {
        return text.length > 0;
      })
      .join("\n");
  }

  public static readMessage(raw: JSONObject): LlmChatMessage | null {
    const id: string = readText(raw["id"]);
    const role: string = readText(raw["role"]);
    const createdAt: number = Date.parse(readText(raw["created_at"]));

    if (
      !id ||
      (role !== "user" && role !== "assistant") ||
      !Number.isFinite(createdAt)
    ) {
      return null;
    }

    const parts: Array<LlmChatPart> = [];

    for (const rawBlock of readArray(raw["content"])) {
      const block: JSONObject = readObject(rawBlock);
      const type: string = readText(block["type"]);

      if (type === "text") {
        const text: string = typeof block["text"] === "string" ? block["text"] : "";

        if (text) {
          parts.push({ type: LlmChatPartType.Text, text });
        }
      } else if (type === "tool_use") {
        parts.push({
          type: LlmChatPartType.ToolCall,
          text:
            block["input"] === undefined ? "" : JSON.stringify(block["input"]),
          toolCallId: readText(block["id"]),
          toolName: readText(block["name"]),
        });
      } else if (type === "tool_result") {
        parts.push({
          type: LlmChatPartType.ToolResult,
          text: ClaudeEnterpriseConnector.readToolResult(block["content"]),
          toolCallId: readText(block["tool_use_id"]),
        });
      }
    }

    // Files are named, never copied.
    for (const listName of ["files", "generated_files"]) {
      for (const rawFile of readArray(raw[listName])) {
        const filename: string = readText(readObject(rawFile)["filename"]);

        if (filename) {
          parts.push({ type: LlmChatPartType.File, text: filename });
        }
      }
    }

    for (const rawArtifact of readArray(raw["artifacts"])) {
      const title: string = readText(readObject(rawArtifact)["title"]);

      if (title) {
        parts.push({ type: LlmChatPartType.File, text: title });
      }
    }

    return {
      id,
      role: role === "assistant" ? LlmChatRole.Assistant : LlmChatRole.User,
      createdAt: new Date(createdAt),
      parts,
    };
  }

  /*
   * A chat's messages as turns: each answer with the questions since the
   * previous one. Questions still waiting for an answer are left for a
   * later read, unless they have waited UNANSWERED_AFTER_IN_MS.
   */
  public static buildTurns(data: {
    chat: JSONObject;
    messages: Array<JSONObject>;
    now: Date;
  }): Array<LlmChatTurn> {
    const user: JSONObject = readObject(data.chat["user"]);
    const base: Omit<
      LlmChatTurn,
      "turnId" | "startedAt" | "endedAt" | "question" | "answer"
    > = {
      conversationId: readText(data.chat["id"]),
      conversationTitle: readText(data.chat["name"]),
      personEmail: readText(user["email_address"]),
      personId: readText(user["id"]),
      personName: "",
      model: readText(data.chat["model"]) || "claude",
      app: "",
      url: readText(data.chat["href"]),
    };

    const messages: Array<LlmChatMessage> = data.messages
      .map(ClaudeEnterpriseConnector.readMessage)
      .filter((message: LlmChatMessage | null): message is LlmChatMessage => {
        return message !== null;
      })
      .sort((a: LlmChatMessage, b: LlmChatMessage): number => {
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    const turns: Array<LlmChatTurn> = [];
    let pending: Array<LlmChatMessage> = [];

    for (const message of messages) {
      if (message.role === LlmChatRole.User) {
        pending.push(message);
        continue;
      }

      turns.push({
        ...base,
        turnId: message.id,
        startedAt: (pending[0] || message).createdAt,
        endedAt: message.createdAt,
        question: pending,
        answer: [message],
      });
      pending = [];
    }

    const lastQuestion: LlmChatMessage | undefined =
      pending[pending.length - 1];

    if (
      lastQuestion &&
      data.now.getTime() - lastQuestion.createdAt.getTime() >=
        UNANSWERED_AFTER_IN_MS
    ) {
      turns.push({
        ...base,
        turnId: lastQuestion.id,
        startedAt: pending[0]!.createdAt,
        endedAt: lastQuestion.createdAt,
        question: pending,
        answer: [],
      });
    }

    return turns;
  }

  public async fetchChats(
    settings: LlmConnectionSettings,
    options: LlmChatFetchOptions,
  ): Promise<LlmChatFetchResult> {
    const client: ClaudeComplianceClient = this.createClient(settings, options);
    const startedAt: number = Date.now();
    const now: Date = options.now ? options.now() : new Date();
    const cursor: number = Date.parse(options.state.cursor || "");
    const since: Date = Number.isFinite(cursor)
      ? new Date(cursor - CURSOR_OVERLAP_IN_MS)
      : options.backfillStart;

    const turns: Array<LlmChatTurn> = [];
    const deletedConversationIds: Array<string> = [];
    const warnings: Array<string> = [];
    let lastDone: string = options.state.cursor || "";
    let complete: boolean = true;
    let afterId: string = "";

    for (;;) {
      const page: ClaudeChatsPage = await client.listChats({
        updatedSince: since,
        afterId,
      });

      for (const chat of page.chats) {
        if (
          client.getRequestCount() >= options.maxRequests ||
          Date.now() - startedAt >= options.maxDurationMs
        ) {
          complete = false;
          break;
        }

        const chatId: string = readText(chat["id"]);
        const updatedAt: string = readText(chat["updated_at"]);

        if (!chatId) {
          continue;
        }

        if (readText(chat["deleted_at"])) {
          deletedConversationIds.push(chatId);
        } else {
          const read: { messages: Array<JSONObject>; complete: boolean } =
            await client.listChatMessages(chatId);

          if (!read.complete) {
            warnings.push(
              "A chat is longer than one read takes; its newest messages are imported by a later read.",
            );
          }

          turns.push(
            ...ClaudeEnterpriseConnector.buildTurns({
              chat,
              messages: read.messages,
              now,
            }),
          );
        }

        if (updatedAt && (!lastDone || Date.parse(updatedAt) > Date.parse(lastDone))) {
          lastDone = updatedAt;
        }
      }

      if (!complete || !page.hasMore || !page.lastId || page.lastId === afterId) {
        break;
      }

      afterId = page.lastId;
    }

    const nextState: LlmConnectionPullState = {
      cursor: lastDone || since.toISOString(),
    };

    return {
      turns,
      deletedConversationIds,
      complete,
      nextState,
      requestCount: client.getRequestCount(),
      warnings: Array.from(new Set(warnings)),
    };
  }

  public async testConnection(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): Promise<LlmConnectionTestResult> {
    const startedAt: number = Date.now();
    const now: Date = options.now ? options.now() : new Date();

    try {
      this.validateSettings(settings);
      const client: ClaudeComplianceClient = this.createClient(settings, options);

      // Counts only: a test never reads what anyone wrote.
      const page: ClaudeChatsPage = await client.listChats({
        updatedSince: new Date(
          now.getTime() - LLM_CONNECTION_TEST_DAYS * 24 * 60 * 60 * 1000,
        ),
      });
      const people: Set<string> = new Set<string>();

      for (const chat of page.chats) {
        const user: JSONObject = readObject(chat["user"]);
        const person: string =
          readText(user["email_address"]) || readText(user["id"]);

        if (person) {
          people.add(person);
        }
      }

      return LlmConnectorTestResults.fromChats({
        provider: this.provider,
        conversations: page.chats.length,
        people: people.size,
        days: LLM_CONNECTION_TEST_DAYS,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      return LlmConnectorTestResults.fromError({
        provider: this.provider,
        error,
        secretValues: getSecretValues(settings),
        durationMs: Date.now() - startedAt,
      });
    }
  }
}
