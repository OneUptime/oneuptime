import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import StateChangeLock from "../../../Server/Utils/StateChangeLock";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * EVERY STATE TIMELINE HOLDS A NEW ROW TO THE ONE STATE MOVE RULE
 * (Common/Utils/StateMove) - an episode's as an incident's, an alert's and a
 * scheduled maintenance event's.
 *
 * The report: an episode's timeline refused only a state equal to the one
 * before or after it, so a resolved episode could be moved back to an
 * earlier state from the dashboard or a chat, and the move cascaded to its
 * incidents or alerts as OneUptime. Each timeline service now reads the row
 * before the new one (with its state's place) and the row after it, and asks
 * the rule; the one move back up is the grouping rule's reopen
 * (createReopen), which nothing a person sends can ask for.
 *
 * These drive each service's onBeforeCreate - the hook that decides - with
 * the timeline's reads, the state reads and the lock faked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000002",
);

// The last row of the timeline started at 08:00; the new one at 09:00.
const PREVIOUS_AT: Date = new Date("2026-10-11T08:00:00.000Z");
const CHANGED_AT: Date = new Date("2026-10-11T09:00:00.000Z");
const NEXT_AT: Date = new Date("2026-10-11T10:00:00.000Z");

interface ProjectState {
  _id: string;
  name: string;
  order: number;
}

function stateNamed(index: number, name: string): ProjectState {
  return {
    _id: `7e000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
    name: name,
    order: index,
  };
}

// The project's states, top first: four built-in ones and one of its own after them.
function incidentLikeStates(): Array<ProjectState> {
  return [
    stateNamed(1, "Created"),
    stateNamed(2, "Acknowledged"),
    stateNamed(3, "Investigating"),
    stateNamed(4, "Resolved"),
    stateNamed(5, "Closed"),
  ];
}

interface TimelineKind {
  name: string;
  subject: string;
  listName: string;
  service: unknown;
  stateService: unknown;
  states: Array<ProjectState>;
  lockNamespace: string;
  stateColumn: string;
  stateRelation: string;
  build: (stateId: ObjectID, startsAt: Date) => BaseModel;
  isEpisode: boolean;
}

const KINDS: Array<TimelineKind> = [
  {
    name: "an incident",
    subject: "Incident",
    listName: "incident states",
    service: IncidentStateTimelineService,
    stateService: IncidentStateService,
    states: incidentLikeStates(),
    lockNamespace: "IncidentStateTimeline.create",
    stateColumn: "incidentStateId",
    stateRelation: "incidentState",
    build: (stateId: ObjectID, startsAt: Date): BaseModel => {
      const row: IncidentStateTimeline = new IncidentStateTimeline();
      row.projectId = PROJECT_ID;
      row.incidentId = RECORD_ID;
      row.incidentStateId = stateId;
      row.startsAt = startsAt;
      return row;
    },
    isEpisode: false,
  },
  {
    name: "an alert",
    subject: "Alert",
    listName: "alert states",
    service: AlertStateTimelineService,
    stateService: AlertStateService,
    states: incidentLikeStates(),
    lockNamespace: "AlertStateTimeline.create",
    stateColumn: "alertStateId",
    stateRelation: "alertState",
    build: (stateId: ObjectID, startsAt: Date): BaseModel => {
      const row: AlertStateTimeline = new AlertStateTimeline();
      row.projectId = PROJECT_ID;
      row.alertId = RECORD_ID;
      row.alertStateId = stateId;
      row.startsAt = startsAt;
      return row;
    },
    isEpisode: false,
  },
  {
    name: "an incident episode",
    subject: "Episode",
    listName: "incident states",
    service: IncidentEpisodeStateTimelineService,
    stateService: IncidentStateService,
    states: incidentLikeStates(),
    lockNamespace: "IncidentEpisodeStateTimeline.create",
    stateColumn: "incidentStateId",
    stateRelation: "incidentState",
    build: (stateId: ObjectID, startsAt: Date): BaseModel => {
      const row: IncidentEpisodeStateTimeline =
        new IncidentEpisodeStateTimeline();
      row.projectId = PROJECT_ID;
      row.incidentEpisodeId = RECORD_ID;
      row.incidentStateId = stateId;
      row.startsAt = startsAt;
      return row;
    },
    isEpisode: true,
  },
  {
    name: "an alert episode",
    subject: "Episode",
    listName: "alert states",
    service: AlertEpisodeStateTimelineService,
    stateService: AlertStateService,
    states: incidentLikeStates(),
    lockNamespace: "AlertEpisodeStateTimeline.create",
    stateColumn: "alertStateId",
    stateRelation: "alertState",
    build: (stateId: ObjectID, startsAt: Date): BaseModel => {
      const row: AlertEpisodeStateTimeline = new AlertEpisodeStateTimeline();
      row.projectId = PROJECT_ID;
      row.alertEpisodeId = RECORD_ID;
      row.alertStateId = stateId;
      row.startsAt = startsAt;
      return row;
    },
    isEpisode: true,
  },
  {
    name: "a scheduled maintenance event",
    subject: "Scheduled Maintenance",
    listName: "scheduled maintenance states",
    service: ScheduledMaintenanceStateTimelineService,
    stateService: ScheduledMaintenanceStateService,
    states: [
      stateNamed(1, "Scheduled"),
      stateNamed(2, "Ongoing"),
      stateNamed(3, "Ended"),
      stateNamed(4, "Completed"),
      stateNamed(5, "Archived"),
    ],
    lockNamespace: "ScheduledMaintenanceStateTimeline.create",
    stateColumn: "scheduledMaintenanceStateId",
    stateRelation: "scheduledMaintenanceState",
    build: (stateId: ObjectID, startsAt: Date): BaseModel => {
      const row: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      row.projectId = PROJECT_ID;
      row.scheduledMaintenanceId = RECORD_ID;
      row.scheduledMaintenanceStateId = stateId;
      row.startsAt = startsAt;
      return row;
    },
    isEpisode: false,
  },
];

interface Harness {
  // The rows the timeline holds around the new one.
  serve: (data: {
    previous: ProjectState | null;
    next?: ProjectState | null | undefined;
    previousHasPlace?: boolean | undefined;
  }) => void;
  // The new row, created as OneUptime; what onBeforeCreate decides.
  decide: (state: ProjectState, startsAt?: Date) => Promise<unknown>;
  createBy: (state: ProjectState, startsAt?: Date) => CreateBy<BaseModel>;
  beforeCreate: (createBy: CreateBy<BaseModel>) => Promise<unknown>;
  stateReads: ReturnType<typeof getJestSpyOn>;
  locksTaken: Array<string>;
  locksGivenBack: Array<unknown>;
}

const LOCK: { name: string } = { name: "the record's lock" };

function harnessFor(kind: TimelineKind): Harness {
  const locksTaken: Array<string> = [];
  const locksGivenBack: Array<unknown> = [];

  getJestSpyOn(StateChangeLock, "take").mockImplementation((async (data: {
    namespace: string;
  }): Promise<unknown> => {
    locksTaken.push(data.namespace);
    return LOCK;
  }) as never);
  getJestSpyOn(StateChangeLock, "giveBack").mockImplementation((async (
    mutex: unknown,
  ): Promise<void> => {
    locksGivenBack.push(mutex);
  }) as never);
  getJestSpyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  ).mockResolvedValue(undefined as never);

  const stateReads: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    kind.stateService,
    "findOneBy",
  ).mockImplementation((async (findOneBy: {
    query: Dictionary<unknown>;
  }): Promise<ProjectState | null> => {
    const id: string = String(findOneBy.query["_id"]).toLowerCase();

    return (
      kind.states.find((state: ProjectState): boolean => {
        return state._id === id;
      }) || null
    );
  }) as never);

  const createBy: Harness["createBy"] = (
    state: ProjectState,
    startsAt: Date = CHANGED_AT,
  ): CreateBy<BaseModel> => {
    return {
      data: kind.build(new ObjectID(state._id), startsAt),
      props: { isRoot: true },
    };
  };

  const beforeCreate: Harness["beforeCreate"] = (
    data: CreateBy<BaseModel>,
  ): Promise<unknown> => {
    return (
      kind.service as {
        onBeforeCreate: (createBy: CreateBy<BaseModel>) => Promise<unknown>;
      }
    ).onBeforeCreate(data);
  };

  return {
    serve: (data: {
      previous: ProjectState | null;
      next?: ProjectState | null | undefined;
      previousHasPlace?: boolean | undefined;
    }): void => {
      getJestSpyOn(kind.service, "findOneBy").mockImplementation(
        (async (findOneBy: {
          sort: Dictionary<SortOrder>;
        }): Promise<BaseModel | null> => {
          const isRowBefore: boolean =
            findOneBy.sort["startsAt"] === SortOrder.Descending;
          const state: ProjectState | null | undefined = isRowBefore
            ? data.previous
            : data.next;

          if (!state) {
            return null;
          }

          const row: BaseModel = kind.build(
            new ObjectID(state._id),
            isRowBefore ? PREVIOUS_AT : NEXT_AT,
          );

          if (isRowBefore) {
            (row as unknown as Dictionary<unknown>)[kind.stateRelation] =
              data.previousHasPlace === false
                ? { _id: state._id, name: state.name }
                : { _id: state._id, name: state.name, order: state.order };
          }

          return row;
        }) as never,
      );
    },
    decide: (state: ProjectState, startsAt?: Date): Promise<unknown> => {
      return beforeCreate(createBy(state, startsAt));
    },
    createBy,
    beforeCreate,
    stateReads,
    locksTaken,
    locksGivenBack,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "a new row of $name's state timeline",
  (kind: TimelineKind) => {
    let harness: Harness;

    beforeEach(() => {
      harness = harnessFor(kind);
    });

    const [first, second, third, closing, after] = kind.states as [
      ProjectState,
      ProjectState,
      ProjectState,
      ProjectState,
      ProjectState,
    ];

    test("moves it down the list: a state or several at once", async () => {
      for (const [from, to] of [
        [first, second],
        [first, closing],
        [second, third],
        [third, closing],
        [closing, after],
      ] as Array<[ProjectState, ProjectState]>) {
        harness.serve({ previous: from });

        await harness.decide(to);
      }
    });

    test("is refused a move back up the list, with the rule's sentence, and gives the lock back", async () => {
      harness.serve({ previous: closing });

      const error: unknown = await rejectionOf(harness.decide(second));

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        `${kind.subject} cannot transition to ${second.name} state from ${closing.name} state because ${second.name} is before ${closing.name} in the order of ${kind.listName}.`,
      );

      // The lock this hook took is given back: no create follows to do it.
      expect(harness.locksTaken).toEqual([kind.lockNamespace]);
      expect(harness.locksGivenBack).toEqual([LOCK]);
    });

    test("from a state of the project's own after the closing one, every state up the list is refused", async () => {
      for (const to of [first, second, third, closing]) {
        harness.serve({ previous: after });

        await expect(harness.decide(to)).rejects.toThrow(
          `${kind.subject} cannot transition to ${to.name} state from ${after.name} state because ${to.name} is before ${after.name} in the order of ${kind.listName}.`,
        );
      }
    });

    test("from the closing state, only the project's own state after it is taken", async () => {
      harness.serve({ previous: closing });
      await harness.decide(after);

      for (const to of [first, second, third]) {
        harness.serve({ previous: closing });

        await expect(harness.decide(to)).rejects.toThrow(
          `${kind.subject} cannot transition to ${to.name} state`,
        );
      }
    });

    test("is refused the state it is in already", async () => {
      harness.serve({ previous: third });

      await expect(harness.decide(third)).rejects.toThrow(
        `${kind.subject} state cannot be same as previous state.`,
      );
    });

    test("dated before a later row, is refused that row's state", async () => {
      harness.serve({ previous: first, next: third });

      await expect(harness.decide(third)).rejects.toThrow(
        `${kind.subject} state cannot be same as next state.`,
      );
    });

    test("dated before a later row, takes another state after the one before it", async () => {
      harness.serve({ previous: first, next: third });

      await harness.decide(second);
    });

    test("the record's first row may be any state, and is compared with nothing", async () => {
      harness.serve({ previous: null });

      await harness.decide(after);

      expect(harness.stateReads).not.toHaveBeenCalled();
    });

    test("after a state without a place, is compared by id alone", async () => {
      harness.serve({ previous: closing, previousHasPlace: false });

      await harness.decide(first);
    });

    test("reads the state it moves to once, as OneUptime, for its place and name", async () => {
      harness.serve({ previous: first });

      await harness.decide(third);

      expect(harness.stateReads).toHaveBeenCalledTimes(1);
      const read: {
        query: Dictionary<unknown>;
        select: Dictionary<unknown>;
        props: Dictionary<unknown>;
      } = harness.stateReads.mock.calls[0]![0];
      expect(String(read.query["_id"]).toLowerCase()).toBe(third._id);
      expect(read.select).toEqual({ order: true, name: true });
      expect(read.props).toEqual({ isRoot: true });
    });

    if (!kind.isEpisode) {
      return;
    }

    describe("the grouping rule's reopen", () => {
      function createReopenOf(): (
        createBy: CreateBy<BaseModel>,
      ) => Promise<unknown> {
        // The create's own pipeline hands the same createBy to onBeforeCreate.
        getJestSpyOn(kind.service, "create").mockImplementation((async (
          createBy: CreateBy<BaseModel>,
        ): Promise<unknown> => {
          return harness.beforeCreate(createBy);
        }) as never);

        return (createBy: CreateBy<BaseModel>): Promise<unknown> => {
          return (
            kind.service as {
              createReopen: (createBy: CreateBy<BaseModel>) => Promise<unknown>;
            }
          ).createReopen(createBy);
        };
      }

      test("moves a resolved episode back up the list, through the create", async () => {
        const createReopen: (
          createBy: CreateBy<BaseModel>,
        ) => Promise<unknown> = createReopenOf();
        harness.serve({ previous: closing });

        const decided: unknown = await createReopen(harness.createBy(first));

        // Taken: the hook hands the row on, in the earlier state.
        const row: BaseModel = (decided as { createBy: CreateBy<BaseModel> })
          .createBy.data;
        expect(String(row.getColumnValue(kind.stateColumn)).toLowerCase()).toBe(
          first._id,
        );
      });

      test("is OneUptime's own: the same move sent as a plain create is refused", async () => {
        harness.serve({ previous: closing });

        await expect(harness.decide(first)).rejects.toThrow(
          `Episode cannot transition to ${first.name} state from ${closing.name} state`,
        );
      });

      test("holds only for the create it was asked for", async () => {
        const createReopen: (
          createBy: CreateBy<BaseModel>,
        ) => Promise<unknown> = createReopenOf();
        harness.serve({ previous: closing });
        const reopened: CreateBy<BaseModel> = harness.createBy(first);

        await createReopen(reopened);

        // The same request, created again, is a plain create.
        await expect(harness.beforeCreate(reopened)).rejects.toThrow(
          "Episode cannot transition to",
        );
      });

      test("never puts the episode in the state it is in", async () => {
        const createReopen: (
          createBy: CreateBy<BaseModel>,
        ) => Promise<unknown> = createReopenOf();
        harness.serve({ previous: closing });

        await expect(createReopen(harness.createBy(closing))).rejects.toThrow(
          "Episode state cannot be same as previous state.",
        );
      });

      test("a reopen that fails takes nothing with it", async () => {
        const createReopen: (
          createBy: CreateBy<BaseModel>,
        ) => Promise<unknown> = createReopenOf();
        harness.serve({ previous: closing });
        const refused: CreateBy<BaseModel> = harness.createBy(closing);

        await rejectionOf(createReopen(refused));

        refused.data.setColumnValue(kind.stateColumn, new ObjectID(first._id));

        await expect(harness.beforeCreate(refused)).rejects.toThrow(
          "Episode cannot transition to",
        );
      });
    });
  },
);
