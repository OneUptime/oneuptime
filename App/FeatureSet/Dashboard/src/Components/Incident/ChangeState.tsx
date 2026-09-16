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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EventStatusPanel, {
  EventStateAction,
  EventStateItem,
  EventStatusFact,
} from "../EventView/EventStatusPanel";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIInvestigationHeaderStatus, {
  AIInvestigationStatusLiveRegion,
} from "../AI/AIInvestigationHeaderStatus";
import {
  scrollToAIInvestigationPanel,
  shouldShowAIInvestigationHeaderStatus,
} from "../AI/AIInvestigationStatus";

export interface ComponentProps {
  incidentId: ObjectID;
  onActionComplete: () => void;
  eventNumber?: string | undefined;
  title?: string | undefined;
  eventStartsAt?: Date | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
  aiInvestigationStatus?: AIRunStatus | null | undefined;
  /*
   * The completed investigation's TL;DR (or summary) as plain text. With a
   * Completed status it turns the header notice into the report's summary.
   */
  aiInvestigationSummary?: string | null | undefined;
  // Context shown under the header pills ("Declared", "Declared by", ...).
  facts?: Array<EventStatusFact> | undefined;
}

/*
 * Holds the header's place while its states and timeline load. Same outline
 * as the loaded panel (and as the page skeleton's hero), so neither the
 * swap from the page skeleton nor the swap to the real header moves the page.
 */
export const IncidentStatePlaceholder: FunctionComponent = (): ReactElement => {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="incident-state-placeholder"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <span className="sr-only">Loading incident status</span>
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
            <div className="h-5 w-16 rounded-full bg-gray-100" />
            <div className="h-5 w-28 rounded bg-gray-100" />
          </div>
        </div>
        <div className="border-t border-gray-100 px-4 py-2.5 sm:px-5">
          <div className="h-3 w-2/3 max-w-sm rounded bg-gray-100" />
        </div>
      </div>
    </div>
  );
};

const ChangeIncidentState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);

  const [error, setError] = useState<string | undefined>(undefined);
  /*
   * Starts true: the header has nothing honest to show (no current state, no
   * actions) until its states and timeline arrive, so it holds a same-sized
   * placeholder rather than rendering a panel that changes shape a moment
   * later.
   */
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [incidentStates, setIncidentStates] = useState<IncidentState[]>([]);

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

  /*
   * Templates only fill the optional note in the state-change modal. A failed
   * read must not take the whole header (and its Acknowledge / Resolve
   * buttons) down with it, so it just leaves the template picker out.
   */
  const fetchIncidentNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
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
      } catch {
        setIncidentNoteTemplates([]);
      }
    };

  const loadPage: PromiseVoidFunction = async () => {
    try {
      setIsLoading(true);
      setError("");

      // Independent reads: fetch them together instead of one after another.
      await Promise.all([
        fetchIncidentStates(),
        fetchIncidentStateTimelines(),
        fetchIncidentNoteTemplates(),
      ]);
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadPage().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.incidentId.toString()]);

  /*
   * The live region is mounted in every branch, so a status change that lands
   * while the header is still loading (or showing an error) is announced.
   */
  const liveRegion: ReactElement = (
    <AIInvestigationStatusLiveRegion
      status={props.aiInvestigationStatus}
      summary={props.aiInvestigationSummary}
    />
  );

  if (isLoading) {
    return (
      <>
        {liveRegion}
        <IncidentStatePlaceholder />
      </>
    );
  }

  if (error) {
    return (
      <>
        {liveRegion}
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            loadPage().catch((err: unknown) => {
              setError(API.getFriendlyMessage(err as Exception));
            });
          }}
        />
      </>
    );
  }

  /*
   * The current state is the latest timeline entry's state. Derived during
   * render rather than copied into state by an effect, which left one painted
   * frame with no current state - and the wrong action buttons - after every
   * load.
   */
  const currentIncidentStateTimeline: IncidentStateTimeline | undefined =
    incidentStateTimelines[incidentStateTimelines.length - 1];

  const currentIncidentState: IncidentState | undefined =
    currentIncidentStateTimeline
      ? incidentStates.find((state: IncidentState) => {
          return (
            state.id?.toString() ===
            currentIncidentStateTimeline.incidentStateId?.toString()
          );
        })
      : undefined;

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
      id: "incident-acknowledge-btn",
    });

    if (resolvedState) {
      actions.push({
        stateId: resolvedState.id?.toString() || "",
        label: "Resolve",
        icon: IconProp.CheckCircle,
        buttonStyle: ButtonStyleType.OUTLINE,
        id: "incident-resolve-btn",
      });
    }
  } else if (resolvedState && currentStateIndex < resolvedStateIndex) {
    actions.push({
      stateId: resolvedState.id?.toString() || "",
      label: "Resolve",
      icon: IconProp.CheckCircle,
      buttonStyle: ButtonStyleType.PRIMARY,
      id: "incident-resolve-btn",
    });
  }

  const durationStartsAt: Date | undefined =
    props.eventStartsAt || incidentStateTimelines[0]?.startsAt;

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
      /*
       * "Lasted", not "Resolved in": this runs to the CURRENT resolution,
       * while the stat bar's "Resolved in" counts to the FIRST one, so a
       * reopened incident would show one label with two different numbers.
       */
      durationPrefix = "Lasted";
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
      {liveRegion}
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
        facts={props.facts}
        headerNotice={
          shouldShowAIInvestigationHeaderStatus(
            props.aiInvestigationStatus,
            props.aiInvestigationSummary,
          ) ? (
            <AIInvestigationHeaderStatus
              status={props.aiInvestigationStatus!}
              summary={props.aiInvestigationSummary}
              onViewProgress={scrollToAIInvestigationPanel}
            />
          ) : undefined
        }
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
