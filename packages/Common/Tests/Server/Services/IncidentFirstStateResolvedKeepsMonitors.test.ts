import Semaphore from "../../../Server/Infrastructure/Semaphore";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import AIIncidentPostmortemRunner from "../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import InvestigationGrader from "../../../Server/Utils/AI/SRE/InvestigationGrader";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";
import type { SpyInstance } from "jest-mock";
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
 * Resolving an incident gives its monitors back: their monitoring resumes
 * and their status returns to operational (markMonitorsActiveForMonitoring).
 * That undoes what the incident did to them - so it gives back only what the
 * incident holds, which the incident records (Incident.holdsMonitors):
 *
 *   - true for an incident declared open: it put its monitors in its status
 *     and, declared by hand, paused their monitoring;
 *   - false for one declared already resolved, which did neither - and for
 *     one whose resolve gave its monitors back already, so a reopen and a
 *     second resolve give back nothing a second time;
 *   - null for an incident from before this was recorded, which gives its
 *     monitors back as it always did.
 *
 * A monitor that is down for another reason stays down, no recovery that
 * never happened is written to its timeline, and its owners are not told of
 * one. Nothing about the timeline's rows decides it, and nothing a request
 * sends: the column is OneUptime's to write.
 *
 * It replaced the never-held signal #4435 handed the first state of an
 * incident declared resolved, which only covered that first state: a reopen
 * and a second resolve still gave back monitors the incident never held.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-0000000000d1",
);
const RESOLVED_STATE_ID: string = "0193c0de-5a7e-4fab-8bcd-0000000000a3";
const IDENTIFIED_STATE_ID: string = "0193c0de-5a7e-4fab-8bcd-0000000000a1";
const MONITOR_ID: string = "0193c0de-5a7e-4fab-8bcd-0000000000f1";

// When the incident was declared: where the row its create writes starts.
const DECLARED_AT: Date = new Date("2026-10-06T08:00:00.000Z");

let givenBack: Array<Array<unknown>> = [];
let recorded: Array<{ incidentId: ObjectID; holdsMonitors: boolean }> = [];
let postmortemDrafts: number = 0;
// What the incident holds, as the database would read it back.
let holdsMonitors: boolean | null | undefined = true;

function stateWith(
  id: string,
  isResolved: boolean,
  order: number,
): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = id;
  state.name = isResolved ? "Resolved" : "Identified";
  state.order = order;
  state.isResolvedState = isResolved;
  state.isAcknowledgedState = false;
  state.isCreatedState = !isResolved;
  return state;
}

beforeEach(() => {
  givenBack = [];
  recorded = [];
  postmortemDrafts = 0;
  holdsMonitors = true;

  // The project's states: Identified, then Resolved.
  mockProjectStates({
    incidentStates: [
      stateWith(IDENTIFIED_STATE_ID, false, 1),
      stateWith(RESOLVED_STATE_ID, true, 2),
    ],
  });

  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockResolvedValue(stateWith(RESOLVED_STATE_ID, true, 2) as never);
  jest.spyOn(IncidentService, "updateOneBy").mockResolvedValue(1 as never);
  jest
    .spyOn(IncidentStateTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 17,
    numberWithPrefix: "INC-17",
  } as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/incident") as never,
    );
  jest
    .spyOn(IncidentService, "refreshIncidentMetrics")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentAlertService, "cascadeIncidentStateToLinkedAlerts")
    .mockResolvedValue(undefined as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

  const timelineService: Record<string, () => Promise<unknown>> =
    IncidentStateTimelineService as unknown as Record<
      string,
      () => Promise<unknown>
    >;
  jest
    .spyOn(timelineService, "trackSlaStateChange")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(timelineService, "isLastIncidentState")
    .mockResolvedValue(false as never);
  // A user's write also makes them Incident Commander: not under test here.
  jest
    .spyOn(timelineService, "autoAssignIncidentCommander")
    .mockResolvedValue(undefined as never);

  jest.spyOn(IncidentService, "findOneBy").mockImplementation((async () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.declaredAt = DECLARED_AT;
    if (holdsMonitors !== undefined) {
      incident.holdsMonitors = holdsMonitors as boolean;
    }
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    incident.monitors = [monitor];
    return incident;
  }) as never);

  jest
    .spyOn(IncidentService, "markMonitorsActiveForMonitoring")
    .mockImplementation((async (...args: Array<unknown>): Promise<void> => {
      givenBack.push(args);
    }) as never);

  jest
    .spyOn(IncidentService, "recordHoldsMonitors")
    .mockImplementation((async (data: {
      incidentId: ObjectID;
      holdsMonitors: boolean;
    }): Promise<void> => {
      recorded.push(data);
      // The database now reads it back so.
      holdsMonitors = data.holdsMonitors;
    }) as never);

  jest
    .spyOn(AIIncidentPostmortemRunner, "draftPostmortemOnResolve")
    .mockImplementation((async (): Promise<void> => {
      postmortemDrafts++;
    }) as never);
  jest
    .spyOn(InvestigationGrader, "gradeInvestigationOnResolve")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function rowIn(stateId: string, startsAt: Date): IncidentStateTimeline {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.incidentStateId = new ObjectID(stateId);
  row.startsAt = startsAt;
  return row;
}

// The incident's first state, from when it was declared.
function earlierRow(): IncidentStateTimeline {
  return rowIn(IDENTIFIED_STATE_ID, DECLARED_AT);
}

/*
 * A row in `stateId` (by default the resolved state), written `startsAt`
 * (by default where the incident's create starts its first row), with the
 * rows found before and after it, by a write with `props` and
 * `miscDataProps`.
 */
async function write(
  before: IncidentStateTimeline | null,
  options: {
    stateId?: string;
    after?: IncidentStateTimeline | null;
    startsAt?: Date;
    props?: Record<string, unknown>;
    miscDataProps?: JSONObject;
  } = {},
): Promise<IncidentStateTimeline> {
  const row: IncidentStateTimeline = rowIn(
    options.stateId || RESOLVED_STATE_ID,
    options.startsAt || DECLARED_AT,
  );
  const hooks: Record<string, (...args: Array<unknown>) => Promise<unknown>> =
    IncidentStateTimelineService as unknown as Record<
      string,
      (...args: Array<unknown>) => Promise<unknown>
    >;

  await hooks["onCreateSuccess"]!.call(
    IncidentStateTimelineService,
    {
      createBy: {
        data: row,
        props: options.props || { isRoot: true },
        ...(options.miscDataProps
          ? { miscDataProps: options.miscDataProps }
          : {}),
      },
      carryForward: {
        statusTimelineBeforeThisStatus: before,
        statusTimelineAfterThisStatus: options.after || null,
        mutex: null,
      },
    },
    row,
  );

  return row;
}

describe("an incident's resolve gives back the monitors it holds, and only those", () => {
  test("declared already resolved, it holds nothing: its resolve gives nothing back, and records nothing more", async () => {
    holdsMonitors = false;

    await write(null);

    expect(givenBack).toEqual([]);
    expect(recorded).toEqual([]);
  });

  test("an incident that holds them: the resolve gives them back, from the moment it resolved - then it holds nothing", async () => {
    const row: IncidentStateTimeline = await write(earlierRow(), {
      startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, 30),
    });

    expect(givenBack).toHaveLength(1);
    expect(String(givenBack[0]![0])).toBe(PROJECT_ID.toString());
    expect(
      (givenBack[0]![1] as Array<Monitor>).map((monitor: Monitor) => {
        return monitor._id;
      }),
    ).toEqual([MONITOR_ID]);
    expect(givenBack[0]![2]).toEqual(row.startsAt);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.incidentId.toString()).toBe(INCIDENT_ID.toString());
    expect(recorded[0]!.holdsMonitors).toBe(false);
  });

  test.each([
    ["null", null],
    ["never read", undefined],
  ] as Array<[string, null | undefined]>)(
    "an incident from before it was recorded (%s) gives its monitors back, as it always did, and holds nothing from then on",
    async (_name: string, value: null | undefined) => {
      holdsMonitors = value;

      await write(earlierRow(), {
        startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, 30),
      });

      expect(givenBack).toHaveLength(1);
      expect(
        recorded.map((entry: { holdsMonitors: boolean }) => {
          return entry.holdsMonitors;
        }),
      ).toEqual([false]);
    },
  );

  test("resolved, reopened and resolved again: the second resolve gives back nothing - the first gave them back", async () => {
    await write(earlierRow(), {
      startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, 30),
    });

    // Reopened: its resolved row deleted, the incident back in Identified.
    await write(earlierRow(), {
      startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, 60),
    });

    expect(givenBack).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  });

  test("declared resolved, reopened and resolved: nothing is given back, ever", async () => {
    holdsMonitors = false;

    await write(null);
    await write(earlierRow(), {
      startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, 60),
    });

    expect(givenBack).toEqual([]);
    expect(recorded).toEqual([]);
  });

  test.each([
    ["no row before it (its first row deleted, say)", {}],
    [
      "dated before the incident's first state",
      {
        after: "first",
        startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, -10),
      },
    ],
    [
      "written after the earlier rows aged out of the timeline",
      { startsAt: OneUptimeDate.getCurrentDate() },
    ],
  ] as Array<[string, { after?: string; startsAt?: Date }]>)(
    "the timeline's rows decide nothing: a resolve with %s gives back what the incident holds",
    async (_name: string, shape: { after?: string; startsAt?: Date }) => {
      await write(null, {
        ...(shape.after ? { after: earlierRow() } : {}),
        ...(shape.startsAt ? { startsAt: shape.startsAt } : {}),
      });

      expect(givenBack).toHaveLength(1);
    },
  );

  test("a request's misc data has no say: the old never-held signal, sent by anyone, keeps nothing", async () => {
    await write(null, {
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      miscDataProps: { neverHeldItsMonitors: true },
    });

    expect(givenBack).toHaveLength(1);
  });

  test("either way, a resolved incident still gets its postmortem draft", async () => {
    holdsMonitors = false;
    await write(null);

    holdsMonitors = true;
    await write(earlierRow(), {
      startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, 30),
    });

    expect(postmortemDrafts).toBe(2);
  });

  test("a state that is not resolved gives nothing back and records nothing", async () => {
    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(stateWith(IDENTIFIED_STATE_ID, false, 1) as never);

    await write(null, { stateId: IDENTIFIED_STATE_ID });

    expect(givenBack).toEqual([]);
    expect(recorded).toEqual([]);
    expect(postmortemDrafts).toBe(0);
  });
});

/*
 * IncidentService.recordHoldsMonitors writes the column as OneUptime: as
 * root, and past the update hooks, which would otherwise take a write of one
 * column of its own for an edit of the incident.
 */
describe("IncidentService.recordHoldsMonitors", () => {
  // The real write, not the stand-in the resolves above are watched through.
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test.each([true, false])(
    "writes %s as OneUptime, past the update hooks",
    async (value: boolean) => {
      const update: SpyInstance<typeof IncidentService.updateOneById> = jest
        .spyOn(IncidentService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await IncidentService.recordHoldsMonitors({
        incidentId: INCIDENT_ID,
        holdsMonitors: value,
      });

      expect(update).toHaveBeenCalledTimes(1);

      const call: {
        id: ObjectID;
        data: Record<string, unknown>;
        props: Record<string, unknown>;
      } = update.mock.calls[0]![0] as unknown as {
        id: ObjectID;
        data: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(call.id.toString()).toBe(INCIDENT_ID.toString());
      expect(call.data).toEqual({ holdsMonitors: value });
      expect(call.props).toEqual({ isRoot: true, ignoreHooks: true });
    },
  );
});
