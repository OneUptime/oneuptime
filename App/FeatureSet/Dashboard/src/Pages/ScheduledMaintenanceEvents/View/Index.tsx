import LabelsElement from "Common/UI/Components/Label/Labels";
import ChangeScheduledMaintenanceState from "../../../Components/ScheduledMaintenance/ChangeState";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import PageComponentProps from "../../PageComponentProps";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Service from "Common/Models/DatabaseModels/Service";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../Components/AffectedResources/AffectedResourcesPicker";
import AffectedResourcesDisplay from "../../../Components/AffectedResources/AffectedResourcesDisplay";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import RecurringArrayViewElement from "Common/UI/Components/Events/RecurringArrayViewElement";
import ScheduledMaintenanceFeedElement from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import LiveDuration from "../../../Components/EventView/LiveDuration";
import OneUptimeDate from "Common/Types/Date";
import InlineEditField from "Common/UI/Components/InlineEdit/InlineEditField";

const ScheduledMaintenanceView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const [scheduledMaintenance, setScheduledMaintenance] =
    useState<ScheduledMaintenance | null>(null);

  const fetchScheduledMaintenance: () => Promise<void> =
    async (): Promise<void> => {
      try {
        const item: ScheduledMaintenance | null =
          await ModelAPI.getItem<ScheduledMaintenance>({
            modelType: ScheduledMaintenance,
            id: modelId,
            select: {
              title: true,
              startsAt: true,
              endsAt: true,
              scheduledMaintenanceNumber: true,
              scheduledMaintenanceNumberWithPrefix: true,
            },
          });

        setScheduledMaintenance(item);
      } catch {
        // The status panel and stat tiles degrade gracefully without these dates.
      }
    };

  useEffect(() => {
    fetchScheduledMaintenance().catch(() => {
      // Errors are handled inside fetchScheduledMaintenance.
    });
  }, [refreshToggle]);

  const eventStartsAt: Date | undefined = scheduledMaintenance?.startsAt;
  const eventEndsAt: Date | undefined = scheduledMaintenance?.endsAt;
  const eventNumber: string | undefined =
    scheduledMaintenance?.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance?.scheduledMaintenanceNumber
      ? "#" + scheduledMaintenance.scheduledMaintenanceNumber
      : undefined);

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
      <ChangeScheduledMaintenanceState
        scheduledMaintenanceId={modelId}
        eventNumber={eventNumber}
        eventStartsAt={eventStartsAt}
        eventEndsAt={eventEndsAt}
        onActionComplete={() => {
          setRefreshToggle((prev: boolean) => {
            return !prev;
          });
        }}
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {/* Inline-editable event title — click to rename, saves optimistically. */}
          <div className="mb-5">
            {eventNumber && (
              <div className="mb-1 text-sm font-medium text-gray-400">
                {eventNumber}
              </div>
            )}
            <InlineEditField
              value={scheduledMaintenance?.title || ""}
              placeholder="Untitled maintenance event"
              ariaLabel="Scheduled maintenance title"
              errorTitle="Couldn't rename event"
              className="-ml-2 text-xl font-semibold text-gray-900"
              onSave={async (newTitle: string) => {
                await ModelAPI.updateById<ScheduledMaintenance>({
                  id: modelId,
                  modelType: ScheduledMaintenance,
                  data: {
                    title: newTitle,
                  },
                });
              }}
            />
          </div>

          {eventStartsAt && eventEndsAt && (
            <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <EventStatTile
                label="Starts"
                value={OneUptimeDate.getDateAsLocalFormattedString(
                  eventStartsAt,
                )}
                description={
                  "Your local timezone (" +
                  OneUptimeDate.getCurrentTimezoneString() +
                  ")"
                }
                icon={IconProp.Clock}
              />
              <EventStatTile
                label="Ends"
                value={OneUptimeDate.getDateAsLocalFormattedString(eventEndsAt)}
                icon={IconProp.Clock}
              />
              <EventStatTile
                label="Window"
                value={
                  <LiveDuration
                    startDate={eventStartsAt}
                    endDate={eventEndsAt}
                  />
                }
                icon={IconProp.Clock}
              />
            </div>
          )}

          <EntityRunbooks scheduledMaintenanceId={modelId} hideIfEmpty={true} />

          <ScheduledMaintenanceFeedElement scheduledMaintenanceId={modelId} />
        </div>

        <div className="min-w-0 xl:col-span-1">
          {/* ScheduledMaintenance View  */}
          <CardModelDetail<ScheduledMaintenance>
            name="Scheduled Maintenance Details"
            cardProps={{
              title: "Scheduled Maintenance Details",
              description: "Here are more details for this event.",
            }}
            refresher={refreshToggle}
            formSteps={[
              {
                title: "Event Info",
                id: "event-info",
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
            onSaveSuccess={() => {
              // refresh page-level state (event window stat tiles + status-panel countdown) after an in-card edit.
              setRefreshToggle((prev: boolean) => {
                return !prev;
              });
            }}
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
                description:
                  "Shown in your local timezone (" +
                  OneUptimeDate.getCurrentTimezoneString() +
                  ").",
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
                description:
                  "Shown in your local timezone (" +
                  OneUptimeDate.getCurrentTimezoneString() +
                  ").",
                fieldType: FormFieldSchemaType.DateTime,
                required: true,
                placeholder: "Pick Date and Time",
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
              showDetailsInNumberOfColumns: 1,
              modelType: ScheduledMaintenance,
              id: "model-detail-scheduledMaintenances",
              selectMoreFields: {
                scheduledMaintenanceNumberWithPrefix: true,
                shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
                  true,
                shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
                  true,
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
                      <span className="text-sm font-semibold text-gray-900">
                        {item.scheduledMaintenanceNumberWithPrefix ||
                          `#${item.scheduledMaintenanceNumber}`}
                      </span>
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
                    statusPages: {
                      name: true,
                      _id: true,
                    },
                  },
                  title: "Shown on Status Pages",
                  fieldType: FieldType.Element,
                  getElement: (item: ScheduledMaintenance): ReactElement => {
                    return (
                      <StatusPagesElement
                        statusPages={item.statusPages || []}
                      />
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
                          value={
                            item.sendSubscriberNotificationsOnBeforeTheEvent
                          }
                          postfix=" before the event begins"
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
                        status={
                          item.subscriberNotificationStatusOnEventScheduled
                        }
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

          <CardModelDetail<ScheduledMaintenance>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Monitors, hosts, Kubernetes clusters, Docker hosts, and services affected by this scheduled maintenance.",
            }}
            isEditable={true}
            formFields={[
              {
                field: {
                  monitors: true,
                },
                title: "",
                description:
                  "Search and attach monitors, hosts, Kubernetes clusters, Docker hosts, or services affected by this scheduled maintenance.",
                fieldType: FormFieldSchemaType.CustomComponent,
                required: false,
                getCustomElement: (
                  values: FormValues<ScheduledMaintenance>,
                  elementProps: CustomElementProps,
                ) => {
                  return (
                    <AffectedResourcesPicker
                      monitors={values.monitors as Array<Monitor>}
                      hosts={values.hosts as Array<Host>}
                      kubernetesClusters={
                        values.kubernetesClusters as Array<KubernetesCluster>
                      }
                      dockerHosts={values.dockerHosts as Array<DockerHost>}
                      podmanHosts={values.podmanHosts as Array<PodmanHost>}
                      services={values.services as Array<Service>}
                      onChange={(payload: unknown) => {
                        elementProps.onChange?.(payload);
                      }}
                    />
                  );
                },
                onChange: (
                  value: unknown,
                  currentValues: FormValues<ScheduledMaintenance>,
                  setNewFormValues: (
                    values: FormValues<ScheduledMaintenance>,
                  ) => void,
                ) => {
                  if (isAffectedResourcesPayload(value)) {
                    const payload: typeof value = value;
                    queueMicrotask(() => {
                      setNewFormValues({
                        ...currentValues,
                        monitors: payload.monitors,
                        hosts: payload.hosts,
                        kubernetesClusters: payload.kubernetesClusters,
                        dockerHosts: payload.dockerHosts,
                        podmanHosts: payload.podmanHosts,
                        services: payload.services,
                      } as FormValues<ScheduledMaintenance>);
                    });
                  }
                },
              },
              /*
               * Hidden registrations so ModelForm.getSelectFields includes
               * hosts/kubernetesClusters/dockerHosts/services on load and submit.
               */
              {
                field: { hosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { kubernetesClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { dockerHosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { podmanHosts: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { services: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
            ]}
            modelDetailProps={{
              showDetailsInNumberOfColumns: 1,
              modelType: ScheduledMaintenance,
              id: "model-detail-scheduled-maintenance-affected-resources",
              fields: [
                {
                  field: {
                    monitors: {
                      name: true,
                      _id: true,
                    },
                    hosts: {
                      name: true,
                      _id: true,
                    },
                    kubernetesClusters: {
                      name: true,
                      _id: true,
                    },
                    dockerHosts: {
                      name: true,
                      _id: true,
                    },
                    podmanHosts: {
                      name: true,
                      _id: true,
                    },
                    services: {
                      name: true,
                      _id: true,
                      serviceColor: true,
                    },
                  },
                  title: "",
                  fieldType: FieldType.Element,
                  getElement: (item: ScheduledMaintenance): ReactElement => {
                    return (
                      <AffectedResourcesDisplay
                        monitors={item.monitors || []}
                        hosts={item.hosts || []}
                        kubernetesClusters={item.kubernetesClusters || []}
                        dockerHosts={item.dockerHosts || []}
                        podmanHosts={item.podmanHosts || []}
                        services={item.services || []}
                      />
                    );
                  },
                },
              ],
              modelId: modelId,
            }}
          />
        </div>
      </div>
    </Fragment>
  );
};

export default ScheduledMaintenanceView;
