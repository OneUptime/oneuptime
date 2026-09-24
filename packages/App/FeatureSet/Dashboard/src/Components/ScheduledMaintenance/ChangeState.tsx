import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Black } from "Common/Types/BrandColors";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import PublicNoteSubscriberNotificationDefault, {
  ScheduledMaintenanceStateChangeSubscriberNotificationSetting,
} from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EventStatusPanel, {
  EventStateAction,
  EventStateItem,
  EventStatusFact,
} from "../EventView/EventStatusPanel";
import {
  SCHEDULED_MAINTENANCE_STATE_RECHECK_MIN_INTERVAL_IN_MS,
  ScheduledMaintenancePhase,
  ScheduledMaintenanceStateFlags,
  ScheduledMaintenanceStateKind,
  ScheduledMaintenanceTimelineEntry,
  ScheduledMaintenanceTiming,
  getCurrentTimelineStateId,
  getScheduledMaintenanceStateKind,
  getScheduledMaintenanceTiming,
  getScheduledMaintenanceTimingRefreshDelayInMs,
  getTimelineDateForState,
  isScheduledMaintenanceTimingLive,
  shouldRecheckScheduledMaintenanceState,
} from "../../Utils/ScheduledMaintenanceTiming";

export interface ComponentProps {
  scheduledMaintenanceId: ObjectID;
  onActionComplete: () => void;
  eventNumber?: string | undefined;
  title?: string | undefined;
  eventStartsAt?: Date | undefined;
  eventEndsAt?: Date | undefined;
  /*
   * The event's subscriber notification settings. They decide where "Notify
   * Status Page Subscribers" starts in the state change form, which also
   * decides whether its public note notifies: on for an event created with
   * subscribers notified; for one created quietly, on only when moving it to
   * ongoing or ended while its "Event Ongoing" / "Event Ended" setting would
   * have announced that change. When left out, the form starts with
   * notifying on.
   */
  subscriberNotificationSettings?:
    | ScheduledMaintenanceStateChangeSubscriberNotificationSetting
    | undefined;
  /*
   * Context shown under the header pills ("Status pages", "Created by").
   * Facts with an empty value are skipped by EventStatusPanel.
   */
  facts?: Array<EventStatusFact> | undefined;
}

export const SCHEDULED_MAINTENANCE_STATE_LOADING_TEXT: string =
  "Loading scheduled maintenance status";

type ToTimelineEntriesFunction = (
  timelines: Array<ScheduledMaintenanceStateTimeline>,
) => Array<ScheduledMaintenanceTimelineEntry>;

const toTimelineEntries: ToTimelineEntriesFunction = (
  timelines: Array<ScheduledMaintenanceStateTimeline>,
): Array<ScheduledMaintenanceTimelineEntry> => {
  return timelines.map(
    (
      timeline: ScheduledMaintenanceStateTimeline,
    ): ScheduledMaintenanceTimelineEntry => {
      return {
        stateId: timeline.scheduledMaintenanceStateId?.toString(),
        startsAt: timeline.startsAt,
      };
    },
  );
};

/*
 * Sized like the loaded header (EventStatusPanel's titled layout plus its
 * step rail), so the page does not jump when the states arrive.
 */
const HeaderPlaceholder: FunctionComponent = (): ReactElement => {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="scheduled-maintenance-state-loading"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <span className="sr-only">
        {SCHEDULED_MAINTENANCE_STATE_LOADING_TEXT}
      </span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="h-5 w-16 rounded-md bg-gray-100" />
              <div className="mt-2 h-6 w-3/4 max-w-md rounded bg-gray-200" />
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-28 rounded-md bg-gray-100" />
              <div className="h-9 w-24 rounded-md bg-gray-100" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <div className="h-5 w-20 rounded-full bg-gray-100" />
            <div className="h-5 w-32 rounded bg-gray-100" />
          </div>
        </div>
        <div className="border-t border-gray-100 px-4 py-2.5 sm:px-5">
          <div className="h-3 w-2/3 max-w-sm rounded bg-gray-100" />
        </div>
      </div>
    </div>
  );
};

interface OverdueNoticeProps {
  phase: ScheduledMaintenancePhase;
  overdueSince: Date;
  nextStateName: string;
}

/*
 * The amber warning for an event that has missed a boundary: still
 * scheduled after its start, or still in progress after its end.
 */
const OverdueNotice: FunctionComponent<OverdueNoticeProps> = (
  props: OverdueNoticeProps,
): ReactElement => {
  const isStartOverdue: boolean =
    props.phase === ScheduledMaintenancePhase.StartOverdue;
  const plannedAt: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(props.overdueSince);

  return (
    <div
      data-testid="scheduled-maintenance-overdue-notice"
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5"
    >
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
        <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-amber-600" />
        <span>{isStartOverdue ? "Start overdue" : "Overrunning"}</span>
      </span>
      <span className="min-w-0 text-sm text-gray-600">
        {isStartOverdue ? "Planned to start at " : "Planned to end at "}
        <span className="font-medium text-gray-900">{plannedAt}</span>
        {", but it has not been marked as " + props.nextStateName + " yet."}
      </span>
    </div>
  );
};

const ChangeScheduledMaintenanceState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string>("");
  // Starts loading, so the header never flashes an empty panel first.
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [
    scheduledMaintenanceNoteTemplates,
    setScheduledMaintenanceNoteTemplates,
  ] = useState<ScheduledMaintenanceNoteTemplate[]>([]);

  const [scheduledMaintenanceStates, setScheduledMaintenanceStates] = useState<
    ScheduledMaintenanceState[]
  >([]);

  const [
    selectedScheduledMaintenanceState,
    setSelectedScheduledMaintenanceState,
  ] = useState<ScheduledMaintenanceState | undefined>(undefined);

  /*
   * Worked out for the state the form moves the event to. openModalForState
   * sets that state and opens the form in the same handler, so the form's
   * first render already sees it.
   */
  const notifySubscribersByDefault: boolean =
    PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenanceStateChange(
      props.subscriberNotificationSettings,
      selectedScheduledMaintenanceState,
    );

  const [
    scheduledMaintenanceStateTimelines,
    setScheduledMaintenanceStateTimelines,
  ] = useState<ScheduledMaintenanceStateTimeline[]>([]);

  // The clock the timing is evaluated against, advanced by the effect below.
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  const isMountedRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const isRecheckingStateRef: MutableRefObject<boolean> =
    useRef<boolean>(false);
  const lastTimelineFetchAtRef: MutableRefObject<number> = useRef<number>(0);
  const onActionCompleteRef: MutableRefObject<() => void> = useRef<() => void>(
    props.onActionComplete,
  );
  onActionCompleteRef.current = props.onActionComplete;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchScheduledMaintenanceNoteTemplates: () => Promise<
    Array<ScheduledMaintenanceNoteTemplate>
  > = async (): Promise<Array<ScheduledMaintenanceNoteTemplate>> => {
    const projectId: ObjectID | undefined | null =
      ProjectUtil.getCurrentProject()?.id;

    if (!projectId) {
      throw new BadDataException("ProjectId not found.");
    }

    const scheduledMaintenanceNoteTemplates: ListResult<ScheduledMaintenanceNoteTemplate> =
      await ModelAPI.getList<ScheduledMaintenanceNoteTemplate>({
        modelType: ScheduledMaintenanceNoteTemplate,
        query: {
          projectId: projectId,
        },
        limit: 99,
        skip: 0,
        select: {
          _id: true,
          templateName: true,
          note: true,
        },
        sort: {
          templateName: SortOrder.Ascending,
        },
      });

    return scheduledMaintenanceNoteTemplates.data;
  };

  const fetchScheduledMaintenanceStates: () => Promise<
    Array<ScheduledMaintenanceState>
  > = async (): Promise<Array<ScheduledMaintenanceState>> => {
    const projectId: ObjectID | undefined | null =
      ProjectUtil.getCurrentProject()?.id;

    if (!projectId) {
      throw new BadDataException("ProjectId not found.");
    }

    const scheduledMaintenanceStates: ListResult<ScheduledMaintenanceState> =
      await ModelAPI.getList<ScheduledMaintenanceState>({
        modelType: ScheduledMaintenanceState,
        query: {
          projectId: projectId,
        },
        limit: 99,
        skip: 0,
        select: {
          _id: true,
          isResolvedState: true,
          isOngoingState: true,
          isScheduledState: true,
          isEndedState: true,
          name: true,
          color: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        requestOptions: {},
      });

    return scheduledMaintenanceStates.data;
  };

  const fetchScheduledMaintenanceStateTimelines: () => Promise<
    Array<ScheduledMaintenanceStateTimeline>
  > = async (): Promise<Array<ScheduledMaintenanceStateTimeline>> => {
    lastTimelineFetchAtRef.current = OneUptimeDate.getCurrentDate().getTime();

    const scheduledMaintenanceStateTimelines: ListResult<ScheduledMaintenanceStateTimeline> =
      await ModelAPI.getList<ScheduledMaintenanceStateTimeline>({
        modelType: ScheduledMaintenanceStateTimeline,
        query: {
          scheduledMaintenanceId: props.scheduledMaintenanceId,
        },
        limit: 99,
        skip: 0,
        select: {
          _id: true,
          scheduledMaintenanceStateId: true,
          startsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        requestOptions: {},
      });

    return scheduledMaintenanceStateTimelines.data;
  };

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      // Independent reads, so they go out together.
      const results: [
        Array<ScheduledMaintenanceState>,
        Array<ScheduledMaintenanceStateTimeline>,
        Array<ScheduledMaintenanceNoteTemplate>,
      ] = await Promise.all([
        fetchScheduledMaintenanceStates(),
        fetchScheduledMaintenanceStateTimelines(),
        fetchScheduledMaintenanceNoteTemplates(),
      ]);

      if (!isMountedRef.current) {
        return;
      }

      setScheduledMaintenanceStates(results[0]);
      setScheduledMaintenanceStateTimelines(results[1]);
      setScheduledMaintenanceNoteTemplates(results[2]);
      setNow(OneUptimeDate.getCurrentDate());
    } catch (err: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadPage().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
      setIsLoading(false);
    });
  }, []);

  const stateFlags: Array<ScheduledMaintenanceStateFlags> =
    scheduledMaintenanceStates.map(
      (state: ScheduledMaintenanceState): ScheduledMaintenanceStateFlags => {
        return {
          id: state.id?.toString() || "",
          isScheduledState: state.isScheduledState,
          isOngoingState: state.isOngoingState,
          isEndedState: state.isEndedState,
          isResolvedState: state.isResolvedState,
        };
      },
    );

  const timelineEntries: Array<ScheduledMaintenanceTimelineEntry> =
    toTimelineEntries(scheduledMaintenanceStateTimelines);

  const currentTimelineStateId: string | undefined =
    getCurrentTimelineStateId(timelineEntries);

  const currentScheduledMaintenanceState:
    | ScheduledMaintenanceState
    | undefined = currentTimelineStateId
    ? scheduledMaintenanceStates.find((state: ScheduledMaintenanceState) => {
        return state.id?.toString() === currentTimelineStateId;
      })
    : undefined;

  const ongoingState: ScheduledMaintenanceState | undefined =
    scheduledMaintenanceStates.find((state: ScheduledMaintenanceState) => {
      return Boolean(state.isOngoingState);
    });

  const endState: ScheduledMaintenanceState | undefined =
    scheduledMaintenanceStates.find((state: ScheduledMaintenanceState) => {
      return Boolean(state.isEndedState);
    }) ||
    scheduledMaintenanceStates.find((state: ScheduledMaintenanceState) => {
      return Boolean(state.isResolvedState);
    });

  const stateKind: ScheduledMaintenanceStateKind =
    getScheduledMaintenanceStateKind({
      states: stateFlags,
      currentStateId: currentScheduledMaintenanceState?.id?.toString(),
    });

  const timing: ScheduledMaintenanceTiming = getScheduledMaintenanceTiming({
    stateKind: stateKind,
    startsAt: props.eventStartsAt,
    endsAt: props.eventEndsAt,
    startedAt: getTimelineDateForState({
      timelines: timelineEntries,
      stateId: ongoingState?.id?.toString(),
      pick: "first",
    }),
    completedAt: getTimelineDateForState({
      timelines: timelineEntries,
      stateId: endState?.id?.toString(),
      pick: "last",
    }),
    now: now,
  });

  const isTimingLive: boolean =
    !isLoading && !error && isScheduledMaintenanceTimingLive(timing);
  const refreshDelayInMs: number =
    getScheduledMaintenanceTimingRefreshDelayInMs(timing, now);

  /*
   * Re-read the clock so "Starts in" counts down, flips to "Start overdue by"
   * once startsAt passes, and so on. One timeout per tick (rescheduled on
   * every change) rather than an interval, so the delay can shorten to land
   * exactly on the next phase change.
   */
  useEffect(() => {
    if (!isTimingLive) {
      return () => {};
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, refreshDelayInMs);

    return () => {
      clearTimeout(timeout);
    };
  }, [now, isTimingLive, refreshDelayInMs]);

  const shouldRecheckState: boolean =
    !isLoading && !error && shouldRecheckScheduledMaintenanceState(timing, now);

  /*
   * A missed boundary is usually the once-a-minute worker not having moved
   * the event yet. For a few minutes after one, re-read the timeline on each
   * tick so its transition appears without a reload, and tell the page when
   * the state really changed so it can refresh the feed and details.
   */
  useEffect(() => {
    if (!shouldRecheckState || isRecheckingStateRef.current) {
      return;
    }

    if (
      now.getTime() - lastTimelineFetchAtRef.current <
      SCHEDULED_MAINTENANCE_STATE_RECHECK_MIN_INTERVAL_IN_MS
    ) {
      return;
    }

    const previousStateId: string | undefined = currentTimelineStateId;
    isRecheckingStateRef.current = true;

    fetchScheduledMaintenanceStateTimelines()
      .then((latestTimelines: Array<ScheduledMaintenanceStateTimeline>) => {
        if (!isMountedRef.current) {
          return;
        }

        setScheduledMaintenanceStateTimelines(latestTimelines);

        if (
          getCurrentTimelineStateId(toTimelineEntries(latestTimelines)) !==
          previousStateId
        ) {
          onActionCompleteRef.current();
        }
      })
      .catch(() => {
        // A failed background check keeps the last known state; the next tick tries again.
      })
      .finally(() => {
        isRecheckingStateRef.current = false;
      });
  }, [now, shouldRecheckState]);

  if (isLoading) {
    return (
      <div className="mb-5">
        <HeaderPlaceholder />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-5 rounded-xl border border-gray-200 bg-white px-4 shadow-sm sm:px-5">
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            loadPage().catch((err: unknown) => {
              setError(API.getFriendlyMessage(err as Exception));
            });
          }}
        />
      </div>
    );
  }

  const actions: Array<EventStateAction> = [];

  if (stateKind === ScheduledMaintenanceStateKind.Scheduled) {
    if (ongoingState) {
      actions.push({
        stateId: ongoingState.id?.toString() || "",
        label: "Mark as " + (ongoingState.name || "Ongoing"),
        icon: IconProp.Clock,
        buttonStyle: ButtonStyleType.PRIMARY,
        id: "sm-mark-ongoing-btn",
      });
    }

    if (endState) {
      actions.push({
        stateId: endState.id?.toString() || "",
        label: "Mark as " + (endState.name || "Complete"),
        icon: IconProp.CheckCircle,
        buttonStyle: ButtonStyleType.OUTLINE,
        id: "sm-mark-complete-btn",
      });
    }
  } else if (stateKind === ScheduledMaintenanceStateKind.Ongoing && endState) {
    actions.push({
      stateId: endState.id?.toString() || "",
      label: "Mark as " + (endState.name || "Complete"),
      icon: IconProp.CheckCircle,
      buttonStyle: ButtonStyleType.PRIMARY,
      id: "sm-mark-complete-btn",
    });
  }

  const overdueNotice: ReactElement | undefined =
    timing.isOverdue && timing.overdueSince ? (
      <OverdueNotice
        phase={timing.phase}
        overdueSince={timing.overdueSince}
        nextStateName={
          timing.phase === ScheduledMaintenancePhase.StartOverdue
            ? ongoingState?.name || "ongoing"
            : endState?.name || "ended"
        }
      />
    ) : undefined;

  const openModalForState: (stateId: string) => void = (
    stateId: string,
  ): void => {
    const scheduledMaintenanceState: ScheduledMaintenanceState | undefined =
      scheduledMaintenanceStates.find((state: ScheduledMaintenanceState) => {
        return state.id?.toString() === stateId;
      });

    setSelectedScheduledMaintenanceState(scheduledMaintenanceState);
    setShowModal(true);
  };

  return (
    <div className="mb-5">
      <EventStatusPanel
        states={scheduledMaintenanceStates.map(
          (state: ScheduledMaintenanceState): EventStateItem => {
            return {
              id: state.id?.toString() || "",
              name: state.name || "",
              color: state.color || Black,
            };
          },
        )}
        identifier={props.eventNumber}
        title={props.title}
        currentStateId={currentScheduledMaintenanceState?.id?.toString()}
        durationPrefix={timing.durationPrefix}
        durationStartsAt={timing.durationStartsAt}
        durationEndsAt={timing.durationEndsAt}
        actions={actions}
        onActionClick={openModalForState}
        onStateSelect={openModalForState}
        facts={props.facts}
        headerNotice={overdueNotice}
      />

      {showModal && (
        <ModelFormModal
          modalWidth={ModalWidth.Large}
          modelType={ScheduledMaintenanceStateTimeline}
          name={"create-scheduledMaintenance-state-timeline"}
          title={
            "Mark Scheduled Maintenance as " +
            selectedScheduledMaintenanceState?.name
          }
          description={
            "This updates the event timeline. You can add an optional public note for status page subscribers."
          }
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={
            "Mark as " + (selectedScheduledMaintenanceState?.name || "")
          }
          /*
           * Starts from the target state: on for an event created with
           * subscribers notified; for a quiet one, on only when it moves to
           * ongoing or ended and the event is set to announce that change.
           * Seeded as a value, not only as the field's default: the form
           * drops a false default, and an unsent flag would leave the state
           * change to its column default of notifying.
           */
          initialValues={{
            shouldStatusPageSubscribersBeNotified: notifySubscribersByDefault,
          }}
          onBeforeCreate={async (model: ScheduledMaintenanceStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.scheduledMaintenanceId = props.scheduledMaintenanceId;
            model.scheduledMaintenanceStateId =
              selectedScheduledMaintenanceState!.id!;

            return model;
          }}
          onSuccess={async (
            model: ScheduledMaintenanceStateTimeline,
          ): Promise<void> => {
            setShowModal(false);

            /*
             * Show the new state straight away. The refetch below swaps this
             * stand-in entry for the server's copy; if that refetch fails the
             * change itself still succeeded, so the stand-in stays rather than
             * replacing the header with an error.
             */
            const newStateId: ObjectID | undefined =
              model.scheduledMaintenanceStateId ||
              selectedScheduledMaintenanceState?.id ||
              undefined;

            if (newStateId) {
              const standInTimeline: ScheduledMaintenanceStateTimeline =
                new ScheduledMaintenanceStateTimeline();
              standInTimeline.scheduledMaintenanceStateId = newStateId;
              standInTimeline.startsAt =
                model.startsAt || OneUptimeDate.getCurrentDate();

              setScheduledMaintenanceStateTimelines(
                (
                  previousTimelines: Array<ScheduledMaintenanceStateTimeline>,
                ): Array<ScheduledMaintenanceStateTimeline> => {
                  return [...previousTimelines, standInTimeline];
                },
              );
            }

            setNow(OneUptimeDate.getCurrentDate());

            try {
              const latestTimelines: Array<ScheduledMaintenanceStateTimeline> =
                await fetchScheduledMaintenanceStateTimelines();

              if (isMountedRef.current) {
                setScheduledMaintenanceStateTimelines(latestTimelines);
              }
            } catch {
              // Keep the stand-in entry; see above.
            }

            props.onActionComplete();
          }}
          formProps={{
            name: "create-scheduled-maintenance-state-timeline",
            modelType: ScheduledMaintenanceStateTimeline,
            id: "create-scheduled-maintenance-state-timeline",
            fields: [
              {
                field: {
                  publicNoteTemplate: true,
                } as any,
                onChange: (
                  value: string,
                  currentValues: FormValues<ScheduledMaintenanceNoteTemplate>,
                  setNewFormValues: (
                    currentFormValues: FormValues<ScheduledMaintenanceStateTimeline>,
                  ) => void,
                ) => {
                  // get note template by id
                  const selectedTemplate:
                    | ScheduledMaintenanceNoteTemplate
                    | undefined = scheduledMaintenanceNoteTemplates.find(
                    (template: ScheduledMaintenanceNoteTemplate) => {
                      return template.id?.toString() === value;
                    },
                  );

                  const note: string = selectedTemplate?.note || "";

                  if (note) {
                    setNewFormValues({
                      ...currentValues,
                      publicNote: note,
                    } as any);
                  }
                },
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: scheduledMaintenanceNoteTemplates.map(
                  (template: ScheduledMaintenanceNoteTemplate) => {
                    return {
                      value: template.id!.toString(),
                      label: template.templateName || "",
                    };
                  },
                ),
                showIf: () => {
                  return scheduledMaintenanceNoteTemplates.length > 0;
                },
                description:
                  "If you have a template for this state change, select it here.",
                title: "Select Note Template",
                required: false,
                overrideFieldKey: "publicNoteTemplate",
                showEvenIfPermissionDoesNotExist: true,
              },
              {
                field: {
                  publicNote: true,
                } as any,
                fieldType: FormFieldSchemaType.Markdown,
                description:
                  "Post a public note about this state change to the status page.",
                title: "Public Note",
                required: false,
                overrideFieldKey: "publicNote",
                showEvenIfPermissionDoesNotExist: true,
              },
              {
                field: {
                  shouldStatusPageSubscribersBeNotified: true,
                },
                fieldType: FormFieldSchemaType.Checkbox,
                description: notifySubscribersByDefault
                  ? "Notify subscribers of this state change."
                  : PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
                title: "Notify Status Page Subscribers",
                required: false,
                defaultValue: notifySubscribersByDefault,
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}
    </div>
  );
};

export default ChangeScheduledMaintenanceState;
