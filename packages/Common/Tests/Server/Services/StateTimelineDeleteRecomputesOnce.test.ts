import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
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
 * DELETING ONE ENTRY OF A STATE TIMELINE WORKS OUT ITS RECORD'S METRICS AND
 * MEASUREMENTS ONCE, FROM WHAT IS LEFT (fu-bulk-actions, from #5309's
 * review).
 *
 * Deleting an entry closes the gap it leaves: the entry before it runs on
 * to the next one's start, or to where the deleted one ended. That move was
 * an update with its hooks, and they worked out the record's metrics and
 * measurements right then - with the deleted entry still there. The delete
 * itself then refreshed the metrics but never recomputed the measurements,
 * so time to acknowledge or time to resolve could keep counting a state
 * that no longer existed; and deleting the oldest entry, which moves no
 * neighbour, recomputed nothing at all.
 *
 * Now the neighbour is moved without its hooks, and the delete works out
 * the metrics (alerts and incidents) and the measurements once each, after
 * the entry is gone. The real delete pipeline runs over in-memory tables;
 * the refresh and the recompute are watched, each noting how many entries
 * the timeline held when it started.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f200000-0000-4000-8000-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID("5f200000-0000-4000-8000-000000000002");
const FIRST_ROW_ID: ObjectID = new ObjectID(
  "5f200000-0000-4000-8000-0000000000a1",
);
const MIDDLE_ROW_ID: ObjectID = new ObjectID(
  "5f200000-0000-4000-8000-0000000000a2",
);
const LAST_ROW_ID: ObjectID = new ObjectID(
  "5f200000-0000-4000-8000-0000000000a3",
);

const FIRST_AT: Date = new Date("2026-10-08T08:00:00.000Z");
const MIDDLE_AT: Date = new Date("2026-10-08T09:00:00.000Z");
const LAST_AT: Date = new Date("2026-10-08T10:00:00.000Z");
const LAST_ENDS_AT: Date = new Date("2026-10-08T11:00:00.000Z");

// The states a scheduled maintenance event moves through: any three ids.
const MAINTENANCE_STATE_IDS: {
  created: ObjectID;
  acknowledged: ObjectID;
  resolved: ObjectID;
} = {
  created: new ObjectID("5f200000-0000-4000-8000-0000000000c1"),
  acknowledged: new ObjectID("5f200000-0000-4000-8000-0000000000c2"),
  resolved: new ObjectID("5f200000-0000-4000-8000-0000000000c3"),
};

// What the timeline held when a refresh or a recompute started.
interface DerivedCall {
  call: "refresh" | "recompute";
  rows: number;
}

interface TimelineCase {
  name: string;
  timelineService: DatabaseService<BaseModel>;
  eventColumn: string;
  stateColumn: string;
  states: { created: ObjectID; acknowledged: ObjectID; resolved: ObjectID };
  // Whether the record has metrics to refresh beside its measurements.
  hasMetrics: boolean;
  stub: (rowsNow: () => number, calls: Array<DerivedCall>) => void;
}

const ALERT_CASE: TimelineCase = {
  name: "an alert",
  timelineService:
    AlertStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventColumn: "alertId",
  stateColumn: "alertStateId",
  states: ALERT_STATE_IDS,
  hasMetrics: true,
  stub: (rowsNow: () => number, calls: Array<DerivedCall>): void => {
    // The alert's current state, written once the entry is gone.
    getJestSpyOn(AlertService, "updateOneBy").mockResolvedValue(1 as never);
    getJestSpyOn(AlertService, "refreshAlertMetrics").mockImplementation(
      (async (): Promise<void> => {
        calls.push({ call: "refresh", rows: rowsNow() });
      }) as never,
    );
    getJestSpyOn(
      AlertMeasurementValueService,
      "recomputeForAlert",
    ).mockImplementation((async (): Promise<void> => {
      calls.push({ call: "recompute", rows: rowsNow() });
    }) as never);
  },
};

const INCIDENT_CASE: TimelineCase = {
  name: "an incident",
  timelineService:
    IncidentStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventColumn: "incidentId",
  stateColumn: "incidentStateId",
  states: INCIDENT_STATE_IDS,
  hasMetrics: true,
  stub: (rowsNow: () => number, calls: Array<DerivedCall>): void => {
    getJestSpyOn(IncidentService, "updateOneBy").mockResolvedValue(1 as never);
    getJestSpyOn(IncidentService, "refreshIncidentMetrics").mockImplementation(
      (async (): Promise<void> => {
        calls.push({ call: "refresh", rows: rowsNow() });
      }) as never,
    );
    getJestSpyOn(
      IncidentMeasurementValueService,
      "recomputeForIncident",
    ).mockImplementation((async (): Promise<void> => {
      calls.push({ call: "recompute", rows: rowsNow() });
    }) as never);
  },
};

const MAINTENANCE_CASE: TimelineCase = {
  name: "a scheduled maintenance event",
  timelineService:
    ScheduledMaintenanceStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventColumn: "scheduledMaintenanceId",
  stateColumn: "scheduledMaintenanceStateId",
  states: MAINTENANCE_STATE_IDS,
  hasMetrics: false,
  stub: (rowsNow: () => number, calls: Array<DerivedCall>): void => {
    /*
     * The event already in the state its newest entry holds: no network
     * site to re-roll, which is not what this suite is about.
     */
    getJestSpyOn(ScheduledMaintenanceService, "findOneBy").mockImplementation(
      (async (): Promise<ScheduledMaintenance> => {
        const event: ScheduledMaintenance = new ScheduledMaintenance();
        event._id = EVENT_ID.toString();
        event.projectId = PROJECT_ID;
        event.currentScheduledMaintenanceStateId =
          MAINTENANCE_STATE_IDS.acknowledged;
        event.networkSites = [];
        return event;
      }) as never,
    );
    getJestSpyOn(ScheduledMaintenanceService, "updateOneBy").mockResolvedValue(
      1 as never,
    );
    getJestSpyOn(
      ScheduledMaintenanceMeasurementValueService,
      "recomputeForScheduledMaintenance",
    ).mockImplementation((async (): Promise<void> => {
      calls.push({ call: "recompute", rows: rowsNow() });
    }) as never);
  },
};

beforeEach(() => {
  stubProjectDirectory({});
  stubReadableParents();
  mockProjectStates();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["an alert", ALERT_CASE],
  ["an incident", INCIDENT_CASE],
  ["a scheduled maintenance event", MAINTENANCE_CASE],
])(
  "deleting one entry of %s's state timeline",
  (_name: string, timelineCase: TimelineCase) => {
    let timelines: InMemoryTable;
    let calls: Array<DerivedCall> = [];

    function row(
      id: ObjectID,
      stateId: ObjectID,
      startsAt: Date,
      endsAt: Date | null,
    ): StoredRow {
      return {
        _id: id.toString(),
        projectId: PROJECT_ID.toString(),
        [timelineCase.eventColumn]: EVENT_ID.toString(),
        [timelineCase.stateColumn]: stateId.toString(),
        startsAt: startsAt,
        endsAt: endsAt,
      };
    }

    beforeEach(() => {
      timelines = useInMemoryTable(timelineCase.timelineService, [
        row(FIRST_ROW_ID, timelineCase.states.created, FIRST_AT, MIDDLE_AT),
        row(
          MIDDLE_ROW_ID,
          timelineCase.states.acknowledged,
          MIDDLE_AT,
          LAST_AT,
        ),
        row(LAST_ROW_ID, timelineCase.states.resolved, LAST_AT, LAST_ENDS_AT),
      ]);

      calls = [];
      timelineCase.stub((): number => {
        return timelines.rows.length;
      }, calls);
    });

    async function deleteRow(id: ObjectID): Promise<void> {
      // By its id, as the Status Timeline page's Delete names it.
      await timelineCase.timelineService.deleteOneById({
        id: id,
        props: { isRoot: true },
      });

      // The refresh and the recompute run in the background: let them start.
      for (let i: number = 0; i < 10; i++) {
        await Promise.resolve();
      }
    }

    // Each once, and each with the deleted entry gone: two entries left.
    function expectWorkedOutOnceFromWhatIsLeft(): void {
      expect(
        calls.filter((call: DerivedCall): boolean => {
          return call.call === "recompute";
        }),
      ).toEqual([{ call: "recompute", rows: 2 }]);

      expect(
        calls.filter((call: DerivedCall): boolean => {
          return call.call === "refresh";
        }),
      ).toEqual(timelineCase.hasMetrics ? [{ call: "refresh", rows: 2 }] : []);
    }

    test("a middle entry: the one before it runs on to the next one's start, and the record is worked out once, from what is left", async () => {
      await deleteRow(MIDDLE_ROW_ID);

      expect(timelines.deletes).toEqual([MIDDLE_ROW_ID.toString()]);
      expect(timelines.get(FIRST_ROW_ID)?.["endsAt"]).toEqual(LAST_AT);
      expectWorkedOutOnceFromWhatIsLeft();
    });

    test("the newest entry: the one before it runs on to where it ended, and the record is worked out once, from what is left", async () => {
      await deleteRow(LAST_ROW_ID);

      expect(timelines.deletes).toEqual([LAST_ROW_ID.toString()]);
      expect(timelines.get(MIDDLE_ROW_ID)?.["endsAt"]).toEqual(LAST_ENDS_AT);
      expectWorkedOutOnceFromWhatIsLeft();
    });

    test("the oldest entry, which moves no neighbour, still has the record worked out once", async () => {
      await deleteRow(FIRST_ROW_ID);

      expect(timelines.deletes).toEqual([FIRST_ROW_ID.toString()]);
      // Nothing moves: the next entry keeps its start, the others their ends.
      expect(timelines.updates).toEqual([]);
      expectWorkedOutOnceFromWhatIsLeft();
    });
  },
);
