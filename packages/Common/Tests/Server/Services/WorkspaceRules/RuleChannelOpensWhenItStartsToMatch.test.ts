import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../../Server/Infrastructure/Semaphore";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import EnterpriseEdition from "../../../../Server/Enterprise/EnterpriseEdition";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import { JSONObject } from "../../../../Types/JSON";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationActionType from "../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceRuleWorld, {
  ACKNOWLEDGED_STATE_ID,
  COMMANDER,
  CRITICAL_SEVERITY_ID,
  INCIDENT_ID,
  INCIDENT_LINK,
  makeRule,
  MINOR_SEVERITY_ID,
  ON_CALL,
  OTHER_RULE_ID,
  OWNER,
  refusedChannelRow,
  RESOLVED_STATE_ID,
  RULE_ID,
  TEAMS_TEAM_ID,
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
 * A RULE THAT STARTS TO MATCH AN INCIDENT LATER OPENS ITS CHANNEL THEN.
 *
 * The customer's second attempt: to have the commander - assigned at
 * acknowledgement - in the channel, they added the condition "Incident
 * State Contains Any Acknowledged" to their rule. "This stopped the rule
 * from triggering entirely (no channel created, no commander invited)."
 *
 * A rule's channel was only ever created when the incident was created, in
 * the Created state, which the condition rules out; nothing looked at the
 * rule again. Now a rule's conditions are checked when the incident is
 * created and again each time something about it is posted, and the first
 * time the incident matches, the rule's channel is opened - introduced,
 * with everybody the incident has by then that the rule adds.
 *
 * Driven through the real rule matching, channel creation, invites and
 * messages against a fake Slack API (and Microsoft Graph); only the
 * database is in memory (WorkspaceRuleWorld).
 */

let world: WorkspaceRuleWorld;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ACKNOWLEDGED: NotificationRuleCondition = {
  checkOn: NotificationRuleConditionCheckOn.IncidentState,
  conditionType: ConditionType.ContainsAny,
  value: [ACKNOWLEDGED_STATE_ID.toString()],
};

const CRITICAL: NotificationRuleCondition = {
  checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
  conditionType: ConditionType.ContainsAny,
  value: [CRITICAL_SEVERITY_ID.toString()],
};

// The customer's rule, with their condition: a channel for acknowledged incidents.
function acknowledgedIncidentsRule(
  options: { archive?: boolean; prefix?: string } = {},
): void {
  world.rules = [
    makeRule({
      name: "Acknowledged incidents",
      filters: [ACKNOWLEDGED],
      inviteOnCall: true,
      archive: Boolean(options.archive),
      ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
    }),
  ];
}

// The incident is acknowledged by COMMANDER, who becomes its commander.
async function acknowledge(): Promise<void> {
  world.incident.stateId = ACKNOWLEDGED_STATE_ID;
  await world.assignCommander(COMMANDER);
  await world.postAboutIncident(
    "👀 Changed **Incident INC-42 State** to **Acknowledged**",
  );
}

function storedChannels(): Array<NotificationRuleWorkspaceChannel> {
  return world.incident.channels || [];
}

describe("the customer's rule: Incident State contains any Acknowledged", () => {
  test("creates no channel while the incident is Created, and says its setup ran", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();

    expect(world.slackChannelsCreated()).toEqual([]);
    // An empty list: a rule that matches later may open its channel then.
    expect(world.incident.channels).toEqual([]);
  });

  test("REGRESSION: opens the incident's channel when it is acknowledged", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    await world.page(ON_CALL);
    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    // A public channel: Slack is not asked for a private one.
    expect(
      world.slackRequestsOf("conversations.create")[0]!["is_private"],
    ).toBeFalsy();

    // Stored on the incident, as the rule's channel.
    expect(storedChannels()).toEqual([
      {
        id: "C0NEW1",
        name: "inc-42",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: RULE_ID.toString(),
        notificationRuleIds: [RULE_ID.toString()],
      },
    ]);
  });

  test("REGRESSION: the person paged before and the commander assigned as it was acknowledged join it", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    await world.page(ON_CALL);
    await acknowledge();

    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0ONCALL", "U0CMDR"]);

    const invites: Array<WorkspaceNotificationLog> = world.logRowsOf(
      WorkspaceNotificationActionType.InviteUser,
    );
    expect(
      invites.map((row: WorkspaceNotificationLog): string => {
        return `${row.userId?.toString()}@${row.channelName}#${row.incidentId?.toString()}`;
      }),
    ).toEqual([
      `${ON_CALL.toString()}@inc-42#${INCIDENT_ID.toString()}`,
      `${COMMANDER.toString()}@inc-42#${INCIDENT_ID.toString()}`,
    ]);
  });

  test("the channel opens on what it is for, then its people join, then the acknowledgement is posted there", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    await world.page(ON_CALL);
    world.events.length = 0;
    world.slackRequests.length = 0;

    await acknowledge();

    const order: Array<string> = world.events.filter(
      (event: string): boolean => {
        return (
          [
            "slack:conversations.create",
            "slack:chat.postMessage",
            "slack:conversations.invite",
          ].includes(event) || event.startsWith("store:incident:")
        );
      },
    );

    expect(order).toEqual([
      "slack:conversations.create",
      // On the incident before anybody is invited.
      "store:incident:inc-42",
      // What the channel is for.
      "slack:chat.postMessage",
      "slack:conversations.invite",
      "slack:conversations.invite",
      // The change that matched the rule.
      "slack:chat.postMessage",
    ]);

    const [intro, acknowledgement] = world.slackMessagesIn("C0NEW1");

    expect(intro).toContain("This channel is for");
    expect(intro).toContain("Incident INC-42");
    expect(intro).toContain(INCIDENT_LINK.toString());
    expect(intro).toContain("Checkout is down");
    expect(intro).toContain("matched the rule");
    expect(intro).toContain("Acknowledged incidents");
    // The incident's buttons, as its first message carries them.
    expect(intro).toContain("Acknowledge Incident");
    expect(intro).toContain("Resolve Incident");
    expect(acknowledgement).toContain("Acknowledged");
  });

  test("the intro is listed on the incident's Notification Logs, with the channel's creation", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    await acknowledge();

    const created: Array<WorkspaceNotificationLog> = world.logRowsOf(
      WorkspaceNotificationActionType.CreateChannel,
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe(WorkspaceNotificationStatus.Success);
    expect(created[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());

    const sent: Array<WorkspaceNotificationLog> = world.logRowsOf(
      WorkspaceNotificationActionType.SendMessage,
    );
    expect(
      sent.some((row: WorkspaceNotificationLog): boolean => {
        return (
          row.channelId === "C0NEW1" &&
          (row.message || "").includes("This channel is for") &&
          row.incidentId?.toString() === INCIDENT_ID.toString()
        );
      }),
    ).toBe(true);
  });

  test("opens it once: later posts about the incident go to it, and no other channel is opened", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    await acknowledge();
    await world.postAboutIncident("📄 A note: the payment provider is down.");
    await world.postAboutIncident("📄 Another note.");

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    expect(storedChannels()).toHaveLength(1);
    expect(world.slackMessagesIn("C0NEW1")).toHaveLength(4);
  });

  test("its channel is archived when the incident is resolved, though the incident no longer matches the rule", async () => {
    acknowledgedIncidentsRule({ archive: true });

    await world.createIncidentChannels();
    await acknowledge();

    world.incident.stateId = RESOLVED_STATE_ID;
    await WorkspaceNotificationRuleService.archiveWorkspaceChannels({
      projectId: world.incidentModel().projectId!,
      notificationFor: { incidentId: INCIDENT_ID },
      sendMessageBeforeArchiving: {
        _type: "WorkspacePayloadMarkdown",
        text: "INC-42 is resolved. Archiving channel.",
      },
    });

    expect(world.slackRequestsOf("conversations.archive")).toEqual([
      { channel: "C0NEW1" },
    ]);
  });

  test("its prefix goes in front, as when a channel opens with the incident", async () => {
    acknowledgedIncidentsRule({ prefix: "ack-" });

    await world.createIncidentChannels();
    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual(["ack-inc-42"]);
  });

  test("a private incident's channel is private", async () => {
    acknowledgedIncidentsRule();
    world.incident.isPrivate = true;

    await world.createIncidentChannels();
    await acknowledge();

    expect(world.slackRequestsOf("conversations.create")[0]).toMatchObject({
      name: "inc-42",
      is_private: true,
    });
  });
});

describe("an incident created before channels were opened this way", () => {
  /*
   * An incident older than its setup window holds no list of channels when
   * it was created before this change, or while no workspace was connected,
   * or when its setup failed: a rule that starts to match it opens its
   * channel too.
   */
  test("opens the channel when the incident is acknowledged", async () => {
    acknowledgedIncidentsRule();
    world.incident.channels = null;
    world.incident.createdAt = new Date(Date.now() - 60 * 60 * 1000);

    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    expect(
      storedChannels().map((stored: NotificationRuleWorkspaceChannel) => {
        return stored.name;
      }),
    ).toEqual(["inc-42"]);
  });
});

describe("a severity condition", () => {
  test("a rule for Critical incidents opens the channel when the severity is raised to Critical", async () => {
    world.rules = [makeRule({ filters: [CRITICAL], inviteOwners: true })];
    world.incident.severityId = MINOR_SEVERITY_ID;
    world.incidentOwnerUsers = [OWNER];

    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual([]);

    world.incident.severityId = CRITICAL_SEVERITY_ID;
    await world.postAboutIncident(
      "⚠️ Changed **Incident INC-42 Severity** to **Critical**",
    );

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
    // The incident's owner joins it.
    expect(world.slackUsersInvitedTo("C0NEW1")).toEqual(["U0OWNER"]);
  });
});

describe("a second rule that starts to match", () => {
  test("opens its own channel beside the first rule's, and both are kept", async () => {
    world.rules = [
      makeRule({ name: "Every incident" }),
      makeRule({
        id: OTHER_RULE_ID,
        name: "Acknowledged incidents",
        prefix: "war-",
        filters: [ACKNOWLEDGED],
      }),
    ];

    await world.createIncidentChannels();
    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);

    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual(["inc-42", "war-inc-42"]);
    expect(
      storedChannels().map((channel: NotificationRuleWorkspaceChannel) => {
        return `${channel.name}:${channel.notificationRuleId}`;
      }),
    ).toEqual([
      `inc-42:${RULE_ID.toString()}`,
      `war-inc-42:${OTHER_RULE_ID.toString()}`,
    ]);
  });
});

describe("when no channel is opened later", () => {
  test("the incident's own setup is still running: created moments ago, without a list of channels", async () => {
    acknowledgedIncidentsRule();

    // No list of channels on the incident yet: its own setup opens them.
    world.incident.channels = null;
    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual([]);
  });

  test("the incident is resolved", async () => {
    world.rules = [
      makeRule({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentState,
            conditionType: ConditionType.ContainsAny,
            value: [RESOLVED_STATE_ID.toString()],
          },
        ],
      }),
    ];

    await world.createIncidentChannels();
    world.incident.stateId = RESOLVED_STATE_ID;
    await world.postAboutIncident("✅ Resolved");

    expect(world.slackChannelsCreated()).toEqual([]);
  });

  test("the incident has the rule's channel already", async () => {
    world.rules = [makeRule({ filters: [] })];

    await world.createIncidentChannels();
    await world.postAboutIncident("📄 A note.");

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });

  test("the incident has a channel by the name the rule asks for, stored before rules shared channels", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    // inc-42, created for another rule; this rule's id is not on it.
    world.incident.channels = [
      {
        id: "C0OLD",
        name: "inc-42",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: OTHER_RULE_ID.toString(),
      },
    ];

    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual([]);
  });

  test("Slack refused the channel for this incident before: it is not asked again", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    world.logRows.push(refusedChannelRow({ channelName: "inc-42" }));

    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual([]);
  });

  test("Slack refuses it now: logged once, and not asked again with the next post", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    world.slackRefusesCreate = "restricted_action";

    await acknowledge();
    await world.postAboutIncident("📄 A note.");

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);

    const refusals: Array<WorkspaceNotificationLog> = world
      .logRowsOf(WorkspaceNotificationActionType.CreateChannel)
      .filter((row: WorkspaceNotificationLog): boolean => {
        return row.status === WorkspaceNotificationStatus.Error;
      });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.channelName).toBe("inc-42");
    expect(refusals[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(world.incident.channels).toEqual([]);
  });

  test("another change of the incident holds its lock: that change opens the channel", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();

    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new SemaphoreLockTimeoutError("held") as never);

    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual([]);
  });

  test("without Valkey the channel still opens, unlocked", async () => {
    acknowledgedIncidentsRule();

    await world.createIncidentChannels();

    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("Redis client is not connected") as never);

    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual(["inc-42"]);
  });

  test("a rule that only posts to existing channels opens nothing", async () => {
    world.rules = [
      makeRule({
        createsChannel: false,
        existingChannels: "#ops",
        filters: [ACKNOWLEDGED],
      }),
    ];
    world.addSlackChannel({ id: "C0OPS", name: "ops" });

    await world.createIncidentChannels();
    await acknowledge();

    expect(world.slackChannelsCreated()).toEqual([]);
    // Posted in #ops while the incident matches.
    expect(world.slackMessagesIn("C0OPS")).toHaveLength(1);
  });
});

describe("Microsoft Teams", () => {
  test("the channel opens in the rule's team through Microsoft Graph, introduced in it", async () => {
    world.connected = [WorkspaceType.MicrosoftTeams];
    world.rules = [
      makeRule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        name: "Acknowledged incidents",
        filters: [ACKNOWLEDGED],
        teamToCreateChannelIn: TEAMS_TEAM_ID,
      }),
    ];

    const sent: Array<WorkspaceMessagePayload> = [];
    jest
      .spyOn(MicrosoftTeamsUtil, "sendMessage")
      .mockImplementation((async (data: {
        workspaceMessagePayload: WorkspaceMessagePayload;
      }): Promise<WorkspaceSendMessageResponse> => {
        sent.push(data.workspaceMessagePayload);
        return {
          workspaceType: WorkspaceType.MicrosoftTeams,
          threads: data.workspaceMessagePayload.channelIds.map(
            (channelId: string) => {
              return {
                channel: {
                  id: channelId,
                  name: "inc-42",
                  workspaceType: WorkspaceType.MicrosoftTeams,
                },
                threadId: "1",
              };
            },
          ),
          errors: [],
        };
      }) as never);

    await world.createIncidentChannels();
    expect(world.graphCreates).toEqual([]);

    await acknowledge();

    expect(world.graphCreates).toEqual([
      {
        teamId: TEAMS_TEAM_ID,
        displayName: "inc-42",
        membershipType: "standard",
      },
    ]);

    const channelId: string = "19:channel-1@thread.tacv2";
    const intro: WorkspaceMessagePayload | undefined = sent.find(
      (payload: WorkspaceMessagePayload): boolean => {
        return JSON.stringify(payload.messageBlocks).includes(
          "This channel is for",
        );
      },
    );

    expect(intro?.channelIds).toEqual([channelId]);
    expect(intro?.teamId).toBe(TEAMS_TEAM_ID);
    // Its buttons, as the incident's first card carries them.
    expect(JSON.stringify(intro?.messageBlocks)).toContain(
      "Acknowledge Incident",
    );
    // Teams adds team members to its channels: nobody is invited by OneUptime.
    expect(world.slackRequests).toEqual([]);
  });
});

describe("the intro's words", () => {
  test("say what the channel is for and which rule opened it, as plain text in the Markdown", async () => {
    acknowledgedIncidentsRule();
    world.rules[0]!.name = "*Ack* [rule](https://example.com)";

    await world.createIncidentChannels();
    await acknowledge();

    const intro: JSONObject = world.slackRequestsOf("chat.postMessage")[0]!;
    const text: string = JSON.stringify(intro["blocks"]);

    // A rule's name is text: its Markdown characters are escaped.
    expect(text).not.toContain("**[rule](https://example.com)**");
    expect(text).toContain("OneUptime created it when the incident matched");
  });

  // Server-written text that names the product says the installation's name.
  test("name the installation as it goes by another name", async () => {
    jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue({
      productName: "Acme Paging",
    });

    acknowledgedIncidentsRule();

    await world.createIncidentChannels();
    await acknowledge();

    const intro: JSONObject = world.slackRequestsOf("chat.postMessage")[0]!;
    const text: string = JSON.stringify(intro["blocks"]);

    expect(text).toContain("Acme Paging created it when the incident matched");
    expect(text).not.toContain("OneUptime created it");
  });
});
