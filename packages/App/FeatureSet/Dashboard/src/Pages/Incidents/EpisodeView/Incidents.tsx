import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
import IncidentEpisodeMember, {
  IncidentEpisodeMemberAddedBy,
} from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentElement from "../../../Components/Incident/Incident";
import UserElement from "../../../Components/User/User";
import Pill from "Common/UI/Components/Pill/Pill";
import { Black } from "Common/Types/BrandColors";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGate } from "Common/UI/Utils/PrivateRecordScope";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { lockUnlessAllowed } from "../../../Components/IncidentAlert/IncidentAlertLink";
import AddEpisodeMembersModal from "../../../Components/EpisodeMembers/AddEpisodeMembersModal";
import { INCIDENT_EPISODE_MEMBER_KIND } from "../../../Components/EpisodeMembers/EpisodeMemberKinds";

/*
 * The incidents in an episode (IncidentEpisodeMember rows). "Add Incidents"
 * picks several at once from every incident the person can see (the shared
 * add dialog), and Remove takes an incident out of this episode only: the
 * incident itself is never touched, and it stays in any other episode it is
 * in.
 */
const EpisodeIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * On a private record's page, what the reader holds on it: a change of it
   * or of a part of it - a link, a member, a role - is offered only when a
   * team of theirs that owns it may make it (PrivateRecordScope).
   */
  const privateRecordGate: (
    model: BaseModel,
  ) => PermissionGateOptions | undefined = usePrivateRecordGate();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

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
              order: true,
            },
            sort: {
              order: SortOrder.Ascending,
            },
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

  const getIncidentNumber: (item: IncidentEpisodeMember) => string = (
    item: IncidentEpisodeMember,
  ): string => {
    if (!item.incident?.incidentNumber) {
      return "";
    }

    return (
      item.incident.incidentNumberWithPrefix ||
      `#${item.incident.incidentNumber}`
    );
  };

  /*
   * Adding opens the shared dialog rather than the table's create form: it
   * picks several incidents at once, by number, title, state and severity.
   * Being a card button, it is gated here - on adding to an episode, and on
   * reading incidents, since only an incident the person can see can be
   * added (and the dialog could not list any).
   */
  const addIncidentsButton: CardButtonSchema | null = lockUnlessAllowed(
    PermissionGate.gateCardButton(
      {
        title: "Add Incidents",
        phoneTitle: "Add",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
        onClick: () => {
          setShowAddModal(true);
        },
      },
      new IncidentEpisodeMember(),
      ModelAction.Create,
      privateRecordGate(new IncidentEpisodeMember()),
    ),
    PermissionGate.check(new Incident(), ModelAction.Read),
  );

  return (
    <Fragment>
      <ModelTable<IncidentEpisodeMember>
        modelType={IncidentEpisodeMember}
        name="Episode Incidents"
        id="episode-incidents-table"
        userPreferencesKey="episode-incidents-table"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Incident"
        pluralName="Incidents"
        deleteButtonText="Remove"
        refreshToggle={refreshToggle.toString()}
        getItemName={(item: IncidentEpisodeMember): string => {
          const incidentNumber: string = getIncidentNumber(item);
          const title: string = item.incident?.title || "";

          if (incidentNumber && title) {
            return `${incidentNumber}: ${title}`;
          }

          return incidentNumber || title;
        }}
        getDeleteConfirmation={async (): Promise<DeleteConfirmation> => {
          return {
            title: "Remove Incident",
            description:
              "Remove this incident from the episode? The incident itself is not deleted, and it stays in any other episode it is in.",
            submitButtonText: "Remove",
          };
        }}
        query={{
          incidentEpisodeId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        bulkActions={{
          buttons: [ModalTableBulkDefaultActions.Delete],
          deleteVerb: "Remove",
          deleteIcon: IconProp.Minus,
          deleteConfirmationWarning:
            "Only their place in this episode is removed: the incidents themselves are not deleted, and they stay in any other episode they are in.",
        }}
        filters={[]}
        cardProps={{
          title: "Member Incidents",
          description:
            "The incidents in this episode, grouped by a rule or added by hand.",
          buttons: addIncidentsButton ? [addIncidentsButton] : [],
        }}
        noItemsMessage="No incidents in this episode."
        showRefreshButton={true}
        actionButtons={[
          {
            title: "View Incident",
            /*
             * On the row, View alone, as every list's own View: the row names
             * the record, the card's title its kind (rowButtonTitle).
             */
            rowButtonTitle: "View",
            icon: IconProp.Eye,
            buttonStyleType: ButtonStyleType.OUTLINE,
            onClick: (
              item: IncidentEpisodeMember,
              onCompleteAction: () => void,
            ) => {
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
          } as ActionButtonSchema<IncidentEpisodeMember>,
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
            getElement: (item: IncidentEpisodeMember): ReactElement => {
              return <>{getIncidentNumber(item) || "-"}</>;
            },
            getExportValue: (item: IncidentEpisodeMember): string => {
              return getIncidentNumber(item);
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
            getElement: (item: IncidentEpisodeMember): ReactElement => {
              if (!item.incident) {
                return <>-</>;
              }
              return <IncidentElement incident={item.incident} />;
            },
            getExportValue: (item: IncidentEpisodeMember): string => {
              return item.incident?.title || "";
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
            getElement: (item: IncidentEpisodeMember): ReactElement => {
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
            getExportValue: (item: IncidentEpisodeMember): string => {
              return (
                getStateById(item.incident?.currentIncidentStateId)?.name || ""
              );
            },
          },
          {
            field: {
              addedBy: true,
            },
            title: "Added By",
            type: FieldType.Element,
            getElement: (item: IncidentEpisodeMember): ReactElement => {
              if (item.addedBy === IncidentEpisodeMemberAddedBy.Rule) {
                return (
                  <Pill isMinimal={true} color={Black} text="Grouping Rule" />
                );
              }
              // Added by hand: by whom, when the person is known.
              if (item.addedByUser) {
                return <UserElement user={item.addedByUser} hideEmail={true} />;
              }
              if (item.addedBy === IncidentEpisodeMemberAddedBy.Manual) {
                return <Pill isMinimal={true} color={Black} text="Manual" />;
              }
              if (item.addedBy === IncidentEpisodeMemberAddedBy.API) {
                return <Pill isMinimal={true} color={Black} text="API" />;
              }
              return <>-</>;
            },
            getExportValue: (item: IncidentEpisodeMember): string => {
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
          config={INCIDENT_EPISODE_MEMBER_KIND}
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

export default EpisodeIncidents;
