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
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentElement from "../../../Components/Incident/Incident";
import UserElement from "../../../Components/User/User";
import { getDeclareIncidentFromAlertsRoute } from "../../../Components/Alert/BulkIncidentLinkActions";
import Pill from "Common/UI/Components/Pill/Pill";
import { Black } from "Common/Types/BrandColors";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

/*
 * The incidents an alert is linked to (IncidentAlert rows). Linking creates a
 * row and unlinking deletes it; the incident itself is never touched.
 */
const AlertViewIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * Relations are only joined one level deep, so an incident's current state
   * cannot be selected through the link row - it is looked up here by id.
   */
  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);

  useEffect(() => {
    const fetchStates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<IncidentState> =
          await ModelAPI.getList<IncidentState>({
            modelType: IncidentState,
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
        setIncidentStates(result.data);
      } catch {
        // Silently fail - states just won't show
      }
    };

    fetchStates();
  }, []);

  const getStateById: (
    stateId: ObjectID | string | undefined,
  ) => IncidentState | undefined = (
    stateId: ObjectID | string | undefined,
  ): IncidentState | undefined => {
    if (!stateId) {
      return undefined;
    }
    const stateIdStr: string = stateId.toString();
    return incidentStates.find((state: IncidentState) => {
      return state._id?.toString() === stateIdStr;
    });
  };

  /*
   * Routes to the create-incident page rather than the table's own create
   * modal, so ModelTable's permission gate never sees it: declaring creates
   * the incident and links this alert to it, and both need permission.
   */
  let declareIncidentButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: "Declare Incident",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Alert,
        onClick: () => {
          Navigation.navigate(
            getDeclareIncidentFromAlertsRoute([modelId.toString()]),
          );
        },
      },
      new Incident(),
      ModelAction.Create,
    );

  if (declareIncidentButton && !declareIncidentButton.disabled) {
    declareIncidentButton = PermissionGate.gateCardButton(
      declareIncidentButton,
      new IncidentAlert(),
      ModelAction.Create,
    );
  }

  return (
    <ModelTable<IncidentAlert>
      modelType={IncidentAlert}
      name="Alert Linked Incidents"
      id="alert-linked-incidents-table"
      userPreferencesKey="alert-linked-incidents-table"
      isDeleteable={true}
      isEditable={false}
      isCreateable={true}
      isViewable={false}
      createVerb="Link"
      singularName="Incident"
      pluralName="Incidents"
      deleteButtonText="Unlink"
      getDeleteConfirmation={async (): Promise<DeleteConfirmation> => {
        return {
          title: "Unlink Incident",
          description:
            "Unlink this alert from the incident? The incident itself is not deleted, and the alert stays linked to any other incidents.",
          submitButtonText: "Unlink",
        };
      }}
      query={{
        alertId: modelId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      bulkActions={{
        buttons: [ModalTableBulkDefaultActions.Delete],
        deleteConfirmationWarning:
          "Only the links are removed: the incidents themselves are not deleted.",
      }}
      onBeforeCreate={(item: IncidentAlert): Promise<IncidentAlert> => {
        item.alertId = modelId;
        item.projectId = ProjectUtil.getCurrentProjectId()!;
        return Promise.resolve(item);
      }}
      filters={[]}
      cardProps={{
        title: "Linked Incidents",
        description:
          "Incidents this alert is linked to. Link the alert to an incident that is already open, or declare a new incident from it.",
        buttons: declareIncidentButton ? [declareIncidentButton] : [],
      }}
      noItemsMessage="This alert is not linked to any incidents."
      showRefreshButton={true}
      actionButtons={[
        {
          title: "View Incident",
          buttonStyleType: ButtonStyleType.OUTLINE,
          onClick: (item: IncidentAlert, onCompleteAction: () => void) => {
            if (item.incident?._id) {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.INCIDENT_VIEW] as Route,
                  { modelId: new ObjectID(item.incident._id.toString()) },
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
            incidentId: true,
          },
          title: "Incident",
          description: "Select an incident to link this alert to.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Select an incident",
          dropdownModal: {
            type: Incident,
            labelField: "title",
            valueField: "_id",
          },
        },
      ]}
      columns={[
        {
          field: {
            incident: {
              incidentNumber: true,
              incidentNumberWithPrefix: true,
            },
          },
          title: "Incident #",
          type: FieldType.Text,
          getElement: (item: IncidentAlert): ReactElement => {
            if (!item.incident?.incidentNumber) {
              return <>-</>;
            }
            return (
              <>
                {item.incident.incidentNumberWithPrefix ||
                  `#${item.incident.incidentNumber}`}
              </>
            );
          },
        },
        {
          field: {
            incident: {
              title: true,
              _id: true,
              currentIncidentStateId: true,
            },
          },
          title: "Title",
          type: FieldType.Element,
          getElement: (item: IncidentAlert): ReactElement => {
            if (!item.incident) {
              return <>-</>;
            }
            return <IncidentElement incident={item.incident} />;
          },
        },
        {
          field: {
            incident: {
              currentIncidentStateId: true,
            },
          },
          title: "Current State",
          type: FieldType.Element,
          getElement: (item: IncidentAlert): ReactElement => {
            const state: IncidentState | undefined = getStateById(
              item.incident?.currentIncidentStateId,
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

export default AlertViewIncidents;
