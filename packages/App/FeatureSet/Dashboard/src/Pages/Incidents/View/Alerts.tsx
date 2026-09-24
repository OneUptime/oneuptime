import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  DeleteConfirmation,
  ModalTableBulkDefaultActions,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import IncidentAlert from "Common/Models/DatabaseModels/IncidentAlert";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlertElement from "../../../Components/Alert/Alert";
import UserElement from "../../../Components/User/User";
import Pill from "Common/UI/Components/Pill/Pill";
import { Black } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

/*
 * The alerts linked to an incident (IncidentAlert rows). Linking creates a
 * row and unlinking deletes it; the alert itself is never touched.
 */
const IncidentViewAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * Relations are only joined one level deep, so an alert's current state
   * cannot be selected through the link row - it is looked up here by id.
   */
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);

  useEffect(() => {
    const fetchStates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              name: true,
              color: true,
            },
            sort: {},
          });
        setAlertStates(result.data);
      } catch {
        // Silently fail - states just won't show
      }
    };

    fetchStates();
  }, []);

  const getStateById: (
    stateId: ObjectID | string | undefined,
  ) => AlertState | undefined = (
    stateId: ObjectID | string | undefined,
  ): AlertState | undefined => {
    if (!stateId) {
      return undefined;
    }
    const stateIdStr: string = stateId.toString();
    return alertStates.find((state: AlertState) => {
      return state._id?.toString() === stateIdStr;
    });
  };

  return (
    <ModelTable<IncidentAlert>
      modelType={IncidentAlert}
      name="Incident Linked Alerts"
      id="incident-linked-alerts-table"
      userPreferencesKey="incident-linked-alerts-table"
      isDeleteable={true}
      isEditable={false}
      isCreateable={true}
      isViewable={false}
      createVerb="Link"
      singularName="Alert"
      pluralName="Alerts"
      deleteButtonText="Unlink"
      getDeleteConfirmation={async (): Promise<DeleteConfirmation> => {
        return {
          title: "Unlink Alert",
          description:
            "Unlink this alert from the incident? The alert itself is not deleted, and it stays linked to any other incidents.",
          submitButtonText: "Unlink",
        };
      }}
      query={{
        incidentId: modelId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      bulkActions={{
        buttons: [ModalTableBulkDefaultActions.Delete],
        deleteConfirmationWarning:
          "Only the links are removed: the alerts themselves are not deleted, and they stay linked to any other incidents.",
      }}
      onBeforeCreate={(item: IncidentAlert): Promise<IncidentAlert> => {
        item.incidentId = modelId;
        item.projectId = ProjectUtil.getCurrentProjectId()!;
        return Promise.resolve(item);
      }}
      filters={[]}
      cardProps={{
        title: "Linked Alerts",
        description:
          "Alerts linked to this incident. Link the alerts this incident is responding to so the whole response is tracked in one place.",
      }}
      noItemsMessage="No alerts are linked to this incident."
      showRefreshButton={true}
      actionButtons={[
        {
          title: "View Alert",
          buttonStyleType: ButtonStyleType.OUTLINE,
          onClick: (item: IncidentAlert, onCompleteAction: () => void) => {
            if (item.alert?._id) {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.ALERT_VIEW] as Route,
                  { modelId: new ObjectID(item.alert._id.toString()) },
                ),
              );
            }
            onCompleteAction();
          },
        } as ActionButtonSchema<IncidentAlert>,
      ]}
      formFields={[
        {
          field: {
            alertId: true,
          },
          title: "Alert",
          description: "Select an alert to link to this incident.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Select an alert",
          dropdownModal: {
            type: Alert,
            labelField: "title",
            valueField: "_id",
          },
        },
      ]}
      columns={[
        {
          field: {
            alert: {
              alertNumber: true,
              alertNumberWithPrefix: true,
            },
          },
          title: "Alert #",
          type: FieldType.Text,
          getElement: (item: IncidentAlert): ReactElement => {
            if (!item.alert?.alertNumber) {
              return <>-</>;
            }
            return (
              <>
                {item.alert.alertNumberWithPrefix ||
                  `#${item.alert.alertNumber}`}
              </>
            );
          },
        },
        {
          field: {
            alert: {
              title: true,
              _id: true,
              currentAlertStateId: true,
            },
          },
          title: "Title",
          type: FieldType.Element,
          getElement: (item: IncidentAlert): ReactElement => {
            if (!item.alert) {
              return <>-</>;
            }
            return <AlertElement alert={item.alert} />;
          },
        },
        {
          field: {
            alert: {
              currentAlertStateId: true,
            },
          },
          title: "Current State",
          type: FieldType.Element,
          getElement: (item: IncidentAlert): ReactElement => {
            const state: AlertState | undefined = getStateById(
              item.alert?.currentAlertStateId,
            );
            if (!state) {
              return <>-</>;
            }
            return (
              <Pill
                isMinimal={true}
                color={state.color || Black}
                text={state.name || "Unknown"}
              />
            );
          },
        },
        {
          field: {
            createdAt: true,
          },
          title: "Linked At",
          type: FieldType.DateTime,
        },
        {
          field: {
            createdByUser: {
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          title: "Linked By",
          type: FieldType.Element,
          getElement: (item: IncidentAlert): ReactElement => {
            if (!item.createdByUser) {
              return <>-</>;
            }
            return <UserElement user={item.createdByUser} />;
          },
        },
      ]}
    />
  );
};

export default IncidentViewAlerts;
