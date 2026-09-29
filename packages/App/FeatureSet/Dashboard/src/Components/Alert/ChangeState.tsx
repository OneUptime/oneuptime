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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import EventStatusPanel, {
  EventPanelAction,
  EventStateAction,
  EventStateItem,
  EventStatusFact,
} from "../EventView/EventStatusPanel";
import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIInvestigationHeaderStatus, {
  AIInvestigationStatusLiveRegion,
} from "../AI/AIInvestigationHeaderStatus";
import {
  scrollToAIInvestigationPanel,
  shouldShowAIInvestigationHeaderStatus,
} from "../AI/AIInvestigationStatus";
import { getDeclareIncidentFromAlertAction } from "./DeclareIncidentFromAlert";

export interface ComponentProps {
  alertId: ObjectID;
  onActionComplete: () => void;
  eventNumber?: string | undefined;
  title?: string | undefined;
  eventStartsAt?: Date | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
  /*
   * Lifted from the page's InvestigationPanel, exactly like the incident
   * header: a queued or running investigation shows a live notice, and a
   * completed one with a summary shows it with "View full report".
   */
  aiInvestigationStatus?: AIRunStatus | null | undefined;
  aiInvestigationSummary?: string | null | undefined;
  /*
   * A responder's Confirmed / Rejected verdict on that report, shown as a
   * badge beside it.
   */
  aiInvestigationVerdict?: AIRunHumanVerdict | null | undefined;
  // Context shown under the header pills ("Created", "Monitor", "Episode").
  facts?: Array<EventStatusFact> | undefined;
}

/*
 * Holds the header's place while its states and timeline load. Same outline
 * as the loaded panel (and as the page skeleton's hero), so neither the
 * swap from the page skeleton nor the swap to the real header moves the page.
 */
export const AlertStatePlaceholder: FunctionComponent = (): ReactElement => {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="alert-state-placeholder"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <span className="sr-only">Loading alert status</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="h-5 w-16 rounded-md bg-gray-100" />
              <div className="mt-2 h-6 w-3/4 max-w-md rounded bg-gray-200" />
            </div>
            {/* Acknowledge, Resolve and Declare Incident. */}
            <div className="flex gap-2">
              <div className="h-9 w-28 rounded-md bg-gray-100" />
              <div className="h-9 w-24 rounded-md bg-gray-100" />
              <div className="h-9 w-36 rounded-md bg-gray-100" />
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

const ChangeAlertState: FunctionComponent<ComponentProps> = (
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

  const [alertNoteTemplates, setAlertNoteTemplates] = useState<
    AlertNoteTemplate[]
  >([]);

  const [alertStates, setAlertStates] = useState<AlertState[]>([]);

  const [selectedAlertState, setSelectedAlertState] = useState<
    AlertState | undefined
  >(undefined);

  const [alertStateTimelines, setAlertStateTimelines] = useState<
    AlertStateTimeline[]
  >([]);

  /*
   * Templates only fill the optional note in the state-change modal. A failed
   * read must not take the whole header (and its Acknowledge / Resolve
   * buttons) down with it, so it just leaves the template picker out.
   */
  const fetchAlertNoteTemplates: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
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
      } catch {
        setAlertNoteTemplates([]);
      }
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

      // Independent reads: fetch them together instead of one after another.
      await Promise.all([
        fetchAlertNoteTemplates(),
        fetchAlertStates(),
        fetchAlertStateTimelines(),
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
  }, [props.alertId.toString()]);

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
      <Fragment>
        {liveRegion}
        <AlertStatePlaceholder />
      </Fragment>
    );
  }

  if (error) {
    return (
      <Fragment>
        {liveRegion}
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            loadPage().catch((err: unknown) => {
              setError(API.getFriendlyMessage(err as Exception));
            });
          }}
        />
      </Fragment>
    );
  }

  /*
   * The current state is the latest timeline entry's state. Derived during
   * render rather than copied into state by an effect, which left one painted
   * frame with no current state - and the wrong action buttons - after every
   * load.
   */
  const currentAlertStateTimeline: AlertStateTimeline | undefined =
    alertStateTimelines[alertStateTimelines.length - 1];

  const currentAlertState: AlertState | undefined = currentAlertStateTimeline
    ? alertStates.find((state: AlertState) => {
        return (
          state.id?.toString() ===
          currentAlertStateTimeline.alertStateId?.toString()
        );
      })
    : undefined;

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
          id: "alert-acknowledge-btn",
        });

        if (resolvedState) {
          actions.push({
            stateId: resolvedState.id?.toString() || "",
            label: "Resolve",
            icon: IconProp.CheckCircle,
            buttonStyle: ButtonStyleType.OUTLINE,
            id: "alert-resolve-btn",
          });
        }
      } else if (resolvedState) {
        actions.push({
          stateId: resolvedState.id?.toString() || "",
          label: "Resolve",
          icon: IconProp.CheckCircle,
          buttonStyle: ButtonStyleType.PRIMARY,
          id: "alert-resolve-btn",
        });
      }

      return actions;
    };

  const durationStartsAt: Date | undefined =
    props.eventStartsAt || alertStateTimelines[0]?.startsAt;

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
      /*
       * "Lasted", not "Resolved in": this runs to the CURRENT resolution,
       * while the stat bar's "Resolved in" counts to the FIRST one, so a
       * reopened alert would show one label with two different numbers.
       */
      durationPrefix = "Lasted";
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

  /*
   * Declaring an incident from the alert sits beside Acknowledge / Resolve,
   * and stays there once the alert is resolved (declaring after the fact is
   * allowed everywhere else too). Gated on permissions only - no request.
   */
  const declareIncidentAction: EventPanelAction | null =
    getDeclareIncidentFromAlertAction(props.alertId);

  const secondaryActions: Array<EventPanelAction> = declareIncidentAction
    ? [declareIncidentAction]
    : [];

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
      {liveRegion}
      <EventStatusPanel
        states={alertStates.map((state: AlertState): EventStateItem => {
          return {
            id: state.id?.toString() || "",
            name: state.name || "",
            color: state.color || Black,
          };
        })}
        identifier={props.eventNumber}
        title={props.title}
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
        secondaryActions={secondaryActions}
        onStateSelect={(stateId: string) => {
          openModalForState(stateId);
        }}
        facts={props.facts}
        headerNotice={
          shouldShowAIInvestigationHeaderStatus(
            props.aiInvestigationStatus,
            props.aiInvestigationSummary,
          ) ? (
            <AIInvestigationHeaderStatus
              status={props.aiInvestigationStatus!}
              summary={props.aiInvestigationSummary}
              verdict={props.aiInvestigationVerdict}
              onViewProgress={scrollToAIInvestigationPanel}
            />
          ) : undefined
        }
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
