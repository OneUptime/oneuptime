import { afterEach, describe, expect, jest, test } from "@jest/globals";
import WorkspaceCommands, {
  WORKSPACE_COMMANDS,
  WorkspaceCommandDefinition,
  WorkspaceCommandInput,
  WorkspaceCommandName,
} from "../../../../Server/Utils/Workspace/WorkspaceCommands";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * CUSTOMER FEEDBACK #5: "I noticed it registers as /incident, /maintenance.
 * This can easily conflict with the other apps we have. Can we have a prefix
 * namespace e.g. /irm incident, /irm maintenance?"
 *
 * Every command is now a word after /oneuptime in Slack - and the same word
 * typed to the Microsoft Teams bot. WorkspaceCommands reads those words for
 * both chats and lists them for both. These pin how text is read (every
 * command, its aliases, letter case, spaces, punctuation, empty text, a
 * question, a misspelt command) and what the help says, word for word.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

function parse(text: string | null | undefined): WorkspaceCommandInput {
  return WorkspaceCommands.parse(text);
}

describe("WorkspaceCommands.parse: each command", () => {
  test.each([
    ["incident Checkout is down", WorkspaceCommandName.Incident, "Checkout is down"],
    ["incident", WorkspaceCommandName.Incident, ""],
    ["maintenance Database upgrade", WorkspaceCommandName.Maintenance, "Database upgrade"],
    ["maintenance", WorkspaceCommandName.Maintenance, ""],
    ["oncall", WorkspaceCommandName.OnCall, ""],
    ["ask which monitors are down?", WorkspaceCommandName.Ask, "which monitors are down?"],
    ["help", WorkspaceCommandName.Help, ""],
  ])(
    "%j is the %s command, followed by %j",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test.each([
    ["create incident Checkout is down", WorkspaceCommandName.Incident, "Checkout is down"],
    ["create maintenance Database upgrade", WorkspaceCommandName.Maintenance, "Database upgrade"],
    ["on-call", WorkspaceCommandName.OnCall, ""],
    ["on call", WorkspaceCommandName.OnCall, ""],
    ["?", WorkspaceCommandName.Help, ""],
  ])(
    "the alias %j is the %s command",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test("every name and alias of every command reads as that command", () => {
    for (const definition of WORKSPACE_COMMANDS) {
      for (const spelling of [definition.name, ...definition.aliases]) {
        const input: WorkspaceCommandInput = parse(
          definition.argument ? `${spelling} something` : spelling,
        );

        expect({ spelling, command: input.command }).toEqual({
          spelling,
          command: definition.name,
        });
      }
    }
  });

  test("the commands are incident, maintenance, oncall, ask and help, in that order", () => {
    expect(
      WORKSPACE_COMMANDS.map((definition: WorkspaceCommandDefinition) => {
        return definition.name;
      }),
    ).toEqual(["incident", "maintenance", "oncall", "ask", "help"]);
  });
});

describe("WorkspaceCommands.parse: letter case, spaces and punctuation", () => {
  test.each([
    ["INCIDENT Checkout is down", WorkspaceCommandName.Incident, "Checkout is down"],
    ["Incident API p99 > 2s on EU-West", WorkspaceCommandName.Incident, "API p99 > 2s on EU-West"],
    ["Create Incident Disk full", WorkspaceCommandName.Incident, "Disk full"],
    ["MAINTENANCE Q3 Kernel Upgrade (Frankfurt)", WorkspaceCommandName.Maintenance, "Q3 Kernel Upgrade (Frankfurt)"],
    ["OnCall", WorkspaceCommandName.OnCall, ""],
    ["ON-CALL", WorkspaceCommandName.OnCall, ""],
    ["HELP", WorkspaceCommandName.Help, ""],
    ["Ask Why did checkout latency spike?", WorkspaceCommandName.Ask, "Why did checkout latency spike?"],
  ])(
    "%j: the command in any case, what follows as typed",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test.each([
    ["   incident    Checkout   is down   ", "Checkout   is down"],
    ["\tincident\tCheckout is down\n", "Checkout is down"],
    ["incident\u{00a0}Checkout is down", "Checkout is down"],
    ["create    incident   Disk full", "Disk full"],
  ])(
    "%j: spaces around the command are dropped, those inside the title kept",
    (text: string, rest: string) => {
      expect(parse(text)).toEqual({
        command: WorkspaceCommandName.Incident,
        text: rest,
      });
    },
  );

  test("a form takes the title on one line, each run of space one space", () => {
    expect(WorkspaceCommands.toTitle("  Checkout   is\n down\t now ")).toBe(
      "Checkout is down now",
    );
    expect(WorkspaceCommands.toTitle("")).toBe("");
  });

  test.each([
    ["help?", WorkspaceCommandName.Help, ""],
    ["help!", WorkspaceCommandName.Help, ""],
    ["oncall?", WorkspaceCommandName.OnCall, ""],
    ["on call?", WorkspaceCommandName.OnCall, ""],
    ["incident: Checkout is down", WorkspaceCommandName.Incident, "Checkout is down"],
    ["maintenance, Database upgrade", WorkspaceCommandName.Maintenance, "Database upgrade"],
  ])(
    "%j: a command may be typed with punctuation after it",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test.each(["", "   ", "\n\t ", null, undefined])(
    "%j - nothing at all - asks for the commands",
    (text: string | null | undefined) => {
      expect(parse(text)).toEqual({
        command: WorkspaceCommandName.Help,
        text: "",
      });
    },
  );

  test.each(["ask", "ASK", "  ask  ", "ask?"])(
    "%j - ask with no question - asks for the commands",
    (text: string) => {
      expect(parse(text)).toEqual({
        command: WorkspaceCommandName.Help,
        text: "",
      });
    },
  );

  test("ask keeps everything after it, a command's words included", () => {
    expect(parse("ask   incident Checkout is down")).toEqual({
      command: WorkspaceCommandName.Ask,
      text: "incident Checkout is down",
    });
  });
});

describe("WorkspaceCommands.parse: questions for OneUptime AI", () => {
  test.each([
    "which monitors are down?",
    "why did checkout latency spike last night?",
    "status",
    "incidents today?",
    "incidents",
    "maintenances this week",
    "oncalls",
    "creative incident",
    "create incidents",
    "create incident-report for yesterday",
    "create maintenance-window for db",
    "please create incident Database Is Down",
    "show active incidents",
    "what is incident 42 about?",
  ])("%j is a question, as typed", (text: string) => {
    expect(parse(text)).toEqual({ command: null, text: text });
  });

  test.each([
    "help me find slow queries",
    "oncall for the database team?",
    "on call this weekend?",
    "help?? me",
  ])(
    "%j - a command that takes nothing, with more after it - is a question",
    (text: string) => {
      expect(parse(text)).toEqual({ command: null, text: text });
    },
  );

  test.each([
    // Short words sit too close to a question's: never read as a misspelling.
    "helm upgrade failed",
    "ack INC-42",
    "hlep",
    "inc 42",
    // A word with an apostrophe is a sentence's.
    "incident's root cause?",
    "incident\u{2019}s root cause?",
  ])("%j is a question, not a misspelt command", (text: string) => {
    const input: WorkspaceCommandInput = parse(text);

    expect(input.command).toBeNull();
    expect(input.misspelt).toBeUndefined();
    expect(input.text).toBe(text);
  });
});

describe("WorkspaceCommands.parse: a command misspelt", () => {
  test.each([
    ["incidnet Checkout is down", "incidnet", WorkspaceCommandName.Incident, "Checkout is down"],
    ["indicent", "indicent", WorkspaceCommandName.Incident, ""],
    ["Incidnet: Checkout", "Incidnet", WorkspaceCommandName.Incident, "Checkout"],
    ["maintenence Database upgrade", "maintenence", WorkspaceCommandName.Maintenance, "Database upgrade"],
    ["maintainance", "maintainance", WorkspaceCommandName.Maintenance, ""],
    ["maintanance window", "maintanance", WorkspaceCommandName.Maintenance, "window"],
    ["oncal", "oncal", WorkspaceCommandName.OnCall, ""],
    ["onclal", "onclal", WorkspaceCommandName.OnCall, ""],
  ])(
    "%j looks like a command misspelt: answered with the commands, never sent to AI",
    (
      text: string,
      word: string,
      command: WorkspaceCommandName,
      rest: string,
    ) => {
      expect(parse(text)).toEqual({
        command: null,
        text: text,
        misspelt: { word: word, command: command, text: rest },
      });
    },
  );

  test("how many letters it takes to turn one word into another, a swap of two counting once", () => {
    expect(WorkspaceCommands.getEditDistance("incident", "incident")).toBe(0);
    expect(WorkspaceCommands.getEditDistance("incidnet", "incident")).toBe(1);
    expect(WorkspaceCommands.getEditDistance("incidet", "incident")).toBe(1);
    expect(WorkspaceCommands.getEditDistance("inncident", "incident")).toBe(1);
    expect(WorkspaceCommands.getEditDistance("indicent", "incident")).toBe(2);
    expect(WorkspaceCommands.getEditDistance("maintenence", "maintenance")).toBe(
      1,
    );
    expect(
      WorkspaceCommands.getEditDistance("maintainance", "maintenance"),
    ).toBe(2);
    expect(WorkspaceCommands.getEditDistance("", "abc")).toBe(3);
    expect(WorkspaceCommands.getEditDistance("abc", "")).toBe(3);
    expect(WorkspaceCommands.getEditDistance("status", "oncall")).toBe(6);
  });
});

describe("WorkspaceCommands.getUsage", () => {
  test("Slack types each command after /oneuptime - or after the command the workspace runs OneUptime with", () => {
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.Slack,
        command: WorkspaceCommandName.Incident,
      }),
    ).toBe("/oneuptime incident");
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.Slack,
        command: WorkspaceCommandName.OnCall,
        slackCommand: "/irm",
      }),
    ).toBe("/irm oncall");
    // Not a command: the default.
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.Slack,
        command: WorkspaceCommandName.Help,
        slackCommand: "irm",
      }),
    ).toBe("/oneuptime help");
  });

  test("Microsoft Teams types the word alone", () => {
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.MicrosoftTeams,
        command: WorkspaceCommandName.Maintenance,
        slackCommand: "/irm",
      }),
    ).toBe("maintenance");
  });
});

const SLACK_HELP_LINES: Array<string> = [
  "👋 **Here's what `/oneuptime` does**",
  "- `/oneuptime incident [title]`: declare an incident. Opens the form, with the title filled in. For example: `/oneuptime incident Checkout is down`",
  "- `/oneuptime maintenance [title]`: schedule a maintenance event. Opens the form, with the title filled in. For example: `/oneuptime maintenance Database upgrade`",
  "- `/oneuptime oncall`: see who is on call right now, in each on-call schedule.",
  "- `/oneuptime ask [question]`: ask OneUptime AI about your logs, traces, metrics, incidents and monitors. For example: `/oneuptime ask which monitors are down?`",
  "- `/oneuptime help`: show these commands, with examples.",
  "",
  "Anything else after `/oneuptime` is a question for OneUptime AI too. The **Create New Incident** and **Create Scheduled Event** shortcuts open the same forms as `/oneuptime incident` and `/oneuptime maintenance`.",
];

const TEAMS_HELP_LINES: Array<string> = [
  "👋 **Here's what I can do.** In a channel or a group chat, mention @OneUptime first.",
  '- **incident [title]**: declare an incident. Opens the form, with the title filled in. For example: "incident Checkout is down"',
  '- **maintenance [title]**: schedule a maintenance event. Opens the form, with the title filled in. For example: "maintenance Database upgrade"',
  "- **oncall**: see who is on call right now, in each on-call schedule.",
  '- **ask [question]**: ask OneUptime AI about your logs, traces, metrics, incidents and monitors. For example: "ask which monitors are down?"',
  "- **help**: show these commands, with examples.",
  "",
  'Anything else you type is a question for OneUptime AI, such as "which monitors are down right now?"',
];

describe("WorkspaceCommands.getHelpAnswer", () => {
  test("Slack: every command as code, with an example, the shortcuts, and that anything else is a question", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
    });

    expect(answer).toEqual({
      markdown: SLACK_HELP_LINES.join("\n"),
      text: "Here's what /oneuptime does: incident, maintenance, oncall, ask, help",
    });
  });

  test("Slack, in a workspace that runs OneUptime with another command: every usage names it", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
      slackCommand: "/irm",
    });

    expect(answer.markdown).toBe(
      SLACK_HELP_LINES.join("\n").split("/oneuptime").join("/irm"),
    );
    expect(answer.text).toBe(
      "Here's what /irm does: incident, maintenance, oncall, ask, help",
    );
  });

  test("Microsoft Teams: every command in bold, as typed to the bot, and how to reach the bot in a channel", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(answer).toEqual({
      markdown: TEAMS_HELP_LINES.join("\n"),
      text: "Here's what I can do: incident, maintenance, oncall, ask, help",
    });
    // A card shows no code: nothing is written as code in Teams.
    expect(answer.markdown).not.toContain("`");
  });

  test("Microsoft Teams: a chat's own commands are listed before help", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      extraCommands: [
        {
          usages: ["show active incidents", "show active alerts"],
          summary: "list what is open right now",
        },
      ],
    });

    const lines: Array<string> = answer.markdown.split("\n");

    expect(lines[5]).toBe(
      "- **show active incidents**, **show active alerts**: list what is open right now.",
    );
    expect(lines[6]).toBe("- **help**: show these commands, with examples.");
  });

  test("a command misspelt: said first, with the command it looks like and what followed it, ready to type again", () => {
    const slack: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
      misspelt: {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: "Checkout   is down",
      },
    });

    expect(slack.markdown).toBe(
      [
        "🤔 `/oneuptime incidnet` is not a command. Did you mean `/oneuptime incident Checkout is down`?",
        "",
        ...SLACK_HELP_LINES,
      ].join("\n"),
    );
    expect(slack.text).toBe(
      "/oneuptime incidnet is not a command. Did you mean /oneuptime incident Checkout is down? Here's what /oneuptime does: incident, maintenance, oncall, ask, help",
    );

    const teams: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      misspelt: {
        word: "oncal",
        command: WorkspaceCommandName.OnCall,
        text: "",
      },
    });

    expect(teams.markdown.split("\n")[0]).toBe(
      "🤔 **oncal** is not a command. Did you mean **oncall**?",
    );
  });

  test("a misspelt command that takes nothing: the suggestion is the command alone", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
      misspelt: {
        word: "oncal",
        command: WorkspaceCommandName.OnCall,
        text: "please",
      },
    });

    expect(answer.markdown.split("\n")[0]).toBe(
      "🤔 `/oneuptime oncal` is not a command. Did you mean `/oneuptime oncall`?",
    );
  });

  test("a long title after a misspelt command is cut in the suggestion", () => {
    const title: string = "a".repeat(150);

    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
      misspelt: {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: title,
      },
    });

    expect(answer.markdown.split("\n")[0]).toBe(
      `🤔 \`/oneuptime incidnet\` is not a command. Did you mean \`/oneuptime incident ${"a".repeat(100)}…\`?`,
    );
  });

  test("text typed after a misspelt command is text: it cannot become a link, a mention or code", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      misspelt: {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: "**[x](https://evil.example)** <at>All</at> `code`",
      },
    });

    /*
     * Every character that would make Markdown of it - the bold, the
     * link's brackets, the <at> tag of a Teams mention, the code span's
     * backticks - has its backslash: the text reads as typed.
     */
    expect(answer.markdown.split("\n")[0]).toBe(
      String.raw`🤔 **incidnet** is not a command. Did you mean **incident \*\*\[x\](https://evil.example)\*\* \<at>All\</at> \`code\`**?`,
    );
  });

  test("the product's name is the one the installation goes by", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    const slack: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
    });
    const teams: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(slack.markdown).toContain("ask Acme Ops AI about your logs");
    expect(slack.markdown).toContain("is a question for Acme Ops AI too.");
    expect(slack.markdown).not.toContain("OneUptime AI");
    expect(teams.markdown).toContain("mention @Acme Ops first.");
    expect(teams.markdown).not.toContain("OneUptime");
  });

  test("every command the parser reads is listed in both chats' help", () => {
    const slack: string = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
    }).markdown;
    const teams: string = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
    }).markdown;

    for (const definition of WORKSPACE_COMMANDS) {
      expect(slack).toContain(`\`/oneuptime ${definition.name}`);
      expect(teams).toContain(`**${definition.name}`);
    }
  });
});
