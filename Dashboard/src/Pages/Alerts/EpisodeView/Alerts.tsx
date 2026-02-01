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
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "Common/Models/DatabaseModels/AlertEpisodeMember";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlertElement from "../../../Components/Alert/Alert";
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

const EpisodeAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
    <ModelTable<AlertEpisodeMember>
      modelType={AlertEpisodeMember}
      name="Episode Alerts"
      id="episode-alerts-table"
      userPreferencesKey="episode-alerts-table"
      isDeleteable={true}
      isEditable={false}
      isCreateable={true}
      isViewable={false}
      createVerb="Add"
      query={{
        alertEpisodeId: modelId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      bulkActions={{
        buttons: [ModalTableBulkDefaultActions.Delete],
      }}
      onBeforeCreate={(
        item: AlertEpisodeMember,
      ): Promise<AlertEpisodeMember> => {
        item.alertEpisodeId = modelId;
        item.projectId = ProjectUtil.getCurrentProjectId()!;
        item.addedBy = AlertEpisodeMemberAddedBy.Manual;
        return Promise.resolve(item);
      }}
      filters={[]}
      cardProps={{
        title: "Member Alerts",
        description: "Alerts that are part of this episode.",
      }}
      noItemsMessage="No alerts in this episode."
      showRefreshButton={true}
      actionButtons={[
        {
          title: "View Alert",
          buttonStyleType: ButtonStyleType.OUTLINE,
          onClick: (item: AlertEpisodeMember, onCompleteAction: () => void) => {
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
        } as ActionButtonSchema<AlertEpisodeMember>,
      ]}
      formFields={[
        {
          field: {
            alertId: true,
          },
          title: "Alert",
          description: "Select an alert to add to this episode.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
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
            },
          },
          title: "Alert #",
          type: FieldType.Text,
          getElement: (item: AlertEpisodeMember): ReactElement => {
            if (!item.alert?.alertNumber) {
              return <>-</>;
            }
            return <>#{item.alert.alertNumber}</>;
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
          getElement: (item: AlertEpisodeMember): ReactElement => {
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
          getElement: (item: AlertEpisodeMember): ReactElement => {
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
            addedBy: true,
          },
          title: "Added By",
          type: FieldType.Text,
          getElement: (item: AlertEpisodeMember): ReactElement => {
            if (item.addedBy === AlertEpisodeMemberAddedBy.Rule) {
              return (
                <Pill isMinimal={true} color={Black} text="Grouping Rule" />
              );
            }
            if (item.addedBy === AlertEpisodeMemberAddedBy.Manual) {
              return <Pill isMinimal={true} color={Black} text="Manual" />;
            }
            if (item.addedBy === AlertEpisodeMemberAddedBy.API) {
              return <Pill isMinimal={true} color={Black} text="API" />;
            }
            return <>-</>;
          },
        },
        {
          field: {
            addedAt: true,
          },
          title: "Added At",
          type: FieldType.DateTime,
        },
      ]}
    />
  );
};

export default EpisodeAlerts;
