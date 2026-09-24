import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  createIncidentAlertLink,
  fetchIncidentLinkOptions,
  isAlreadyLinkedError,
} from "../IncidentAlert/IncidentAlertLink";
import LinkIncidentAlertModal from "../IncidentAlert/LinkIncidentAlertModal";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import Route from "Common/Types/API/Route";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "Common/Types/Incident/IncidentAlertLink";
import ObjectID from "Common/Types/ObjectID";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { ReactElement, useState } from "react";

/*
 * "Link to Incident" and "Declare Incident" for a selection of alerts. Both
 * write one IncidentAlert link per alert, which is a create on that model, so
 * both are gated on it; declaring also creates the incident, and linking to
 * an existing incident needs to be able to read incidents (the server refuses
 * a link to an incident the caller cannot see, and the picker could not list
 * any).
 *
 * Both are capped at MAX_ALERTS_PER_INCIDENT_LINK_ACTION: every link posts a
 * feed entry to the incident (and its Slack / Microsoft Teams channels), and
 * declaring carries the ids in the create page's URL. "Select all" can pick
 * thousands of alerts, so above the cap the actions stay on the menu, locked,
 * with a tooltip that says why.
 */

export const LINK_TO_INCIDENT_ACTION_TITLE: string = "Link to Incident";
export const DECLARE_INCIDENT_ACTION_TITLE: string = "Declare Incident";

export const LINK_CAP_TOOLTIP: string = `Select ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alerts or fewer to link them to an incident.`;

export const DECLARE_CAP_TOOLTIP: string = `Select ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alerts or fewer to declare an incident from them.`;

export interface BulkIncidentLinkActionsResult {
  bulkActions: Array<BulkActionButtonSchema<Alert>>;
  modals: ReactElement;
}

type GetDeclareIncidentFromAlertsRouteFunction = (
  alertIds: Array<string>,
) => Route;

/*
 * The create-incident page, prefilled from these alerts and linking them when
 * the incident is declared.
 */
export const getDeclareIncidentFromAlertsRoute: GetDeclareIncidentFromAlertsRouteFunction =
  (alertIds: Array<string>): Route => {
    return RouteUtil.populateRouteParams(
      new Route(
        (RouteMap[PageMap.INCIDENT_CREATE] as Route).toString(),
      ).addQueryParams({
        [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: alertIds.join(","),
      }),
    );
  };

type GetAlertIdsFunction = (alerts: Array<Alert>) => Array<string>;

const getAlertIds: GetAlertIdsFunction = (
  alerts: Array<Alert>,
): Array<string> => {
  return alerts
    .map((alert: Alert): string => {
      return alert.id?.toString() || alert._id?.toString() || "";
    })
    .filter((alertId: string): boolean => {
      return Boolean(alertId);
    });
};

type GateActionFunction = (
  action: BulkActionButtonSchema<Alert>,
  gates: Array<PermissionGateResult>,
) => BulkActionButtonSchema<Alert>;

/*
 * Same convention as the other bulk-action hooks: a known missing permission
 * locks the action and says which one; an unknown answer (the permission
 * snapshot has not landed yet) leaves it alone.
 */
const gateAction: GateActionFunction = (
  action: BulkActionButtonSchema<Alert>,
  gates: Array<PermissionGateResult>,
): BulkActionButtonSchema<Alert> => {
  for (const gate of gates) {
    if (!gate.isAllowed && gate.disabledReason) {
      return {
        ...action,
        disabled: true,
        tooltip: gate.disabledReason,
      };
    }
  }

  return action;
};

type CapActionFunction = (
  action: BulkActionButtonSchema<Alert>,
  tooltip: string,
) => Array<BulkActionButtonSchema<Alert>>;

/*
 * The action bar only tells an action which rows are selected through
 * `isVisible`, and `disabled` is fixed. So a capped action is two entries,
 * exactly one of which is visible for any selection: the working one up to
 * the cap, and a locked twin with the reason above it. An action already
 * locked for permission stays a single entry - that reason wins.
 */
const capAction: CapActionFunction = (
  action: BulkActionButtonSchema<Alert>,
  tooltip: string,
): Array<BulkActionButtonSchema<Alert>> => {
  if (action.disabled) {
    return [action];
  }

  return [
    {
      ...action,
      isVisible: (items: Array<Alert>): boolean => {
        return items.length <= MAX_ALERTS_PER_INCIDENT_LINK_ACTION;
      },
    },
    {
      ...action,
      isVisible: (items: Array<Alert>): boolean => {
        return items.length > MAX_ALERTS_PER_INCIDENT_LINK_ACTION;
      },
      disabled: true,
      tooltip: tooltip,
    },
  ];
};

function useBulkIncidentLinkActions(): BulkIncidentLinkActionsResult {
  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<Alert> | null>(null);

  const closeLinkModal: () => void = (): void => {
    setShowLinkModal(false);
    setBulkActionProps(null);
  };

  const linkAlertsToIncident: (incidentId: string) => Promise<void> = async (
    incidentId: string,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    // Close the form modal first so the progress modal is visible.
    setShowLinkModal(false);

    if (!incidentId || items.length === 0) {
      setBulkActionProps(null);
      return;
    }

    onBulkActionStart();

    const totalItems: Array<Alert> = [...items];
    const inProgressItems: Array<Alert> = [...items];
    const successItems: Array<Alert> = [];
    const failedItems: Array<BulkActionFailed<Alert>> = [];

    for (const alert of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(alert), 1);

      try {
        const alertId: string = getAlertIds([alert])[0] || "";

        if (!alertId) {
          throw new BadDataException("Alert ID not found");
        }

        await createIncidentAlertLink({
          incidentId: new ObjectID(incidentId),
          alertId: new ObjectID(alertId),
        });

        successItems.push(alert);
      } catch (err) {
        const message: string = API.getFriendlyMessage(err);

        if (isAlreadyLinkedError(message)) {
          successItems.push(alert);
        } else {
          failedItems.push({
            item: alert,
            failedMessage: message,
          });
        }
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: [...failedItems],
        successItems: [...successItems],
        inProgressItems: [...inProgressItems],
      });
    }

    onBulkActionEnd();
    setBulkActionProps(null);
  };

  const linkGate: PermissionGateResult = PermissionGate.check(
    new IncidentAlert(),
    ModelAction.Create,
  );

  const incidentReadGate: PermissionGateResult = PermissionGate.check(
    new Incident(),
    ModelAction.Read,
  );

  const declareGate: PermissionGateResult = PermissionGate.check(
    new Incident(),
    ModelAction.Create,
  );

  const linkToIncidentAction: BulkActionButtonSchema<Alert> = {
    title: LINK_TO_INCIDENT_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Link,
    onClick: async (
      actionProps: BulkActionOnClickProps<Alert>,
    ): Promise<void> => {
      if (actionProps.items.length > MAX_ALERTS_PER_INCIDENT_LINK_ACTION) {
        return;
      }

      setBulkActionProps(actionProps);
      setShowLinkModal(true);
    },
  };

  const declareIncidentAction: BulkActionButtonSchema<Alert> = {
    title: DECLARE_INCIDENT_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Alert,
    onClick: async (
      actionProps: BulkActionOnClickProps<Alert>,
    ): Promise<void> => {
      const alertIds: Array<string> = getAlertIds(actionProps.items);

      if (
        alertIds.length === 0 ||
        alertIds.length > MAX_ALERTS_PER_INCIDENT_LINK_ACTION
      ) {
        return;
      }

      Navigation.navigate(getDeclareIncidentFromAlertsRoute(alertIds));
    },
  };

  const modals: ReactElement = (
    <>
      {showLinkModal && (
        <LinkIncidentAlertModal
          title="Link to Incident"
          description="Link the selected alerts to an incident that is already open. Alerts that are already linked to it are left as they are."
          submitButtonText="Link Alerts"
          fieldTitle="Incident"
          fieldDescription="Recent incidents are listed with their number. Type to search every incident by title."
          placeholder="Select an incident"
          modelType={Incident}
          loadOptions={fetchIncidentLinkOptions}
          onClose={closeLinkModal}
          onSubmit={linkAlertsToIncident}
        />
      )}
    </>
  );

  return {
    bulkActions: [
      ...capAction(
        gateAction(linkToIncidentAction, [linkGate, incidentReadGate]),
        LINK_CAP_TOOLTIP,
      ),
      ...capAction(
        gateAction(declareIncidentAction, [declareGate, linkGate]),
        DECLARE_CAP_TOOLTIP,
      ),
    ],
    modals: modals,
  };
}

export default useBulkIncidentLinkActions;
