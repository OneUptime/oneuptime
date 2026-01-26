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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import Label from "Common/Models/DatabaseModels/Label";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ObjectID from "Common/Types/ObjectID";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";

export interface ComponentProps {
  query?: Query<AlertEpisode> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
}

const AlertEpisodesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [alertStates, setAlertStates] = useState<AlertState[]>([]);
  const [showBulkStateChangeModal, setShowBulkStateChangeModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<AlertEpisode> | null>(null);

  // Fetch alert states on mount
  useEffect(() => {
    const fetchAlertStates = async (): Promise<void> => {
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

  const handleBulkStateChange = async (
    targetStateId: ObjectID,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    const targetState = alertStates.find(
      (s: AlertState) => s.id?.toString() === targetStateId.toString(),
    );

    if (!targetState) {
      return;
    }

    const targetOrder = targetState.order || 0;

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

        const currentOrder = fetchedEpisode?.currentAlertState?.order || 0;

        // Skip if already at or past the target state
        if (currentOrder >= targetOrder) {
          const currentStateName =
            fetchedEpisode?.currentAlertState?.name || "Unknown";
          failedItems.push({
            item: episode,
            failedMessage: `Skipped: Already at "${currentStateName}" (at or past "${targetState.name}")`,
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
  };

  const getBulkChangeStateAction =
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
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        modelType={AlertEpisode}
        id="alert-episodes-table"
        isDeleteable={false}
        query={props.query || {}}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: props.title || "Alert Episodes",
          description:
            props.description ||
            "Here is a list of alert episodes for this project.",
        }}
        noItemsMessage={props.noItemsMessage || "No episodes found."}
        showRefreshButton={true}
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
          {
            field: {
              labels: {
                name: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
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

              return <>#{item.episodeNumber}</>;
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
              return <span>Manual</span>;
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
        ]}
      />

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
        <BasicFormModal
          title="Change Episode State"
          description="Select the state to change episodes to. Episodes already at or past the selected state will be skipped. Member alerts will also be updated."
          onClose={() => {
            setShowBulkStateChangeModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Change State"
          onSubmit={async (formData: { alertStateId: ObjectID }) => {
            await handleBulkStateChange(formData.alertStateId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  alertStateId: true,
                },
                title: "Select State",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: alertStates.map((state: AlertState) => ({
                  label: state.name || "",
                  value: state.id?.toString() || "",
                })),
              },
            ],
          }}
        />
      )}
    </>
  );
};

export default AlertEpisodesTable;
