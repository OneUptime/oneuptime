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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
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
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ObjectID from "Common/Types/ObjectID";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";

export interface ComponentProps {
  query?: Query<IncidentEpisode> | undefined;
  noItemsMessage?: string | undefined;
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
  const [showBulkStateChangeModal, setShowBulkStateChangeModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<IncidentEpisode> | null>(null);

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

  const handleBulkStateChange: (
    targetStateId: ObjectID,
  ) => Promise<void> = async (targetStateId: ObjectID): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    const targetState: IncidentState | undefined = incidentStates.find(
      (s: IncidentState) => {
        return s.id?.toString() === targetStateId.toString();
      },
    );

    if (!targetState) {
      return;
    }

    const targetOrder: number = targetState.order || 0;

    onBulkActionStart();

    const inProgressItems: Array<IncidentEpisode> = [...items];
    const totalItems: Array<IncidentEpisode> = [...items];
    const successItems: Array<IncidentEpisode> = [];
    const failedItems: Array<BulkActionFailed<IncidentEpisode>> = [];

    for (const episode of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(episode), 1);

      try {
        if (!episode.id) {
          throw new Error("Episode ID not found");
        }

        // Fetch the episode's current state order since it's not loaded in the table
        const fetchedEpisode: IncidentEpisode | null =
          await ModelAPI.getItem<IncidentEpisode>({
            modelType: IncidentEpisode,
            id: episode.id,
            select: {
              currentIncidentState: {
                order: true,
                name: true,
              },
            },
          });

        const currentOrder: number =
          fetchedEpisode?.currentIncidentState?.order || 0;

        // Skip if already at or past the target state
        if (currentOrder >= targetOrder) {
          const currentStateName: string =
            fetchedEpisode?.currentIncidentState?.name || "Unknown";
          failedItems.push({
            item: episode,
            failedMessage: `Skipped: Already at "${currentStateName}" (at or past "${targetState.name}")`,
          });
        } else {
          // Create state timeline to change state
          const stateTimeline: IncidentEpisodeStateTimeline =
            new IncidentEpisodeStateTimeline();
          stateTimeline.incidentEpisodeId = episode.id;
          stateTimeline.incidentStateId = targetStateId;
          stateTimeline.projectId = ProjectUtil.getCurrentProjectId()!;

          await ModelAPI.create<IncidentEpisodeStateTimeline>({
            model: stateTimeline,
            modelType: IncidentEpisodeStateTimeline,
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

  const getBulkChangeStateAction: () => BulkActionButtonSchema<IncidentEpisode> =
    (): BulkActionButtonSchema<IncidentEpisode> => {
      return {
        title: "Change State",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.TransparentCube,
        onClick: async (
          actionProps: BulkActionOnClickProps<IncidentEpisode>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowBulkStateChangeModal(true);
        },
      };
    };

  let cardbuttons: Array<CardButtonSchema> = [];

  if (!props.disableCreate) {
    cardbuttons = [
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
    ];
  }

  return (
    <>
      <ModelTable<IncidentEpisode>
        name="Incident Episodes"
        userPreferencesKey="incident-episodes-table"
        bulkActions={{
          buttons: [
            getBulkChangeStateAction(),
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        modelType={IncidentEpisode}
        id="incident-episodes-table"
        isDeleteable={false}
        query={props.query || {}}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        cardProps={{
          title: props.title || "Incident Episodes",
          buttons: cardbuttons,
          description:
            props.description ||
            "Here is a list of incident episodes for this project.",
        }}
        noItemsMessage={props.noItemsMessage || "No episodes found."}
        showRefreshButton={true}
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
            getElement: (item: IncidentEpisode): ReactElement => {
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
            getElement: (item: IncidentEpisode): ReactElement => {
              return <IncidentEpisodeElement incidentEpisode={item} />;
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
          description="Select the state to change episodes to. Episodes already at or past the selected state will be skipped. Member incidents will also be updated."
          onClose={() => {
            setShowBulkStateChangeModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Change State"
          onSubmit={async (formData: { incidentStateId: ObjectID }) => {
            await handleBulkStateChange(formData.incidentStateId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  incidentStateId: true,
                },
                title: "Select State",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: incidentStates.map((state: IncidentState) => {
                  return {
                    label: state.name || "",
                    value: state.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}
    </>
  );
};

export default IncidentEpisodesTable;
