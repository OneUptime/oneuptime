import Semaphore from "../../../Server/Infrastructure/Semaphore";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import UserService from "../../../Server/Services/UserService";
import StateChangePublicNote from "../../../Server/Utils/StatusPage/StateChangePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import StateChangeSubscriberNotification from "../../../Types/StatusPage/StateChangeSubscriberNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A STATE CHANGE WITH A PUBLIC NOTE IS SAVED WHOLE, OR NOT AT ALL.
 *
 * With "Notify Status Page Subscribers" on, the public note posted with a
 * state change is the one message subscribers get about it: the change is
 * recorded as sent by its note (StateChangeSubscriberNotification). So the
 * note has to be posted whenever the change is saved.
 *
 * The incident timeline posts its note once the change is saved
 * (onCreateSuccess), as the person changing the state, so that the note
 * comes after the change in the incident feed and in Slack. A custom role
 * that may change an incident's state (Create Incident State Timeline) but
 * not post public notes (Create Incident Public Note) had the change saved
 * and recorded as sent by a note that was then refused: nobody was told
 * (found in #4411).
 *
 * The incident timeline now asks up front, with the very check the note's
 * create runs, and refuses the whole change with a plain message - the way a
 * scheduled maintenance change has always been refused, whose note is
 * posted first (it now asks up front too, for the same message). These run
 * the real hooks with the real permission check, role by role, and then the
 * real create pipeline over in-memory tables, to show what is saved.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4c000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("4c000000-0000-4000-8000-000000000002");
const INCIDENT_ID: ObjectID = new ObjectID(
  "4c000000-0000-4000-8000-000000000003",
);
const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "4c000000-0000-4000-8000-000000000004",
);
const EVENT_ID: ObjectID = new ObjectID("4c000000-0000-4000-8000-000000000005");
const ONGOING_STATE_ID: ObjectID = new ObjectID(
  "4c000000-0000-4000-8000-000000000006",
);

const STARTS_AT: Date = new Date("2026-10-05T09:00:00.000Z");
const NOTE: string = "We have found the cause and are rolling back.";

// The permissions a public note on each event takes, as the API words them.
const INCIDENT_NOTE_PERMISSIONS: string =
  "You do not have permissions to create Incident Public Note. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident Status Page Note. To change the state, leave the public note out.";
const MAINTENANCE_NOTE_PERMISSIONS: string =
  "You do not have permissions to create Scheduled Event Public Note. You need one of these permissions: Project Owner, Project Admin, Project Member, Scheduled Maintenance Admin, Scheduled Maintenance Member, Create Scheduled Maintenance Status Page Note. To change the state, leave the public note out.";

interface RoleCase {
  role: string;
  allow: Array<Permission>;
  block?: Array<Permission>;
  // Whether the role may post the public note the change comes with.
  mayPostTheNote: boolean;
}

/*
 * Who may change an incident's state, and whether they may post the note
 * with it. Every role here may create the state change itself.
 */
const INCIDENT_ROLES: Array<RoleCase> = [
  {
    role: "Project Owner",
    allow: [Permission.ProjectOwner],
    mayPostTheNote: true,
  },
  {
    role: "Project Admin",
    allow: [Permission.ProjectAdmin],
    mayPostTheNote: true,
  },
  {
    role: "Project Member",
    allow: [Permission.ProjectMember],
    mayPostTheNote: true,
  },
  {
    role: "Incident Admin",
    allow: [Permission.IncidentAdmin],
    mayPostTheNote: true,
  },
  {
    role: "Incident Member",
    allow: [Permission.IncidentMember],
    mayPostTheNote: true,
  },
  {
    role: "Create Incident State Timeline and Create Incident Public Note",
    allow: [
      Permission.CreateIncidentStateTimeline,
      Permission.CreateIncidentPublicNote,
    ],
    mayPostTheNote: true,
  },
  {
    role: "Create Incident State Timeline only",
    allow: [Permission.CreateIncidentStateTimeline],
    mayPostTheNote: false,
  },
  {
    role: "Incident Member, with Create Incident Public Note blocked",
    allow: [Permission.IncidentMember],
    block: [Permission.CreateIncidentPublicNote],
    mayPostTheNote: false,
  },
];

const MAINTENANCE_ROLES: Array<RoleCase> = [
  {
    role: "Project Owner",
    allow: [Permission.ProjectOwner],
    mayPostTheNote: true,
  },
  {
    role: "Project Member",
    allow: [Permission.ProjectMember],
    mayPostTheNote: true,
  },
  {
    role: "Scheduled Maintenance Admin",
    allow: [Permission.ScheduledMaintenanceAdmin],
    mayPostTheNote: true,
  },
  {
    role: "Scheduled Maintenance Member",
    allow: [Permission.ScheduledMaintenanceMember],
    mayPostTheNote: true,
  },
  {
    role: "Create Scheduled Maintenance State Timeline and Create Scheduled Maintenance Public Note",
    allow: [
      Permission.CreateScheduledMaintenanceStateTimeline,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    mayPostTheNote: true,
  },
  {
    role: "Create Scheduled Maintenance State Timeline only",
    allow: [Permission.CreateScheduledMaintenanceStateTimeline],
    mayPostTheNote: false,
  },
  {
    role: "Scheduled Maintenance Member, with Create Scheduled Maintenance Public Note blocked",
    allow: [Permission.ScheduledMaintenanceMember],
    block: [Permission.CreateScheduledMaintenancePublicNote],
    mayPostTheNote: false,
  },
];

function userPermission(
  permission: Permission,
  isBlockPermission: boolean,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
    scope: PermissionScope.All,
  };
}

// A member of the project with these permissions, asking in it.
function memberProps(roleCase: {
  allow: Array<Permission>;
  block?: Array<Permission> | undefined;
}): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      ...[
        Permission.CurrentUser,
        Permission.ProjectUser,
        ...roleCase.allow,
      ].map((permission: Permission): UserPermission => {
        return userPermission(permission, false);
      }),
      ...(roleCase.block || []).map(
        (permission: Permission): UserPermission => {
          return userPermission(permission, true);
        },
      ),
    ],
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

type Hook = (input: unknown, second?: unknown) => Promise<unknown>;

function hookOf(service: unknown, name: string): Hook {
  return (service as Record<string, Hook>)[name]!.bind(service);
}

interface OnBeforeCreateResult<TModel> {
  createBy: { data: TModel; props: DatabaseCommonInteractionProps };
  carryForward: Record<string, unknown>;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

function incidentStateChange(
  notify: boolean | undefined,
): IncidentStateTimeline {
  const timeline: IncidentStateTimeline = new IncidentStateTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.incidentId = INCIDENT_ID;
  timeline.incidentStateId = ACKNOWLEDGED_STATE_ID;
  timeline.startsAt = STARTS_AT;

  if (notify !== undefined) {
    timeline.shouldStatusPageSubscribersBeNotified = notify;
  }

  return timeline;
}

function maintenanceStateChange(
  notify: boolean | undefined,
): ScheduledMaintenanceStateTimeline {
  const timeline: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.scheduledMaintenanceId = EVENT_ID;
  timeline.scheduledMaintenanceStateId = ONGOING_STATE_ID;
  timeline.startsAt = STARTS_AT;

  if (notify !== undefined) {
    timeline.shouldStatusPageSubscribersBeNotified = notify;
  }

  return timeline;
}

function withNote(note: string | undefined): JSONObject {
  return note === undefined ? {} : { publicNote: note };
}

let release: jest.SpyInstance;

beforeEach(() => {
  /*
   * The project's incident and alert states: open records are read by
   * the states that are not resolved (Common/Utils/ResolvedState).
   */
  mockProjectStates();
  stubProjectDirectory({});
  getJestSpyOn(Semaphore, "lock").mockResolvedValue({
    key: "state-change",
  });
  release = getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
  getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
    "[Ada Lovelace](mailto:ada@example.com)",
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StateChangePublicNote.getRefusalMessage", () => {
  test("says the state was not changed, why, and how to change it anyway", () => {
    expect(
      StateChangePublicNote.getRefusalMessage(
        "You do not have permissions to create Incident Public Note.",
      ),
    ).toBe(
      "The state was not changed: it comes with a public note, which you may not post. You do not have permissions to create Incident Public Note. To change the state, leave the public note out.",
    );
  });

  test("ends a reason that does not end its sentence, so the sentences stay apart", () => {
    expect(
      StateChangePublicNote.getRefusalMessage(
        "  You need one of these permissions: Project Owner  ",
      ),
    ).toBe(
      "The state was not changed: it comes with a public note, which you may not post. You need one of these permissions: Project Owner. To change the state, leave the public note out.",
    );
  });
});

describe("an incident state change with a public note, role by role", () => {
  let findTimelines: jest.SpyInstance;

  beforeEach(() => {
    // The incident's only state so far is before this one.
    findTimelines = getJestSpyOn(
      IncidentStateTimelineService,
      "findOneBy",
    ).mockResolvedValue(null);
  });

  async function changeState(data: {
    props: DatabaseCommonInteractionProps;
    note?: string;
    notify?: boolean;
  }): Promise<OnBeforeCreateResult<IncidentStateTimeline>> {
    return (await hookOf(
      IncidentStateTimelineService,
      "onBeforeCreate",
    )({
      data: incidentStateChange(data.notify ?? true),
      miscDataProps: withNote(data.note),
      props: data.props,
    })) as OnBeforeCreateResult<IncidentStateTimeline>;
  }

  test.each(
    INCIDENT_ROLES.filter((roleCase: RoleCase) => {
      return roleCase.mayPostTheNote;
    }),
  )(
    "$role: the change goes ahead, carrying its note to post once it is saved",
    async (roleCase: RoleCase) => {
      const result: OnBeforeCreateResult<IncidentStateTimeline> =
        await changeState({ props: memberProps(roleCase), note: NOTE });

      // Recorded as sent by its note: the note is the one message.
      expect(result.createBy.data.subscriberNotificationStatus).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );

      const note: IncidentPublicNote = result.carryForward[
        "publicNoteToPost"
      ] as IncidentPublicNote;

      expect(note).toBeInstanceOf(IncidentPublicNote);
      expect(note.note).toBe(NOTE);
      expect(note.incidentId?.toString()).toBe(INCIDENT_ID.toString());
      expect(note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
        true,
      );
      // It is marked as the note of this change, with the state it moved to.
      expect(StateChangePublicNote.getStatePostedWith(note)?.toString()).toBe(
        ACKNOWLEDGED_STATE_ID.toString(),
      );
    },
  );

  test.each(
    INCIDENT_ROLES.filter((roleCase: RoleCase) => {
      return !roleCase.mayPostTheNote;
    }),
  )(
    "$role: the whole change is refused, plainly, before anything is read",
    async (roleCase: RoleCase) => {
      const error: unknown = await rejectionOf(
        changeState({ props: memberProps(roleCase), note: NOTE }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toMatch(
        /^The state was not changed: it comes with a public note, which you may not post\. .+ To change the state, leave the public note out\.$/,
      );
      // The incident's timeline was never read: the refusal came first.
      expect(findTimelines).not.toHaveBeenCalled();
      // The incident's lock is let go.
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  test("a role without the note permission is told which permissions post a public note", async () => {
    const error: unknown = await rejectionOf(
      changeState({
        props: memberProps({ allow: [Permission.CreateIncidentStateTimeline] }),
        note: NOTE,
      }),
    );

    expect((error as Error).message).toContain(
      "You do not have permissions to create Incident Public Note.",
    );
    expect((error as Error).message).toContain(INCIDENT_NOTE_PERMISSIONS);
  });

  test("a blocked note permission is named as the reason", async () => {
    const error: unknown = await rejectionOf(
      changeState({
        props: memberProps({
          allow: [Permission.IncidentMember],
          block: [Permission.CreateIncidentPublicNote],
        }),
        note: NOTE,
      }),
    );

    expect((error as Error).message).toContain(
      "CreateIncidentPublicNote is in your team's permission block list",
    );
  });

  test("without a note, a role that may not post notes changes the state as before", async () => {
    const result: OnBeforeCreateResult<IncidentStateTimeline> =
      await changeState({
        props: memberProps({ allow: [Permission.CreateIncidentStateTimeline] }),
      });

    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(result.carryForward["publicNoteToPost"]).toBeUndefined();
  });

  test.each([
    ["an empty note", ""],
    ["a note of spaces", "   \n\t"],
  ])(
    "%s is no note: a role that may not post notes changes the state",
    async (_label: string, note: string) => {
      const result: OnBeforeCreateResult<IncidentStateTimeline> =
        await changeState({
          props: memberProps({
            allow: [Permission.CreateIncidentStateTimeline],
          }),
          note: note,
        });

      expect(result.createBy.data.subscriberNotificationStatus).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
    },
  );

  test("with Notify off, a role that may not post notes is still refused: the note would be posted", async () => {
    const error: unknown = await rejectionOf(
      changeState({
        props: memberProps({ allow: [Permission.CreateIncidentStateTimeline] }),
        note: NOTE,
        notify: false,
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("OneUptime's own changes (root) are not asked", async () => {
    const result: OnBeforeCreateResult<IncidentStateTimeline> =
      await changeState({
        props: { isRoot: true, tenantId: PROJECT_ID },
        note: NOTE,
      });

    expect(result.carryForward["publicNoteToPost"]).toBeInstanceOf(
      IncidentPublicNote,
    );
  });
});

describe("a scheduled maintenance state change with a public note, role by role", () => {
  let createNote: jest.SpyInstance;
  let findTimelines: jest.SpyInstance;

  beforeEach(() => {
    findTimelines = getJestSpyOn(
      ScheduledMaintenanceStateTimelineService,
      "findOneBy",
    ).mockResolvedValue(null);

    createNote = getJestSpyOn(
      ScheduledMaintenancePublicNoteService,
      "create",
    ).mockImplementation(async (input: unknown) => {
      return (input as { data: ScheduledMaintenancePublicNote }).data;
    });
  });

  async function changeState(data: {
    props: DatabaseCommonInteractionProps;
    note?: string;
  }): Promise<OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>> {
    return (await hookOf(
      ScheduledMaintenanceStateTimelineService,
      "onBeforeCreate",
    )({
      data: maintenanceStateChange(true),
      miscDataProps: withNote(data.note),
      props: data.props,
    })) as OnBeforeCreateResult<ScheduledMaintenanceStateTimeline>;
  }

  test.each(
    MAINTENANCE_ROLES.filter((roleCase: RoleCase) => {
      return roleCase.mayPostTheNote;
    }),
  )(
    "$role: the note is posted, marked with the state the event moved to",
    async (roleCase: RoleCase) => {
      const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
        await changeState({ props: memberProps(roleCase), note: NOTE });

      expect(createNote).toHaveBeenCalledTimes(1);

      const note: ScheduledMaintenancePublicNote = (
        createNote.mock.calls[0]![0] as { data: ScheduledMaintenancePublicNote }
      ).data;

      expect(note.note).toBe(NOTE);
      expect(StateChangePublicNote.getStatePostedWith(note)?.toString()).toBe(
        ONGOING_STATE_ID.toString(),
      );
      expect(result.createBy.data.subscriberNotificationStatus).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );
    },
  );

  test.each(
    MAINTENANCE_ROLES.filter((roleCase: RoleCase) => {
      return !roleCase.mayPostTheNote;
    }),
  )(
    "$role: the whole change is refused with the same plain message, before the note or anything else",
    async (roleCase: RoleCase) => {
      const error: unknown = await rejectionOf(
        changeState({ props: memberProps(roleCase), note: NOTE }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toMatch(
        /^The state was not changed: it comes with a public note, which you may not post\. .+ To change the state, leave the public note out\.$/,
      );
      expect(createNote).not.toHaveBeenCalled();
      expect(findTimelines).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  test("a role without the note permission is told which permissions post a public note", async () => {
    const error: unknown = await rejectionOf(
      changeState({
        props: memberProps({
          allow: [Permission.CreateScheduledMaintenanceStateTimeline],
        }),
        note: NOTE,
      }),
    );

    expect((error as Error).message).toContain(MAINTENANCE_NOTE_PERMISSIONS);
  });

  test("without a note, a role that may not post notes changes the state as before", async () => {
    const result: OnBeforeCreateResult<ScheduledMaintenanceStateTimeline> =
      await changeState({
        props: memberProps({
          allow: [Permission.CreateScheduledMaintenanceStateTimeline],
        }),
      });

    expect(createNote).not.toHaveBeenCalled();
    expect(result.createBy.data.subscriberNotificationStatus).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });
});

/*
 * The real create pipeline - DatabaseService's checks, the hooks, the save,
 * the success hooks, and the note's own create through all of the same -
 * over in-memory tables, for an incident.
 */
describe("what an incident state change with a public note saves", () => {
  let timelines: InMemoryTable;
  let notes: InMemoryTable;

  beforeEach(() => {
    timelines = useInMemoryTable(IncidentStateTimelineService, []);
    notes = useInMemoryTable(IncidentPublicNoteService, []);

    const acknowledged: IncidentState = new IncidentState();
    acknowledged._id = ACKNOWLEDGED_STATE_ID.toString();
    acknowledged.name = "Acknowledged";
    acknowledged.isAcknowledgedState = true;
    acknowledged.isResolvedState = false;
    acknowledged.isCreatedState = false;

    getJestSpyOn(IncidentStateService, "findOneBy").mockResolvedValue(
      acknowledged,
    );
    getJestSpyOn(IncidentService, "updateOneBy").mockResolvedValue(1);
    getJestSpyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 42,
      numberWithPrefix: "INC-42",
    });
    getJestSpyOn(
      IncidentService,
      "getIncidentLinkInDashboard",
    ).mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/incidents/42"),
    );
    getJestSpyOn(IncidentService, "refreshIncidentMetrics").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      IncidentMeasurementValueService,
      "recomputeForIncident",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentFeedService,
      "createIncidentFeedItem",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentAlertService,
      "cascadeIncidentStateToLinkedAlerts",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentStateTimelineService,
      "autoAssignIncidentCommander",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentStateTimelineService,
      "trackSlaStateChange",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentStateTimelineService,
      "isLastIncidentState",
    ).mockResolvedValue(false);
  });

  /*
   * Postgres fills a column the insert left out with its default and hands
   * it back (INSERT ... RETURNING), so the saved row reads it: a change that
   * did not say whether to notify reads as notifying, and as queued.
   */
  function withColumnDefaults(table: InMemoryTable, defaults: StoredRow): void {
    const save: (entity: unknown) => Promise<unknown> =
      table.repository.save.getMockImplementation() as (
        entity: unknown,
      ) => Promise<unknown>;

    table.repository.save.mockImplementation(async (entity: unknown) => {
      for (const [column, value] of Object.entries(defaults)) {
        if ((entity as StoredRow)[column] === undefined) {
          (entity as StoredRow)[column] = value;
        }
      }

      return save(entity);
    });
  }

  async function changeState(data: {
    props: DatabaseCommonInteractionProps;
    notify?: boolean | undefined;
  }): Promise<unknown> {
    return IncidentStateTimelineService.create({
      data: incidentStateChange(data.notify),
      miscDataProps: withNote(NOTE),
      props: data.props,
    });
  }

  test("a role that may not post the note: nothing is saved, neither the change nor the note", async () => {
    const error: unknown = await rejectionOf(
      changeState({
        props: memberProps({ allow: [Permission.CreateIncidentStateTimeline] }),
        notify: true,
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(timelines.inserts).toEqual([]);
    expect(notes.inserts).toEqual([]);
  });

  test("a role that may: the change is saved as sent by its note, and the note is saved to tell subscribers, naming the state", async () => {
    await changeState({
      props: memberProps({ allow: [Permission.IncidentMember] }),
      notify: true,
    });

    expect(timelines.inserts).toHaveLength(1);
    expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(timelines.inserts[0]!["subscriberNotificationStatusMessage"]).toBe(
      StateChangeSubscriberNotification.sentByPublicNoteMessage,
    );

    expect(notes.inserts).toHaveLength(1);
    const note: StoredRow = notes.inserts[0]!;
    expect(note["note"]).toBe(NOTE);
    expect(String(note["incidentId"])).toBe(INCIDENT_ID.toString());
    expect(String(note["projectId"])).toBe(PROJECT_ID.toString());
    expect(note["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"]).toBe(
      true,
    );
    expect(note["subscriberNotificationStatusOnNoteCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(String(note["postedWithIncidentStateId"])).toBe(
      ACKNOWLEDGED_STATE_ID.toString(),
    );
    // Posted at the change's time, by the person who changed the state.
    expect(note["postedAt"]).toEqual(STARTS_AT);
    expect(String(note["createdByUserId"])).toBe(USER_ID.toString());
  });

  test("a change that does not say whether to notify tells subscribers once: the change, by its column default, with its note kept quiet", async () => {
    withColumnDefaults(timelines, {
      shouldStatusPageSubscribersBeNotified: true,
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Pending,
    });

    await changeState({
      props: memberProps({ allow: [Permission.IncidentMember] }),
      notify: undefined,
    });

    // The change is queued by its defaults...
    expect(timelines.inserts[0]!["shouldStatusPageSubscribersBeNotified"]).toBe(
      true,
    );
    expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );

    // ...so its note does not notify as well: one message, not two.
    expect(notes.inserts).toHaveLength(1);
    expect(
      notes.inserts[0]!["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"],
    ).toBe(false);
    expect(notes.inserts[0]!["subscriberNotificationStatusOnNoteCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("with Notify off, the note is saved quietly and the change is skipped", async () => {
    await changeState({
      props: memberProps({ allow: [Permission.IncidentMember] }),
      notify: false,
    });

    expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(
      notes.inserts[0]!["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"],
    ).toBe(false);
  });
});
