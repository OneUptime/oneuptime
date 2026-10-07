import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";
import {
  ItemWithMonitorStatus,
  omitMonitorStatusWithoutMonitors,
} from "../Incident/ChangeMonitorStatusField";

/*
 * Change Monitor Status to on the Edit of a scheduled maintenance event's
 * Affected Resources card. The maintainer's decision: an event's status can
 * be edited until the event starts, and is read-only once it is ongoing,
 * with a line saying why.
 *
 * So until the event starts the Edit asks it right under the monitors, as
 * Create Scheduled Maintenance Event does (only once a monitor is picked);
 * from then on it shows the status read-only and sends nothing for it. The
 * server holds the same line (ScheduledMaintenanceService refuses a change
 * once the event has started), by the same rule
 * (Common/Utils/ScheduledMaintenanceStart).
 *
 * React-free, so App/Tests can check the rules directly.
 */

/*
 * Whether the event a page shows has started: its current state, read with
 * its place in the list and its flags, among the project's states.
 */
export const hasScheduledMaintenanceEventStarted: (data: {
  states: Array<unknown>;
  currentState: unknown;
}) => boolean = (data: {
  states: Array<unknown>;
  currentState: unknown;
}): boolean => {
  return ScheduledMaintenanceStartUtil.hasStarted({
    states: data.states,
    state: data.currentState,
  });
};

/*
 * The id a form value holds for the status, in any shape the form holds it:
 * an id (as the form loads a relation), an ObjectID, or a relation object
 * carrying `_id` or `id`. Null for none.
 */
export const getMonitorStatusIdFromFormValue: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  if (value instanceof ObjectID || typeof value === "string") {
    return value.toString().trim() || null;
  }

  if (value && typeof value === "object") {
    const relation: { _id?: unknown; id?: unknown } = value as {
      _id?: unknown;
      id?: unknown;
    };
    const id: unknown = relation._id ?? relation.id;

    // One level down only: a relation's id is an id, not another relation.
    if (id instanceof ObjectID || typeof id === "string") {
      return id.toString().trim() || null;
    }
  }

  return null;
};

/*
 * What the Edit sends for the event: no status without a monitor to put in
 * it (omitMonitorStatusWithoutMonitors), and none at all once the event has
 * started - the field is read-only then, its value the one the event
 * holds. Left out of the request, the column is left as it is.
 */
export const getScheduledMaintenanceAffectedResourcesToSave: <
  T extends ItemWithMonitorStatus,
>(data: {
  item: T;
  formValues: unknown;
  hasEventStarted: boolean;
}) => T = <T extends ItemWithMonitorStatus>(data: {
  item: T;
  formValues: unknown;
  hasEventStarted: boolean;
}): T => {
  const item: T = omitMonitorStatusWithoutMonitors({
    item: data.item,
    formValues: data.formValues,
  });

  if (data.hasEventStarted) {
    delete item.changeMonitorStatusTo;
    delete item.changeMonitorStatusToId;
  }

  return item;
};
