import PageComponentProps from "../../PageComponentProps";
import { SCHEDULED_MAINTENANCE_FINAL_STATE } from "../../../Components/StateTimeline/StateTimelineFinalState";
import { Black } from "Common/Types/BrandColors";
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
import StateTimelineSubscriberNotification from "../../../Components/StateTimeline/StateTimelineSubscriberNotification";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  getStateTimelineDurationColumn,
  getStateTimelineEndsAtColumn,
} from "Common/UI/Components/StateTimeline/StateTimelineColumns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import useStateTimelineRowDelete, {
  StateTimelineRowDeleteProps,
} from "../../../Components/StateTimeline/StateTimelineRowDelete";
import { StateTimelineRecord } from "Common/Utils/StateTimeline/StateTimelineRowDelete";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import CheckboxViewer from "Common/UI/Components/Checkbox/CheckboxViewer";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * What adding a state asks: the state, when it began (now, unless earlier),
 * and whether status page subscribers hear of it. The timeline and the
 * table ask the same.
 */
export const SCHEDULED_MAINTENANCE_STATE_TIMELINE_FORM_FIELDS: Array<
  ModelField<ScheduledMaintenanceStateTimeline>
> = [
  {
    field: {
      scheduledMaintenanceState: true,
    },
    title: "Scheduled Maintenance Status",
    description: "The status the event changed to.",
    fieldType: FormFieldSchemaType.Dropdown,
    required: true,
    placeholder: "Scheduled Maintenance Status",
    dropdownModal: {
      type: ScheduledMaintenanceState,
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
    description: "When the event changed to this status.",
    fieldType: FormFieldSchemaType.DateTime,
    required: true,
    placeholder: "Starts At",
    getDefaultValue: () => {
      return OneUptimeDate.getCurrentDate();
    },
  },
  {
    field: {
      shouldStatusPageSubscribersBeNotified: true,
    },

    title: "Notify Status Page Subscribers",
    description: "Should status page subscribers be notified?",
    fieldType: FormFieldSchemaType.Checkbox,
    defaultValue: true,
    required: false,
  },
];

const ScheduledMaintenanceViewStateTimeline: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The event's only state can't be deleted, and every other row's Delete
   * says what deleting it does (StateTimelineRowDelete).
   */
  const stateRowDelete: StateTimelineRowDeleteProps<ScheduledMaintenanceStateTimeline> =
    useStateTimelineRowDelete<ScheduledMaintenanceStateTimeline>({
      record: StateTimelineRecord.ScheduledMaintenance,
      modelType: ScheduledMaintenanceStateTimeline,
      recordIdColumn: "scheduledMaintenanceId",
      recordId: modelId,
      stateColumn: "scheduledMaintenanceState",
    });
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  const handleResendNotification: (
    item: ScheduledMaintenanceStateTimeline,
  ) => Promise<void> = async (
    item: ScheduledMaintenanceStateTimeline,
  ): Promise<void> => {
    try {
      await ModelAPI.updateById({
        modelType: ScheduledMaintenanceStateTimeline,
        id: item.id!,
        data: {
          subscriberNotificationStatus:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessage: null,
        },
      });
      setRefreshToggle(!refreshToggle);
    } catch {
      // Error resending notification: handle appropriately
    }
  };

  const onBeforeCreate: (
    item: ScheduledMaintenanceStateTimeline,
  ) => Promise<ScheduledMaintenanceStateTimeline> = (
    item: ScheduledMaintenanceStateTimeline,
  ): Promise<ScheduledMaintenanceStateTimeline> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }
    item.scheduledMaintenanceId = modelId;
    item.projectId = new ObjectID(props.currentProject._id);
    return Promise.resolve(item);
  };

  /*
   * The event's states as a timeline (ModelStatusTimeline), fitted to its
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
      <ModelStatusTimeline<ScheduledMaintenanceStateTimeline>
        modelType={ScheduledMaintenanceStateTimeline}
        id="scheduled-maintenance-status-timeline"
        name="Scheduled Maintenance Events > State Timeline"
        title="State Timeline"
        description="Each state this maintenance event has been in, when it began and how long it lasted."
        headerElement={viewSwitch}
        query={{
          scheduledMaintenanceId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        stateColumn="scheduledMaintenanceState"
        stateSelect={SCHEDULED_MAINTENANCE_FINAL_STATE.stateSelect}
        getFinalStateRule={SCHEDULED_MAINTENANCE_FINAL_STATE.getFinalStateRule}
        ariaLabel="State timeline of this maintenance event"
        emptyMessage="No state recorded for this maintenance event yet."
        isCreateable={true}
        formFields={SCHEDULED_MAINTENANCE_STATE_TIMELINE_FORM_FIELDS}
        onBeforeCreate={onBeforeCreate}
        singularName={stateRowDelete.singularName}
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
        showViewIdButton={true}
        refreshToggle={refreshToggle.toString()}
        selectMoreFields={{
          subscriberNotificationStatus: true,
          subscriberNotificationStatusMessage: true,
        }}
        renderEntryDetails={(
          item: ScheduledMaintenanceStateTimeline,
        ): ReactElement => {
          return (
            <StateTimelineSubscriberNotification
              status={item.subscriberNotificationStatus}
              message={item.subscriberNotificationStatusMessage}
              onResendNotification={() => {
                void handleResendNotification(item);
              }}
            />
          );
        }}
      />
    );
  }

  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceStateTimeline>
        modelType={ScheduledMaintenanceStateTimeline}
        id="table-scheduledMaintenance-status-timeline"
        userPreferencesKey="scheduled-maintenance-status-timeline-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-status-timeline-table",
        }}
        name="Scheduled Maintenance Events > State Timeline"
        isDeleteable={true}
        getDeleteDisabledReason={stateRowDelete.getDeleteDisabledReason}
        getDeleteConfirmation={stateRowDelete.getDeleteConfirmation}
        getItemName={stateRowDelete.getItemName}
        singularName={stateRowDelete.singularName}
        pluralName={stateRowDelete.pluralName}
        deleteConfirmationWarning={stateRowDelete.deleteConfirmationWarning}
        onFetchSuccess={stateRowDelete.onFetchSuccess}
        isCreateable={true}
        showViewIdButton={true}
        isViewable={false}
        refreshToggle={refreshToggle.toString()}
        query={{
          scheduledMaintenanceId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={onBeforeCreate}
        cardProps={{
          title: "State Timeline",
          description:
            "Each state this maintenance event has been in, when it began and how long it lasted.",
          rightElement: viewSwitch,
        }}
        noItemsMessage={"No state recorded for this maintenance event yet."}
        formFields={SCHEDULED_MAINTENANCE_STATE_TIMELINE_FORM_FIELDS}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        sortBy="startsAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              scheduledMaintenanceState: {
                name: true,
              },
            },
            title: "Scheduled Maintenance Status",
            type: FieldType.Text,
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
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
        ]}
        selectMoreFields={{
          subscriberNotificationStatusMessage: true,
        }}
        columns={[
          {
            field: {
              scheduledMaintenanceState: {
                name: true,
                color: true,
              },
            },
            title: "Scheduled Maintenance Status",
            type: FieldType.Text,

            getElement: (
              item: ScheduledMaintenanceStateTimeline,
            ): ReactElement => {
              if (!item["scheduledMaintenanceState"]) {
                throw new BadDataException(
                  "Scheduled Maintenance Status not found",
                );
              }

              return (
                <Pill
                  color={item.scheduledMaintenanceState.color || Black}
                  text={item.scheduledMaintenanceState.name || "Unknown"}
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
          getStateTimelineEndsAtColumn<ScheduledMaintenanceStateTimeline>(),
          getStateTimelineDurationColumn<ScheduledMaintenanceStateTimeline>(),
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Notification Enabled",
            type: FieldType.Boolean,
            getElement: (
              item: ScheduledMaintenanceStateTimeline,
            ): ReactElement => {
              return (
                <CheckboxViewer
                  isChecked={
                    item.shouldStatusPageSubscribersBeNotified as boolean
                  }
                  text={
                    item.shouldStatusPageSubscribersBeNotified ? "Yes" : "No"
                  }
                />
              );
            },
          },
          {
            field: {
              subscriberNotificationStatus: true,
            },
            title: "Subscriber Notification Status",
            type: FieldType.Text,
            getElement: (
              item: ScheduledMaintenanceStateTimeline,
            ): ReactElement => {
              return (
                <SubscriberNotificationStatus
                  status={item.subscriberNotificationStatus}
                  subscriberNotificationStatusMessage={
                    item.subscriberNotificationStatusMessage
                  }
                  onResendNotification={() => {
                    return handleResendNotification(item);
                  }}
                />
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceViewStateTimeline;
