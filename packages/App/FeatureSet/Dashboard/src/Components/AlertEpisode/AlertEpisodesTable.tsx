import LabelsElement from "Common/UI/Components/Label/Labels";
import ArchivedValuePicker from "Common/UI/Utils/ArchivedValuePicker";
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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerTeam from "Common/Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "Common/Models/DatabaseModels/AlertEpisodeOwnerUser";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners from "../ResourceOwners/useResourceOwners";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
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
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import useNoteTemplates from "../EventView/useNoteTemplates";
import BulkChangeStateModal, {
  BulkChangeStateSubmitData,
} from "../EventView/BulkChangeStateModal";
import {
  BulkStateChangeNoteType,
  BulkStateChangeSkipDecision,
  buildBulkStateChangeMiscDataProps,
  getBulkStateChangeSkipDecision,
} from "../../Utils/BulkStateChange";
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
  const [showBulkStateChangeModal, setShowBulkStateChangeModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<AlertEpisode> | null>(null);

  const { noteTemplates } = useNoteTemplates<AlertNoteTemplate>({
    modelType: AlertNoteTemplate,
  });

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<AlertEpisode>({ modelType: AlertEpisode });

  /*
   * Owners in Bulk Actions, as the incidents and alerts lists have them:
   * the list shows and filters episodes by their owners.
   */
  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<AlertEpisode>({
      ownerUserModelType: AlertEpisodeOwnerUser,
      ownerTeamModelType: AlertEpisodeOwnerTeam,
      resourceIdField: "alertEpisodeId",
    });

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

  const handleBulkStateChange: (
    data: BulkChangeStateSubmitData,
  ) => Promise<void> = async (
    data: BulkChangeStateSubmitData,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const targetStateId: ObjectID = data.stateId;

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    const targetState: AlertState | undefined = alertStates.find(
      (s: AlertState) => {
        return s.id?.toString() === targetStateId.toString();
      },
    );

    if (!targetState) {
      return;
    }

    const targetOrder: number = targetState.order || 0;

    const miscDataProps: JSONObject = buildBulkStateChangeMiscDataProps({
      noteType: BulkStateChangeNoteType.Private,
      note: data.note,
    });

    onBulkActionStart();

    const inProgressItems: Array<AlertEpisode> = [...items];
    const totalItems: Array<AlertEpisode> = [...items];
    const successItems: Array<AlertEpisode> = [];
    const failedItems: Array<BulkActionFailed<AlertEpisode>> = [];

    for (const episode of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(episode), 1);

      try {
        if (!episode.id) {
          throw new Error("Episode ID not found");
        }

        // Fetch the episode's current state order since it's not loaded in the table
        const fetchedEpisode: AlertEpisode | null =
          await ModelAPI.getItem<AlertEpisode>({
            modelType: AlertEpisode,
            id: episode.id,
            select: {
              currentAlertState: {
                order: true,
                name: true,
              },
            },
          });

        const currentOrder: number =
          fetchedEpisode?.currentAlertState?.order || 0;

        // Skip if already at or past the target state
        const skipDecision: BulkStateChangeSkipDecision =
          getBulkStateChangeSkipDecision({
            currentOrder: currentOrder,
            targetOrder: targetOrder,
            currentStateName: fetchedEpisode?.currentAlertState?.name,
            targetStateName: targetState.name,
          });

        if (skipDecision.shouldSkip) {
          failedItems.push({
            item: episode,
            failedMessage: skipDecision.skippedMessage!,
          });
        } else {
          // Create state timeline to change state
          const stateTimeline: AlertEpisodeStateTimeline =
            new AlertEpisodeStateTimeline();
          stateTimeline.alertEpisodeId = episode.id;
          stateTimeline.alertStateId = targetStateId;
          stateTimeline.projectId = ProjectUtil.getCurrentProjectId()!;

          await ModelAPI.create<AlertEpisodeStateTimeline>({
            model: stateTimeline,
            modelType: AlertEpisodeStateTimeline,
            miscDataProps: miscDataProps,
          });

          successItems.push(episode);
        }
      } catch (err) {
        failedItems.push({
          item: episode,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setShowBulkStateChangeModal(false);
    setBulkActionProps(null);

    // Trigger sidebar badge count refresh
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
  };

  const getBulkChangeStateAction: () => BulkActionButtonSchema<AlertEpisode> =
    (): BulkActionButtonSchema<AlertEpisode> => {
      return {
        title: "Change State",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.TransparentCube,
        onClick: async (
          actionProps: BulkActionOnClickProps<AlertEpisode>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowBulkStateChangeModal(true);
        },
      };
    };

  return (
    <>
      <ModelTable<AlertEpisode>
        name="Alert Episodes"
        userPreferencesKey="alert-episodes-table"
        bulkActions={{
          buttons: [
            getBulkChangeStateAction(),
            ...labelBulkActions,
            ...ownerBulkActions,
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
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

      {showBulkStateChangeModal && (
        <BulkChangeStateModal
          title="Change Episode State"
          description="Select the state to change episodes to. Episodes already at or past the selected state will be skipped. Member alerts will also be updated."
          stateFieldKey="alertStateId"
          stateOptions={DropdownUtil.getDropdownOptionsFromEntityArray({
            // Archived states are never offered as one to move to.
            array: ArchivedValuePicker.getLiveValues(alertStates),
            labelField: "name",
            valueField: "_id",
          })}
          noteType={BulkStateChangeNoteType.Private}
          noteTitle="Private Note"
          noteDescription="Add an optional private note about this state change. Only your team can see it, and the same note is added to every episode you selected."
          noteTemplates={noteTemplates}
          noteModel={new AlertEpisodeInternalNote()}
          onClose={() => {
            setShowBulkStateChangeModal(false);
            setBulkActionProps(null);
          }}
          onSubmit={handleBulkStateChange}
        />
      )}
    </>
  );
};

export default AlertEpisodesTable;
