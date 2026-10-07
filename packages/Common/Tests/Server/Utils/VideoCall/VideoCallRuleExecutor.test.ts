import AlertVideoCall from "../../../../Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import AlertVideoCallService from "../../../../Server/Services/AlertVideoCallService";
import IncidentVideoCallService from "../../../../Server/Services/IncidentVideoCallService";
import WorkspaceNotificationLogService, {
  WorkspaceLogData,
} from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import EventVideoCall, {
  VideoCallEvent,
  VideoCallEventType,
} from "../../../../Server/Utils/VideoCall/EventVideoCall";
import VideoCallRuleExecutor, {
  ExistingVideoCall,
  VideoCallRequest,
} from "../../../../Server/Utils/VideoCall/VideoCallRuleExecutor";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { WorkspaceChannel } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import BaseNotificationRule from "../../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { SLACK_HUDDLE_VIDEO_CALL_SOURCE } from "../../../../Types/Workspace/NotificationRules/VideoCallNotificationRule";
import WorkspaceNotificationActionType from "../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The calls the workspace rules ask for when an incident or alert is
 * created. What matters, in order:
 *
 *   - a rule fires on its own conditions and starts the call it names;
 *   - one call per source per event, however many rules name it, and never
 *     a second one for a source that already has a call;
 *   - a Slack huddle is held in the channel the rule created for the
 *     event, else in an existing channel the rule posts to;
 *   - a call that cannot start is reported - notification log and feed -
 *     and never stops the event's other calls, nor the event itself.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const ZOOM_CONNECTION_ID: ObjectID = ObjectID.generate();
const TEAMS_CONNECTION_ID: ObjectID = ObjectID.generate();

function makeRule(data: {
  name: string;
  workspaceType?: WorkspaceType;
  source?: string | undefined;
  shouldStartVideoCall?: boolean;
  existingChannelNames?: string;
}): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule(
    ObjectID.generate(),
  );
  rule.name = data.name;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = data.workspaceType || WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.Incident;
  rule.notificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: Boolean(data.existingChannelNames),
    existingChannelNames: data.existingChannelNames || "",
    shouldStartVideoCall: data.shouldStartVideoCall !== false,
    videoCallSource: data.source,
  } as BaseNotificationRule;
  return rule;
}

function makeEvent(
  channels: Array<NotificationRuleWorkspaceChannel> = [],
): VideoCallEvent {
  return {
    type: VideoCallEventType.Incident,
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    numberDisplay: "INC-42",
    title: "Down",
    isPrivate: false,
    link: "https://oneuptime.com/i",
    workspaceChannels: channels,
  };
}

interface Stubs {
  create: SpyInstance<typeof IncidentVideoCallService.create>;
  log: SpyInstance<typeof WorkspaceNotificationLogService.createWorkspaceLog>;
  announceFailure: SpyInstance<typeof EventVideoCall.announceFailure>;
}

function stub(data: {
  slackRules?: Array<WorkspaceNotificationRule>;
  teamsRules?: Array<WorkspaceNotificationRule>;
  event?: VideoCallEvent;
  existingCalls?: Array<IncidentVideoCall>;
  slackTeamId?: string | null;
  createImplementation?: (
    call: IncidentVideoCall,
  ) => Promise<IncidentVideoCall>;
}): Stubs {
  jest
    .spyOn(EventVideoCall, "getEvent")
    .mockResolvedValue(data.event || makeEvent());

  jest
    .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
    .mockImplementation(
      async (args: {
        workspaceType: WorkspaceType;
      }): Promise<Array<WorkspaceNotificationRule>> => {
        return args.workspaceType === WorkspaceType.Slack
          ? data.slackRules || []
          : data.teamsRules || [];
      },
    );

  jest
    .spyOn(IncidentVideoCallService, "getCallsForIncident")
    .mockResolvedValue(data.existingCalls || []);

  jest
    .spyOn(EventVideoCall, "getSlackTeamId")
    .mockResolvedValue(
      data.slackTeamId === undefined ? "T0ACME" : data.slackTeamId,
    );

  const create: SpyInstance<typeof IncidentVideoCallService.create> = jest
    .spyOn(IncidentVideoCallService, "create")
    .mockImplementation(
      async (createBy: {
        data: IncidentVideoCall;
      }): Promise<IncidentVideoCall> => {
        if (data.createImplementation) {
          return await data.createImplementation(createBy.data);
        }

        const created: IncidentVideoCall = createBy.data;
        created.id = ObjectID.generate();

        if (!created.joinUrl) {
          created.joinUrl = "https://zoom.us/j/1";
          created.provider = VideoCallProvider.Zoom;
        }

        return created;
      },
    ) as SpyInstance<typeof IncidentVideoCallService.create>;

  const log: SpyInstance<
    typeof WorkspaceNotificationLogService.createWorkspaceLog
  > = jest
    .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
    .mockResolvedValue(new WorkspaceNotificationLog());

  const announceFailure: SpyInstance<typeof EventVideoCall.announceFailure> =
    jest.spyOn(EventVideoCall, "announceFailure").mockResolvedValue(undefined);

  return { create, log, announceFailure };
}

function createdCalls(stubs: Stubs): Array<IncidentVideoCall> {
  return stubs.create.mock.calls.map(
    (call: Parameters<typeof IncidentVideoCallService.create>) => {
      return call[0].data;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VideoCallRuleExecutor.startCallsForIncident", () => {
  test("starts the call a matching rule names, as OneUptime, crediting the rule", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      name: "Sev1 bridge",
      source: ZOOM_CONNECTION_ID.toString(),
    });
    const stubs: Stubs = stub({ slackRules: [rule] });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).toHaveBeenCalledTimes(1);
    expect(stubs.create.mock.calls[0]![0].props).toEqual({ isRoot: true });

    const call: IncidentVideoCall = createdCalls(stubs)[0]!;
    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.incidentId).toBe(INCIDENT_ID);
    expect(call.videoCallConnectionId?.toString()).toBe(
      ZOOM_CONNECTION_ID.toString(),
    );
    expect(call.workspaceNotificationRuleId?.toString()).toBe(
      rule.id!.toString(),
    );

    const log: WorkspaceLogData = stubs.log.mock.calls[0]![0];
    expect(log.actionType).toBe(WorkspaceNotificationActionType.StartVideoCall);
    expect(log.status).toBe(WorkspaceNotificationStatus.Success);
    expect(log.incidentId).toBe(INCIDENT_ID);
    expect(log.message).toContain("**Sev1 bridge**");
    expect(stubs.announceFailure).not.toHaveBeenCalled();
  });

  test("starts nothing when no rule asks for a call", async () => {
    const stubs: Stubs = stub({
      slackRules: [
        makeRule({ name: "No call", source: undefined }),
        makeRule({
          name: "Switched off",
          source: ZOOM_CONNECTION_ID.toString(),
          shouldStartVideoCall: false,
        }),
      ],
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).not.toHaveBeenCalled();
    expect(stubs.log).not.toHaveBeenCalled();
  });

  test("starts one call for a connection however many rules name it", async () => {
    const stubs: Stubs = stub({
      slackRules: [
        makeRule({ name: "A", source: ZOOM_CONNECTION_ID.toString() }),
        makeRule({ name: "B", source: ZOOM_CONNECTION_ID.toString() }),
      ],
      teamsRules: [
        makeRule({
          name: "C",
          workspaceType: WorkspaceType.MicrosoftTeams,
          source: ZOOM_CONNECTION_ID.toString(),
        }),
      ],
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).toHaveBeenCalledTimes(1);
  });

  test("starts a call per connection: a Zoom meeting for Slack, a Teams meeting for Teams", async () => {
    const stubs: Stubs = stub({
      slackRules: [
        makeRule({ name: "A", source: ZOOM_CONNECTION_ID.toString() }),
      ],
      teamsRules: [
        makeRule({
          name: "B",
          workspaceType: WorkspaceType.MicrosoftTeams,
          source: TEAMS_CONNECTION_ID.toString(),
        }),
      ],
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(
      createdCalls(stubs).map((call: IncidentVideoCall) => {
        return call.videoCallConnectionId?.toString();
      }),
    ).toEqual([ZOOM_CONNECTION_ID.toString(), TEAMS_CONNECTION_ID.toString()]);
  });

  test("never starts a second call for a connection the incident already has one from", async () => {
    const existing: IncidentVideoCall = new IncidentVideoCall();
    existing.videoCallConnectionId = ZOOM_CONNECTION_ID;
    existing.provider = VideoCallProvider.Zoom;
    existing.joinUrl = "https://zoom.us/j/1";

    const stubs: Stubs = stub({
      slackRules: [
        makeRule({ name: "A", source: ZOOM_CONNECTION_ID.toString() }),
      ],
      existingCalls: [existing],
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).not.toHaveBeenCalled();
  });

  test("holds a Slack huddle in the channel the rule created for the incident", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      name: "Huddle",
      source: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
    });

    const stubs: Stubs = stub({
      slackRules: [rule],
      event: makeEvent([
        {
          id: "C0OTHERRULE",
          name: "other",
          workspaceType: WorkspaceType.Slack,
          notificationRuleId: ObjectID.generate().toString(),
        },
        {
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          notificationRuleId: rule.id!.toString(),
        },
      ]),
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    const call: IncidentVideoCall = createdCalls(stubs)[0]!;
    expect(call.provider).toBe(VideoCallProvider.SlackHuddle);
    expect(call.joinUrl).toBe("https://app.slack.com/huddle/T0ACME/C0INC42");
    expect(call.externalMeetingId).toBe("C0INC42");
    expect(call.videoCallConnectionId).toBe(undefined);
  });

  test("holds a huddle in the rule's existing channel when it created none", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      name: "Huddle",
      source: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
      existingChannelNames: "#incidents, #ops",
    });
    const stubs: Stubs = stub({ slackRules: [rule] });

    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.authToken = "xoxb-token";
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth);

    const lookup: SpyInstance<typeof SlackUtil.getWorkspaceChannelByName> = jest
      .spyOn(SlackUtil, "getWorkspaceChannelByName")
      .mockImplementation(
        async (args: {
          channelName: string;
        }): Promise<WorkspaceChannel | null> => {
          return args.channelName === "#incidents"
            ? {
                id: "C0INCIDENTS",
                name: "incidents",
                workspaceType: WorkspaceType.Slack,
              }
            : null;
        },
      );

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(lookup.mock.calls[0]![0]).toEqual({
      authToken: "xoxb-token",
      channelName: "#incidents",
      projectId: PROJECT_ID,
    });
    expect(createdCalls(stubs)[0]!.joinUrl).toBe(
      "https://app.slack.com/huddle/T0ACME/C0INCIDENTS",
    );
  });

  test("never starts a huddle twice for the same channel", async () => {
    const rule: WorkspaceNotificationRule = makeRule({
      name: "Huddle",
      source: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
    });

    const existing: IncidentVideoCall = new IncidentVideoCall();
    existing.provider = VideoCallProvider.SlackHuddle;
    existing.joinUrl = "https://app.slack.com/huddle/T0ACME/C0INC42";

    const stubs: Stubs = stub({
      slackRules: [rule],
      existingCalls: [existing],
      event: makeEvent([
        {
          id: "C0INC42",
          name: "inc-42",
          workspaceType: WorkspaceType.Slack,
          notificationRuleId: rule.id!.toString(),
        },
      ]),
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).not.toHaveBeenCalled();
  });

  test("reports a huddle a Microsoft Teams rule asks for, and starts the other calls", async () => {
    const stubs: Stubs = stub({
      slackRules: [
        makeRule({ name: "Zoom", source: ZOOM_CONNECTION_ID.toString() }),
      ],
      teamsRules: [
        makeRule({
          name: "Teams huddle",
          workspaceType: WorkspaceType.MicrosoftTeams,
          source: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
        }),
      ],
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).toHaveBeenCalledTimes(1);

    const errorLog: WorkspaceLogData | undefined = stubs.log.mock.calls
      .map(
        (
          call: Parameters<
            typeof WorkspaceNotificationLogService.createWorkspaceLog
          >,
        ) => {
          return call[0];
        },
      )
      .find((log: WorkspaceLogData) => {
        return log.status === WorkspaceNotificationStatus.Error;
      });

    expect(errorLog?.statusMessage).toBe(
      "A Slack huddle can only be started by a Slack notification rule.",
    );
    expect(errorLog?.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(stubs.announceFailure).toHaveBeenCalledWith({
      eventType: VideoCallEventType.Incident,
      eventId: INCIDENT_ID,
      projectId: PROJECT_ID,
      ruleName: "Teams huddle",
      error: "A Slack huddle can only be started by a Slack notification rule.",
    });
  });

  test("reports a huddle with no channel to hold it in", async () => {
    const stubs: Stubs = stub({
      slackRules: [
        makeRule({ name: "Huddle", source: SLACK_HUDDLE_VIDEO_CALL_SOURCE }),
      ],
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).not.toHaveBeenCalled();
    expect(stubs.announceFailure.mock.calls[0]![0].error).toContain(
      "no channel to hold the huddle in",
    );
  });

  test("reports a rule that names a connection id that cannot exist", async () => {
    const stubs: Stubs = stub({
      slackRules: [makeRule({ name: "Broken", source: "not-a-connection" })],
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).not.toHaveBeenCalled();
    expect(stubs.announceFailure.mock.calls[0]![0].error).toContain(
      "names a video call connection that does not exist",
    );
  });

  test("reports a provider failure and still starts the next call", async () => {
    const stubs: Stubs = stub({
      slackRules: [
        makeRule({ name: "Zoom", source: ZOOM_CONNECTION_ID.toString() }),
      ],
      teamsRules: [
        makeRule({
          name: "Teams",
          workspaceType: WorkspaceType.MicrosoftTeams,
          source: TEAMS_CONNECTION_ID.toString(),
        }),
      ],
      createImplementation: async (
        call: IncidentVideoCall,
      ): Promise<IncidentVideoCall> => {
        if (
          call.videoCallConnectionId?.toString() ===
          ZOOM_CONNECTION_ID.toString()
        ) {
          throw new Error("Zoom has no user incidents@acme.com");
        }

        call.provider = VideoCallProvider.MicrosoftTeams;
        call.joinUrl = "https://teams.microsoft.com/l/meetup-join/x";
        return call;
      },
    });

    await VideoCallRuleExecutor.startCallsForIncident({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(stubs.create).toHaveBeenCalledTimes(2);

    const statuses: Array<WorkspaceNotificationStatus> =
      stubs.log.mock.calls.map(
        (
          call: Parameters<
            typeof WorkspaceNotificationLogService.createWorkspaceLog
          >,
        ) => {
          return call[0].status;
        },
      );
    expect(statuses).toEqual([
      WorkspaceNotificationStatus.Error,
      WorkspaceNotificationStatus.Success,
    ]);
    expect(stubs.announceFailure.mock.calls[0]![0].error).toBe(
      "Zoom has no user incidents@acme.com",
    );
  });

  test("never throws, so the incident's creation never fails on a call", async () => {
    jest
      .spyOn(EventVideoCall, "getEvent")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      VideoCallRuleExecutor.startCallsForIncident({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).resolves.toBe(undefined);
  });
});

describe("VideoCallRuleExecutor.startCallsForAlert", () => {
  test("starts an alert's call with the alert's rules and service", async () => {
    const alertId: ObjectID = ObjectID.generate();
    const rule: WorkspaceNotificationRule = makeRule({
      name: "Alert bridge",
      source: ZOOM_CONNECTION_ID.toString(),
    });

    jest.spyOn(EventVideoCall, "getEvent").mockResolvedValue({
      ...makeEvent(),
      type: VideoCallEventType.Alert,
      id: alertId,
    });

    const getRules: SpyInstance<
      typeof WorkspaceNotificationRuleService.getMatchingNotificationRules
    > = jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([rule]);

    jest.spyOn(AlertVideoCallService, "getCallsForAlert").mockResolvedValue([]);
    jest
      .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
      .mockResolvedValue(new WorkspaceNotificationLog());

    const create: SpyInstance<typeof AlertVideoCallService.create> = jest
      .spyOn(AlertVideoCallService, "create")
      .mockImplementation(
        async (createBy: { data: AlertVideoCall }): Promise<AlertVideoCall> => {
          return createBy.data;
        },
      ) as SpyInstance<typeof AlertVideoCallService.create>;

    await VideoCallRuleExecutor.startCallsForAlert({
      projectId: PROJECT_ID,
      alertId,
    });

    expect(getRules.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      notificationRuleEventType: NotificationRuleEventType.Alert,
      notificationFor: { alertId },
    });

    const call: AlertVideoCall = create.mock.calls[0]![0].data;
    expect(call.alertId).toBe(alertId);
    expect(call.videoCallConnectionId?.toString()).toBe(
      ZOOM_CONNECTION_ID.toString(),
    );
  });
});

describe("VideoCallRuleExecutor.dedupe", () => {
  function request(
    source: string,
    overrides?: Partial<VideoCallRequest>,
  ): VideoCallRequest {
    return {
      source,
      ruleId: ObjectID.generate(),
      ruleName: "r",
      workspaceType: WorkspaceType.Slack,
      ...overrides,
    };
  }

  test("keeps the first request per connection and per huddle channel", () => {
    const channel: WorkspaceChannel = {
      id: "C1",
      name: "c",
      workspaceType: WorkspaceType.Slack,
    };

    const requests: Array<VideoCallRequest> = [
      request("a"),
      request("a"),
      request(SLACK_HUDDLE_VIDEO_CALL_SOURCE, { slackChannel: channel }),
      request(SLACK_HUDDLE_VIDEO_CALL_SOURCE, { slackChannel: channel }),
      request(SLACK_HUDDLE_VIDEO_CALL_SOURCE, {
        slackChannel: { ...channel, id: "C2" },
      }),
      request("b"),
    ];

    expect(VideoCallRuleExecutor.dedupe(requests)).toEqual([
      requests[0],
      requests[2],
      requests[4],
      requests[5],
    ]);
  });

  test("keeps every failed request, so each failure is reported", () => {
    const requests: Array<VideoCallRequest> = [
      request(SLACK_HUDDLE_VIDEO_CALL_SOURCE, { error: "x" }),
      request(SLACK_HUDDLE_VIDEO_CALL_SOURCE, { error: "y" }),
    ];

    expect(VideoCallRuleExecutor.dedupe(requests)).toHaveLength(2);
  });
});

describe("VideoCallRuleExecutor.hasCallFor", () => {
  const existing: Array<ExistingVideoCall> = [
    {
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/1",
      videoCallConnectionId: ZOOM_CONNECTION_ID,
    },
    {
      provider: VideoCallProvider.SlackHuddle,
      joinUrl: "https://app.slack.com/huddle/T1/C1",
    },
  ];

  function request(source: string): VideoCallRequest {
    return {
      source,
      ruleId: ObjectID.generate(),
      ruleName: "r",
      workspaceType: WorkspaceType.Slack,
    };
  }

  test("matches a connection by id", () => {
    expect(
      VideoCallRuleExecutor.hasCallFor({
        request: request(ZOOM_CONNECTION_ID.toString()),
        existingCalls: existing,
      }),
    ).toBe(true);
    expect(
      VideoCallRuleExecutor.hasCallFor({
        request: request(TEAMS_CONNECTION_ID.toString()),
        existingCalls: existing,
      }),
    ).toBe(false);
  });

  test("matches a huddle by its channel's link", () => {
    expect(
      VideoCallRuleExecutor.hasCallFor({
        request: request(SLACK_HUDDLE_VIDEO_CALL_SOURCE),
        existingCalls: existing,
        huddleJoinUrl: "https://app.slack.com/huddle/T1/C1",
      }),
    ).toBe(true);
    expect(
      VideoCallRuleExecutor.hasCallFor({
        request: request(SLACK_HUDDLE_VIDEO_CALL_SOURCE),
        existingCalls: existing,
        huddleJoinUrl: "https://app.slack.com/huddle/T1/C2",
      }),
    ).toBe(false);
  });
});
