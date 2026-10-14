import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "../../../../../Types/JSON";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackIncidentActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackCommandParser, {
  LEGACY_SLACK_COMMANDS,
} from "../../../../../Server/Utils/Workspace/Slack/SlackCommandParser";
import WorkspaceCommands, {
  WORKSPACE_COMMANDS,
  WorkspaceCommandDefinition,
} from "../../../../../Server/Utils/Workspace/WorkspaceCommands";

/*
 * THE SLACK APP'S COMMANDS, AS ITS MANIFEST REGISTERS THEM.
 *
 * Customer feedback #5: "I noticed it registers as /incident, /maintenance.
 * This can easily conflict with the other apps we have." The app registers
 * one command of its own, /oneuptime; incident, maintenance, oncall, page,
 * ask and help are words after it. Self-hosted servers create their Slack
 * app from this manifest, and OneUptime Cloud's app is updated to match it.
 *
 * `/oneuptime page @nawaz ...` pages the person behind the mention, so the
 * command has Slack send people as ids (should_escape), and the app may
 * read the email address Slack has for somebody whose Slack account is not
 * connected (users:read.email).
 *
 * An app created from an older manifest keeps /incident and /maintenance
 * until it is updated: those still open their forms (SlackCommandParser),
 * and the shortcuts keep the callback ids they always had, so an app's
 * shortcuts work whether it was updated or not.
 */

const MANIFEST_PATH: string = path.resolve(
  __dirname,
  "../../../../../Server/Utils/Workspace/Slack/app-manifest.json",
);

interface SlashCommand {
  command: string;
  url: string;
  description: string;
  usage_hint: string;
  should_escape: boolean;
}

interface Shortcut {
  name: string;
  type: string;
  callback_id: string;
  description: string;
}

const manifest: JSONObject = JSON.parse(
  fs.readFileSync(MANIFEST_PATH, "utf8"),
) as JSONObject;

const features: JSONObject = manifest["features"] as JSONObject;
const slashCommands: Array<SlashCommand> = features[
  "slash_commands"
] as unknown as Array<SlashCommand>;
const shortcuts: Array<Shortcut> = features[
  "shortcuts"
] as unknown as Array<Shortcut>;

describe("the Slack app manifest's commands", () => {
  test("one command, /oneuptime, posted to /api/slack/command - no /incident, no /maintenance", () => {
    expect(slashCommands).toEqual([
      {
        command: "/oneuptime",
        url: "{{SERVER_URL}}/api/slack/command",
        description:
          "Declare an incident, schedule maintenance, see who is on call, page someone or ask OneUptime AI",
        usage_hint:
          "incident [title] | maintenance [title] | oncall | page [who] [message] | ask [question] | help",
        should_escape: true,
      },
    ]);
  });

  /*
   * With escaping off, Slack sends "@nawaz" as the text typed - a name
   * anybody may go by. With it on, a person is <@U0123|nawaz>: the page goes
   * to the account behind the id. A title or a question is read back as
   * typed either way (SlackCommandParser.toPlainText).
   */
  test("Slack sends the people a command @mentions as ids, so a page reaches the person meant", () => {
    expect(slashCommands[0]!.should_escape).toBe(true);
  });

  test("the app may read the email address Slack has for a person, to page one whose Slack account is not connected", () => {
    const scopes: Array<string> = (
      (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
    )["bot"] as unknown as Array<string>;

    expect(scopes).toEqual(
      expect.arrayContaining(["users:read", "users:read.email"]),
    );
  });


  test("the command is the one the server reads its words after", () => {
    expect(slashCommands[0]!.command).toBe(WorkspaceCommands.SLACK_COMMAND);
  });

  test("its usage hint names every command, with what follows each, in the help's order", () => {
    const hint: string = slashCommands[0]!.usage_hint;

    expect(hint.split(" | ")).toEqual(
      WORKSPACE_COMMANDS.map((definition: WorkspaceCommandDefinition) => {
        const argumentHint: string =
          WorkspaceCommands.getArgumentHint(definition);

        return argumentHint
          ? `${definition.name} ${argumentHint}`
          : definition.name;
      }),
    );
  });

  test("a command Slack takes: lower case, a slash, no space, at most 32 characters", () => {
    for (const command of slashCommands) {
      expect(command.command).toMatch(/^\/[a-z0-9_-]{1,31}$/);
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.usage_hint.length).toBeGreaterThan(0);
    }
  });

  test("none of the older apps' commands is registered any more", () => {
    const registered: Array<string> = slashCommands.map(
      (command: SlashCommand): string => {
        return command.command;
      },
    );

    for (const legacy of Object.keys(LEGACY_SLACK_COMMANDS)) {
      expect(registered).not.toContain(legacy);
    }
  });
});

describe("the Slack app manifest's shortcuts", () => {
  test("Create New Incident and Create Scheduled Event keep the callback ids they always had", () => {
    expect(
      shortcuts.map((shortcut: Shortcut) => {
        return [shortcut.name, shortcut.type, shortcut.callback_id];
      }),
    ).toEqual([
      [
        "Create Scheduled Event",
        "global",
        SlackActionType.NewScheduledMaintenance,
      ],
      ["Create New Incident", "global", SlackActionType.NewIncident],
    ]);
  });

  test("each opens the form its command opens", () => {
    expect(
      SlackIncidentActions.isIncidentAction({
        actionType: SlackActionType.NewIncident,
      }),
    ).toBe(true);
    expect(
      SlackScheduledMaintenanceActions.isScheduledMaintenanceAction({
        actionType: SlackActionType.NewScheduledMaintenance,
      }),
    ).toBe(true);
  });
});

describe("apps created from an older manifest", () => {
  test("/incident and /maintenance still open their forms, their text the title", () => {
    expect(
      SlackCommandParser.getAction(
        SlackCommandParser.read({ command: "/incident", text: "Checkout" }),
      ),
    ).toEqual({
      actionType: SlackActionType.NewIncident,
      actionValue: "Checkout",
      command: "/incident",
    });
    expect(
      SlackCommandParser.getAction(
        SlackCommandParser.read({ command: "/maintenance", text: "Upgrade" }),
      ),
    ).toEqual({
      actionType: SlackActionType.NewScheduledMaintenance,
      actionValue: "Upgrade",
      command: "/maintenance",
    });
  });
});
