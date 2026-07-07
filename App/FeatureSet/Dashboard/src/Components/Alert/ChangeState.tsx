import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import React, {
  Fragment,
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
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import EventStatusPanel, {
  EventStateAction,
  EventStateItem,
} from "../EventView/EventStatusPanel";

export interface ComponentProps {
  alertId: ObjectID;
  onActionComplete: () => void;
  eventNumber?: string | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
}

const ChangeAlertState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [alertNoteTemplates, setAlertNoteTemplates] = useState<
    AlertNoteTemplate[]
  >([]);

  const [alertStates, setAlertStates] = useState<AlertState[]>([]);
  const [currentAlertState, setCurrentAlertState] = useState<
    AlertState | undefined
  >(undefined);

  const [selectedAlertState, setSelectedAlertState] = useState<
    AlertState | undefined
  >(undefined);

  const [alertStateTimelines, setAlertStateTimelines] = useState<
    AlertStateTimeline[]
  >([]);

  const fetchAlertNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      const alertNoteTemplates: ListResult<AlertNoteTemplate> =
        await ModelAPI.getList<AlertNoteTemplate>({
          modelType: AlertNoteTemplate,
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

      setAlertNoteTemplates(alertNoteTemplates.data);
    };

  const fetchAlertStates: PromiseVoidFunction = async (): Promise<void> => {
    const projectId: ObjectID | undefined | null =
      ProjectUtil.getCurrentProject()?.id;

    if (!projectId) {
      throw new BadDataException("ProjectId not found.");
    }

    const alertStates: ListResult<AlertState> =
      await ModelAPI.getList<AlertState>({
        modelType: AlertState,
        query: {
          projectId: projectId,
        },
        limit: 99,
        skip: 0,
        select: {
          _id: true,
          isResolvedState: true,
          isAcknowledgedState: true,
          isCreatedState: true,
          name: true,
          color: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        requestOptions: {},
      });

    setAlertStates(alertStates.data);
  };

  const fetchAlertStateTimelines: PromiseVoidFunction =
    async (): Promise<void> => {
      const alertStateTimelines: ListResult<AlertStateTimeline> =
        await ModelAPI.getList<AlertStateTimeline>({
          modelType: AlertStateTimeline,
          query: {
            alertId: props.alertId,
          },
          limit: 99,
          skip: 0,
          select: {
            _id: true,
            alertStateId: true,
            startsAt: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setAlertStateTimelines(alertStateTimelines.data);
    };

  const loadPage: PromiseVoidFunction = async () => {
    try {
      setIsLoading(true);
      setError("");
      await fetchAlertNoteTemplates();
      await fetchAlertStates();
      await fetchAlertStateTimelines();
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
    if (alertStates.length === 0 || alertStateTimelines.length === 0) {
      return;
    }

    const currentAlertStateTimeline: AlertStateTimeline | undefined =
      alertStateTimelines[alertStateTimelines.length - 1];

    if (!currentAlertStateTimeline) {
      return;
    }

    const currentAlertState: AlertState | undefined = alertStates.find(
      (state: AlertState) => {
        return (
          state.id?.toString() ===
          currentAlertStateTimeline.alertStateId?.toString()
        );
      },
    );

    setCurrentAlertState(currentAlertState);
  }, [alertStates, alertStateTimelines]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const acknowledgedState: AlertState | undefined = alertStates.find(
    (state: AlertState) => {
      return state.isAcknowledgedState;
    },
  );

  const resolvedState: AlertState | undefined = alertStates.find(
    (state: AlertState) => {
      return state.isResolvedState;
    },
  );

  const currentStateIndex: number = alertStates.findIndex(
    (state: AlertState) => {
      return state.id?.toString() === currentAlertState?.id?.toString();
    },
  );

  const acknowledgedStateIndex: number = alertStates.findIndex(
    (state: AlertState) => {
      return state.isAcknowledgedState;
    },
  );

  const resolvedStateIndex: number = alertStates.findIndex(
    (state: AlertState) => {
      return state.isResolvedState;
    },
  );

  const isAcknowledged: boolean =
    acknowledgedStateIndex >= 0 &&
    currentStateIndex >= 0 &&
    currentStateIndex >= acknowledgedStateIndex;

  const isResolved: boolean =
    resolvedStateIndex >= 0 &&
    currentStateIndex >= 0 &&
    currentStateIndex >= resolvedStateIndex;

  const getActions: () => Array<EventStateAction> =
    (): Array<EventStateAction> => {
      if (isResolved) {
        return [];
      }

      const actions: Array<EventStateAction> = [];

      if (acknowledgedState && !isAcknowledged) {
        actions.push({
          stateId: acknowledgedState.id?.toString() || "",
          label: "Acknowledge",
          icon: IconProp.Check,
          buttonStyle: ButtonStyleType.PRIMARY,
          color: acknowledgedState.color || Black,
          id: "alert-acknowledge-btn",
        });

        if (resolvedState) {
          actions.push({
            stateId: resolvedState.id?.toString() || "",
            label: "Resolve",
            icon: IconProp.CheckCircle,
            buttonStyle: ButtonStyleType.OUTLINE,
            color: resolvedState.color || Black,
            id: "alert-resolve-btn",
          });
        }
      } else if (resolvedState) {
        actions.push({
          stateId: resolvedState.id?.toString() || "",
          label: "Resolve",
          icon: IconProp.CheckCircle,
          buttonStyle: ButtonStyleType.PRIMARY,
          color: resolvedState.color || Black,
          id: "alert-resolve-btn",
        });
      }

      return actions;
    };

  const durationStartsAt: Date | undefined = alertStateTimelines[0]?.startsAt;

  let durationPrefix: string = "Ongoing for";
  let durationEndsAt: Date | undefined = undefined;

  if (isResolved && resolvedState) {
    const resolvedTimelines: Array<AlertStateTimeline> =
      alertStateTimelines.filter((timeline: AlertStateTimeline) => {
        return (
          timeline.alertStateId?.toString() === resolvedState.id?.toString()
        );
      });

    const lastResolvedTimeline: AlertStateTimeline | undefined =
      resolvedTimelines[resolvedTimelines.length - 1];

    if (lastResolvedTimeline?.startsAt) {
      durationPrefix = "Resolved in";
      durationEndsAt = lastResolvedTimeline.startsAt;
    }
  }

  const openModalForState: (stateId: string) => void = (
    stateId: string,
  ): void => {
    const alertState: AlertState | undefined = alertStates.find(
      (state: AlertState) => {
        return state.id?.toString() === stateId;
      },
    );

    setSelectedAlertState(alertState);
    setShowModal(true);
  };

  const isAcknowledgeTarget: boolean =
    selectedAlertState?.isAcknowledgedState || false;
  const isResolveTarget: boolean = selectedAlertState?.isResolvedState || false;

  const modalTitle: string = isAcknowledgeTarget
    ? "Acknowledge Alert"
    : isResolveTarget
      ? "Resolve Alert"
      : "Mark Alert as " + (selectedAlertState?.name || "");

  const modalSubmitButtonText: string = isAcknowledgeTarget
    ? "Acknowledge"
    : isResolveTarget
      ? "Resolve"
      : "Mark as " + (selectedAlertState?.name || "");

  const modalDescription: string = isAcknowledgeTarget
    ? "This records an acknowledgement on the alert timeline. You can add an optional private note for your team."
    : isResolveTarget
      ? "This marks the alert as resolved on the alert timeline. You can add an optional private note for your team."
      : "You are about to mark this alert as " +
        (selectedAlertState?.name || "") +
        ".";

  return (
    <Fragment>
      <EventStatusPanel
        states={alertStates.map((state: AlertState): EventStateItem => {
          return {
            id: state.id?.toString() || "",
            name: state.name || "",
            color: state.color || Black,
          };
        })}
        identifier={props.eventNumber}
        currentStateId={currentAlertState?.id?.toString()}
        severity={props.severity}
        isPrivate={props.isPrivate}
        durationPrefix={durationPrefix}
        durationStartsAt={durationStartsAt}
        durationEndsAt={durationEndsAt}
        actions={getActions()}
        onActionClick={(stateId: string) => {
          openModalForState(stateId);
        }}
        onStateSelect={(stateId: string) => {
          openModalForState(stateId);
        }}
      />

      {showModal && (
        <ModelFormModal
          modalWidth={ModalWidth.Large}
          modelType={AlertStateTimeline}
          name={"create-alert-state-timeline"}
          title={modalTitle}
          description={modalDescription}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={modalSubmitButtonText}
          onBeforeCreate={async (model: AlertStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.alertId = props.alertId;
            model.alertStateId = selectedAlertState!.id!;

            return model;
          }}
          onSuccess={async (_model: AlertStateTimeline) => {
            setShowModal(false);

            try {
              // refetch timelines so the panel's duration and current state are fresh.
              await fetchAlertStateTimelines();
            } catch (err: unknown) {
              setError(API.getFriendlyMessage(err as Exception));
            }

            props.onActionComplete();
          }}
          formProps={{
            name: "create-alert-state-timeline",
            modelType: AlertStateTimeline,
            id: "create-alert-state-timeline",
            fields: [
              {
                field: {
                  privateNoteTemplate: true,
                } as any,
                onChange: (
                  value: string,
                  currentValues: FormValues<AlertNoteTemplate>,
                  setNewFormValues: (
                    currentFormValues: FormValues<AlertStateTimeline>,
                  ) => void,
                ) => {
                  // get note template by id
                  const selectedTemplate: AlertNoteTemplate | undefined =
                    alertNoteTemplates.find((template: AlertNoteTemplate) => {
                      return template.id?.toString() === value;
                    });

                  const note: string = selectedTemplate?.note || "";

                  if (note) {
                    setNewFormValues({
                      ...currentValues,
                      privateNote: note,
                    } as any);
                  }
                },
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: alertNoteTemplates.map(
                  (template: AlertNoteTemplate) => {
                    return {
                      value: template.id!.toString(),
                      label: template.templateName || "",
                    };
                  },
                ),
                showIf: () => {
                  return alertNoteTemplates.length > 0;
                },
                description:
                  "If you have a template for this state change, select it here.",
                title: "Select Note Template",
                required: false,
                overrideFieldKey: "privateNoteTemplate",
                showEvenIfPermissionDoesNotExist: true,
              },
              {
                field: {
                  privateNote: true,
                } as any,
                fieldType: FormFieldSchemaType.Markdown,
                description:
                  "Add an optional private note about this state change. Only your team can see it.",
                title: "Private Note",
                required: false,
                overrideFieldKey: "privateNote",
                showEvenIfPermissionDoesNotExist: true,
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}
    </Fragment>
  );
};

export default ChangeAlertState;
