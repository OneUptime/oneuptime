import AlertEpisodeOwnerUser from "../../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeOwnerUser from "../../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO AN OWNER CHANGE IS BY, FOR EVERY KIND OF RECORD THAT HAS OWNERS AND
 * POSTS TO SLACK AND TEAMS.
 *
 * Adding or removing a person as an owner of an incident, an alert, an
 * incident or alert episode, a monitor or an on-call policy, and taking a
 * person off an on-call escalation rule, wrote its feed entry for whoever
 * made the change - and opened its Slack and Teams message with the person
 * added or removed, as the incident role entries did: "Deane Looi Added
 * Deane Looi to the Incident INC-18 as the owner." Each now asks for its
 * message to open with the entry's author (leadWithAuthor), and the feed
 * services put that author - the entry's own userId - in front of it. The
 * first half is held here for every owner service; the second for every
 * feed service, from the entry to the person the message opens with.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000002",
);
const VALERIA_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000003",
);
const DEANE_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000004");
const ROW_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000005");
const API_KEY_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000006",
);

const PEOPLE: Record<string, { name: string; email: string }> = {
  [VALERIA_ID.toString()]: {
    name: "Valeria Mustafaeva",
    email: "valeria@example.com",
  },
  [DEANE_ID.toString()]: { name: "Deane Looi", email: "deane@example.com" },
};

const userRow: (id: unknown) => User | null = (id: unknown): User | null => {
  const person: { name: string; email: string } | undefined =
    PEOPLE[String(id)];

  if (!person) {
    return null;
  }

  const user: User = new User();
  user._id = String(id);
  user.name = new Name(person.name);
  user.email = new Email(person.email);
  return user;
};

const memberProps: (userId: ObjectID) => DatabaseCommonInteractionProps = (
  userId: ObjectID,
): DatabaseCommonInteractionProps => {
  return { tenantId: PROJECT_ID, userId: userId };
};

type Hooked = {
  onCreateSuccess: (
    onCreate: OnCreate<BaseModel>,
    created: BaseModel,
  ) => Promise<BaseModel>;
  onDeleteSuccess: (
    onDelete: OnDelete<BaseModel>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<BaseModel>>;
};

interface OwnerKind {
  label: string;
  service: unknown;
  model: { new (): BaseModel };
  recordIdColumn: string;
  feedService: unknown;
  feedMethod: string;
  // The record's own service, whose names, numbers and links the entry reads.
  recordService: unknown;
  recordMethods: Array<string>;
}

const OWNER_KINDS: Array<OwnerKind> = [
  {
    label: "an incident's owner",
    service: IncidentOwnerUserService,
    model: IncidentOwnerUser,
    recordIdColumn: "incidentId",
    feedService: IncidentFeedService,
    feedMethod: "createIncidentFeedItem",
    recordService: IncidentService,
    recordMethods: [
      "getIncidentNumber",
      "getIncidentLinkInDashboard",
      "getWorkspaceChannelForIncident",
    ],
  },
  {
    label: "an alert's owner",
    service: AlertOwnerUserService,
    model: AlertOwnerUser,
    recordIdColumn: "alertId",
    feedService: AlertFeedService,
    feedMethod: "createAlertFeedItem",
    recordService: AlertService,
    recordMethods: [
      "getAlertNumber",
      "getAlertLinkInDashboard",
      "getWorkspaceChannelForAlert",
    ],
  },
  {
    label: "an incident episode's owner",
    service: IncidentEpisodeOwnerUserService,
    model: IncidentEpisodeOwnerUser,
    recordIdColumn: "incidentEpisodeId",
    feedService: IncidentEpisodeFeedService,
    feedMethod: "createIncidentEpisodeFeedItem",
    recordService: IncidentEpisodeService,
    recordMethods: [
      "getEpisodeNumber",
      "getEpisodeLinkInDashboard",
      "findOneById",
    ],
  },
  {
    label: "an alert episode's owner",
    service: AlertEpisodeOwnerUserService,
    model: AlertEpisodeOwnerUser,
    recordIdColumn: "alertEpisodeId",
    feedService: AlertEpisodeFeedService,
    feedMethod: "createAlertEpisodeFeedItem",
    recordService: AlertEpisodeService,
    recordMethods: [
      "getEpisodeNumber",
      "getEpisodeLinkInDashboard",
      "findOneById",
    ],
  },
  {
    label: "a monitor's owner",
    service: MonitorOwnerUserService,
    model: MonitorOwnerUser,
    recordIdColumn: "monitorId",
    feedService: MonitorFeedService,
    feedMethod: "createMonitorFeedItem",
    recordService: MonitorService,
    recordMethods: [
      "getMonitorName",
      "getMonitorLinkInDashboard",
      "getWorkspaceChannelForMonitor",
    ],
  },
  {
    label: "an on-call policy's owner",
    service: OnCallDutyPolicyOwnerUserService,
    model: OnCallDutyPolicyOwnerUser,
    recordIdColumn: "onCallDutyPolicyId",
    feedService: OnCallDutyPolicyFeedService,
    feedMethod: "createOnCallDutyPolicyFeedItem",
    recordService: OnCallDutyPolicyService,
    recordMethods: [
      "getOnCallDutyPolicyName",
      "getOnCallDutyPolicyLinkInDashboard",
      "getWorkspaceChannelForOnCallDutyPolicy",
    ],
  },
];

// What a record's service is asked, answered by the shape each question has.
const answerFor: (method: string) => unknown = (method: string): unknown => {
  if (method.endsWith("Number")) {
    return { number: 18, numberWithPrefix: "X-18" };
  }

  if (method.endsWith("LinkInDashboard")) {
    return URL.fromString(`${DASHBOARD}/${PROJECT_ID.toString()}/records/1`);
  }

  if (method.startsWith("getWorkspaceChannelFor")) {
    return [];
  }

  if (method === "findOneById") {
    return null;
  }

  return "Checkout";
};

let feedCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  feedCalls = [];

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));
  jest.spyOn(UserService, "findOneBy").mockImplementation((async (findBy: {
    query: { _id?: unknown };
  }) => {
    return userRow(findBy.query._id);
  }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (findBy: {
    id: unknown;
  }) => {
    return userRow(findBy.id);
  }) as never);

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteOwnersIsTrue",
    )
    .mockResolvedValue([]);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockResolvedValue(undefined as never);
});

// The owner service's writes: the feed entry it asks for, and its reads.
const spyOwnerWrites: (kind: OwnerKind) => void = (kind: OwnerKind): void => {
  jest
    .spyOn(
      kind.feedService as Record<string, () => Promise<void>>,
      kind.feedMethod,
    )
    .mockImplementation((async (data: Record<string, unknown>) => {
      feedCalls.push(data);
    }) as never);

  for (const method of kind.recordMethods) {
    jest
      .spyOn(kind.recordService as Record<string, () => unknown>, method)
      .mockResolvedValue(answerFor(method) as never);
  }
};

afterEach(() => {
  jest.restoreAllMocks();
});

const ownerRow: (kind: OwnerKind) => BaseModel = (
  kind: OwnerKind,
): BaseModel => {
  const row: BaseModel = new kind.model();
  row._id = ROW_ID.toString();
  row.setColumnValue("projectId", PROJECT_ID);
  row.setColumnValue("userId", DEANE_ID);
  row.setColumnValue(kind.recordIdColumn, RECORD_ID);
  return row;
};

const onlyFeedCall: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  expect(feedCalls).toHaveLength(1);
  return feedCalls[0]!;
};

describe.each(OWNER_KINDS)("$label", (kind: OwnerKind) => {
  const hooks: Hooked = kind.service as unknown as Hooked;

  beforeEach(() => {
    spyOwnerWrites(kind);
  });

  test("added by someone: the entry is theirs, and its message opens with them - not with Deane", async () => {
    const row: BaseModel = ownerRow(kind);
    row.setColumnValue("createdByUserId", VALERIA_ID);

    await hooks.onCreateSuccess(
      {
        createBy: { data: row, props: memberProps(VALERIA_ID) },
        carryForward: null,
      } as OnCreate<BaseModel>,
      row,
    );

    const call: Record<string, unknown> = onlyFeedCall();
    expect(String(call["userId"])).toBe(VALERIA_ID.toString());
    expect(call["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
    // Deane is who the entry is about, by their page in the project.
    expect(String(call["feedInfoInMarkdown"])).toContain(
      `[Deane Looi](${DASHBOARD}/${PROJECT_ID.toString()}/users/${DEANE_ID.toString()})`,
    );
  });

  test("removed by someone: the entry is theirs, and its message opens with them", async () => {
    const row: BaseModel = ownerRow(kind);

    await hooks.onDeleteSuccess(
      {
        deleteBy: {
          query: {},
          limit: 1,
          skip: 0,
          props: memberProps(VALERIA_ID),
        },
        carryForward: { itemsToDelete: [row] },
      } as OnDelete<BaseModel>,
      [ROW_ID],
    );

    const call: Record<string, unknown> = onlyFeedCall();
    expect(String(call["userId"])).toBe(VALERIA_ID.toString());
    expect(call["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
    expect(String(call["feedInfoInMarkdown"])).toContain("Deane Looi");
  });
});

describe("a person taken off an on-call escalation rule", () => {
  beforeEach(() => {
    spyOwnerWrites(OWNER_KINDS[OWNER_KINDS.length - 1]!);
  });

  test("the entry is by whoever took them off, and its message opens with them", async () => {
    const row: OnCallDutyPolicyEscalationRuleUser =
      new OnCallDutyPolicyEscalationRuleUser();
    row.projectId = PROJECT_ID;
    row.user = userRow(DEANE_ID)!;
    row.onCallDutyPolicy = {
      _id: RECORD_ID.toString(),
      name: "Payments",
    } as never;
    row.onCallDutyPolicyEscalationRule = {
      _id: ROW_ID.toString(),
      name: "First responders",
      order: 1,
    } as never;
    // The relations' ids, as a read of them gives them back.
    (row.user as User).id = DEANE_ID;
    (row.onCallDutyPolicy as unknown as { id: ObjectID }).id = RECORD_ID;
    (row.onCallDutyPolicyEscalationRule as unknown as { id: ObjectID }).id =
      ROW_ID;

    jest
      .spyOn(
        OnCallDutyPolicyEscalationRuleUserService as unknown as {
          findRowsAndHoldDeleteToThem: () => Promise<unknown>;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([row] as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockResolvedValue(undefined as never);

    await (
      OnCallDutyPolicyEscalationRuleUserService as unknown as {
        onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
      }
    ).onBeforeDelete({
      query: {},
      limit: 1,
      skip: 0,
      props: memberProps(VALERIA_ID),
    });

    const call: Record<string, unknown> = onlyFeedCall();
    expect(String(call["userId"])).toBe(VALERIA_ID.toString());
    expect(call["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
    expect(String(call["feedInfoInMarkdown"])).toContain(
      "Removed **Deane Looi**",
    );
  });
});

/*
 * From the entry to the person its Slack and Teams message opens with:
 * every feed service hands sendWorkspaceMarkdownNotification the entry's
 * own author when the entry asks for it, and nobody else.
 */
interface FeedKind {
  label: string;
  service: unknown;
  method: string;
  recordIdKey: string;
  eventTypeKey: string;
  // The record's id as the message's notificationFor names it.
  notificationForKey: string;
  savesChatMessages: boolean;
}

const FEED_KINDS: Array<FeedKind> = [
  {
    label: "incidents",
    service: IncidentFeedService,
    method: "createIncidentFeedItem",
    recordIdKey: "incidentId",
    eventTypeKey: "incidentFeedEventType",
    notificationForKey: "incidentId",
    savesChatMessages: true,
  },
  {
    label: "alerts",
    service: AlertFeedService,
    method: "createAlertFeedItem",
    recordIdKey: "alertId",
    eventTypeKey: "alertFeedEventType",
    notificationForKey: "alertId",
    savesChatMessages: true,
  },
  {
    label: "incident episodes",
    service: IncidentEpisodeFeedService,
    method: "createIncidentEpisodeFeedItem",
    recordIdKey: "incidentEpisodeId",
    eventTypeKey: "incidentEpisodeFeedEventType",
    notificationForKey: "incidentEpisodeId",
    savesChatMessages: true,
  },
  {
    label: "alert episodes",
    service: AlertEpisodeFeedService,
    method: "createAlertEpisodeFeedItem",
    recordIdKey: "alertEpisodeId",
    eventTypeKey: "alertEpisodeFeedEventType",
    notificationForKey: "alertEpisodeId",
    savesChatMessages: true,
  },
  {
    label: "scheduled maintenance",
    service: ScheduledMaintenanceFeedService,
    method: "createScheduledMaintenanceFeedItem",
    recordIdKey: "scheduledMaintenanceId",
    eventTypeKey: "scheduledMaintenanceFeedEventType",
    notificationForKey: "scheduledMaintenanceId",
    savesChatMessages: true,
  },
  {
    label: "monitors",
    service: MonitorFeedService,
    method: "createMonitorFeedItem",
    recordIdKey: "monitorId",
    eventTypeKey: "monitorFeedEventType",
    notificationForKey: "monitorId",
    savesChatMessages: false,
  },
  {
    label: "on-call policies",
    service: OnCallDutyPolicyFeedService,
    method: "createOnCallDutyPolicyFeedItem",
    recordIdKey: "onCallDutyPolicyId",
    eventTypeKey: "onCallDutyPolicyFeedEventType",
    notificationForKey: "onCallDutyPolicyId",
    savesChatMessages: false,
  },
];

describe.each(FEED_KINDS)("the feed of $label", (kind: FeedKind) => {
  type Send = Parameters<
    typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
  >[0];

  let sends: Array<Send> = [];

  beforeEach(() => {
    sends = [];

    // The entry's own row is written as root; nothing is stored here.
    jest
      .spyOn(kind.service as { create: () => Promise<unknown> }, "create")
      .mockResolvedValue({} as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "sendWorkspaceMarkdownNotification",
      )
      .mockImplementation((async (data: Send) => {
        sends.push(data);
      }) as never);
  });

  // The kind's create...FeedItem, with what every entry carries.
  const createEntry: (extra: Record<string, unknown>) => Promise<void> = async (
    extra: Record<string, unknown>,
  ): Promise<void> => {
    await (
      kind.service as Record<
        string,
        (data: Record<string, unknown>) => Promise<void>
      >
    )[kind.method]!({
      [kind.recordIdKey]: RECORD_ID,
      projectId: PROJECT_ID,
      [kind.eventTypeKey]: "OwnerUserAdded",
      feedInfoInMarkdown: "👨🏻‍💻 Added **Deane Looi** as the owner.",
      ...extra,
    });
  };

  const onlySend: () => Send = (): Send => {
    expect(sends).toHaveLength(1);
    return sends[0]!;
  };

  test("an entry that asks for it opens with its author: the person who made the change", async () => {
    await createEntry({
      userId: VALERIA_ID,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      },
    });

    const send: Send = onlySend();
    expect(send.workspaceNotification.authorUserId?.toString()).toBe(
      VALERIA_ID.toString(),
    );
    expect(send.workspaceNotification.authorApiKeyName).toBeUndefined();
    expect(
      (send.notificationFor as Record<string, unknown>)[
        kind.notificationForKey
      ]?.toString(),
    ).toBe(RECORD_ID.toString());
  });

  test("an entry that does not ask opens with no one, though it has an author (a created message's heading)", async () => {
    await createEntry({
      userId: VALERIA_ID,
      workspaceNotification: { sendWorkspaceNotification: true },
    });

    expect(onlySend().workspaceNotification.authorUserId).toBeUndefined();
  });

  test("an entry with no author opens with no one", async () => {
    await createEntry({
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      },
    });

    expect(onlySend().workspaceNotification.authorUserId).toBeUndefined();
  });

  test("an entry not posted is not posted", async () => {
    await createEntry({
      userId: VALERIA_ID,
      workspaceNotification: {
        sendWorkspaceNotification: false,
        leadWithAuthor: true,
      },
    });

    expect(sends).toHaveLength(0);
  });

  if (kind.savesChatMessages) {
    test("a note saved from a chat message opens with no one: it names its people itself", async () => {
      await createEntry({
        userId: VALERIA_ID,
        savedFromChatMessage: {
          workspaceType: WorkspaceType.Slack,
          authorName: "Aidil Rahman",
          postedAt: "2026-10-29T09:00:00.000Z",
        },
        workspaceNotification: {
          sendWorkspaceNotification: true,
          leadWithAuthor: true,
        },
      });

      expect(onlySend().workspaceNotification.authorUserId).toBeUndefined();
    });
  }

  test("what the post's notification says is passed on", async () => {
    await createEntry({
      userId: VALERIA_ID,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
        notificationText: "Deane Looi is an owner now",
      },
    });

    expect(onlySend().notificationText).toBe("Deane Looi is an owner now");
  });
});

describe("the incident feed, which keeps the API key that made a change", () => {
  type Send = Parameters<
    typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
  >[0];

  test("an API key's entry opens with the key's name, and a person's with the person", async () => {
    const sends: Array<Send> = [];

    jest.spyOn(IncidentFeedService, "create").mockResolvedValue({} as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "sendWorkspaceMarkdownNotification",
      )
      .mockImplementation((async (data: Send) => {
        sends.push(data);
      }) as never);

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: RECORD_ID,
      projectId: PROJECT_ID,
      incidentFeedEventType: "IncidentMemberAdded" as never,
      feedInfoInMarkdown: "👤 Added **Deane Looi** as **Responder**.",
      apiKeyActor: { apiKeyId: API_KEY_ID, apiKeyName: "Jira Automation" },
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      },
    });

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: RECORD_ID,
      projectId: PROJECT_ID,
      incidentFeedEventType: "IncidentMemberAdded" as never,
      feedInfoInMarkdown: "👤 Added **Deane Looi** as **Responder**.",
      userId: VALERIA_ID,
      apiKeyActor: { apiKeyId: API_KEY_ID, apiKeyName: "Jira Automation" },
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      },
    });

    expect(sends).toHaveLength(2);
    expect(sends[0]!.workspaceNotification.authorApiKeyName).toBe(
      "Jira Automation",
    );
    expect(sends[0]!.workspaceNotification.authorUserId).toBeUndefined();
    expect(sends[1]!.workspaceNotification.authorUserId?.toString()).toBe(
      VALERIA_ID.toString(),
    );
    expect(sends[1]!.workspaceNotification.authorApiKeyName).toBeUndefined();
  });
});
