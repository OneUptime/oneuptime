import AlertFeed, {
  AlertFeedEventType,
} from "../../../Models/DatabaseModels/AlertFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import WorkspaceNotificationRuleService, {
  WorkspaceMarkdownNotification,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FeedWorkspaceNotificationUtil from "../../../Server/Utils/Feed/FeedWorkspaceNotification";
import WorkspaceCreatedMessageFirst from "../../../Server/Utils/Workspace/WorkspaceCreatedMessageFirst";
import { WorkspaceRecord } from "../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import ObjectID from "../../../Types/ObjectID";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
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
 * WHAT IS POSTED ABOUT A RECORD WHILE IT IS CREATED WAITS FOR ITS CREATED
 * MESSAGE (#11146).
 *
 * Every message about an incident or alert goes out through
 * WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification. While
 * the record's create holds its messages (WorkspaceCreatedMessageFirst),
 * a message that does not announce the record is kept and posted, exactly
 * as it was sent, right after the one that does; the Created message itself
 * goes out at once. The feed services hand the flag that says a message
 * announces its record through. And a record's create asks whether any of
 * the project's rules asks who owns such a record
 * (hasRulesWithOwnerCondition) before it waits for owners added outside its
 * chain.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11146000-0000-4000-8000-000000000001",
);

type PostFunction = (data: WorkspaceMarkdownNotification) => Promise<void>;

// The messages that went out, as the private send that posts them saw them.
let posted: Array<WorkspaceMarkdownNotification> = [];

// Every record a test held, let go after it.
let held: Array<WorkspaceRecord> = [];

function hold(record: WorkspaceRecord): WorkspaceRecord {
  held.push(record);
  WorkspaceCreatedMessageFirst.hold(record);
  return record;
}

function messageAbout(
  record: WorkspaceRecord,
  markdown: string,
  workspaceNotification: Partial<
    WorkspaceMarkdownNotification["workspaceNotification"]
  > = {},
): WorkspaceMarkdownNotification {
  return {
    projectId: PROJECT_ID,
    notificationFor: record,
    feedInfoInMarkdown: markdown,
    workspaceNotification: {
      sendWorkspaceNotification: true,
      ...workspaceNotification,
    },
  };
}

function postedMarkdown(): Array<string> {
  return posted.map((message: WorkspaceMarkdownNotification): string => {
    return message.feedInfoInMarkdown;
  });
}

beforeEach(() => {
  posted = [];
  held = [];

  jest
    .spyOn(
      WorkspaceNotificationRuleService as unknown as {
        postWorkspaceMarkdownNotification: PostFunction;
      },
      "postWorkspaceMarkdownNotification",
    )
    .mockImplementation((async (
      data: WorkspaceMarkdownNotification,
    ): Promise<void> => {
      posted.push(data);
    }) as never);
});

afterEach(async () => {
  for (const record of held) {
    await WorkspaceCreatedMessageFirst.postHeld(record);
  }

  jest.restoreAllMocks();
});

describe("sendWorkspaceMarkdownNotification while a record is created", () => {
  test("a message about a record nobody is creating goes out at once", async () => {
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout({ alertId: ObjectID.generate() }, "Added team Platform"),
    );

    expect(postedMarkdown()).toEqual(["Added team Platform"]);
  });

  test("a message about a record being created waits, and goes out once it is let go, exactly as sent", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const sent: WorkspaceMarkdownNotification = messageAbout(
      alert,
      "Added team Platform to the Alert as the owner.",
      { authorUserId: ObjectID.generate() },
    );

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      sent,
    );

    // The caller is not held up, and nothing went out.
    expect(posted).toEqual([]);

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toBe(sent);
  });

  test("the message that announces the record goes out at once, ahead of what was kept", async () => {
    const incident: WorkspaceRecord = hold({ incidentId: ObjectID.generate() });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(incident, "🔗 Declared from 1 alert"),
    );
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(incident, "Added team Platform"),
    );
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(incident, "#### 🚨 Incident INC-4 Created", {
        announcesRecord: true,
      }),
    );

    expect(postedMarkdown()).toEqual(["#### 🚨 Incident INC-4 Created"]);

    await WorkspaceCreatedMessageFirst.postHeld(incident);

    expect(postedMarkdown()).toEqual([
      "#### 🚨 Incident INC-4 Created",
      "🔗 Declared from 1 alert",
      "Added team Platform",
    ]);
  });

  test("messages about other records go out at once, and each record's kept messages keep their order", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });
    const monitor: WorkspaceRecord = { monitorId: ObjectID.generate() };

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(alert, "alert: first"),
    );
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(monitor, "monitor: status changed"),
    );
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(alert, "alert: second"),
    );

    expect(postedMarkdown()).toEqual(["monitor: status changed"]);

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(postedMarkdown()).toEqual([
      "monitor: status changed",
      "alert: first",
      "alert: second",
    ]);
  });

  test("once let go, a message about the record goes out at once and is never kept again", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });

    await WorkspaceCreatedMessageFirst.postHeld(alert);

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(alert, "Changed Alert State to Acknowledged"),
    );

    expect(postedMarkdown()).toEqual(["Changed Alert State to Acknowledged"]);
  });

  test("a kept message is posted once: posting it does not keep it again", async () => {
    const alert: WorkspaceRecord = hold({ alertId: ObjectID.generate() });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      messageAbout(alert, "Added Jane"),
    );

    await WorkspaceCreatedMessageFirst.postHeld(alert);
    await WorkspaceCreatedMessageFirst.postHeld(alert);

    expect(postedMarkdown()).toEqual(["Added Jane"]);
  });
});

describe("the feed services say which message announces its record", () => {
  test("FeedWorkspaceNotificationUtil hands announcesRecord on, and adds nothing for an ordinary entry", () => {
    expect(
      FeedWorkspaceNotificationUtil.toWorkspaceNotification({
        workspaceNotification: {
          sendWorkspaceNotification: true,
          announcesRecord: true,
        },
      }).announcesRecord,
    ).toBe(true);

    expect(
      Object.keys(
        FeedWorkspaceNotificationUtil.toWorkspaceNotification({
          workspaceNotification: { sendWorkspaceNotification: true },
        }),
      ),
    ).not.toContain("announcesRecord");

    expect(
      Object.keys(
        FeedWorkspaceNotificationUtil.toWorkspaceNotification({
          workspaceNotification: {
            sendWorkspaceNotification: true,
            announcesRecord: false,
          },
        }),
      ),
    ).not.toContain("announcesRecord");
  });

  test("an alert's entry that announces it goes out while its other messages wait", async () => {
    const alertId: ObjectID = ObjectID.generate();
    hold({ alertId: alertId });

    const rows: Array<AlertFeed> = [];
    jest.spyOn(AlertFeedService, "create").mockImplementation((async (
      data: CreateBy<AlertFeed>,
    ): Promise<AlertFeed> => {
      rows.push(data.data);
      return data.data;
    }) as never);

    const postedAt: Date = new Date("2026-11-24T11:30:00.000Z");

    await AlertFeedService.createAlertFeedItem({
      alertId: alertId,
      projectId: PROJECT_ID,
      alertFeedEventType: AlertFeedEventType.OwnerTeamAdded,
      feedInfoInMarkdown: "Added team Platform",
      workspaceNotification: { sendWorkspaceNotification: true },
    });
    await AlertFeedService.createAlertFeedItem({
      alertId: alertId,
      projectId: PROJECT_ID,
      alertFeedEventType: AlertFeedEventType.AlertCreated,
      feedInfoInMarkdown: "#### 🚨 Alert ALT-6 Created",
      postedAt: postedAt,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        announcesRecord: true,
      },
    });

    // Both entries are in the feed; only the one that announces the alert is posted.
    expect(rows).toHaveLength(2);
    expect(rows[1]!.postedAt).toEqual(postedAt);
    expect(postedMarkdown()).toEqual(["#### 🚨 Alert ALT-6 Created"]);
    expect(posted[0]!.workspaceNotification.announcesRecord).toBe(true);

    await WorkspaceCreatedMessageFirst.postHeld({ alertId: alertId });

    expect(postedMarkdown()).toEqual([
      "#### 🚨 Alert ALT-6 Created",
      "Added team Platform",
    ]);
  });

  test("an incident's entry that announces it goes out while its other messages wait", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    hold({ incidentId: incidentId });

    jest.spyOn(IncidentFeedService, "create").mockImplementation((async (
      data: CreateBy<IncidentFeed>,
    ): Promise<IncidentFeed> => {
      return data.data;
    }) as never);

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: incidentId,
      projectId: PROJECT_ID,
      incidentFeedEventType: IncidentFeedEventType.AlertLinked,
      feedInfoInMarkdown: "🔗 Declared from 1 alert",
      workspaceNotification: {
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      },
    });
    await IncidentFeedService.createIncidentFeedItem({
      incidentId: incidentId,
      projectId: PROJECT_ID,
      incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
      feedInfoInMarkdown: "#### 🚨 Incident INC-4 Created",
      workspaceNotification: {
        sendWorkspaceNotification: true,
        announcesRecord: true,
      },
    });

    expect(postedMarkdown()).toEqual(["#### 🚨 Incident INC-4 Created"]);

    await WorkspaceCreatedMessageFirst.postHeld({ incidentId: incidentId });

    expect(postedMarkdown()).toEqual([
      "#### 🚨 Incident INC-4 Created",
      "🔗 Declared from 1 alert",
    ]);
  });
});

describe("hasRulesWithOwnerCondition", () => {
  let rules: Array<WorkspaceNotificationRule> = [];
  let connected: boolean = true;
  let ruleReads: SpyInstance<typeof WorkspaceNotificationRuleService.findBy>;

  function rule(
    filters: Array<NotificationRuleCondition>,
  ): WorkspaceNotificationRule {
    const item: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    item.id = ObjectID.generate();
    item.projectId = PROJECT_ID;
    item.workspaceType = WorkspaceType.Slack;
    item.eventType = NotificationRuleEventType.Alert;
    item.notificationRule = {
      _type: "AlertNotificationRule",
      filterCondition: FilterCondition.All,
      filters: filters,
      shouldPostToExistingChannel: true,
      existingChannelNames: "c",
      shouldCreateNewChannel: false,
    } as unknown as IncidentNotificationRule as never;
    return item;
  }

  function condition(
    checkOn: NotificationRuleConditionCheckOn,
  ): NotificationRuleCondition {
    return {
      checkOn: checkOn,
      conditionType: ConditionType.ContainsAny,
      value: [ObjectID.generate().toString()],
    };
  }

  beforeEach(() => {
    rules = [];
    connected = true;

    jest
      .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
      .mockImplementation(async (): Promise<boolean> => {
        return connected;
      });

    ruleReads = jest
      .spyOn(WorkspaceNotificationRuleService, "findBy")
      .mockImplementation((async (): Promise<
        Array<WorkspaceNotificationRule>
      > => {
        return rules;
      }) as never);
  });

  test("true when one of the kind's rules has an owners condition, among others", async () => {
    rules = [
      rule([condition(NotificationRuleConditionCheckOn.AlertSeverity)]),
      rule([
        condition(NotificationRuleConditionCheckOn.AlertLabels),
        condition(NotificationRuleConditionCheckOn.AlertOwners),
      ]),
    ];

    await expect(
      WorkspaceNotificationRuleService.hasRulesWithOwnerCondition({
        projectId: PROJECT_ID,
        eventType: NotificationRuleEventType.Alert,
      }),
    ).resolves.toBe(true);
  });

  test("reads the project's rules of that kind in every workspace, as root", async () => {
    await WorkspaceNotificationRuleService.hasRulesWithOwnerCondition({
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.Incident,
    });

    expect(ruleReads).toHaveBeenCalledTimes(1);

    const read: Record<string, unknown> = ruleReads.mock
      .calls[0]![0] as unknown as Record<string, unknown>;

    expect(read["query"]).toEqual({
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.Incident,
    });
    expect(read["props"]).toEqual({ isRoot: true });
  });

  test("false when no rule asks who owns the record", async () => {
    rules = [
      rule([condition(NotificationRuleConditionCheckOn.AlertLabels)]),
      rule([]),
    ];

    await expect(
      WorkspaceNotificationRuleService.hasRulesWithOwnerCondition({
        projectId: PROJECT_ID,
        eventType: NotificationRuleEventType.Alert,
      }),
    ).resolves.toBe(false);
  });

  test("an owners condition of another kind of record does not count", async () => {
    rules = [
      rule([condition(NotificationRuleConditionCheckOn.IncidentOwners)]),
    ];

    await expect(
      WorkspaceNotificationRuleService.hasRulesWithOwnerCondition({
        projectId: PROJECT_ID,
        eventType: NotificationRuleEventType.Alert,
      }),
    ).resolves.toBe(false);
  });

  test("false, with nothing read, for a kind of record without owners", async () => {
    await expect(
      WorkspaceNotificationRuleService.hasRulesWithOwnerCondition({
        projectId: PROJECT_ID,
        eventType: NotificationRuleEventType.SecurityCase,
      }),
    ).resolves.toBe(false);

    expect(ruleReads).not.toHaveBeenCalled();
  });

  test("false, with no rule read, in a project with no workspace connected", async () => {
    connected = false;
    rules = [rule([condition(NotificationRuleConditionCheckOn.AlertOwners)])];

    await expect(
      WorkspaceNotificationRuleService.hasRulesWithOwnerCondition({
        projectId: PROJECT_ID,
        eventType: NotificationRuleEventType.Alert,
      }),
    ).resolves.toBe(false);

    expect(ruleReads).not.toHaveBeenCalled();
  });
});
