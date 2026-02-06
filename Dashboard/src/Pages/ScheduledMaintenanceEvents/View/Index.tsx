import LabelsElement from "Common/UI/Components/Label/Labels";
import MonitorsElement from "../../../Components/Monitor/Monitors";
import ChangeScheduledMaintenanceState from "../../../Components/ScheduledMaintenance/ChangeState";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import PageComponentProps from "../../PageComponentProps";
import { Black } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import RecurringArrayViewElement from "Common/UI/Components/Events/RecurringArrayViewElement";
import ScheduledMaintenanceFeedElement from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import OneUptimeDate from "Common/Types/Date";

const ScheduledMaintenanceView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  const handleResendNotification: () => Promise<void> =
    async (): Promise<void> => {
      try {
        // Reset the notification status to Pending so the worker can pick it up again
        await ModelAPI.updateById({
          id: modelId,
          modelType: ScheduledMaintenance,
          data: {
            subscriberNotificationStatusOnEventScheduled:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessage:
              "Notification queued for resending",
          },
        });

        // Trigger a refresh by toggling the refresh state
        setRefreshToggle(!refreshToggle);
      } catch {
        // Error resending notification: handle appropriately
      }
    };

  return (
    <Fragment>
      {/* ScheduledMaintenance View  */}
      <CardModelDetail<ScheduledMaintenance>
        name="Scheduled Maintenance Details"
        cardProps={{
          title: "Scheduled Maintenance Details",
          description: "Here are more details for this event.",
        }}
        formSteps={[
          {
            title: "Event Info",
            id: "event-info",
          },

          {
            title: "Resources Affected",
            id: "resources-affected",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
          {
            title: "Subscribers",
            id: "subscribers",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              title: true,
            },
            stepId: "event-info",
            title: "Scheduled Maintenance Title",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Scheduled Maintenance Title",
            validation: {
              minLength: 2,
            },
          },

          {
            field: {
              startsAt: true,
            },
            stepId: "event-info",
            title: "Event Starts At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              endsAt: true,
            },
            title: "Ends At",
            stepId: "event-info",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              monitors: true,
            },
            title: "Monitors affected ",
            stepId: "resources-affected",
            description:
              "Select monitors affected by this scheduled maintenance.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Monitors affected",
          },
          {
            field: {
              statusPages: true,
            },
            title: "Show event on these status pages ",
            stepId: "status-pages",
            description: "Select status pages to show this event on",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Status Pages",
          },

          {
            field: {
              shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
            },

            title: "Event Created: Notify Status Page Subscribers",
            stepId: "subscribers",
            description:
              "Should status page subscribers be notified when this event is created?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
                true,
            },

            title: "Event Ongoing: Notify Status Page Subscribers",
            stepId: "subscribers",
            description:
              "Should status page subscribers be notified when this event state changes to ongoing?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
                true,
            },

            title: "Event Ended: Notify Status Page Subscribers",
            stepId: "subscribers",
            description:
              "Should status page subscribers be notified when this event state changes to ended?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
          {
            field: {
              sendSubscriberNotificationsOnBeforeTheEvent: true,
            },
            stepId: "subscribers",
            title: "Send reminders to subscribers before the event",
            description:
              "Please add a list of notification options to notify subscribers before the event",
            fieldType: FormFieldSchemaType.CustomComponent,
            getCustomElement: (
              value: FormValues<ScheduledMaintenance>,
              props: CustomElementProps,
            ) => {
              return (
                <RecurringArrayFieldElement
                  {...props}
                  initialValue={
                    value.sendSubscriberNotificationsOnBeforeTheEvent as Array<Recurring>
                  }
                />
              );
            },
            required: false,
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          onBeforeFetch: async (): Promise<JSONObject> => {
            // get ack scheduledMaintenance.

            const scheduledMaintenanceTimelines: ListResult<ScheduledMaintenanceStateTimeline> =
              await ModelAPI.getList({
                modelType: ScheduledMaintenanceStateTimeline,
                query: {
                  scheduledMaintenanceId: modelId,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: {
                  _id: true,

                  createdAt: true,
                  createdByUser: {
                    name: true,
                    email: true,
                    profilePictureId: true,
                  },
                  scheduledMaintenanceState: {
                    name: true,
                    isResolvedState: true,
                    isOngoingState: true,
                    isScheduledState: true,
                  },
                },
                sort: {},
              });

            return scheduledMaintenanceTimelines;
          },
          showDetailsInNumberOfColumns: 2,
          modelType: ScheduledMaintenance,
          id: "model-detail-scheduledMaintenances",
          selectMoreFields: {
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
              true,
            shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
            nextSubscriberNotificationBeforeTheEventAt: true,
            subscriberNotificationStatusMessage: true,
          },
          fields: [
            {
              field: {
                scheduledMaintenanceNumber: true,
                scheduledMaintenanceNumberWithPrefix: true,
              },
              title: "Scheduled Maintenance Number",
              fieldType: FieldType.Element,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                if (!item.scheduledMaintenanceNumber) {
                  return <>-</>;
                }

                return (
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-100">
                      <svg
                        className="w-3.5 h-3.5 text-gray-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z"
                        />
                      </svg>
                    </div>
                    <span className="text-lg font-semibold text-gray-700">
                      {item.scheduledMaintenanceNumberWithPrefix || `#${item.scheduledMaintenanceNumber}`}
                    </span>
                  </div>
                );
              },
            },
            {
              field: {
                _id: true,
              },
              title: "Scheduled Maintenance ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                title: true,
              },
              title: "Scheduled Maintenance Title",
              fieldType: FieldType.Text,
            },
            {
              field: {
                currentScheduledMaintenanceState: {
                  color: true,
                  name: true,
                },
              },
              title: "Current State",
              fieldType: FieldType.Entity,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                if (!item["currentScheduledMaintenanceState"]) {
                  throw new BadDataException(
                    "Scheduled Maintenance Status not found",
                  );
                }

                return (
                  <Pill
                    color={item.currentScheduledMaintenanceState.color || Black}
                    text={
                      item.currentScheduledMaintenanceState.name || "Unknown"
                    }
                  />
                );
              },
            },
            {
              field: {
                monitors: {
                  name: true,
                  _id: true,
                },
              },
              title: "Monitors Affected",
              fieldType: FieldType.Element,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                return <MonitorsElement monitors={item.monitors || []} />;
              },
            },
            {
              field: {
                statusPages: {
                  name: true,
                  _id: true,
                },
              },
              title: "Shown on Status Pages",
              fieldType: FieldType.Element,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                return (
                  <StatusPagesElement statusPages={item.statusPages || []} />
                );
              },
            },
            {
              field: {
                startsAt: true,
              },
              title: "Starts At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                endsAt: true,
              },
              title: "Ends At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                sendSubscriberNotificationsOnBeforeTheEvent: true,
              },
              title: "Send reminders to subscribers before the event",
              fieldType: FieldType.Boolean,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                return (
                  <div>
                    <RecurringArrayViewElement
                      value={item.sendSubscriberNotificationsOnBeforeTheEvent}
                      postfix=" before the event is begins"
                    />
                    {item.nextSubscriberNotificationBeforeTheEventAt ? (
                      <div className="mt-2">
                        <span className="font-semibold">
                          Next reminder will be sent at:
                        </span>{" "}
                        {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          item.nextSubscriberNotificationBeforeTheEventAt,
                        )}
                      </div>
                    ) : (
                      <div> No reminders scheduled </div>
                    )}
                  </div>
                );
              },
            },
            {
              field: {
                subscriberNotificationStatusOnEventScheduled: true,
              },
              title: "Subscriber Notification Status",
              fieldType: FieldType.Element,
              getElement: (item: ScheduledMaintenance): ReactElement => {
                return (
                  <SubscriberNotificationStatus
                    status={item.subscriberNotificationStatusOnEventScheduled}
                    subscriberNotificationStatusMessage={
                      item.subscriberNotificationStatusMessage
                    }
                    onResendNotification={handleResendNotification}
                  />
                );
              },
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
              getElement: (item: ScheduledMaintenance): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ChangeScheduledMaintenanceState
        scheduledMaintenanceId={modelId}
        onActionComplete={async () => {
          // do nothing!
        }}
      />

      <ScheduledMaintenanceFeedElement scheduledMaintenanceId={modelId} />
    </Fragment>
  );
};

export default ScheduledMaintenanceView;
