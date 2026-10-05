import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
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
import EventStatusPanel, {
  EventStateAction,
  EventStateItem,
} from "../EventView/EventStatusPanel";
import useNoteTemplates from "../EventView/useNoteTemplates";
import { getStateChangeFormFields } from "../EventView/StateChangeFormFields";
import { BulkStateChangeNoteType } from "../../Utils/BulkStateChange";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

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
  const translator: Translator = useTranslator();
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

  /*
   * The modal looks its title, description and button text up; the ones
   * that name the chosen state are filled in here, in the reader's language.
   */
  const selectedStateName: TranslatableTerm = translatableTerm(
    selectedAlertState?.name || "",
  );

  let modalTitle: string = translator.translateTemplate(
    "Mark Episode as {{state}}",
    { state: selectedStateName },
  );
  let modalSubmitButtonText: string = translator.translateTemplate(
    "Mark as {{state}}",
    { state: selectedStateName },
  );
  let modalDescription: string = translator.translateTemplate(
    "You are about to mark this episode as {{state}}. This will also update all alerts in this episode.",
    { state: selectedStateName },
  );

  /*
   * What the change does, in a sentence or two; the optional note is the
   * folded "Add a private note" line under it. Acknowledging stops the on-call
   * escalation of the episode and - as it acknowledges its alerts too -
   * of theirs, so the confirm says so.
   */
  if (selectedAlertState?.isAcknowledgedState) {
    modalTitle = translationKey("Acknowledge Episode");
    modalSubmitButtonText = translationKey("Acknowledge");
    modalDescription = translationKey(
      "This records an acknowledgement on the episode timeline and also updates all alerts in this episode. Any on-call escalation for the episode and its alerts stops.",
    );
  } else if (selectedAlertState?.isResolvedState) {
    modalTitle = translationKey("Resolve Episode");
    modalSubmitButtonText = translationKey("Resolve");
    modalDescription = translationKey(
      "This marks the episode as resolved on the episode timeline and also updates all alerts in this episode.",
    );
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
        title={episode?.title || translator.translateText("Untitled episode")}
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
              ? translationKey("Lasted")
              : translationKey("Ongoing for")
            : undefined
        }
        durationStartsAt={timing.durationStartsAt}
        durationEndsAt={timing.durationEndsAt}
        actions={actions}
        onActionClick={openModalForState}
        onStateSelect={openModalForState}
        moreMenuTitle={translationKey("Move episode to")}
        facts={getEpisodeHeaderFacts(
          {
            groupingRuleName: episode?.alertGroupingRule?.name,
            createdByName: getEpisodeCreatorName(
              episode?.createdByUser,
              translator,
            ),
            lastMemberAddedAt: episode?.lastAlertAddedAt || undefined,
            memberNoun: "alert",
          },
          translator,
        )}
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
            /*
             * Nothing else decides an episode's state change: just the
             * private note, folded under "Add a private note"
             * (EventView/StateChangeFormFields).
             */
            fields: getStateChangeFormFields<AlertEpisodeStateTimeline>({
              noteType: BulkStateChangeNoteType.Private,
              noteDescription: translationKey(
                "Post a private note about this state change.",
              ),
              noteTemplates: noteTemplates,
              // Offered only to someone who may post a private note.
              noteModel: new AlertEpisodeInternalNote(),
            }),
            formType: FormType.Create,
          }}
        />
      )}
    </>
  );
};

export default ChangeEpisodeState;
