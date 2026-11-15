import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import OnCallRecordStates, {
  ON_CALL_RECORD_READ_CHUNK,
  OnCallRecordColumns,
  OnCallRecordState,
  OnCallStateCache,
} from "../../../../Server/Utils/OnCall/OnCallRecordStates";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import AcknowledgedStateUtil from "../../../../Utils/AcknowledgedState";
import ResolvedStateUtil from "../../../../Utils/ResolvedState";
import { StateListType } from "../../../../Utils/StateOrder";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE A PAGE OF ON-CALL RUNS' RECORDS STAND, READ TOGETHER
 * (OnCallRecordStates).
 *
 * The on-call workers asked, of each run on its own, every minute, whether
 * its incident, alert or episode was acknowledged or resolved: two to four
 * reads per run, all at once. A page of runs is now answered together. These
 * pin that it reads one query per kind of record and one per list of states
 * (and none for projects read earlier in the same run of the worker), and
 * that it answers each record as its own reads did: acknowledged and
 * resolved by AcknowledgedStateUtil and ResolvedStateUtil over the project's
 * states, and a record that is gone failing its run with the message its own
 * read gave.
 */

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

function uuid(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

const PROJECT_A: ObjectID = uuid("aaaaaaaa", 1);
const PROJECT_B: ObjectID = uuid("aaaaaaaa", 2);

// A project's incident (or alert) list: created, acknowledged, investigating, resolved.
function statesOf(
  projectId: ObjectID,
  kind: "incident" | "alert",
): Array<IncidentState | AlertState> {
  return [
    { order: 1, name: "Created", isCreatedState: true },
    { order: 2, name: "Acknowledged", isAcknowledgedState: true },
    { order: 3, name: "Investigating" },
    { order: 4, name: "Resolved", isResolvedState: true },
  ].map(
    (data: {
      order: number;
      name: string;
      isCreatedState?: boolean;
      isAcknowledgedState?: boolean;
      isResolvedState?: boolean;
    }) => {
      const state: IncidentState | AlertState =
        kind === "incident" ? new IncidentState() : new AlertState();
      state.id = stateIdOf(projectId, kind, data.order);
      state.projectId = projectId;
      state.order = data.order;
      state.name = data.name;
      state.isCreatedState = data.isCreatedState || false;
      state.isAcknowledgedState = data.isAcknowledgedState || false;
      state.isResolvedState = data.isResolvedState || false;
      return state;
    },
  );
}

function stateIdOf(
  projectId: ObjectID,
  kind: "incident" | "alert",
  order: number,
): ObjectID {
  const projectIndex: number =
    projectId.toString() === PROJECT_A.toString() ? 1 : 2;
  return uuid(
    kind === "incident" ? "11111111" : "22222222",
    projectIndex * 10 + order,
  );
}

// What the database holds: records by id, and every project's states.
let incidents: Array<Incident>;
let alerts: Array<Alert>;
let incidentEpisodes: Array<IncidentEpisode>;
let alertEpisodes: Array<AlertEpisode>;

function queriedIds(call: Array<unknown>): Array<string> {
  const predicate: { objectLiteralParameters?: Record<string, unknown> } = (
    call[0] as { query: Record<string, unknown> }
  ).query["_id"] as { objectLiteralParameters?: Record<string, unknown> };

  return (
    Object.values(predicate.objectLiteralParameters || {})[0] as Array<string>
  ).map((id: string) => {
    return id.toLowerCase();
  });
}

function queriedProjects(call: Array<unknown>): Array<string> {
  const predicate: { objectLiteralParameters?: Record<string, unknown> } = (
    call[0] as { query: Record<string, unknown> }
  ).query["projectId"] as { objectLiteralParameters?: Record<string, unknown> };

  return Object.values(
    predicate.objectLiteralParameters || {},
  )[0] as Array<string>;
}

function answer<T extends { id: ObjectID | null }>(rows: () => Array<T>) {
  return async (args: unknown): Promise<Array<T>> => {
    const ids: Array<string> = queriedIds([args]);
    return rows().filter((row: T) => {
      return ids.includes(row.id!.toString().toLowerCase());
    });
  };
}

beforeEach(() => {
  incidents = [];
  alerts = [];
  incidentEpisodes = [];
  alertEpisodes = [];

  jest.spyOn(IncidentService, "findBy").mockImplementation(
    answer(() => {
      return incidents;
    }) as never,
  );
  jest.spyOn(AlertService, "findBy").mockImplementation(
    answer(() => {
      return alerts;
    }) as never,
  );
  jest.spyOn(IncidentEpisodeService, "findBy").mockImplementation(
    answer(() => {
      return incidentEpisodes;
    }) as never,
  );
  jest.spyOn(AlertEpisodeService, "findBy").mockImplementation(
    answer(() => {
      return alertEpisodes;
    }) as never,
  );

  jest.spyOn(IncidentStateService, "findBy").mockImplementation((async (
    args: unknown,
  ) => {
    return queriedProjects([args]).flatMap((projectId: string) => {
      return statesOf(new ObjectID(projectId), "incident");
    });
  }) as never);
  jest.spyOn(AlertStateService, "findBy").mockImplementation((async (
    args: unknown,
  ) => {
    return queriedProjects([args]).flatMap((projectId: string) => {
      return statesOf(new ObjectID(projectId), "alert");
    });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function incident(
  index: number,
  order: number,
  projectId: ObjectID = PROJECT_A,
): Incident {
  const record: Incident = new Incident();
  record.id = uuid("cccccccc", index);
  record.projectId = projectId;
  record.currentIncidentStateId = stateIdOf(projectId, "incident", order);
  record.incidentSeverityId = uuid("55555555", order);
  incidents.push(record);
  return record;
}

function alert(
  index: number,
  order: number,
  projectId: ObjectID = PROJECT_A,
): Alert {
  const record: Alert = new Alert();
  record.id = uuid("dddddddd", index);
  record.projectId = projectId;
  record.currentAlertStateId = stateIdOf(projectId, "alert", order);
  record.alertSeverityId = uuid("66666666", order);
  alerts.push(record);
  return record;
}

describe("reading a page of runs' records", () => {
  test("reads each kind of record in one query and each list of states in one", async () => {
    const rows: Array<OnCallRecordColumns> = [];

    for (let index: number = 0; index < 40; index++) {
      rows.push({
        triggeredByIncidentId: incident(
          index,
          1 + (index % 4),
          index % 2 ? PROJECT_A : PROJECT_B,
        ).id!,
      });
      rows.push({ triggeredByAlertId: alert(index, 1 + (index % 4)).id! });
    }

    await OnCallRecordStates.read({ rows });

    expect(IncidentService.findBy).toHaveBeenCalledTimes(1);
    expect(AlertService.findBy).toHaveBeenCalledTimes(1);
    expect(IncidentEpisodeService.findBy).not.toHaveBeenCalled();
    expect(AlertEpisodeService.findBy).not.toHaveBeenCalled();
    expect(IncidentStateService.findBy).toHaveBeenCalledTimes(1);
    expect(AlertStateService.findBy).toHaveBeenCalledTimes(1);

    expect(
      queriedIds((IncidentService.findBy as unknown as AnyMock).mock.calls[0]!),
    ).toHaveLength(40);
    expect(
      queriedProjects(
        (IncidentStateService.findBy as unknown as AnyMock).mock.calls[0]!,
      ).sort(),
    ).toEqual([PROJECT_A.toString(), PROJECT_B.toString()].sort());
  });

  test("asks for a record named by many runs once", async () => {
    const shared: Incident = incident(1, 1);

    await OnCallRecordStates.read({
      rows: [
        { triggeredByIncidentId: shared.id! },
        {
          triggeredByIncidentId: new ObjectID(
            shared.id!.toString().toUpperCase(),
          ),
        },
        { triggeredByIncidentId: shared.id! },
      ],
    });

    expect(
      queriedIds((IncidentService.findBy as unknown as AnyMock).mock.calls[0]!),
    ).toEqual([shared.id!.toString().toLowerCase()]);
  });

  test("reads in chunks, never more ids than its chunk in one query", async () => {
    const rows: Array<OnCallRecordColumns> = [];

    for (
      let index: number = 0;
      index < ON_CALL_RECORD_READ_CHUNK + 20;
      index++
    ) {
      rows.push({ triggeredByIncidentId: incident(index, 1).id! });
    }

    const states: OnCallRecordStates = await OnCallRecordStates.read({ rows });

    expect(IncidentService.findBy).toHaveBeenCalledTimes(2);
    expect(
      (IncidentService.findBy as unknown as AnyMock).mock.calls.map(
        (call: Array<unknown>) => {
          return queriedIds(call).length;
        },
      ),
    ).toEqual([ON_CALL_RECORD_READ_CHUNK, 20]);
    expect(
      states.get("incident", incidents[ON_CALL_RECORD_READ_CHUNK + 5]!.id!),
    ).not.toBeNull();
  });

  test("reads a project's states once for the whole run, however many pages name it", async () => {
    const cache: OnCallStateCache = new OnCallStateCache();

    await OnCallRecordStates.read({
      rows: [{ triggeredByIncidentId: incident(1, 1).id! }],
      cache,
    });
    await OnCallRecordStates.read({
      rows: [
        { triggeredByIncidentId: incident(2, 2).id! },
        { triggeredByIncidentId: incident(3, 2, PROJECT_B).id! },
      ],
      cache,
    });

    expect(IncidentStateService.findBy).toHaveBeenCalledTimes(2);
    expect(
      queriedProjects(
        (IncidentStateService.findBy as unknown as AnyMock).mock.calls[1]!,
      ),
    ).toEqual([PROJECT_B.toString()]);
  });

  test("reads nothing for a page with no records (test pages)", async () => {
    const states: OnCallRecordStates = await OnCallRecordStates.read({
      rows: [{}, {}],
    });

    expect(IncidentService.findBy).not.toHaveBeenCalled();
    expect(IncidentStateService.findBy).not.toHaveBeenCalled();
    expect(states.get("incident", uuid("cccccccc", 1))).toBeUndefined();
  });

  test("a read that fails fails the page: nothing is answered from half a read", async () => {
    jest
      .spyOn(AlertService, "findBy")
      .mockRejectedValue(
        new Error("canceling statement due to statement timeout") as never,
      );

    await expect(
      OnCallRecordStates.read({
        rows: [
          { triggeredByIncidentId: incident(1, 1).id! },
          { triggeredByAlertId: alert(1, 1).id! },
        ],
      }),
    ).rejects.toThrow("statement timeout");
  });
});

describe("answering each record as its own reads did", () => {
  test("acknowledged and resolved by the one rule over the project's states", async () => {
    const rows: Array<OnCallRecordColumns> = [1, 2, 3, 4].map(
      (order: number): OnCallRecordColumns => {
        return { triggeredByIncidentId: incident(order, order).id! };
      },
    );

    const states: OnCallRecordStates = await OnCallRecordStates.read({ rows });

    for (const order of [1, 2, 3, 4]) {
      const record: Incident = incidents[order - 1]!;
      const state: OnCallRecordState = states.get("incident", record.id!)!;
      const projectStates: Array<IncidentState | AlertState> = statesOf(
        PROJECT_A,
        "incident",
      );

      expect(state.isAcknowledged).toBe(
        AcknowledgedStateUtil.isAcknowledged({
          list: StateListType.IncidentState,
          states: projectStates,
          stateId: record.currentIncidentStateId!,
        }),
      );
      expect(state.isResolved).toBe(
        ResolvedStateUtil.isResolved({
          list: StateListType.IncidentState,
          states: projectStates,
          stateId: record.currentIncidentStateId!,
        }),
      );
      expect(state.severityId?.toString()).toBe(
        record.incidentSeverityId!.toString(),
      );
      expect(state.projectId.toString()).toBe(PROJECT_A.toString());
    }

    // Created: neither. Acknowledged and after: acknowledged. Resolved: both.
    expect(
      [1, 2, 3, 4].map((order: number) => {
        const state: OnCallRecordState = states.get(
          "incident",
          incidents[order - 1]!.id!,
        )!;
        return [state.isAcknowledged, state.isResolved];
      }),
    ).toEqual([
      [false, false],
      [true, false],
      [true, false],
      [true, true],
    ]);
  });

  test("a record with no current state is neither acknowledged nor resolved", async () => {
    const record: Incident = incident(1, 1);
    record.currentIncidentStateId = undefined;

    const states: OnCallRecordStates = await OnCallRecordStates.read({
      rows: [{ triggeredByIncidentId: record.id! }],
    });

    expect(states.get("incident", record.id!)).toMatchObject({
      isAcknowledged: false,
      isResolved: false,
      stateId: null,
    });
  });

  test("a record that is gone reads as null, and fails its run with its own read's message", async () => {
    const gone: Array<[keyof OnCallRecordColumns, string, string]> = [
      ["triggeredByIncidentId", "incident", "Incident not found"],
      ["triggeredByAlertId", "alert", "Alert not found"],
      ["triggeredByAlertEpisodeId", "alert episode", "Episode not found."],
      [
        "triggeredByIncidentEpisodeId",
        "incident episode",
        "Episode not found.",
      ],
    ];

    for (const [index, [column, kind, message]] of gone.entries()) {
      const recordId: ObjectID = uuid("eeeeeeee", index + 10);
      const states: OnCallRecordStates = await OnCallRecordStates.read({
        rows: [{ [column]: recordId }],
      });

      expect(states.get(kind as never, recordId)).toBeNull();
      await expect(
        states.getHandledRecordKind({ [column]: recordId }),
      ).rejects.toEqual(new BadDataException(message));
      await expect(
        states.isAcknowledged(kind as never, recordId),
      ).rejects.toEqual(new BadDataException(message));
      await expect(
        states.readRecord(kind as never, recordId),
      ).resolves.toBeNull();
    }
  });

  test("getHandledRecordKind asks alert, incident, alert episode, incident episode, in that order", async () => {
    const acknowledgedIncident: Incident = incident(1, 2);
    const acknowledgedAlert: Alert = alert(1, 3);

    const states: OnCallRecordStates = await OnCallRecordStates.read({
      rows: [
        {
          triggeredByIncidentId: acknowledgedIncident.id!,
          triggeredByAlertId: acknowledgedAlert.id!,
        },
      ],
    });

    await expect(
      states.getHandledRecordKind({
        triggeredByIncidentId: acknowledgedIncident.id!,
        triggeredByAlertId: acknowledgedAlert.id!,
      }),
    ).resolves.toBe("alert");

    await expect(
      states.getHandledRecordKind({
        triggeredByIncidentId: acknowledgedIncident.id!,
      }),
    ).resolves.toBe("incident");

    await expect(states.getHandledRecordKind({})).resolves.toBeNull();
  });

  test("getHandledRecordKind is null while the record is not acknowledged", async () => {
    const open: Incident = incident(1, 1);
    const states: OnCallRecordStates = await OnCallRecordStates.read({
      rows: [{ triggeredByIncidentId: open.id! }],
    });

    await expect(
      states.getHandledRecordKind({ triggeredByIncidentId: open.id! }),
    ).resolves.toBeNull();
  });

  test("getResolvedRecordKind: the run's record kind once resolved, null before, and gone says so", async () => {
    const resolved: Incident = incident(1, 4);
    const acknowledged: Incident = incident(2, 2);
    const goneId: ObjectID = uuid("cccccccc", 99);

    const states: OnCallRecordStates = await OnCallRecordStates.read({
      rows: [
        { triggeredByIncidentId: resolved.id! },
        { triggeredByIncidentId: acknowledged.id! },
        { triggeredByIncidentId: goneId },
      ],
    });

    await expect(
      states.getResolvedRecordKind({ triggeredByIncidentId: resolved.id! }),
    ).resolves.toBe("incident");
    await expect(
      states.getResolvedRecordKind({ triggeredByIncidentId: acknowledged.id! }),
    ).resolves.toBeNull();
    await expect(
      states.getResolvedRecordKind({ triggeredByIncidentId: goneId }),
    ).rejects.toEqual(
      new BadDataException("The incident this page is about is gone."),
    );
    await expect(states.getResolvedRecordKind({})).resolves.toBeNull();
  });

  test("a record no row named was not read, and asking for it says so instead of guessing", async () => {
    const states: OnCallRecordStates = await OnCallRecordStates.read({
      rows: [{ triggeredByIncidentId: incident(1, 1).id! }],
    });

    expect(states.get("alert", uuid("dddddddd", 1))).toBeUndefined();
    await expect(
      states.isAcknowledged("alert", uuid("dddddddd", 1)),
    ).rejects.toThrow("was not read with its page of runs");
  });

  test("episodes are read with their own lists: alert episodes with alert states, incident episodes with incident states", async () => {
    const alertEpisode: AlertEpisode = new AlertEpisode();
    alertEpisode.id = uuid("ffffffff", 1);
    alertEpisode.projectId = PROJECT_A;
    alertEpisode.currentAlertStateId = stateIdOf(PROJECT_A, "alert", 4);
    alertEpisode.alertSeverityId = uuid("66666666", 9);
    alertEpisodes.push(alertEpisode);

    const incidentEpisode: IncidentEpisode = new IncidentEpisode();
    incidentEpisode.id = uuid("ffffffff", 2);
    incidentEpisode.projectId = PROJECT_A;
    incidentEpisode.currentIncidentStateId = stateIdOf(
      PROJECT_A,
      "incident",
      2,
    );
    incidentEpisode.incidentSeverityId = uuid("55555555", 9);
    incidentEpisodes.push(incidentEpisode);

    const states: OnCallRecordStates = await OnCallRecordStates.read({
      rows: [
        { triggeredByAlertEpisodeId: alertEpisode.id! },
        { triggeredByIncidentEpisodeId: incidentEpisode.id! },
      ],
    });

    expect(states.get("alert episode", alertEpisode.id!)).toMatchObject({
      isAcknowledged: true,
      isResolved: true,
    });
    expect(states.get("incident episode", incidentEpisode.id!)).toMatchObject({
      isAcknowledged: true,
      isResolved: false,
    });
    expect(
      states.get("alert episode", alertEpisode.id!)!.severityId!.toString(),
    ).toBe(uuid("66666666", 9).toString());
  });
});
