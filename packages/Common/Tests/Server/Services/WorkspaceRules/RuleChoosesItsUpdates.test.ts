import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceRuleWorld, {
  makeRule,
  OTHER_RULE_ID,
  RULE_ID,
} from "./WorkspaceRuleWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE CUSTOMER'S #EXECUTIVE-ALERTS HEARS THAT AN INCIDENT WAS DECLARED AND
 * RESOLVED, AND NOT EVERY NOTE, OWNER AND PAGE (#7581).
 *
 * "We have an #executive-alerts channel that should only get the incident
 * declared and resolved messages. Right now it gets every state change,
 * every note, every owner change." A rule's Updates step now says which
 * updates it posts; Key updates only is what that channel wants.
 *
 * Driven through the real rule matching, channel creation and posting
 * against a fake Slack API; only the database is in memory
 * (WorkspaceRuleWorld). Each update is posted as the incident's feed posts
 * it, with the updates it is (FeedUpdateKinds).
 */

const {
  Created,
  VideoCallStarted,
  ResolvedAndReopened,
  StateChanges,
  SeverityChanges,
  PublicNotes,
  PrivateNotes,
  Owners,
  Paging,
  Postmortem,
  AI,
  Edits,
  Other,
} = NotificationRuleUpdateKind;

const KEY_UPDATES: Array<NotificationRuleUpdateKind> =
  NotificationRuleUpdates.getKeyKinds(NotificationRuleEventType.Incident);

const EXECUTIVE_CHANNEL_ID: string = "C0EXEC";

// What an incident's feed posts, and the update each one is.
const UPDATES: Array<{ markdown: string; kind: NotificationRuleUpdateKind }> = [
  { markdown: "👀 Changed state to Acknowledged", kind: StateChanges },
  { markdown: "🔒 Private note: checking the primary", kind: PrivateNotes },
  { markdown: "👤 Added Simon Lee as an owner", kind: Owners },
  { markdown: "📟 Paged the on-call engineer", kind: Paging },
  { markdown: "🤖 Root cause analysis is ready", kind: AI },
  { markdown: "✏️ Changed the title", kind: Edits },
  { markdown: "🔗 Linked alert ALT-7", kind: Other },
  { markdown: "🔴 Changed severity to Critical", kind: SeverityChanges },
  { markdown: "📢 Public note: we are investigating", kind: PublicNotes },
  { markdown: "📝 Postmortem published", kind: Postmortem },
  { markdown: "✅ Changed state to Resolved", kind: ResolvedAndReopened },
];

let world: WorkspaceRuleWorld;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
  world.addSlackChannel({ id: EXECUTIVE_CHANNEL_ID, name: "executive-alerts" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Each update of the feed, posted as the feed posts it.
async function postEveryUpdate(): Promise<void> {
  for (const update of UPDATES) {
    await world.postAboutIncident(update.markdown, [update.kind]);
  }
}

// Which of the updates reached a channel, by their text.
function updatesIn(channelId: string): Array<string> {
  const messages: string = world.slackMessagesIn(channelId).join("\n");

  return UPDATES.filter(
    (update: { markdown: string; kind: NotificationRuleUpdateKind }) => {
      return messages.includes(JSON.stringify(update.markdown).slice(1, -1));
    },
  ).map((update: { markdown: string; kind: NotificationRuleUpdateKind }) => {
    return update.kind;
  });
}

function incidentChannels(): Array<NotificationRuleWorkspaceChannel> {
  return world.incident.channels || [];
}

describe("the customer's #executive-alerts: Key updates only", () => {
  test("REGRESSION: hears of the severity, the public note, the postmortem and the resolve, and of nothing else", async () => {
    world.rules = [
      makeRule({
        name: "Executive alerts",
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: KEY_UPDATES,
      }),
    ];

    await postEveryUpdate();

    expect(updatesIn(EXECUTIVE_CHANNEL_ID)).toEqual([
      SeverityChanges,
      PublicNotes,
      Postmortem,
      ResolvedAndReopened,
    ]);
  });

  test("while the incident's own channel, of a rule that posts every update, hears all of it", async () => {
    world.rules = [
      makeRule({ id: RULE_ID, name: "Incident channels" }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "Executive alerts",
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: KEY_UPDATES,
      }),
    ];

    await world.createIncidentChannels();
    await postEveryUpdate();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    expect(updatesIn(incidentChannels()[0]!.id)).toEqual(
      UPDATES.map((update: { kind: NotificationRuleUpdateKind }) => {
        return update.kind;
      }),
    );
    expect(updatesIn(EXECUTIVE_CHANNEL_ID)).toEqual([
      SeverityChanges,
      PublicNotes,
      Postmortem,
      ResolvedAndReopened,
    ]);
  });

  test("a channel the quiet rule creates for the incident is just as quiet", async () => {
    world.rules = [
      makeRule({
        name: "Executive channel",
        prefix: "exec-",
        updatesToPost: KEY_UPDATES,
      }),
    ];

    await world.createIncidentChannels();
    await postEveryUpdate();

    expect(world.slackChannelsCreated()).toEqual(["exec-inc-42"]);
    expect(updatesIn(incidentChannels()[0]!.id)).toEqual([
      SeverityChanges,
      PublicNotes,
      Postmortem,
      ResolvedAndReopened,
    ]);
  });
});

describe("rules that do not choose", () => {
  test("a rule saved before the Updates step posts every update, as it always did", async () => {
    world.rules = [
      makeRule({
        name: "Executive alerts",
        createsChannel: false,
        existingChannels: "executive-alerts",
      }),
    ];

    await postEveryUpdate();

    expect(updatesIn(EXECUTIVE_CHANNEL_ID)).toHaveLength(UPDATES.length);
  });

  test("a message that says nothing of its kind is posted as it always was", async () => {
    world.rules = [
      makeRule({
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: [],
      }),
    ];

    await world.postAboutIncident("🔒 Private note: checking the primary");

    expect(world.slackMessagesIn(EXECUTIVE_CHANNEL_ID)).toHaveLength(1);
  });
});

describe("what every rule posts, whatever it chose", () => {
  test("a rule that ticked nothing still posts the first message and a video call", async () => {
    world.rules = [
      makeRule({
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: [],
      }),
    ];

    await world.postAboutIncident("🚨 Incident INC-42 declared", [Created]);
    await world.postAboutIncident("📹 Join the call", [VideoCallStarted]);
    await postEveryUpdate();

    const messages: string = world
      .slackMessagesIn(EXECUTIVE_CHANNEL_ID)
      .join("\n");

    expect(world.slackMessagesIn(EXECUTIVE_CHANNEL_ID)).toHaveLength(2);
    expect(messages).toContain("Incident INC-42 declared");
    expect(messages).toContain("Join the call");
  });
});

describe("a channel more than one rule speaks for", () => {
  test("two rules that share the incident's channel: it hears what either wants", async () => {
    world.rules = [
      makeRule({ id: RULE_ID, name: "Quiet", updatesToPost: KEY_UPDATES }),
      makeRule({ id: OTHER_RULE_ID, name: "Responders" }),
    ];

    await world.createIncidentChannels();

    expect(incidentChannels()).toHaveLength(1);
    expect(incidentChannels()[0]!.notificationRuleIds).toEqual([
      RULE_ID.toString(),
      OTHER_RULE_ID.toString(),
    ]);

    await postEveryUpdate();

    expect(updatesIn(incidentChannels()[0]!.id)).toHaveLength(UPDATES.length);
  });

  test("two quiet rules that share it: it hears only what one of them wants", async () => {
    world.rules = [
      makeRule({ id: RULE_ID, name: "Quiet", updatesToPost: KEY_UPDATES }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "Pages",
        updatesToPost: [Paging],
      }),
    ];

    await world.createIncidentChannels();
    await postEveryUpdate();

    expect(updatesIn(incidentChannels()[0]!.id)).toEqual([
      Paging,
      SeverityChanges,
      PublicNotes,
      Postmortem,
      ResolvedAndReopened,
    ]);
  });

  test("two rules that name one existing channel: it hears each update once, when either wants it", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: KEY_UPDATES,
      }),
      makeRule({
        id: OTHER_RULE_ID,
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: [PrivateNotes],
      }),
    ];

    await postEveryUpdate();

    expect(updatesIn(EXECUTIVE_CHANNEL_ID)).toEqual([
      PrivateNotes,
      SeverityChanges,
      PublicNotes,
      Postmortem,
      ResolvedAndReopened,
    ]);
    expect(world.slackMessagesIn(EXECUTIVE_CHANNEL_ID)).toHaveLength(5);
  });
});

describe("channels no rule speaks for any more", () => {
  test("a channel whose rule was deleted hears every update, as before", async () => {
    world.rules = [
      makeRule({ id: RULE_ID, name: "Quiet", updatesToPost: KEY_UPDATES }),
    ];

    await world.createIncidentChannels();

    const channelId: string = incidentChannels()[0]!.id;

    // The rule is deleted; another quiet rule posts elsewhere.
    world.rules = [
      makeRule({
        id: OTHER_RULE_ID,
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: KEY_UPDATES,
      }),
    ];

    await postEveryUpdate();

    expect(updatesIn(channelId)).toHaveLength(UPDATES.length);
    expect(updatesIn(EXECUTIVE_CHANNEL_ID)).toHaveLength(4);
  });

  test("a channel stored before its rules were recorded hears every update", async () => {
    world.addSlackChannel({ id: "C0OLD", name: "inc-42" });
    world.incident.channels = [
      {
        id: "C0OLD",
        name: "inc-42",
        workspaceType: WorkspaceType.Slack,
      } as NotificationRuleWorkspaceChannel,
    ];
    world.rules = [
      makeRule({
        createsChannel: false,
        existingChannels: "executive-alerts",
        updatesToPost: KEY_UPDATES,
      }),
    ];

    await postEveryUpdate();

    expect(updatesIn("C0OLD")).toHaveLength(UPDATES.length);
    expect(updatesIn(EXECUTIVE_CHANNEL_ID)).toHaveLength(4);
  });
});
