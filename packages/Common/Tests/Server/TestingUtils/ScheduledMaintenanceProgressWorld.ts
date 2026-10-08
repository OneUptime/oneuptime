import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ObjectID from "../../../Types/ObjectID";
import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * A project's scheduled maintenance states with states of its own on every
 * side of the built-in ones, and a stand-in for the database reads of them
 * and of the events in them - for the suites that pin which events count as
 * in progress (Common/Utils/ScheduledMaintenanceStart).
 *
 * Its list, top first:
 *
 *   1 Scheduled   built-in            waiting to start
 *   2 Confirmed   the project's own   waiting to start (before Ongoing)
 *   3 Ongoing     built-in            in progress
 *   4 Verifying   the project's own   in progress (between Ongoing and Ended)
 *   5 Ended       built-in            over
 *   6 Reviewing   the project's own   over (after Ended)
 *   7 Completed   built-in            over
 *   8 Archived    the project's own   over (after Completed)
 *
 * The stand-ins keep only the rows a query's conditions on these columns let
 * through, as the database would: an event's project, its state by id (one
 * id, or a list of them as QueryHelper.any writes it) and its state's flags.
 */

export const PROGRESS_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);

export type ProgressStateKey =
  | "scheduled"
  | "confirmed"
  | "ongoing"
  | "verifying"
  | "ended"
  | "reviewing"
  | "completed"
  | "archived";

interface ProgressStateSpec {
  key: ProgressStateKey;
  id: string;
  name: string;
  order: number;
  isScheduledState?: boolean;
  isOngoingState?: boolean;
  isEndedState?: boolean;
  isResolvedState?: boolean;
}

const SPECS: Array<ProgressStateSpec> = [
  {
    key: "scheduled",
    id: "5a000000-0000-4000-8000-0000000000a1",
    name: "Scheduled",
    order: 1,
    isScheduledState: true,
  },
  {
    key: "confirmed",
    id: "5a000000-0000-4000-8000-0000000000a2",
    name: "Confirmed",
    order: 2,
  },
  {
    key: "ongoing",
    id: "5a000000-0000-4000-8000-0000000000a3",
    name: "Ongoing",
    order: 3,
    isOngoingState: true,
  },
  {
    key: "verifying",
    id: "5a000000-0000-4000-8000-0000000000a4",
    name: "Verifying",
    order: 4,
  },
  {
    key: "ended",
    id: "5a000000-0000-4000-8000-0000000000a5",
    name: "Ended",
    order: 5,
    isEndedState: true,
  },
  {
    key: "reviewing",
    id: "5a000000-0000-4000-8000-0000000000a6",
    name: "Reviewing",
    order: 6,
  },
  {
    key: "completed",
    id: "5a000000-0000-4000-8000-0000000000a7",
    name: "Completed",
    order: 7,
    isResolvedState: true,
  },
  {
    key: "archived",
    id: "5a000000-0000-4000-8000-0000000000a8",
    name: "Archived",
    order: 8,
  },
];

export const PROGRESS_STATE_KEYS: Array<ProgressStateKey> = SPECS.map(
  (spec: ProgressStateSpec): ProgressStateKey => {
    return spec.key;
  },
);

// Where an event in each state is: waiting to start, in progress, or over.
export const IN_PROGRESS_KEYS: Array<ProgressStateKey> = [
  "ongoing",
  "verifying",
];

export const NOT_IN_PROGRESS_KEYS: Array<ProgressStateKey> =
  PROGRESS_STATE_KEYS.filter((key: ProgressStateKey): boolean => {
    return !IN_PROGRESS_KEYS.includes(key);
  });

export function progressStateId(key: ProgressStateKey): ObjectID {
  return new ObjectID(specOf(key).id);
}

function specOf(key: ProgressStateKey): ProgressStateSpec {
  return SPECS.find((spec: ProgressStateSpec): boolean => {
    return spec.key === key;
  })!;
}

// One state of the project's list, as the state service reads it.
export function makeProgressState(
  key: ProgressStateKey,
  projectId: ObjectID = PROGRESS_PROJECT_ID,
): ScheduledMaintenanceState {
  const spec: ProgressStateSpec = specOf(key);
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = spec.id;
  state.projectId = projectId;
  state.name = spec.name;
  state.order = spec.order;
  state.isScheduledState = Boolean(spec.isScheduledState);
  state.isOngoingState = Boolean(spec.isOngoingState);
  state.isEndedState = Boolean(spec.isEndedState);
  state.isResolvedState = Boolean(spec.isResolvedState);
  return state;
}

export function makeProgressStates(
  projectId: ObjectID = PROGRESS_PROJECT_ID,
): Array<ScheduledMaintenanceState> {
  return PROGRESS_STATE_KEYS.map(
    (key: ProgressStateKey): ScheduledMaintenanceState => {
      return makeProgressState(key, projectId);
    },
  );
}

// An event of the project in `key`, read with its state.
export function makeEventInState(
  key: ProgressStateKey,
  data: { id?: string; title?: string; projectId?: ObjectID } = {},
): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = data.id || ObjectID.generate().toString();
  event.projectId = data.projectId || PROGRESS_PROJECT_ID;
  event.title = data.title || `Event in ${specOf(key).name}`;
  event.currentScheduledMaintenanceStateId = progressStateId(key);
  event.currentScheduledMaintenanceState = makeProgressState(
    key,
    event.projectId,
  );
  return event;
}

/*
 * The values a condition on an id column names: one id, an ObjectID, or the
 * list QueryHelper.any binds to its Raw IN. Null for no condition.
 */
export function idsOfCondition(condition: unknown): Array<string> | null {
  if (condition === undefined || condition === null) {
    return null;
  }

  if (condition instanceof ObjectID || typeof condition === "string") {
    return [condition.toString().toLowerCase()];
  }

  if (condition instanceof FindOperator) {
    const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
    const values: Array<unknown> = Object.values(
      (operator.objectLiteralParameters as Record<string, unknown>) || {},
    );

    // QueryHelper.any([]) binds nothing: it asks for no row at all.
    const ids: Array<unknown> = (values[0] as Array<unknown>) || [];

    return ids.map((id: unknown): string => {
      return String(id).toLowerCase();
    });
  }

  return [String(condition).toLowerCase()];
}

const STATE_FLAGS: Array<keyof ScheduledMaintenanceState> = [
  "isScheduledState",
  "isOngoingState",
  "isEndedState",
  "isResolvedState",
];

// Whether a state passes a query's conditions on its flags.
export function stateMatchesFlags(
  state: ScheduledMaintenanceState | undefined,
  conditions: Record<string, unknown> | undefined,
): boolean {
  if (!conditions) {
    return true;
  }

  for (const flag of STATE_FLAGS) {
    const wanted: unknown = conditions[flag as string];

    if (wanted === undefined) {
      continue;
    }

    if (Boolean(state?.[flag]) !== Boolean(wanted)) {
      return false;
    }
  }

  return true;
}

function sameProject(
  projectId: ObjectID | undefined,
  condition: unknown,
): boolean {
  if (condition === undefined) {
    return true;
  }

  return (
    projectId?.toString().toLowerCase() === String(condition).toLowerCase()
  );
}

/*
 * Whether an event passes a query's conditions on its project and its
 * state: by id (currentScheduledMaintenanceStateId), and by the state's
 * flags (currentScheduledMaintenanceState: { isOngoingState: true }).
 */
export function eventMatchesStateQuery(
  event: ScheduledMaintenance,
  query: Record<string, unknown>,
): boolean {
  if (!sameProject(event.projectId, query["projectId"])) {
    return false;
  }

  const stateIds: Array<string> | null = idsOfCondition(
    query["currentScheduledMaintenanceStateId"],
  );

  if (
    stateIds &&
    !stateIds.includes(
      event.currentScheduledMaintenanceStateId?.toString().toLowerCase() || "",
    )
  ) {
    return false;
  }

  return stateMatchesFlags(
    event.currentScheduledMaintenanceState,
    query["currentScheduledMaintenanceState"] as
      | Record<string, unknown>
      | undefined,
  );
}

/*
 * The state service's reads of the project's states, kept to the rows each
 * query lets through (its project, its ids, its flags). Restored with the
 * suite's other spies.
 */
export function mockProgressStateReads(
  states: Array<ScheduledMaintenanceState> = makeProgressStates(),
): { findBy: SpyInstance<typeof ScheduledMaintenanceStateService.findBy> } {
  const statesFor: (
    query: Record<string, unknown>,
  ) => Array<ScheduledMaintenanceState> = (
    query: Record<string, unknown>,
  ): Array<ScheduledMaintenanceState> => {
    const ids: Array<string> | null = idsOfCondition(query["_id"]);
    const projectIds: Array<string> | null =
      query["projectId"] instanceof FindOperator
        ? idsOfCondition(query["projectId"])
        : null;

    return states.filter((state: ScheduledMaintenanceState): boolean => {
      return (
        (projectIds
          ? projectIds.includes(state.projectId?.toString().toLowerCase() || "")
          : sameProject(state.projectId, query["projectId"])) &&
        (!ids || ids.includes(state._id?.toString().toLowerCase() || "")) &&
        stateMatchesFlags(state, query)
      );
    });
  };

  const findBy: SpyInstance<typeof ScheduledMaintenanceStateService.findBy> =
    jest
      .spyOn(ScheduledMaintenanceStateService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        return statesFor(args.query || {});
      }) as never) as unknown as SpyInstance<
      typeof ScheduledMaintenanceStateService.findBy
    >;

  jest
    .spyOn(ScheduledMaintenanceStateService, "findAllBy")
    .mockImplementation((async (args: { query: Record<string, unknown> }) => {
      return statesFor(args.query || {});
    }) as never);

  jest
    .spyOn(ScheduledMaintenanceStateService, "findOneBy")
    .mockImplementation((async (args: { query: Record<string, unknown> }) => {
      return statesFor(args.query || {})[0] || null;
    }) as never);

  return { findBy };
}
