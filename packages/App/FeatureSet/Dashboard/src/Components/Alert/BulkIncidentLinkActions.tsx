import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM,
  MAX_ALERTS_PER_INCIDENT_LINK_ACTION,
} from "Common/Types/Incident/IncidentAlertLink";
import { JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { MutableRefObject, ReactElement, useRef, useState } from "react";

/*
 * "Link to Incident" and "Declare Incident" for a selection of alerts. Both
 * write one IncidentAlert link per alert, which is a create on that model, so
 * both are gated on it; declaring also creates the incident.
 *
 * Both are capped at MAX_ALERTS_PER_INCIDENT_LINK_ACTION: every link posts a
 * feed entry to the incident (and its Slack / Microsoft Teams channels), and
 * declaring carries the ids in the create page's URL. "Select all" can pick
 * thousands of alerts, so above the cap the actions stay on the menu, locked,
 * with a tooltip that says why.
 */

export const LINK_TO_INCIDENT_ACTION_TITLE: string = "Link to Incident";
export const DECLARE_INCIDENT_ACTION_TITLE: string = "Declare Incident";

/*
 * How many incidents the link dialog lists up front, newest first, labelled
 * with their number so they can be found by it. Typing searches every
 * incident by title on the server.
 */
export const INCIDENT_LINK_OPTIONS_LIMIT: number = 500;

export const LINK_CAP_TOOLTIP: string = `Select ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alerts or fewer to link them to an incident.`;

export const DECLARE_CAP_TOOLTIP: string = `Select ${MAX_ALERTS_PER_INCIDENT_LINK_ACTION} alerts or fewer to declare an incident from them.`;

export interface BulkIncidentLinkActionsResult {
  bulkActions: Array<BulkActionButtonSchema<Alert>>;
  modals: ReactElement;
}

interface LinkToIncidentFormData {
  incidentId?: JSONValue | undefined;
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

type IsAlreadyLinkedErrorFunction = (message: string) => boolean;

/*
 * Linking an alert that is already linked to the incident leaves it exactly
 * where the user wanted it, so it counts as done rather than as a failure.
 */
export const isAlreadyLinkedError: IsAlreadyLinkedErrorFunction = (
  message: string,
): boolean => {
  return (message || "").toLowerCase().includes("already linked");
};

type GetIncidentOptionLabelFunction = (incident: Incident) => string;

export const getIncidentOptionLabel: GetIncidentOptionLabelFunction = (
  incident: Incident,
): string => {
  const title: string = incident.title || "";
  const incidentNumber: string =
    incident.incidentNumberWithPrefix ||
    (typeof incident.incidentNumber === "number"
      ? `#${incident.incidentNumber}`
      : "");

  if (!incidentNumber) {
    return title;
  }

  return title ? `${incidentNumber}: ${title}` : incidentNumber;
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

type ToIdStringFunction = (value: JSONValue | undefined) => string;

const toIdString: ToIdStringFunction = (
  value: JSONValue | undefined,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const optionValue: JSONValue | undefined = (
      value as { value?: JSONValue | undefined }
    ).value;

    if (optionValue !== undefined && optionValue !== null) {
      return optionValue.toString();
    }
  }

  return value.toString();
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
  const [incidentOptions, setIncidentOptions] = useState<Array<DropdownOption>>(
    [],
  );
  const [isLoadingIncidents, setIsLoadingIncidents] = useState<boolean>(false);
  const incidentOptionsRequestRef: MutableRefObject<number> = useRef<number>(0);

  /*
   * Fetched when the dialog opens rather than on mount: the alerts table is
   * on many pages, and most visits never link anything.
   */
  const loadIncidentOptions: () => Promise<void> = async (): Promise<void> => {
    const requestId: number = ++incidentOptionsRequestRef.current;

    setIsLoadingIncidents(true);

    try {
      const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
        modelType: Incident,
        query: {},
        limit: INCIDENT_LINK_OPTIONS_LIMIT,
        skip: 0,
        select: {
          _id: true,
          title: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
      });

      if (requestId === incidentOptionsRequestRef.current) {
        setIncidentOptions(
          result.data
            .filter((incident: Incident): boolean => {
              return Boolean(incident._id);
            })
            .map((incident: Incident): DropdownOption => {
              return {
                label: getIncidentOptionLabel(incident),
                value: incident._id!.toString(),
              };
            }),
        );
      }
    } catch {
      /*
       * The dropdown still searches incidents by title on the server, so a
       * failed prefetch only loses the numbered shortlist.
       */
      if (requestId === incidentOptionsRequestRef.current) {
        setIncidentOptions([]);
      }
    } finally {
      if (requestId === incidentOptionsRequestRef.current) {
        setIsLoadingIncidents(false);
      }
    }
  };

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

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
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

        const link: IncidentAlert = new IncidentAlert();
        link.incidentId = new ObjectID(incidentId);
        link.alertId = new ObjectID(alertId);

        if (projectId) {
          link.projectId = projectId;
        }

        await ModelAPI.create<IncidentAlert>({
          model: link,
          modelType: IncidentAlert,
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
      await loadIncidentOptions();
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
        <BasicFormModal<LinkToIncidentFormData>
          title="Link to Incident"
          description="Link the selected alerts to an incident that is already open. Alerts that are already linked to it are left as they are."
          isLoading={isLoadingIncidents}
          onClose={closeLinkModal}
          submitButtonText="Link Alerts"
          onSubmit={async (formData: LinkToIncidentFormData) => {
            await linkAlertsToIncident(toIdString(formData.incidentId));
          }}
          formProps={{
            fields: [
              {
                field: {
                  incidentId: true,
                },
                title: "Incident",
                description:
                  "Recent incidents are listed with their number. Type to search every incident by title.",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                placeholder: "Select an incident",
                dropdownModal: {
                  type: Incident,
                  labelField: "title",
                  valueField: "_id",
                },
                dropdownOptions: incidentOptions,
              },
            ],
          }}
        />
      )}
    </>
  );

  return {
    bulkActions: [
      ...capAction(
        gateAction(linkToIncidentAction, [linkGate]),
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
