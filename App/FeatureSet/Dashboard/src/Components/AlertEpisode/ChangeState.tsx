import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import Exception from "Common/Types/Exception/Exception";
import { Black } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import EventStatusPanel, {
  EventStateAction,
  EventStateItem,
} from "../EventView/EventStatusPanel";
import useNoteTemplates from "../EventView/useNoteTemplates";
import { BulkStateChangeNoteTemplate } from "../../Utils/BulkStateChange";
import {
  EpisodeHeaderError,
  EpisodeHeaderRefreshError,
  EpisodeHeaderSkeleton,
  getEpisodeCreatorName,
  getEpisodeHeaderFacts,
} from "../EpisodeView/EpisodeHeader";
import {
  EpisodeTiming,
  getEpisodeTiming,
  getLatestTimelineStateId,
} from "../EpisodeView/EpisodeTiming";
import { EventStateTimelineDate } from "../../Utils/EventDuration";

export interface ComponentProps {
  episodeId: ObjectID;
  onActionComplete: () => void | Promise<void>;
  /*
   * Bump to reload the header after the episode changed somewhere else on
   * the page (an edit in the details card, say). The header stays on screen
   * while it reloads.
   */
  refreshToken?: number | undefined;
}

const ChangeEpisodeState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const episodeIdString: string = props.episodeId.toString();

  const [showModal, setShowModal] = useState<boolean>(false);

  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshError, setRefreshError] = useState<string>("");

  const [episode, setEpisode] = useState<AlertEpisode | null>(null);
  const [alertStates, setAlertStates] = useState<Array<AlertState>>([]);
  const [episodeStateTimelines, setEpisodeStateTimelines] = useState<
    Array<AlertEpisodeStateTimeline>
  >([]);

  const [selectedAlertState, setSelectedAlertState] = useState<
    AlertState | undefined
  >(undefined);

  const { noteTemplates } = useNoteTemplates<AlertNoteTemplate>({
    modelType: AlertNoteTemplate,
  });

  /*
   * Every load gets an id and only the latest one may write state, so a slow
   * response for an episode the user already navigated away from (or an
   * older refresh) can never overwrite newer data.
   */
  const requestIdRef: MutableRefObject<number> = useRef<number>(0);
  const hasLoadedRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const loadHeader: () => Promise<void> = async (): Promise<void> => {
    const requestId: number = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        throw new BadDataException("ProjectId not found.");
      }

      const [loadedEpisode, loadedStates, loadedTimelines]: [
        AlertEpisode | null,
        ListResult<AlertState>,
        ListResult<AlertEpisodeStateTimeline>,
      ] = await Promise.all([
        ModelAPI.getItem<AlertEpisode>({
          modelType: AlertEpisode,
          id: props.episodeId,
          select: {
            _id: true,
            title: true,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
            isPrivate: true,
            createdAt: true,
            resolvedAt: true,
            lastAlertAddedAt: true,
            currentAlertStateId: true,
            alertSeverity: {
              name: true,
              color: true,
            },
            alertGroupingRule: {
              _id: true,
              name: true,
            },
            createdByUser: {
              _id: true,
              name: true,
              email: true,
            },
          },
        }),
        ModelAPI.getList<AlertState>({
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
        }),
        ModelAPI.getList<AlertEpisodeStateTimeline>({
          modelType: AlertEpisodeStateTimeline,
          query: {
            alertEpisodeId: props.episodeId,
          },
          limit: LIMIT_PER_PROJECT,
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
        }),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setEpisode(loadedEpisode);
      setAlertStates(loadedStates.data);
      setEpisodeStateTimelines(loadedTimelines.data);
      setError("");
      setRefreshError("");
      hasLoadedRef.current = true;
      setHasLoaded(true);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      const message: string = API.getFriendlyMessage(err as Exception);

      if (hasLoadedRef.current) {
        setRefreshError(message);
      } else {
        setError(message);
      }
    }
  };

  useEffect(() => {
    hasLoadedRef.current = false;
    setHasLoaded(false);
    setError("");
    setRefreshError("");
    setEpisode(null);
    setEpisodeStateTimelines([]);

    loadHeader().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });

    return () => {
      // Invalidate whatever is still in flight for this episode.
      requestIdRef.current += 1;
    };
  }, [episodeIdString]);

  const lastRefreshTokenRef: MutableRefObject<number | undefined> = useRef<
    number | undefined
  >(props.refreshToken);

  useEffect(() => {
    if (lastRefreshTokenRef.current === props.refreshToken) {
      return;
    }

    lastRefreshTokenRef.current = props.refreshToken;

    loadHeader().catch((err: unknown) => {
      setRefreshError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.refreshToken]);

  const retryLoad: () => void = (): void => {
    setError("");
    setRefreshError("");

    loadHeader().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  };

  if (error) {
    return <EpisodeHeaderError message={error} onRetry={retryLoad} />;
  }

  if (!hasLoaded) {
    return <EpisodeHeaderSkeleton loadingText="Loading episode" />;
  }

  const timelineDates: Array<EventStateTimelineDate> =
    episodeStateTimelines.map(
      (timeline: AlertEpisodeStateTimeline): EventStateTimelineDate => {
        return {
          stateId: timeline.alertStateId?.toString(),
          startsAt: timeline.startsAt,
        };
      },
    );

  /*
   * The timeline is what the state-change modal writes, so its latest entry
   * reflects a change the moment it lands. The episode's own current state
   * column covers an episode whose timeline could not be read.
   */
  const currentStateId: string | undefined =
    getLatestTimelineStateId(timelineDates) ||
    episode?.currentAlertStateId?.toString();

  const currentAlertState: AlertState | undefined = alertStates.find(
    (state: AlertState) => {
      return state.id?.toString() === currentStateId;
    },
  );

  const ackState: AlertState | undefined = alertStates.find(
    (state: AlertState) => {
      return state.isAcknowledgedState;
    },
  );

  const resolvedState: AlertState | undefined = alertStates.find(
    (state: AlertState) => {
      return state.isResolvedState;
    },
  );

  type GetStateIndexFunction = (state: AlertState | undefined) => number;

  const getStateIndex: GetStateIndexFunction = (
    state: AlertState | undefined,
  ): number => {
    if (!state) {
      return -1;
    }

    return alertStates.findIndex((alertState: AlertState) => {
      return alertState.id?.toString() === state.id?.toString();
    });
  };

  const currentStateIndex: number = getStateIndex(currentAlertState);
  const ackStateIndex: number = getStateIndex(ackState);
  const resolvedStateIndex: number = getStateIndex(resolvedState);

  const actions: Array<EventStateAction> = [];

  if (ackState && currentStateIndex < ackStateIndex) {
    actions.push({
      stateId: ackState.id?.toString() || "",
      label: "Acknowledge",
      icon: IconProp.Check,
      buttonStyle: ButtonStyleType.PRIMARY,
      id: "episode-acknowledge-btn",
    });

    if (resolvedState) {
      actions.push({
        stateId: resolvedState.id?.toString() || "",
        label: "Resolve",
        icon: IconProp.CheckCircle,
        buttonStyle: ButtonStyleType.OUTLINE,
        id: "episode-resolve-btn",
      });
    }
  } else if (resolvedState && currentStateIndex < resolvedStateIndex) {
    actions.push({
      stateId: resolvedState.id?.toString() || "",
      label: "Resolve",
      icon: IconProp.CheckCircle,
      buttonStyle: ButtonStyleType.PRIMARY,
      id: "episode-resolve-btn",
    });
  }

  const timing: EpisodeTiming = getEpisodeTiming({
    // Alert episodes have no declaredAt: they start when they are created.
    startedAt: episode?.createdAt || undefined,
    resolvedAt: episode?.resolvedAt || undefined,
    states: alertStates.map((state: AlertState) => {
      return {
        id: state.id?.toString() || "",
        name: state.name,
        isAcknowledgedState: state.isAcknowledgedState,
        isResolvedState: state.isResolvedState,
      };
    }),
    timelines: timelineDates,
  });

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

  let modalTitle: string =
    "Mark Episode as " + (selectedAlertState?.name || "");
  let modalSubmitButtonText: string =
    "Mark as " + (selectedAlertState?.name || "");
  let modalDescription: string =
    "You are about to mark this episode as " +
    (selectedAlertState?.name || "") +
    ". This will also update all alerts in this episode.";

  if (selectedAlertState?.isAcknowledgedState) {
    modalTitle = "Acknowledge Episode";
    modalSubmitButtonText = "Acknowledge";
    modalDescription =
      "This records an acknowledgement on the episode timeline and also updates all alerts in this episode. You can add an optional private note.";
  } else if (selectedAlertState?.isResolvedState) {
    modalTitle = "Resolve Episode";
    modalSubmitButtonText = "Resolve";
    modalDescription =
      "This marks the episode as resolved on the episode timeline and also updates all alerts in this episode. You can add an optional private note.";
  }

  return (
    <>
      <EventStatusPanel
        states={alertStates.map((state: AlertState): EventStateItem => {
          return {
            id: state.id?.toString() || "",
            name: state.name || "",
            color: state.color || Black,
          };
        })}
        identifier={
          episode?.episodeNumberWithPrefix ||
          (episode?.episodeNumber ? "#" + episode.episodeNumber : undefined)
        }
        title={episode?.title || "Untitled episode"}
        currentStateId={currentAlertState?.id?.toString()}
        severity={
          episode?.alertSeverity
            ? {
                name: episode.alertSeverity.name || "Unknown",
                color: episode.alertSeverity.color || Black,
              }
            : undefined
        }
        isPrivate={episode?.isPrivate === true}
        /*
         * "Lasted", not "Resolved in": the pill runs to the CURRENT
         * resolution, while the stat bar's "Resolved in" counts to the FIRST
         * one. For an episode that was reopened and resolved again the two
         * differ, and the same label with two numbers reads as a contradiction.
         */
        durationPrefix={
          timing.durationStartsAt
            ? timing.isResolved
              ? "Lasted"
              : "Ongoing for"
            : undefined
        }
        durationStartsAt={timing.durationStartsAt}
        durationEndsAt={timing.durationEndsAt}
        actions={actions}
        onActionClick={openModalForState}
        onStateSelect={openModalForState}
        moreMenuTitle="Move episode to"
        facts={getEpisodeHeaderFacts({
          groupingRuleName: episode?.alertGroupingRule?.name,
          createdByName: getEpisodeCreatorName(episode?.createdByUser),
          lastMemberAddedAt: episode?.lastAlertAddedAt || undefined,
          memberNoun: "alert",
        })}
        headerNotice={
          refreshError ? (
            <EpisodeHeaderRefreshError
              message={refreshError}
              onRetry={retryLoad}
            />
          ) : undefined
        }
      />

      {showModal && (
        <ModelFormModal
          modalWidth={ModalWidth.Large}
          modelType={AlertEpisodeStateTimeline}
          name={"create-episode-state-timeline"}
          title={modalTitle}
          description={modalDescription}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={modalSubmitButtonText}
          onBeforeCreate={async (model: AlertEpisodeStateTimeline) => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.alertEpisodeId = props.episodeId;
            model.alertStateId = selectedAlertState!.id!;

            return model;
          }}
          onSuccess={async (): Promise<void> => {
            setShowModal(false);

            // Reload so the state, duration and actions reflect the change.
            await loadHeader();

            await props.onActionComplete();
          }}
          formProps={{
            name: "create-episode-state-timeline",
            modelType: AlertEpisodeStateTimeline,
            id: "create-episode-state-timeline",
            fields: [
              {
                field: {
                  privateNoteTemplate: true,
                } as any,
                onChange: (
                  value: string,
                  currentValues: FormValues<AlertNoteTemplate>,
                  setNewFormValues: (
                    currentFormValues: FormValues<AlertEpisodeStateTimeline>,
                  ) => void,
                ) => {
                  const selectedTemplate:
                    | BulkStateChangeNoteTemplate
                    | undefined = noteTemplates.find(
                    (template: BulkStateChangeNoteTemplate) => {
                      return template.id === value;
                    },
                  );

                  const note: string = selectedTemplate?.note || "";

                  if (note) {
                    setNewFormValues({
                      ...currentValues,
                      privateNote: note,
                    } as any);
                  }
                },
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: noteTemplates.map(
                  (template: BulkStateChangeNoteTemplate) => {
                    return {
                      value: template.id,
                      label: template.templateName,
                    };
                  },
                ),
                showIf: () => {
                  return noteTemplates.length > 0;
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
                description: "Post a private note about this state change.",
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
    </>
  );
};

export default ChangeEpisodeState;
