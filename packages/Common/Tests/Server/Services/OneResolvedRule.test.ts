import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import AIIncidentPostmortemRunner from "../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import InvestigationGrader from "../../../Server/Utils/AI/SRE/InvestigationGrader";
import StateChangeNote from "../../../Server/Utils/StateChangeNote";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
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
 * ONE RULE DECIDES WHETHER AN INCIDENT, ALERT OR EPISODE IS RESOLVED.
 *
 * A record is resolved when its state is at or below its project's resolved
 * state in the project's order of states, or carries the resolved flag - what
 * the state settings page shows as "Counts as: Resolved", and what reminders,
 * status pages, on-call escalation and create-time decisions already read.
 *
 * These are the places that read the resolved flag alone, so that a state of
 * the project's own placed after Resolved without the flag ("Closed",
 * "Postmortem done") was half-resolved:
 *
 *   - moving an incident into it from an open state never gave its monitors
 *     back, drafted no postmortem, graded no investigation and closed no SLA;
 *   - moving an incident on from Resolved into it read as a reopen, and
 *     started a new SLA;
 *   - an episode moved into it lost its resolvedAt, so it was listed as
 *     active again and its auto-resolve tried to move it back to Resolved.
 *
 * And an incident declared already resolved, reopened and resolved again,
 * gave back monitors it never held: whether an incident holds its monitors is
 * now a fact stored on it (Incident.holdsMonitors), not read off its rows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-100000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-1000000000d1",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4fab-8bcd-1000000000e1",
);
const MONITOR_ID: string = "0193c0de-5a7e-4fab-8bcd-1000000000f1";

const IDENTIFIED: string = "0193c0de-5a7e-4fab-8bcd-1000000000a1";
const ACKNOWLEDGED: string = "0193c0de-5a7e-4fab-8bcd-1000000000a2";
const INVESTIGATING: string = "0193c0de-5a7e-4fab-8bcd-1000000000a3";
const RESOLVED: string = "0193c0de-5a7e-4fab-8bcd-1000000000a4";
// The project's own state placed after Resolved, without the flag.
const CLOSED: string = "0193c0de-5a7e-4fab-8bcd-1000000000a5";

const DECLARED_AT: Date = new Date("2026-10-06T08:00:00.000Z");

interface StateRow {
  id: string;
  name: string;
  order: number;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

// Listed out of order on purpose: nothing may lean on the order rows come in.
const STATES: Array<StateRow> = [
  { id: CLOSED, name: "Closed", order: 5 },
  {
    id: ACKNOWLEDGED,
    name: "Acknowledged",
    order: 2,
    isAcknowledgedState: true,
  },
  { id: RESOLVED, name: "Resolved", order: 4, isResolvedState: true },
  { id: IDENTIFIED, name: "Identified", order: 1, isCreatedState: true },
  { id: INVESTIGATING, name: "Investigating", order: 3 },
];

function stateRowOf(id: string): StateRow {
  return STATES.find((state: StateRow): boolean => {
    return state.id === id;
  })!;
}

function toModel<T extends IncidentState | AlertState>(
  modelType: { new (): T },
  row: StateRow,
): T {
  const state: T = new modelType();
  state._id = row.id;
  state.name = row.name;
  state.order = row.order;
  state.isCreatedState = Boolean(row.isCreatedState);
  state.isAcknowledgedState = Boolean(row.isAcknowledgedState);
  state.isResolvedState = Boolean(row.isResolvedState);
  return state;
}

function idOf(query: unknown): string {
  const value: unknown =
    (query as Record<string, unknown> | undefined)?.["_id"] ?? query;
  return value ? value.toString().toLowerCase() : "";
}

/*
 * The project's states, served to whichever read a service makes: the whole
 * list (findBy), one by id (findOneById, findOneBy({_id})) or the resolved
 * state (findOneBy({ isResolvedState: true })).
 */
function serveStates<T extends IncidentState | AlertState>(
  service: unknown,
  modelType: { new (): T },
): void {
  const target: Record<string, unknown> = service as Record<string, unknown>;

  jest
    .spyOn(target as never, "findBy" as never)
    .mockImplementation((async (findBy: {
      query?: Record<string, unknown>;
    }): Promise<Array<T>> => {
      const query: Record<string, unknown> = findBy?.query || {};
      return STATES.filter((row: StateRow): boolean => {
        if (query["isResolvedState"] === true) {
          return Boolean(row.isResolvedState);
        }
        if (query["isResolvedState"] === false) {
          return !row.isResolvedState;
        }
        return true;
      }).map((row: StateRow): T => {
        return toModel(modelType, row);
      });
    }) as never);

  const findOne: (query: Record<string, unknown>) => T | null = (
    query: Record<string, unknown>,
  ): T | null => {
    if (query["_id"]) {
      const row: StateRow | undefined = STATES.find(
        (candidate: StateRow): boolean => {
          return candidate.id === idOf(query);
        },
      );
      return row ? toModel(modelType, row) : null;
    }

    if (query["isResolvedState"] === true) {
      return toModel(modelType, stateRowOf(RESOLVED));
    }

    if (query["isAcknowledgedState"] === true) {
      return toModel(modelType, stateRowOf(ACKNOWLEDGED));
    }

    if (query["isCreatedState"] === true) {
      return toModel(modelType, stateRowOf(IDENTIFIED));
    }

    return null;
  };

  jest
    .spyOn(target as never, "findOneBy" as never)
    .mockImplementation((async (findOneBy: {
      query: Record<string, unknown>;
    }): Promise<T | null> => {
      return findOne(findOneBy.query);
    }) as never);

  jest
    .spyOn(target as never, "findOneById" as never)
    .mockImplementation((async (findOneById: {
      id: ObjectID | string;
    }): Promise<T | null> => {
      return findOne({ _id: findOneById.id.toString() });
    }) as never);
}

// Lets the fire-and-forget steps of a success hook (the SLA) settle.
async function flush(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident's state change: one rule decides when it is resolved", () => {
  let givenBack: Array<Array<unknown>> = [];
  let postmortemDrafts: number = 0;
  let gradings: number = 0;
  let slaResolved: Array<Date> = [];
  let slaCreated: Array<Date> = [];
  let incidentUpdates: Array<JSONObject> = [];
  // What the incident holds of its monitors, as stored (undefined: not read).
  let holdsMonitors: boolean | null = null;

  beforeEach(() => {
    givenBack = [];
    postmortemDrafts = 0;
    gradings = 0;
    slaResolved = [];
    slaCreated = [];
    incidentUpdates = [];
    holdsMonitors = null;

    serveStates(IncidentStateService, IncidentState);

    jest
      .spyOn(IncidentService, "updateOneBy")
      .mockImplementation((async (updateBy: {
        data: JSONObject;
      }): Promise<number> => {
        incidentUpdates.push(updateBy.data);
        return 1;
      }) as never);
    jest
      .spyOn(IncidentService, "updateOneById")
      .mockImplementation((async (updateBy: {
        data: JSONObject;
      }): Promise<void> => {
        incidentUpdates.push(updateBy.data);
      }) as never);
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
      .spyOn(timelineService, "isLastIncidentState")
      .mockResolvedValue(false as never);
    jest
      .spyOn(timelineService, "autoAssignIncidentCommander")
      .mockResolvedValue(undefined as never);

    jest.spyOn(IncidentService, "findOneBy").mockImplementation((async () => {
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID.toString();
      incident.projectId = PROJECT_ID;
      incident.declaredAt = DECLARED_AT;
      if (holdsMonitors !== null) {
        incident.holdsMonitors = holdsMonitors;
      }
      const monitor: Monitor = new Monitor();
      monitor._id = MONITOR_ID;
      incident.monitors = [monitor];
      return incident;
    }) as never);
    jest.spyOn(IncidentService, "findOneById").mockImplementation((async () => {
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID.toString();
      incident.projectId = PROJECT_ID;
      incident.declaredAt = DECLARED_AT;
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
      .mockImplementation((async (): Promise<void> => {
        gradings++;
      }) as never);

    jest
      .spyOn(IncidentSlaService, "markResolved")
      .mockImplementation((async (data: {
        resolvedAt: Date;
      }): Promise<void> => {
        slaResolved.push(data.resolvedAt);
      }) as never);
    jest
      .spyOn(IncidentSlaService, "markResponded")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentSlaService, "createSlaForIncident")
      .mockImplementation((async (data: {
        declaredAt: Date;
      }): Promise<void> => {
        slaCreated.push(data.declaredAt);
      }) as never);
  });

  function row(stateId: string, startsAt: Date): IncidentStateTimeline {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline._id = ObjectID.generate().toString();
    timeline.projectId = PROJECT_ID;
    timeline.incidentId = INCIDENT_ID;
    timeline.incidentStateId = new ObjectID(stateId);
    timeline.incidentState = toModel(IncidentState, stateRowOf(stateId));
    timeline.startsAt = startsAt;
    return timeline;
  }

  /*
   * A new row in `to`, `minutesIn` after the incident was declared, with the
   * row before it in `from` (none: it is the first) and, when `later` is
   * given, a row after it - a row dated before the incident's current one.
   */
  async function move(
    from: string | null,
    to: string,
    options: { minutesIn?: number; later?: string; miscData?: JSONObject } = {},
  ): Promise<IncidentStateTimeline> {
    const startsAt: Date = OneUptimeDate.addRemoveMinutes(
      DECLARED_AT,
      options.minutesIn ?? 30,
    );
    const created: IncidentStateTimeline = row(to, startsAt);
    const after: IncidentStateTimeline | null = options.later
      ? row(options.later, OneUptimeDate.addRemoveMinutes(startsAt, 30))
      : null;

    if (after) {
      created.endsAt = after.startsAt!;
    }

    const hooks: Record<string, (...args: Array<unknown>) => Promise<unknown>> =
      IncidentStateTimelineService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<unknown>
      >;

    await hooks["onCreateSuccess"]!.call(
      IncidentStateTimelineService,
      {
        createBy: {
          data: created,
          props: { isRoot: true },
          ...(options.miscData ? { miscDataProps: options.miscData } : {}),
        },
        carryForward: {
          statusTimelineBeforeThisStatus: from
            ? row(from, OneUptimeDate.addRemoveMinutes(startsAt, -10))
            : null,
          statusTimelineAfterThisStatus: after,
          mutex: null,
        },
      },
      created,
    );

    await flush();

    return created;
  }

  describe("a state of the project's own placed after Resolved, without the flag, counts as resolved", () => {
    test("moving into it from an open state resolves the incident: its monitors are given back, a postmortem is drafted, the investigation is graded and the SLA is closed", async () => {
      const created: IncidentStateTimeline = await move(ACKNOWLEDGED, CLOSED);

      expect(givenBack).toHaveLength(1);
      expect(String(givenBack[0]![0])).toBe(PROJECT_ID.toString());
      expect(
        (givenBack[0]![1] as Array<Monitor>).map((monitor: Monitor) => {
          return monitor._id;
        }),
      ).toEqual([MONITOR_ID]);
      expect(givenBack[0]![2]).toEqual(created.startsAt);
      expect(postmortemDrafts).toBe(1);
      expect(gradings).toBe(1);
      expect(slaResolved).toEqual([created.startsAt]);
      expect(slaCreated).toEqual([]);
    });

    test("moving into it from a state between Acknowledged and Resolved resolves it too", async () => {
      await move(INVESTIGATING, CLOSED);

      expect(givenBack).toHaveLength(1);
      expect(postmortemDrafts).toBe(1);
    });

    test("moving on from Resolved into it is no new resolve and no reopen: nothing is given back again, no second draft or grading, and no new SLA starts", async () => {
      await move(RESOLVED, CLOSED);

      expect(givenBack).toEqual([]);
      expect(postmortemDrafts).toBe(0);
      expect(gradings).toBe(0);
      expect(slaCreated).toEqual([]);
      expect(slaResolved).toEqual([]);
    });

    test("an incident declared in it is resolved from its first state: it held nothing, so nothing is given back", async () => {
      holdsMonitors = false;

      await move(null, CLOSED, { minutesIn: 0 });

      expect(givenBack).toEqual([]);
      // Still over: its postmortem is drafted, as for any resolved incident.
      expect(postmortemDrafts).toBe(1);
    });
  });

  describe("the project's resolved state, as before", () => {
    test("resolving an open incident gives its monitors back once", async () => {
      await move(ACKNOWLEDGED, RESOLVED);

      expect(givenBack).toHaveLength(1);
      expect(postmortemDrafts).toBe(1);
      expect(slaResolved).toHaveLength(1);
    });

    test("a state between Acknowledged and Resolved is not resolved: nothing is given back", async () => {
      await move(ACKNOWLEDGED, INVESTIGATING);

      expect(givenBack).toEqual([]);
      expect(postmortemDrafts).toBe(0);
      expect(slaResolved).toEqual([]);
    });
  });

  describe("a resolve gives back only the monitors the incident holds", () => {
    test("an incident that holds its monitors gives them back, and from then on holds nothing", async () => {
      holdsMonitors = true;

      await move(ACKNOWLEDGED, RESOLVED);

      expect(givenBack).toHaveLength(1);
      expect(incidentUpdates).toContainEqual({ holdsMonitors: false });
    });

    test("declared already resolved, reopened and resolved again: it never held its monitors, so the second resolve gives nothing back either", async () => {
      // Declared resolved: its create recorded that it holds nothing.
      holdsMonitors = false;

      // Reopened (its resolved row deleted), then resolved again.
      await move(IDENTIFIED, RESOLVED);

      expect(givenBack).toEqual([]);
      // Still resolved: the postmortem draft and the SLA follow the state.
      expect(postmortemDrafts).toBe(1);
    });

    test("resolved, reopened and resolved again: the monitors went back the first time, so the second resolve gives nothing back", async () => {
      holdsMonitors = true;

      await move(ACKNOWLEDGED, RESOLVED);
      expect(givenBack).toHaveLength(1);

      // What the first resolve stored.
      holdsMonitors = false;

      await move(IDENTIFIED, RESOLVED, { minutesIn: 90 });

      expect(givenBack).toHaveLength(1);
    });

    test("an incident from before this was recorded (holds nothing known) gives its monitors back when it resolves, as it always did", async () => {
      holdsMonitors = null;

      await move(ACKNOWLEDGED, RESOLVED);

      expect(givenBack).toHaveLength(1);
    });

    test("a resolved row dated before the incident's current state does not resolve it: nothing is given back while the incident is still open", async () => {
      holdsMonitors = true;

      await move(IDENTIFIED, RESOLVED, { later: ACKNOWLEDGED });

      expect(givenBack).toEqual([]);
      expect(postmortemDrafts).toBe(0);
    });

    test("a request's misc data cannot keep the monitors: what the incident holds is read off the incident", async () => {
      holdsMonitors = true;

      await move(ACKNOWLEDGED, RESOLVED, {
        miscData: { incidentNeverHeldItsMonitors: true },
      });

      expect(givenBack).toHaveLength(1);
    });
  });
});

describe("an episode's resolvedAt follows the one rule", () => {
  let episodeUpdates: Array<JSONObject> = [];
  let storedResolvedAt: Date | null = null;

  beforeEach(() => {
    episodeUpdates = [];
    storedResolvedAt = null;

    serveStates(IncidentStateService, IncidentState);
    serveStates(AlertStateService, AlertState);

    // What the episode services write, and the episode they read back.
    const recordUpdate: (updateBy: {
      data: JSONObject;
    }) => Promise<number> = async (updateBy: {
      data: JSONObject;
    }): Promise<number> => {
      episodeUpdates.push(updateBy.data);
      return 1;
    };

    const recordUpdateById: (updateBy: {
      data: JSONObject;
    }) => Promise<void> = async (updateBy: {
      data: JSONObject;
    }): Promise<void> => {
      episodeUpdates.push(updateBy.data);
    };

    const storedEpisode: () => Promise<JSONObject> =
      async (): Promise<JSONObject> => {
        return {
          _id: EPISODE_ID.toString(),
          id: EPISODE_ID,
          projectId: PROJECT_ID,
          episodeNumber: 3,
          episodeNumberWithPrefix: "EP-3",
          resolvedAt: storedResolvedAt,
        } as unknown as JSONObject;
      };

    for (const service of [IncidentEpisodeService, AlertEpisodeService]) {
      jest
        .spyOn(service as never, "updateOneBy" as never)
        .mockImplementation(recordUpdate as never);
      jest
        .spyOn(service as never, "updateOneById" as never)
        .mockImplementation(recordUpdateById as never);
      jest
        .spyOn(service as never, "findOneById" as never)
        .mockImplementation(storedEpisode as never);
      jest
        .spyOn(service as never, "findOneBy" as never)
        .mockImplementation(storedEpisode as never);
    }

    jest
      .spyOn(IncidentEpisodeService, "cascadeStateToMemberIncidents")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertEpisodeService, "cascadeStateToMemberAlerts")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentEpisodeStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertEpisodeStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StateChangeNote, "postPrivateNotes")
      .mockResolvedValue(undefined as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  });

  interface EpisodeKind {
    name: string;
    move: (from: string | null, to: string) => Promise<void>;
  }

  const KINDS: Array<EpisodeKind> = [
    {
      name: "incident episode",
      move: async (from: string | null, to: string): Promise<void> => {
        const created: IncidentEpisodeStateTimeline =
          new IncidentEpisodeStateTimeline();
        created._id = ObjectID.generate().toString();
        created.projectId = PROJECT_ID;
        created.incidentEpisodeId = EPISODE_ID;
        created.incidentStateId = new ObjectID(to);
        created.startsAt = OneUptimeDate.getCurrentDate();

        let before: IncidentEpisodeStateTimeline | null = null;

        if (from) {
          before = new IncidentEpisodeStateTimeline();
          before._id = ObjectID.generate().toString();
          before.incidentStateId = new ObjectID(from);
          before.incidentState = toModel(IncidentState, stateRowOf(from));
        }

        await (
          IncidentEpisodeStateTimelineService as unknown as Record<
            string,
            (...args: Array<unknown>) => Promise<unknown>
          >
        )["onCreateSuccess"]!.call(
          IncidentEpisodeStateTimelineService,
          {
            createBy: { data: created, props: { isRoot: true } },
            carryForward: {
              statusTimelineBeforeThisStatus: before,
              statusTimelineAfterThisStatus: null,
              privateNotesToPost: [],
              mutex: null,
            },
          },
          created,
        );
      },
    },
    {
      name: "alert episode",
      move: async (from: string | null, to: string): Promise<void> => {
        const created: AlertEpisodeStateTimeline =
          new AlertEpisodeStateTimeline();
        created._id = ObjectID.generate().toString();
        created.projectId = PROJECT_ID;
        created.alertEpisodeId = EPISODE_ID;
        created.alertStateId = new ObjectID(to);
        created.startsAt = OneUptimeDate.getCurrentDate();

        let before: AlertEpisodeStateTimeline | null = null;

        if (from) {
          before = new AlertEpisodeStateTimeline();
          before._id = ObjectID.generate().toString();
          before.alertStateId = new ObjectID(from);
          before.alertState = toModel(AlertState, stateRowOf(from));
        }

        await (
          AlertEpisodeStateTimelineService as unknown as Record<
            string,
            (...args: Array<unknown>) => Promise<unknown>
          >
        )["onCreateSuccess"]!.call(
          AlertEpisodeStateTimelineService,
          {
            createBy: { data: created, props: { isRoot: true } },
            carryForward: {
              statusTimelineBeforeThisStatus: before,
              statusTimelineAfterThisStatus: null,
              privateNotesToPost: [],
              mutex: null,
            },
          },
          created,
        );
      },
    },
  ];

  function resolvedAtWritten(): Array<unknown> {
    return episodeUpdates
      .filter((data: JSONObject): boolean => {
        return Object.prototype.hasOwnProperty.call(data, "resolvedAt");
      })
      .map((data: JSONObject): unknown => {
        return data["resolvedAt"];
      });
  }

  describe.each(KINDS)("$name", (kind: EpisodeKind) => {
    test("moving into a state placed after Resolved without the flag resolves it: resolvedAt is set, not cleared", async () => {
      const before: number = Date.now();

      await kind.move(ACKNOWLEDGED, CLOSED);

      const written: Array<unknown> = resolvedAtWritten();
      expect(written).toHaveLength(1);
      expect(written[0]).toBeInstanceOf(Date);
      expect((written[0] as Date).getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );
    });

    test("moving on from Resolved into it keeps the moment it was resolved", async () => {
      storedResolvedAt = new Date("2026-10-06T09:00:00.000Z");

      await kind.move(RESOLVED, CLOSED);

      const written: Array<unknown> = resolvedAtWritten();
      // Never cleared, never moved.
      expect(
        written.every((value: unknown): boolean => {
          return (
            value instanceof Date &&
            value.getTime() === storedResolvedAt!.getTime()
          );
        }),
      ).toBe(true);
    });

    test("resolving it stamps resolvedAt", async () => {
      await kind.move(ACKNOWLEDGED, RESOLVED);

      expect(resolvedAtWritten()[0]).toBeInstanceOf(Date);
    });

    test("reopening it (back to a state above Resolved) clears resolvedAt", async () => {
      storedResolvedAt = new Date("2026-10-06T09:00:00.000Z");

      await kind.move(CLOSED, IDENTIFIED);

      expect(resolvedAtWritten()).toEqual([null]);
    });

    test("a state between Acknowledged and Resolved is not resolved", async () => {
      await kind.move(ACKNOWLEDGED, INVESTIGATING);

      expect(resolvedAtWritten()).toEqual([null]);
    });
  });
});
