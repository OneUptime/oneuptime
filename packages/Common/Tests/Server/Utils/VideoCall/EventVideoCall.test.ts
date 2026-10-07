import Alert from "../../../../Models/DatabaseModels/Alert";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import VideoCallConnection from "../../../../Models/DatabaseModels/VideoCallConnection";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import VideoCallConnectionService from "../../../../Server/Services/VideoCallConnectionService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import EventVideoCall, {
  VideoCallEvent,
  VideoCallEventType,
  VideoCallFieldTarget,
  VideoCallFields,
} from "../../../../Server/Utils/VideoCall/EventVideoCall";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * How an incident's or alert's call is filled in before it is saved, and
 * how it is announced after.
 *
 * The rule under test above all: for a call from a connection or a Slack
 * huddle, OneUptime decides the provider, the join link and the meeting id.
 * A request may add a link of its own, but it can never present that link
 * as the incident's Zoom meeting or its Slack huddle, and it can never claim
 * a call was started by a workspace rule.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: ObjectID = ObjectID.generate();
const RULE_ID: ObjectID = ObjectID.generate();
const EVENT_LINK: string = `https://oneuptime.com/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

function makeEvent(overrides?: Partial<VideoCallEvent>): VideoCallEvent {
  return {
    type: VideoCallEventType.Incident,
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    numberDisplay: "INC-42",
    title: "Checkout API is down",
    isPrivate: false,
    link: EVENT_LINK,
    workspaceChannels: [],
    ...overrides,
  };
}

function connection(name: string): VideoCallConnection {
  const model: VideoCallConnection = new VideoCallConnection(CONNECTION_ID);
  model.name = name;
  return model;
}

function stubSlackAuth(
  teamId: string | null,
): SpyInstance<typeof WorkspaceProjectAuthTokenService.getProjectAuth> {
  let auth: WorkspaceProjectAuthToken | null = null;

  if (teamId) {
    auth = new WorkspaceProjectAuthToken();
    auth.workspaceProjectId = teamId;
    auth.miscData = {
      teamId: teamId,
      teamName: "Acme",
      botUserId: "U1",
    } as SlackMiscData;
  }

  return jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(auth);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("EventVideoCall.prepare", () => {
  test("starts a meeting with a connection, named for the incident", async () => {
    const startMeeting: SpyInstance<
      typeof VideoCallConnectionService.startMeeting
    > = jest
      .spyOn(VideoCallConnectionService, "startMeeting")
      .mockResolvedValue({
        meeting: {
          provider: VideoCallProvider.Zoom,
          joinUrl: "https://zoom.us/j/1?pwd=x",
          externalMeetingId: "1",
        },
        connection: connection("Incident Zoom"),
      });

    const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
      await EventVideoCall.prepare({
        event: makeEvent(),
        isServerWrite: false,
        fields: { videoCallConnectionId: CONNECTION_ID },
      });

    expect(startMeeting).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      projectId: PROJECT_ID,
      request: {
        title: "INC-42: Checkout API is down",
        description: `Video call for incident INC-42, started by OneUptime. Incident details: ${EVENT_LINK}`,
      },
    });

    expect(prepared.fields).toEqual({
      videoCallConnectionId: CONNECTION_ID,
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/1?pwd=x",
      externalMeetingId: "1",
      title: "INC-42: Checkout API is down",
      workspaceNotificationRuleId: undefined,
    });
    expect(prepared.carryForward).toEqual({ connectionName: "Incident Zoom" });
  });

  test("keeps a private incident's title out of the meeting", async () => {
    const startMeeting: SpyInstance<
      typeof VideoCallConnectionService.startMeeting
    > = jest
      .spyOn(VideoCallConnectionService, "startMeeting")
      .mockResolvedValue({
        meeting: {
          provider: VideoCallProvider.MicrosoftTeams,
          joinUrl: "https://teams.microsoft.com/l/meetup-join/x",
        },
        connection: connection("Teams"),
      });

    const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
      await EventVideoCall.prepare({
        event: makeEvent({ isPrivate: true }),
        isServerWrite: true,
        fields: { videoCallConnectionId: CONNECTION_ID },
      });

    const request: { title: string; description?: string | undefined } =
      startMeeting.mock.calls[0]![0].request;

    expect(request.title).toBe("Incident INC-42");
    expect(request.description).not.toContain("Checkout");
    expect(prepared.fields.title).toBe("Incident INC-42");
  });

  test("a standing link is named for its connection", async () => {
    jest.spyOn(VideoCallConnectionService, "startMeeting").mockResolvedValue({
      meeting: {
        provider: VideoCallProvider.CustomLink,
        joinUrl: "https://acme.webex.com/meet/bridge",
      },
      connection: connection("Major incident bridge"),
    });

    const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
      await EventVideoCall.prepare({
        event: makeEvent(),
        isServerWrite: false,
        fields: { videoCallConnectionId: CONNECTION_ID },
      });

    expect(prepared.fields.provider).toBe(VideoCallProvider.CustomLink);
    expect(prepared.fields.title).toBe("Major incident bridge");
  });

  test("a request cannot choose the join link or the meeting id of a connection's call", async () => {
    jest.spyOn(VideoCallConnectionService, "startMeeting").mockResolvedValue({
      meeting: {
        provider: VideoCallProvider.Zoom,
        joinUrl: "https://zoom.us/j/real",
        externalMeetingId: "real",
      },
      connection: connection("Zoom"),
    });

    const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
      await EventVideoCall.prepare({
        event: makeEvent(),
        isServerWrite: false,
        fields: {
          videoCallConnectionId: CONNECTION_ID,
          provider: VideoCallProvider.SlackHuddle,
          joinUrl: "https://phishing.example.com",
          externalMeetingId: "spoofed",
          workspaceNotificationRuleId: RULE_ID,
        },
      });

    expect(prepared.fields.provider).toBe(VideoCallProvider.Zoom);
    expect(prepared.fields.joinUrl).toBe("https://zoom.us/j/real");
    expect(prepared.fields.externalMeetingId).toBe("real");
    // Only OneUptime's own writes name the rule that started a call.
    expect(prepared.fields.workspaceNotificationRuleId).toBe(undefined);
  });

  test("a server write keeps the rule that started the call", async () => {
    jest.spyOn(VideoCallConnectionService, "startMeeting").mockResolvedValue({
      meeting: {
        provider: VideoCallProvider.GoogleMeet,
        joinUrl: "https://meet.google.com/abc-defg-hij",
        externalMeetingId: "spaces/x",
      },
      connection: connection("Meet"),
    });

    const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
      await EventVideoCall.prepare({
        event: makeEvent(),
        isServerWrite: true,
        fields: {
          videoCallConnectionId: CONNECTION_ID,
          workspaceNotificationRuleId: RULE_ID,
        },
      });

    expect(prepared.fields.workspaceNotificationRuleId).toBe(RULE_ID);
  });

  test("passes a provider failure through, so the request says why", async () => {
    jest
      .spyOn(VideoCallConnectionService, "startMeeting")
      .mockRejectedValue(new BadDataException("Zoom has no user x"));

    await expect(
      EventVideoCall.prepare({
        event: makeEvent(),
        isServerWrite: false,
        fields: { videoCallConnectionId: CONNECTION_ID },
      }),
    ).rejects.toThrow("Zoom has no user x");
  });

  describe("a Slack huddle", () => {
    const slackChannel: {
      id: string;
      name: string;
      workspaceType: WorkspaceType;
      notificationRuleId: string;
    } = {
      id: "C0INCIDENT",
      name: "inc-42",
      workspaceType: WorkspaceType.Slack,
      notificationRuleId: RULE_ID.toString(),
    };

    test("is the huddle of the incident's Slack channel", async () => {
      stubSlackAuth("T0ACME");

      const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
        await EventVideoCall.prepare({
          event: makeEvent({
            workspaceChannels: [
              {
                id: "19:teams@thread.tacv2",
                name: "inc-42",
                workspaceType: WorkspaceType.MicrosoftTeams,
                notificationRuleId: "x",
              },
              slackChannel,
            ],
          }),
          isServerWrite: false,
          fields: {
            provider: VideoCallProvider.SlackHuddle,
            joinUrl: "https://phishing.example.com",
          },
        });

      expect(prepared.fields).toEqual({
        provider: VideoCallProvider.SlackHuddle,
        joinUrl: "https://app.slack.com/huddle/T0ACME/C0INCIDENT",
        externalMeetingId: "C0INCIDENT",
        title: "Slack huddle",
        workspaceNotificationRuleId: undefined,
      });
    });

    test("needs a Slack channel", async () => {
      stubSlackAuth("T0ACME");

      await expect(
        EventVideoCall.prepare({
          event: makeEvent(),
          isServerWrite: false,
          fields: { provider: VideoCallProvider.SlackHuddle },
        }),
      ).rejects.toThrow("This incident has no Slack channel.");
    });

    test("needs Slack to be connected", async () => {
      stubSlackAuth(null);

      await expect(
        EventVideoCall.prepare({
          event: makeEvent({ workspaceChannels: [slackChannel] }),
          isServerWrite: false,
          fields: { provider: VideoCallProvider.SlackHuddle },
        }),
      ).rejects.toThrow("Slack is not connected to this project.");
    });

    test("from the rule executor keeps the link it built, when it is a huddle link", async () => {
      const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
        await EventVideoCall.prepare({
          event: makeEvent(),
          isServerWrite: true,
          fields: {
            provider: VideoCallProvider.SlackHuddle,
            joinUrl: "https://app.slack.com/huddle/T1/C2",
            externalMeetingId: "C2",
            workspaceNotificationRuleId: RULE_ID,
          },
        });

      expect(prepared.fields).toEqual({
        provider: VideoCallProvider.SlackHuddle,
        joinUrl: "https://app.slack.com/huddle/T1/C2",
        externalMeetingId: "C2",
        workspaceNotificationRuleId: RULE_ID,
        title: "Slack huddle",
      });
    });

    test("from the rule executor refuses a link that is not a huddle's", async () => {
      await expect(
        EventVideoCall.prepare({
          event: makeEvent(),
          isServerWrite: true,
          fields: {
            provider: VideoCallProvider.SlackHuddle,
            joinUrl: "https://zoom.us/j/1",
          },
        }),
      ).rejects.toThrow("must be a Slack huddle link");
    });
  });

  describe("a link of one's own", () => {
    test("is saved as a custom link with its title", async () => {
      const prepared: Awaited<ReturnType<typeof EventVideoCall.prepare>> =
        await EventVideoCall.prepare({
          event: makeEvent(),
          isServerWrite: false,
          fields: {
            joinUrl: "  https://acme.zoom.us/j/999  ",
            title: "  War   room ",
          },
        });

      expect(prepared.fields).toEqual({
        provider: VideoCallProvider.CustomLink,
        joinUrl: "https://acme.zoom.us/j/999",
        title: "War room",
        externalMeetingId: undefined,
        workspaceNotificationRuleId: undefined,
      });
    });

    test("cannot claim to be a provider's meeting", async () => {
      await expect(
        EventVideoCall.prepare({
          event: makeEvent(),
          isServerWrite: false,
          fields: {
            provider: VideoCallProvider.Zoom,
            joinUrl: "https://acme.zoom.us/j/999",
          },
        }),
      ).rejects.toThrow("pick one of the project's video call connections");
    });

    test.each([
      ["no link", undefined, "Join link is required."],
      ["an http link", "http://acme.zoom.us/j/1", "must be an https link"],
      ["a javascript: link", "javascript:alert(1)", "must be an https link"],
    ])(
      "refuses %s",
      async (_label: string, joinUrl: string | undefined, expected: string) => {
        await expect(
          EventVideoCall.prepare({
            event: makeEvent(),
            isServerWrite: false,
            fields: joinUrl ? { joinUrl } : {},
          }),
        ).rejects.toThrow(expected);
      },
    );

    test("refuses a provider that does not exist", async () => {
      await expect(
        EventVideoCall.prepare({
          event: makeEvent(),
          isServerWrite: false,
          fields: {
            provider: "Webex" as VideoCallProvider,
            joinUrl: "https://acme.webex.com/x",
          },
        }),
      ).rejects.toThrow("Provider must be one of");
    });
  });
});

describe("EventVideoCall.applyFields", () => {
  test("sets what is given and removes what is not", () => {
    const target: VideoCallFieldTarget = {
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://old.example.com",
      externalMeetingId: "old",
      workspaceNotificationRuleId: RULE_ID,
    };

    const fields: VideoCallFields = {
      provider: VideoCallProvider.CustomLink,
      joinUrl: "https://new.example.com",
      title: "War room",
    };

    EventVideoCall.applyFields(target, fields);

    expect(target).toEqual({
      provider: VideoCallProvider.CustomLink,
      joinUrl: "https://new.example.com",
      title: "War room",
    });
    expect(Object.keys(target)).not.toContain("externalMeetingId");
    expect(Object.keys(target)).not.toContain("workspaceNotificationRuleId");
  });
});

describe("EventVideoCall.truncateTitle", () => {
  test("trims, collapses whitespace and cuts at the column's width", () => {
    expect(EventVideoCall.truncateTitle("  a \n b  ")).toBe("a b");
    expect(EventVideoCall.truncateTitle("   ")).toBe(undefined);
    expect(EventVideoCall.truncateTitle(undefined)).toBe(undefined);

    const cut: string | undefined = EventVideoCall.truncateTitle(
      "x".repeat(600),
    );
    expect(cut?.length).toBe(500);
    expect(cut?.endsWith("…")).toBe(true);
  });
});

describe("EventVideoCall.assertCallerCanSeeEvent", () => {
  test("lets OneUptime's own writes through without a read", async () => {
    const find: SpyInstance<typeof IncidentService.findOneById> = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(null);

    await EventVideoCall.assertCallerCanSeeEvent({
      type: VideoCallEventType.Incident,
      id: INCIDENT_ID,
      props: { isRoot: true },
    });

    expect(find).not.toHaveBeenCalled();
  });

  test("reads the incident with the caller's own permissions", async () => {
    const find: SpyInstance<typeof IncidentService.findOneById> = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(new Incident(INCIDENT_ID));

    const props: { tenantId: ObjectID; userId: ObjectID } = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };

    await EventVideoCall.assertCallerCanSeeEvent({
      type: VideoCallEventType.Incident,
      id: INCIDENT_ID,
      props,
    });

    expect(find).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      select: { _id: true },
      props,
    });
  });

  test("refuses a private incident the caller cannot see, as if it did not exist", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    await expect(
      EventVideoCall.assertCallerCanSeeEvent({
        type: VideoCallEventType.Incident,
        id: INCIDENT_ID,
        props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      }),
    ).rejects.toThrow("Incident not found.");
  });

  test("checks an alert as an alert", async () => {
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null);

    await expect(
      EventVideoCall.assertCallerCanSeeEvent({
        type: VideoCallEventType.Alert,
        id: ObjectID.generate(),
        props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      }),
    ).rejects.toThrow("Alert not found.");
  });
});

describe("EventVideoCall.getEvent", () => {
  test("reads an incident's number, title, privacy, link and channels", async () => {
    const incident: Incident = new Incident(INCIDENT_ID);
    incident.projectId = PROJECT_ID;
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    incident.title = "Down";
    incident.isPrivate = true;
    incident.postUpdatesToWorkspaceChannels = [
      {
        id: "C1",
        name: "inc-42",
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: "r",
      },
    ];

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString(EVENT_LINK));

    expect(
      await EventVideoCall.getEvent({
        type: VideoCallEventType.Incident,
        id: INCIDENT_ID,
      }),
    ).toEqual({
      type: VideoCallEventType.Incident,
      id: INCIDENT_ID,
      projectId: PROJECT_ID,
      numberDisplay: "INC-42",
      title: "Down",
      isPrivate: true,
      link: EVENT_LINK,
      workspaceChannels: incident.postUpdatesToWorkspaceChannels,
    });
  });

  test("falls back to #number for an alert without a prefix", async () => {
    const alert: Alert = new Alert(ObjectID.generate());
    alert.projectId = PROJECT_ID;
    alert.alertNumber = 7;

    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.com/a"));

    const event: VideoCallEvent = await EventVideoCall.getEvent({
      type: VideoCallEventType.Alert,
      id: alert.id!,
    });

    expect(event.numberDisplay).toBe("#7");
    expect(event.isPrivate).toBe(false);
    expect(event.workspaceChannels).toEqual([]);
  });

  test("refuses an event that does not exist", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    await expect(
      EventVideoCall.getEvent({
        type: VideoCallEventType.Incident,
        id: INCIDENT_ID,
      }),
    ).rejects.toThrow("Incident not found.");
  });
});

describe("EventVideoCall.announce", () => {
  function stubIncident(): void {
    const incident: Incident = new Incident(INCIDENT_ID);
    incident.projectId = PROJECT_ID;
    incident.incidentNumberWithPrefix = "INC-42";

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString(EVENT_LINK));
  }

  test("posts the call to the incident's feed and channels, with a Join call button", async () => {
    stubIncident();

    const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    rule.name = "Sev1 bridge";
    jest
      .spyOn(WorkspaceNotificationRuleService, "findOneById")
      .mockResolvedValue(rule);

    const createFeedItem: SpyInstance<
      typeof IncidentFeedService.createIncidentFeedItem
    > = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined);

    await EventVideoCall.announce({
      eventType: VideoCallEventType.Incident,
      eventId: INCIDENT_ID,
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/1",
      connectionName: "Incident Zoom",
      workspaceNotificationRuleId: RULE_ID,
    });

    expect(createFeedItem).toHaveBeenCalledTimes(1);

    const item: JSONObject = createFeedItem.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(item["incidentId"]).toBe(INCIDENT_ID);
    expect(item["projectId"]).toBe(PROJECT_ID);
    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallStarted,
    );
    expect(item["feedInfoInMarkdown"]).toContain(
      "📞 A **Zoom meeting** was started for [Incident INC\\-42]",
    );
    expect(item["feedInfoInMarkdown"]).toContain(
      "**[Join the call](https://zoom.us/j/1)**",
    );
    expect(item["moreInformationInMarkdown"]).toContain("**Sev1 bridge**");
    expect(item["userId"]).toBe(undefined);

    const workspaceNotification: JSONObject = item[
      "workspaceNotification"
    ] as JSONObject;
    expect(workspaceNotification["sendWorkspaceNotification"]).toBe(true);
    expect(
      (workspaceNotification["appendMessageBlocks"] as Array<JSONObject>)
        .length,
    ).toBe(2);
  });

  test("credits the person who started the call, in Slack too", async () => {
    stubIncident();

    const createFeedItem: SpyInstance<
      typeof IncidentFeedService.createIncidentFeedItem
    > = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined);

    const userId: ObjectID = ObjectID.generate();

    await EventVideoCall.announce({
      eventType: VideoCallEventType.Incident,
      eventId: INCIDENT_ID,
      provider: VideoCallProvider.CustomLink,
      joinUrl: "https://acme.webex.com/x",
      title: "War room",
      userId,
    });

    const item: JSONObject = createFeedItem.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(item["userId"]).toBe(userId);
    expect((item["workspaceNotification"] as JSONObject)["notifyUserId"]).toBe(
      userId,
    );
    expect(item["feedInfoInMarkdown"]).toContain(
      "📞 added a **War room** video call",
    );
  });

  test("never throws: the call exists whether or not it could be announced", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      EventVideoCall.announce({
        eventType: VideoCallEventType.Incident,
        eventId: INCIDENT_ID,
        provider: VideoCallProvider.Zoom,
        joinUrl: "https://zoom.us/j/1",
      }),
    ).resolves.toBe(undefined);
  });

  test("an alert's call goes to the alert's feed", async () => {
    const alertId: ObjectID = ObjectID.generate();
    const alert: Alert = new Alert(alertId);
    alert.projectId = PROJECT_ID;
    alert.alertNumberWithPrefix = "ALT-7";

    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.com/a"));

    const createFeedItem: SpyInstance<
      typeof AlertFeedService.createAlertFeedItem
    > = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined);

    await EventVideoCall.announce({
      eventType: VideoCallEventType.Alert,
      eventId: alertId,
      provider: VideoCallProvider.SlackHuddle,
      joinUrl: "https://app.slack.com/huddle/T1/C1",
    });

    const item: JSONObject = createFeedItem.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(item["alertId"]).toBe(alertId);
    expect(item["alertFeedEventType"]).toBe(
      AlertFeedEventType.VideoCallStarted,
    );
    expect(item["feedInfoInMarkdown"]).toContain("[Alert ALT\\-7]");
  });
});

describe("EventVideoCall.announceFailure", () => {
  test("records why a rule's call could not start, in the dashboard only", async () => {
    const createFeedItem: SpyInstance<
      typeof IncidentFeedService.createIncidentFeedItem
    > = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined);

    await EventVideoCall.announceFailure({
      eventType: VideoCallEventType.Incident,
      eventId: INCIDENT_ID,
      projectId: PROJECT_ID,
      ruleName: "Sev1 bridge",
      error: "Zoom rejected the Client ID or Client secret.",
    });

    const item: JSONObject = createFeedItem.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallFailed,
    );
    expect(item["feedInfoInMarkdown"]).toContain(
      "Zoom rejected the Client ID or Client secret.",
    );
    // Not posted to the incident's channels.
    expect(item["workspaceNotification"]).toBe(undefined);
  });

  test("never throws", async () => {
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockRejectedValue(new Error("x"));

    await expect(
      EventVideoCall.announceFailure({
        eventType: VideoCallEventType.Alert,
        eventId: ObjectID.generate(),
        projectId: PROJECT_ID,
        ruleName: "r",
        error: "e",
      }),
    ).resolves.toBe(undefined);
  });
});
