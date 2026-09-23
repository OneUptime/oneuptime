import LabelsElement from "Common/UI/Components/Label/Labels";
import ChangeScheduledMaintenanceState from "../../../Components/ScheduledMaintenance/ChangeState";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Exception from "Common/Types/Exception/Exception";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
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
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringArrayFieldElement from "Common/UI/Components/Events/RecurringArrayFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import RecurringArrayViewElement from "Common/UI/Components/Events/RecurringArrayViewElement";
import ScheduledMaintenanceFeedElement from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import EntityRunbooks from "../../../Components/Runbook/EntityRunbooks";
import EventOverviewSkeleton from "../../../Components/EventView/EventOverviewSkeleton";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import { EventStatusFact } from "../../../Components/EventView/EventStatusPanel";
import LiveDuration from "../../../Components/EventView/LiveDuration";
import {
  SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS,
  formatScheduledMaintenanceRelativeTime,
} from "../../../Utils/ScheduledMaintenanceTiming";
import OneUptimeDate from "Common/Types/Date";

// How many status page names the header lists before summarising the rest.
const MAX_STATUS_PAGE_NAMES_IN_HEADER: number = 2;

type GetStatusPagesFactFunction = (
  statusPages: Array<StatusPage> | undefined,
) => string;

const getStatusPagesFact: GetStatusPagesFactFunction = (
  statusPages: Array<StatusPage> | undefined,
): string => {
  const names: Array<string> = (statusPages || [])
    .map((statusPage: StatusPage): string => {
      return (statusPage.name || "").trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  if (names.length === 0) {
    return "None";
  }

  if (names.length <= MAX_STATUS_PAGE_NAMES_IN_HEADER) {
    return names.join(", ");
  }

  return (
    names.slice(0, MAX_STATUS_PAGE_NAMES_IN_HEADER).join(", ") +
    " +" +
    (names.length - MAX_STATUS_PAGE_NAMES_IN_HEADER) +
    " more"
  );
};

interface WindowStatsProps {
  eventStartsAt: Date;
  eventEndsAt: Date;
}

/*
 * The planned window under the header. It keeps its own clock, so the
 * "in 2 hours" / "2 hours ago" descriptions stay current without
 * re-rendering the rest of the page every tick.
 */
const ScheduledMaintenanceWindowStats: FunctionComponent<WindowStatsProps> = (
  props: WindowStatsProps,
): ReactElement => {
  const eventStartsAt: Date = props.eventStartsAt;
  const eventEndsAt: Date = props.eventEndsAt;
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [now]);

  return (
    <div className="mb-5">
      <EventStatBar columns={3} ariaLabel="Maintenance window">
        <EventStatTile
          variant="segment"
          label="Starts"
          value={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            eventStartsAt,
          )}
          description={formatScheduledMaintenanceRelativeTime(
            eventStartsAt,
            now,
          )}
          icon={IconProp.Calendar}
        />
        <EventStatTile
          variant="segment"
          label="Ends"
          value={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            eventEndsAt,
          )}
          description={formatScheduledMaintenanceRelativeTime(eventEndsAt, now)}
          icon={IconProp.Calendar}
        />
        <EventStatTile
          variant="segment"
          label="Duration"
          value={
            <LiveDuration startDate={eventStartsAt} endDate={eventEndsAt} />
          }
          description={
            "Planned window · times in " +
            OneUptimeDate.getCurrentTimezoneString()
          }
          icon={IconProp.Clock}
        />
      </EventStatBar>
    </div>
  );
};

/*
 * A loaded event, stamped with the id it was read for. The page stays mounted
 * when the reader moves to another event, so an item that is not stamped with
 * the current id must never be rendered as if it were that event.
 */
interface LoadedScheduledMaintenance {
  modelId: string;
  item: ScheduledMaintenance;
}

// A failed resend, stamped with the event it failed for.
interface ResendNotificationErrorState {
  modelId: string;
  message: string;
}

const ScheduledMaintenanceView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const modelIdString: string = modelId.toString();
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const [feedRefreshToken, setFeedRefreshToken] = useState<number>(0);
  const [loadedEvent, setLoadedEvent] =
    useState<LoadedScheduledMaintenance | null>(null);
  /*
   * Which event the latest settled request (loaded or failed) was for. Only
   * the first load of an event shows the skeleton; later refreshes (after an
   * action or an edit) update the page in place instead of unmounting it.
   */
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [resendNotificationErrorState, setResendNotificationErrorState] =
    useState<ResendNotificationErrorState | null>(null);
  const resendNotificationError: string =
    resendNotificationErrorState?.modelId === modelIdString
      ? resendNotificationErrorState.message
      : "";
  const latestRequestRef: MutableRefObject<number> = useRef<number>(0);

  const fetchScheduledMaintenance: () => Promise<void> =
    async (): Promise<void> => {
      const requestNumber: number = latestRequestRef.current + 1;
      latestRequestRef.current = requestNumber;

      try {
        const item: ScheduledMaintenance | null =
          await ModelAPI.getItem<ScheduledMaintenance>({
            modelType: ScheduledMaintenance,
            id: modelId,
            select: {
              startsAt: true,
              endsAt: true,
              title: true,
              scheduledMaintenanceNumber: true,
              scheduledMaintenanceNumberWithPrefix: true,
              shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing:
                true,
              shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded:
                true,
              statusPages: {
                _id: true,
                name: true,
              },
              createdByUser: {
                name: true,
                email: true,
              },
            },
          });

        // A newer request (another event, or a later refresh) owns the page now.
        if (requestNumber !== latestRequestRef.current) {
          return;
        }

        if (item) {
          setLoadedEvent({ modelId: modelIdString, item: item });
          setLoadError("");
        } else {
          setLoadedEvent(null);
          setLoadError("This scheduled maintenance event could not be found.");
        }
      } catch (err: unknown) {
        if (requestNumber !== latestRequestRef.current) {
          return;
        }

        /*
         * A failed background refresh keeps the page that is already on
         * screen; only a failed first load has nothing to fall back to. The
         * previous event is not something to fall back to: drop it, so the
         * error shows instead of that event under this one's URL.
         */
        setLoadedEvent(
          (
            current: LoadedScheduledMaintenance | null,
          ): LoadedScheduledMaintenance | null => {
            return current?.modelId === modelIdString ? current : null;
          },
        );
        setLoadError(API.getFriendlyMessage(err as Exception));
      }

      setLoadedModelId(modelIdString);
    };

  useEffect(() => {
    fetchScheduledMaintenance().catch((err: unknown) => {
      setLoadError(API.getFriendlyMessage(err as Exception));
    });
  }, [modelIdString, refreshToggle]);

  const refreshPage: () => void = (): void => {
    setRefreshToggle((prev: boolean) => {
      return !prev;
    });
  };

  const handleResendNotification: () => Promise<void> =
    async (): Promise<void> => {
      setResendNotificationErrorState(null);

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

        refreshPage();
      } catch (err: unknown) {
        setResendNotificationErrorState({
          modelId: modelIdString,
          message: API.getFriendlyMessage(err as Exception),
        });
      }
    };

  const isCurrentEventLoaded: boolean = loadedEvent?.modelId === modelIdString;

  if (!isCurrentEventLoaded) {
    if (loadedModelId === modelIdString && loadError) {
      return (
        <ErrorMessage
          message={loadError}
          onRefreshClick={() => {
            setLoadError("");
            setLoadedModelId(null);
            refreshPage();
          }}
        />
      );
    }

    return (
      <EventOverviewSkeleton loadingText="Loading scheduled maintenance event" />
    );
  }

  const scheduledMaintenance: ScheduledMaintenance | undefined =
    loadedEvent?.item;
  const eventStartsAt: Date | undefined = scheduledMaintenance?.startsAt;
  const eventEndsAt: Date | undefined = scheduledMaintenance?.endsAt;
  const eventTitle: string | undefined =
    scheduledMaintenance?.title || undefined;
  const eventNumber: string | undefined =
    scheduledMaintenance?.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance?.scheduledMaintenanceNumber
      ? "#" + scheduledMaintenance.scheduledMaintenanceNumber
      : undefined);
  /*
   * Off when the event was created without notifying status page
   * subscribers; the feed's public note form then starts with "Notify Status
   * Page Subscribers" unticked. The state change header gets the event's
   * settings instead, because moving the event to ongoing or ended also
   * follows its "Event Ongoing" / "Event Ended" settings.
   */
  const notifyStatusPageSubscribersByDefault: boolean =
    PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
      scheduledMaintenance,
    );

  const heroFacts: Array<EventStatusFact> = [
    {
      label: "Status pages",
      value: getStatusPagesFact(scheduledMaintenance?.statusPages),
      icon: IconProp.Globe,
    },
    {
      label: "Created by",
      value:
        scheduledMaintenance?.createdByUser?.name?.toString() ||
        scheduledMaintenance?.createdByUser?.email?.toString() ||
        "",
      icon: IconProp.User,
    },
  ];

  return (
    <Fragment key={modelIdString}>
      <ChangeScheduledMaintenanceState
        scheduledMaintenanceId={modelId}
        eventNumber={eventNumber}
        title={eventTitle}
        eventStartsAt={eventStartsAt}
        eventEndsAt={eventEndsAt}
        subscriberNotificationSettings={scheduledMaintenance}
        facts={heroFacts}
        onActionComplete={() => {
          // The state change adds a feed item and can change the details.
          refreshPage();
          setFeedRefreshToken((token: number) => {
            return token + 1;
          });
        }}
      />

      {eventStartsAt && eventEndsAt && (
        <ScheduledMaintenanceWindowStats
          eventStartsAt={eventStartsAt}
          eventEndsAt={eventEndsAt}
        />
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <EntityRunbooks scheduledMaintenanceId={modelId} hideIfEmpty={true} />

          <ScheduledMaintenanceFeedElement
            scheduledMaintenanceId={modelId}
            refreshToken={feedRefreshToken}
            notifyStatusPageSubscribersByDefault={
              notifyStatusPageSubscribersByDefault
            }
          />
        </div>

        <div className="min-w-0 xl:col-span-1">
          {/* ScheduledMaintenance View  */}
          <CardModelDetail<ScheduledMaintenance>
            name="Scheduled Maintenance Details"
            cardProps={{
              title: "Maintenance Details",
              description: "Key facts about this maintenance event.",
              headerLayout: "stacked",
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
            editButtonText="Edit"
            onSaveSuccess={() => {
              // refresh page-level state (event window stat bar + status-panel countdown) after an in-card edit.
              refreshPage();
              setFeedRefreshToken((token: number) => {
                return token + 1;
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
              showDetailsInNumberOfColumns: 1,
              style: DetailStyle.Compact,
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
                    sendSubscriberNotificationsOnBeforeTheEvent: true,
                  },
                  title: "Subscriber Reminders",
                  fieldType: FieldType.Element,
                  getElement: (item: ScheduledMaintenance): ReactElement => {
                    const reminders: Array<Recurring> =
                      item.sendSubscriberNotificationsOnBeforeTheEvent || [];

                    if (reminders.length === 0) {
                      return (
                        <span className="text-gray-500">
                          No reminders configured
                        </span>
                      );
                    }

                    return (
                      <div className="space-y-1.5">
                        <RecurringArrayViewElement
                          value={reminders}
                          postfix=" before the event begins"
                        />
                        <div className="text-xs text-gray-500">
                          {item.nextSubscriberNotificationBeforeTheEventAt
                            ? "Next reminder: " +
                              OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                                item.nextSubscriberNotificationBeforeTheEventAt,
                              )
                            : "No upcoming reminders"}
                        </div>
                      </div>
                    );
                  },
                },
                {
                  field: {
                    subscriberNotificationStatusOnEventScheduled: true,
                  },
                  title: "Subscriber Notifications",
                  fieldType: FieldType.Element,
                  getElement: (item: ScheduledMaintenance): ReactElement => {
                    return (
                      <div>
                        <SubscriberNotificationStatus
                          status={
                            item.subscriberNotificationStatusOnEventScheduled
                          }
                          subscriberNotificationStatusMessage={
                            item.subscriberNotificationStatusMessage
                          }
                          onResendNotification={handleResendNotification}
                        />
                        {resendNotificationError && (
                          <p
                            role="alert"
                            className="mt-1.5 text-xs text-red-600"
                          >
                            {"Could not resend notifications: " +
                              resendNotificationError}
                          </p>
                        )}
                      </div>
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
              ],
              modelId: modelId,
            }}
          />

          <OverviewCustomFields
            modelId={modelId}
            modelType={ScheduledMaintenance}
            customFieldType={ScheduledMaintenanceCustomField}
            resourceName="Scheduled Maintenance"
            headerLayout="stacked"
          />

          <CardModelDetail<ScheduledMaintenance>
            name="Affected Resources"
            cardProps={{
              title: "Affected Resources",
              description:
                "Monitors, services and infrastructure this maintenance affects.",
              headerLayout: "stacked",
            }}
            isEditable={true}
            editButtonText="Edit"
            onSaveSuccess={() => {
              setFeedRefreshToken((token: number) => {
                return token + 1;
              });
            }}
            formFields={[
              {
                field: {
                  monitors: true,
                },
                title: "",
                description:
                  "Search and attach monitors, hosts, clusters, container hosts, network sites, IoT fleets, or services affected by this scheduled maintenance. Attaching a network site covers every site beneath it.",
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
                      proxmoxClusters={
                        values.proxmoxClusters as Array<ProxmoxCluster>
                      }
                      vmwareVCenters={
                        values.vmwareVCenters as Array<VMwareVCenter>
                      }
                      cephClusters={values.cephClusters as Array<CephCluster>}
                      dockerSwarmClusters={
                        values.dockerSwarmClusters as Array<DockerSwarmCluster>
                      }
                      iotFleets={values.iotFleets as Array<IoTFleet>}
                      networkSites={values.networkSites as Array<NetworkSite>}
                      services={values.services as Array<Service>}
                      resourceTypes={[
                        "Monitor",
                        "Host",
                        "KubernetesCluster",
                        "DockerHost",
                        "PodmanHost",
                        "ProxmoxCluster",
                        "VMwareVCenter",
                        "CephCluster",
                        "DockerSwarmCluster",
                        "IoTFleet",
                        "NetworkSite",
                        "Service",
                      ]}
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
                        proxmoxClusters: payload.proxmoxClusters,
                        vmwareVCenters: payload.vmwareVCenters,
                        cephClusters: payload.cephClusters,
                        dockerSwarmClusters: payload.dockerSwarmClusters,
                        iotFleets: payload.iotFleets,
                        networkSites: payload.networkSites,
                        services: payload.services,
                      } as FormValues<ScheduledMaintenance>);
                    });
                  }
                },
              },
              /*
               * Hidden registrations so ModelForm.getSelectFields includes
               * every relation the picker writes (hosts, clusters, container
               * hosts, IoT fleets, network sites and services) on load and
               * submit.
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
                field: { proxmoxClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { vmwareVCenters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { cephClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { dockerSwarmClusters: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { iotFleets: true },
                title: "",
                fieldType: FormFieldSchemaType.Text,
                required: false,
                showIf: () => {
                  return false;
                },
              },
              {
                field: { networkSites: true },
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
                    proxmoxClusters: {
                      name: true,
                      _id: true,
                    },
                    vmwareVCenters: {
                      name: true,
                      _id: true,
                    },
                    cephClusters: {
                      name: true,
                      _id: true,
                    },
                    dockerSwarmClusters: {
                      name: true,
                      _id: true,
                    },
                    iotFleets: {
                      name: true,
                      _id: true,
                    },
                    networkSites: {
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
                        proxmoxClusters={item.proxmoxClusters || []}
                        vmwareVCenters={item.vmwareVCenters || []}
                        cephClusters={item.cephClusters || []}
                        dockerSwarmClusters={item.dockerSwarmClusters || []}
                        iotFleets={item.iotFleets || []}
                        networkSites={item.networkSites || []}
                        services={item.services || []}
                        columns={1}
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
