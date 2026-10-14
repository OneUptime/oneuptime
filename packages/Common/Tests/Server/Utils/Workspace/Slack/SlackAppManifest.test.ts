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

  /*
   * Customer feedback #3: "We have a number of @teamname-oncall user groups
   * in Slack that is always updated with the on-call person(s)". OneUptime
   * keeps such a group in step (SlackUserGroups), which reads and changes
   * user groups as the app's bot.
   */
  test("the app may read and change user groups, to keep an @team-oncall group in step with who is on call", () => {
    const scopes: Array<string> = (
      (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
    )["bot"] as unknown as Array<string>;

    expect(scopes).toEqual(
      expect.arrayContaining(["usergroups:read", "usergroups:write"]),
    );
  });

  /*
   * Every Slack Web API method the user group sync calls, with the bot scope
   * Slack asks of it. The source is read for the methods it names, so a new
   * method cannot be called without a scope the manifest asks for.
   */
  test("every Slack method the user group sync calls has its scope in the manifest", () => {
    const methodScopes: Record<string, string> = {
      "usergroups.list": "usergroups:read",
      "usergroups.users.list": "usergroups:read",
      "usergroups.users.update": "usergroups:write",
      "usergroups.create": "usergroups:write",
      "usergroups.disable": "usergroups:write",
      "usergroups.enable": "usergroups:write",
      "users.info": "users:read",
      "users.lookupByEmail": "users:read.email",
    };

    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../Server/Utils/Workspace/Slack/SlackUserGroups.ts",
      ),
      "utf8",
    );

    const named: Array<string> = [];
    const marker: string = 'method: "';
    let from: number = source.indexOf(marker);

    while (from !== -1) {
      const start: number = from + marker.length;
      const end: number = source.indexOf('"', start);
      named.push(source.substring(start, end));
      from = source.indexOf(marker, end);
    }

    expect(named.length).toBeGreaterThanOrEqual(8);

    const scopes: Array<string> = (
      (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
    )["bot"] as unknown as Array<string>;

    for (const method of named) {
      expect(Object.keys(methodScopes)).toContain(method);
      expect(scopes).toContain(methodScopes[method]);
    }
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

/*
 * THE APP'S HOME TAB, AND ITS HELLO IN A CHANNEL.
 *
 * Slack shows an app's Home tab only when the manifest enables it, and
 * tells the app it was opened (app_home_opened) only when the app asks for
 * that event: OneUptime draws the Home then (SlackHome). member_joined_channel
 * tells it a person added it to a channel, where it says hello once
 * (SlackWelcome). Neither event needs a scope of its own beyond what the app
 * has: app_home_opened none, member_joined_channel the channels:read and
 * groups:read it reads channels with already - so turning them on asks no
 * workspace to install the app again.
 */
describe("the Slack app manifest's Home tab and hello", () => {
  const appHome: JSONObject = features["app_home"] as JSONObject;
  const events: Array<string> = (
    (manifest["settings"] as JSONObject)["event_subscriptions"] as JSONObject
  )["bot_events"] as unknown as Array<string>;
  const scopes: Array<string> = (
    (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
  )["bot"] as unknown as Array<string>;

  test("the Home tab is on, beside the Messages tab people write to the app in", () => {
    expect(appHome["home_tab_enabled"]).toBe(true);
    expect(appHome["messages_tab_enabled"]).toBe(true);
    expect(appHome["messages_tab_read_only_enabled"]).toBe(false);
  });

  test("the app hears when its Home is opened, and when it joins a channel", () => {
    expect(events).toEqual(
      expect.arrayContaining(["app_home_opened", "member_joined_channel"]),
    );
  });

  test("the scopes those events need are ones the app had already", () => {
    expect(scopes).toEqual(
      expect.arrayContaining(["channels:read", "groups:read", "chat:write"]),
    );
  });

  test("every event the app subscribes to that is not a message has a handler in the events route", () => {
    const route: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../../Server/API/SlackAPI.ts"),
      "utf8",
    );

    for (const event of events) {
      if (event.startsWith("message.") || event === "app_mention") {
        // Messages and mentions are read by SlackAiConversations.
        continue;
      }

      expect(route).toContain(`event["type"] === "${event}"`);
    }
  });
});
