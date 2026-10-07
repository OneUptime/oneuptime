import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeInternalNoteService from "../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertInternalNoteService from "../../../Server/Services/AlertInternalNoteService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeInternalNoteService from "../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import UserService from "../../../Server/Services/UserService";
import StateChangeNote, {
  StateChangeNoteType,
} from "../../../Server/Utils/StateChangeNote";
import StateChangePublicNote from "../../../Server/Utils/StatusPage/StateChangePublicNote";
import AlertEpisodeInternalNote from "../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
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
 * A STATE CHANGE WITH A PRIVATE NOTE IS SAVED WHOLE, OR NOT AT ALL.
 *
 * Moving an alert, an alert episode or an incident episode to another state
 * can carry a private note ("Add a private note" in the state change
 * dialogs, the Change State bulk action, `miscDataProps.privateNote` over the
 * API). The note is posted once the change is saved, as the person changing
 * the state, so that it comes after the change in the feed. Changing the
 * state and posting a private note are separate permissions, and someone who
 * had the first but not the second used to get the change saved and then an
 * error for the note - a change they were told had failed had gone through.
 *
 * Each of those timelines now asks first, in onBeforeCreate, with the very
 * check the note's own create runs (Server/Utils/StateChangeNote), and
 * refuses the whole change with one plain message - as the incident and
 * scheduled maintenance timelines do for their public note. These run the
 * real hooks with the real permission check, role by role, and then the
 * real create pipeline over in-memory tables, to show what is saved.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("4d000000-0000-4000-8000-000000000002");
const EVENT_ID: ObjectID = new ObjectID("4d000000-0000-4000-8000-000000000003");
const STATE_ID: ObjectID = new ObjectID("4d000000-0000-4000-8000-000000000004");
const CREATED_STATE_ID: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000005",
);
const PREVIOUS_TIMELINE_ID: ObjectID = new ObjectID(
  "4d000000-0000-4000-8000-000000000006",
);

const CREATED_AT: Date = new Date("2026-10-06T08:00:00.000Z");
const STARTS_AT: Date = new Date("2026-10-06T09:00:00.000Z");
const NOTE: string = "Rolled back the deploy; watching the error rate.";

interface RoleCase {
  role: string;
  allow: Array<Permission>;
  block?: Array<Permission> | undefined;
}

interface TimelineCase {
  // The event, as the tests name it.
  event: string;
  timelineService: DatabaseService<BaseModel>;
  noteService: DatabaseService<BaseModel>;
  noteModelType: { new (): BaseModel };
  // The note's column naming the event.
  eventColumn: string;
  // How the API names the note and its permissions in a refusal.
  noteRefusal: string;
  buildStateChange: () => BaseModel;
  // The event's state before the change, as its timeline stores it.
  previousState: StoredRow;
  // Every role here may create the state change itself.
  rolesThatMayPost: Array<RoleCase>;
  rolesThatMayNot: Array<RoleCase>;
  // What the success hooks read and write besides the two tables.
  stubSideEffects: () => void;
}

const ALERT_CASE: TimelineCase = {
  event: "an alert",
  timelineService:
    AlertStateTimelineService as unknown as DatabaseService<BaseModel>,
  noteService:
    AlertInternalNoteService as unknown as DatabaseService<BaseModel>,
  noteModelType: AlertInternalNote,
  eventColumn: "alertId",
  noteRefusal:
    "You do not have permissions to create Alert Internal Note. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin, Alert Member, Create Alert Internal Note.",
  buildStateChange: (): BaseModel => {
    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.alertId = EVENT_ID;
    timeline.alertStateId = STATE_ID;
    timeline.startsAt = STARTS_AT;
    return timeline;
  },
  previousState: {
    _id: PREVIOUS_TIMELINE_ID.toString(),
    projectId: PROJECT_ID.toString(),
    alertId: EVENT_ID.toString(),
    alertStateId: CREATED_STATE_ID.toString(),
    startsAt: CREATED_AT,
  },
  rolesThatMayPost: [
    { role: "Project Owner", allow: [Permission.ProjectOwner] },
    { role: "Project Admin", allow: [Permission.ProjectAdmin] },
    { role: "Project Member", allow: [Permission.ProjectMember] },
    { role: "Alert Admin", allow: [Permission.AlertAdmin] },
    { role: "Alert Member", allow: [Permission.AlertMember] },
    /*
     * A state change and its note are created only under an alert their
     * creator may read: the narrowest role reads alerts too.
     */
    {
      role: "Read Alert, Create Alert State Timeline and Create Alert Internal Note",
      allow: [
        Permission.ReadAlert,
        Permission.CreateAlertStateTimeline,
        Permission.CreateAlertInternalNote,
      ],
    },
  ],
  rolesThatMayNot: [
    {
      role: "Read Alert and Create Alert State Timeline only",
      allow: [Permission.ReadAlert, Permission.CreateAlertStateTimeline],
    },
    {
      role: "Alert Member, with Create Alert Internal Note blocked",
      allow: [Permission.AlertMember],
      block: [Permission.CreateAlertInternalNote],
    },
  ],
  stubSideEffects: (): void => {
    const acknowledged: AlertState = new AlertState();
    acknowledged._id = STATE_ID.toString();
    acknowledged.name = "Acknowledged";
    acknowledged.isAcknowledgedState = true;

    getJestSpyOn(AlertStateService, "findOneBy").mockResolvedValue(
      acknowledged,
    );
    getJestSpyOn(AlertService, "updateOneBy").mockResolvedValue(1);
    getJestSpyOn(AlertService, "getAlertNumber").mockResolvedValue({
      number: 7,
      numberWithPrefix: "ALT-7",
    });
    getJestSpyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/alerts/7"),
    );
    getJestSpyOn(AlertService, "refreshAlertMetrics").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      AlertMeasurementValueService,
      "recomputeForAlert",
    ).mockResolvedValue(undefined);
    getJestSpyOn(AlertFeedService, "createAlertFeedItem").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      AlertStateTimelineService as never,
      "isLastAlertState",
    ).mockResolvedValue(false as never);
  },
};

const ALERT_EPISODE_CASE: TimelineCase = {
  event: "an alert episode",
  timelineService:
    AlertEpisodeStateTimelineService as unknown as DatabaseService<BaseModel>,
  noteService:
    AlertEpisodeInternalNoteService as unknown as DatabaseService<BaseModel>,
  noteModelType: AlertEpisodeInternalNote,
  eventColumn: "alertEpisodeId",
  noteRefusal:
    "You do not have permissions to create Alert Episode Internal Note. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin, Alert Member, Create Alert Episode Internal Note.",
  buildStateChange: (): BaseModel => {
    const timeline: AlertEpisodeStateTimeline = new AlertEpisodeStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.alertEpisodeId = EVENT_ID;
    timeline.alertStateId = STATE_ID;
    timeline.startsAt = STARTS_AT;
    return timeline;
  },
  previousState: {
    _id: PREVIOUS_TIMELINE_ID.toString(),
    projectId: PROJECT_ID.toString(),
    alertEpisodeId: EVENT_ID.toString(),
    alertStateId: CREATED_STATE_ID.toString(),
    startsAt: CREATED_AT,
  },
  rolesThatMayPost: [
    { role: "Project Owner", allow: [Permission.ProjectOwner] },
    { role: "Project Member", allow: [Permission.ProjectMember] },
    { role: "Alert Admin", allow: [Permission.AlertAdmin] },
    { role: "Alert Member", allow: [Permission.AlertMember] },
    {
      role: "Read Alert Episode, Create Alert Episode State Timeline and Create Alert Episode Internal Note",
      allow: [
        Permission.ReadAlertEpisode,
        Permission.CreateAlertEpisodeStateTimeline,
        Permission.CreateAlertEpisodeInternalNote,
      ],
    },
  ],
  rolesThatMayNot: [
    {
      role: "Read Alert Episode and Create Alert Episode State Timeline only",
      allow: [
        Permission.ReadAlertEpisode,
        Permission.CreateAlertEpisodeStateTimeline,
      ],
    },
    {
      role: "Alert Member, with Create Alert Episode Internal Note blocked",
      allow: [Permission.AlertMember],
      block: [Permission.CreateAlertEpisodeInternalNote],
    },
  ],
  stubSideEffects: (): void => {
    const acknowledged: AlertState = new AlertState();
    acknowledged._id = STATE_ID.toString();
    acknowledged.name = "Acknowledged";
    acknowledged.isAcknowledgedState = true;
    acknowledged.isResolvedState = false;

    getJestSpyOn(AlertStateService, "findOneById").mockResolvedValue(
      acknowledged,
    );
    getJestSpyOn(AlertStateService, "findOneBy").mockResolvedValue(
      acknowledged,
    );
    getJestSpyOn(AlertEpisodeService, "updateOneBy").mockResolvedValue(1);
    getJestSpyOn(
      AlertEpisodeService,
      "cascadeStateToMemberAlerts",
    ).mockResolvedValue(undefined);
    getJestSpyOn(AlertEpisodeService, "findOneById").mockResolvedValue(null);
    getJestSpyOn(AlertEpisodeService, "getEpisodeNumber").mockResolvedValue({
      number: 3,
      numberWithPrefix: "AE-3",
    });
    getJestSpyOn(
      AlertEpisodeService,
      "getEpisodeLinkInDashboard",
    ).mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/alert-episodes/3"),
    );
    getJestSpyOn(
      AlertEpisodeFeedService,
      "createAlertEpisodeFeedItem",
    ).mockResolvedValue(undefined);
  },
};

const INCIDENT_EPISODE_CASE: TimelineCase = {
  event: "an incident episode",
  timelineService:
    IncidentEpisodeStateTimelineService as unknown as DatabaseService<BaseModel>,
  noteService:
    IncidentEpisodeInternalNoteService as unknown as DatabaseService<BaseModel>,
  noteModelType: IncidentEpisodeInternalNote,
  eventColumn: "incidentEpisodeId",
  noteRefusal:
    "You do not have permissions to create Incident Episode Internal Note. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident Episode Internal Note.",
  buildStateChange: (): BaseModel => {
    const timeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.incidentEpisodeId = EVENT_ID;
    timeline.incidentStateId = STATE_ID;
    timeline.startsAt = STARTS_AT;
    return timeline;
  },
  previousState: {
    _id: PREVIOUS_TIMELINE_ID.toString(),
    projectId: PROJECT_ID.toString(),
    incidentEpisodeId: EVENT_ID.toString(),
    incidentStateId: CREATED_STATE_ID.toString(),
    startsAt: CREATED_AT,
  },
  rolesThatMayPost: [
    { role: "Project Owner", allow: [Permission.ProjectOwner] },
    { role: "Project Member", allow: [Permission.ProjectMember] },
    { role: "Incident Admin", allow: [Permission.IncidentAdmin] },
    { role: "Incident Member", allow: [Permission.IncidentMember] },
    {
      role: "Read Incident Episode, Create Incident Episode State Timeline and Create Incident Episode Internal Note",
      allow: [
        Permission.ReadIncidentEpisode,
        Permission.CreateIncidentEpisodeStateTimeline,
        Permission.CreateIncidentEpisodeInternalNote,
      ],
    },
  ],
  rolesThatMayNot: [
    {
      role: "Read Incident Episode and Create Incident Episode State Timeline only",
      allow: [
        Permission.ReadIncidentEpisode,
        Permission.CreateIncidentEpisodeStateTimeline,
      ],
    },
    {
      role: "Incident Member, with Create Incident Episode Internal Note blocked",
      allow: [Permission.IncidentMember],
      block: [Permission.CreateIncidentEpisodeInternalNote],
    },
  ],
  stubSideEffects: (): void => {
    const acknowledged: IncidentState = new IncidentState();
    acknowledged._id = STATE_ID.toString();
    acknowledged.name = "Acknowledged";
    acknowledged.isAcknowledgedState = true;
    acknowledged.isResolvedState = false;

    getJestSpyOn(IncidentStateService, "findOneById").mockResolvedValue(
      acknowledged,
    );
    getJestSpyOn(IncidentStateService, "findOneBy").mockResolvedValue(
      acknowledged,
    );
    getJestSpyOn(IncidentEpisodeService, "updateOneBy").mockResolvedValue(1);
    getJestSpyOn(
      IncidentEpisodeService,
      "cascadeStateToMemberIncidents",
    ).mockResolvedValue(undefined);
    getJestSpyOn(IncidentEpisodeService, "findOneById").mockResolvedValue(null);
    getJestSpyOn(IncidentEpisodeService, "getEpisodeNumber").mockResolvedValue({
      number: 5,
      numberWithPrefix: "IE-5",
    });
    getJestSpyOn(
      IncidentEpisodeService,
      "getEpisodeLinkInDashboard",
    ).mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/incident-episodes/5"),
    );
    getJestSpyOn(
      IncidentEpisodeFeedService,
      "createIncidentEpisodeFeedItem",
    ).mockResolvedValue(undefined);
  },
};

const TIMELINE_CASES: Array<[string, TimelineCase]> = [
  ALERT_CASE,
  ALERT_EPISODE_CASE,
  INCIDENT_EPISODE_CASE,
].map((timelineCase: TimelineCase): [string, TimelineCase] => {
  return [timelineCase.event, timelineCase];
});

const PRIVATE_REFUSAL: RegExp =
  /^The state was not changed: it comes with a private note, which you may not post\. .+ To change the state, leave the private note out\.$/;

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

interface OnBeforeCreateResult {
  createBy: { data: BaseModel; props: DatabaseCommonInteractionProps };
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

function withNote(note: unknown): JSONObject {
  return note === undefined ? {} : ({ privateNote: note } as JSONObject);
}

let lock: ReturnType<typeof getJestSpyOn>;
let release: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  /*
   * The project's incident and alert states: open records are read by
   * the states that are not resolved (Common/Utils/ResolvedState).
   */
  mockProjectStates();
  stubProjectDirectory({});
  lock = getJestSpyOn(Semaphore, "lock").mockResolvedValue({
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

describe("StateChangeNote: the private note and its refusal", () => {
  test("a refused change says the state was not changed, why, and to leave the private note out", () => {
    expect(
      StateChangeNote.getRefusalMessage(
        StateChangeNoteType.Private,
        "You do not have permissions to create Alert Internal Note.",
      ),
    ).toBe(
      "The state was not changed: it comes with a private note, which you may not post. You do not have permissions to create Alert Internal Note. To change the state, leave the private note out.",
    );
  });

  test("a reason that does not end its sentence is ended, so the sentences stay apart", () => {
    expect(
      StateChangeNote.getRefusalMessage(
        StateChangeNoteType.Private,
        "  You need one of these permissions: Alert Member  ",
      ),
    ).toBe(
      "The state was not changed: it comes with a private note, which you may not post. You need one of these permissions: Alert Member. To change the state, leave the private note out.",
    );
  });

  test("the public note's refusal reads as it always has", () => {
    expect(StateChangePublicNote.getRefusalMessage("Why.")).toBe(
      "The state was not changed: it comes with a public note, which you may not post. Why. To change the state, leave the public note out.",
    );
    expect(StateChangePublicNote.getRefusalMessage("Why.")).toBe(
      StateChangeNote.getRefusalMessage(StateChangeNoteType.Public, "Why."),
    );
  });

  test.each([
    ["no misc data", undefined, undefined],
    ["no note", {}, undefined],
    ["an empty note", { privateNote: "" }, undefined],
    ["a note of spaces and line breaks", { privateNote: "  \n\t " }, undefined],
    ["a note that is not text", { privateNote: 42 }, undefined],
    ["a note that is an object", { privateNote: { note: NOTE } }, undefined],
    ["a public note only", { publicNote: NOTE }, undefined],
    ["a note", { privateNote: NOTE }, NOTE],
    ["a note with spaces around it, as written", { privateNote: " a " }, " a "],
  ])(
    "%s",
    (
      _label: string,
      miscDataProps: JSONObject | undefined,
      expected: string | undefined,
    ) => {
      expect(StateChangeNote.getPrivateNote(miscDataProps)).toBe(expected);
    },
  );

  test("a note travels under privateNote unless another key is named", () => {
    expect(
      StateChangeNote.getPrivateNote({ internalNote: NOTE }, "internalNote"),
    ).toBe(NOTE);
    expect(StateChangeNote.getPrivateNote({ internalNote: NOTE })).toBe(
      undefined,
    );
    expect(StateChangeNote.privateNoteKey).toBe("privateNote");
    expect(StateChangeNote.legacyAlertInternalNoteKey).toBe("internalNote");
  });

  function alertStateChange(): AlertStateTimeline {
    return ALERT_CASE.buildStateChange() as AlertStateTimeline;
  }

  test("a note is only built - and checked - when there is one: a blank one is none, whoever sends it", () => {
    expect(
      StateChangeNote.preparePrivateNotes({
        noteModelType: AlertInternalNote,
        stateChange: alertStateChange(),
        eventColumn: "alertId",
        miscDataProps: { privateNote: "   " },
        props: memberProps({ allow: [Permission.CreateAlertStateTimeline] }),
      }),
    ).toEqual([]);
  });

  test("the note is the event's, at the time the change starts, in its project", () => {
    const notes: Array<AlertInternalNote> = StateChangeNote.preparePrivateNotes(
      {
        noteModelType: AlertInternalNote,
        stateChange: alertStateChange(),
        eventColumn: "alertId",
        miscDataProps: { privateNote: NOTE },
        props: memberProps({ allow: [Permission.AlertMember] }),
      },
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]!.note).toBe(NOTE);
    expect(notes[0]!.alertId?.toString()).toBe(EVENT_ID.toString());
    expect(notes[0]!.createdAt).toEqual(STARTS_AT);
    expect(notes[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a change that names no project takes the caller's", () => {
    const change: AlertStateTimeline = alertStateChange();
    delete (change as unknown as Record<string, unknown>)["projectId"];

    const notes: Array<AlertInternalNote> = StateChangeNote.preparePrivateNotes(
      {
        noteModelType: AlertInternalNote,
        stateChange: change,
        eventColumn: "alertId",
        miscDataProps: { privateNote: NOTE },
        props: memberProps({ allow: [Permission.AlertMember] }),
      },
    );

    expect(notes[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("one note per key the change carries one under, in the order the keys are named", () => {
    const notes: Array<AlertInternalNote> = StateChangeNote.preparePrivateNotes(
      {
        noteModelType: AlertInternalNote,
        stateChange: alertStateChange(),
        eventColumn: "alertId",
        miscDataProps: { internalNote: "first", privateNote: "second" },
        props: memberProps({ allow: [Permission.AlertMember] }),
        noteKeys: ["internalNote", "privateNote"],
      },
    );

    expect(
      notes.map((note: AlertInternalNote): string | undefined => {
        return note.note;
      }),
    ).toEqual(["first", "second"]);
  });

  test("a column the note does not have is a mistake, said as such - not reworded as a refusal", () => {
    expect(() => {
      StateChangeNote.preparePrivateNotes({
        noteModelType: AlertInternalNote,
        stateChange: alertStateChange(),
        eventColumn: "alertEpisodeId",
        miscDataProps: { privateNote: NOTE },
        props: memberProps({ allow: [Permission.AlertMember] }),
      });
    }).toThrow(BadDataException);
  });

  test("postPrivateNotes posts each note at the saved change's time and project, as the caller", async () => {
    const created: Array<{
      data: AlertInternalNote;
      props: DatabaseCommonInteractionProps;
    }> = [];

    const notes: Array<AlertInternalNote> = StateChangeNote.preparePrivateNotes(
      {
        noteModelType: AlertInternalNote,
        stateChange: alertStateChange(),
        eventColumn: "alertId",
        miscDataProps: { privateNote: NOTE },
        props: { isRoot: true },
      },
    );

    const saved: AlertStateTimeline = alertStateChange();
    saved.startsAt = new Date("2026-10-06T09:00:05.000Z");

    const props: DatabaseCommonInteractionProps = memberProps({
      allow: [Permission.AlertMember],
    });

    await StateChangeNote.postPrivateNotes({
      notes: notes,
      noteService: {
        create: async (createBy: {
          data: AlertInternalNote;
          props: DatabaseCommonInteractionProps;
        }): Promise<AlertInternalNote> => {
          created.push(createBy);
          return createBy.data;
        },
      },
      savedStateChange: saved,
      props: props,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.data.createdAt).toEqual(saved.startsAt);
    expect(created[0]!.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created[0]!.props).toBe(props);
  });

  test("postPrivateNotes with no notes posts nothing", async () => {
    const create: ReturnType<typeof jest.fn> = jest.fn();

    await StateChangeNote.postPrivateNotes({
      notes: undefined,
      noteService: {
        create: create as unknown as (createBy: {
          data: AlertInternalNote;
        }) => Promise<AlertInternalNote>,
      },
      savedStateChange: alertStateChange(),
      props: { isRoot: true },
    });

    expect(create).not.toHaveBeenCalled();
  });
});

describe.each(TIMELINE_CASES)(
  "%s state change with a private note, role by role",
  (_event: string, timelineCase: TimelineCase) => {
    let findTimelines: ReturnType<typeof getJestSpyOn>;

    beforeEach(() => {
      // The event's only state so far is before this one.
      findTimelines = getJestSpyOn(
        timelineCase.timelineService,
        "findOneBy",
      ).mockResolvedValue(null);
    });

    async function changeState(data: {
      props: DatabaseCommonInteractionProps;
      note?: unknown;
    }): Promise<OnBeforeCreateResult> {
      return (await hookOf(
        timelineCase.timelineService,
        "onBeforeCreate",
      )({
        data: timelineCase.buildStateChange(),
        miscDataProps: withNote(data.note),
        props: data.props,
      })) as OnBeforeCreateResult;
    }

    test.each(timelineCase.rolesThatMayPost)(
      "$role: the change goes ahead, carrying its note to post once it is saved",
      async (roleCase: RoleCase) => {
        const result: OnBeforeCreateResult = await changeState({
          props: memberProps(roleCase),
          note: NOTE,
        });

        const notes: Array<BaseModel> = result.carryForward[
          "privateNotesToPost"
        ] as Array<BaseModel>;

        expect(notes).toHaveLength(1);

        const note: BaseModel = notes[0]!;

        expect(note).toBeInstanceOf(timelineCase.noteModelType);

        const written: Record<string, unknown> = note as unknown as Record<
          string,
          unknown
        >;

        expect(written["note"]).toBe(NOTE);
        expect(String(written[timelineCase.eventColumn])).toBe(
          EVENT_ID.toString(),
        );
        expect(String(written["projectId"])).toBe(PROJECT_ID.toString());
        expect(written["createdAt"]).toEqual(STARTS_AT);
        // The text no longer travels on its own.
        expect(result.carryForward["privateNote"]).toBeUndefined();
      },
    );

    test.each(timelineCase.rolesThatMayNot)(
      "$role: the whole change is refused, plainly, before the event is locked or read",
      async (roleCase: RoleCase) => {
        const error: unknown = await rejectionOf(
          changeState({ props: memberProps(roleCase), note: NOTE }),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect((error as Error).message).toMatch(PRIVATE_REFUSAL);
        // The event's timeline was never read: the refusal came first.
        expect(findTimelines).not.toHaveBeenCalled();
        // Nor was the event locked: nothing waits on a change that is refused.
        expect(lock).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
      },
    );

    test("a role that may post takes the event's lock as before", async () => {
      await changeState({
        props: memberProps(timelineCase.rolesThatMayPost[0]!),
        note: NOTE,
      });

      expect(lock).toHaveBeenCalledTimes(1);
    });

    test("a role without the note permission is told which permissions post one", async () => {
      const withoutNotePermission: RoleCase = timelineCase.rolesThatMayNot[0]!;

      const error: unknown = await rejectionOf(
        changeState({ props: memberProps(withoutNotePermission), note: NOTE }),
      );

      expect((error as Error).message).toBe(
        StateChangeNote.getRefusalMessage(
          StateChangeNoteType.Private,
          timelineCase.noteRefusal,
        ),
      );
    });

    test("a blocked note permission is named as the reason", async () => {
      const blocked: RoleCase = timelineCase.rolesThatMayNot[1]!;

      const error: unknown = await rejectionOf(
        changeState({ props: memberProps(blocked), note: NOTE }),
      );

      expect((error as Error).message).toContain(
        `${blocked.block![0]} is in your team's permission block list`,
      );
    });

    test("without a note, a role that may not post notes changes the state as before", async () => {
      const result: OnBeforeCreateResult = await changeState({
        props: memberProps(timelineCase.rolesThatMayNot[0]!),
      });

      expect(result.carryForward["privateNotesToPost"]).toEqual([]);
      expect(findTimelines).toHaveBeenCalled();
    });

    test.each([
      ["an empty note", ""],
      ["a note of spaces", "   \n\t"],
      ["a note that is not text", 42],
    ])(
      "%s is no note: a role that may not post notes changes the state",
      async (_label: string, note: unknown) => {
        const result: OnBeforeCreateResult = await changeState({
          props: memberProps(timelineCase.rolesThatMayNot[0]!),
          note: note,
        });

        expect(result.carryForward["privateNotesToPost"]).toEqual([]);
      },
    );

    test("OneUptime's own changes (root) are not asked", async () => {
      const result: OnBeforeCreateResult = await changeState({
        props: { isRoot: true, tenantId: PROJECT_ID },
        note: NOTE,
      });

      const notes: Array<BaseModel> = result.carryForward[
        "privateNotesToPost"
      ] as Array<BaseModel>;

      expect(notes).toHaveLength(1);
      expect(notes[0]).toBeInstanceOf(timelineCase.noteModelType);
    });
  },
);

/*
 * The real create pipeline - DatabaseService's checks, the hooks, the save,
 * the success hooks, and the note's own create through all of the same -
 * over in-memory tables.
 */
describe.each(TIMELINE_CASES)(
  "what %s state change with a private note saves",
  (_event: string, timelineCase: TimelineCase) => {
    let timelines: InMemoryTable;
    let notes: InMemoryTable;

    beforeEach(() => {
      // The event was created in a state before this one.
      timelines = useInMemoryTable(timelineCase.timelineService, [
        timelineCase.previousState,
      ]);
      notes = useInMemoryTable(timelineCase.noteService, []);

      getJestSpyOn(
        timelineCase.noteService as never,
        "getAttachmentsMarkdown",
      ).mockResolvedValue("" as never);

      timelineCase.stubSideEffects();
    });

    async function changeState(
      props: DatabaseCommonInteractionProps,
      note?: string,
    ): Promise<unknown> {
      return timelineCase.timelineService.create({
        data: timelineCase.buildStateChange(),
        miscDataProps: withNote(note),
        props: props,
      });
    }

    test("a role that may not post the note: nothing is saved, neither the change nor the note", async () => {
      const error: unknown = await rejectionOf(
        changeState(memberProps(timelineCase.rolesThatMayNot[0]!), NOTE),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toMatch(PRIVATE_REFUSAL);
      expect(timelines.inserts).toEqual([]);
      expect(notes.inserts).toEqual([]);
    });

    test("a team that blocks posting the note: nothing is saved either", async () => {
      const error: unknown = await rejectionOf(
        changeState(memberProps(timelineCase.rolesThatMayNot[1]!), NOTE),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(timelines.inserts).toEqual([]);
      expect(notes.inserts).toEqual([]);
    });

    test("a role that may: the change is saved, then its note, on the event, at the change's time, by the person who changed the state", async () => {
      await changeState(memberProps(timelineCase.rolesThatMayPost[0]!), NOTE);

      expect(timelines.inserts).toHaveLength(1);
      expect(notes.inserts).toHaveLength(1);

      const note: StoredRow = notes.inserts[0]!;

      expect(note["note"]).toBe(NOTE);
      expect(String(note[timelineCase.eventColumn])).toBe(EVENT_ID.toString());
      expect(String(note["projectId"])).toBe(PROJECT_ID.toString());
      expect(note["createdAt"]).toEqual(STARTS_AT);
      expect(String(note["createdByUserId"])).toBe(USER_ID.toString());
    });

    test("the narrowest role that may - the two create permissions, and a read of the event - changes the state and posts the note", async () => {
      const narrowest: RoleCase =
        timelineCase.rolesThatMayPost[
          timelineCase.rolesThatMayPost.length - 1
        ]!;

      await changeState(memberProps(narrowest), NOTE);

      expect(timelines.inserts).toHaveLength(1);
      expect(notes.inserts).toHaveLength(1);
    });

    test("without a note, the change is saved and no note is posted", async () => {
      await changeState(memberProps(timelineCase.rolesThatMayNot[0]!));

      expect(timelines.inserts).toHaveLength(1);
      expect(notes.inserts).toEqual([]);
    });
  },
);

/*
 * An alert's private note travelled under `internalNote` before
 * `privateNote`, and an API client may still send it. It is the same note,
 * held to the same rule: checked before the change, posted after it - never
 * created ahead of a change that might still fail.
 */
describe("an alert state change with a note under the older internalNote key", () => {
  const MAY_NOT_POST: RoleCase = ALERT_CASE.rolesThatMayNot[0]!;
  const MAY_POST: RoleCase = ALERT_CASE.rolesThatMayPost[0]!;

  describe("in onBeforeCreate", () => {
    let findTimelines: ReturnType<typeof getJestSpyOn>;

    beforeEach(() => {
      findTimelines = getJestSpyOn(
        AlertStateTimelineService,
        "findOneBy",
      ).mockResolvedValue(null);
    });

    async function changeState(
      props: DatabaseCommonInteractionProps,
      miscDataProps: JSONObject,
    ): Promise<OnBeforeCreateResult> {
      return (await hookOf(
        AlertStateTimelineService,
        "onBeforeCreate",
      )({
        data: ALERT_CASE.buildStateChange(),
        miscDataProps: miscDataProps,
        props: props,
      })) as OnBeforeCreateResult;
    }

    test("a role that may not post private notes is refused whole, with the private note's message, before the alert is locked or read", async () => {
      const error: unknown = await rejectionOf(
        changeState(memberProps(MAY_NOT_POST), { internalNote: NOTE }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(
        StateChangeNote.getRefusalMessage(
          StateChangeNoteType.Private,
          ALERT_CASE.noteRefusal,
        ),
      );
      expect(findTimelines).not.toHaveBeenCalled();
      expect(lock).not.toHaveBeenCalled();
    });

    test("a role that may: the note is carried to be posted after the change, not created before it", async () => {
      const createNote: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        AlertInternalNoteService,
        "create",
      );

      const result: OnBeforeCreateResult = await changeState(
        memberProps(MAY_POST),
        { internalNote: NOTE },
      );

      expect(createNote).not.toHaveBeenCalled();

      const notes: Array<AlertInternalNote> = result.carryForward[
        "privateNotesToPost"
      ] as Array<AlertInternalNote>;

      expect(
        notes.map((note: AlertInternalNote): string | undefined => {
          return note.note;
        }),
      ).toEqual([NOTE]);
    });

    test("a note under each key: both are carried, the older key's first", async () => {
      const result: OnBeforeCreateResult = await changeState(
        memberProps(MAY_POST),
        { internalNote: "Older key.", privateNote: NOTE },
      );

      const notes: Array<AlertInternalNote> = result.carryForward[
        "privateNotesToPost"
      ] as Array<AlertInternalNote>;

      expect(
        notes.map((note: AlertInternalNote): string | undefined => {
          return note.note;
        }),
      ).toEqual(["Older key.", NOTE]);
    });

    test("a blank note under the older key is no note", async () => {
      const result: OnBeforeCreateResult = await changeState(
        memberProps(MAY_NOT_POST),
        { internalNote: "  " },
      );

      expect(result.carryForward["privateNotesToPost"]).toEqual([]);
    });
  });

  describe("what it saves", () => {
    let timelines: InMemoryTable;
    let notes: InMemoryTable;

    beforeEach(() => {
      timelines = useInMemoryTable(ALERT_CASE.timelineService, [
        ALERT_CASE.previousState,
      ]);
      notes = useInMemoryTable(ALERT_CASE.noteService, []);

      getJestSpyOn(
        ALERT_CASE.noteService as never,
        "getAttachmentsMarkdown",
      ).mockResolvedValue("" as never);

      ALERT_CASE.stubSideEffects();
    });

    async function changeState(
      props: DatabaseCommonInteractionProps,
      miscDataProps: JSONObject,
    ): Promise<unknown> {
      return ALERT_CASE.timelineService.create({
        data: ALERT_CASE.buildStateChange(),
        miscDataProps: miscDataProps,
        props: props,
      });
    }

    test("a role that may not post: nothing is saved", async () => {
      const error: unknown = await rejectionOf(
        changeState(memberProps(MAY_NOT_POST), { internalNote: NOTE }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(timelines.inserts).toEqual([]);
      expect(notes.inserts).toEqual([]);
    });

    test("a role that may: the change is saved, then the note, at the change's time, by the person who changed the state", async () => {
      await changeState(memberProps(MAY_POST), { internalNote: NOTE });

      expect(timelines.inserts).toHaveLength(1);
      expect(notes.inserts).toHaveLength(1);
      expect(notes.inserts[0]!["note"]).toBe(NOTE);
      expect(String(notes.inserts[0]!["alertId"])).toBe(EVENT_ID.toString());
      expect(notes.inserts[0]!["createdAt"]).toEqual(STARTS_AT);
      expect(String(notes.inserts[0]!["createdByUserId"])).toBe(
        USER_ID.toString(),
      );
    });

    test("a change that fails after its checks leaves no note behind", async () => {
      // The timeline insert itself fails, after every check has passed.
      timelines.repository.save.mockRejectedValueOnce(
        new Error("The database went away."),
      );

      const error: unknown = await rejectionOf(
        changeState(memberProps(MAY_POST), { internalNote: NOTE }),
      );

      expect((error as Error).message).toBe("The database went away.");
      expect(notes.inserts).toEqual([]);
    });
  });
});
