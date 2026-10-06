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
import ObjectID from "../../../Types/ObjectID";
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
 * That undoes what the incident did to them - and an incident declared
 * already resolved did nothing to them: it never set a status on its
 * monitors or paused their monitoring (Common/Utils/StartingStage). So its
 * first state, resolved - the one row its create writes, from the moment it
 * was declared - gives nothing back: a monitor that is down for another
 * reason stays down, no recovery that never happened is written to the
 * monitor's timeline, and its owners are not told of one.
 *
 * Every other resolve gives the monitors back as always - also one that
 * finds no row before it: a resolve dated before the incident's first
 * state, or one written after the incident's earlier rows aged out of the
 * timeline (it keeps three years). Taking those for "declared resolved"
 * would leave an open incident's monitors paused for good.
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
let postmortemDrafts: number = 0;
let declaredAt: Date | undefined = DECLARED_AT;

function stateWith(id: string, isResolved: boolean): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = id;
  state.name = isResolved ? "Resolved" : "Identified";
  state.isResolvedState = isResolved;
  state.isAcknowledgedState = false;
  state.isCreatedState = !isResolved;
  return state;
}

beforeEach(() => {
  givenBack = [];
  postmortemDrafts = 0;
  declaredAt = DECLARED_AT;

  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockResolvedValue(stateWith(RESOLVED_STATE_ID, true) as never);
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

  jest.spyOn(IncidentService, "findOneBy").mockImplementation((async () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    if (declaredAt) {
      incident.declaredAt = declaredAt;
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

function resolvedRow(startsAt: Date): IncidentStateTimeline {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.incidentStateId = new ObjectID(RESOLVED_STATE_ID);
  row.startsAt = startsAt;
  return row;
}

function identifiedRow(startsAt: Date): IncidentStateTimeline {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.incidentStateId = new ObjectID(IDENTIFIED_STATE_ID);
  row.incidentState = stateWith(IDENTIFIED_STATE_ID, false);
  row.startsAt = startsAt;
  return row;
}

// The incident's first state, from when it was declared.
function earlierRow(): IncidentStateTimeline {
  return identifiedRow(DECLARED_AT);
}

/*
 * A resolved row, written `startsAt` (by default, where the incident's
 * create starts its first row), with the rows found before and after it.
 */
async function resolve(
  before: IncidentStateTimeline | null,
  options: {
    after?: IncidentStateTimeline | null;
    startsAt?: Date;
  } = {},
): Promise<IncidentStateTimeline> {
  const row: IncidentStateTimeline = resolvedRow(
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
      createBy: { data: row, props: { isRoot: true } },
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

describe("an incident's resolved state gives its monitors back, unless it is the first state of an incident declared resolved", () => {
  test("declared already resolved: its first state - its only row, from the moment it was declared - gives nothing back", async () => {
    await resolve(null);

    expect(givenBack).toEqual([]);
  });

  test("resolved after a state of its own: the monitors are given back, from the moment it resolved", async () => {
    const row: IncidentStateTimeline = await resolve(earlierRow(), {
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
  });

  test("a resolve dated before the incident's first state still gives the monitors back: that first state comes after it", async () => {
    await resolve(null, {
      after: earlierRow(),
      startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, -10),
    });

    expect(givenBack).toHaveLength(1);
  });

  test("an incident declared with a time still to come, resolved now, gives the monitors back", async () => {
    declaredAt = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      60,
    );

    await resolve(null, {
      after: identifiedRow(declaredAt),
      startsAt: OneUptimeDate.getCurrentDate(),
    });

    expect(givenBack).toHaveLength(1);
  });

  test("a resolve written after the incident's earlier rows aged out of the timeline still gives the monitors back", async () => {
    // Declared four years ago: the timeline keeps three.
    declaredAt = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -4 * 365,
    );

    await resolve(null, { startsAt: OneUptimeDate.getCurrentDate() });

    expect(givenBack).toHaveLength(1);
  });

  test("an incident with no declared time on record gives the monitors back on resolve, as always", async () => {
    declaredAt = undefined;

    await resolve(null);

    expect(givenBack).toHaveLength(1);
  });

  test("either way, a resolved incident still gets its postmortem draft", async () => {
    await resolve(null);
    await resolve(earlierRow(), {
      startsAt: OneUptimeDate.addRemoveMinutes(DECLARED_AT, 30),
    });

    expect(postmortemDrafts).toBe(2);
  });

  test("a first state that is not resolved gives nothing back either, as before", async () => {
    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(stateWith(IDENTIFIED_STATE_ID, false) as never);

    await resolve(null);

    expect(givenBack).toEqual([]);
    expect(postmortemDrafts).toBe(0);
  });
});
