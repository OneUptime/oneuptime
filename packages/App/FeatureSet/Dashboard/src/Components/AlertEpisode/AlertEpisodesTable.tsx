import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertEpisodeElement from "./AlertEpisode";
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
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerTeam from "Common/Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "Common/Models/DatabaseModels/AlertEpisodeOwnerUser";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners from "../ResourceOwners/useResourceOwners";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import { ALERT_EPISODES_DOCS_PATH } from "../EpisodeView/EpisodeDocsLinks";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Navigation from "Common/UI/Utils/Navigation";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  query?: Query<AlertEpisode> | undefined;
  noItemsMessage?: string | undefined;
  // The page's own words for the empty state. See EmptyStateOptions.
  emptyState?: EmptyStateOptions | undefined;
  title?: string | undefined;
  description?: string | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
}

const AlertEpisodesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);

  /*
   * Acknowledge, Resolve and Change State, in each row's ⋯ menu and in Bulk
   * Actions, as the episode's own page offers them (EventView/
   * useEventStateActions).
   */
  const {
    rowActions: stateRowActions,
    bulkActions: stateBulkActions,
    modals: stateActionModals,
  } = useEventStateActions<AlertEpisode>({
    kind: EventStateKind.AlertEpisode,
    states: alertStates,
  });

  // Change Severity: the episode's Edit form's severity, from the list.
  const {
    rowActions: severityRowActions,
    bulkActions: severityBulkActions,
    modals: severityModals,
  } = useValueChangeActions<AlertEpisode, AlertSeverity>({
    modelType: AlertEpisode,
    column: "alertSeverity",
    idColumn: "alertSeverityId",
    valueModelType: AlertSeverity,
    title: "Change Severity",
    fieldTitle: "Severity",
    icon: IconProp.Signal,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<AlertEpisode>({ modelType: AlertEpisode });


  /*
   * The page's saved views and the chips' selections in the address travel
   * under the same key, as on the alerts list; the pages that embed this
   * table without saved views share one.
   */
  const tableUrlStateKey: string =
    props.saveFilterProps?.tableId || "alert-episodes-table";

  /*
   * The Owner and Labels chips above the table, as on the alerts list: an
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
  } = useResourceOwners<AlertEpisode>({
    persistKey: tableUrlStateKey,
    ownerUserModelType: AlertEpisodeOwnerUser,
    ownerTeamModelType: AlertEpisodeOwnerTeam,
    resourceIdField: "alertEpisodeId",
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
  } = useBulkOwnerActions<AlertEpisode>({
    ownerUserModelType: AlertEpisodeOwnerUser,
    ownerTeamModelType: AlertEpisodeOwnerTeam,
    resourceIdField: "alertEpisodeId",
    offerAssignToMeInBulk: true,
    isOwnedByMe: (episode: AlertEpisode): boolean | undefined => {
      return isOwnedByViewer({
        owners: getOwnersForResource(episode),
        viewerId: User.getUserId(),
      });
    },
  });

  // Fetch alert states on mount
  useEffect(() => {
    const fetchAlertStates: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<AlertState> =
          await ModelAPI.getList<AlertState>({
            modelType: AlertState,
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
        setAlertStates(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    };

    fetchAlertStates();
  }, []);

  return (
    <>
      <ModelTable<AlertEpisode>
        name="Alert Episodes"
        userPreferencesKey="alert-episodes-table"
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
        modelType={AlertEpisode}
        id="alert-episodes-table"
        urlStateKey={tableUrlStateKey}
        isDeleteable={true}
        topContent={filterBar}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery(props.query || {})}
        onFetchSuccess={(data: Array<AlertEpisode>) => {
          onResourcesFetched(data);
        }}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: props.title || "Alert Episodes",
          description:
            props.description ||
            "Episodes group related alerts so you can respond to them together. Grouping rules open episodes for you, or you can create one yourself.",
          /*
           * Routes to the episode create page rather than the table's built in
           * create modal, so ModelTable's own permission gate never sees this
           * button - it has to be gated here (issue #3306).
           */
          buttons: [
            PermissionGate.gateCardButton(
              {
                title: "Create Episode",
                onClick: () => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.ALERT_EPISODE_CREATE] as Route,
                    ),
                  );
                },
                /*
                 * NORMAL + Add is how a list's header picks its main
                 * button: without a style this one went into the ⋯ menu,
                 * and the empty list offered no way to create one.
                 */
                buttonStyle: ButtonStyleType.NORMAL,
                icon: IconProp.Add,
              },
              new AlertEpisode(),
              ModelAction.Create,
            ),
          ].filter((button: CardButtonSchema | null): boolean => {
            return button !== null;
          }) as Array<CardButtonSchema>,
        }}
        noItemsMessage={props.noItemsMessage}
        emptyState={{ ...props.emptyState, ...facetEmptyState }}
        documentationLink={Route.fromString(ALERT_EPISODES_DOCS_PATH)}
        showRefreshButton={true}
        searchableFields={["title", "description"]}
        showViewIdButton={true}
        saveFilterProps={props.saveFilterProps}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERT_EPISODES]!,
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
              alertSeverity: {
                name: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,
            filterEntityType: AlertSeverity,
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
              currentAlertState: {
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,
            filterEntityType: AlertState,
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
              alertGroupingRule: {
                name: true,
              },
            },
            title: "Grouping Rule",
            type: FieldType.Entity,
            filterEntityType: AlertGroupingRule,
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
            getElement: (item: AlertEpisode): ReactElement => {
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
            getElement: (item: AlertEpisode): ReactElement => {
              return <AlertEpisodeElement alertEpisode={item} />;
            },
          },
          {
            field: {
              currentAlertState: {
                _id: true,
                name: true,
                color: true,
              },
            },
            title: "State",
            type: FieldType.Entity,
            getElement: (item: AlertEpisode): ReactElement => {
              if (item["currentAlertState"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={item.currentAlertState.color || Black}
                    text={item.currentAlertState.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              alertSeverity: {
                _id: true,
                name: true,
                color: true,
              },
            },
            title: "Severity",
            type: FieldType.Entity,
            getElement: (item: AlertEpisode): ReactElement => {
              if (item["alertSeverity"]) {
                return (
                  <Pill
                    isMinimal={false}
                    color={item.alertSeverity.color || Black}
                    text={item.alertSeverity.name || "Unknown"}
                  />
                );
              }

              return <></>;
            },
          },
          {
            field: {
              alertCount: true,
            },
            title: "Alerts",
            type: FieldType.Number,
            getElement: (item: AlertEpisode): ReactElement => {
              return <>{item.alertCount || 0}</>;
            },
          },
          {
            field: {
              alertGroupingRule: {
                name: true,
              },
            },
            title: "Grouping Rule",
            type: FieldType.Entity,
            getElement: (item: AlertEpisode): ReactElement => {
              if (item["alertGroupingRule"]) {
                return <span>{item.alertGroupingRule.name || "-"}</span>;
              }
              return <span>{translator.translateText("Manual")}</span>;
            },
          },
          {
            field: {
              lastAlertAddedAt: true,
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
            getElement: (item: AlertEpisode): ReactElement => {
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
            getElement: (item: AlertEpisode): ReactElement => {
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

export default AlertEpisodesTable;
