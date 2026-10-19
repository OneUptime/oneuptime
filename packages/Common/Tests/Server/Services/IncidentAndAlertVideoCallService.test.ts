import AlertVideoCall from "../../../Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import { Service as AlertVideoCallServiceType } from "../../../Server/Services/AlertVideoCallService";
import { Service as IncidentVideoCallServiceType } from "../../../Server/Services/IncidentVideoCallService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate, OnFind } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import EventVideoCall, {
  VideoCallEvent,
  VideoCallEventType,
} from "../../../Server/Utils/VideoCall/EventVideoCall";
import IncidentCallTranscriptFetch from "../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptFetch";
import { CallTranscriptFetchStatus } from "../../../Types/VideoCall/CallTranscriptAutoFetch";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptUnavailableReason } from "../../../Types/VideoCall/VideoCallTranscript";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The incident and alert call services. A call from a connection starts a
 * real meeting at the provider before the row is saved, so the order of the
 * create hook is the whole point: everything that could refuse the request -
 * the caller's permissions, the event's privacy - is asked first, and the
 * provider only after. A refused request leaves no meeting behind in
 * someone's Zoom account.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectMember,
          labelIds: [],
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
      isBlockPermission: false,
    },
  },
} as unknown as DatabaseCommonInteractionProps;

type IncidentInternals = {
  onBeforeCreate: (
    createBy: CreateBy<IncidentVideoCall>,
  ) => Promise<OnCreate<IncidentVideoCall>>;
  onCreateSuccess: (
    onCreate: OnCreate<IncidentVideoCall>,
    createdItem: IncidentVideoCall,
  ) => Promise<IncidentVideoCall>;
  onBeforeFind: (
    findBy: FindBy<IncidentVideoCall>,
  ) => Promise<OnFind<IncidentVideoCall>>;
};

type AlertInternals = {
  onBeforeCreate: (
    createBy: CreateBy<AlertVideoCall>,
  ) => Promise<OnCreate<AlertVideoCall>>;
  onCreateSuccess: (
    onCreate: OnCreate<AlertVideoCall>,
    createdItem: AlertVideoCall,
  ) => Promise<AlertVideoCall>;
  onBeforeFind: (
    findBy: FindBy<AlertVideoCall>,
  ) => Promise<OnFind<AlertVideoCall>>;
};

function event(type: VideoCallEventType): VideoCallEvent {
  return {
    type,
    id: type === VideoCallEventType.Incident ? INCIDENT_ID : ALERT_ID,
    projectId: PROJECT_ID,
    numberDisplay: "#1",
    title: "Down",
    isPrivate: false,
    link: "https://oneuptime.com/x",
    workspaceChannels: [],
  };
}

beforeEach(() => {
  jest.spyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentVideoCallService create", () => {
  function build(): IncidentInternals {
    return new IncidentVideoCallServiceType() as unknown as IncidentInternals;
  }

  function call(): IncidentVideoCall {
    const model: IncidentVideoCall = new IncidentVideoCall();
    model.projectId = PROJECT_ID;
    model.incidentId = INCIDENT_ID;
    model.videoCallConnectionId = CONNECTION_ID;
    return model;
  }

  test("asks for permission and privacy before starting the meeting", async () => {
    const order: Array<string> = [];

    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {
        order.push("permission");
      });
    jest
      .spyOn(EventVideoCall, "assertCallerCanSeeEvent")
      .mockImplementation(async () => {
        order.push("privacy");
      });
    jest.spyOn(EventVideoCall, "getEvent").mockImplementation(async () => {
      order.push("event");
      return event(VideoCallEventType.Incident);
    });
    jest.spyOn(EventVideoCall, "prepare").mockImplementation(async () => {
      order.push("provider");
      return {
        fields: {
          provider: VideoCallProvider.Zoom,
          videoCallConnectionId: CONNECTION_ID,
          joinUrl: "https://zoom.us/j/1",
          externalMeetingId: "1",
          title: "#1: Down",
        },
        carryForward: { connectionName: "Incident Zoom" },
      };
    });

    const onCreate: OnCreate<IncidentVideoCall> = await build().onBeforeCreate({
      data: call(),
      props: USER_PROPS,
    });

    expect(order).toEqual(["permission", "privacy", "event", "provider"]);

    const data: IncidentVideoCall = onCreate.createBy.data;
    expect(data.provider).toBe(VideoCallProvider.Zoom);
    expect(data.joinUrl).toBe("https://zoom.us/j/1");
    expect(data.externalMeetingId).toBe("1");
    expect(data.title).toBe("#1: Down");
    expect(onCreate.carryForward).toEqual({ connectionName: "Incident Zoom" });
  });

  test("a Teams meeting's calendar event is saved with the call; one a request names never is", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {});
    jest.spyOn(EventVideoCall, "assertCallerCanSeeEvent").mockResolvedValue();
    jest
      .spyOn(EventVideoCall, "getEvent")
      .mockResolvedValue(event(VideoCallEventType.Incident));
    const prepare: SpyInstance<typeof EventVideoCall.prepare> = jest
      .spyOn(EventVideoCall, "prepare")
      .mockResolvedValueOnce({
        fields: {
          provider: VideoCallProvider.MicrosoftTeams,
          videoCallConnectionId: CONNECTION_ID,
          joinUrl: "https://teams.microsoft.com/l/meetup-join/x",
          externalMeetingId: "m-1",
          externalCalendarEventId: "AAMkAGI2TG93AAA=",
          title: "#1: Down",
        },
        carryForward: {
          connectionName: "Incident Teams",
          recordsAndTranscribes: true,
        },
      })
      .mockResolvedValueOnce({
        fields: {
          provider: VideoCallProvider.CustomLink,
          joinUrl: "https://acme.webex.com/meet/war-room",
        },
        carryForward: {},
      });

    const recorded: OnCreate<IncidentVideoCall> = await build().onBeforeCreate({
      data: call(),
      props: USER_PROPS,
    });

    expect(recorded.createBy.data.externalCalendarEventId).toBe(
      "AAMkAGI2TG93AAA=",
    );

    const spoofed: IncidentVideoCall = call();
    spoofed.externalCalendarEventId = "spoofed";

    const pasted: OnCreate<IncidentVideoCall> = await build().onBeforeCreate({
      data: spoofed,
      props: { isRoot: true },
    });

    // The request's own value is never handed to the preparation, nor kept.
    expect(
      prepare.mock.calls[1]![0].fields.externalCalendarEventId,
    ).toBeUndefined();
    expect(pasted.createBy.data.externalCalendarEventId).toBeUndefined();
  });

  test("starts no meeting for a caller who may not create calls", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {
        throw new NotAuthorizedException("You do not have permission");
      });
    const prepare: SpyInstance<typeof EventVideoCall.prepare> = jest.spyOn(
      EventVideoCall,
      "prepare",
    );

    await expect(
      build().onBeforeCreate({ data: call(), props: USER_PROPS }),
    ).rejects.toThrow("You do not have permission");

    expect(prepare).not.toHaveBeenCalled();
  });

  test("starts no meeting for an incident the caller cannot see", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {});
    jest
      .spyOn(EventVideoCall, "assertCallerCanSeeEvent")
      .mockRejectedValue(new BadDataException("Incident not found."));
    const prepare: SpyInstance<typeof EventVideoCall.prepare> = jest.spyOn(
      EventVideoCall,
      "prepare",
    );

    await expect(
      build().onBeforeCreate({ data: call(), props: USER_PROPS }),
    ).rejects.toThrow("Incident not found.");

    expect(prepare).not.toHaveBeenCalled();
  });

  test("tells the preparation whether OneUptime itself is writing", async () => {
    jest
      .spyOn(EventVideoCall, "getEvent")
      .mockResolvedValue(event(VideoCallEventType.Incident));
    const prepare: SpyInstance<typeof EventVideoCall.prepare> = jest
      .spyOn(EventVideoCall, "prepare")
      .mockResolvedValue({
        fields: {
          provider: VideoCallProvider.SlackHuddle,
          joinUrl: "https://app.slack.com/huddle/T1/C1",
        },
        carryForward: {},
      });

    await build().onBeforeCreate({ data: call(), props: { isRoot: true } });

    expect(prepare.mock.calls[0]![0].isServerWrite).toBe(true);
  });

  test("drops relations a request used to name the rule or the meeting another way", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {});
    jest.spyOn(EventVideoCall, "assertCallerCanSeeEvent").mockResolvedValue();
    jest
      .spyOn(EventVideoCall, "getEvent")
      .mockResolvedValue(event(VideoCallEventType.Incident));
    jest.spyOn(EventVideoCall, "prepare").mockResolvedValue({
      fields: {
        provider: VideoCallProvider.CustomLink,
        joinUrl: "https://acme.webex.com/x",
      },
      carryForward: {},
    });

    const data: IncidentVideoCall = call();
    data.workspaceNotificationRule = new WorkspaceNotificationRule(
      ObjectID.generate(),
    );

    const onCreate: OnCreate<IncidentVideoCall> = await build().onBeforeCreate({
      data,
      props: USER_PROPS,
    });

    expect(onCreate.createBy.data.workspaceNotificationRule).toBe(undefined);
    expect(onCreate.createBy.data.workspaceNotificationRuleId).toBe(undefined);
    expect(onCreate.createBy.data.videoCallConnection).toBe(undefined);
  });

  test("reads a connection named by its relation as the connection", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {});
    jest.spyOn(EventVideoCall, "assertCallerCanSeeEvent").mockResolvedValue();
    jest
      .spyOn(EventVideoCall, "getEvent")
      .mockResolvedValue(event(VideoCallEventType.Incident));
    const prepare: SpyInstance<typeof EventVideoCall.prepare> = jest
      .spyOn(EventVideoCall, "prepare")
      .mockResolvedValue({
        fields: {
          provider: VideoCallProvider.Zoom,
          videoCallConnectionId: CONNECTION_ID,
          joinUrl: "https://zoom.us/j/1",
        },
        carryForward: {},
      });

    const data: IncidentVideoCall = call();
    delete (data as unknown as Record<string, unknown>)[
      "videoCallConnectionId"
    ];
    data.videoCallConnection = new VideoCallConnection(CONNECTION_ID);

    await build().onBeforeCreate({ data, props: USER_PROPS });

    expect(
      prepare.mock.calls[0]![0].fields.videoCallConnectionId?.toString(),
    ).toBe(CONNECTION_ID.toString());
  });

  test("refuses a connection named two ways that disagree, before any meeting starts", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {});
    jest.spyOn(EventVideoCall, "assertCallerCanSeeEvent").mockResolvedValue();
    jest
      .spyOn(EventVideoCall, "getEvent")
      .mockResolvedValue(event(VideoCallEventType.Incident));
    const prepare: SpyInstance<typeof EventVideoCall.prepare> = jest.spyOn(
      EventVideoCall,
      "prepare",
    );

    const data: IncidentVideoCall = call();
    data.videoCallConnection = new VideoCallConnection(ObjectID.generate());

    await expect(
      build().onBeforeCreate({ data, props: USER_PROPS }),
    ).rejects.toThrow("Conflicting Video Call Connection references");

    expect(prepare).not.toHaveBeenCalled();
  });

  test("needs an incident", async () => {
    const data: IncidentVideoCall = call();
    delete data.incidentId;

    await expect(
      build().onBeforeCreate({ data, props: { isRoot: true } }),
    ).rejects.toThrow("Incident ID is required.");
  });

  test("announces the saved call, crediting its creator and its connection", async () => {
    const announce: SpyInstance<typeof EventVideoCall.announce> = jest
      .spyOn(EventVideoCall, "announce")
      .mockResolvedValue();

    const created: IncidentVideoCall = call();
    created.provider = VideoCallProvider.Zoom;
    created.joinUrl = "https://zoom.us/j/1";
    created.title = "#1: Down";
    created.createdByUserId = USER_ID;

    await build().onCreateSuccess(
      {
        createBy: { data: created, props: USER_PROPS },
        carryForward: { connectionName: "Incident Zoom" },
      },
      created,
    );

    expect(announce).toHaveBeenCalledWith({
      eventType: VideoCallEventType.Incident,
      eventId: INCIDENT_ID,
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://zoom.us/j/1",
      title: "#1: Down",
      connectionName: "Incident Zoom",
      workspaceNotificationRuleId: undefined,
      userId: USER_ID,
    });
  });

  test("passes on that the call is recorded, and watches it for its transcript", async () => {
    jest.spyOn(EventVideoCall, "announce").mockResolvedValue();
    const watch: SpyInstance<typeof IncidentCallTranscriptFetch.watchNewCall> =
      jest
        .spyOn(IncidentCallTranscriptFetch, "watchNewCall")
        .mockResolvedValue();

    const created: IncidentVideoCall = call();
    created.provider = VideoCallProvider.Zoom;
    created.joinUrl = "https://zoom.us/j/1";
    created.externalMeetingId = "1";
    created.videoCallConnectionId = CONNECTION_ID;

    await build().onCreateSuccess(
      {
        createBy: { data: created, props: USER_PROPS },
        carryForward: {
          connectionName: "Incident Zoom",
          recordsAndTranscribes: true,
        },
      },
      created,
    );

    expect(EventVideoCall.announce).toHaveBeenCalledWith(
      expect.objectContaining({ recordsAndTranscribes: true }),
    );
    expect(watch).toHaveBeenCalledWith(created);
  });

  test("does not watch a call nobody asked to record", async () => {
    jest.spyOn(EventVideoCall, "announce").mockResolvedValue();
    const watch: SpyInstance<typeof IncidentCallTranscriptFetch.watchNewCall> =
      jest
        .spyOn(IncidentCallTranscriptFetch, "watchNewCall")
        .mockResolvedValue();
    const markNotRecorded: SpyInstance<
      typeof IncidentCallTranscriptFetch.markNotRecorded
    > = jest
      .spyOn(IncidentCallTranscriptFetch, "markNotRecorded")
      .mockResolvedValue();

    const created: IncidentVideoCall = call();
    created.provider = VideoCallProvider.Zoom;
    created.joinUrl = "https://zoom.us/j/1";

    await build().onCreateSuccess(
      {
        createBy: { data: created, props: USER_PROPS },
        carryForward: { connectionName: "Incident Zoom" },
      },
      created,
    );

    expect(watch).not.toHaveBeenCalled();
    expect(markNotRecorded).not.toHaveBeenCalled();
  });

  test("a Teams call that could not be set up to record itself is not watched, and says why", async () => {
    jest.spyOn(EventVideoCall, "announce").mockResolvedValue();
    const watch: SpyInstance<typeof IncidentCallTranscriptFetch.watchNewCall> =
      jest
        .spyOn(IncidentCallTranscriptFetch, "watchNewCall")
        .mockResolvedValue();
    const markNotRecorded: SpyInstance<
      typeof IncidentCallTranscriptFetch.markNotRecorded
    > = jest
      .spyOn(IncidentCallTranscriptFetch, "markNotRecorded")
      .mockResolvedValue();

    const created: IncidentVideoCall = call();
    created.provider = VideoCallProvider.MicrosoftTeams;
    created.joinUrl = "https://teams.microsoft.com/l/meetup-join/x";
    created.externalMeetingId = "m-1";
    created.videoCallConnectionId = CONNECTION_ID;

    await build().onCreateSuccess(
      {
        createBy: { data: created, props: USER_PROPS },
        carryForward: {
          connectionName: "Incident Teams",
          recordsAndTranscribes: false,
          notRecordedReason:
            VideoCallTranscriptUnavailableReason.PermissionMissing,
        },
      },
      created,
    );

    // Its message says nothing about recording.
    expect(EventVideoCall.announce).toHaveBeenCalledWith(
      expect.objectContaining({ recordsAndTranscribes: false }),
    );
    expect(watch).not.toHaveBeenCalled();
    expect(markNotRecorded).toHaveBeenCalledWith({
      call: created,
      reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
    });
  });

  test("shows a person only the calls of incidents they can see", async () => {
    const onFind: OnFind<IncidentVideoCall> = await build().onBeforeFind({
      query: { projectId: PROJECT_ID },
      select: { _id: true },
      props: USER_PROPS,
    } as FindBy<IncidentVideoCall>);

    expect(Object.keys(onFind.findBy.query as unknown as JSONObject)).toContain(
      "incidentId",
    );
  });

  test("lets OneUptime read every call", async () => {
    const onFind: OnFind<IncidentVideoCall> = await build().onBeforeFind({
      query: { projectId: PROJECT_ID },
      select: { _id: true },
      props: { isRoot: true },
    } as FindBy<IncidentVideoCall>);

    expect(onFind.findBy.query).toEqual({ projectId: PROJECT_ID });
  });
});

/*
 * The transcript job takes a call before asking about it, in one UPDATE
 * that only moves a call still Waiting at the attempt the job read: two
 * runs of the job can never both take it.
 */
describe("IncidentVideoCallService.claimTranscriptFetch", () => {
  interface RecordedUpdate {
    set: JSONObject | null;
    where: Array<{ sql: string; params?: JSONObject | undefined }>;
  }

  function stubRepository(
    service: IncidentVideoCallServiceType,
    affected: number | undefined,
  ): RecordedUpdate {
    const recorded: RecordedUpdate = { set: null, where: [] };
    const builder: Record<string, unknown> = {};

    builder["update"] = (): unknown => {
      return builder;
    };
    builder["set"] = (values: JSONObject): unknown => {
      recorded.set = values;
      return builder;
    };
    builder["where"] = (sql: string, params?: JSONObject): unknown => {
      recorded.where.push({ sql, params });
      return builder;
    };
    builder["andWhere"] = builder["where"];
    builder["execute"] = async (): Promise<{ affected?: number }> => {
      return affected === undefined ? {} : { affected };
    };

    jest.spyOn(service, "getRepository").mockReturnValue({
      createQueryBuilder: (): unknown => {
        return builder;
      },
    } as unknown as ReturnType<typeof service.getRepository>);

    return recorded;
  }

  const DUE_AT: Date = new Date("2026-10-19T10:10:00.000Z");
  const NEXT: Date = new Date("2026-10-19T10:20:00.000Z");

  test("moves the next attempt on, only for the call, while Waiting at the attempt read, and not deleted", async () => {
    const service: IncidentVideoCallServiceType =
      new IncidentVideoCallServiceType();
    const recorded: RecordedUpdate = stubRepository(service, 1);
    const callId: ObjectID = ObjectID.generate();

    const claimed: number = await service.claimTranscriptFetch({
      callId,
      dueAt: DUE_AT,
      nextAttemptAt: NEXT,
    });

    expect(claimed).toBe(1);
    expect(recorded.set).toEqual({ transcriptFetchNextAttemptAt: NEXT });
    expect(recorded.where).toEqual([
      { sql: '"_id" = :id', params: { id: callId.toString() } },
      {
        sql: '"transcriptFetchStatus" = :status',
        params: { status: CallTranscriptFetchStatus.Waiting },
      },
      {
        sql: '"transcriptFetchNextAttemptAt" = :dueAt',
        params: { dueAt: DUE_AT },
      },
      { sql: '"deletedAt" IS NULL', params: undefined },
    ]);
  });

  test("0 when another run took it first, or it stopped waiting", async () => {
    const service: IncidentVideoCallServiceType =
      new IncidentVideoCallServiceType();
    stubRepository(service, 0);

    expect(
      await service.claimTranscriptFetch({
        callId: ObjectID.generate(),
        dueAt: DUE_AT,
        nextAttemptAt: NEXT,
      }),
    ).toBe(0);
  });

  test("0 when the database says nothing about what it changed", async () => {
    const service: IncidentVideoCallServiceType =
      new IncidentVideoCallServiceType();
    stubRepository(service, undefined);

    expect(
      await service.claimTranscriptFetch({
        callId: ObjectID.generate(),
        dueAt: DUE_AT,
        nextAttemptAt: NEXT,
      }),
    ).toBe(0);
  });

  /*
   * The transcript the job got is stored only while the call still waits
   * and has none: a person who got or added one meanwhile keeps theirs.
   */
  test("taking a call for storing its transcript ends the waiting, only while it waits and has no transcript", async () => {
    const service: IncidentVideoCallServiceType =
      new IncidentVideoCallServiceType();
    const recorded: RecordedUpdate = stubRepository(service, 1);
    const callId: ObjectID = ObjectID.generate();

    expect(
      await service.takeTranscriptFetchForSaving({ callId, checkedAt: NEXT }),
    ).toBe(1);
    expect(recorded.set).toEqual({
      transcriptFetchStatus: null,
      transcriptFetchReason: null,
      transcriptFetchNextAttemptAt: null,
      transcriptFetchCheckedAt: NEXT,
    });
    expect(recorded.where).toEqual([
      { sql: '"_id" = :id', params: { id: callId.toString() } },
      {
        sql: '"transcriptFetchStatus" = :status',
        params: { status: CallTranscriptFetchStatus.Waiting },
      },
      { sql: '"transcriptAddedAt" IS NULL', params: undefined },
      { sql: '"deletedAt" IS NULL', params: undefined },
    ]);
  });

  test("taking a call that has a transcript by now gives 0", async () => {
    const service: IncidentVideoCallServiceType =
      new IncidentVideoCallServiceType();
    stubRepository(service, 0);

    expect(
      await service.takeTranscriptFetchForSaving({
        callId: ObjectID.generate(),
        checkedAt: NEXT,
      }),
    ).toBe(0);
  });
});

describe("AlertVideoCallService create", () => {
  function build(): AlertInternals {
    return new AlertVideoCallServiceType() as unknown as AlertInternals;
  }

  function call(): AlertVideoCall {
    const model: AlertVideoCall = new AlertVideoCall();
    model.projectId = PROJECT_ID;
    model.alertId = ALERT_ID;
    model.joinUrl = "https://acme.webex.com/x";
    return model;
  }

  test("checks the alert's privacy and prepares an alert call", async () => {
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation(() => {});
    const privacy: SpyInstance<typeof EventVideoCall.assertCallerCanSeeEvent> =
      jest.spyOn(EventVideoCall, "assertCallerCanSeeEvent").mockResolvedValue();
    const getEvent: SpyInstance<typeof EventVideoCall.getEvent> = jest
      .spyOn(EventVideoCall, "getEvent")
      .mockResolvedValue(event(VideoCallEventType.Alert));
    jest.spyOn(EventVideoCall, "prepare").mockResolvedValue({
      fields: {
        provider: VideoCallProvider.CustomLink,
        joinUrl: "https://acme.webex.com/x",
      },
      carryForward: {},
    });

    await build().onBeforeCreate({ data: call(), props: USER_PROPS });

    expect(privacy.mock.calls[0]![0]).toEqual({
      type: VideoCallEventType.Alert,
      id: ALERT_ID,
      props: USER_PROPS,
    });
    expect(getEvent.mock.calls[0]![0]).toEqual({
      type: VideoCallEventType.Alert,
      id: ALERT_ID,
    });
  });

  test("needs an alert", async () => {
    const data: AlertVideoCall = call();
    delete data.alertId;

    await expect(
      build().onBeforeCreate({ data, props: { isRoot: true } }),
    ).rejects.toThrow("Alert ID is required.");
  });

  test("announces to the alert", async () => {
    const announce: SpyInstance<typeof EventVideoCall.announce> = jest
      .spyOn(EventVideoCall, "announce")
      .mockResolvedValue();

    const created: AlertVideoCall = call();
    created.provider = VideoCallProvider.CustomLink;

    await build().onCreateSuccess(
      {
        createBy: { data: created, props: { isRoot: true } },
        carryForward: undefined,
      },
      created,
    );

    expect(announce.mock.calls[0]![0].eventType).toBe(VideoCallEventType.Alert);
    expect(announce.mock.calls[0]![0].eventId).toBe(ALERT_ID);
  });

  test("shows a person only the calls of alerts they can see", async () => {
    const onFind: OnFind<AlertVideoCall> = await build().onBeforeFind({
      query: { projectId: PROJECT_ID },
      select: { _id: true },
      props: USER_PROPS,
    } as FindBy<AlertVideoCall>);

    expect(Object.keys(onFind.findBy.query as unknown as JSONObject)).toContain(
      "alertId",
    );
  });
});
