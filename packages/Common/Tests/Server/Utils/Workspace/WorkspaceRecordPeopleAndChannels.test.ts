import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeRoleMember from "../../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyOwnerTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../../Server/Infrastructure/Semaphore";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentEpisodeRoleMemberService from "../../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentMemberService from "../../../../Server/Services/IncidentMemberService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OnCallDutyPolicyOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import WorkspaceRecordChannels, {
  RECORD_CHANNEL_SETUP_WINDOW_IN_MINUTES,
  WORKSPACE_RECORD_CHANNELS_LOCK_NAMESPACE,
  WorkspaceRecordChannelState,
} from "../../../../Server/Utils/Workspace/WorkspaceRecordChannels";
import WorkspaceRecordPeople, {
  WorkspaceRecord,
} from "../../../../Server/Utils/Workspace/WorkspaceRecordPeople";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import { NotificationRuleInvitee } from "../../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceChannelName from "../../../../Utils/Workspace/WorkspaceChannelName";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * What a rule's channel needs of its record, per kind of record: the people
 * on it now (WorkspaceRecordPeople), and its own channels, whether it is
 * still going on, its name for a channel and how to introduce it
 * (WorkspaceRecordChannels).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-000000000002",
);
const STATE_ID: ObjectID = new ObjectID("e8000000-0000-4000-8000-000000000003");
const USER_A: ObjectID = new ObjectID("e8000000-0000-4000-8000-0000000000a1");
const USER_B: ObjectID = new ObjectID("e8000000-0000-4000-8000-0000000000b1");
const TEAM_ID: ObjectID = new ObjectID("e8000000-0000-4000-8000-0000000000c1");
const LINK: URL = URL.fromString("https://oneuptime.test/record");

const CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0A",
  name: "inc-42",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: "rule",
};

function user(id: ObjectID): User {
  const model: User = new User();
  model.id = id;
  return model;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceRecordPeople: the owners of each kind of record", () => {
  test.each([
    ["incidentId", "Incident"],
    ["alertId", "Alert"],
    ["incidentEpisodeId", "IncidentEpisode"],
    ["alertEpisodeId", "AlertEpisode"],
    ["scheduledMaintenanceId", "ScheduledMaintenance"],
    ["monitorId", "Monitor"],
  ] as Array<[keyof WorkspaceRecord, string]>)(
    "%s: its service's owners, each once",
    async (field: keyof WorkspaceRecord) => {
      const services: Record<string, { findOwners: unknown }> = {
        incidentId: IncidentService,
        alertId: AlertService,
        incidentEpisodeId: IncidentEpisodeService,
        alertEpisodeId: AlertEpisodeService,
        scheduledMaintenanceId: ScheduledMaintenanceService,
        monitorId: MonitorService,
      };

      const asked: Array<unknown> = [];
      jest
        .spyOn(services[field] as never, "findOwners" as never)
        .mockImplementation((async (recordId: ObjectID) => {
          asked.push(recordId);
          return [user(USER_A), user(USER_B), user(USER_A)];
        }) as never);

      const ids: Array<ObjectID> = await WorkspaceRecordPeople.getUserIds({
        record: { [field]: RECORD_ID },
        invitee: NotificationRuleInvitee.Owners,
      });

      expect(asked).toEqual([RECORD_ID]);
      expect(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([USER_A.toString(), USER_B.toString()]);
    },
  );

  test("an on-call policy: its owner users and the members of its owner teams", async () => {
    const ownerUser: OnCallDutyPolicyOwnerUser = new OnCallDutyPolicyOwnerUser();
    ownerUser.userId = USER_A;
    const ownerTeam: OnCallDutyPolicyOwnerTeam = new OnCallDutyPolicyOwnerTeam();
    ownerTeam.teamId = TEAM_ID;

    const userQuery: Array<JSONObject> = [];
    jest
      .spyOn(OnCallDutyPolicyOwnerUserService, "findBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        userQuery.push(data.query);
        return [ownerUser];
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyOwnerTeamService, "findBy")
      .mockResolvedValue([ownerTeam] as never);
    const teamsAsked: Array<Array<ObjectID>> = [];
    jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockImplementation((async (teamIds: Array<ObjectID>) => {
        teamsAsked.push(teamIds);
        return [user(USER_B), user(USER_A)];
      }) as never);

    const ids: Array<ObjectID> = await WorkspaceRecordPeople.getUserIds({
      record: { onCallDutyPolicyId: RECORD_ID },
      invitee: NotificationRuleInvitee.Owners,
    });

    expect(userQuery).toEqual([{ onCallDutyPolicyId: RECORD_ID }]);
    expect(teamsAsked).toEqual([[TEAM_ID]]);
    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([USER_A.toString(), USER_B.toString()]);
  });
});

describe("WorkspaceRecordPeople: the people given a role", () => {
  test("an incident's members", async () => {
    const queries: Array<JSONObject> = [];
    jest
      .spyOn(IncidentMemberService, "findBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        queries.push(data.query);
        return [USER_A, USER_A, USER_B].map((id: ObjectID) => {
          const member: IncidentMember = new IncidentMember();
          member.userId = id;
          return member;
        });
      }) as never);

    const ids: Array<ObjectID> = await WorkspaceRecordPeople.getUserIds({
      record: { incidentId: RECORD_ID },
      invitee: NotificationRuleInvitee.IncidentRoles,
    });

    expect(queries).toEqual([{ incidentId: RECORD_ID }]);
    expect(ids).toHaveLength(2);
  });

  test("an incident episode's role members", async () => {
    const queries: Array<JSONObject> = [];
    jest
      .spyOn(IncidentEpisodeRoleMemberService, "findBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        queries.push(data.query);
        const member: IncidentEpisodeRoleMember =
          new IncidentEpisodeRoleMember();
        member.userId = USER_B;
        return [member];
      }) as never);

    const ids: Array<ObjectID> = await WorkspaceRecordPeople.getUserIds({
      record: { incidentEpisodeId: RECORD_ID },
      invitee: NotificationRuleInvitee.IncidentRoles,
    });

    expect(queries).toEqual([{ incidentEpisodeId: RECORD_ID }]);
    expect(ids[0]?.toString()).toBe(USER_B.toString());
  });

  test("an alert has none", async () => {
    expect(
      await WorkspaceRecordPeople.getUserIds({
        record: { alertId: RECORD_ID },
        invitee: NotificationRuleInvitee.IncidentRoles,
      }),
    ).toEqual([]);
  });
});

describe("WorkspaceRecordPeople: the people paged for the record", () => {
  test.each([
    ["incidentId", "triggeredByIncidentId"],
    ["alertId", "triggeredByAlertId"],
    ["incidentEpisodeId", "triggeredByIncidentEpisodeId"],
    ["alertEpisodeId", "triggeredByAlertEpisodeId"],
  ] as Array<[keyof WorkspaceRecord, string]>)(
    "%s: the pages it triggered (%s), each person once",
    async (field: keyof WorkspaceRecord, triggerColumn: string) => {
      const queries: Array<JSONObject> = [];
      jest
        .spyOn(UserOnCallLogService, "findBy")
        .mockImplementation((async (data: { query: JSONObject }) => {
          queries.push(data.query);
          return [USER_A, USER_B, USER_A].map((id: ObjectID) => {
            const row: UserOnCallLog = new UserOnCallLog();
            row.userId = id;
            return row;
          });
        }) as never);

      const ids: Array<ObjectID> = await WorkspaceRecordPeople.getUserIds({
        record: { [field]: RECORD_ID },
        invitee: NotificationRuleInvitee.OnCallResponders,
      });

      expect(queries).toEqual([{ [triggerColumn]: RECORD_ID }]);
      expect(ids).toHaveLength(2);
    },
  );

  test("a record no on-call policy pages for has nobody paged", async () => {
    let read: boolean = false;
    jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockImplementation((async () => {
        read = true;
        return [];
      }) as never);

    expect(
      await WorkspaceRecordPeople.getUserIds({
        record: { monitorId: RECORD_ID },
        invitee: NotificationRuleInvitee.OnCallResponders,
      }),
    ).toEqual([]);
    expect(read).toBe(false);
  });
});

describe("WorkspaceRecordChannels.getEventType", () => {
  test.each([
    ["incidentId", NotificationRuleEventType.Incident],
    ["alertId", NotificationRuleEventType.Alert],
    ["incidentEpisodeId", NotificationRuleEventType.IncidentEpisode],
    ["alertEpisodeId", NotificationRuleEventType.AlertEpisode],
    ["scheduledMaintenanceId", NotificationRuleEventType.ScheduledMaintenance],
    ["monitorId", NotificationRuleEventType.Monitor],
    ["onCallDutyPolicyId", NotificationRuleEventType.OnCallDutyPolicy],
  ] as Array<[keyof WorkspaceRecord, NotificationRuleEventType]>)(
    "%s is a %s",
    (field: keyof WorkspaceRecord, eventType: NotificationRuleEventType) => {
      expect(WorkspaceRecordChannels.getEventType({ [field]: RECORD_ID })).toBe(
        eventType,
      );
    },
  );

  test("no record, no kind", () => {
    expect(WorkspaceRecordChannels.getEventType({})).toBeNull();
  });
});

describe("WorkspaceRecordChannels.read", () => {
  beforeEach(() => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(LINK);
    jest.spyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(LINK);
    jest
      .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(LINK);
    jest
      .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(LINK);
    jest
      .spyOn(ScheduledMaintenanceService, "getScheduledMaintenanceLinkInDashboard")
      .mockResolvedValue(LINK);
    jest.spyOn(MonitorService, "getMonitorLinkInDashboard").mockResolvedValue(LINK);
    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(LINK);
  });

  function incident(
    channels: Array<NotificationRuleWorkspaceChannel> | undefined,
  ): Incident {
    const model: Incident = new Incident();
    model.projectId = PROJECT_ID;
    model.title = "Checkout is down";
    model.incidentNumber = 42;
    model.incidentNumberWithPrefix = "INC-42";
    model.currentIncidentStateId = STATE_ID;
    model.isPrivate = true;
    if (channels) {
      model.postUpdatesToWorkspaceChannels = channels;
    }
    return model;
  }

  test("an incident: its channels, whether it is resolved, its name for a channel, private, and how it is called", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident([CHANNEL]));
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(false);

    const state: WorkspaceRecordChannelState | null =
      await WorkspaceRecordChannels.read({ incidentId: RECORD_ID });

    expect(state).toEqual({
      projectId: PROJECT_ID,
      eventType: NotificationRuleEventType.Incident,
      channels: [CHANNEL],
      isSetUp: true,
      isOngoing: true,
      isPrivate: true,
      channelNameParts: WorkspaceChannelName.forNumberedRecord({
        eventType: NotificationRuleEventType.Incident,
        number: 42,
        numberWithPrefix: "INC-42",
      }),
      displayName: "Incident INC-42",
      title: "Checkout is down",
      link: LINK,
    });
  });

  test("an incident created moments ago whose channels were never stored is still being set up", async () => {
    const model: Incident = incident(undefined);
    model.createdAt = new Date();
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(model);
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(false);

    const state: WorkspaceRecordChannelState | null =
      await WorkspaceRecordChannels.read({ incidentId: RECORD_ID });

    expect(state?.channels).toBeNull();
    expect(state?.isSetUp).toBe(false);
  });

  test("one created longer ago than the setup window is set up, though it holds no list", async () => {
    const model: Incident = incident(undefined);
    model.createdAt = new Date(
      Date.now() - (RECORD_CHANNEL_SETUP_WINDOW_IN_MINUTES + 1) * 60 * 1000,
    );
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(model);
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(false);

    const state: WorkspaceRecordChannelState | null =
      await WorkspaceRecordChannels.read({ incidentId: RECORD_ID });

    expect(state?.channels).toBeNull();
    expect(state?.isSetUp).toBe(true);
  });

  test("a resolved incident is not going on", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident([]));
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(true);

    expect(
      (await WorkspaceRecordChannels.read({ incidentId: RECORD_ID }))?.isOngoing,
    ).toBe(false);
  });

  test("a record that is not found reads null", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null);

    expect(await WorkspaceRecordChannels.read({ incidentId: RECORD_ID })).toBe(
      null,
    );
    expect(await WorkspaceRecordChannels.read({})).toBeNull();
  });

  test("an alert, an episode, a maintenance event, a monitor and a policy are read their own way", async () => {
    const alert: Alert = new Alert();
    alert.projectId = PROJECT_ID;
    alert.title = "Latency";
    alert.alertNumber = 7;
    alert.alertNumberWithPrefix = "ALT-7";
    alert.currentAlertStateId = STATE_ID;
    alert.postUpdatesToWorkspaceChannels = [];
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);
    jest.spyOn(AlertStateService, "isResolvedAlertState").mockResolvedValue(true);

    const incidentEpisode: IncidentEpisode = new IncidentEpisode();
    incidentEpisode.projectId = PROJECT_ID;
    incidentEpisode.title = "Payments";
    incidentEpisode.episodeNumber = 3;
    incidentEpisode.episodeNumberWithPrefix = "IE-3";
    incidentEpisode.currentIncidentStateId = STATE_ID;
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(incidentEpisode);
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockResolvedValue(false);

    const alertEpisode: AlertEpisode = new AlertEpisode();
    alertEpisode.projectId = PROJECT_ID;
    alertEpisode.title = "Disks";
    alertEpisode.episodeNumber = 4;
    alertEpisode.currentAlertStateId = STATE_ID;
    alertEpisode.postUpdatesToWorkspaceChannels = [CHANNEL];
    jest
      .spyOn(AlertEpisodeService, "findOneById")
      .mockResolvedValue(alertEpisode);

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.projectId = PROJECT_ID;
    event.title = "Database upgrade";
    event.scheduledMaintenanceNumber = 5;
    event.scheduledMaintenanceNumberWithPrefix = "SM-5";
    jest.spyOn(ScheduledMaintenanceService, "findOneById").mockResolvedValue(event);
    jest
      .spyOn(ScheduledMaintenanceService, "isScheduledMaintenanceCompleted")
      .mockResolvedValue(false);

    const monitor: Monitor = new Monitor();
    monitor.projectId = PROJECT_ID;
    monitor.name = "API Health";
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.projectId = PROJECT_ID;
    policy.name = "Primary";
    jest.spyOn(OnCallDutyPolicyService, "findOneById").mockResolvedValue(policy);

    const alertState: WorkspaceRecordChannelState | null =
      await WorkspaceRecordChannels.read({ alertId: RECORD_ID });
    expect(alertState).toMatchObject({
      eventType: NotificationRuleEventType.Alert,
      channels: [],
      isOngoing: false,
      displayName: "Alert ALT-7",
      title: "Latency",
    });

    expect(
      await WorkspaceRecordChannels.read({ incidentEpisodeId: RECORD_ID }),
    ).toMatchObject({
      eventType: NotificationRuleEventType.IncidentEpisode,
      channels: null,
      // No list, and no time it was created: not set up.
      isSetUp: false,
      isOngoing: true,
      displayName: "Incident Episode IE-3",
    });

    expect(
      await WorkspaceRecordChannels.read({ alertEpisodeId: RECORD_ID }),
    ).toMatchObject({
      eventType: NotificationRuleEventType.AlertEpisode,
      channels: [CHANNEL],
      // No number prefix: written as #4.
      displayName: "Alert Episode #4",
    });

    expect(
      await WorkspaceRecordChannels.read({ scheduledMaintenanceId: RECORD_ID }),
    ).toMatchObject({
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      isOngoing: true,
      isPrivate: false,
      displayName: "Scheduled Maintenance SM-5",
      title: "Database upgrade",
    });

    expect(
      await WorkspaceRecordChannels.read({ monitorId: RECORD_ID }),
    ).toMatchObject({
      eventType: NotificationRuleEventType.Monitor,
      isOngoing: true,
      displayName: "Monitor API Health",
      // Its name says it already.
      title: "",
      channelNameParts: WorkspaceChannelName.forNamedRecord({
        eventType: NotificationRuleEventType.Monitor,
        name: "API Health",
      }),
    });

    expect(
      await WorkspaceRecordChannels.read({ onCallDutyPolicyId: RECORD_ID }),
    ).toMatchObject({
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      displayName: "On-Call Policy Primary",
      title: "",
    });
  });
});

describe("WorkspaceRecordChannels.store", () => {
  test.each([
    ["incidentId", IncidentService],
    ["alertId", AlertService],
    ["incidentEpisodeId", IncidentEpisodeService],
    ["alertEpisodeId", AlertEpisodeService],
    ["scheduledMaintenanceId", ScheduledMaintenanceService],
    ["monitorId", MonitorService],
    ["onCallDutyPolicyId", OnCallDutyPolicyService],
  ] as Array<[keyof WorkspaceRecord, unknown]>)(
    "%s: stored on the record, as OneUptime",
    async (field: keyof WorkspaceRecord, service: unknown) => {
      const updates: Array<JSONObject> = [];
      jest
        .spyOn(service as never, "updateOneById" as never)
        .mockImplementation((async (data: JSONObject) => {
          updates.push(data);
        }) as never);

      await WorkspaceRecordChannels.store({
        record: { [field]: RECORD_ID },
        channels: [CHANNEL],
      });

      expect(updates).toEqual([
        {
          id: RECORD_ID,
          data: { postUpdatesToWorkspaceChannels: [CHANNEL] },
          props: { isRoot: true },
        },
      ]);
    },
  );
});

describe("WorkspaceRecordChannels.isSetUp", () => {
  test("a list of channels says the setup ran, an empty one too", () => {
    expect(
      WorkspaceRecordChannels.isSetUp({ channels: [], createdAt: new Date() }),
    ).toBe(true);
    expect(
      WorkspaceRecordChannels.isSetUp({
        channels: [CHANNEL],
        createdAt: undefined,
      }),
    ).toBe(true);
  });

  test("without a list, only a record older than the setup window", () => {
    const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
      return new Date(Date.now() - minutes * 60 * 1000);
    };

    expect(
      WorkspaceRecordChannels.isSetUp({
        channels: null,
        createdAt: minutesAgo(1),
      }),
    ).toBe(false);
    expect(
      WorkspaceRecordChannels.isSetUp({
        channels: undefined,
        createdAt: minutesAgo(RECORD_CHANNEL_SETUP_WINDOW_IN_MINUTES + 1),
      }),
    ).toBe(true);
    expect(
      WorkspaceRecordChannels.isSetUp({ channels: null, createdAt: null }),
    ).toBe(false);
  });
});

describe("WorkspaceRecordChannels.channelsOf", () => {
  test("a stored list, or null when nothing was stored", () => {
    expect(WorkspaceRecordChannels.channelsOf([CHANNEL])).toEqual([CHANNEL]);
    expect(WorkspaceRecordChannels.channelsOf([])).toEqual([]);
    expect(WorkspaceRecordChannels.channelsOf(undefined)).toBeNull();
    expect(WorkspaceRecordChannels.channelsOf(null)).toBeNull();
    expect(WorkspaceRecordChannels.channelsOf({ id: "C0A" })).toBeNull();
  });
});

describe("WorkspaceRecordChannels.runExclusive", () => {
  test("runs under the record's lock and gives it back", async () => {
    const lockKeys: Array<string> = [];
    jest
      .spyOn(Semaphore, "lock")
      .mockImplementation((async (data: { key: string; namespace: string }) => {
        lockKeys.push(`${data.namespace}:${data.key}`);
        return { identifier: "held" } as never;
      }) as never);
    let released: number = 0;
    jest.spyOn(Semaphore, "release").mockImplementation((async () => {
      released++;
    }) as never);

    expect(
      await WorkspaceRecordChannels.runExclusive(
        { incidentId: RECORD_ID },
        async (): Promise<string> => {
          return "opened";
        },
      ),
    ).toBe("opened");

    expect(lockKeys).toEqual([
      `${WORKSPACE_RECORD_CHANNELS_LOCK_NAMESPACE}:${RECORD_ID.toString()}`,
    ]);
    expect(released).toBe(1);
  });

  test("gives the lock back when what it runs fails", async () => {
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ identifier: "held" } as never);
    let released: number = 0;
    jest.spyOn(Semaphore, "release").mockImplementation((async () => {
      released++;
    }) as never);

    await expect(
      WorkspaceRecordChannels.runExclusive(
        { alertId: RECORD_ID },
        async (): Promise<void> => {
          throw new Error("Slack is down");
        },
      ),
    ).rejects.toThrow("Slack is down");

    expect(released).toBe(1);
  });

  test("leaves it to the change that holds the lock: runs nothing", async () => {
    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new SemaphoreLockTimeoutError("held") as never);
    let ran: boolean = false;

    expect(
      await WorkspaceRecordChannels.runExclusive(
        { incidentId: RECORD_ID },
        async (): Promise<void> => {
          ran = true;
        },
      ),
    ).toBeNull();
    expect(ran).toBe(false);
  });

  test("without Valkey, runs unlocked", async () => {
    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("Redis client is not connected") as never);
    let released: number = 0;
    jest.spyOn(Semaphore, "release").mockImplementation((async () => {
      released++;
    }) as never);

    expect(
      await WorkspaceRecordChannels.runExclusive(
        { monitorId: RECORD_ID },
        async (): Promise<number> => {
          return 1;
        },
      ),
    ).toBe(1);
    expect(released).toBe(0);
  });

  test("no record, nothing run", async () => {
    let ran: boolean = false;

    expect(
      await WorkspaceRecordChannels.runExclusive(
        {},
        async (): Promise<void> => {
          ran = true;
        },
      ),
    ).toBeNull();
    expect(ran).toBe(false);
  });
});
