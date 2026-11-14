import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceChannel } from "../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHERE A MESSAGE GOES WHEN RULES CHOOSE THEIR UPDATES (#7581), AND WHAT
 * THE API TAKES FOR THEM.
 *
 * A message that says which updates it is (updateKinds) is posted:
 *
 *   - in a channel OneUptime created for the record, when a rule it was
 *     created for wants one of them (a channel stored before its rules
 *     were, or whose rules are all gone, gets everything);
 *   - in an existing channel, and a Microsoft Teams chat, when a matching
 *     rule that names it wants one of them;
 *
 * in Slack, Microsoft Teams and Mattermost alike, for incidents, alerts,
 * both kinds of episode and scheduled maintenance. A message of no kind,
 * the first message and a video call go everywhere they always did.
 *
 * Saving a rule through the API or a workflow, a list of updates its kind
 * of rule cannot choose is refused with what it may hold.
 */

const {
  Created,
  VideoCallStarted,
  ResolvedAndReopened,
  SeverityChanges,
  PublicNotes,
  PrivateNotes,
  Paging,
  Postmortem,
} = NotificationRuleUpdateKind;

const PROJECT_ID: ObjectID = new ObjectID(
  "75810000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "75810000-0000-4000-8000-000000000002",
);

const INCIDENT_KEY: Array<NotificationRuleUpdateKind> =
  NotificationRuleUpdates.getKeyKinds(NotificationRuleEventType.Incident);

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<WorkspaceNotificationRule>,
  ) => Promise<OnCreate<WorkspaceNotificationRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<WorkspaceNotificationRule>,
  ) => Promise<OnUpdate<WorkspaceNotificationRule>>;
};

const hooks: Hooks = WorkspaceNotificationRuleService as unknown as Hooks;

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

afterEach(() => {
  jest.restoreAllMocks();
});

function baseRule(
  overrides: Partial<BaseNotificationRule>,
): BaseNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    ...overrides,
  } as BaseNotificationRule;
}

function workspaceRule(data: {
  id?: string | undefined;
  workspaceType?: WorkspaceType | undefined;
  eventType?: NotificationRuleEventType | undefined;
  notificationRule: BaseNotificationRule;
}): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = new ObjectID(data.id || ObjectID.generate().toString());
  rule.projectId = PROJECT_ID;
  rule.workspaceType = data.workspaceType || WorkspaceType.Slack;
  rule.eventType = data.eventType || NotificationRuleEventType.Incident;
  rule.name = "Rule";
  rule.notificationRule = data.notificationRule;
  return rule;
}

// A rule that posts to existing channels by name.
function namingRule(
  channelNames: string,
  updatesToPost?: Array<NotificationRuleUpdateKind>,
  workspaceType: WorkspaceType = WorkspaceType.Slack,
): WorkspaceNotificationRule {
  return workspaceRule({
    workspaceType: workspaceType,
    notificationRule: baseRule({
      shouldPostToExistingChannel: true,
      existingChannelNames: channelNames,
      ...(updatesToPost ? { updatesToPost: updatesToPost } : {}),
    }),
  });
}

// A Microsoft Teams rule that posts to chats.
function chatRule(
  chatIds: Array<string>,
  updatesToPost?: Array<NotificationRuleUpdateKind>,
): WorkspaceNotificationRule {
  return workspaceRule({
    workspaceType: WorkspaceType.MicrosoftTeams,
    notificationRule: baseRule({
      shouldPostToExistingChat: true,
      existingChatIds: chatIds,
      ...(updatesToPost ? { updatesToPost: updatesToPost } : {}),
    }),
  });
}

function namesOf(channels: Array<WorkspaceChannel>): Array<string> {
  return channels.map((channel: WorkspaceChannel): string => {
    return channel.name;
  });
}

describe("the existing channels a message is posted in", () => {
  // #executive-alerts wants key updates; #incidents wants every one.
  const EXECUTIVE: WorkspaceNotificationRule = namingRule(
    "executive-alerts",
    INCIDENT_KEY,
  );
  const RESPONDERS: WorkspaceNotificationRule = namingRule("incidents");

  async function channelsFor(
    updateKinds: Array<NotificationRuleUpdateKind> | undefined,
    rules: Array<WorkspaceNotificationRule> = [EXECUTIVE, RESPONDERS],
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): Promise<Array<string>> {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue(rules);

    return namesOf(
      await WorkspaceNotificationRuleService.getExistingChannelNamesBasedOnEventType(
        {
          projectId: PROJECT_ID,
          workspaceType: workspaceType,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: INCIDENT_ID },
          updateKinds: updateKinds,
        },
      ),
    );
  }

  test("REGRESSION: a private note reaches #incidents and not #executive-alerts", async () => {
    expect(await channelsFor([PrivateNotes])).toEqual(["incidents"]);
  });

  test("a resolve, a severity change, a public note and the postmortem reach both", async () => {
    for (const kind of INCIDENT_KEY) {
      expect(await channelsFor([kind])).toEqual([
        "executive-alerts",
        "incidents",
      ]);
    }
  });

  test("the first message, a video call and a message of no kind reach both", async () => {
    for (const updateKinds of [[Created], [VideoCallStarted], [], undefined]) {
      expect(await channelsFor(updateKinds)).toEqual([
        "executive-alerts",
        "incidents",
      ]);
    }
  });

  test("a channel two rules name gets the message once, when either wants it", async () => {
    const quietAlso: WorkspaceNotificationRule = namingRule(
      "incidents",
      INCIDENT_KEY,
    );

    expect(await channelsFor([PrivateNotes], [quietAlso, RESPONDERS])).toEqual([
      "incidents",
    ]);
    expect(await channelsFor([PrivateNotes], [quietAlso])).toEqual([]);
  });

  test("a rule saved before the Updates step posts every update", async () => {
    for (const kind of Object.values(NotificationRuleUpdateKind)) {
      expect(await channelsFor([kind], [RESPONDERS])).toEqual(["incidents"]);
    }
  });

  test("a rule that ticked nothing posts only the first message and a video call", async () => {
    const nothing: WorkspaceNotificationRule = namingRule("quiet", []);

    expect(await channelsFor([Created], [nothing])).toEqual(["quiet"]);
    expect(await channelsFor([VideoCallStarted], [nothing])).toEqual(["quiet"]);
    expect(await channelsFor([ResolvedAndReopened], [nothing])).toEqual([]);
  });

  test("Mattermost and Microsoft Teams channels are chosen the same way", async () => {
    for (const workspaceType of [
      WorkspaceType.Mattermost,
      WorkspaceType.MicrosoftTeams,
    ]) {
      const rules: Array<WorkspaceNotificationRule> = [
        namingRule("executive-alerts", INCIDENT_KEY, workspaceType),
        namingRule("incidents", undefined, workspaceType),
      ];

      expect(await channelsFor([PrivateNotes], rules, workspaceType)).toEqual([
        "incidents",
      ]);
      expect(await channelsFor([PublicNotes], rules, workspaceType)).toEqual([
        "executive-alerts",
        "incidents",
      ]);
    }
  });
});

describe("the Microsoft Teams chats a message is posted in", () => {
  async function chatsFor(
    updateKinds: Array<NotificationRuleUpdateKind> | undefined,
    rules: Array<WorkspaceNotificationRule>,
  ): Promise<Array<string>> {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue(rules);

    return WorkspaceNotificationRuleService.getExistingChatIdsBasedOnEventType({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRuleEventType: NotificationRuleEventType.Incident,
      notificationFor: { incidentId: INCIDENT_ID },
      updateKinds: updateKinds,
    });
  }

  test("a chat of a Key updates rule hears of the postmortem and not of a page", async () => {
    const rules: Array<WorkspaceNotificationRule> = [
      chatRule(["chat-leadership"], INCIDENT_KEY),
      chatRule(["chat-oncall"]),
    ];

    expect(await chatsFor([Paging], rules)).toEqual(["chat-oncall"]);
    expect(await chatsFor([Postmortem], rules)).toEqual([
      "chat-leadership",
      "chat-oncall",
    ]);
    expect(await chatsFor(undefined, rules)).toEqual([
      "chat-leadership",
      "chat-oncall",
    ]);
  });

  test("a chat two rules name gets a message either wants", async () => {
    expect(
      await chatsFor(
        [Paging],
        [chatRule(["chat-1"], INCIDENT_KEY), chatRule(["chat-1"], [Paging])],
      ),
    ).toEqual(["chat-1"]);
  });
});

describe("the channels OneUptime created for the record", () => {
  const KEY_RULE_ID: string = "75810000-0000-4000-8000-000000000011";
  const EVERY_RULE_ID: string = "75810000-0000-4000-8000-000000000012";
  const DELETED_RULE_ID: string = "75810000-0000-4000-8000-000000000013";

  const RULES: Array<WorkspaceNotificationRule> = [
    workspaceRule({
      id: KEY_RULE_ID,
      notificationRule: baseRule({
        shouldCreateNewChannel: true,
        updatesToPost: INCIDENT_KEY,
      } as Partial<BaseNotificationRule>),
    }),
    workspaceRule({
      id: EVERY_RULE_ID,
      notificationRule: baseRule({
        shouldCreateNewChannel: true,
      } as Partial<BaseNotificationRule>),
    }),
  ];

  function recordChannel(
    id: string,
    ruleIds: Array<string>,
  ): NotificationRuleWorkspaceChannel {
    return {
      id: id,
      name: id,
      workspaceType: WorkspaceType.Slack,
      notificationRuleId: ruleIds[0] as string,
      notificationRuleIds: ruleIds,
    };
  }

  interface Spies {
    rulesRead: SpyInstance<(...args: never) => never>;
    recordChannelsRead: SpyInstance<(...args: never) => never>;
  }

  function spies(data: {
    recordChannels: Array<NotificationRuleWorkspaceChannel>;
    rules?: Array<WorkspaceNotificationRule>;
  }): Spies {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([]);

    return {
      recordChannelsRead: jest
        .spyOn(
          WorkspaceNotificationRuleService as never,
          "getWorkspaceChannelsByNotificationFor",
        )
        .mockResolvedValue(data.recordChannels as never),
      rulesRead: jest
        .spyOn(
          WorkspaceNotificationRuleService as never,
          "getNotificationRules",
        )
        .mockResolvedValue((data.rules || RULES) as never),
    };
  }

  async function destinations(
    updateKinds: Array<NotificationRuleUpdateKind> | undefined,
    notificationFor: NotificationFor = { incidentId: INCIDENT_ID },
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): Promise<Array<string>> {
    const payloads: Array<WorkspaceMessagePayload> =
      await WorkspaceNotificationRuleService.getMessageDestinations({
        projectId: PROJECT_ID,
        notificationFor: notificationFor,
        workspaceType: workspaceType,
        updateKinds: updateKinds,
      });

    return payloads.flatMap((payload: WorkspaceMessagePayload) => {
      return payload.channelIds;
    });
  }

  test("a channel of a Key updates rule gets a public note and not a private one", async () => {
    spies({
      recordChannels: [
        recordChannel("C0QUIET", [KEY_RULE_ID]),
        recordChannel("C0LOUD", [EVERY_RULE_ID]),
      ],
    });

    expect(await destinations([PrivateNotes])).toEqual(["C0LOUD"]);
    expect(await destinations([PublicNotes])).toEqual(["C0QUIET", "C0LOUD"]);
  });

  test("a channel two rules share gets what either wants", async () => {
    spies({
      recordChannels: [recordChannel("C0SHARED", [KEY_RULE_ID, EVERY_RULE_ID])],
    });

    expect(await destinations([PrivateNotes])).toEqual(["C0SHARED"]);
  });

  test("a channel whose rules were all deleted, or stored before its rules were, gets everything", async () => {
    spies({
      recordChannels: [
        recordChannel("C0ORPHAN", [DELETED_RULE_ID]),
        {
          id: "C0OLD",
          name: "C0OLD",
          workspaceType: WorkspaceType.Slack,
        } as NotificationRuleWorkspaceChannel,
        recordChannel("C0QUIET", [KEY_RULE_ID]),
      ],
    });

    expect(await destinations([PrivateNotes])).toEqual(["C0ORPHAN", "C0OLD"]);
  });

  test("the project's rules are not read for a message every rule posts, or for channels that name no rule", async () => {
    const posted: Spies = spies({
      recordChannels: [recordChannel("C0QUIET", [KEY_RULE_ID])],
    });

    for (const updateKinds of [undefined, [], [Created], [VideoCallStarted]]) {
      expect(await destinations(updateKinds)).toEqual(["C0QUIET"]);
    }
    expect(posted.rulesRead).not.toHaveBeenCalled();

    jest.restoreAllMocks();

    const unnamed: Spies = spies({
      recordChannels: [
        {
          id: "C0OLD",
          name: "C0OLD",
          workspaceType: WorkspaceType.Slack,
        } as NotificationRuleWorkspaceChannel,
      ],
    });

    expect(await destinations([PrivateNotes])).toEqual(["C0OLD"]);
    expect(unnamed.rulesRead).not.toHaveBeenCalled();
  });

  test("the rules read are the record's kind's, in the message's workspace", async () => {
    for (const [notificationFor, eventType] of [
      [{ incidentId: INCIDENT_ID }, NotificationRuleEventType.Incident],
      [{ alertId: INCIDENT_ID }, NotificationRuleEventType.Alert],
      [
        { incidentEpisodeId: INCIDENT_ID },
        NotificationRuleEventType.IncidentEpisode,
      ],
      [{ alertEpisodeId: INCIDENT_ID }, NotificationRuleEventType.AlertEpisode],
      [
        { scheduledMaintenanceId: INCIDENT_ID },
        NotificationRuleEventType.ScheduledMaintenance,
      ],
    ] as Array<[NotificationFor, NotificationRuleEventType]>) {
      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
        WorkspaceType.Mattermost,
      ]) {
        const read: Spies = spies({
          recordChannels: [
            recordChannel("C0QUIET", [KEY_RULE_ID]),
            recordChannel("C0LOUD", [EVERY_RULE_ID]),
          ],
        });

        expect(
          await destinations([PrivateNotes], notificationFor, workspaceType),
        ).toEqual(["C0LOUD"]);
        expect(read.rulesRead).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          workspaceType: workspaceType,
          notificationRuleEventType: eventType,
        });

        jest.restoreAllMocks();
      }
    }
  });
});

describe("a record's message carries its updates to where it is posted", () => {
  test("sendWorkspaceMarkdownNotification asks for the destinations of the updates it is", async () => {
    jest.spyOn(WorkspaceUtil, "getMessageBlocksByMarkdown").mockResolvedValue([
      {
        workspaceType: WorkspaceType.Slack,
        messageBlocks: [{ _type: "WorkspacePayloadMarkdown", text: "Note" }],
      },
    ] as never);

    const destinationsAsked: SpyInstance<
      typeof WorkspaceNotificationRuleService.getMessageDestinations
    > = jest
      .spyOn(WorkspaceNotificationRuleService, "getMessageDestinations")
      .mockResolvedValue([]);

    jest
      .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
      .mockResolvedValue([]);
    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockResolvedValue(new WorkspaceNotificationLog());

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      feedInfoInMarkdown: "Note",
      workspaceNotification: {
        sendWorkspaceNotification: true,
        updateKinds: [PrivateNotes],
      },
    });

    expect(destinationsAsked).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      workspaceType: WorkspaceType.Slack,
      updateKinds: [PrivateNotes],
    });

    destinationsAsked.mockClear();

    // A message of no kind asks for every destination, as it always did.
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      feedInfoInMarkdown: "Note",
      workspaceNotification: { sendWorkspaceNotification: true },
    });

    expect(destinationsAsked).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      workspaceType: WorkspaceType.Slack,
      updateKinds: undefined,
    });
  });
});

describe("saving a rule's updates through the API", () => {
  let heldEventTypes: Array<NotificationRuleEventType>;
  let heldRowsRead: SpyInstance<
    typeof WorkspaceNotificationRuleService.findRowsAndHoldUpdateToThem
  >;

  beforeEach(() => {
    heldEventTypes = [NotificationRuleEventType.Incident];

    heldRowsRead = jest
      .spyOn(WorkspaceNotificationRuleService, "findRowsAndHoldUpdateToThem")
      .mockImplementation(
        async (): Promise<Array<WorkspaceNotificationRule>> => {
          return heldEventTypes.map(
            (
              eventType: NotificationRuleEventType,
            ): WorkspaceNotificationRule => {
              const rule: WorkspaceNotificationRule =
                new WorkspaceNotificationRule();
              rule.eventType = eventType;
              return rule;
            },
          );
        },
      );
  });

  function create(
    eventType: NotificationRuleEventType,
    notificationRule: unknown,
  ): Promise<OnCreate<WorkspaceNotificationRule>> {
    const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    rule.projectId = PROJECT_ID;
    rule.eventType = eventType;
    rule.notificationRule = notificationRule as never;

    return hooks.onBeforeCreate({
      data: rule,
      props: ROOT,
    } as CreateBy<WorkspaceNotificationRule>);
  }

  function update(
    data: Record<string, unknown>,
  ): Promise<OnUpdate<WorkspaceNotificationRule>> {
    return hooks.onBeforeUpdate({
      query: { _id: ObjectID.generate() },
      data: data,
      props: ROOT,
    } as unknown as UpdateBy<WorkspaceNotificationRule>);
  }

  test("a rule of the updates its kind can choose, or of none, is saved", async () => {
    for (const notificationRule of [
      undefined,
      baseRule({}),
      baseRule({ updatesToPost: INCIDENT_KEY }),
      baseRule({ updatesToPost: [] }),
      { ...baseRule({}), updatesToPost: null },
    ]) {
      await expect(
        create(NotificationRuleEventType.Incident, notificationRule),
      ).resolves.toBeTruthy();
    }

    await expect(
      create(
        NotificationRuleEventType.Alert,
        baseRule({ updatesToPost: [SeverityChanges] }),
      ),
    ).resolves.toBeTruthy();
  });

  test("a list on a monitor rule is refused: it posts every update", async () => {
    await expect(
      create(
        NotificationRuleEventType.Monitor,
        baseRule({ updatesToPost: [] }),
      ),
    ).rejects.toThrow(
      new BadDataException(
        "Monitor rules post every update: leave updatesToPost out.",
      ),
    );
  });

  test("an update its kind of rule cannot choose is refused, with what it can", async () => {
    await expect(
      create(
        NotificationRuleEventType.Alert,
        baseRule({ updatesToPost: [Postmortem] }),
      ),
    ).rejects.toThrow(
      'updatesToPost lists "Postmortem", which Alert rules cannot choose.',
    );

    await expect(
      create(NotificationRuleEventType.Incident, {
        ...baseRule({}),
        updatesToPost: "PublicNotes",
      }),
    ).rejects.toThrow("updatesToPost is a list of the updates the rule posts");
  });

  test("an update that sends the rule's kind is judged by it, without reading the rule", async () => {
    await expect(
      update({
        eventType: NotificationRuleEventType.Alert,
        notificationRule: baseRule({ updatesToPost: [Postmortem] }),
      }),
    ).rejects.toThrow(BadDataException);

    await expect(
      update({
        eventType: NotificationRuleEventType.Incident,
        notificationRule: baseRule({ updatesToPost: [Postmortem] }),
      }),
    ).resolves.toBeTruthy();

    expect(heldRowsRead).not.toHaveBeenCalled();
  });

  test("an update that does not send it is judged by each rule it writes", async () => {
    heldEventTypes = [NotificationRuleEventType.Incident];

    await expect(
      update({ notificationRule: baseRule({ updatesToPost: [Postmortem] }) }),
    ).resolves.toBeTruthy();

    heldEventTypes = [
      NotificationRuleEventType.Incident,
      NotificationRuleEventType.Alert,
    ];

    await expect(
      update({ notificationRule: baseRule({ updatesToPost: [Postmortem] }) }),
    ).rejects.toThrow("which Alert rules cannot choose");

    expect(heldRowsRead).toHaveBeenCalledTimes(2);
  });

  test("an update that writes no list reads nothing more", async () => {
    await expect(update({ name: "Renamed" })).resolves.toBeTruthy();
    await expect(
      update({ notificationRule: baseRule({}) }),
    ).resolves.toBeTruthy();

    expect(heldRowsRead).not.toHaveBeenCalled();
  });
});
