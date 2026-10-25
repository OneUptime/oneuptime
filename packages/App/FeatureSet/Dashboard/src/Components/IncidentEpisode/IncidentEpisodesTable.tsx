import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentEpisodeElement from "./IncidentEpisode";
import { Black } from "Common/Types/BrandColors";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useValueChangeActions from "Common/UI/Components/BulkUpdate/ValueChangeActions";
import User from "Common/UI/Utils/User";
import useEventStateActions from "../EventView/useEventStateActions";
import { EventStateKind } from "../EventView/EventStateKinds";
import { isOwnedByViewer } from "../ResourceOwners/OwnedByViewer";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerTeam from "Common/Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "Common/Models/DatabaseModels/IncidentEpisodeOwnerUser";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners from "../ResourceOwners/useResourceOwners";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import { INCIDENT_EPISODES_DOCS_PATH } from "../EpisodeView/EpisodeDocsLinks";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";

export interface ComponentProps {
  query?: Query<IncidentEpisode> | undefined;
  noItemsMessage?: string | undefined;
  // The page's own words for the empty state. See EmptyStateOptions.
  emptyState?: EmptyStateOptions | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
}

const IncidentEpisodesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);

  /*
   * Acknowledge, Resolve and Change State, in each row's ⋯ menu and in Bulk
   * Actions, as the episode's own page offers them (EventView/
   * useEventStateActions).
   */
  const {
    rowActions: stateRowActions,
    bulkActions: stateBulkActions,
    modals: stateActionModals,
  } = useEventStateActions<IncidentEpisode>({
    kind: EventStateKind.IncidentEpisode,
    states: incidentStates,
  });

  // Change Severity: the episode's Edit form's severity, from the list.
  const {
    rowActions: severityRowActions,
    bulkActions: severityBulkActions,
    modals: severityModals,
  } = useValueChangeActions<IncidentEpisode, IncidentSeverity>({
    modelType: IncidentEpisode,
    column: "incidentSeverity",
    idColumn: "incidentSeverityId",
    valueModelType: IncidentSeverity,
    title: "Change Severity",
    fieldTitle: "Severity",
    // The list's own Severity filter wears the same icon.
    icon: IconProp.Fire,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<IncidentEpisode>({ modelType: IncidentEpisode });

  /*
   * The page's saved views and the chips' selections in the address travel
   * under the same key, as on the incidents list; the pages that embed this
   * table without saved views share one.
   */
  const tableUrlStateKey: string =
    props.saveFilterProps?.tableId || "incident-episodes-table";

  /*
   * The Owner and Labels chips above the table, as on the incidents list: an
   * episode can be found by the person or the team that owns it - the
   * server answers the Owner chip in the list's own query - and the Owners
   * column shows who that is.
   */
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<IncidentEpisode>({
    persistKey: tableUrlStateKey,
    ownerUserModelType: IncidentEpisodeOwnerUser,
    ownerTeamModelType: IncidentEpisodeOwnerTeam,
    resourceIdField: "incidentEpisodeId",
    showLabelsFacet: true,
  });

  /*
   * Owners, as the incidents and alerts lists have them: Assign to Me and
   * Add Owner in each row's ⋯ menu, and Assign to Me, Add Owner and Remove
   * Owner in Bulk Actions. A row the viewer owns already is not offered
   * Assign to Me.
   */
  const {
    bulkActions: ownerBulkActions,
    rowActions: ownerRowActions,
    modals: ownerBulkActionModals,
  } = useBulkOwnerActions<IncidentEpisode>({
    ownerUserModelType: IncidentEpisodeOwnerUser,
    ownerTeamModelType: IncidentEpisodeOwnerTeam,
    resourceIdField: "incidentEpisodeId",
    offerAssignToMeInBulk: true,
    isOwnedByMe: (episode: IncidentEpisode): boolean | undefined => {
      return isOwnedByViewer({
        owners: getOwnersForResource(episode),
        viewerId: User.getUserId(),
      });
    },
  });

  // Fetch incident states on mount
  useEffect(() => {
    const fetchIncidentStates: () => Promise<void> =
      async (): Promise<void> => {
        try {
          const result: ListResult<IncidentState> =
            await ModelAPI.getList<IncidentState>({
              modelType: IncidentState,
              query: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              limit: 99,
              skip: 0,
              select: {
                _id: true,
                name: true,
                color: true,
                order: true,
                isArchived: true,
                isResolvedState: true,
                isAcknowledgedState: true,
                isCreatedState: true,
              },
              sort: {
                order: SortOrder.Ascending,
              },
            });
          setIncidentStates(result.data);
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }
      };

    fetchIncidentStates();
  }, []);

  let cardbuttons: Array<CardButtonSchema> = [];

  if (!props.disableCreate) {
    /*
     * These route to a dedicated create page instead of the table's built in
     * create modal, so ModelTable's own permission gate never sees them. Gate
     * them here or a viewer walks the whole flow and is refused at the end
     * (issue #3306).
     */
    cardbuttons = [
      PermissionGate.gateCardButton(
        {
          title: "Create Episode",
          onClick: () => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.INCIDENT_EPISODE_CREATE] as Route,
              ),
            );
          },
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
        },
        new IncidentEpisode(),
        ModelAction.Create,
      ),
    ].filter((button: CardButtonSchema | null): boolean => {
      return button !== null;
    }) as Array<CardButtonSchema>;
  }

  return (
    <>
      <ModelTable<IncidentEpisode>
        name="Incident Episodes"
        userPreferencesKey="incident-episodes-table"
        bulkActions={{
          buttons: [
            ...stateBulkActions,
            ...severityBulkActions,
            ...ownerBulkActions,
            ...labelBulkActions,
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        actionButtons={[
          ...stateRowActions,
          ...severityRowActions,
          ...ownerRowActions,
        ]}
        modelType={IncidentEpisode}
        id="incident-episodes-table"
        urlStateKey={tableUrlStateKey}
        isDeleteable={true}
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(props.query || {})}
        onFetchSuccess={(data: Array<IncidentEpisode>) => {
          onResourcesFetched(data);
        }}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: props.title || "Incident Episodes",
          buttons: cardbuttons,
          description:
            props.description ||
            "Episodes group related incidents so you can respond to them together. Grouping rules open episodes for you, or you can create one yourself.",
        }}
        noItemsMessage={props.noItemsMessage}
        emptyState={{ ...props.emptyState, ...facetEmptyState }}
        documentationLink={Route.fromString(INCIDENT_EPISODES_DOCS_PATH)}
        showRefreshButton={true}
        searchableFields={["title", "description"]}
        showViewIdButton={true}
        saveFilterProps={props.saveFilterProps}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENT_EPISODES]!,
        )}
        filters={[
          {
            title: "Episode ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Episode Number",
            type: FieldType.Number,
            field: {
              episodeNumber: true,
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              incidentSeverity: {
                name: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,
            filterEntityType: IncidentSeverity,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              currentIncidentState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,
            filterEntityType: IncidentState,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
        ]}
        selectMoreFields={{
          episodeNumberWithPrefix: true,
        }}
        columns={[
          {
            field: {
              episodeNumber: true,
            },
            title: "Episode #",
            type: FieldType.Text,
            getElement: (item: IncidentEpisode): ReactElement => {
              if (!item.episodeNumber) {
                return <>-</>;
              }

              return (
                <>{item.episodeNumberWithPrefix || `#${item.episodeNumber}`}</>
              );
            },
          },
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Element,
            getElement: (item: IncidentEpisode): ReactElement => {
              return <IncidentEpisodeElement incidentEpisode={item} />;
            },
          },
          {
            field: {
              currentIncidentState: {
                _id: true,
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,
            getElement: (item: IncidentEpisode): ReactElement => {
              if (item["currentIncidentState"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.currentIncidentState.color || Black}
                    text={item.currentIncidentState.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              incidentSeverity: {
                _id: true,
                name: true,
                color: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,
            getElement: (item: IncidentEpisode): ReactElement => {
              if (item["incidentSeverity"]) {
                return (
                  <Pill
                    isMinimal={false}
                    color={item.incidentSeverity.color || Black}
                    text={item.incidentSeverity.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              incidentCount: true,
            },
            title: "Incidents",
            type: FieldType.Number,
            getElement: (item: IncidentEpisode): ReactElement => {
              return <>{item.incidentCount || 0}</>;
            },
          },
          {
            field: {
              lastIncidentAddedAt: true,
            },
            title: "Last Activity",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,
            getElement: (item: IncidentEpisode): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: IncidentEpisode): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />

      {labelBulkActionModals}
      {ownerBulkActionModals}

      {error && (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setError("");
          }}
        />
      )}

      {stateActionModals}
      {severityModals}
    </>
  );
};

export default IncidentEpisodesTable;
