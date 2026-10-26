import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
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
import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "Common/Models/DatabaseModels/AlertEpisodeMember";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlertElement from "../../../Components/Alert/Alert";
import UserElement from "../../../Components/User/User";
import Pill from "Common/UI/Components/Pill/Pill";
import { Black } from "Common/Types/BrandColors";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { lockUnlessAllowed } from "../../../Components/IncidentAlert/IncidentAlertLink";
import AddEpisodeMembersModal from "../../../Components/EpisodeMembers/AddEpisodeMembersModal";
import { ALERT_EPISODE_MEMBER_KIND } from "../../../Components/EpisodeMembers/EpisodeMemberKinds";

/*
 * The alerts in an episode (AlertEpisodeMember rows). "Add Alerts" picks
 * several at once from every alert the person can see (the shared add
 * dialog), and Remove takes an alert out of this episode only: the alert
 * itself is never touched, and it stays in any other episode it is in.
 */
const EpisodeAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [alertStates, setAlertStates] = useState<AlertState[]>([]);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

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
              order: true,
            },
            sort: {
              order: SortOrder.Ascending,
            },
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

  const getAlertNumber: (item: AlertEpisodeMember) => string = (
    item: AlertEpisodeMember,
  ): string => {
    if (!item.alert?.alertNumber) {
      return "";
    }

    return item.alert.alertNumberWithPrefix || `#${item.alert.alertNumber}`;
  };

  /*
   * Adding opens the shared dialog rather than the table's create form: it
   * picks several alerts at once, by number, title, state and severity.
   * Being a card button, it is gated here - on adding to an episode, and on
   * reading alerts, since only an alert the person can see can be added
   * (and the dialog could not list any).
   */
  const addAlertsButton: CardButtonSchema | null = lockUnlessAllowed(
    PermissionGate.gateCardButton(
      {
        title: "Add Alerts",
        phoneTitle: "Add",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
        onClick: () => {
          setShowAddModal(true);
        },
      },
      new AlertEpisodeMember(),
      ModelAction.Create,
    ),
    PermissionGate.check(new Alert(), ModelAction.Read),
  );

  return (
    <Fragment>
      <ModelTable<AlertEpisodeMember>
        modelType={AlertEpisodeMember}
        name="Episode Alerts"
        id="episode-alerts-table"
        userPreferencesKey="episode-alerts-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Alert"
        pluralName="Alerts"
        deleteButtonText="Remove"
        refreshToggle={refreshToggle.toString()}
        getItemName={(item: AlertEpisodeMember): string => {
          const alertNumber: string = getAlertNumber(item);
          const title: string = item.alert?.title || "";

          if (alertNumber && title) {
            return `${alertNumber}: ${title}`;
          }

          return alertNumber || title;
        }}
        getDeleteConfirmation={async (): Promise<DeleteConfirmation> => {
          return {
            title: "Remove Alert",
            description:
              "Remove this alert from the episode? The alert itself is not deleted, and it stays in any other episode it is in.",
            submitButtonText: "Remove",
          };
        }}
        query={{
          alertEpisodeId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
          deleteVerb: "Remove",
          deleteIcon: IconProp.Minus,
          deleteConfirmationWarning:
            "Only their place in this episode is removed: the alerts themselves are not deleted, and they stay in any other episode they are in.",
        }}
        filters={[]}
        cardProps={{
          title: "Member Alerts",
          description:
            "The alerts in this episode, grouped by a rule or added by hand.",
          buttons: addAlertsButton ? [addAlertsButton] : [],
        }}
        noItemsMessage="No alerts in this episode."
        showRefreshButton={true}
        actionButtons={[
          {
            title: "View Alert",
            icon: IconProp.Eye,
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: (
              item: AlertEpisodeMember,
              onCompleteAction: () => void,
            ) => {
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
            getElement: (item: AlertEpisodeMember): ReactElement => {
              return <>{getAlertNumber(item) || "-"}</>;
            },
            getExportValue: (item: AlertEpisodeMember): string => {
              return getAlertNumber(item);
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
            getExportValue: (item: AlertEpisodeMember): string => {
              return item.alert?.title || "";
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
            getExportValue: (item: AlertEpisodeMember): string => {
              return getStateById(item.alert?.currentAlertStateId)?.name || "";
            },
          },
          {
            field: {
              addedBy: true,
            },
            title: "Added By",
            type: FieldType.Element,
            getElement: (item: AlertEpisodeMember): ReactElement => {
              if (item.addedBy === AlertEpisodeMemberAddedBy.Rule) {
                return (
                  <Pill isMinimal={true} color={Black} text="Grouping Rule" />
                );
              }
              // Added by hand: by whom, when the person is known.
              if (item.addedByUser) {
                return <UserElement user={item.addedByUser} hideEmail={true} />;
              }
              if (item.addedBy === AlertEpisodeMemberAddedBy.Manual) {
                return <Pill isMinimal={true} color={Black} text="Manual" />;
              }
              if (item.addedBy === AlertEpisodeMemberAddedBy.API) {
                return <Pill isMinimal={true} color={Black} text="API" />;
              }
              return <>-</>;
            },
            getExportValue: (item: AlertEpisodeMember): string => {
              return (
                item.addedByUser?.name?.toString() ||
                item.addedByUser?.email?.toString() ||
                item.addedBy ||
                ""
              );
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
        selectMoreFields={{
          addedByUser: {
            name: true,
            email: true,
            profilePictureId: true,
          },
        }}
      />

      {showAddModal && (
        <AddEpisodeMembersModal
          config={ALERT_EPISODE_MEMBER_KIND}
          episodeId={modelId}
          onClose={() => {
            setShowAddModal(false);
          }}
          onAdded={() => {
            setRefreshToggle((previous: boolean): boolean => {
              return !previous;
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default EpisodeAlerts;
