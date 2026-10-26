import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import UserService from "../../../Server/Services/UserService";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  makeAlertStates,
  makeIncidentStates,
  mockProjectStates,
} from "../TestingUtils/Services/ProjectStatesHelper";
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
 * A STATE CHANGE WORKS OUT ITS RECORD'S METRICS AND MEASUREMENTS ONCE
 * (issue #5299).
 *
 * Moving an alert or an incident to another state writes a new row of its
 * state timeline and closes the row before it. Both writes asked for the
 * record's metrics to be refreshed and its measurements recomputed: the new
 * row's hook once, and the update of the row before it - whose own hook
 * recomputed the measurements twice over - again. A state change refreshed
 * its alert's metrics twice and recomputed its measurements three times, in
 * the background of every change; a bulk Resolve of thousands of alerts did
 * that thousands of times over, each a read of the alert, its timeline and
 * the project's states, and writes of metrics.
 *
 * Now: the update of the row before refreshes once and recomputes once,
 * after both writes are saved (all either reads of the change), and the
 * new row's hook does both only for a record's first row - which moves no
 * row before it. The real create pipeline runs over in-memory tables.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f100000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5f100000-0000-4000-8000-000000000002");
const EVENT_ID: ObjectID = new ObjectID("5f100000-0000-4000-8000-000000000003");
const PREVIOUS_ROW_ID: ObjectID = new ObjectID(
  "5f100000-0000-4000-8000-000000000004",
);
const LATER_ROW_ID: ObjectID = new ObjectID(
  "5f100000-0000-4000-8000-000000000005",
);

const FIRST_STATE_AT: Date = new Date("2026-10-08T08:00:00.000Z");
const CHANGED_AT: Date = new Date("2026-10-08T09:00:00.000Z");
const LATER_AT: Date = new Date("2026-10-08T10:00:00.000Z");
const BACKDATED_AT: Date = new Date("2026-10-08T08:30:00.000Z");

function userPermission(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  };
}

function projectMemberProps(): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.ProjectMember,
    ].map(userPermission),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    ...ON_HIGHEST_PLAN,
  };
}

interface DerivedCalls {
  refreshes: () => number;
  recomputes: () => number;
}

/*
 * What the record's timeline held when a refresh or a recompute started:
 * both read the timeline, so each must start only once the change is saved
 * whole - the new row written, and the row before it closed.
 */
interface TimelineSeen {
  call: "refresh" | "recompute";
  rows: number;
  isRowBeforeClosed: boolean;
}

type LookAtTimeline = () => Omit<TimelineSeen, "call">;

interface TimelineCase {
  event: string;
  timelineService: DatabaseService<BaseModel>;
  eventService: DatabaseService<BaseModel>;
  eventColumn: string;
  stateColumn: string;
  currentStateColumn: string;
  states: { created: ObjectID; acknowledged: ObjectID; resolved: ObjectID };
  buildChange: (stateId: ObjectID, startsAt: Date) => BaseModel;
  stub: (look: LookAtTimeline, seen: Array<TimelineSeen>) => DerivedCalls;
}

function stubAlertStates(): void {
  const states: Array<AlertState> = makeAlertStates();

  getJestSpyOn(AlertStateService, "findOneBy").mockImplementation(
    async (findOneBy: unknown): Promise<AlertState | null> => {
      const id: string = String(
        (findOneBy as { query: Dictionary<unknown> }).query["_id"],
      );

      return (
        states.find((state: AlertState): boolean => {
          return state._id === id;
        }) || null
      );
    },
  );
}

function stubIncidentStates(): void {
  const states: Array<IncidentState> = makeIncidentStates();

  getJestSpyOn(IncidentStateService, "findOneBy").mockImplementation(
    async (findOneBy: unknown): Promise<IncidentState | null> => {
      const id: string = String(
        (findOneBy as { query: Dictionary<unknown> }).query["_id"],
      );

      return (
        states.find((state: IncidentState): boolean => {
          return state._id === id;
        }) || null
      );
    },
  );
}

const ALERT_CASE: TimelineCase = {
  event: "an alert",
  timelineService:
    AlertStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventService: AlertService as unknown as DatabaseService<BaseModel>,
  eventColumn: "alertId",
  stateColumn: "alertStateId",
  currentStateColumn: "currentAlertStateId",
  states: ALERT_STATE_IDS,
  buildChange: (stateId: ObjectID, startsAt: Date): BaseModel => {
    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.alertId = EVENT_ID;
    timeline.alertStateId = stateId;
    timeline.startsAt = startsAt;
    return timeline;
  },
  stub: (look: LookAtTimeline, seen: Array<TimelineSeen>): DerivedCalls => {
    stubAlertStates();
    getJestSpyOn(AlertService, "getAlertNumber").mockResolvedValue({
      number: 7,
      numberWithPrefix: "ALT-7",
    });
    getJestSpyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/alerts/7"),
    );
    getJestSpyOn(AlertFeedService, "createAlertFeedItem").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      AlertStateTimelineService as never,
      "isLastAlertState",
    ).mockResolvedValue(false as never);

    const refresh: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      AlertService,
      "refreshAlertMetrics",
    ).mockImplementation((async (): Promise<void> => {
      seen.push({ call: "refresh", ...look() });
    }) as never);
    const recompute: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      AlertMeasurementValueService,
      "recomputeForAlert",
    ).mockImplementation((async (): Promise<void> => {
      seen.push({ call: "recompute", ...look() });
    }) as never);

    return {
      refreshes: (): number => {
        return refresh.mock.calls.length;
      },
      recomputes: (): number => {
        return recompute.mock.calls.length;
      },
    };
  },
};

const INCIDENT_CASE: TimelineCase = {
  event: "an incident",
  timelineService:
    IncidentStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventService: IncidentService as unknown as DatabaseService<BaseModel>,
  eventColumn: "incidentId",
  stateColumn: "incidentStateId",
  currentStateColumn: "currentIncidentStateId",
  states: INCIDENT_STATE_IDS,
  buildChange: (stateId: ObjectID, startsAt: Date): BaseModel => {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.incidentId = EVENT_ID;
    timeline.incidentStateId = stateId;
    timeline.startsAt = startsAt;
    return timeline;
  },
  stub: (look: LookAtTimeline, seen: Array<TimelineSeen>): DerivedCalls => {
    stubIncidentStates();
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
    getJestSpyOn(
      IncidentFeedService,
      "createIncidentFeedItem",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentAlertService,
      "cascadeIncidentStateToLinkedAlerts",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentStateTimelineService as never,
      "autoAssignIncidentCommander",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      IncidentStateTimelineService as never,
      "trackSlaStateChange",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      IncidentStateTimelineService as never,
      "isLastIncidentState",
    ).mockResolvedValue(false as never);

    const refresh: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      IncidentService,
      "refreshIncidentMetrics",
    ).mockImplementation((async (): Promise<void> => {
      seen.push({ call: "refresh", ...look() });
    }) as never);
    const recompute: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      IncidentMeasurementValueService,
      "recomputeForIncident",
    ).mockImplementation((async (): Promise<void> => {
      seen.push({ call: "recompute", ...look() });
    }) as never);

    return {
      refreshes: (): number => {
        return refresh.mock.calls.length;
      },
      recomputes: (): number => {
        return recompute.mock.calls.length;
      },
    };
  },
};

beforeEach(() => {
  // The record's lock, in memory: one holder per key.
  const held: Set<string> = new Set<string>();

  getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }): Promise<{ name: string }> => {
    const name: string = `${data.namespace}-${data.key}`;
    held.add(name);
    return { name: name };
  }) as never);

  getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
    name: string;
  }): Promise<void> => {
    held.delete(mutex.name);
  }) as never);

  stubProjectDirectory({});
  stubReadableParents();
  mockProjectStates();

  getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
    FeedMarkdown.asMarkdown("[Ada Lovelace](mailto:ada@example.com)"),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["an alert", ALERT_CASE],
  ["an incident", INCIDENT_CASE],
])("a state change to %s", (_name: string, timelineCase: TimelineCase) => {
  let timelines: InMemoryTable;
  let derived: DerivedCalls;
  let seen: Array<TimelineSeen> = [];

  function row(id: ObjectID, stateId: ObjectID, startsAt: Date): StoredRow {
    return {
      _id: id.toString(),
      projectId: PROJECT_ID.toString(),
      [timelineCase.eventColumn]: EVENT_ID.toString(),
      [timelineCase.stateColumn]: stateId.toString(),
      startsAt: startsAt,
    };
  }

  function useTimeline(rows: Array<StoredRow>): void {
    timelines = useInMemoryTable(timelineCase.timelineService, rows);
    useInMemoryTable(timelineCase.eventService, [
      {
        _id: EVENT_ID.toString(),
        projectId: PROJECT_ID.toString(),
        title: "Checkout is down",
        [timelineCase.currentStateColumn]: (rows.length > 0
          ? timelineCase.states.created
          : timelineCase.states.created
        ).toString(),
      },
    ]);

    // The record's own update hooks are about other writes.
    getJestSpyOn(
      timelineCase.eventService as never,
      "onBeforeUpdate",
    ).mockImplementation((async (updateBy: unknown) => {
      return { updateBy: updateBy, carryForward: null };
    }) as never);
    getJestSpyOn(
      timelineCase.eventService as never,
      "onUpdateSuccess",
    ).mockImplementation((async (onUpdate: unknown) => {
      return onUpdate;
    }) as never);

    seen = [];
    derived = timelineCase.stub((): Omit<TimelineSeen, "call"> => {
      return {
        rows: timelines.rows.length,
        isRowBeforeClosed: Boolean(timelines.get(PREVIOUS_ROW_ID)?.["endsAt"]),
      };
    }, seen);
  }

  async function change(stateId: ObjectID, startsAt: Date): Promise<void> {
    await timelineCase.timelineService.create({
      data: timelineCase.buildChange(stateId, startsAt),
      props: projectMemberProps(),
    });

    // The refreshes run in the background: let them start.
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  test("a move after its current state refreshes the metrics once and recomputes the measurements once", async () => {
    useTimeline([
      row(PREVIOUS_ROW_ID, timelineCase.states.created, FIRST_STATE_AT),
    ]);

    await change(timelineCase.states.acknowledged, CHANGED_AT);

    // The row before it was closed: the change was saved whole.
    expect(timelines.inserts).toHaveLength(1);
    expect(
      timelines.updates.some(
        (update: { id: string; set: StoredRow }): boolean => {
          return (
            update.id.toLowerCase() ===
              PREVIOUS_ROW_ID.toString().toLowerCase() &&
            update.set["endsAt"] !== undefined
          );
        },
      ),
    ).toBe(true);

    expect(derived.refreshes()).toBe(1);
    expect(derived.recomputes()).toBe(1);

    // Each started once the change was saved whole, never before.
    expect(seen).toEqual([
      { call: "refresh", rows: 2, isRowBeforeClosed: true },
      { call: "recompute", rows: 2, isRowBeforeClosed: true },
    ]);
  });

  test("a record's first state, which moves no row before it, refreshes and recomputes once too", async () => {
    useTimeline([]);

    await change(timelineCase.states.created, FIRST_STATE_AT);

    expect(timelines.inserts).toHaveLength(1);
    expect(timelines.updates).toEqual([]);
    expect(derived.refreshes()).toBe(1);
    expect(derived.recomputes()).toBe(1);

    // Once the first row is saved.
    expect(
      seen.map((call: TimelineSeen): number => {
        return call.rows;
      }),
    ).toEqual([1, 1]);
  });

  test("a back-dated move between two rows moves both of them, and each refreshes once - never the new row's hook again", async () => {
    useTimeline([
      row(PREVIOUS_ROW_ID, timelineCase.states.created, FIRST_STATE_AT),
      row(LATER_ROW_ID, timelineCase.states.resolved, LATER_AT),
    ]);

    await change(timelineCase.states.acknowledged, BACKDATED_AT);

    expect(timelines.inserts).toHaveLength(1);
    expect(derived.refreshes()).toBe(2);
    expect(derived.recomputes()).toBe(2);

    // Every one of them once the new row is saved and the row before closed.
    for (const call of seen) {
      expect(call.rows).toBe(3);
      expect(call.isRowBeforeClosed).toBe(true);
    }
  });
});
