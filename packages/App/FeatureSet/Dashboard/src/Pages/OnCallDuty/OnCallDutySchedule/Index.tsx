import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import FinalPreview from "../../../Components/OnCallPolicy/OnCallScheduleLayer/FinalPreview";
import ProjectUtil from "Common/UI/Utils/Project";
import ScheduleSubscribeCard from "../../../Components/OnCallPolicy/CalendarFeed/ScheduleSubscribeCard";
import ScheduleUserGroupsCard from "../../../Components/OnCallPolicy/UserGroups/ScheduleUserGroupsCard";
import { SCHEDULE_EDIT_BUTTON_TEXT } from "../../../Components/OnCallPolicy/OnCallScheduleLayer/ScheduleOverviewCopy";

/*
 * A schedule's Overview: its details, then who is on call now and next, with
 * every layer, override and coverage gap applied (FinalPreview's Final
 * Schedule), then the ways to follow it elsewhere - Slack user groups and
 * Teams tags, and calendar links.
 *
 * It used to open with a banner of its own about "the roster" - "Bob Rivera
 * is currently on the roster for this schedule. This user has been on the
 * roster since ..." - above the Final Schedule, which says who is on call
 * now and next in its first two tiles, overrides included. Two answers to
 * one question on one page; the Final Schedule's is the one kept. A schedule
 * with nobody to take turns yet said it in red, and below two calendar cards
 * offering links to shifts nobody has: it now shows one step instead - add
 * the people who take turns on its Layers page - and the cards that follow
 * a schedule's shifts wait until it has some.
 */
const OnCallDutyScheduleView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [onCallSchedule, setOnCallSchedule] =
    React.useState<OnCallDutySchedule | null>(null);

  // How many layers the schedule has, once FinalPreview has read them.
  const [layerCount, setLayerCount] = React.useState<number | null>(null);

  // Nothing to follow before anybody takes turns.
  const hasLayers: boolean = layerCount !== null && layerCount > 0;

  return (
    <Fragment>
      {/* OnCallDutySchedule View  */}
      <CardModelDetail<OnCallDutySchedule>
        name="On-Call Schedule > On-Call Schedule Details"
        /*
         * The model is named for its table (On-Call Policy Schedule), which
         * made this "Edit On-Call Policy Schedule" on a page every menu calls
         * an On-Call Schedule.
         */
        editButtonText={SCHEDULE_EDIT_BUTTON_TEXT}
        editModalTitle={SCHEDULE_EDIT_BUTTON_TEXT}
        cardProps={{
          title: "On-Call Schedule Details",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g., Platform primary",
            hideColumnDescription: true,
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
            hideColumnDescription: true,
          },
          getLabelsFormField<OnCallDutySchedule>(),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: OnCallDutySchedule,
          id: "model-detail-monitors",
          selectMoreFields: {
            timezone: true,
          },
          onItemLoaded: (item: OnCallDutySchedule): void => {
            if (!onCallSchedule) {
              setOnCallSchedule(item);
            }
          },
          fields: [
            {
              field: {
                _id: true,
              },
              title: "On-Call Schedule ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: OnCallDutySchedule): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />

      <FinalPreview
        onCallDutyPolicyScheduleId={modelId}
        projectId={ProjectUtil.getCurrentProjectId() as ObjectID}
        onLayersLoaded={(count: number): void => {
          setLayerCount(count);
        }}
      />

      {hasLayers ? (
        <Fragment>
          {/*
           * The Slack user groups and Microsoft Teams tags that hold whoever
           * is on call here: beside the roster they mirror.
           */}
          <ScheduleUserGroupsCard
            scheduleId={modelId}
            scheduleName={onCallSchedule?.name?.toString() || ""}
          />

          <ScheduleSubscribeCard
            scheduleId={modelId}
            scheduleTimezone={
              onCallSchedule
                ? onCallSchedule.timezone?.toString() || null
                : undefined
            }
          />
        </Fragment>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default OnCallDutyScheduleView;
