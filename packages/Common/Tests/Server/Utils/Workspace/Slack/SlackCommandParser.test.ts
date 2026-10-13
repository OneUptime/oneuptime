import { describe, expect, test } from "@jest/globals";
import SlackCommandParser, {
  LEGACY_SLACK_COMMANDS,
  SlackCommandRequest,
} from "../../../../../Server/Utils/Workspace/Slack/SlackCommandParser";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { SlackAction } from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import { WorkspaceCommandName } from "../../../../../Server/Utils/Workspace/WorkspaceCommands";

/*
 * A slash command, as Slack sends it and as OneUptime reads it.
 *
 * /oneuptime and the words after it are the command; an app created from an
 * older manifest also sends /incident and /maintenance, whose text is the
 * form's title as it always was. Slack escapes "&", "<" and ">" in the text
 * and, with escaping on, writes people and channels as <@U...|name>: what
 * reaches a form's title or AI is what was typed.
 */

function read(command: unknown, text: unknown): SlackCommandRequest {
  return SlackCommandParser.read({ command: command, text: text });
}

describe("SlackCommandParser.read", () => {
  test("/oneuptime and its words", () => {
    expect(read("/oneuptime", "incident Checkout is down")).toEqual({
      command: "/oneuptime",
      baseCommand: "/oneuptime",
      isLegacy: false,
      input: {
        command: WorkspaceCommandName.Incident,
        text: "Checkout is down",
      },
      rawText: "incident Checkout is down",
    });
  });

  test("/oneuptime with nothing after it asks for the commands", () => {
    expect(read("/oneuptime", "").input).toEqual({
      command: WorkspaceCommandName.Help,
      text: "",
    });
    // Slack leaves `text` out of a command with nothing after it.
    expect(read("/oneuptime", undefined).input).toEqual({
      command: WorkspaceCommandName.Help,
      text: "",
    });
  });

  test("a workspace that runs OneUptime with a command of its own: its words follow that command", () => {
    const request: SlackCommandRequest = read("/irm", "oncall");

    expect(request.baseCommand).toBe("/irm");
    expect(request.input.command).toBe(WorkspaceCommandName.OnCall);
    expect(SlackCommandParser.getTypedCommand(request)).toBe("/irm oncall");
  });

  test("the command in any case reads as typed in lower case, as Slack registers commands", () => {
    expect(read("/OneUptime", "help").command).toBe("/oneuptime");
    expect(read("  /ONEUPTIME ", "help").baseCommand).toBe("/oneuptime");
  });

  test("no command at all reads as /oneuptime", () => {
    const request: SlackCommandRequest = read(undefined, "help");

    expect(request.command).toBe("/oneuptime");
    expect(request.baseCommand).toBe("/oneuptime");
  });

  test.each([
    ["/incident", WorkspaceCommandName.Incident],
    ["/maintenance", WorkspaceCommandName.Maintenance],
  ])(
    "an older app's %s: everything after it is the form's title - even a word that is a command",
    (command: string, name: WorkspaceCommandName) => {
      expect(read(command, "help")).toEqual({
        command: command,
        baseCommand: "/oneuptime",
        isLegacy: true,
        input: { command: name, text: "help" },
        rawText: "help",
      });
      expect(read(command, "  Checkout   is down ").input.text).toBe(
        "Checkout   is down",
      );
    },
  );

  test("the older apps' commands are /incident and /maintenance, and nothing else", () => {
    expect(LEGACY_SLACK_COMMANDS).toEqual({
      "/incident": WorkspaceCommandName.Incident,
      "/maintenance": WorkspaceCommandName.Maintenance,
    });
  });

  test("the words are read from the text as typed: escapes undone", () => {
    expect(read("/oneuptime", "incident API p99 &gt; 2s &amp; rising").input).toEqual({
      command: WorkspaceCommandName.Incident,
      text: "API p99 > 2s & rising",
    });
    // The text as Slack sent it stays at hand.
    expect(
      read("/oneuptime", "incident API p99 &gt; 2s &amp; rising").rawText,
    ).toBe("incident API p99 &gt; 2s &amp; rising");
  });
});

describe("SlackCommandParser.toPlainText", () => {
  test.each([
    ["Checkout &lt;eu-west&gt; is down", "Checkout <eu-west> is down"],
    ["R&amp;D API", "R&D API"],
    // An escape typed as text is only undone once.
    ["&amp;lt;", "&lt;"],
    ["page <@U0123ABC|nawaz> now", "page @nawaz now"],
    ["page <@U0123ABC> now", "page @U0123ABC now"],
    ["in <#C0123ABC|ops-alerts>", "in #ops-alerts"],
    ["in <#C0123ABC>", "in #C0123ABC"],
    ["tell <!subteam^S0123|@team-oncall>", "tell @team-oncall"],
    ["tell <!subteam^S0123|team-oncall>", "tell @team-oncall"],
    ["<!here> checkout is down", "@here checkout is down"],
    ["<!channel|channel> please look", "@channel please look"],
    ["<!everyone>", "@everyone"],
    ["since <!date^1760290080^{time}|17:28 UTC>", "since 17:28 UTC"],
    ["see <https://status.example.com|the status page>", "see the status page"],
    ["see <https://status.example.com>", "see https://status.example.com"],
    ["mail <mailto:ops@example.com|ops@example.com>", "mail ops@example.com"],
    ["", ""],
    ["plain words stay plain", "plain words stay plain"],
  ])("%j reads %j", (text: string, plain: string) => {
    expect(SlackCommandParser.toPlainText(text)).toBe(plain);
  });
});

describe("SlackCommandParser.getAction: what a command asks for, as a press is read", () => {
  function actionOf(command: string, text: string): SlackAction {
    return SlackCommandParser.getAction(read(command, text));
  }

  test("/oneuptime incident: the New Incident form, its title on one line, and the command as typed", () => {
    expect(actionOf("/oneuptime", "incident   Checkout\nis down ")).toEqual({
      actionType: SlackActionType.NewIncident,
      actionValue: "Checkout is down",
      command: "/oneuptime incident",
    });
  });

  test("/oneuptime create incident: the same form, run again as /oneuptime incident", () => {
    expect(actionOf("/oneuptime", "create incident Checkout is down")).toEqual(
      {
        actionType: SlackActionType.NewIncident,
        actionValue: "Checkout is down",
        command: "/oneuptime incident",
      },
    );
  });

  test("/oneuptime maintenance: the New Scheduled Maintenance form", () => {
    expect(actionOf("/oneuptime", "MAINTENANCE Database upgrade")).toEqual({
      actionType: SlackActionType.NewScheduledMaintenance,
      actionValue: "Database upgrade",
      command: "/oneuptime maintenance",
    });
  });

  test("/oneuptime oncall: who is on call", () => {
    expect(actionOf("/oneuptime", "oncall")).toEqual({
      actionType: SlackActionType.ShowOnCall,
      actionValue: "",
      command: "/oneuptime oncall",
    });
  });

  test("an older app's /incident and /maintenance: the same forms, run again as typed", () => {
    expect(actionOf("/incident", "Checkout is down")).toEqual({
      actionType: SlackActionType.NewIncident,
      actionValue: "Checkout is down",
      command: "/incident",
    });
    expect(actionOf("/maintenance", "")).toEqual({
      actionType: SlackActionType.NewScheduledMaintenance,
      actionValue: "",
      command: "/maintenance",
    });
  });

  test.each([
    ["help", "help"],
    ["", ""],
    ["ask which monitors are down?", "ask which monitors are down?"],
    ["which monitors are down?", "which monitors are down?"],
    ["incidnet Checkout", "incidnet Checkout"],
  ])(
    "/oneuptime %j - answered by /api/slack/command itself - is the command, with its text as sent",
    (text: string, value: string) => {
      expect(actionOf("/oneuptime", text)).toEqual({
        actionType: "/oneuptime",
        actionValue: value,
        command: "/oneuptime",
      });
    },
  );
});
