import { AlertEpisodeFeedEventType } from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentEpisodeFeedEventType } from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import {
  ALERT_EPISODE_FEED_UPDATE_KINDS,
  ALERT_FEED_UPDATE_KINDS,
  INCIDENT_EPISODE_FEED_UPDATE_KINDS,
  INCIDENT_FEED_UPDATE_KINDS,
  ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS,
  SCHEDULED_MAINTENANCE_FEED_UPDATE_KINDS,
} from "../../../Server/Utils/Feed/FeedUpdateKinds";
import ObjectID from "../../../Types/ObjectID";
import { NotificationRuleUpdateKind } from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * EACH FEED ENTRY TELLS SLACK, TEAMS AND MATTERMOST WHICH UPDATE IT IS (#7581).
 *
 * A rule on Key updates only posts an incident's public note and not its
 * private one because the message for each feed entry says which update it
 * is. Driven through each feed service's create...FeedItem, as every writer
 * calls it, up to the message it hands sendWorkspaceMarkdownNotification:
 *
 *   - an entry is the update its type is (FeedUpdateKinds' table), for every
 *     type of every record whose rules choose their updates;
 *   - a writer that knows more names it, and that wins: a state change that
 *     resolves the incident, an edit that changes its severity;
 *   - an on-call policy's entries are its own updates (#7549): a handoff,
 *     nobody on call, an override, a change to the policy, an owner - and
 *     the channels hear the entry's short line where its writer gave one;
 *   - a monitor's entries say nothing: its rules post every update, as
 *     before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "75810000-0000-4000-8000-0000000000a1",
);
const RECORD_ID: ObjectID = new ObjectID(
  "75810000-0000-4000-8000-0000000000a2",
);

const {
  ResolvedAndReopened,
  SeverityChanges,
  Edits,
  PublicNotes,
  PrivateNotes,
  Owners,
  Created,
  EpisodeMembers,
  StateChanges,
  Other,
} = NotificationRuleUpdateKind;

type Send = Parameters<
  typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
>[0];

interface FeedKind {
  label: string;
  service: unknown;
  method: string;
  recordIdKey: string;
  eventTypeKey: string;
  table: Readonly<Record<string, NotificationRuleUpdateKind>>;
}

const CHOOSING_FEEDS: Array<FeedKind> = [
  {
    label: "incidents",
    service: IncidentFeedService,
    method: "createIncidentFeedItem",
    recordIdKey: "incidentId",
    eventTypeKey: "incidentFeedEventType",
    table: INCIDENT_FEED_UPDATE_KINDS,
  },
  {
    label: "alerts",
    service: AlertFeedService,
    method: "createAlertFeedItem",
    recordIdKey: "alertId",
    eventTypeKey: "alertFeedEventType",
    table: ALERT_FEED_UPDATE_KINDS,
  },
  {
    label: "incident episodes",
    service: IncidentEpisodeFeedService,
    method: "createIncidentEpisodeFeedItem",
    recordIdKey: "incidentEpisodeId",
    eventTypeKey: "incidentEpisodeFeedEventType",
    table: INCIDENT_EPISODE_FEED_UPDATE_KINDS,
  },
  {
    label: "alert episodes",
    service: AlertEpisodeFeedService,
    method: "createAlertEpisodeFeedItem",
    recordIdKey: "alertEpisodeId",
    eventTypeKey: "alertEpisodeFeedEventType",
    table: ALERT_EPISODE_FEED_UPDATE_KINDS,
  },
  {
    label: "scheduled maintenance",
    service: ScheduledMaintenanceFeedService,
    method: "createScheduledMaintenanceFeedItem",
    recordIdKey: "scheduledMaintenanceId",
    eventTypeKey: "scheduledMaintenanceFeedEventType",
    table: SCHEDULED_MAINTENANCE_FEED_UPDATE_KINDS,
  },
  {
    label: "on-call policies",
    service: OnCallDutyPolicyFeedService,
    method: "createOnCallDutyPolicyFeedItem",
    recordIdKey: "onCallDutyPolicyId",
    eventTypeKey: "onCallDutyPolicyFeedEventType",
    table: ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS,
  },
];

let sends: Array<Send> = [];

function mockFeed(service: unknown): void {
  // The entry's own row is written as root; nothing is stored here.
  jest
    .spyOn(service as { create: () => Promise<unknown> }, "create")
    .mockResolvedValue({} as never);
}

beforeEach(() => {
  sends = [];

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "sendWorkspaceMarkdownNotification",
    )
    .mockImplementation((async (data: Send) => {
      sends.push(data);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// An entry of the kind's feed, posted, and the updates its message is.
async function postedAs(
  kind: FeedKind,
  eventType: string,
  named?: Array<NotificationRuleUpdateKind> | undefined,
): Promise<ReadonlyArray<NotificationRuleUpdateKind> | undefined> {
  mockFeed(kind.service);
  sends = [];

  await (
    kind.service as Record<
      string,
      (data: Record<string, unknown>) => Promise<void>
    >
  )[kind.method]!({
    [kind.recordIdKey]: RECORD_ID,
    projectId: PROJECT_ID,
    [kind.eventTypeKey]: eventType,
    feedInfoInMarkdown: "An update",
    workspaceNotification: {
      sendWorkspaceNotification: true,
      ...(named ? { updateKinds: named } : {}),
    },
  });

  expect(sends).toHaveLength(1);

  return sends[0]!.workspaceNotification.updateKinds;
}

describe.each(CHOOSING_FEEDS)("the feed of $label", (kind: FeedKind) => {
  test("every type of entry is posted as the update its table says", async () => {
    const posted: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};

    for (const [eventType, updateKind] of Object.entries(kind.table)) {
      posted[eventType] = await postedAs(kind, eventType);
      expected[eventType] = [updateKind];
    }

    expect(posted).toEqual(expected);
  });

  test("an update its writer names wins over its type's", async () => {
    const [anyType] = Object.keys(kind.table);

    expect(await postedAs(kind, anyType!, [ResolvedAndReopened])).toEqual([
      ResolvedAndReopened,
    ]);
  });

  test("an empty list named is the type's", async () => {
    const [anyType] = Object.keys(kind.table);

    expect(await postedAs(kind, anyType!, [])).toEqual([kind.table[anyType!]]);
  });

  test("an entry not posted names nothing anywhere", async () => {
    mockFeed(kind.service);

    await (
      kind.service as Record<
        string,
        (data: Record<string, unknown>) => Promise<void>
      >
    )[kind.method]!({
      [kind.recordIdKey]: RECORD_ID,
      projectId: PROJECT_ID,
      [kind.eventTypeKey]: Object.keys(kind.table)[0],
      feedInfoInMarkdown: "An update",
      workspaceNotification: { sendWorkspaceNotification: false },
    });

    expect(sends).toHaveLength(0);
  });
});

describe("the updates the customer's channels are told of", () => {
  const INCIDENTS: FeedKind = CHOOSING_FEEDS[0]!;
  const ALERTS: FeedKind = CHOOSING_FEEDS[1]!;
  const INCIDENT_EPISODES: FeedKind = CHOOSING_FEEDS[2]!;
  const ALERT_EPISODES: FeedKind = CHOOSING_FEEDS[3]!;
  const MAINTENANCE: FeedKind = CHOOSING_FEEDS[4]!;

  test("an incident's declaration, its notes and its owners", async () => {
    expect(
      await postedAs(INCIDENTS, IncidentFeedEventType.IncidentCreated),
    ).toEqual([Created]);
    expect(await postedAs(INCIDENTS, IncidentFeedEventType.PublicNote)).toEqual(
      [PublicNotes],
    );
    expect(
      await postedAs(INCIDENTS, IncidentFeedEventType.PrivateNote),
    ).toEqual([PrivateNotes]);
    expect(
      await postedAs(INCIDENTS, IncidentFeedEventType.OwnerUserAdded),
    ).toEqual([Owners]);
  });

  test("an incident resolved, and edited with a new severity, as their writers name them", async () => {
    expect(
      await postedAs(INCIDENTS, IncidentFeedEventType.IncidentStateChanged, [
        ResolvedAndReopened,
      ]),
    ).toEqual([ResolvedAndReopened]);
    expect(
      await postedAs(INCIDENTS, IncidentFeedEventType.IncidentUpdated, [
        SeverityChanges,
        Edits,
      ]),
    ).toEqual([SeverityChanges, Edits]);
  });

  test("an alert's creation and its private note; an alert has no public notes", async () => {
    expect(await postedAs(ALERTS, AlertFeedEventType.AlertCreated)).toEqual([
      Created,
    ]);
    expect(await postedAs(ALERTS, AlertFeedEventType.PrivateNote)).toEqual([
      PrivateNotes,
    ]);
    expect(await postedAs(ALERTS, AlertFeedEventType.PublicNote)).toEqual([
      Other,
    ]);
  });

  test("an episode's creation and the records it gains", async () => {
    expect(
      await postedAs(
        INCIDENT_EPISODES,
        IncidentEpisodeFeedEventType.EpisodeCreated,
      ),
    ).toEqual([Created]);
    expect(
      await postedAs(
        INCIDENT_EPISODES,
        IncidentEpisodeFeedEventType.IncidentAdded,
      ),
    ).toEqual([EpisodeMembers]);
    expect(
      await postedAs(ALERT_EPISODES, AlertEpisodeFeedEventType.AlertAdded),
    ).toEqual([EpisodeMembers]);
  });

  test("a maintenance event's state changes and its public notes", async () => {
    expect(
      await postedAs(
        MAINTENANCE,
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
      ),
    ).toEqual([StateChanges]);
    expect(
      await postedAs(MAINTENANCE, ScheduledMaintenanceFeedEventType.PublicNote),
    ).toEqual([PublicNotes]);
  });
});

describe("an on-call policy's entry in its channels (#7549)", () => {
  async function postEntry(data: {
    chatInfoInMarkdown?: string | undefined;
  }): Promise<Send> {
    mockFeed(OnCallDutyPolicyFeedService);
    sends = [];

    await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
      onCallDutyPolicyId: RECORD_ID,
      projectId: PROJECT_ID,
      onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType.UserAdded,
      feedInfoInMarkdown:
        "👨🏻‍💻 Added **Ana** to the [On-Call Policy Payments](x) escalation rule **First line** with order **1**.",
      ...(data.chatInfoInMarkdown
        ? { chatInfoInMarkdown: data.chatInfoInMarkdown }
        : {}),
      workspaceNotification: { sendWorkspaceNotification: true },
    });

    expect(sends).toHaveLength(1);

    return sends[0]!;
  }

  test("the channels hear the short line its writer gave, not the escalation rule and its order", async () => {
    const send: Send = await postEntry({
      chatInfoInMarkdown: "👨🏻‍💻 Added **Ana** to on-call policy [Payments](x).",
    });

    expect(send.feedInfoInMarkdown).toBe(
      "👨🏻‍💻 Added **Ana** to on-call policy [Payments](x).",
    );
    expect(send.workspaceNotification.updateKinds).toEqual([
      NotificationRuleUpdateKind.PolicyChanges,
    ]);
  });

  test("without one, the entry as the feed has it", async () => {
    const send: Send = await postEntry({});

    expect(send.feedInfoInMarkdown).toContain("escalation rule **First line**");
  });
});

describe("the feeds whose rules post every update", () => {
  test.each([
    {
      label: "a monitor's",
      service: MonitorFeedService as unknown,
      method: "createMonitorFeedItem",
      recordIdKey: "monitorId",
      eventTypeKey: "monitorFeedEventType",
    },
  ])(
    "$label entry says nothing of which update it is",
    async (kind: {
      service: unknown;
      method: string;
      recordIdKey: string;
      eventTypeKey: string;
    }) => {
      mockFeed(kind.service);

      await (
        kind.service as Record<
          string,
          (data: Record<string, unknown>) => Promise<void>
        >
      )[kind.method]!({
        [kind.recordIdKey]: RECORD_ID,
        projectId: PROJECT_ID,
        [kind.eventTypeKey]: "OwnerUserAdded",
        feedInfoInMarkdown: "An update",
        workspaceNotification: { sendWorkspaceNotification: true },
      });

      expect(sends).toHaveLength(1);
      expect(Object.keys(sends[0]!.workspaceNotification)).not.toContain(
        "updateKinds",
      );
    },
  );
});
