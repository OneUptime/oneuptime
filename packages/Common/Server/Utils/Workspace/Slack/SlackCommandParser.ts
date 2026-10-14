import type { SlackAction } from "./Actions/Auth";
import SlackActionType from "./Actions/ActionTypes";
import WorkspaceCommands, {
  WorkspaceCommandInput,
  WorkspaceCommandName,
} from "../WorkspaceCommands";
import { WorkspacePageToken } from "../WorkspacePageText";

/*
 * A SLASH COMMAND, AS SLACK SENDS IT AND AS ONEUPTIME READS IT.
 *
 * OneUptime's Slack app has one command, /oneuptime, and its words
 * (WorkspaceCommands): /oneuptime incident Checkout is down. Apps created
 * from a manifest before that also have /incident and /maintenance, which
 * Slack still sends - to /api/slack/interactive, where they always went -
 * until the app is updated: everything after them is the form's title, as
 * it always was.
 *
 * Slack sends a command's text with "&", "<" and ">" written as "&amp;",
 * "&lt;" and "&gt;", and, with escaping on, people and channels as
 * <@U0123|name> and <#C0123|name>: a form's title and a question are read as
 * they were typed (toPlainText). The text as Slack sent it stays at hand for
 * a command that needs the ids in it (rawText): `/oneuptime page @nawaz`
 * pages the person behind <@U0123|nawaz> (getPageTokens).
 */

// The commands of apps created from a manifest that still had them.
export const LEGACY_SLACK_COMMANDS: Readonly<
  Record<string, WorkspaceCommandName>
> = {
  "/incident": WorkspaceCommandName.Incident,
  "/maintenance": WorkspaceCommandName.Maintenance,
};

// A slash command, read.
export interface SlackCommandRequest {
  // The command as Slack sent it: "/oneuptime", or an old app's "/incident".
  command: string;
  /*
   * The command OneUptime's words follow in this workspace: "/oneuptime" -
   * the command as sent, unless it is an old app's /incident or /maintenance.
   */
  baseCommand: string;
  // Whether it is an old app's /incident or /maintenance.
  isLegacy: boolean;
  // What follows the command, read as one of OneUptime's commands.
  input: WorkspaceCommandInput;
  // What follows the command, as Slack sent it.
  rawText: string;
}

// A Slack token in text: <@U0123|name>, <#C0123|name>, <!here>, <https://...|label>.
const SLACK_TOKEN: RegExp = /<([^<>\n]*)>/g;

const LEADING_AT: RegExp = /^@/;
const LEADING_HASH: RegExp = /^#/;

// One character of white space.
const WHITE_SPACE_CHARACTER: RegExp = /\s/;

const ENTITY_LESS_THAN: RegExp = /&lt;/g;
const ENTITY_GREATER_THAN: RegExp = /&gt;/g;
const ENTITY_AMPERSAND: RegExp = /&amp;/g;

export default class SlackCommandParser {
  // Reads a slash command from the fields Slack posts: `command` and `text`.
  public static read(data: {
    command: unknown;
    text: unknown;
  }): SlackCommandRequest {
    const command: string =
      typeof data.command === "string" ? data.command.trim().toLowerCase() : "";
    const rawText: string = typeof data.text === "string" ? data.text : "";
    const text: string = SlackCommandParser.toPlainText(rawText);

    const legacy: WorkspaceCommandName | undefined =
      Object.prototype.hasOwnProperty.call(LEGACY_SLACK_COMMANDS, command)
        ? LEGACY_SLACK_COMMANDS[command]
        : undefined;

    if (legacy) {
      // Everything after an old command is its form's title.
      return {
        command: command,
        baseCommand: WorkspaceCommands.SLACK_COMMAND,
        isLegacy: true,
        input: { command: legacy, text: text.trim() },
        rawText: rawText,
      };
    }

    return {
      command: command || WorkspaceCommands.SLACK_COMMAND,
      baseCommand: WorkspaceCommands.getSlackCommand(command),
      isLegacy: false,
      input: WorkspaceCommands.parse(text),
      rawText: rawText,
    };
  }

  /*
   * How the command was typed, without what followed it, for an answer
   * that asks to run it again: "/oneuptime incident", or an old app's
   * "/incident" - each person is told the command their app has.
   */
  public static getTypedCommand(request: SlackCommandRequest): string {
    if (request.isLegacy || !request.input.command) {
      return request.command;
    }

    return `${request.baseCommand} ${request.input.command}`;
  }

  /*
   * The action a command asks for, as a press is read (SlackAuthAction):
   * the New Incident or New Scheduled Maintenance form with its title, who
   * is on call - or, for anything else, the command itself, which
   * /api/slack/command answers (SlackCommandActions).
   */
  public static getAction(request: SlackCommandRequest): SlackAction {
    const typed: string = SlackCommandParser.getTypedCommand(request);

    switch (request.input.command) {
      case WorkspaceCommandName.Incident:
        return {
          actionType: SlackActionType.NewIncident,
          actionValue: WorkspaceCommands.toTitle(request.input.text),
          command: typed,
        };
      case WorkspaceCommandName.Maintenance:
        return {
          actionType: SlackActionType.NewScheduledMaintenance,
          actionValue: WorkspaceCommands.toTitle(request.input.text),
          command: typed,
        };
      case WorkspaceCommandName.OnCall:
        return {
          actionType: SlackActionType.ShowOnCall,
          actionValue: "",
          command: typed,
        };
      case WorkspaceCommandName.Page:
        // As Slack sent it: the people are read from their ids.
        return {
          actionType: SlackActionType.PageSomeone,
          actionValue: request.rawText,
          command: typed,
        };
      default:
        return {
          actionType: request.command as SlackActionType,
          actionValue: request.rawText,
          command: request.command,
        };
    }
  }

  /*
   * What follows the command's first word - "page" - as tokens
   * (WorkspacePageText): each person Slack wrote as <@U0123|nawaz>, each
   * user group as <!subteam^S0123|@oncall-db> - with its id, S0123 - and
   * @here / @channel as a group, and everything else as text, read as typed
   * (toPlainText).
   */
  public static getPageTokens(rawText: string): Array<WorkspacePageToken> {
    const tokens: Array<WorkspacePageToken> = [];
    const text: string = SlackCommandParser.withoutFirstWord(rawText || "");

    let textStart: number = 0;

    const addText: (raw: string) => void = (raw: string): void => {
      const plain: string = SlackCommandParser.toPlainText(raw);

      if (!plain) {
        return;
      }

      const last: WorkspacePageToken | undefined = tokens[tokens.length - 1];

      if (last && last.kind === "text") {
        last.text += plain;
        return;
      }

      tokens.push({ kind: "text", text: plain });
    };

    for (const match of text.matchAll(SLACK_TOKEN)) {
      const start: number = match.index || 0;
      const inner: string = match[1] || "";
      const token: WorkspacePageToken | null =
        SlackCommandParser.readPageToken(inner);

      if (!token) {
        continue;
      }

      addText(text.substring(textStart, start));
      tokens.push(token);
      textStart = start + match[0].length;
    }

    addText(text.substring(textStart));

    return tokens;
  }

  /*
   * A person or a group, from a token's inside: "@U0123|nawaz",
   * "!subteam^S0123|@oncall-db", "!here". Null for anything else - a
   * channel, a link, a date - which is read as text.
   */
  private static readPageToken(inner: string): WorkspacePageToken | null {
    const separator: number = inner.indexOf("|");
    const target: string = separator === -1 ? inner : inner.slice(0, separator);
    const label: string = separator === -1 ? "" : inner.slice(separator + 1);

    if (target.startsWith("@") && target.length > 1) {
      return {
        kind: "person",
        person: {
          workspaceUserId: target.slice(1),
          name: label.replace(LEADING_AT, ""),
        },
      };
    }

    if (target.startsWith("!subteam^")) {
      const groupId: string = target.slice("!subteam^".length);

      return {
        kind: "group",
        name: label.replace(LEADING_AT, "") || groupId,
        workspaceGroupId: groupId,
      };
    }

    if (target === "!here" || target === "!channel" || target === "!everyone") {
      return { kind: "group", name: target.slice(1) };
    }

    return null;
  }

  // The text after its first word: "page <@U0123> hi" is "<@U0123> hi".
  private static withoutFirstWord(text: string): string {
    let start: number = 0;

    while (start < text.length && WHITE_SPACE_CHARACTER.test(text[start]!)) {
      start++;
    }

    while (start < text.length && !WHITE_SPACE_CHARACTER.test(text[start]!)) {
      start++;
    }

    return text.substring(start);
  }

  /*
   * Text as it was typed, from text as Slack sends it: a person, a channel
   * or a group by its name ("@nawaz", "#ops", "@here"), a link by its label,
   * and "&", "<" and ">" for their escapes.
   */
  public static toPlainText(text: string): string {
    if (!text) {
      return "";
    }

    return text
      .replace(SLACK_TOKEN, (_token: string, inner: string): string => {
        return SlackCommandParser.readToken(inner);
      })
      .replace(ENTITY_LESS_THAN, "<")
      .replace(ENTITY_GREATER_THAN, ">")
      .replace(ENTITY_AMPERSAND, "&");
  }

  // One token's text: "@U0123|nawaz" reads "@nawaz", "!here" reads "@here".
  private static readToken(inner: string): string {
    const separator: number = inner.indexOf("|");
    const target: string = separator === -1 ? inner : inner.slice(0, separator);
    const label: string = separator === -1 ? "" : inner.slice(separator + 1);

    if (target.startsWith("@")) {
      return label ? `@${label.replace(LEADING_AT, "")}` : target;
    }

    if (target.startsWith("#")) {
      return label ? `#${label.replace(LEADING_HASH, "")}` : target;
    }

    // <!date^1760290080^{time}|17:28 UTC>: a date, by its fallback.
    if (target.startsWith("!date")) {
      return label;
    }

    if (target.startsWith("!")) {
      // <!subteam^S0123|@oncall>, <!here>, <!channel>, <!everyone>.
      if (label) {
        return `@${label.replace(LEADING_AT, "")}`;
      }

      return `@${target.slice(1).split("^")[0]}`;
    }

    return label || target;
  }
}
