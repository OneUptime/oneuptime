import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import ProductBrandingText from "../ProductBrandingText";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";

/*
 * ONE COMMAND IN SLACK, AND THE SAME WORDS IN MICROSOFT TEAMS.
 *
 * Slack's app registered /incident and /maintenance as commands of their
 * own. Other apps in a workspace register the same names, and only one of
 * them can have each (customer feedback #5: "Can we have a prefix namespace
 * e.g. /irm incident, /irm maintenance?"). Every command is now a word after
 * one command of OneUptime's own:
 *
 *   /oneuptime incident [title]       declare an incident
 *   /oneuptime maintenance [title]    schedule a maintenance event
 *   /oneuptime oncall                 who is on call right now
 *   /oneuptime ask [question]         ask OneUptime AI
 *   /oneuptime help                   every command, with examples
 *
 * Microsoft Teams has no slash commands: the same words are typed to the bot
 * ("@OneUptime incident Checkout is down" in a channel). Both read them here
 * (parse), and both list them from here (getHelpAnswer), so the two cannot
 * drift apart.
 *
 * How text is read:
 *
 *   - A command is its first word (or words, for "create incident"), in any
 *     case. What follows it is kept as typed: a form's title, a question.
 *   - A command that takes nothing after it - help, oncall - is that command
 *     only alone: "help me find slow queries" is a question.
 *   - Text that starts with no command is a question for OneUptime AI, as
 *     `/oneuptime <question>` always was.
 *   - A first word that is a command misspelt ("incidnet", "maintenence") is
 *     not sent to AI as a question: it is answered with the commands, and
 *     the one it looks like.
 */

export enum WorkspaceCommandName {
  Incident = "incident",
  Maintenance = "maintenance",
  OnCall = "oncall",
  Ask = "ask",
  Help = "help",
}

export interface WorkspaceCommandDefinition {
  name: WorkspaceCommandName;
  /*
   * What may follow the name, as the help names it: "title", written
   * "[title]". Empty for a command that takes nothing after it.
   */
  argument: string;
  // Other ways to type it, in lower case: "create incident".
  aliases: ReadonlyArray<string>;
  // What follows the name in the help's example; empty for no example.
  example: string;
}

/*
 * The commands, in the order the help lists them. Microsoft Teams took
 * "create incident" and "create maintenance" before the words were the same
 * in both chats, so those keep working, in both.
 */
export const WORKSPACE_COMMANDS: ReadonlyArray<WorkspaceCommandDefinition> = [
  {
    name: WorkspaceCommandName.Incident,
    argument: "title",
    aliases: ["create incident"],
    example: "Checkout is down",
  },
  {
    name: WorkspaceCommandName.Maintenance,
    argument: "title",
    aliases: ["create maintenance"],
    example: "Database upgrade",
  },
  {
    name: WorkspaceCommandName.OnCall,
    argument: "",
    aliases: ["on-call", "on call"],
    example: "",
  },
  {
    name: WorkspaceCommandName.Ask,
    argument: "question",
    aliases: [],
    example: "which monitors are down?",
  },
  {
    name: WorkspaceCommandName.Help,
    argument: "",
    aliases: ["?"],
    example: "",
  },
];

// What a chat sent, read as a command.
export interface WorkspaceCommandInput {
  /*
   * The command it starts with; null for text that is no command: a
   * question for OneUptime AI.
   */
  command: WorkspaceCommandName | null;
  /*
   * What follows the command, as typed (without the space around it); for
   * a question, the whole question.
   */
  text: string;
  /*
   * For a question whose first word looks like a command misspelt: that
   * command. It is answered with the commands, never sent to AI.
   */
  misspelt?: WorkspaceCommandMisspelling | undefined;
}

export interface WorkspaceCommandMisspelling {
  // The first word, as typed: "incidnet".
  word: string;
  // The command it looks like.
  command: WorkspaceCommandName;
  // What followed the word, as typed: "Checkout is down".
  text: string;
}

// Commands one chat has that the other does not: Microsoft Teams' lists.
export interface WorkspaceExtraCommand {
  // How each is typed: "show active incidents".
  usages: Array<string>;
  // What they do, completing "<usage>: ...".
  summary: string;
}

// One word of a text, and where it ends there.
interface TypedWord {
  word: string;
  end: number;
}

const WORD: RegExp = /\S+/g;

// Punctuation a command may be typed with: "help?", "incident:".
const TRAILING_PUNCTUATION: RegExp = /[:,.!?]+$/;

// A word with an apostrophe is a word of a sentence, never a misspelling.
const APOSTROPHE: RegExp = /['’]/;

const WHITESPACE: RegExp = /\s+/g;

/*
 * The commands a first word is read as a misspelling of, and how many
 * letters may be wrong: long names only. Short ones (help, ask) sit too
 * close to the words a question starts with - "helm", "ack".
 */
const MISSPELLING_LIMITS: ReadonlyArray<{
  command: WorkspaceCommandName;
  maxDistance: number;
}> = [
  { command: WorkspaceCommandName.Incident, maxDistance: 2 },
  { command: WorkspaceCommandName.Maintenance, maxDistance: 2 },
  { command: WorkspaceCommandName.OnCall, maxDistance: 1 },
];

// A misspelling is read only from a word this long.
const MISSPELLING_MIN_LENGTH: number = 4;

// How much of what followed a misspelt command the suggestion repeats.
const SUGGESTION_TEXT_MAX_LENGTH: number = 100;

export default class WorkspaceCommands {
  // The command Slack's app registers for OneUptime (app-manifest.json).
  public static readonly SLACK_COMMAND: string = "/oneuptime";

  // A command's definition.
  public static getDefinition(
    name: WorkspaceCommandName,
  ): WorkspaceCommandDefinition {
    return WORKSPACE_COMMANDS.find(
      (definition: WorkspaceCommandDefinition): boolean => {
        return definition.name === name;
      },
    )!;
  }

  /*
   * What a command does, completing "<command>: ...". The product's name is
   * the one the installation goes by.
   */
  public static getSummary(name: WorkspaceCommandName): string {
    switch (name) {
      case WorkspaceCommandName.Incident:
        return "declare an incident. Opens the form, with the title filled in";
      case WorkspaceCommandName.Maintenance:
        return "schedule a maintenance event. Opens the form, with the title filled in";
      case WorkspaceCommandName.OnCall:
        return "see who is on call right now, in each on-call schedule";
      case WorkspaceCommandName.Ask:
        return `ask ${ProductBrandingText.getProductName()} AI about your logs, traces, metrics, incidents and monitors`;
      case WorkspaceCommandName.Help:
        return "show these commands, with examples";
    }
  }

  /*
   * Reads what a chat sent - the text after `/oneuptime` in Slack, the
   * message to the bot in Microsoft Teams - as a command (see the header).
   */
  public static parse(
    input: string | null | undefined,
  ): WorkspaceCommandInput {
    const text: string = (input || "").trim();

    if (!text) {
      return { command: WorkspaceCommandName.Help, text: "" };
    }

    const words: Array<TypedWord> = [];

    for (const match of text.matchAll(WORD)) {
      words.push({
        word: match[0],
        end: (match.index || 0) + match[0].length,
      });
    }

    for (const definition of WORKSPACE_COMMANDS) {
      for (const spelling of [definition.name, ...definition.aliases]) {
        const rest: string | null = WorkspaceCommands.readSpelling(
          text,
          words,
          spelling,
        );

        if (rest === null) {
          continue;
        }

        // A command that takes nothing after it is that command only alone.
        if (!definition.argument && rest) {
          continue;
        }

        // "ask" with no question asks nothing: the commands, instead.
        if (definition.name === WorkspaceCommandName.Ask && !rest) {
          return { command: WorkspaceCommandName.Help, text: "" };
        }

        return { command: definition.name, text: rest };
      }
    }

    const misspelt: WorkspaceCommandMisspelling | undefined =
      WorkspaceCommands.readMisspelling(text, words);

    if (misspelt) {
      return { command: null, text: text, misspelt: misspelt };
    }

    return { command: null, text: text };
  }

  // A title as a form takes it: on one line, each run of space one space.
  public static toTitle(text: string): string {
    return text.replace(WHITESPACE, " ").trim();
  }

  // The command a Slack workspace runs OneUptime with: "/oneuptime".
  public static getSlackCommand(command?: string | undefined): string {
    const typed: string = (command || "").trim();

    return typed.startsWith("/") ? typed : WorkspaceCommands.SLACK_COMMAND;
  }

  /*
   * How a command is typed, without what follows it: "/oneuptime incident"
   * in Slack (with the command the workspace runs OneUptime with),
   * "incident" to the Microsoft Teams bot.
   */
  public static getUsage(data: {
    workspaceType: WorkspaceType;
    command: WorkspaceCommandName;
    slackCommand?: string | undefined;
  }): string {
    return data.workspaceType === WorkspaceType.Slack
      ? `${WorkspaceCommands.getSlackCommand(data.slackCommand)} ${data.command}`
      : data.command;
  }

  /*
   * Every command, with an example of each, as both chats show it - and,
   * for text that started with a misspelt command, the one it looks like:
   *
   *   👋 Here's what /oneuptime does
   *   • /oneuptime incident [title]: declare an incident. Opens the form,
   *     with the title filled in. For example: /oneuptime incident Checkout
   *     is down
   *   • ...
   *
   * Slack writes each command as code. Microsoft Teams' cards show no code,
   * so there each is in bold, as typed to the bot.
   */
  public static getHelpAnswer(data: {
    workspaceType: WorkspaceType;
    // The command a Slack workspace runs OneUptime with: "/oneuptime".
    slackCommand?: string | undefined;
    // Commands only this chat has, listed before help.
    extraCommands?: Array<WorkspaceExtraCommand> | undefined;
    misspelt?: WorkspaceCommandMisspelling | undefined;
  }): WorkspaceAnswer {
    const isSlack: boolean = data.workspaceType === WorkspaceType.Slack;
    const productName: string = ProductBrandingText.getProductName();
    const slackCommand: string = WorkspaceCommands.getSlackCommand(
      data.slackCommand,
    );

    const lines: Array<MarkdownText> = [];
    let misspeltText: string = "";

    if (data.misspelt) {
      const suggestion: { typed: string; meant: string } =
        WorkspaceCommands.getSuggestion({
          workspaceType: data.workspaceType,
          slackCommand: slackCommand,
          misspelt: data.misspelt,
        });

      lines.push(
        mdText`🤔 ${WorkspaceCommands.typed(
          data.workspaceType,
          suggestion.typed,
        )} is not a command. Did you mean ${WorkspaceCommands.typed(
          data.workspaceType,
          suggestion.meant,
        )}?`,
      );
      lines.push(FeedMarkdown.empty());

      misspeltText = `${suggestion.typed} is not a command. Did you mean ${suggestion.meant}? `;
    }

    lines.push(
      isSlack
        ? mdText`👋 **Here's what ${WorkspaceCommands.typed(
            data.workspaceType,
            slackCommand,
          )} does**`
        : mdText`👋 **Here's what I can do.** In a channel or a group chat, mention @${productName} first.`,
    );

    for (const definition of WORKSPACE_COMMANDS) {
      if (definition.name === WorkspaceCommandName.Help) {
        for (const extra of data.extraCommands || []) {
          lines.push(
            mdText`- ${FeedMarkdown.join(
              extra.usages.map((usage: string): MarkdownText => {
                return WorkspaceCommands.typed(data.workspaceType, usage);
              }),
              ", ",
            )}: ${extra.summary}.`,
          );
        }
      }

      lines.push(
        WorkspaceCommands.getCommandLine({
          workspaceType: data.workspaceType,
          slackCommand: slackCommand,
          definition: definition,
        }),
      );
    }

    lines.push(FeedMarkdown.empty());

    lines.push(
      isSlack
        ? mdText`Anything else after ${WorkspaceCommands.typed(
            data.workspaceType,
            slackCommand,
          )} is a question for ${productName} AI too. The **Create New Incident** and **Create Scheduled Event** shortcuts open the same forms as ${WorkspaceCommands.typed(
            data.workspaceType,
            `${slackCommand} incident`,
          )} and ${WorkspaceCommands.typed(
            data.workspaceType,
            `${slackCommand} maintenance`,
          )}.`
        : mdText`Anything else you type is a question for ${productName} AI, such as "which monitors are down right now?"`,
    );

    const names: string = WORKSPACE_COMMANDS.map(
      (definition: WorkspaceCommandDefinition): string => {
        return definition.name;
      },
    ).join(", ");

    return {
      markdown: FeedMarkdown.join(lines, "\n").toString(),
      text: isSlack
        ? `${misspeltText}Here's what ${slackCommand} does: ${names}`
        : `${misspeltText}Here's what I can do: ${names}`,
    };
  }

  /*
   * "• /oneuptime incident [title]: declare an incident. Opens the form,
   * with the title filled in. For example: /oneuptime incident Checkout is
   * down"
   */
  private static getCommandLine(data: {
    workspaceType: WorkspaceType;
    slackCommand: string;
    definition: WorkspaceCommandDefinition;
  }): MarkdownText {
    const usage: string = WorkspaceCommands.getUsage({
      workspaceType: data.workspaceType,
      command: data.definition.name,
      slackCommand: data.slackCommand,
    });

    const summary: string = WorkspaceCommands.getSummary(data.definition.name);

    const command: MarkdownText = data.definition.argument
      ? WorkspaceCommands.withArgument(
          data.workspaceType,
          usage,
          data.definition.argument,
        )
      : WorkspaceCommands.typed(data.workspaceType, usage);

    if (!data.definition.example) {
      return mdText`- ${command}: ${summary}.`;
    }

    const example: string = `${usage} ${data.definition.example}`;

    return mdText`- ${command}: ${summary}. For example: ${
      data.workspaceType === WorkspaceType.Slack
        ? WorkspaceCommands.typed(data.workspaceType, example)
        : mdText`"${example}"`
    }`;
  }

  /*
   * The misspelt command as typed ("/oneuptime incidnet"), and the command
   * it looks like, with what followed it, to type again: "/oneuptime
   * incident Checkout is down".
   */
  private static getSuggestion(data: {
    workspaceType: WorkspaceType;
    slackCommand: string;
    misspelt: WorkspaceCommandMisspelling;
  }): { typed: string; meant: string } {
    const prefix: string =
      data.workspaceType === WorkspaceType.Slack ? `${data.slackCommand} ` : "";

    const definition: WorkspaceCommandDefinition =
      WorkspaceCommands.getDefinition(data.misspelt.command);

    let rest: string = definition.argument
      ? WorkspaceCommands.toTitle(data.misspelt.text)
      : "";

    if (rest.length > SUGGESTION_TEXT_MAX_LENGTH) {
      rest = `${rest.substring(0, SUGGESTION_TEXT_MAX_LENGTH).trimEnd()}…`;
    }

    return {
      typed: `${prefix}${data.misspelt.word}`,
      meant: `${prefix}${definition.name}${rest ? ` ${rest}` : ""}`,
    };
  }

  // Something to type, as each chat writes it: code in Slack, bold in Teams.
  private static typed(
    workspaceType: WorkspaceType,
    text: string,
  ): MarkdownText {
    return workspaceType === WorkspaceType.Slack
      ? FeedMarkdown.code(text)
      : mdText`**${text}**`;
  }

  /*
   * A command with what may follow it: `/oneuptime incident [title]` in
   * Slack, **incident [title]** in Teams - the brackets the help's own, so
   * nothing in it needs escaping in a card.
   */
  private static withArgument(
    workspaceType: WorkspaceType,
    usage: string,
    argument: string,
  ): MarkdownText {
    return workspaceType === WorkspaceType.Slack
      ? FeedMarkdown.code(`${usage} [${argument}]`)
      : mdText`**${usage} [${argument}]**`;
  }

  /*
   * The words of `spelling` at the start of the text, in any case - the
   * last one may carry punctuation ("help?", "incident:") - and what
   * follows them, trimmed; null when the text does not start with them.
   */
  private static readSpelling(
    text: string,
    words: Array<TypedWord>,
    spelling: string,
  ): string | null {
    const spellingWords: Array<string> = spelling.split(" ");

    if (words.length < spellingWords.length) {
      return null;
    }

    for (let index: number = 0; index < spellingWords.length; index++) {
      const typed: string = words[index]!.word.toLowerCase();
      const expected: string = spellingWords[index]!;
      const isLast: boolean = index === spellingWords.length - 1;

      if (
        typed !== expected &&
        !(isLast && typed.replace(TRAILING_PUNCTUATION, "") === expected)
      ) {
        return null;
      }
    }

    return text.substring(words[spellingWords.length - 1]!.end).trim();
  }

  // A first word that looks like a long command misspelt (see the header).
  private static readMisspelling(
    text: string,
    words: Array<TypedWord>,
  ): WorkspaceCommandMisspelling | undefined {
    const first: TypedWord | undefined = words[0];

    if (!first || APOSTROPHE.test(first.word)) {
      return undefined;
    }

    const word: string = first.word.replace(TRAILING_PUNCTUATION, "");
    const lower: string = word.toLowerCase();

    if (lower.length < MISSPELLING_MIN_LENGTH) {
      return undefined;
    }

    for (const limit of MISSPELLING_LIMITS) {
      // "incidents" is a word of a question, not "incident" misspelt.
      if (lower === limit.command || lower === `${limit.command}s`) {
        continue;
      }

      if (
        WorkspaceCommands.getEditDistance(lower, limit.command) <=
        limit.maxDistance
      ) {
        return {
          word: word,
          command: limit.command,
          text: text.substring(first.end).trim(),
        };
      }
    }

    return undefined;
  }

  /*
   * How many letters must change to turn one word into the other: one
   * added, removed or replaced, or two neighbours swapped ("incidnet"),
   * each one change (the optimal string alignment distance).
   */
  public static getEditDistance(a: string, b: string): number {
    const rows: Array<Array<number>> = [];

    for (let i: number = 0; i <= a.length; i++) {
      const row: Array<number> = [];

      for (let j: number = 0; j <= b.length; j++) {
        if (i === 0 || j === 0) {
          row.push(i + j);
          continue;
        }

        const cost: number = a[i - 1] === b[j - 1] ? 0 : 1;

        let distance: number = Math.min(
          rows[i - 1]![j]! + 1,
          row[j - 1]! + 1,
          rows[i - 1]![j - 1]! + cost,
        );

        if (
          i > 1 &&
          j > 1 &&
          a[i - 1] === b[j - 2] &&
          a[i - 2] === b[j - 1]
        ) {
          distance = Math.min(distance, rows[i - 2]![j - 2]! + 1);
        }

        row.push(distance);
      }

      rows.push(row);
    }

    return rows[a.length]![b.length]!;
  }
}
