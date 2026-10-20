import {
  removeMarkupFromText,
  replaceHtmlMarkup,
} from "../../../../../Types/HtmlMarkup";
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
import EntraTokenClient from "../Microsoft/EntraTokenClient";
import GraphCopilotClient, { GraphPerson } from "./GraphCopilotClient";

/*
 * Microsoft 365 Copilot: what each person asked Copilot - in Teams, Outlook,
 * Word, Excel, PowerPoint, Loop or Copilot Chat - and what it answered, read
 * from Microsoft Graph's Copilot interaction history one person at a time.
 * A prompt and the answers to it share a requestId, and become one AI call;
 * a conversation is Copilot's sessionId.
 *
 * A read covers one time window for everyone. A tenant too big for one read
 * is read in parts: the read remembers the window and the next person, and
 * the next read carries on from there before it moves the window on. A
 * prompt with no answer for an hour is imported on its own.
 *
 * Copilot is paid per seat, so these calls carry no tokens and no cost.
 */

// How far before the cursor each new window starts, for late interactions.
const WINDOW_OVERLAP_IN_MS: number = 2 * 60 * 60 * 1000;
// A prompt with no answer for this long is imported without one.
const UNANSWERED_AFTER_IN_MS: number = 60 * 60 * 1000;

export const MICROSOFT_365_COPILOT_MODEL: string = "Microsoft 365 Copilot";

/*
 * Where an interaction happened, from its appClass
 * ("IPM.SkypeTeams.Message.Copilot.<App>"), in the words people know.
 */
const APP_NAMES: Record<string, string> = {
  teams: "Teams",
  bizchat: "Copilot Chat",
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
  outlook: "Outlook",
  loop: "Loop",
  onenote: "OneNote",
  whiteboard: "Whiteboard",
  forms: "Forms",
  planner: "Planner",
  stream: "Stream",
  sharepoint: "SharePoint",
  edge: "Edge",
  webchat: "Copilot Chat",
};

const ADAPTIVE_CARD_TYPE: string = "application/vnd.microsoft.card.adaptive";

/*
 * How Copilot's HTML reads as text: these tags end a line wherever they
 * are (a break, a paragraph, a block, a list as a whole)...
 */
const LINE_ENDING_TAGS: Set<string> = new Set<string>([
  "br",
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "ul",
  "ol",
  "table",
]);
// ...these start one (a list item, a table row)...
const LINE_STARTING_TAGS: Set<string> = new Set<string>(["li", "tr"]);
// ...and these are a table's cells, set apart by a space.
const CELL_TAGS: Set<string> = new Set<string>(["td", "th"]);

export default class Microsoft365CopilotConnector
  implements LlmCompanyToolConnector
{
  public provider: LlmConnectionProvider =
    LlmConnectionProvider.Microsoft365Copilot;
  public kind: LlmConnectionKind.CompanyTool = LlmConnectionKind.CompanyTool;

  public validateSettings(settings: LlmConnectionSettings): void {
    EntraTokenClient.validateTenantId(readSetting(settings.config, "tenantId"));
    EntraTokenClient.validateGuid(
      readSetting(settings.config, "clientId"),
      "Application (client) ID",
    );
    EntraTokenClient.resolveCloud(readSetting(settings.config, "cloud"));

    const groupId: string = readSetting(settings.config, "groupId");

    if (groupId) {
      EntraTokenClient.validateGuid(groupId, "Group object ID");
    }
  }

  private createClient(
    settings: LlmConnectionSettings,
    options: LlmConnectorCallOptions,
  ): GraphCopilotClient {
    return new GraphCopilotClient({
      tenantId: readSetting(settings.config, "tenantId"),
      clientId: readSetting(settings.config, "clientId"),
      clientSecret: readSetting(settings.secrets, "clientSecret"),
      cloud: EntraTokenClient.resolveCloud(
        readSetting(settings.config, "cloud"),
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  public static appNameOf(appClass: string): string {
    const last: string = (appClass || "").split(".").pop() || "";
    return APP_NAMES[last.toLowerCase()] || last;
  }

  // A tag's name as written ("<br/>" -> "br", "</P>" -> "p"); "" for a comment.
  public static tagNameOf(markup: string): string {
    let index: number = markup.charAt(1) === "/" ? 2 : 1;
    let name: string = "";

    while (index < markup.length) {
      const code: number = markup.charCodeAt(index);
      const isNameCharacter: boolean =
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a);

      if (!isNameCharacter) {
        break;
      }

      name += markup.charAt(index);
      index++;
    }

    return name.toLowerCase();
  }

  /*
   * Copilot's HTML as lines of text: paragraphs and line breaks end a line,
   * list items and table rows start one, cells are set apart, every other
   * tag goes, script and style go whole, and blank lines are kept one at a
   * time.
   */
  public static readHtmlText(html: string): string {
    const text: string = replaceHtmlMarkup(
      html,
      (markup: string): string => {
        const name: string = Microsoft365CopilotConnector.tagNameOf(markup);
        const isEndTag: boolean = markup.charAt(1) === "/";

        if (LINE_ENDING_TAGS.has(name)) {
          return "\n";
        }

        if (!isEndTag && LINE_STARTING_TAGS.has(name)) {
          return "\n";
        }

        if (!isEndTag && CELL_TAGS.has(name)) {
          return " ";
        }

        return "";
      },
      { rawTextElements: true },
    );

    const lines: Array<string> = [];

    for (const rawLine of text.split("\n")) {
      const line: string = rawLine.trim();

      if (line || (lines.length > 0 && lines[lines.length - 1] !== "")) {
        lines.push(line);
      }
    }

    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    return lines.join("\n");
  }

  // The few entities Copilot's HTML uses, read back as the characters they are.
  public static decodeEntities(text: string): string {
    return text
      .split("&nbsp;")
      .join(" ")
      .split("&lt;")
      .join("<")
      .split("&gt;")
      .join(">")
      .split("&quot;")
      .join('"')
      .split("&#39;")
      .join("'")
      .split("&amp;")
      .join("&");
  }

  /*
   * The text blocks of an adaptive card, in order: Copilot often answers
   * with a card whose body holds the answer, the message body holding only
   * an <attachment> placeholder. The block Copilot names MessageTextField is
   * the answer itself, when there is one.
   */
  public static readAdaptiveCardText(content: unknown): string {
    let card: unknown = content;

    if (typeof content === "string") {
      try {
        card = JSON.parse(content);
      } catch {
        return "";
      }
    }

    const texts: Array<string> = [];
    let messageField: string = "";
    const stack: Array<unknown> = [card];
    let visited: number = 0;

    while (stack.length > 0 && visited < 5000) {
      visited++;
      const node: unknown = stack.pop();

      if (Array.isArray(node)) {
        for (let index: number = node.length - 1; index >= 0; index--) {
          stack.push(node[index]);
        }
        continue;
      }

      const object: JSONObject = readObject(node);

      if (readText(object["type"]) === "TextBlock") {
        const text: string = readText(object["text"]);

        if (text) {
          if (readText(object["id"]) === "MessageTextField") {
            messageField = text;
          }

          texts.push(text);
        }
      }

      for (const key of ["body", "items", "columns", "rows", "cells"]) {
        if (object[key] !== undefined) {
          stack.push(object[key]);
        }
      }
    }

    return messageField || texts.join("\n\n");
  }

  // What an interaction said, as plain text.
  public static readInteractionText(interaction: JSONObject): string {
    const body: JSONObject = readObject(interaction["body"]);
    const content: string = readText(body["content"]);
    const isHtml: boolean =
      readText(body["contentType"]).toLowerCase() === "html";
    /*
     * Plain text still carries <attachment> placeholders; it loses only real
     * tags, so a "<" a person typed ("latency < 200ms") stays.
     */
    const text: string = Microsoft365CopilotConnector.decodeEntities(
      isHtml
        ? Microsoft365CopilotConnector.readHtmlText(content)
        : removeMarkupFromText(content),
    ).trim();

    if (text) {
      return text;
    }

    for (const rawAttachment of readArray(interaction["attachments"])) {
      const attachment: JSONObject = readObject(rawAttachment);

      if (readText(attachment["contentType"]) === ADAPTIVE_CARD_TYPE) {
        const cardText: string =
          Microsoft365CopilotConnector.readAdaptiveCardText(
            attachment["content"],
          );

        if (cardText) {
          return cardText;
        }
      }
    }

    return "";
  }

  private static toMessage(
    interaction: JSONObject,
    role: LlmChatRole,
  ): LlmChatMessage | null {
    const id: string = readText(interaction["id"]);
    const createdAt: number = Date.parse(
      readText(interaction["createdDateTime"]),
    );

    if (!id || !Number.isFinite(createdAt)) {
      return null;
    }

    const parts: Array<LlmChatPart> = [];
    const text: string =
      Microsoft365CopilotConnector.readInteractionText(interaction);

    if (text) {
      parts.push({ type: LlmChatPartType.Text, text });
    }

    // Files and pages the interaction referenced: named, never read.
    for (const rawLink of readArray(interaction["links"])) {
      const name: string = readText(readObject(rawLink)["displayName"]);

      if (name) {
        parts.push({ type: LlmChatPartType.File, text: name });
      }
    }

    return { id, role, createdAt: new Date(createdAt), parts };
  }

  /*
   * One person's interactions as turns: everything that shares a requestId
   * is one turn, its prompts the question and its answers the answer.
   */
  public static buildTurns(data: {
    person: GraphPerson;
    interactions: Array<JSONObject>;
    now: Date;
  }): Array<LlmChatTurn> {
    const groups: Map<string, Array<JSONObject>> = new Map();

    for (const interaction of data.interactions) {
      const key: string =
        readText(interaction["requestId"]) || readText(interaction["id"]);

      if (!key) {
        continue;
      }

      const group: Array<JSONObject> = groups.get(key) || [];
      group.push(interaction);
      groups.set(key, group);
    }

    const turns: Array<LlmChatTurn> = [];

    for (const [requestId, group] of groups) {
      const question: Array<LlmChatMessage> = [];
      const answer: Array<LlmChatMessage> = [];

      for (const interaction of group) {
        const isPrompt: boolean =
          readText(interaction["interactionType"]) === "userPrompt";
        const message: LlmChatMessage | null =
          Microsoft365CopilotConnector.toMessage(
            interaction,
            isPrompt ? LlmChatRole.User : LlmChatRole.Assistant,
          );

        if (message) {
          (isPrompt ? question : answer).push(message);
        }
      }

      const byTime: (a: LlmChatMessage, b: LlmChatMessage) => number = (
        a: LlmChatMessage,
        b: LlmChatMessage,
      ): number => {
        return a.createdAt.getTime() - b.createdAt.getTime();
      };

      question.sort(byTime);
      answer.sort(byTime);

      const first: LlmChatMessage | undefined = question[0] || answer[0];
      const last: LlmChatMessage | undefined =
        answer[answer.length - 1] || question[question.length - 1];

      if (!first || !last) {
        continue;
      }

      // A prompt whose answer has not been recorded yet waits a while.
      if (
        answer.length === 0 &&
        data.now.getTime() - last.createdAt.getTime() < UNANSWERED_AFTER_IN_MS
      ) {
        continue;
      }

      const sample: JSONObject = group[0]!;

      turns.push({
        turnId: requestId,
        conversationId: readText(sample["sessionId"]) || requestId,
        conversationTitle: "",
        personEmail: data.person.email,
        personId: data.person.id,
        personName: data.person.name,
        model: MICROSOFT_365_COPILOT_MODEL,
        app: Microsoft365CopilotConnector.appNameOf(
          readText(sample["appClass"]),
        ),
        startedAt: first.createdAt,
        endedAt: last.createdAt,
        question,
        answer,
        url: "",
      });
    }

    return turns.sort((a: LlmChatTurn, b: LlmChatTurn): number => {
      return a.startedAt.getTime() - b.startedAt.getTime();
    });
  }

  public async fetchChats(
    settings: LlmConnectionSettings,
    options: LlmChatFetchOptions,
  ): Promise<LlmChatFetchResult> {
    const client: GraphCopilotClient = this.createClient(settings, options);
    const startedAt: number = Date.now();
    const now: Date = options.now ? options.now() : new Date();

    // Resume a window a previous read stopped in, or open the next one.
    const resuming: boolean = Boolean(
      options.state.windowStart && options.state.windowEnd,
    );
    const cursor: number = Date.parse(options.state.cursor || "");
    const windowStart: Date = resuming
      ? new Date(options.state.windowStart!)
      : Number.isFinite(cursor)
        ? new Date(cursor - WINDOW_OVERLAP_IN_MS)
        : options.backfillStart;
    const windowEnd: Date = resuming
      ? new Date(options.state.windowEnd!)
      : options.windowEnd;

    if (windowEnd.getTime() <= windowStart.getTime()) {
      return {
        turns: [],
        deletedConversationIds: [],
        complete: true,
        nextState: { cursor: options.state.cursor },
        requestCount: 0,
        warnings: [],
      };
    }

    const people: Array<GraphPerson> = await client.listPeople(
      readSetting(settings.config, "groupId"),
    );
    const turns: Array<LlmChatTurn> = [];
    let index: number = resuming
      ? Math.max(0, options.state.nextIndex || 0)
      : 0;

    for (; index < people.length; index++) {
      if (
        client.getRequestCount() >= options.maxRequests ||
        Date.now() - startedAt >= options.maxDurationMs
      ) {
        const nextState: LlmConnectionPullState = {
          cursor: options.state.cursor,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          nextIndex: index,
        };

        return {
          turns,
          deletedConversationIds: [],
          complete: false,
          nextState,
          requestCount: client.getRequestCount(),
          warnings: [],
        };
      }

      const person: GraphPerson = people[index]!;
      const interactions: Array<JSONObject> = await client.listInteractions({
        userId: person.id,
        startTime: windowStart,
        endTime: windowEnd,
      });

      turns.push(
        ...Microsoft365CopilotConnector.buildTurns({
          person,
          interactions,
          now,
        }),
      );
    }

    return {
      turns,
      deletedConversationIds: [],
      complete: true,
      nextState: { cursor: windowEnd.toISOString() },
      requestCount: client.getRequestCount(),
      warnings: [],
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
      const client: GraphCopilotClient = this.createClient(settings, options);
      const people: Array<GraphPerson> = await client.listPeople(
        readSetting(settings.config, "groupId"),
      );

      /*
       * Reading one person's interactions proves the Copilot permission
       * without reading everyone's. Counts only: nothing anyone wrote is
       * returned.
       */
      let conversations: number = 0;

      if (people.length > 0) {
        const interactions: Array<JSONObject> = await client.listInteractions({
          userId: people[0]!.id,
          startTime: new Date(
            now.getTime() - LLM_CONNECTION_TEST_DAYS * 24 * 60 * 60 * 1000,
          ),
          endTime: now,
        });

        conversations = new Set(
          interactions.map((interaction: JSONObject): string => {
            return readText(interaction["sessionId"]);
          }),
        ).size;
      }

      return LlmConnectorTestResults.fromChats({
        provider: this.provider,
        conversations,
        people: people.length,
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
