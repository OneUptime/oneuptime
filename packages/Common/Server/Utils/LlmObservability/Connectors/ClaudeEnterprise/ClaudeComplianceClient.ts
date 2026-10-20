import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmProviderHttp";

/*
 * Anthropic's Compliance API for Claude Enterprise, the two reads the Claude
 * Enterprise connection makes with a Compliance Access Key that has the
 * read:compliance_user_data scope:
 *
 *   GET /v1/compliance/apps/chats?order_by=updated_at&updated_at.gte=...
 *       &limit=...&after_id=...
 *     -> { data: [{ id, name, created_at, updated_at, deleted_at, href,
 *          model, user: { id, email_address } }], has_more, last_id }
 *   GET /v1/compliance/apps/chats/{id}/messages?limit=...&after_id=...
 *     -> { ..., chat_messages: [{ id, role, created_at, content: [{ type,
 *          text } | tool_use | tool_result], files: [{ filename }] }],
 *          has_more, last_id }
 *
 * From Anthropic's Compliance API guide: chats sort ascending by the order_by
 * field, a chat comes back when it gets a new message (so `updated_at` is
 * the cursor of an export kept current), a deleted chat comes back with
 * deleted_at set and no content, every endpoint shares 600 requests a minute
 * per organization, and the key is sent in x-api-key with
 * anthropic-version 2023-06-01. Nothing is ever deleted through it: the
 * connection asks for a read scope only.
 */

export const CLAUDE_COMPLIANCE_BASE_URL: string = "https://api.anthropic.com/v1";
const API_VERSION: string = "2023-06-01";
const CHATS_PAGE_LIMIT: number = 100;
const MESSAGES_PAGE_LIMIT: number = 100;
// A chat longer than this is read up to here; the rest waits for a later read.
const MAX_MESSAGE_PAGES: number = 10;
const PROVIDER_TITLE: string = "Claude Enterprise";

export interface ClaudeChatsPage {
  chats: Array<JSONObject>;
  hasMore: boolean;
  lastId: string;
}

export interface ClaudeComplianceClientOptions {
  complianceAccessKey: string;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  baseUrl?: string | undefined;
}

export default class ClaudeComplianceClient {
  private options: ClaudeComplianceClientOptions;
  private requestCount: number = 0;

  public constructor(options: ClaudeComplianceClientOptions) {
    ClaudeComplianceClient.validateKey(options.complianceAccessKey);
    this.options = options;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * A Compliance Access Key starts with sk-ant-api01-. An admin key
   * (sk-ant-admin01-) reaches only the activity feed, never chats.
   */
  public static validateKey(key: string): void {
    const trimmed: string = (key || "").trim();

    if (!trimmed) {
      throw new BadDataException("Compliance access key is required.");
    }

    if (trimmed.startsWith("sk-ant-admin")) {
      throw new BadDataException(
        "This is an Anthropic admin key, which cannot read chats. Create a compliance access key in claude.ai (Organization settings, API), with the read:compliance_user_data scope.",
      );
    }

    if (!trimmed.startsWith("sk-ant-")) {
      throw new BadDataException(
        "A Claude compliance access key starts with sk-ant-api01-.",
      );
    }
  }

  private getHeaders(): Dictionary<string> {
    return {
      "x-api-key": this.options.complianceAccessKey.trim(),
      "anthropic-version": API_VERSION,
      Accept: "application/json",
    };
  }

  private async get(path: string, query: string, step: string): Promise<JSONObject> {
    this.requestCount++;

    return await LlmProviderHttp.requestJson({
      transport: this.options.transport,
      method: "GET",
      url: `${this.options.baseUrl || CLAUDE_COMPLIANCE_BASE_URL}${path}${
        query ? `?${query}` : ""
      }`,
      headers: this.getHeaders(),
      timeoutInMs: this.options.requestTimeoutInMs,
      step: step,
      providerTitle: PROVIDER_TITLE,
      secretValues: [this.options.complianceAccessKey],
    });
  }

  // One page of chats updated at or after `updatedSince`, oldest first.
  public async listChats(data: {
    updatedSince: Date;
    afterId?: string | undefined;
    limit?: number | undefined;
  }): Promise<ClaudeChatsPage> {
    const response: JSONObject = await this.get(
      "/compliance/apps/chats",
      buildQueryString([
        ["order_by", "updated_at"],
        ["updated_at.gte", data.updatedSince.toISOString()],
        ["limit", data.limit || CHATS_PAGE_LIMIT],
        ["after_id", data.afterId || ""],
      ]),
      "chats request",
    );

    return {
      chats: readArray(response["data"]).map(readObject),
      hasMore: response["has_more"] === true,
      lastId: readText(response["last_id"]),
    };
  }

  /*
   * A chat's messages, oldest first, as far as MAX_MESSAGE_PAGES pages go.
   * `complete` is false when the chat is longer than that.
   */
  public async listChatMessages(
    chatId: string,
  ): Promise<{ messages: Array<JSONObject>; complete: boolean }> {
    const messages: Array<JSONObject> = [];
    let afterId: string = "";

    for (let index: number = 0; index < MAX_MESSAGE_PAGES; index++) {
      const response: JSONObject = await this.get(
        `/compliance/apps/chats/${encodeURIComponent(chatId)}/messages`,
        buildQueryString([
          ["order", "asc"],
          ["limit", MESSAGES_PAGE_LIMIT],
          ["after_id", afterId],
        ]),
        "chat messages request",
      );

      messages.push(...readArray(response["chat_messages"]).map(readObject));

      const lastId: string = readText(response["last_id"]);

      if (response["has_more"] !== true || !lastId || lastId === afterId) {
        return { messages, complete: true };
      }

      afterId = lastId;
    }

    return { messages, complete: false };
  }
}
