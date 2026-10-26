import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspacePayloadMarkdown } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import logger from "../../../../../Server/Utils/Logger";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import { WorkspaceSendMessageResponse } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
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
          "incident [title or number] | maintenance [title] | oncall | page [who] [message] | ask [question] | help",
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
 * that event: OneUptime draws the Home then (SlackHome), and welcomes
 * somebody opening the Messages tab for the first time
 * (SlackMessagesWelcome). member_joined_channel tells it a person added it
 * to a channel, where it says hello once (SlackWelcome). Neither event
 * needs a scope of its own beyond what the app has: app_home_opened none
 * (the welcome is a chat.postMessage, chat:write), member_joined_channel the
 * channels:read and groups:read it reads channels with already - so turning
 * them on asks no workspace to install the app again.
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

/*
 * THE SCOPES THE APP ASKS FOR: THE ONES IT USES, AND NO MORE.
 *
 * Slack's review of the app for the Slack Marketplace: "The im:read and
 * im:write scopes are not required for sending messages in the 'Messages'
 * tab and chat:write can be used for this ... The user token for users:read
 * does not appear required." OneUptime posts to a person's id with
 * chat.postMessage, which Slack delivers to the app's direct messages
 * (chat:write); it opens no conversation of its own (conversations.open:
 * im:write, mpim:write), sets no channel's topic or purpose
 * (channels:write.topic), and acts with the bot's token and a person's
 * Slack user id, never a token of theirs.
 *
 * im:read and mpim:read stay. A New Incident or New Scheduled Maintenance
 * form opened by /oneuptime in the app's direct messages, or in a group DM
 * the app is in, posts its "created" message back there, and /oneuptime
 * page posts its page message where it was run - each through
 * SlackUtil.sendMessage, which reads the conversation (conversations.info)
 * and whether the app is in it (conversations.members). Slack answers those
 * for a direct message only with im:read, and for a group DM only with
 * mpim:read; without them the message is not posted.
 *
 * Each Slack Web API method the server calls - read from the source, so a
 * new one cannot be called unlisted - and each event the app hears, with the
 * bot scopes Slack takes for it on the kinds of conversation OneUptime uses
 * it on: each has a scope the manifest asks for, and each scope the manifest
 * asks for is one of theirs.
 */

// Any one of them lets the app call the method, as OneUptime calls it.
const METHOD_SCOPES: Record<string, Array<string>> = {
  // The two OAuth exchanges, and the Home and modals: no scope.
  "oauth.v2.access": [],
  "openid.connect.token": [],
  "views.open": [],
  // A form in place of the modal its project was chosen in (SlackProjectChoice).
  "views.update": [],
  "views.publish": [],
  "chat.postMessage": ["chat:write"],
  "chat.postEphemeral": ["chat:write"],
  "chat.update": ["chat:write"],
  "chat.delete": ["chat:write"],
  "conversations.list": ["channels:read", "groups:read"],
  "conversations.info": [
    "channels:read",
    "groups:read",
    "im:read",
    "mpim:read",
  ],
  "conversations.members": [
    "channels:read",
    "groups:read",
    "im:read",
    "mpim:read",
  ],
  "conversations.history": [
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
  ],
  "conversations.replies": [
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
  ],
  // A public or a private channel: OneUptime creates no direct message.
  "conversations.create": ["channels:manage", "groups:write"],
  "conversations.archive": ["channels:manage", "groups:write"],
  "conversations.invite": ["channels:write.invites", "groups:write"],
  "conversations.join": ["channels:join"],
  "files.getUploadURLExternal": ["files:write"],
  "files.completeUploadExternal": ["files:write"],
  "users.info": ["users:read"],
  "users.lookupByEmail": ["users:read.email"],
  // The workspace's people, to ask many members to connect at once.
  "users.list": ["users:read"],
  "usergroups.list": ["usergroups:read"],
  "usergroups.users.list": ["usergroups:read"],
  "usergroups.create": ["usergroups:write"],
  "usergroups.users.update": ["usergroups:write"],
  "usergroups.disable": ["usergroups:write"],
  "usergroups.enable": ["usergroups:write"],
};

// The events the app hears, with the scopes Slack sends each with.
const EVENT_SCOPES: Record<string, Array<string>> = {
  app_home_opened: [],
  app_mention: ["app_mentions:read"],
  member_joined_channel: ["channels:read", "groups:read"],
  "message.channels": ["channels:history"],
  "message.groups": ["groups:history"],
  "message.im": ["im:history"],
  "message.mpim": ["mpim:history"],
  pin_added: ["pins:read"],
  reaction_added: ["reactions:read"],
};

// Where the server calls Slack: the workspace utilities, and the Slack routes.
const SLACK_SOURCES: Array<string> = [
  path.resolve(__dirname, "../../../../../Server/Utils/Workspace"),
  path.resolve(__dirname, "../../../../../Server/API/SlackAPI.ts"),
];

// How the source names a method: a URL, or a method its helpers are handed.
const METHOD_MARKERS: Array<string> = [
  "slack.com/api/",
  'method: "',
  'apiMethod: "',
];

// A character of a method's name, as in "usergroups.users.update".
const METHOD_CHARACTER: RegExp = /^[A-Za-z0-9_.]$/;

function typeScriptFiles(at: string): Array<string> {
  if (!fs.statSync(at).isDirectory()) {
    return [at];
  }

  return fs.readdirSync(at).flatMap((name: string): Array<string> => {
    const child: string = path.join(at, name);

    if (fs.statSync(child).isDirectory()) {
      return typeScriptFiles(child);
    }

    return name.endsWith(".ts") ? [child] : [];
  });
}

function isMethodCharacter(character: string): boolean {
  return METHOD_CHARACTER.test(character);
}

// Every Slack method the source names, once each.
function calledMethods(): Array<string> {
  const methods: Set<string> = new Set();

  for (const file of SLACK_SOURCES.flatMap(typeScriptFiles)) {
    const source: string = fs.readFileSync(file, "utf8");

    for (const marker of METHOD_MARKERS) {
      let from: number = source.indexOf(marker);

      while (from !== -1) {
        const start: number = from + marker.length;
        let end: number = start;

        while (end < source.length && isMethodCharacter(source[end]!)) {
          end++;
        }

        // A sentence's full stop is not the method's.
        let name: string = source.substring(start, end);

        while (name.endsWith(".")) {
          name = name.substring(0, name.length - 1);
        }

        // "slack.com/api/${method}" names none; a method is "noun.verb".
        if (name.includes(".")) {
          methods.add(name);
        }

        from = source.indexOf(marker, end);
      }
    }
  }

  return Array.from(methods).sort();
}

describe("the scopes the Slack app asks for", () => {
  const scopes: JSONObject = (manifest["oauth_config"] as JSONObject)[
    "scopes"
  ] as JSONObject;
  const bot: Array<string> = scopes["bot"] as unknown as Array<string>;
  const events: Array<string> = (
    (manifest["settings"] as JSONObject)["event_subscriptions"] as JSONObject
  )["bot_events"] as unknown as Array<string>;
  const methods: Array<string> = calledMethods();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no user scopes: Slack names who installed the app all the same, and OneUptime never acts with a token of theirs", () => {
    expect(scopes["user"]).toEqual([]);
  });

  test("none of the scopes Slack's review found unneeded: no im:write or mpim:write - chat:write reaches the Messages tab - and no channels:write.topic", () => {
    for (const scope of ["im:write", "mpim:write", "channels:write.topic"]) {
      expect(bot).not.toContain(scope);
    }

    expect(bot).toContain("chat:write");
  });

  /*
   * Why im:read and mpim:read stay (see above): a message posted to the
   * app's direct messages by their id - a form's "created" message, a page
   * message - reads the conversation and who is in it first.
   */
  test("im:read and mpim:read stay: a message posted to a direct message by its id reads the conversation, and whether the app is in it, first", async () => {
    const asked: Array<{ method: string; channel: unknown }> = [];

    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data: JSONObject;
    }) => {
      const method: string = options.url.toString().split("/api/").pop() || "";
      asked.push({ method: method, channel: options.data["channel"] });

      // A direct message, as Slack answers for one: no name, two members.
      if (method === "conversations.info") {
        return new HTTPResponse<JSONObject>(
          200,
          {
            ok: true,
            channel: { id: "D0ALICE", is_im: true, user: "U0ALICE" },
          },
          {},
        );
      }

      if (method === "conversations.members") {
        return new HTTPResponse<JSONObject>(
          200,
          {
            ok: true,
            members: ["U0ALICE", "U0ONEUPTIME"],
            response_metadata: { next_cursor: "" },
          },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { ok: true, ts: "1" }, {});
    }) as never);

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      authToken: "xoxb-project-token",
      userId: "U0ONEUPTIME",
      projectId: ObjectID.generate(),
      workspaceMessagePayload: {
        _type: "WorkspaceMessagePayload",
        workspaceType: WorkspaceType.Slack,
        channelIds: ["D0ALICE"],
        channelNames: [],
        messageBlocks: [
          {
            _type: "WorkspacePayloadMarkdown",
            text: "Incident INC-1 created successfully.",
          } as WorkspacePayloadMarkdown,
        ],
      },
    });

    expect(asked).toEqual([
      { method: "conversations.info", channel: "D0ALICE" },
      { method: "conversations.members", channel: "D0ALICE" },
      { method: "chat.postMessage", channel: "D0ALICE" },
    ]);
    expect(response.errors).toEqual([]);
    expect(bot).toEqual(expect.arrayContaining(["im:read", "mpim:read"]));
  });

  test("…and without im:read Slack refuses those reads (missing_scope): the message is not posted", async () => {
    const asked: Array<string> = [];

    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
    }) => {
      const method: string = options.url.toString().split("/api/").pop() || "";
      asked.push(method);

      if (method.startsWith("conversations.")) {
        return new HTTPResponse<JSONObject>(
          200,
          { ok: false, error: "missing_scope", needed: "im:read" },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { ok: true, ts: "1" }, {});
    }) as never);

    const response: WorkspaceSendMessageResponse = await SlackUtil.sendMessage({
      authToken: "xoxb-project-token",
      userId: "U0ONEUPTIME",
      projectId: ObjectID.generate(),
      workspaceMessagePayload: {
        _type: "WorkspaceMessagePayload",
        workspaceType: WorkspaceType.Slack,
        channelIds: ["D0ALICE"],
        channelNames: [],
        messageBlocks: [
          {
            _type: "WorkspacePayloadMarkdown",
            text: "Incident INC-1 created successfully.",
          } as WorkspacePayloadMarkdown,
        ],
      },
    });

    expect(asked).not.toContain("chat.postMessage");
    expect(response.threads).toEqual([]);
    expect(response.errors).toHaveLength(1);
  });

  test("the source scan finds the methods it is there for", () => {
    expect(methods).toEqual(
      expect.arrayContaining([
        "chat.postMessage",
        "conversations.info",
        // Handed to a helper, not written as a URL.
        "conversations.history",
        "usergroups.users.update",
        "users.lookupByEmail",
      ]),
    );
    expect(methods).not.toContain("conversations.open");
  });

  test("every Slack Web API method the server calls is a known one, with a scope the manifest asks for", () => {
    for (const method of methods) {
      expect({ method, known: true }).toEqual({
        method,
        known: Object.keys(METHOD_SCOPES).includes(method),
      });

      const allowedBy: Array<string> = METHOD_SCOPES[method] || [];

      expect({ method, allowed: true }).toEqual({
        method,
        allowed:
          allowedBy.length === 0 ||
          allowedBy.some((scope: string): boolean => {
            return bot.includes(scope);
          }),
      });
    }
  });

  test("every event the app subscribes to comes with a scope the manifest asks for", () => {
    for (const event of events) {
      expect({ event, known: true }).toEqual({
        event,
        known: Object.keys(EVENT_SCOPES).includes(event),
      });

      const sentWith: Array<string> = EVENT_SCOPES[event] || [];

      expect({ event, allowed: true }).toEqual({
        event,
        allowed:
          sentWith.length === 0 ||
          sentWith.some((scope: string): boolean => {
            return bot.includes(scope);
          }),
      });
    }
  });

  test("every scope the manifest asks for is one a method the server calls, an event it hears, or its command needs", () => {
    const used: Set<string> = new Set();

    for (const method of methods) {
      for (const scope of METHOD_SCOPES[method] || []) {
        used.add(scope);
      }
    }

    for (const event of events) {
      for (const scope of EVENT_SCOPES[event] || []) {
        used.add(scope);
      }
    }

    // /oneuptime, and the two shortcuts.
    if (slashCommands.length > 0 || shortcuts.length > 0) {
      used.add("commands");
    }

    expect(
      bot.filter((scope: string): boolean => {
        return !used.has(scope);
      }),
    ).toEqual([]);
  });
});
