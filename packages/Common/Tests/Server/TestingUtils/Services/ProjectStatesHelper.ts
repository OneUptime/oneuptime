import AlertState from "../../../../Models/DatabaseModels/AlertState";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import Includes from "../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../Types/ObjectID";
import { jest } from "@jest/globals";

/*
 * A project's incident and alert states, as the state services read them
 * (getAllIncidentStates / getAllAlertStates), for suites that run code which
 * asks whether a record is resolved: Created, Acknowledged, Resolved and,
 * placed after it, Closed - which carries no resolved flag and counts as
 * resolved all the same (Common/Utils/ResolvedState).
 *
 * The open incidents' and alerts' queries, isIncidentResolved, the resolve
 * targets and the rest read the project's states through those two methods,
 * so faking them is how a suite that fakes the database answers all of them.
 */

export interface ProjectStateIds {
  created: ObjectID;
  acknowledged: ObjectID;
  resolved: ObjectID;
  closed: ObjectID;
}

export const INCIDENT_STATE_IDS: ProjectStateIds = {
  created: new ObjectID("7c0a3f10-0000-4000-8000-0000000000a1"),
  acknowledged: new ObjectID("7c0a3f10-0000-4000-8000-0000000000a2"),
  resolved: new ObjectID("7c0a3f10-0000-4000-8000-0000000000a3"),
  closed: new ObjectID("7c0a3f10-0000-4000-8000-0000000000a4"),
};

export const ALERT_STATE_IDS: ProjectStateIds = {
  created: new ObjectID("7c0a3f10-0000-4000-8000-0000000000b1"),
  acknowledged: new ObjectID("7c0a3f10-0000-4000-8000-0000000000b2"),
  resolved: new ObjectID("7c0a3f10-0000-4000-8000-0000000000b3"),
  closed: new ObjectID("7c0a3f10-0000-4000-8000-0000000000b4"),
};

interface StateFields {
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

function fill<T extends IncidentState | AlertState>(
  state: T,
  data: { id: ObjectID; name: string; order: number } & StateFields,
): T {
  state._id = data.id.toString();
  state.name = data.name;
  state.order = data.order;
  state.isCreatedState = Boolean(data.isCreatedState);
  state.isAcknowledgedState = Boolean(data.isAcknowledgedState);
  state.isResolvedState = Boolean(data.isResolvedState);
  return state;
}

function rows(
  ids: ProjectStateIds,
): Array<{ id: ObjectID; name: string; order: number } & StateFields> {
  return [
    { id: ids.created, name: "Created", order: 1, isCreatedState: true },
    {
      id: ids.acknowledged,
      name: "Acknowledged",
      order: 2,
      isAcknowledgedState: true,
    },
    { id: ids.resolved, name: "Resolved", order: 3, isResolvedState: true },
    { id: ids.closed, name: "Closed", order: 4 },
  ];
}

export function makeIncidentStates(): Array<IncidentState> {
  return rows(INCIDENT_STATE_IDS).map(
    (
      row: { id: ObjectID; name: string; order: number } & StateFields,
    ): IncidentState => {
      return fill(new IncidentState(), row);
    },
  );
}

export function makeAlertStates(): Array<AlertState> {
  return rows(ALERT_STATE_IDS).map(
    (
      row: { id: ObjectID; name: string; order: number } & StateFields,
    ): AlertState => {
      return fill(new AlertState(), row);
    },
  );
}

/*
 * Fakes both state services' reads of a project's states with the lists
 * above (or the ones given). Restored with the suite's other spies.
 */
export function mockProjectStates(
  data: {
    incidentStates?: Array<IncidentState>;
    alertStates?: Array<AlertState>;
  } = {},
): {
  incidentStates: Array<IncidentState>;
  alertStates: Array<AlertState>;
} {
  const incidentStates: Array<IncidentState> =
    data.incidentStates || makeIncidentStates();
  const alertStates: Array<AlertState> = data.alertStates || makeAlertStates();

  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockResolvedValue(incidentStates);
  jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockResolvedValue(alertStates);

  return { incidentStates, alertStates };
}

// The ids of the states an open record is in: Created and Acknowledged.
export function openStateIds(ids: ProjectStateIds): Array<string> {
  return [ids.created.toString(), ids.acknowledged.toString()];
}

// The ids of the states a resolved record is in: Resolved and Closed.
export function resolvedStateIds(ids: ProjectStateIds): Array<string> {
  return [ids.resolved.toString(), ids.closed.toString()];
}

/*
 * The ids a QueryHelper.any(...) or an Includes filter matches, as strings -
 * what a query on currentIncidentStateId or currentAlertStateId asks for.
 * Empty for a filter that matches nothing (any of no ids).
 */
export function idsOfAnyFilter(filter: unknown): Array<string> {
  if (filter instanceof Includes) {
    return (filter.values as Array<unknown>).map((value: unknown): string => {
      return String(value);
    });
  }

  const parameters: Record<string, unknown> =
    (filter as { objectLiteralParameters?: Record<string, unknown> } | null)
      ?.objectLiteralParameters || {};

  const values: unknown = Object.values(parameters)[0];

  return Array.isArray(values)
    ? values.map((value: unknown): string => {
        return String(value);
      })
    : [];
}
