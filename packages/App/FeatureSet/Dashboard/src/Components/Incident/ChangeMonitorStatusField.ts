import { getIdsFromFormValue } from "./IncidentStatusPageScopeForm";

/*
 * "Change Monitor Status to" on the incident forms: Declare Incident and the
 * Edit of an incident's Affected Resources card. The maintainer: "we also
 * need to have monitors and other affected resources as seperate things (so
 * change monitor state to makes more sense), only show that dropdown if any
 * monitor is selected."
 *
 * So the monitors are picked on their own, the status sits right under
 * them, and it is asked only once a monitor is picked. Hidden, it keeps what
 * it holds - a template's status, or one picked before the last monitor was
 * removed - and shows it again with the next monitor; but it is never sent
 * without a monitor, so nothing stale reaches the incident.
 *
 * React-free, so App/Tests can check the rules directly.
 */

// The flag the affected resources picker marks its payload with.
const PICKER_PAYLOAD_FLAG: string = "__affectedResourcesPayload";

/*
 * The ids of the monitors a form value holds, in any shape the form holds
 * them (bare ids, ObjectIDs, models, {_id, name} objects). Between the
 * Monitors picker's change and the split that follows it a microtask later,
 * the form holds the picker's whole payload under `monitors`: its own
 * `monitors` are read then, so the status does not drop out for that moment.
 */
export const getPickedMonitorIds: (monitors: unknown) => Array<string> = (
  monitors: unknown,
): Array<string> => {
  if (
    monitors &&
    typeof monitors === "object" &&
    !Array.isArray(monitors) &&
    (monitors as Record<string, unknown>)[PICKER_PAYLOAD_FLAG] === true
  ) {
    return getIdsFromFormValue(
      (monitors as Record<string, unknown>)["monitors"],
    );
  }

  return getIdsFromFormValue(monitors);
};

// Whether the form's values hold a monitor: when the status is asked.
export const hasPickedMonitors: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  if (!values || typeof values !== "object") {
    return false;
  }

  return (
    getPickedMonitorIds((values as Record<string, unknown>)["monitors"])
      .length > 0
  );
};

export interface ItemWithMonitorStatus {
  changeMonitorStatusTo?: unknown;
  changeMonitorStatusToId?: unknown;
}

/*
 * The incident a form is about to send, without a monitor status when the
 * form holds no monitor to put in it. Left out of the request, the column is
 * left as it is: empty on an incident being declared, and on an edit the
 * status the incident already had - the same as when the form sent that
 * status back unchanged. With a monitor, nothing is touched.
 */
export const omitMonitorStatusWithoutMonitors: <
  T extends ItemWithMonitorStatus,
>(data: {
  item: T;
  formValues: unknown;
}) => T = <T extends ItemWithMonitorStatus>(data: {
  item: T;
  formValues: unknown;
}): T => {
  if (hasPickedMonitors(data.formValues)) {
    return data.item;
  }

  delete data.item.changeMonitorStatusTo;
  delete data.item.changeMonitorStatusToId;

  return data.item;
};
