import LabelsElement from "Common/UI/Components/Label/Labels";
import ChangeScheduledMaintenanceState from "../../../Components/ScheduledMaintenance/ChangeState";
import StatusPagesElement from "../../../Components/StatusPage/StatusPagesElement";
import { getStatusPageSuggestionsFooter } from "../../../Components/StatusPage/StatusPageSuggestions";
import StatusPageEventType from "Common/Types/StatusPage/StatusPageEventType";
import SubscriberNotificationStatus from "../../../Components/StatusPageSubscribers/SubscriberNotificationStatus";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Exception from "Common/Types/Exception/Exception";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import AffectedResourcesDisplay from "../../../Components/AffectedResources/AffectedResourcesDisplay";
import {
  getScheduledMaintenanceAffectedResourcesFormFields,
  getScheduledMaintenanceAffectedResourcesOnBeforeUpdate,
} from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceAffectedResourcesFormFields";
import { hasScheduledMaintenanceEventStarted } from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceMonitorStatus";
import ChangeMonitorStatusToElement from "../../../Components/MonitorStatus/ChangeMonitorStatusToElement";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import EventMeasurementsCard from "../../../Components/Measurement/EventMeasurementsCard";
import {
  SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
  getEventMeasurementRefreshKey,
} from "../../../Utils/Measurement/EventMeasurements";
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
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
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
import Dictionary from "Common/Types/Dictionary";
import useTranslateValue from "Common/UI/Utils/Translation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  getMaintenanceEndsAtError,
  moveMaintenanceEndWithStart,
} from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceForm";

// How many status page names the header lists before summarising the rest.
const MAX_STATUS_PAGE_NAMES_IN_HEADER: number = 2;

// The details card's Edit: labels folded under Advanced on Event, as on the create form.
const detailsAdvancedSection: FormFieldCollapsibleSection<ScheduledMaintenance> =
  getAdvancedFormSection<ScheduledMaintenance>();

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

/*
 * The Duration cell's description. It is one locale key with the zone as a
 * placeholder: glued onto the English text, the zone made every rendered
 * string unique, so it never matched a translation.
 */
export const PLANNED_WINDOW_DESCRIPTION_TEMPLATE: string =
  "Planned window · times in {{abbreviation}}";

interface WindowStatsProps {
  eventStartsAt: Date;
  eventEndsAt: Date;
}

/*
 * The planned window under the header. It keeps its own clock, so the
 * "in 2 hours" / "2 hours ago" descriptions stay current without
 * re-rendering the rest of the page every tick.
 */
export const ScheduledMaintenanceWindowStats: FunctionComponent<
  WindowStatsProps
> = (props: WindowStatsProps): ReactElement => {
  const { translateString } = useTranslateValue();
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

  /*
   * Looked up with its placeholder still in it and filled in here, which also
   * works where no i18next instance is ready to interpolate. EventStatTile
   * shows its description as is, so it is not looked up a second time.
   */
  const timezoneValues: Dictionary<string> = {
    abbreviation: OneUptimeDate.getCurrentTimezoneString(),
  };

  const plannedWindowDescription: string = (
    translateString(PLANNED_WINDOW_DESCRIPTION_TEMPLATE) ||
    PLANNED_WINDOW_DESCRIPTION_TEMPLATE
  ).replace(/\{\{(\w+)\}\}/g, (placeholder: string, name: string): string => {
    return timezoneValues[name] ?? placeholder;
  });

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
          description={plannedWindowDescription}
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
  /*
   * The project's states, with their places and flags: with the event's
   * own state, what tells whether it has started.
   */
  states: Array<ScheduledMaintenanceState>;
}

/*
 * The project's scheduled maintenance states, in their order, with what
 * tells one kind from another. Read with the event, for whether it has
 * started (its Change Monitor Status to can be changed until then). A
 * failed read answers no states rather than failing the page: the event's
 * own state still decides for the built-in states, and the server refuses
 * a change after the start whatever the page shows.
 */
const fetchScheduledMaintenanceStates: () => Promise<
  Array<ScheduledMaintenanceState>
> = async (): Promise<Array<ScheduledMaintenanceState>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  try {
    const states: ListResult<ScheduledMaintenanceState> =
      await ModelAPI.getList<ScheduledMaintenanceState>({
        modelType: ScheduledMaintenanceState,
        query: {
          projectId: projectId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          order: true,
          isScheduledState: true,
          isOngoingState: true,
          isEndedState: true,
          isResolvedState: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
      });

    return states.data;
  } catch {
    return [];
  }
};

// A failed resend, stamped with the event it failed for.
interface ResendNotificationErrorState {
  modelId: string;
  message: string;
}

const ScheduledMaintenanceView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
        // Out together with the event's own read.
        const statesRequest: Promise<Array<ScheduledMaintenanceState>> =
          fetchScheduledMaintenanceStates();

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
              /*
               * For the Measurements card: whether the event has ended
               * (nothing it waits for comes after that), and which state it
               * is in (a new one is when its values can have changed). With
               * its place and the other flags, whether it has started: its
               * Change Monitor Status to can be changed until then.
               */
              currentScheduledMaintenanceState: {
                _id: true,
                order: true,
                isScheduledState: true,
                isOngoingState: true,
                isEndedState: true,
                isResolvedState: true,
              },
            },
          });

        const states: Array<ScheduledMaintenanceState> = await statesRequest;

        // A newer request (another event, or a later refresh) owns the page now.
        if (requestNumber !== latestRequestRef.current) {
          return;
        }

        if (item) {
          setLoadedEvent({
            modelId: modelIdString,
            item: item,
            states: states,
          });
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
  /*
   * Whether the event has started: its Change Monitor Status to can be
   * changed until then, and is read-only after (Affected Resources).
   */
  const hasEventStarted: boolean = hasScheduledMaintenanceEventStarted({
    states: loadedEvent?.states || [],
    currentState: scheduledMaintenance?.currentScheduledMaintenanceState,
  });
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
            /*
             * The create form's steps, for what this card edits: the
             * resources, the description and the owners have cards and
             * pages of their own, so the second step holds only the status
             * pages and the reminders. Whether subscribers hear about the
             * event when it is scheduled, starts and ends is set once, when
             * it is created (those columns cannot be updated).
             */
            formSteps={[
              {
                title: "Event",
                id: "event",
              },
              {
                title: "Status Pages",
                id: "status-pages",
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
                stepId: "event",
                title: "Title",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "Event Title",
                validation: {
                  minLength: 2,
                },
              },
              // Moving the start moves the end with it, as on the create form.
              {
                field: {
                  startsAt: true,
                },
                stepId: "event",
                title: "Starts At",
                fieldType: FormFieldSchemaType.DateTime,
                required: true,
                placeholder: "Pick Date and Time",
                onChange: moveMaintenanceEndWithStart,
              },
              {
                field: {
                  endsAt: true,
                },
                title: "Ends At",
                stepId: "event",
                fieldType: FormFieldSchemaType.DateTime,
                required: true,
                placeholder: "Pick Date and Time",
                customValidation: (
                  values: FormValues<ScheduledMaintenance>,
                ): string | null => {
                  return getMaintenanceEndsAtError(values);
                },
              },
              getLabelsFormField<ScheduledMaintenance>({
                stepId: "event",
                collapsibleSection: detailsAdvancedSection,
              }),
              /*
               * Under it, the pages that show the event's monitors, one
               * click to add. The monitors are edited in the Affected
               * Resources card, so they are read from the event.
               */
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
                getFooterElement:
                  getStatusPageSuggestionsFooter<ScheduledMaintenance>({
                    eventType: StatusPageEventType.ScheduledEvent,
                    monitorsOf: {
                      modelType: ScheduledMaintenance,
                      modelId: modelId,
                    },
                  }),
              },
              {
                field: {
                  sendSubscriberNotificationsOnBeforeTheEvent: true,
                },
                stepId: "status-pages",
                title: "Reminders before the event",
                description:
                  "Remind subscribers before the event starts, for example 1 day before.",
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
                          {translator.translateText("No reminders configured")}
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
                            ? translator.translateTemplate(
                                "Next reminder: {{date}}",
                                {
                                  date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                                    item.nextSubscriberNotificationBeforeTheEventAt,
                                  ),
                                },
                              )
                            : translator.translateText("No upcoming reminders")}
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
                            {translator.translateTemplate(
                              "Could not resend notifications: {{error}}",
                              { error: resendNotificationError },
                            )}
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

          {/*
           * The project's own measurements - how late it started, how long it
           * ran over - worked out for this event, under its other facts.
           * Drawn only when the project shows some on maintenance pages.
           */}
          <EventMeasurementsCard
            source={SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS}
            eventId={modelId}
            isEventOver={Boolean(
              scheduledMaintenance?.currentScheduledMaintenanceState
                ?.isEndedState ||
                scheduledMaintenance?.currentScheduledMaintenanceState
                  ?.isResolvedState,
            )}
            refreshKey={getEventMeasurementRefreshKey({
              currentStateId:
                scheduledMaintenance?.currentScheduledMaintenanceState?._id,
              times: [eventStartsAt, eventEndsAt],
            })}
            headerLayout="stacked"
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
            createEditModalWidth={ModalWidth.Medium}
            isEditable={true}
            editButtonText="Edit"
            onSaveSuccess={() => {
              setFeedRefreshToken((token: number) => {
                return token + 1;
              });
            }}
            /*
             * Split as Create Scheduled Maintenance Event is: the monitors
             * on their own, the status they change to under them, and
             * everything else the event affects below. The status can be
             * changed until the event starts, and is read-only after.
             */
            onBeforeUpdate={getScheduledMaintenanceAffectedResourcesOnBeforeUpdate(
              {
                hasEventStarted: hasEventStarted,
              },
            )}
            formFields={getScheduledMaintenanceAffectedResourcesFormFields({
              hasEventStarted: hasEventStarted,
            })}
            modelDetailProps={{
              showDetailsInNumberOfColumns: 1,
              /*
               * As on the incident and alert pages. The default style pulls
               * its row out by -mx-3 at full width, which cut the display
               * 24px short of the card's right edge, and washed the whole
               * body in a rounded grey box on hover.
               */
              style: DetailStyle.Compact,
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
                    storageArrays: {
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
                    databaseServers: {
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
                        storageArrays={item.storageArrays || []}
                        dockerSwarmClusters={item.dockerSwarmClusters || []}
                        iotFleets={item.iotFleets || []}
                        databaseServers={item.databaseServers || []}
                        networkSites={item.networkSites || []}
                        services={item.services || []}
                        columns={1}
                      />
                    );
                  },
                },
                /*
                 * What its Edit asks under the monitors, shown with them:
                 * the status they change to when the event starts. Left out
                 * while the event has no monitor, as the Edit leaves it out.
                 */
                {
                  field: {
                    changeMonitorStatusTo: {
                      name: true,
                      color: true,
                    },
                  },
                  title: "Change Monitor Status to",
                  fieldType: FieldType.Entity,
                  showIf: (item: ScheduledMaintenance): boolean => {
                    return (item.monitors || []).length > 0;
                  },
                  getElement: (item: ScheduledMaintenance): ReactElement => {
                    return (
                      <ChangeMonitorStatusToElement
                        monitorStatus={item.changeMonitorStatusTo}
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
