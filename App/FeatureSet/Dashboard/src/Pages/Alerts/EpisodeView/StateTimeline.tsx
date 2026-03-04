import PageComponentProps from "../../PageComponentProps";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

const EpisodeViewStateTimeline: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<AlertEpisodeStateTimeline>
        modelType={AlertEpisodeStateTimeline}
        id="table-episode-status-timeline"
        name="Episode > State Timeline"
        userPreferencesKey="episode-status-timeline-table"
        isEditable={false}
        isDeleteable={true}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          alertEpisodeId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: AlertEpisodeStateTimeline,
        ): Promise<AlertEpisodeStateTimeline> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.alertEpisodeId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Status Timeline",
          description: "Here is the status timeline for this episode",
        }}
        noItemsMessage={"No status timeline created for this episode so far."}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        formFields={[
          {
            field: {
              alertState: true,
            },
            title: "Episode Status",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Episode Status",
            dropdownModal: {
              type: AlertState,
              labelField: "name",
              valueField: "_id",
            },
          },
          {
            field: {
              startsAt: true,
            },
            title: "Starts At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Starts At",
            getDefaultValue: () => {
              return OneUptimeDate.getCurrentDate();
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              alertState: {
                name: true,
              },
            },
            title: "Episode State",
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
              alertState: {
                name: true,
                color: true,
              },
            },
            title: "Episode Status",
            type: FieldType.Text,

            getElement: (item: AlertEpisodeStateTimeline): ReactElement => {
              if (!item["alertState"]) {
                throw new BadDataException("Episode Status not found");
              }

              return (
                <Pill
                  color={item["alertState"]["color"] as Color}
                  text={item["alertState"]["name"] as string}
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
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            type: FieldType.DateTime,
            noValueMessage: "Currently Active",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Duration",
            type: FieldType.Text,
            getElement: (item: AlertEpisodeStateTimeline): ReactElement => {
              return (
                <p>
                  {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                    item["startsAt"] as Date,
                    (item["endsAt"] as Date) || OneUptimeDate.getCurrentDate(),
                  )}
                </p>
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default EpisodeViewStateTimeline;
