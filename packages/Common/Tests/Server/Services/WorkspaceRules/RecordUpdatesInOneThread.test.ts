import AlertEpisodeFeedService from "../../../../Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import IncidentEpisodeFeedService from "../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import ScheduledMaintenanceFeedService from "../../../../Server/Services/ScheduledMaintenanceFeedService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../../Server/Services/WorkspaceNotificationRuleService";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceRecordThreads from "../../../../Server/Utils/Workspace/WorkspaceRecordThreads";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import { AlertEpisodeFeedEventType } from "../../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import { IncidentEpisodeFeedEventType } from "../../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { ScheduledMaintenanceFeedEventType } from "../../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import BaseNotificationRule from "../../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageDestinationType,
} from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationActionType from "../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import InMemoryLiveMessages from "../../Utils/Workspace/LiveMessages/InMemoryLiveMessages";
import WorkspaceRuleWorld, {
  ALERT_ID,
  INCIDENT_EPISODE_ID,
  INCIDENT_ID,
  makeRule,
  OTHER_RULE_ID,
  PROJECT_ID,
  SlackRequest,
} from "./WorkspaceRuleWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * ONE THREAD PER INCIDENT IN A SHARED SLACK CHANNEL.
 *
 * A rule that posts to an existing Slack channel can keep everything it
 * posts about one incident in one thread there
 * (BaseNotificationRule.shouldPostUpdatesInThread): the created message is
 * a message of its own and starts the thread, every later message is a
 * reply to it, and a state change is a reply shown in the channel too. A
 * rule that does not ask - every rule saved before the switch existed -
 * posts as it always did: each message on its own.
 *
 * Driven through the real incident feed, rule matching, WorkspaceRecordThreads
 * and SlackUtil against a fake Slack API; only the database is in memory
 * (WorkspaceRuleWorld, and InMemoryLiveMessages for the threads kept).
 */

const OPS: string = "C0OPS";
const THREAD_KEY: string = WorkspaceLiveMessageKey.forRecordThread(
  "Incident",
  INCIDENT_ID,
);

const CREATED: string = "Incident INC-42 created: Checkout is down";
const NOTE: string = "Private note: the primary DB is out of disk";
const OWNER_ADDED: string = "Owner added: Somebody";
const ACKNOWLEDGED: string = "Changed INC-42 state to Acknowledged";

/*
 * The real feed, as each change to the incident is posted through it - the
 * world stands it in by a recorder, so it is taken before the world is in
 * place.
 */
const createIncidentFeedItem: typeof IncidentFeedService.createIncidentFeedItem =
  IncidentFeedService.createIncidentFeedItem.bind(IncidentFeedService);

const WAIT_FOR_THREAD_IN_MS: number =
  WorkspaceRecordThreads.WAIT_FOR_THREAD_IN_MS;
const WAIT_STEP_IN_MS: number = WorkspaceRecordThreads.WAIT_STEP_IN_MS;

let world: WorkspaceRuleWorld;
let store: InMemoryLiveMessages;
let waitSpy: SpyInstance<typeof WorkspaceRecordThreads.waitForThread>;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
  world.addSlackChannel({ id: OPS, name: "ops" });

  store = new InMemoryLiveMessages();
  store.install();

  jest.spyOn(IncidentFeedService, "create").mockImplementation((async (data: {
    data: unknown;
  }): Promise<unknown> => {
    return data.data;
  }) as never);

  /*
   * A message that waits for the thread does so without holding up whoever
   * posted it: the wait and the post after it are collected as they start,
   * so world.settle() waits for them. Short, so a test does not wait a
   * minute.
   */
  WorkspaceRecordThreads.WAIT_FOR_THREAD_IN_MS = 1_000;
  WorkspaceRecordThreads.WAIT_STEP_IN_MS = 5;

  const waitForThread: typeof WorkspaceRecordThreads.waitForThread =
    WorkspaceRecordThreads.waitForThread.bind(WorkspaceRecordThreads);
  waitSpy = jest
    .spyOn(WorkspaceRecordThreads, "waitForThread")
    .mockImplementation(
      (data: Parameters<typeof waitForThread>[0]): Promise<boolean> => {
        const waiting: Promise<boolean> = waitForThread(data);
        world.started.push(
          waiting.catch((): void => {
            return undefined;
          }),
        );
        return waiting;
      },
    );

  const post: typeof WorkspaceRecordThreads.post =
    WorkspaceRecordThreads.post.bind(WorkspaceRecordThreads);
  jest
    .spyOn(WorkspaceRecordThreads, "post")
    .mockImplementation(
      (
        data: Parameters<typeof post>[0],
      ): Promise<Array<WorkspaceSendMessageResponse>> => {
        const posting: Promise<Array<WorkspaceSendMessageResponse>> =
          post(data);
        world.started.push(
          posting.catch((): void => {
            return undefined;
          }),
        );
        return posting;
      },
    );
});

afterEach(() => {
  WorkspaceRecordThreads.WAIT_FOR_THREAD_IN_MS = WAIT_FOR_THREAD_IN_MS;
  WorkspaceRecordThreads.WAIT_STEP_IN_MS = WAIT_STEP_IN_MS;
  jest.restoreAllMocks();
});

// The rule that posts the incident's messages to #ops, in a thread or not.
function opsRule(postsUpdatesInThread?: boolean): void {
  world.rules = [
    makeRule({
      createsChannel: false,
      existingChannels: "#ops",
      ...(postsUpdatesInThread !== undefined
        ? { postsUpdatesInThread: postsUpdatesInThread }
        : {}),
    }),
  ];
}

// Something about INC-42 is posted, as its feed posts it.
async function feed(
  eventType: IncidentFeedEventType,
  markdown: string,
): Promise<void> {
  await createIncidentFeedItem({
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    incidentFeedEventType: eventType,
    feedInfoInMarkdown: markdown,
    workspaceNotification: {
      sendWorkspaceNotification: true,
    },
  });
}

// Every message posted to #ops, in order, with what Slack answered.
function opsPosts(): Array<SlackRequest> {
  return world.slackRequests.filter((request: SlackRequest): boolean => {
    return (
      request.method === "chat.postMessage" && request.body["channel"] === OPS
    );
  });
}

// The posts to #ops Slack took, in order.
function opsMessages(): Array<SlackRequest> {
  return opsPosts().filter((request: SlackRequest): boolean => {
    return request.answer?.["ok"] === true;
  });
}

function says(request: SlackRequest, text: string): boolean {
  return JSON.stringify(request.body["blocks"]).includes(text);
}

function tsOf(request: SlackRequest): string {
  return String(request.answer!["ts"]);
}

// The threads kept for INC-42: one row per channel.
function threads(): Array<WorkspaceLiveMessage> {
  return store.forKey(THREAD_KEY);
}

describe("a rule that does not ask for a thread (the default)", () => {
  test("every message is one of its own: no thread_ts, no reply_broadcast, nothing kept, nothing waits", async () => {
    opsRule();

    // A message before the created one is posted at once, as always.
    await feed(IncidentFeedEventType.OwnerUserAdded, OWNER_ADDED);
    expect(opsMessages()).toHaveLength(1);

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    await feed(IncidentFeedEventType.PrivateNote, NOTE);
    await feed(IncidentFeedEventType.IncidentStateChanged, ACKNOWLEDGED);
    await world.settle();

    expect(opsMessages()).toHaveLength(4);

    for (const message of opsMessages()) {
      expect(message.body).not.toHaveProperty("thread_ts");
      expect(message.body).not.toHaveProperty("reply_broadcast");
    }

    expect(store.rows).toEqual([]);
    expect(waitSpy).not.toHaveBeenCalled();
  });

  test("a rule that says no is the same as one that does not say", async () => {
    opsRule(false);

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    await feed(IncidentFeedEventType.IncidentStateChanged, ACKNOWLEDGED);

    expect(opsMessages()).toHaveLength(2);
    expect(opsMessages()[1]!.body).not.toHaveProperty("thread_ts");
    expect(store.rows).toEqual([]);
  });
});

describe("a rule that keeps each incident in one thread", () => {
  test("the created message starts the thread; it is kept by the channel's id and its ts", async () => {
    opsRule(true);

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);

    expect(opsMessages()).toHaveLength(1);
    const created: SlackRequest = opsMessages()[0]!;
    expect(says(created, "Checkout is down")).toBe(true);
    expect(created.body).not.toHaveProperty("thread_ts");
    expect(created.body).not.toHaveProperty("reply_broadcast");

    expect(threads()).toHaveLength(1);
    const thread: WorkspaceLiveMessage = threads()[0]!;
    // The id Slack resolved #ops to, not the name the rule wrote.
    expect(thread.channelId).toBe(OPS);
    expect(thread.messageId).toBe(tsOf(created));
    expect(thread.workspaceType).toBe(WorkspaceType.Slack);
    expect(thread.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Channel,
    );
    expect(thread.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("every later message is a reply in it; a state change is shown in the channel too, nothing else is", async () => {
    opsRule(true);

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    await feed(IncidentFeedEventType.PrivateNote, NOTE);
    await feed(IncidentFeedEventType.OwnerUserAdded, OWNER_ADDED);
    await feed(IncidentFeedEventType.IncidentStateChanged, ACKNOWLEDGED);

    const [created, note, owner, stateChange] = opsMessages() as [
      SlackRequest,
      SlackRequest,
      SlackRequest,
      SlackRequest,
    ];
    expect(opsMessages()).toHaveLength(4);
    const root: string = tsOf(created);

    expect(says(note, "out of disk")).toBe(true);
    expect(note.body["thread_ts"]).toBe(root);
    expect(note.body).not.toHaveProperty("reply_broadcast");

    expect(owner.body["thread_ts"]).toBe(root);
    expect(owner.body).not.toHaveProperty("reply_broadcast");

    expect(says(stateChange, "Acknowledged")).toBe(true);
    expect(stateChange.body["thread_ts"]).toBe(root);
    expect(stateChange.body["reply_broadcast"]).toBe(true);

    // Still the one thread, started by the created message.
    expect(threads()).toHaveLength(1);
    expect(threads()[0]!.messageId).toBe(root);

    // Once the thread has started, nothing waits for it.
    expect(waitSpy).not.toHaveBeenCalled();
  });

  test("every message, reply or not, is in the incident's Notification Logs with its own ts", async () => {
    opsRule(true);

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    await feed(IncidentFeedEventType.PrivateNote, NOTE);

    expect(
      world
        .logRowsOf(WorkspaceNotificationActionType.SendMessage)
        .map((row: WorkspaceNotificationLog): Array<string | undefined> => {
          return [row.threadId, row.incidentId?.toString()];
        }),
    ).toEqual(
      opsMessages().map((message: SlackRequest): Array<string> => {
        return [tsOf(message), INCIDENT_ID.toString()];
      }),
    );
  });
});

describe("a message that comes before the created one", () => {
  test("REGRESSION: waits for the thread, then is a reply in it - not a thread of its own", async () => {
    opsRule(true);

    /*
     * A monitor raises the incident and adds its owners at once: "owner
     * added" is posted while the created message is still on its way.
     */
    await feed(IncidentFeedEventType.OwnerUserAdded, OWNER_ADDED);

    // Not posted, and whoever posted it was not held up.
    expect(opsPosts()).toEqual([]);
    expect(waitSpy).toHaveBeenCalledTimes(1);

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    await world.settle();

    expect(opsMessages()).toHaveLength(2);
    const [created, owner] = opsMessages() as [SlackRequest, SlackRequest];

    expect(says(created, "Checkout is down")).toBe(true);
    expect(created.body).not.toHaveProperty("thread_ts");

    expect(says(owner, "Owner added")).toBe(true);
    expect(owner.body["thread_ts"]).toBe(tsOf(created));

    expect(threads()).toHaveLength(1);
    expect(threads()[0]!.messageId).toBe(tsOf(created));

    // Logged once it was sent.
    expect(
      world.logRowsOf(WorkspaceNotificationActionType.SendMessage),
    ).toHaveLength(2);
  });

  test("when no created message ever comes, it is posted on its own after the wait, and starts the thread", async () => {
    // An incident from before the rule asked for threads.
    opsRule(true);
    WorkspaceRecordThreads.WAIT_FOR_THREAD_IN_MS = 60;

    const startedAt: number = Date.now();
    await feed(IncidentFeedEventType.PrivateNote, NOTE);
    expect(opsPosts()).toEqual([]);

    await world.settle();

    // It waited for the whole of the wait first.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(60);

    expect(opsMessages()).toHaveLength(1);
    const note: SlackRequest = opsMessages()[0]!;
    expect(says(note, "out of disk")).toBe(true);
    expect(note.body).not.toHaveProperty("thread_ts");

    expect(threads()).toHaveLength(1);
    expect(threads()[0]!.messageId).toBe(tsOf(note));

    // What comes next is a reply to it.
    await feed(IncidentFeedEventType.IncidentStateChanged, ACKNOWLEDGED);
    expect(opsMessages()[1]!.body["thread_ts"]).toBe(tsOf(note));
    expect(opsMessages()[1]!.body["reply_broadcast"]).toBe(true);
  });

  test("a created message that comes after the wait ran out is a reply in that thread, shown in the channel too", async () => {
    opsRule(true);
    WorkspaceRecordThreads.WAIT_FOR_THREAD_IN_MS = 20;

    await feed(IncidentFeedEventType.OwnerUserAdded, OWNER_ADDED);
    await world.settle();
    const ownerAdded: SlackRequest = opsMessages()[0]!;
    expect(ownerAdded.body).not.toHaveProperty("thread_ts");

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);

    const created: SlackRequest = opsMessages()[1]!;
    expect(says(created, "Checkout is down")).toBe(true);
    expect(created.body["thread_ts"]).toBe(tsOf(ownerAdded));
    // Otherwise the incident's own message, with its buttons, is hidden in the thread.
    expect(created.body["reply_broadcast"]).toBe(true);
    expect(threads()).toHaveLength(1);
  });

  test("two messages at once with no thread yet start one thread between them, not two", async () => {
    opsRule(true);

    const note: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: NOTE,
    };
    const payload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.Slack,
      messageBlocks: [note],
      channelNames: ["#ops"],
      channelIds: [],
      isRecordThread: true,
    };

    await Promise.all([
      WorkspaceRecordThreads.post({
        projectId: PROJECT_ID,
        key: THREAD_KEY,
        payloads: [payload],
      }),
      WorkspaceRecordThreads.post({
        projectId: PROJECT_ID,
        key: THREAD_KEY,
        payloads: [payload],
      }),
    ]);

    expect(opsMessages()).toHaveLength(2);
    expect(opsMessages()[0]!.body).not.toHaveProperty("thread_ts");
    expect(opsMessages()[1]!.body["thread_ts"]).toBe(tsOf(opsMessages()[0]!));
    expect(threads()).toHaveLength(1);
  });
});

describe("a thread whose first message is gone", () => {
  test("a refused reply is posted on its own and becomes the thread's first message - the row is moved, not doubled", async () => {
    opsRule(true);

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    const firstRoot: string = tsOf(opsMessages()[0]!);

    // Somebody deleted the created message: Slack refuses replies to it.
    world.slackRefusesReplies = "thread_not_found";
    await feed(IncidentFeedEventType.PrivateNote, NOTE);

    const notePosts: Array<SlackRequest> = opsPosts().filter(
      (request: SlackRequest): boolean => {
        return says(request, "out of disk");
      },
    );
    // Tried as a reply first, then posted again on its own.
    expect(notePosts).toHaveLength(2);
    expect(notePosts[0]!.body["thread_ts"]).toBe(firstRoot);
    expect(notePosts[0]!.answer?.["ok"]).toBe(false);
    expect(notePosts[1]!.body).not.toHaveProperty("thread_ts");
    expect(notePosts[1]!.answer?.["ok"]).toBe(true);

    const newRoot: string = tsOf(notePosts[1]!);
    expect(threads()).toHaveLength(1);
    expect(threads()[0]!.messageId).toBe(newRoot);

    // The next message is a reply in the new thread.
    world.slackRefusesReplies = null;
    await feed(IncidentFeedEventType.IncidentStateChanged, ACKNOWLEDGED);
    expect(opsMessages()[opsMessages().length - 1]!.body["thread_ts"]).toBe(
      newRoot,
    );
  });
});

describe("a rule naming two channels", () => {
  test("each channel keeps its own thread: replies go under that channel's first message", async () => {
    const SRE: string = "C0SRE";
    world.addSlackChannel({ id: SRE, name: "sre" });
    world.rules = [
      makeRule({
        createsChannel: false,
        existingChannels: "#ops,#sre",
        postsUpdatesInThread: true,
      }),
    ];

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    await feed(IncidentFeedEventType.PrivateNote, NOTE);

    const postsTo: (channelId: string) => Array<SlackRequest> = (
      channelId: string,
    ): Array<SlackRequest> => {
      return world.slackRequests.filter((request: SlackRequest): boolean => {
        return (
          request.method === "chat.postMessage" &&
          request.body["channel"] === channelId
        );
      });
    };

    expect(threads()).toHaveLength(2);

    for (const channelId of [OPS, SRE]) {
      const [created, note] = postsTo(channelId);
      expect(created!.body).not.toHaveProperty("thread_ts");
      expect(note!.body["thread_ts"]).toBe(tsOf(created!));
      expect(
        threads().find((thread: WorkspaceLiveMessage): boolean => {
          return thread.channelId === channelId;
        })!.messageId,
      ).toBe(tsOf(created!));
    }

    // Two channels, two threads: not one thread's first message for both.
    expect(tsOf(postsTo(OPS)[0]!)).not.toBe(tsOf(postsTo(SRE)[0]!));
  });
});

describe("two rules naming the same channel", () => {
  test("the channel is posted to once, in a thread, when either of them asks", async () => {
    world.rules = [
      makeRule({ createsChannel: false, existingChannels: "#ops" }),
      makeRule({
        id: OTHER_RULE_ID,
        createsChannel: false,
        existingChannels: "#ops",
        postsUpdatesInThread: true,
      }),
    ];

    await feed(IncidentFeedEventType.IncidentCreated, CREATED);
    await feed(IncidentFeedEventType.PrivateNote, NOTE);

    expect(opsMessages()).toHaveLength(2);
    expect(opsMessages()[0]!.body).not.toHaveProperty("thread_ts");
    expect(opsMessages()[1]!.body["thread_ts"]).toBe(tsOf(opsMessages()[0]!));
    expect(threads()).toHaveLength(1);
  });

  test("getExistingChannelNamesFromNotificationRules: in a thread when any rule naming it asks, in either order", () => {
    const rule: (
      existingChannelNames: string,
      postsUpdatesInThread?: boolean,
    ) => BaseNotificationRule = (
      existingChannelNames: string,
      postsUpdatesInThread?: boolean,
    ): BaseNotificationRule => {
      return {
        ...(makeRule({
          createsChannel: false,
          existingChannels: existingChannelNames,
          ...(postsUpdatesInThread !== undefined
            ? { postsUpdatesInThread: postsUpdatesInThread }
            : {}),
        }).notificationRule as unknown as BaseNotificationRule),
      };
    };

    const channels: (
      rules: Array<BaseNotificationRule>,
    ) => Array<{ name: string; inThread: boolean }> = (
      rules: Array<BaseNotificationRule>,
    ): Array<{ name: string; inThread: boolean }> => {
      return WorkspaceNotificationRuleService.getExistingChannelNamesFromNotificationRules(
        { notificationRules: rules, workspaceType: WorkspaceType.Slack },
      ).map((channel: WorkspaceChannel) => {
        return {
          name: channel.name,
          inThread: Boolean(channel.postsUpdatesInThread),
        };
      });
    };

    expect(channels([rule("ops"), rule("ops", true)])).toEqual([
      { name: "ops", inThread: true },
    ]);
    expect(channels([rule("ops", true), rule("ops", false)])).toEqual([
      { name: "ops", inThread: true },
    ]);
    expect(channels([rule("ops"), rule("ops", false)])).toEqual([
      { name: "ops", inThread: false },
    ]);
    // Only the channels of the rule that asks.
    expect(channels([rule("ops,sre", true), rule("noc")])).toEqual([
      { name: "ops", inThread: true },
      { name: "sre", inThread: true },
      { name: "noc", inThread: false },
    ]);
  });
});

describe("where there is no thread to keep", () => {
  // What getMessageDestinations makes of a rule's channel that asks for a thread.
  async function destinationFor(data: {
    notificationFor: NotificationFor;
    workspaceType: WorkspaceType;
  }): Promise<WorkspaceMessagePayload> {
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getExistingChannelNamesBasedOnEventType",
      )
      .mockResolvedValue([
        {
          id: "ops",
          name: "ops",
          workspaceType: data.workspaceType,
          postsUpdatesInThread: true,
        },
      ]);
    // The record has no channel of its own here: only the rule's.
    jest
      .spyOn(
        WorkspaceNotificationRuleService as never,
        "getWorkspaceChannelsByNotificationFor",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getExistingChatIdsBasedOnEventType",
      )
      .mockResolvedValue([]);

    const destinations: Array<WorkspaceMessagePayload> =
      await WorkspaceNotificationRuleService.getMessageDestinations({
        projectId: PROJECT_ID,
        notificationFor: data.notificationFor,
        workspaceType: data.workspaceType,
      });

    expect(destinations).toHaveLength(1);
    return destinations[0]!;
  }

  test("Slack: an incident, an alert, a scheduled maintenance and both kinds of episode each keep a thread", async () => {
    for (const notificationFor of [
      { incidentId: INCIDENT_ID },
      { alertId: ALERT_ID },
      { scheduledMaintenanceId: ObjectID.generate() },
      { incidentEpisodeId: INCIDENT_EPISODE_ID },
      { alertEpisodeId: ObjectID.generate() },
    ]) {
      expect(
        (
          await destinationFor({
            notificationFor: notificationFor,
            workspaceType: WorkspaceType.Slack,
          })
        ).isRecordThread,
      ).toBe(true);
    }
  });

  test("a monitor and an on-call policy have no thread: posted as before", async () => {
    for (const notificationFor of [
      { monitorId: ObjectID.generate() },
      { onCallDutyPolicyId: ObjectID.generate() },
    ]) {
      expect(
        await destinationFor({
          notificationFor: notificationFor,
          workspaceType: WorkspaceType.Slack,
        }),
      ).not.toHaveProperty("isRecordThread");
    }

    expect(
      WorkspaceRecordThreads.getKey({ monitorId: ObjectID.generate() }),
    ).toBeNull();
  });

  test("Microsoft Teams ignores the switch", async () => {
    expect(
      await destinationFor({
        notificationFor: { incidentId: INCIDENT_ID },
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).not.toHaveProperty("isRecordThread");
  });

  test("Microsoft Teams, end to end: posted at once, as before, and no thread is kept", async () => {
    world.connected = [WorkspaceType.MicrosoftTeams];
    world.rules = [
      makeRule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        createsChannel: false,
        existingChannels: "ops",
        postsUpdatesInThread: true,
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
          threads: [
            {
              channel: {
                id: "19:ops@thread.tacv2",
                name: "ops",
                workspaceType: WorkspaceType.MicrosoftTeams,
              },
              threadId: "1",
            },
          ],
          errors: [],
        };
      }) as never);

    // Before the created message: not held back.
    await feed(IncidentFeedEventType.PrivateNote, NOTE);
    await feed(IncidentFeedEventType.IncidentStateChanged, ACKNOWLEDGED);

    expect(sent).toHaveLength(2);
    for (const payload of sent) {
      expect(payload.channelNames).toEqual(["ops"]);
      expect(payload).not.toHaveProperty("isRecordThread");
      expect(payload).not.toHaveProperty("threadTsByChannelId");
      expect(payload).not.toHaveProperty("alsoSendToChannel");
    }
    expect(waitSpy).not.toHaveBeenCalled();
    expect(store.rows).toEqual([]);
  });
});

describe("the record's feed says which message starts the thread and which shows in the channel", () => {
  type FeedCase = {
    name: string;
    created: string;
    stateChanged: string;
    note: string;
    post: (eventType: string) => Promise<void>;
  };

  const RECORD_ID: ObjectID = ObjectID.generate();

  const cases: Array<FeedCase> = [
    {
      name: "incident",
      created: IncidentFeedEventType.IncidentCreated,
      stateChanged: IncidentFeedEventType.IncidentStateChanged,
      note: IncidentFeedEventType.PrivateNote,
      post: async (eventType: string): Promise<void> => {
        await createIncidentFeedItem({
          projectId: PROJECT_ID,
          incidentId: RECORD_ID,
          incidentFeedEventType: eventType as IncidentFeedEventType,
          feedInfoInMarkdown: "x",
          workspaceNotification: { sendWorkspaceNotification: true },
        });
      },
    },
    {
      name: "alert",
      created: AlertFeedEventType.AlertCreated,
      stateChanged: AlertFeedEventType.AlertStateChanged,
      note: AlertFeedEventType.PrivateNote,
      post: async (eventType: string): Promise<void> => {
        jest
          .spyOn(AlertFeedService, "create")
          .mockResolvedValue(undefined as never);
        await AlertFeedService.createAlertFeedItem({
          projectId: PROJECT_ID,
          alertId: RECORD_ID,
          alertFeedEventType: eventType as AlertFeedEventType,
          feedInfoInMarkdown: "x",
          workspaceNotification: { sendWorkspaceNotification: true },
        });
      },
    },
    {
      name: "scheduled maintenance",
      created: ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
      stateChanged:
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
      note: ScheduledMaintenanceFeedEventType.PrivateNote,
      post: async (eventType: string): Promise<void> => {
        jest
          .spyOn(ScheduledMaintenanceFeedService, "create")
          .mockResolvedValue(undefined as never);
        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            projectId: PROJECT_ID,
            scheduledMaintenanceId: RECORD_ID,
            scheduledMaintenanceFeedEventType:
              eventType as ScheduledMaintenanceFeedEventType,
            feedInfoInMarkdown: "x",
            workspaceNotification: { sendWorkspaceNotification: true },
          },
        );
      },
    },
    {
      name: "incident episode",
      created: IncidentEpisodeFeedEventType.EpisodeCreated,
      stateChanged: IncidentEpisodeFeedEventType.EpisodeStateChanged,
      note: IncidentEpisodeFeedEventType.PrivateNote,
      post: async (eventType: string): Promise<void> => {
        jest
          .spyOn(IncidentEpisodeFeedService, "create")
          .mockResolvedValue(undefined as never);
        await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
          projectId: PROJECT_ID,
          incidentEpisodeId: RECORD_ID,
          incidentEpisodeFeedEventType:
            eventType as IncidentEpisodeFeedEventType,
          feedInfoInMarkdown: "x",
          workspaceNotification: { sendWorkspaceNotification: true },
        });
      },
    },
    {
      name: "alert episode",
      created: AlertEpisodeFeedEventType.EpisodeCreated,
      stateChanged: AlertEpisodeFeedEventType.EpisodeStateChanged,
      note: AlertEpisodeFeedEventType.PrivateNote,
      post: async (eventType: string): Promise<void> => {
        jest
          .spyOn(AlertEpisodeFeedService, "create")
          .mockResolvedValue(undefined as never);
        await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
          projectId: PROJECT_ID,
          alertEpisodeId: RECORD_ID,
          alertEpisodeFeedEventType: eventType as AlertEpisodeFeedEventType,
          feedInfoInMarkdown: "x",
          workspaceNotification: { sendWorkspaceNotification: true },
        });
      },
    },
  ];

  for (const feedCase of cases) {
    test(`${feedCase.name}: created starts it, a state change shows in the channel, a note does neither`, async () => {
      const sends: Array<JSONObject> = [];
      jest
        .spyOn(
          WorkspaceNotificationRuleService,
          "sendWorkspaceMarkdownNotification",
        )
        .mockImplementation((async (data: {
          workspaceNotification: JSONObject;
        }): Promise<void> => {
          sends.push(data.workspaceNotification);
        }) as never);

      await feedCase.post(feedCase.created);
      await feedCase.post(feedCase.stateChanged);
      await feedCase.post(feedCase.note);

      expect(
        sends.map((sent: JSONObject) => {
          return [sent["startsRecordThread"], sent["alsoSendToChannel"]];
        }),
      ).toEqual([
        [true, false],
        [false, true],
        [false, false],
      ]);
    });
  }
});
