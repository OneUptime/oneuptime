import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
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
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EventStatusPanel, {
  EventStateAction,
  EventStateItem,
} from "../EventView/EventStatusPanel";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface ComponentProps {
  incidentId: ObjectID;
  onActionComplete: () => void;
  eventNumber?: string | undefined;
  title?: string | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
}

const ChangeIncidentState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);
  const [currentIncidentState, setCurrentIncidentState] = useState<
    IncidentState | undefined
  >(undefined);

  const [selectedIncidentState, setSelectedIncidentState] = useState<
    IncidentState | undefined
  >(undefined);

  const [incidentStateTimelines, setIncidentStateTimelines] = useState<
    IncidentStateTimeline[]
  >([]);
  const [incidentNoteTemplates, setIncidentNoteTemplates] = useState<
    IncidentNoteTemplate[]
  >([]);

  const fetchIncidentStates: PromiseVoidFunction = async (): Promise<void> => {
    const projectId: ObjectID | undefined | null =
      ProjectUtil.getCurrentProject()?.id;

    if (!projectId) {
      throw new BadDataException("ProjectId not found.");
    }

    const incidentStates: ListResult<IncidentState> =
      await ModelAPI.getList<IncidentState>({
        modelType: IncidentState,
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

    setIncidentStates(incidentStates.data);
  };

  const fetchIncidentStateTimelines: PromiseVoidFunction =
    async (): Promise<void> => {
      const incidentStateTimelines: ListResult<IncidentStateTimeline> =
        await ModelAPI.getList<IncidentStateTimeline>({
          modelType: IncidentStateTimeline,
          query: {
            incidentId: props.incidentId,
          },
          limit: 99,
          skip: 0,
          select: {
            _id: true,
            incidentStateId: true,
            startsAt: true,
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          requestOptions: {},
        });

      setIncidentStateTimelines(incidentStateTimelines.data);
    };

  const loadPage: PromiseVoidFunction = async () => {
    try {
      setIsLoading(true);
      setError("");

      await fetchIncidentStates();
      await fetchIncidentStateTimelines();
      await fetchIncidentNoteTemplates();
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }
    setIsLoading(false);
  };

  const fetchIncidentNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      const incidentNoteTemplates: ListResult<IncidentNoteTemplate> =
        await ModelAPI.getList<IncidentNoteTemplate>({
          modelType: IncidentNoteTemplate,
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

      setIncidentNoteTemplates(incidentNoteTemplates.data);
    };

  useEffect(() => {
    loadPage().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, []);

  useEffect(() => {
    if (incidentStates.length === 0 || incidentStateTimelines.length === 0) {
      return;
    }

    const currentIncidentStateTimeline: IncidentStateTimeline | undefined =
      incidentStateTimelines[incidentStateTimelines.length - 1];

    if (!currentIncidentStateTimeline) {
      return;
    }

    const currentIncidentState: IncidentState | undefined = incidentStates.find(
      (state: IncidentState) => {
        return (
          state.id?.toString() ===
          currentIncidentStateTimeline.incidentStateId?.toString()
        );
      },
    );

    setCurrentIncidentState(currentIncidentState);
  }, [incidentStates, incidentStateTimelines]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const ackState: IncidentState | undefined = incidentStates.find(
    (state: IncidentState) => {
      return state.isAcknowledgedState;
    },
  );

  const resolvedState: IncidentState | undefined = incidentStates.find(
    (state: IncidentState) => {
      return state.isResolvedState;
    },
  );

  type GetStateIndexFunction = (state: IncidentState | undefined) => number;

  const getStateIndex: GetStateIndexFunction = (
    state: IncidentState | undefined,
  ): number => {
    if (!state) {
      return -1;
    }

    return incidentStates.findIndex((incidentState: IncidentState) => {
      return incidentState.id?.toString() === state.id?.toString();
    });
  };

  const currentStateIndex: number = getStateIndex(currentIncidentState);
  const ackStateIndex: number = getStateIndex(ackState);
  const resolvedStateIndex: number = getStateIndex(resolvedState);

  const actions: Array<EventStateAction> = [];

  if (ackState && currentStateIndex < ackStateIndex) {
    actions.push({
      stateId: ackState.id?.toString() || "",
      label: "Acknowledge",
      icon: IconProp.Check,
      buttonStyle: ButtonStyleType.PRIMARY,
      color: ackState.color || Black,
      id: "incident-acknowledge-btn",
    });

    if (resolvedState) {
      actions.push({
        stateId: resolvedState.id?.toString() || "",
        label: "Resolve",
        icon: IconProp.CheckCircle,
        buttonStyle: ButtonStyleType.OUTLINE,
        color: resolvedState.color || Black,
        id: "incident-resolve-btn",
      });
    }
  } else if (resolvedState && currentStateIndex < resolvedStateIndex) {
    actions.push({
      stateId: resolvedState.id?.toString() || "",
      label: "Resolve",
      icon: IconProp.CheckCircle,
      buttonStyle: ButtonStyleType.PRIMARY,
      color: resolvedState.color || Black,
      id: "incident-resolve-btn",
    });
  }

  const durationStartsAt: Date | undefined =
    incidentStateTimelines[0]?.startsAt;

  let durationEndsAt: Date | undefined = undefined;
  let durationPrefix: string = "Ongoing for";

  if (currentIncidentState?.isResolvedState && resolvedState) {
    const resolvedTimeline: IncidentStateTimeline | undefined = [
      ...incidentStateTimelines,
    ]
      .reverse()
      .find((timeline: IncidentStateTimeline) => {
        return (
          timeline.incidentStateId?.toString() === resolvedState.id?.toString()
        );
      });

    if (resolvedTimeline?.startsAt) {
      durationEndsAt = resolvedTimeline.startsAt;
      durationPrefix = "Resolved in";
    }
  }

  const openModalForState: (stateId: string) => void = (
    stateId: string,
  ): void => {
    const incidentState: IncidentState | undefined = incidentStates.find(
      (state: IncidentState) => {
        return state.id?.toString() === stateId;
      },
    );

    setSelectedIncidentState(incidentState);
    setShowModal(true);
  };

  let modalTitle: string =
    "Mark Incident as " + (selectedIncidentState?.name || "");
  let modalSubmitButtonText: string =
    "Mark as " + (selectedIncidentState?.name || "");
  let modalDescription: string =
    "You are about to mark this incident as " +
    (selectedIncidentState?.name || "") +
    ".";

  if (selectedIncidentState?.isAcknowledgedState) {
    modalTitle = "Acknowledge Incident";
    modalSubmitButtonText = "Acknowledge";
    modalDescription =
      "This records an acknowledgement on the incident timeline. You can add an optional public note for status page subscribers.";
  } else if (selectedIncidentState?.isResolvedState) {
    modalTitle = "Resolve Incident";
    modalSubmitButtonText = "Resolve";
    modalDescription =
      "This marks the incident as resolved on the incident timeline. You can add an optional public note for status page subscribers.";
  }

  return (
    <>
      <EventStatusPanel
        states={incidentStates.map((state: IncidentState): EventStateItem => {
          return {
            id: state.id?.toString() || "",
            name: state.name || "",
            color: state.color || Black,
          };
        })}
        identifier={props.eventNumber}
        title={props.title}
        currentStateId={currentIncidentState?.id?.toString()}
        severity={props.severity}
        isPrivate={props.isPrivate}
        durationPrefix={durationStartsAt ? durationPrefix : undefined}
        durationStartsAt={durationStartsAt}
        durationEndsAt={durationEndsAt}
        actions={actions}
        onActionClick={openModalForState}
        onStateSelect={openModalForState}
      />

      {showModal && (
        <ModelFormModal
          modalWidth={ModalWidth.Large}
          modelType={IncidentStateTimeline}
          name={"create-incident-state-timeline"}
          title={modalTitle}
          description={modalDescription}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={modalSubmitButtonText}
          onBeforeCreate={async (model: IncidentStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.incidentId = props.incidentId;
            model.incidentStateId = selectedIncidentState!.id!;

            return model;
          }}
          onSuccess={async (): Promise<void> => {
            setShowModal(false);

            try {
              // refetch timelines so the panel's duration and current state are fresh.
              await fetchIncidentStateTimelines();
            } catch (err: unknown) {
              setError(API.getFriendlyMessage(err as Exception));
            }

            props.onActionComplete();
          }}
          formProps={{
            name: "create-incident-state-timeline",
            modelType: IncidentStateTimeline,
            id: "create-incident-state-timeline",
            fields: [
              {
                field: {
                  publicNoteTemplate: true,
                } as any,
                onChange: (
                  value: string,
                  currentValues: FormValues<IncidentNoteTemplate>,
                  setNewFormValues: (
                    currentFormValues: FormValues<IncidentStateTimeline>,
                  ) => void,
                ) => {
                  // get note template by id
                  const selectedTemplate: IncidentNoteTemplate | undefined =
                    incidentNoteTemplates.find(
                      (template: IncidentNoteTemplate) => {
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
                dropdownOptions: incidentNoteTemplates.map(
                  (template: IncidentNoteTemplate) => {
                    return {
                      value: template.id!.toString(),
                      label: template.templateName || "",
                    };
                  },
                ),
                showIf: () => {
                  return incidentNoteTemplates.length > 0;
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
    </>
  );
};

export default ChangeIncidentState;
