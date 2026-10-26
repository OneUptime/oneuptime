import PageComponentProps from "../../PageComponentProps";
import { INCIDENT_FINAL_STATE } from "../../../Components/StateTimeline/StateTimelineFinalState";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelStatusTimeline from "Common/UI/Components/StatusTimeline/ModelStatusTimeline";
import StatusTimelineViewSwitch, {
  StatusTimelineView,
  useStatusTimelineView,
} from "Common/UI/Components/StatusTimeline/StatusTimelineView";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  getStateTimelineDurationColumn,
  getStateTimelineEndsAtColumn,
} from "Common/UI/Components/StateTimeline/StateTimelineColumns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import useStateTimelineRowDelete, {
  StateTimelineRowDeleteProps,
} from "../../../Components/StateTimeline/StateTimelineRowDelete";
import { StateTimelineRecord } from "Common/Utils/StateTimeline/StateTimelineRowDelete";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

/*
 * What adding a state asks: the state, and when it began - now, unless it
 * began earlier. The timeline and the table ask the same.
 */
export const INCIDENT_EPISODE_STATE_TIMELINE_FORM_FIELDS: Array<
  ModelField<IncidentEpisodeStateTimeline>
> = [
  {
    field: {
      incidentState: true,
    },
    title: "Episode Status",
    description: "The status the episode changed to.",
    fieldType: FormFieldSchemaType.Dropdown,
    required: true,
    placeholder: "Episode Status",
    dropdownModal: {
      type: IncidentState,
      labelField: "name",
      valueField: "_id",
      sort: {
        order: SortOrder.Ascending,
      },
    },
  },
  {
    field: {
      startsAt: true,
    },
    title: "Starts At",
    /*
     * Its own words, not the column's: the column's are written for the
     * API, and speak of correcting a time that a new row does not have yet.
     */
    description: "When the episode changed to this status.",
    fieldType: FormFieldSchemaType.DateTime,
    required: true,
    placeholder: "Starts At",
    getDefaultValue: () => {
      return OneUptimeDate.getCurrentDate();
    },
  },
];

const EpisodeViewStateTimeline: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The episode's only state can't be deleted, and every other row's Delete
   * says what deleting it does (StateTimelineRowDelete).
   */
  const stateRowDelete: StateTimelineRowDeleteProps<IncidentEpisodeStateTimeline> =
    useStateTimelineRowDelete<IncidentEpisodeStateTimeline>({
      record: StateTimelineRecord.IncidentEpisode,
      modelType: IncidentEpisodeStateTimeline,
      recordIdColumn: "incidentEpisodeId",
      recordId: modelId,
      stateColumn: "incidentState",
    });

  const onBeforeCreate: (
    item: IncidentEpisodeStateTimeline,
  ) => Promise<IncidentEpisodeStateTimeline> = (
    item: IncidentEpisodeStateTimeline,
  ): Promise<IncidentEpisodeStateTimeline> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }
    item.incidentEpisodeId = modelId;
    item.projectId = new ObjectID(props.currentProject._id);
    return Promise.resolve(item);
  };

  /*
   * The episode's states as a timeline (ModelStatusTimeline), fitted to its
   * whole life, with the table it used to be one click away.
   */
  const [view, setView] = useStatusTimelineView();

  const viewSwitch: ReactElement = (
    <StatusTimelineViewSwitch
      key="status-timeline-view-switch"
      value={view}
      onChange={setView}
    />
  );

  if (view === StatusTimelineView.Timeline) {
    return (
      <ModelStatusTimeline<IncidentEpisodeStateTimeline>
        modelType={IncidentEpisodeStateTimeline}
        id="incident-episode-status-timeline"
        name="Episode > State Timeline"
        title="State Timeline"
        description="Each state this episode has been in, when it began and how long it lasted."
        headerElement={viewSwitch}
        query={{
          incidentEpisodeId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        stateColumn="incidentState"
        stateSelect={INCIDENT_FINAL_STATE.stateSelect}
        getFinalStateRule={INCIDENT_FINAL_STATE.getFinalStateRule}
        ariaLabel="State timeline of this episode"
        emptyMessage="No state recorded for this episode yet."
        isCreateable={true}
        formFields={INCIDENT_EPISODE_STATE_TIMELINE_FORM_FIELDS}
        onBeforeCreate={onBeforeCreate}
        singularName={stateRowDelete.singularName}
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
        showViewIdButton={true}
      />
    );
  }

  return (
    <Fragment>
      <ModelTable<IncidentEpisodeStateTimeline>
        modelType={IncidentEpisodeStateTimeline}
        id="table-episode-status-timeline"
        name="Episode > State Timeline"
        userPreferencesKey="episode-status-timeline-table"
        saveFilterProps={{
          tableId: "incident-episode-status-timeline-table",
        }}
        isEditable={false}
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        singularName={stateRowDelete.singularName}
        pluralName={stateRowDelete.pluralName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          incidentEpisodeId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={onBeforeCreate}
        cardProps={{
          title: "State Timeline",
          description:
            "Each state this episode has been in, when it began and how long it lasted.",
          rightElement: viewSwitch,
        }}
        noItemsMessage={"No state recorded for this episode yet."}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        formFields={INCIDENT_EPISODE_STATE_TIMELINE_FORM_FIELDS}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              incidentState: {
                name: true,
              },
            },
            title: "Episode State",
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
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.Date,
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              incidentState: {
                name: true,
                color: true,
              },
            },
            title: "Episode Status",
            type: FieldType.Text,

            getElement: (item: IncidentEpisodeStateTimeline): ReactElement => {
              if (!item["incidentState"]) {
                throw new BadDataException("Episode Status not found");
              }

              return (
                <Pill
                  color={item["incidentState"]["color"] as Color}
                  text={item["incidentState"]["name"] as string}
                />
              );
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            type: FieldType.DateTime,
          },
          getStateTimelineEndsAtColumn<IncidentEpisodeStateTimeline>(),
          getStateTimelineDurationColumn<IncidentEpisodeStateTimeline>(),
        ]}
      />
    </Fragment>
  );
};

export default EpisodeViewStateTimeline;
