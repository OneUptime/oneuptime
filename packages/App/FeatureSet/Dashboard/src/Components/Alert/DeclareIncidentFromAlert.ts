import {
  DECLARE_INCIDENT_ACTION_TITLE,
  getDeclareIncidentFromAlertsRoute,
} from "./BulkIncidentLinkActions";
import { EventPanelAction } from "../EventView/EventStatusPanel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * "Declare Incident" in an alert's header, beside Acknowledge and Resolve. It
 * opens the create-incident page prefilled from the alert, exactly like the
 * button on the alert's Linked Incidents page and the bulk action on the
 * alerts table.
 */

export const DECLARE_INCIDENT_FROM_ALERT_BUTTON_ID: string =
  "alert-declare-incident-btn";

/*
 * Declaring creates the incident and then links the alerts to it, so it needs
 * both permissions. They are checked in that order - the same order as the
 * bulk action and the Linked Incidents page - and the first one that is not
 * allowed is the answer, so its reason names the first thing missing.
 */
export const getDeclareIncidentFromAlertsGate: () => PermissionGateResult =
  (): PermissionGateResult => {
    const incidentGate: PermissionGateResult = PermissionGate.check(
      new Incident(),
      ModelAction.Create,
    );

    if (!incidentGate.isAllowed) {
      return incidentGate;
    }

    return PermissionGate.check(new IncidentAlert(), ModelAction.Create);
  };

/*
 * The header action for one alert, or null when it should not be offered.
 * Follows PermissionGate's rule: allowed is a working button; a missing
 * permission is a disabled button whose tooltip says which; an unknown answer
 * (the permission snapshot has not loaded yet) hides the button rather than
 * accuse the user of lacking a permission they may hold.
 *
 * Offered whatever state the alert is in: declaring an incident for an alert
 * that has already been resolved (to run a postmortem on it, say) is allowed
 * everywhere else too.
 */
export const getDeclareIncidentFromAlertAction: (
  alertId: ObjectID,
) => EventPanelAction | null = (alertId: ObjectID): EventPanelAction | null => {
  const gate: PermissionGateResult = getDeclareIncidentFromAlertsGate();

  if (!gate.isAllowed && !gate.disabledReason) {
    return null;
  }

  const action: EventPanelAction = {
    id: DECLARE_INCIDENT_FROM_ALERT_BUTTON_ID,
    label: DECLARE_INCIDENT_ACTION_TITLE,
    icon: IconProp.Alert,
    onClick: () => {
      Navigation.navigate(
        getDeclareIncidentFromAlertsRoute([alertId.toString()]),
      );
    },
  };

  if (!gate.isAllowed) {
    return {
      ...action,
      isDisabled: true,
      tooltip: gate.disabledReason,
      onClick: () => {
        // Locked: the tooltip says which permission is missing.
      },
    };
  }

  return action;
};
