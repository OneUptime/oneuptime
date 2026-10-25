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
 *   /oneuptime incident [number]      act on incident 42 (or #42, INC-42)
 *                                     from its buttons and menu
 *                                     (WorkspaceIncidentActions)
 *   /oneuptime maintenance [title]    schedule a maintenance event
 *   /oneuptime oncall                 who is on call right now
 *   /oneuptime page [who] [message]   page a person, a team or whoever is
 *                                     on call (WorkspacePageText)
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
 *     not sent to AI as a question: it is answered with the command it looks
 *     like, ready to type again, and how to ask AI instead
 *     (getMisspellingAnswer).
 */

export enum WorkspaceCommandName {
  Incident = "incident",
  Maintenance = "maintenance",
  OnCall = "oncall",
  Page = "page",
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
  /*
   * What may follow that, as the help names it: page's "message", written
   * "[who] [message]" (getArgumentHint).
   */
  moreArguments?: ReadonlyArray<string> | undefined;
  // Other ways to type it, in lower case: "create incident".
  aliases: ReadonlyArray<string>;
  /*
   * What may follow the name in an example: the help shows the incident
   * command's and the question's. Empty for none.
   */
  example: string;
}

/*
 * The commands, in the order the help lists them. Microsoft Teams took
 * "create incident" and "create maintenance" before the words were the same
 * in both chats, so those keep working, in both.
 */
export const WORKSPACE_COMMANDS: ReadonlyArray<WorkspaceCommandDefinition> = [
  /*
   * A title declares an incident; an incident's number - 42, #42, INC-42 -
   * shows that incident, to act on (WorkspaceIncidentNumberWord).
   */
  {
    name: WorkspaceCommandName.Incident,
    argument: "title or number",
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
  /*
   * Who to page - people by @mention, or a team, an on-call schedule or an
   * on-call policy picked in the form it opens - then what to tell them
   * (WorkspacePageText).
   */
  {
    name: WorkspaceCommandName.Page,
    argument: "who",
    moreArguments: ["message"],
    aliases: [],
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
const TRAILING_PUNCTUATION: string = ":,.!?";

// A word with an apostrophe is a word of a sentence, never a misspelling.
const APOSTROPHE: RegExp = /['\u2019]/;

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

// The question the Microsoft Teams help gives as an example.
const TEAMS_QUESTION_EXAMPLE: string = "which monitors are down right now?";

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
   * What a command does, completing "<command>: ...": a few words, so the
   * help reads as a list a person scans, in a chat on a phone too. Microsoft
   * Teams' command menu and the bot's welcome card say it as a sentence, so
   * it never points at the help around it ("these"). The product's name is
   * the one the installation goes by.
   */
  public static getSummary(name: WorkspaceCommandName): string {
    switch (name) {
      case WorkspaceCommandName.Incident:
        return "declare an incident, or act on one by its number";
      case WorkspaceCommandName.Maintenance:
        return "schedule maintenance";
      case WorkspaceCommandName.OnCall:
        return "see who is on call right now";
      case WorkspaceCommandName.Page:
        return "page a person, a team or whoever is on call";
      case WorkspaceCommandName.Ask:
        return `ask ${ProductBrandingText.getProductName()} AI about your logs, traces, metrics, incidents and monitors`;
      case WorkspaceCommandName.Help:
        return "list every command";
    }
  }

  /*
   * Reads what a chat sent - the text after `/oneuptime` in Slack, the
   * message to the bot in Microsoft Teams - as a command (see the header).
   */
  public static parse(input: string | null | undefined): WorkspaceCommandInput {
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

  /*
   * What may follow a command, as the help, the Slack app's usage hint and
   * the docs write it: "[title]", "[who] [message]" - or "" for a command
   * that takes nothing after it.
   */
  public static getArgumentHint(
    definition: WorkspaceCommandDefinition,
  ): string {
    if (!definition.argument) {
      return "";
    }

    return [definition.argument, ...(definition.moreArguments || [])]
      .map((argument: string): string => {
        return `[${argument}]`;
      })
      .join(" ");
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
   * Every command, as both chats show it: one short line each, then an
   * example of a command and of a question.
   *
   *   👋 Here's what /oneuptime can do
   *   • /oneuptime incident [title]: declare an incident
   *   • /oneuptime maintenance [title]: schedule maintenance
   *   • /oneuptime oncall: see who is on call right now
   *   • /oneuptime ask [question]: ask OneUptime AI about your logs, ...
   *   • /oneuptime help: list every command
   *
   *   For example: /oneuptime incident Checkout is down. Anything else
   *   after /oneuptime is a question for OneUptime AI too, such as
   *   /oneuptime which monitors are down?
   *
   * Slack writes each command as code. Microsoft Teams' cards show no code,
   * so there each is in bold, as typed to the bot, and the help says how to
   * reach the bot in a channel: by @mentioning it, under the name Teams
   * shows for it (`botName`, from the message it answers).
   *
   * A chat may say more around the commands (`before`, `after`): Microsoft
   * Teams says what the app is for first, and where to go next after them
   * (MicrosoftTeamsCommands.getHelpAnswer).
   */
  public static getHelpAnswer(data: {
    workspaceType: WorkspaceType;
    // The command a Slack workspace runs OneUptime with: "/oneuptime".
    slackCommand?: string | undefined;
    // Commands only this chat has, listed before help.
    extraCommands?: Array<WorkspaceExtraCommand> | undefined;
    // The bot's name as Microsoft Teams shows it; the product's by default.
    botName?: string | undefined;
    // Paragraphs before the commands, and after the example.
    before?: Array<MarkdownText> | undefined;
    after?: Array<MarkdownText> | undefined;
  }): WorkspaceAnswer {
    const isSlack: boolean = data.workspaceType === WorkspaceType.Slack;
    const productName: string = ProductBrandingText.getProductName();
    const slackCommand: string = WorkspaceCommands.getSlackCommand(
      data.slackCommand,
    );
    const botName: string = (data.botName || "").trim() || productName;

    const incidentExample: string = `${WorkspaceCommands.getUsage({
      workspaceType: data.workspaceType,
      command: WorkspaceCommandName.Incident,
      slackCommand: slackCommand,
    })} ${WorkspaceCommands.getDefinition(WorkspaceCommandName.Incident).example}`;

    /*
     * A question in plain language. Slack's is the one the docs and the
     * app's usage hint have always shown after /oneuptime; Teams' the one the
     * bot has always given (Microsoft Teams' docs quote it).
     */
    const question: string = isSlack
      ? WorkspaceCommands.getDefinition(WorkspaceCommandName.Ask).example
      : TEAMS_QUESTION_EXAMPLE;

    const lines: Array<MarkdownText> = [
      ...WorkspaceCommands.asParagraphs(data.before, "before"),
      isSlack
        ? mdText`👋 **Here's what ${WorkspaceCommands.typed(
            data.workspaceType,
            slackCommand,
          )} can do**`
        : mdText`👋 **Here's what I can do.** In a channel or a group chat, mention @${botName} first.`,
      ...WorkspaceCommands.getCommandListLines(data),
      FeedMarkdown.empty(),
      isSlack
        ? mdText`For example: ${WorkspaceCommands.typed(
            data.workspaceType,
            incidentExample,
          )}. Anything else after ${WorkspaceCommands.typed(
            data.workspaceType,
            slackCommand,
          )} is a question for ${productName} AI too, such as ${WorkspaceCommands.typed(
            data.workspaceType,
            `${slackCommand} ${question}`,
          )}`
        : mdText`For example: "${incidentExample}". Anything else you type is a question for ${productName} AI too, such as "${question}"`,
      ...WorkspaceCommands.asParagraphs(data.after, "after"),
    ];

    const names: string = WORKSPACE_COMMANDS.map(
      (definition: WorkspaceCommandDefinition): string => {
        return definition.name;
      },
    ).join(", ");

    return {
      markdown: FeedMarkdown.join(lines, "\n").toString(),
      text: isSlack
        ? `Here's what ${slackCommand} can do: ${names}`
        : `Here's what I can do: ${names}`,
    };
  }

  /*
   * The help's list: each command, and what it does - a chat's own commands
   * before help. Microsoft Teams' welcome card lists the same lines.
   */
  public static getCommandListLines(data: {
    workspaceType: WorkspaceType;
    slackCommand?: string | undefined;
    extraCommands?: Array<WorkspaceExtraCommand> | undefined;
  }): Array<MarkdownText> {
    const slackCommand: string = WorkspaceCommands.getSlackCommand(
      data.slackCommand,
    );
    const lines: Array<MarkdownText> = [];

    for (const definition of WORKSPACE_COMMANDS) {
      if (definition.name === WorkspaceCommandName.Help) {
        for (const extra of data.extraCommands || []) {
          lines.push(
            mdText`- ${FeedMarkdown.join(
              extra.usages.map((usage: string): MarkdownText => {
                return WorkspaceCommands.typed(data.workspaceType, usage);
              }),
              ", ",
            )}: ${extra.summary}`,
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

    return lines;
  }

  /*
   * What text that starts with a command misspelt is answered with: the
   * command it looks like, with what followed it, ready to type again - and,
   * for a question that only started with a word like a command
   * ("accident report from last night?"), how to ask AI instead. One short
   * paragraph, not the whole help: the person knows what they meant.
   *
   *   🤔 /oneuptime incidnet is not a command. Did you mean /oneuptime
   *   incident Checkout is down? To ask OneUptime AI instead, start with
   *   /oneuptime ask.
   */
  public static getMisspellingAnswer(data: {
    workspaceType: WorkspaceType;
    // The command a Slack workspace runs OneUptime with: "/oneuptime".
    slackCommand?: string | undefined;
    misspelt: WorkspaceCommandMisspelling;
  }): WorkspaceAnswer {
    const slackCommand: string = WorkspaceCommands.getSlackCommand(
      data.slackCommand,
    );

    const suggestion: { typed: string; meant: string } =
      WorkspaceCommands.getSuggestion({
        workspaceType: data.workspaceType,
        slackCommand: slackCommand,
        misspelt: data.misspelt,
      });

    const ask: string = WorkspaceCommands.getUsage({
      workspaceType: data.workspaceType,
      command: WorkspaceCommandName.Ask,
      slackCommand: slackCommand,
    });

    return {
      markdown: mdText`🤔 ${WorkspaceCommands.typed(
        data.workspaceType,
        suggestion.typed,
      )} is not a command. Did you mean ${WorkspaceCommands.typed(
        data.workspaceType,
        suggestion.meant,
      )}? To ask ${ProductBrandingText.getProductName()} AI instead, start with ${WorkspaceCommands.typed(
        data.workspaceType,
        ask,
      )}.`.toString(),
      text: `${suggestion.typed} is not a command. Did you mean ${suggestion.meant}?`,
    };
  }

  /*
   * Paragraphs a chat says around the help (getHelpAnswer's `before` and
   * `after`), each a block of its own: a blank line between it and the
   * help's own lines.
   */
  private static asParagraphs(
    paragraphs: Array<MarkdownText> | undefined,
    place: "before" | "after",
  ): Array<MarkdownText> {
    const lines: Array<MarkdownText> = [];

    for (const paragraph of paragraphs || []) {
      if (place === "after") {
        lines.push(FeedMarkdown.empty());
      }

      lines.push(paragraph);

      if (place === "before") {
        lines.push(FeedMarkdown.empty());
      }
    }

    return lines;
  }

  // "• /oneuptime incident [title]: declare an incident"
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

    const command: MarkdownText = data.definition.argument
      ? WorkspaceCommands.withArgument(
          data.workspaceType,
          usage,
          data.definition,
        )
      : WorkspaceCommands.typed(data.workspaceType, usage);

    return mdText`- ${command}: ${WorkspaceCommands.getSummary(
      data.definition.name,
    )}`;
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
    definition: WorkspaceCommandDefinition,
  ): MarkdownText {
    if (workspaceType === WorkspaceType.Slack) {
      return FeedMarkdown.code(
        `${usage} ${WorkspaceCommands.getArgumentHint(definition)}`,
      );
    }

    const hint: MarkdownText = FeedMarkdown.join(
      [definition.argument, ...(definition.moreArguments || [])].map(
        (argument: string): MarkdownText => {
          return mdText`[${argument}]`;
        },
      ),
      " ",
    );

    return mdText`**${usage} ${hint}**`;
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
        !(
          isLast &&
          WorkspaceCommands.withoutTrailingPunctuation(typed) === expected
        )
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

    const word: string = WorkspaceCommands.withoutTrailingPunctuation(
      first.word,
    );
    const lower: string = word.toLowerCase();

    if (lower.length < MISSPELLING_MIN_LENGTH) {
      return undefined;
    }

    for (const limit of MISSPELLING_LIMITS) {
      // "incidents" is a word of a question, not "incident" misspelt.
      if (lower === limit.command || lower === `${limit.command}s`) {
        continue;
      }

      // Words this far apart in length are further apart than the limit.
      if (Math.abs(lower.length - limit.command.length) > limit.maxDistance) {
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
   * A word without the punctuation typed after it: "help?" is "help". Read
   * from the word's end, a character at a time. A pattern for "punctuation
   * up to the end" was tried from every character of a run that is not at
   * the end ("!!!!x!"), in time that grows with the square of the word, and
   * a word is as long as a person makes it.
   */
  private static withoutTrailingPunctuation(word: string): string {
    let end: number = word.length;

    while (end > 0 && TRAILING_PUNCTUATION.includes(word[end - 1]!)) {
      end--;
    }

    return word.substring(0, end);
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

        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          distance = Math.min(distance, rows[i - 2]![j - 2]! + 1);
        }

        row.push(distance);
      }

      rows.push(row);
    }

    return rows[a.length]![b.length]!;
  }
}
