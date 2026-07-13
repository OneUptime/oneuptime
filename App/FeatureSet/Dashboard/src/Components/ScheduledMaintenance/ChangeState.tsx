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
  ReactElement,
  useEffect,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Black } from "Common/Types/BrandColors";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EventStatusPanel, {
  EventStateAction,
  EventStateItem,
} from "../EventView/EventStatusPanel";

export interface ComponentProps {
  scheduledMaintenanceId: ObjectID;
  onActionComplete: () => void;
  eventNumber?: string | undefined;
  title?: string | undefined;
  eventStartsAt?: Date | undefined;
  eventEndsAt?: Date | undefined;
}

const ChangeScheduledMaintenanceState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [
    scheduledMaintenanceNoteTemplates,
    setScheduledMaintenanceNoteTemplates,
  ] = useState<ScheduledMaintenanceNoteTemplate[]>([]);

  const [scheduledMaintenanceStates, setScheduledMaintenanceStates] = useState<
    ScheduledMaintenanceState[]
  >([]);
  const [
    currentScheduledMaintenanceState,
    setCurrentScheduledMaintenanceState,
  ] = useState<ScheduledMaintenanceState | undefined>(undefined);

  const [
    selectedScheduledMaintenanceState,
    setSelectedScheduledMaintenanceState,
  ] = useState<ScheduledMaintenanceState | undefined>(undefined);

  const [
    scheduledMaintenanceStateTimelines,
    setScheduledMaintenanceStateTimelines,
  ] = useState<ScheduledMaintenanceStateTimeline[]>([]);

  const fetchScheduledMaintenanceNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      const scheduledMaintenanceNoteTemplates: ListResult<ScheduledMaintenanceNoteTemplate> =
        await ModelAPI.getList<ScheduledMaintenanceNoteTemplate>({
          modelType: ScheduledMaintenanceNoteTemplate,
          query: {
            projectId: ProjectUtil.getCurrentProject()!.id!,
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

      setScheduledMaintenanceNoteTemplates(
        scheduledMaintenanceNoteTemplates.data,
      );
    };

  const fetchScheduledMaintenanceStates: PromiseVoidFunction =
    async (): Promise<void> => {
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

      setScheduledMaintenanceStates(scheduledMaintenanceStates.data);
    };

  const fetchScheduledMaintenanceStateTimelines: PromiseVoidFunction =
    async (): Promise<void> => {
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

      setScheduledMaintenanceStateTimelines(
        scheduledMaintenanceStateTimelines.data,
      );
    };

  const loadPage: PromiseVoidFunction = async () => {
    try {
      setIsLoading(true);
      setError("");

      await fetchScheduledMaintenanceStates();
      await fetchScheduledMaintenanceStateTimelines();
      await fetchScheduledMaintenanceNoteTemplates();
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadPage().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, []);

  useEffect(() => {
    if (
      scheduledMaintenanceStates.length === 0 ||
      scheduledMaintenanceStateTimelines.length === 0
    ) {
      return;
    }

    const currentScheduledMaintenanceStateTimeline:
      | ScheduledMaintenanceStateTimeline
      | undefined =
      scheduledMaintenanceStateTimelines[
        scheduledMaintenanceStateTimelines.length - 1
      ];

    if (!currentScheduledMaintenanceStateTimeline) {
      return;
    }

    const currentScheduledMaintenanceState:
      | ScheduledMaintenanceState
      | undefined = scheduledMaintenanceStates.find(
      (state: ScheduledMaintenanceState) => {
        return (
          state.id?.toString() ===
          currentScheduledMaintenanceStateTimeline.scheduledMaintenanceStateId?.toString()
        );
      },
    );

    setCurrentScheduledMaintenanceState(currentScheduledMaintenanceState);
  }, [scheduledMaintenanceStates, scheduledMaintenanceStateTimelines]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const currentStateIndex: number = scheduledMaintenanceStates.findIndex(
    (state: ScheduledMaintenanceState) => {
      return (
        state.id?.toString() ===
        currentScheduledMaintenanceState?.id?.toString()
      );
    },
  );

  const ongoingStateIndex: number = scheduledMaintenanceStates.findIndex(
    (state: ScheduledMaintenanceState) => {
      return Boolean(state.isOngoingState);
    },
  );

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

  const isCurrentStateEnded: boolean =
    Boolean(currentScheduledMaintenanceState?.isEndedState) ||
    Boolean(currentScheduledMaintenanceState?.isResolvedState);

  const isCurrentStateOngoing: boolean = Boolean(
    currentScheduledMaintenanceState?.isOngoingState,
  );

  const isCurrentStateScheduled: boolean =
    Boolean(currentScheduledMaintenanceState?.isScheduledState) ||
    (currentStateIndex >= 0 &&
      ongoingStateIndex >= 0 &&
      currentStateIndex < ongoingStateIndex);

  const actions: Array<EventStateAction> = [];

  if (!isCurrentStateEnded) {
    if (isCurrentStateScheduled) {
      if (ongoingState) {
        actions.push({
          stateId: ongoingState.id?.toString() || "",
          label: "Mark as " + (ongoingState.name || "Ongoing"),
          icon: IconProp.Clock,
          buttonStyle: ButtonStyleType.PRIMARY,
          color: ongoingState.color || Black,
          id: "sm-mark-ongoing-btn",
        });
      }

      if (endState) {
        actions.push({
          stateId: endState.id?.toString() || "",
          label: "Mark as " + (endState.name || "Complete"),
          icon: IconProp.CheckCircle,
          buttonStyle: ButtonStyleType.OUTLINE,
          color: endState.color || Black,
          id: "sm-mark-complete-btn",
        });
      }
    } else if (isCurrentStateOngoing && endState) {
      actions.push({
        stateId: endState.id?.toString() || "",
        label: "Mark as " + (endState.name || "Complete"),
        icon: IconProp.CheckCircle,
        buttonStyle: ButtonStyleType.PRIMARY,
        color: endState.color || Black,
        id: "sm-mark-complete-btn",
      });
    }
  }

  const getLastTimelineStartsAtForState: (
    state: ScheduledMaintenanceState | undefined,
  ) => Date | undefined = (
    state: ScheduledMaintenanceState | undefined,
  ): Date | undefined => {
    if (!state) {
      return undefined;
    }

    let lastStartsAt: Date | undefined = undefined;

    for (const timeline of scheduledMaintenanceStateTimelines) {
      if (
        timeline.scheduledMaintenanceStateId?.toString() ===
          state.id?.toString() &&
        timeline.startsAt
      ) {
        lastStartsAt = timeline.startsAt;
      }
    }

    return lastStartsAt;
  };

  let durationPrefix: string | undefined = undefined;
  let durationStartsAt: Date | undefined = undefined;
  let durationEndsAt: Date | undefined = undefined;

  if (
    isCurrentStateScheduled &&
    props.eventStartsAt &&
    OneUptimeDate.isInTheFuture(props.eventStartsAt)
  ) {
    durationPrefix = "Starts in";
    durationStartsAt = props.eventStartsAt;
  } else if (isCurrentStateOngoing) {
    const inProgressSince: Date | undefined =
      getLastTimelineStartsAtForState(ongoingState) || props.eventStartsAt;

    if (inProgressSince) {
      durationPrefix = "In progress for";
      durationStartsAt = inProgressSince;
    }
  } else if (isCurrentStateEnded) {
    const windowStartedAt: Date | undefined =
      props.eventStartsAt || scheduledMaintenanceStateTimelines[0]?.startsAt;
    const completedAt: Date | undefined =
      getLastTimelineStartsAtForState(endState) || props.eventEndsAt;

    if (windowStartedAt && completedAt) {
      durationPrefix = "Completed in";
      durationStartsAt = windowStartedAt;
      durationEndsAt = completedAt;
    }
  }

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
        durationPrefix={durationPrefix}
        durationStartsAt={durationStartsAt}
        durationEndsAt={durationEndsAt}
        actions={actions}
        onActionClick={openModalForState}
        onStateSelect={openModalForState}
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
            //get scheduledMaintenance state and update current scheduledMaintenance state
            const scheduledMaintenanceState:
              | ScheduledMaintenanceState
              | undefined = scheduledMaintenanceStates.find(
              (state: ScheduledMaintenanceState) => {
                return (
                  state.id?.toString() ===
                  model.scheduledMaintenanceStateId?.toString()
                );
              },
            );

            setCurrentScheduledMaintenanceState(scheduledMaintenanceState);

            setShowModal(false);

            try {
              await fetchScheduledMaintenanceStateTimelines();
            } catch (err: unknown) {
              setError(API.getFriendlyMessage(err as Exception));
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
                description: "Notify subscribers of this state change.",
                title: "Notify Status Page Subscribers",
                required: false,
                defaultValue: true,
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
