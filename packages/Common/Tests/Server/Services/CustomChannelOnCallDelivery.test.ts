import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import CustomNotificationChannelDeliveryService from "../../../Server/Services/CustomNotificationChannelDeliveryService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import TeamService from "../../../Server/Services/TeamService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService, {
  ExecuteFallbackNotificationOptions,
  ExecuteNotificationRuleOptions,
} from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import CustomChannelActionToken from "../../../Server/Utils/OnCall/CustomChannelActionToken";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import URL from "../../../Types/API/URL";
import {
  CustomChannelAction,
  CustomChannelActionLinks,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
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
 * An on-call page through a custom channel: one request to the channel's
 * service about the record the page is for, naming the person, carrying the
 * links to act on it; nothing at all to a channel turned off, but a log row
 * that says so; never on a repeat, which is push alone; and a channel that
 * pages everyone is what the fallback reaches a responder on, and what a
 * person joining a project gets in their rules.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const CHANNEL_ID: ObjectID = ObjectID.generate();
const LOG_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const POLICY_ID: ObjectID = ObjectID.generate();
const ESCALATION_RULE_ID: ObjectID = ObjectID.generate();
const TIMELINE_ID: ObjectID = ObjectID.generate();

const ACTION_LINKS: CustomChannelActionLinks = {
  [CustomChannelAction.Acknowledge]: "https://x/ack",
  [CustomChannelAction.Escalate]: "https://x/escalate",
  [CustomChannelAction.Resolve]: "https://x/resolve",
};

interface ServiceInternals {
  deliverNotificationForRule: (
    rule: UserNotificationRule,
    options: ExecuteNotificationRuleOptions,
  ) => Promise<boolean>;
  chooseFallbackChannels: (
    options: ExecuteFallbackNotificationOptions,
  ) => Promise<Array<{ channelName: string; rule: UserNotificationRule }>>;
  getContactableChannelNames: (rule: UserNotificationRule) => Array<string>;
}

function internals(): ServiceInternals {
  return UserNotificationRuleService as unknown as ServiceInternals;
}

function channelRule(
  data: { isEnabled?: boolean; name?: string } = {},
): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = ObjectID.generate().toString();
  rule.projectId = PROJECT_ID;
  rule.userId = USER_ID;
  rule.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
  rule.notifyAfterMinutes = 0;

  const channel: CustomNotificationChannel = new CustomNotificationChannel();
  channel._id = CHANNEL_ID.toString();
  channel.name = data.name ?? "CorpoApp";
  channel.isEnabled = data.isEnabled ?? true;
  rule.customNotificationChannel = channel;
  rule.customNotificationChannelId = CHANNEL_ID;

  return rule;
}

function options(
  eventType: UserNotificationEventType,
  ids: Partial<ExecuteNotificationRuleOptions> = {},
): ExecuteNotificationRuleOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: eventType,
    userNotificationLogId: LOG_ID,
    onCallPolicyId: POLICY_ID,
    onCallPolicyEscalationRuleId: ESCALATION_RULE_ID,
    userBelongsToTeamId: TEAM_ID,
    ...ids,
  } as ExecuteNotificationRuleOptions;
}

function project(): Project {
  const row: Project = new Project();
  row.name = "Agency A";
  return row;
}

function incident(): Incident {
  const row: Incident = new Incident();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.title = "API latency high";
  row.description = "p95 above 2 seconds.";
  row.incidentNumber = 42;
  row.incidentNumberWithPrefix = "INC-42";
  row.project = project();
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;
  const state: IncidentState = new IncidentState();
  state.name = "Created";
  row.currentIncidentState = state;
  return row;
}

function alert(): Alert {
  const row: Alert = new Alert();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.title = "Disk almost full";
  row.description = "92% used.";
  row.alertNumber = 7;
  row.project = project();
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";
  row.alertSeverity = severity;
  const state: AlertState = new AlertState();
  state.name = "Triggered";
  row.currentAlertState = state;
  return row;
}

let send: jest.SpiedFunction<typeof CustomNotificationChannelDeliveryService.send>;
let createTimeline: jest.SpiedFunction<typeof UserOnCallLogTimelineService.create>;
let updateTimeline: jest.SpiedFunction<
  typeof UserOnCallLogTimelineService.updateOneById
>;

beforeEach(() => {
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined);

  createTimeline = jest
    .spyOn(UserOnCallLogTimelineService, "create")
    .mockImplementation(
      async (data: { data: UserOnCallLogTimeline }): Promise<UserOnCallLogTimeline> => {
        const row: UserOnCallLogTimeline = data.data;
        if (!row._id) {
          row._id = TIMELINE_ID.toString();
        }
        return row;
      },
    );
  updateTimeline = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example.com/i/1"));
  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example.com/a/1"));

  jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
    const user: User = new User();
    user.name = new Name("Jane Tan");
    user.email = new Email("jane@example.com");
    return user;
  });
  jest.spyOn(TeamService, "findOneById").mockImplementation(async () => {
    const team: Team = new Team();
    team.name = "SRE";
    return team;
  });
  jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockImplementation(async () => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.name = "Primary";
      return policy;
    });
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
    .mockImplementation(async () => {
      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.name = "Level 1";
      return rule;
    });

  jest
    .spyOn(CustomChannelActionToken, "getActionLinks")
    .mockResolvedValue(ACTION_LINKS);

  send = jest
    .spyOn(CustomNotificationChannelDeliveryService, "send")
    .mockResolvedValue({ ok: true, statusCode: 200, message: "Sent." });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sentPayload(): JSONObject {
  expect(send).toHaveBeenCalledTimes(1);
  return (send.mock.calls[0]![0] as { payload: JSONObject }).payload;
}

describe("a page through a custom channel", () => {
  test("is one request about the incident, for the person, with the links to act on it", async () => {
    const paged: Incident = incident();
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(paged);

    const attempted: boolean = await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: paged.id!,
      }),
    );

    expect(attempted).toBe(true);

    const request: Record<string, unknown> = send.mock.calls[0]![0] as never;
    expect((request["customNotificationChannelId"] as ObjectID).toString()).toBe(
      CHANNEL_ID.toString(),
    );
    expect(request["eventType"]).toBe("on-call.incident.created");
    expect((request["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((request["userOnCallLogTimelineId"] as ObjectID).toString()).toBe(
      TIMELINE_ID.toString(),
    );

    const payload: JSONObject = sentPayload();
    expect(payload["version"]).toBe(1);
    expect(payload["event"]).toBe("on-call.incident.created");
    expect(payload["notificationId"]).toBe(TIMELINE_ID.toString());
    expect(payload["channel"]).toEqual({
      id: CHANNEL_ID.toString(),
      name: "CorpoApp",
    });
    expect(payload["user"]).toEqual({
      id: USER_ID.toString(),
      name: "Jane Tan",
      email: "jane@example.com",
    });
    expect(payload["project"]).toEqual({
      id: PROJECT_ID.toString(),
      name: "Agency A",
    });
    expect(payload["team"]).toEqual({ id: TEAM_ID.toString(), name: "SRE" });
    expect(payload["onCallPolicy"]).toEqual({
      id: POLICY_ID.toString(),
      name: "Primary",
    });
    expect(payload["escalationRule"]).toEqual({
      id: ESCALATION_RULE_ID.toString(),
      name: "Level 1",
    });
    expect(payload["recordType"]).toBe("incident");
    expect(payload["record"]).toEqual({
      id: paged.id!.toString(),
      number: "INC-42",
      title: "API latency high",
      description: "p95 above 2 seconds.",
      severity: "Critical",
      state: "Created",
      url: "https://oneuptime.example.com/i/1",
    });
    expect(payload["title"]).toBe("New Incident INC-42: API latency high");
    expect(payload["message"]).toContain("INC-42");
    expect(payload["isPageAgain"]).toBe(false);
    expect(payload["actions"]).toEqual({
      acknowledge: "https://x/ack",
      escalate: "https://x/escalate",
      resolve: "https://x/resolve",
    });
  });

  test("its links are made for the log row the page is recorded on", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident());

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
      }),
    );

    const linksFor: ObjectID = (
      CustomChannelActionToken.getActionLinks as unknown as jest.Mock
    ).mock.calls[0]![0] as ObjectID;

    expect(linksFor.toString()).toBe(TIMELINE_ID.toString());
  });

  test("is recorded as being sent, on the channel, before it is sent", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident());

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
      }),
    );

    expect(createTimeline).toHaveBeenCalledTimes(1);
    const row: UserOnCallLogTimeline = (
      createTimeline.mock.calls[0]![0] as { data: UserOnCallLogTimeline }
    ).data;

    expect(row.status).toBe(UserNotificationStatus.Sending);
    expect(row.statusMessage).toBe("Sending to CorpoApp.");
    expect(row.customNotificationChannelId?.toString()).toBe(
      CHANNEL_ID.toString(),
    );
    expect(row.userId?.toString()).toBe(USER_ID.toString());
    expect(row.userNotificationLogId?.toString()).toBe(LOG_ID.toString());
  });

  test("an alert is sent as an alert", async () => {
    const paged: Alert = alert();
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(paged);

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.AlertCreated, {
        triggeredByAlertId: paged.id!,
      }),
    );

    const payload: JSONObject = sentPayload();
    expect(payload["event"]).toBe("on-call.alert.created");
    expect(payload["recordType"]).toBe("alert");
    expect((payload["record"] as JSONObject)["number"]).toBe("#7");
    expect((payload["record"] as JSONObject)["severity"]).toBe("Warning");
    expect((payload["record"] as JSONObject)["state"]).toBe("Triggered");
    expect((payload["record"] as JSONObject)["url"]).toBe(
      "https://oneuptime.example.com/a/1",
    );
  });

  test("an alert episode is sent as an alert episode", async () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode._id = ObjectID.generate().toString();
    episode.projectId = PROJECT_ID;
    episode.title = "Many disks full";
    episode.episodeNumberWithPrefix = "AE-3";
    episode.project = project();

    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue(episode);
    jest
      .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example.com/ae/3"));

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.AlertEpisodeCreated, {
        triggeredByAlertEpisodeId: episode.id!,
      }),
    );

    const payload: JSONObject = sentPayload();
    expect(payload["event"]).toBe("on-call.alertEpisode.created");
    expect(payload["recordType"]).toBe("alertEpisode");
    expect((payload["record"] as JSONObject)["number"]).toBe("AE-3");
  });

  test("an incident episode is sent as an incident episode", async () => {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode._id = ObjectID.generate().toString();
    episode.projectId = PROJECT_ID;
    episode.title = "Region outage";
    episode.episodeNumber = 9;
    episode.project = project();

    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(episode);
    jest
      .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example.com/ie/9"));

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.IncidentEpisodeCreated, {
        triggeredByIncidentEpisodeId: episode.id!,
      }),
    );

    const payload: JSONObject = sentPayload();
    expect(payload["event"]).toBe("on-call.incidentEpisode.created");
    expect(payload["recordType"]).toBe("incidentEpisode");
    expect((payload["record"] as JSONObject)["number"]).toBe("#9");
  });

  test("a page made directly says no team, and still goes out", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident());

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
        userBelongsToTeamId: undefined,
      }),
    );

    expect(sentPayload()["team"]).toBeNull();
  });

  test("a team or policy whose name cannot be read does not stop the page", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident());
    jest
      .spyOn(TeamService, "findOneById")
      .mockRejectedValue(new Error("database down"));

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
      }),
    );

    expect(sentPayload()["team"]).toEqual({
      id: TEAM_ID.toString(),
      name: "",
    });
  });

  test("a send that fails is recorded as an error on its log row", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident());
    send.mockRejectedValue(new Error("Notification service unreachable"));

    await internals().deliverNotificationForRule(
      channelRule(),
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
      }),
    );

    // The send is not awaited: let its rejection settle.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(updateTimeline).toHaveBeenCalledWith({
      id: TIMELINE_ID,
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: "Notification service unreachable",
      },
      props: { isRoot: true },
    });
  });
});

describe("a channel that is turned off", () => {
  test("sends nothing, and the log says why", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident());

    const attempted: boolean = await internals().deliverNotificationForRule(
      channelRule({ isEnabled: false }),
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
      }),
    );

    expect(attempted).toBe(false);
    expect(send).not.toHaveBeenCalled();

    expect(createTimeline).toHaveBeenCalledTimes(1);
    const row: UserOnCallLogTimeline = (
      createTimeline.mock.calls[0]![0] as { data: UserOnCallLogTimeline }
    ).data;
    expect(row.status).toBe(UserNotificationStatus.Error);
    expect(row.statusMessage).toBe("Not sent: CorpoApp is turned off.");
    expect(row.customNotificationChannelId?.toString()).toBe(
      CHANNEL_ID.toString(),
    );
  });

  test("is not a channel the rule can reach anybody on", () => {
    expect(
      internals().getContactableChannelNames(channelRule({ isEnabled: false })),
    ).toEqual([]);
  });

  test("one that is on is", () => {
    expect(internals().getContactableChannelNames(channelRule())).toEqual([
      "Custom Channel",
    ]);
  });
});

describe("a repeat", () => {
  test("never goes to the custom channel: a repeat is push alone", async () => {
    const rule: UserNotificationRule = channelRule();
    const push: UserPush = new UserPush();
    push._id = ObjectID.generate().toString();
    push.userId = USER_ID;
    push.deviceToken = "ExponentPushToken[handset]";
    rule.userPush = push;
    rule.userPushId = push.id!;

    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true);
    jest.spyOn(UserNotificationRuleService, "findOneById").mockResolvedValue(rule);

    const deliver: jest.SpiedFunction<
      ServiceInternals["deliverNotificationForRule"]
    > = jest
      .spyOn(internals(), "deliverNotificationForRule")
      .mockResolvedValue(true);

    await UserNotificationRuleService.executeNotificationRuleItem(rule.id!, {
      ...options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
      }),
      repeatNumber: 1,
    });

    const delivered: UserNotificationRule = deliver.mock
      .calls[0]![0] as UserNotificationRule;

    expect(delivered.customNotificationChannel).toBeUndefined();
    expect(delivered.customNotificationChannelId).toBeUndefined();
    expect(delivered.userPushId?.toString()).toBe(push.id!.toString());
  });

  test("the first page reads the channel's name and switch, and nothing else of it", async () => {
    const rule: UserNotificationRule = channelRule();

    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true);
    const findRule: jest.SpiedFunction<
      typeof UserNotificationRuleService.findOneById
    > = jest
      .spyOn(UserNotificationRuleService, "findOneById")
      .mockResolvedValue(rule);
    jest
      .spyOn(internals(), "deliverNotificationForRule")
      .mockResolvedValue(true);

    await UserNotificationRuleService.executeNotificationRuleItem(
      rule.id!,
      options(UserNotificationEventType.IncidentCreated, {
        triggeredByIncidentId: ObjectID.generate(),
      }),
    );

    const select: Record<string, unknown> = (
      findRule.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["customNotificationChannel"]).toEqual({
      name: true,
      isEnabled: true,
    });
  });
});

describe("the fallback", () => {
  function fallbackOptions(): ExecuteFallbackNotificationOptions {
    return {
      ...options(UserNotificationEventType.IncidentCreated),
      userId: USER_ID,
      userOnCallLogId: LOG_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityName: "Critical",
    } as ExecuteFallbackNotificationOptions;
  }

  function noPersonalMethods(): void {
    jest.spyOn(UserPushService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(UserEmailService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(UserSlackService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(UserMicrosoftTeamsService, "findOneBy").mockResolvedValue(null);
  }

  function channelPagingEveryone(name: string): CustomNotificationChannel {
    const channel: CustomNotificationChannel = new CustomNotificationChannel();
    channel._id = ObjectID.generate().toString();
    channel.name = name;
    return channel;
  }

  test("reaches a responder with no rule through every channel that pages everyone", async () => {
    noPersonalMethods();
    const corpoApp: CustomNotificationChannel = channelPagingEveryone("CorpoApp");
    const pager: CustomNotificationChannel = channelPagingEveryone("Pager");

    jest
      .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
      .mockResolvedValue([corpoApp, pager]);

    const chosen: Array<{ channelName: string; rule: UserNotificationRule }> =
      await internals().chooseFallbackChannels(fallbackOptions());

    expect(
      chosen.map(
        (choice: { channelName: string; rule: UserNotificationRule }) => {
          return choice.channelName;
        },
      ),
    ).toEqual(["Custom Channel", "Custom Channel"]);

    expect(
      chosen.map(
        (choice: { channelName: string; rule: UserNotificationRule }) => {
          return choice.rule.customNotificationChannelId?.toString();
        },
      ),
    ).toEqual([corpoApp.id!.toString(), pager.id!.toString()]);

    for (const choice of chosen) {
      expect(choice.rule.customNotificationChannel?.isEnabled).toBe(true);
      expect(choice.rule.userId?.toString()).toBe(USER_ID.toString());
      // An unsaved rule: the fallback never writes the person's rules.
      expect(choice.rule.id).toBeFalsy();
    }
  });

  test("a channel there costs nothing, so the paid channels are not reached for", async () => {
    noPersonalMethods();
    jest
      .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
      .mockResolvedValue([channelPagingEveryone("CorpoApp")]);

    const chosen: Array<{ channelName: string; rule: UserNotificationRule }> =
      await internals().chooseFallbackChannels(fallbackOptions());

    expect(chosen).toHaveLength(1);
  });
});

describe("a person joining a project", () => {
  test("gets every channel that pages everyone in their default rules", async () => {
    const corpoApp: CustomNotificationChannel = new CustomNotificationChannel();
    corpoApp._id = ObjectID.generate().toString();
    const pager: CustomNotificationChannel = new CustomNotificationChannel();
    pager._id = ObjectID.generate().toString();

    jest
      .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
      .mockResolvedValue([corpoApp, pager]);

    const addDefaults: jest.SpiedFunction<
      typeof UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod
    > = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined);

    await UserNotificationRuleService.addCustomChannelsPagingEveryoneForUser({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(addDefaults).toHaveBeenCalledTimes(2);
    expect(addDefaults.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      notificationMethod: { customNotificationChannelId: corpoApp.id },
    });
    expect(addDefaults.mock.calls[1]![0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      notificationMethod: { customNotificationChannelId: pager.id },
    });
  });

  test("a channel that cannot be added does not stop the others, nor the person joining", async () => {
    const first: CustomNotificationChannel = new CustomNotificationChannel();
    first._id = ObjectID.generate().toString();
    const second: CustomNotificationChannel = new CustomNotificationChannel();
    second._id = ObjectID.generate().toString();

    jest
      .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
      .mockResolvedValue([first, second]);

    const addDefaults: jest.SpiedFunction<
      typeof UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod
    > = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    await expect(
      UserNotificationRuleService.addCustomChannelsPagingEveryoneForUser({
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    ).resolves.toBeUndefined();

    expect(addDefaults).toHaveBeenCalledTimes(2);
  });

  test("channels that cannot be read do not stop the person joining", async () => {
    jest
      .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
      .mockRejectedValue(new Error("database down"));

    await expect(
      UserNotificationRuleService.addCustomChannelsPagingEveryoneForUser({
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("a default rule written for a channel points at the channel", async () => {
    jest
      .spyOn(
        UserNotificationRuleService as unknown as {
          getIncidentSeverityIds: () => Promise<Array<ObjectID>>;
        },
        "getIncidentSeverityIds",
      )
      .mockResolvedValue([ObjectID.generate()]);
    jest
      .spyOn(
        UserNotificationRuleService as unknown as {
          getAlertSeverityIds: () => Promise<Array<ObjectID>>;
        },
        "getAlertSeverityIds",
      )
      .mockResolvedValue([]);

    const existing: jest.SpiedFunction<
      typeof UserNotificationRuleService.findOneBy
    > = jest
      .spyOn(UserNotificationRuleService, "findOneBy")
      .mockResolvedValue(null);
    const create: jest.SpiedFunction<typeof UserNotificationRuleService.create> =
      jest
        .spyOn(UserNotificationRuleService, "create")
        .mockImplementation(async (data: { data: UserNotificationRule }) => {
          return data.data;
        });

    await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
      {
        projectId: PROJECT_ID,
        userId: USER_ID,
        notificationMethod: { customNotificationChannelId: CHANNEL_ID },
      },
    );

    expect(create.mock.calls.length).toBeGreaterThan(0);

    for (const call of create.mock.calls) {
      const rule: UserNotificationRule = (call[0] as {
        data: UserNotificationRule;
      }).data;
      expect(rule.customNotificationChannelId?.toString()).toBe(
        CHANNEL_ID.toString(),
      );
      expect(rule.userId?.toString()).toBe(USER_ID.toString());
    }

    // The duplicate check is keyed on the channel too.
    for (const call of existing.mock.calls) {
      const query: Record<string, unknown> = (
        call[0] as { query: Record<string, unknown> }
      ).query;
      expect((query["customNotificationChannelId"] as ObjectID).toString()).toBe(
        CHANNEL_ID.toString(),
      );
    }
  });

  test("an existing rule for the same channel, type and severity is never written twice", async () => {
    jest
      .spyOn(
        UserNotificationRuleService as unknown as {
          getIncidentSeverityIds: () => Promise<Array<ObjectID>>;
        },
        "getIncidentSeverityIds",
      )
      .mockResolvedValue([ObjectID.generate()]);
    jest
      .spyOn(
        UserNotificationRuleService as unknown as {
          getAlertSeverityIds: () => Promise<Array<ObjectID>>;
        },
        "getAlertSeverityIds",
      )
      .mockResolvedValue([ObjectID.generate()]);

    jest
      .spyOn(UserNotificationRuleService, "findOneBy")
      .mockResolvedValue(new UserNotificationRule());
    const create: jest.SpiedFunction<typeof UserNotificationRuleService.create> =
      jest.spyOn(UserNotificationRuleService, "create");

    await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
      {
        projectId: PROJECT_ID,
        userId: USER_ID,
        notificationMethod: { customNotificationChannelId: CHANNEL_ID },
      },
    );

    expect(create).not.toHaveBeenCalled();
  });
});
