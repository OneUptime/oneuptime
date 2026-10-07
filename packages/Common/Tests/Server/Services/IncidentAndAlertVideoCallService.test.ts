import AlertVideoCall from "../../../Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
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
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
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
