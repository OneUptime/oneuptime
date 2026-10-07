import BadDataException from "Common/Types/Exception/BadDataException";
import { StateListType } from "Common/Utils/StateOrder";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
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
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
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

  const [episode, setEpisode] = useState<IncidentEpisode | null>(null);
  const [incidentStates, setIncidentStates] = useState<Array<IncidentState>>(
    [],
  );
  const [episodeStateTimelines, setEpisodeStateTimelines] = useState<
    Array<IncidentEpisodeStateTimeline>
  >([]);

  const [selectedIncidentState, setSelectedIncidentState] = useState<
    IncidentState | undefined
  >(undefined);

  const { noteTemplates } = useNoteTemplates<IncidentNoteTemplate>({
    modelType: IncidentNoteTemplate,
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
        IncidentEpisode | null,
        ListResult<IncidentState>,
        ListResult<IncidentEpisodeStateTimeline>,
      ] = await Promise.all([
        ModelAPI.getItem<IncidentEpisode>({
          modelType: IncidentEpisode,
          id: props.episodeId,
          select: {
            _id: true,
            title: true,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
            isPrivate: true,
            declaredAt: true,
            createdAt: true,
            resolvedAt: true,
            lastIncidentAddedAt: true,
            currentIncidentStateId: true,
            incidentSeverity: {
              name: true,
              color: true,
            },
            incidentGroupingRule: {
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
        ModelAPI.getList<IncidentState>({
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
            order: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          requestOptions: {},
        }),
        ModelAPI.getList<IncidentEpisodeStateTimeline>({
          modelType: IncidentEpisodeStateTimeline,
          query: {
            incidentEpisodeId: props.episodeId,
          },
          limit: LIMIT_PER_PROJECT,
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
        }),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      setEpisode(loadedEpisode);
      setIncidentStates(loadedStates.data);
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
      (timeline: IncidentEpisodeStateTimeline): EventStateTimelineDate => {
        return {
          stateId: timeline.incidentStateId?.toString(),
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
    episode?.currentIncidentStateId?.toString();

  const currentIncidentState: IncidentState | undefined = incidentStates.find(
    (state: IncidentState) => {
      return state.id?.toString() === currentStateId;
    },
  );

  /*
   * The project's acknowledged state - where Acknowledge moves the episode:
   * the first from the top flagged acknowledged - and whether a state counts
   * as acknowledged: it, any state placed after it, or a resolved one
   * (Common/Utils/AcknowledgedState). Acknowledge is offered only while the
   * episode is not.
   */
  const ackState: IncidentState | undefined =
    AcknowledgedStateUtil.getAcknowledgedState({
      list: StateListType.IncidentState,
      states: incidentStates,
    }) || undefined;

  const isAcknowledgedStateId: (stateId: string | undefined) => boolean = (
    stateId: string | undefined,
  ): boolean => {
    return AcknowledgedStateUtil.isAcknowledged({
      list: StateListType.IncidentState,
      states: incidentStates,
      stateId: stateId,
    });
  };

  // Where Resolve moves the episode: the project's resolved state.
  const resolvedState: IncidentState | undefined =
    ResolvedStateUtil.getResolvedState({
      list: StateListType.IncidentState,
      states: incidentStates,
    }) || undefined;

  const actions: Array<EventStateAction> = [];

  if (ackState && !isAcknowledgedStateId(currentStateId)) {
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
  } else if (
    resolvedState &&
    !ResolvedStateUtil.isResolved({
      list: StateListType.IncidentState,
      states: incidentStates,
      stateId: currentStateId,
    })
  ) {
    actions.push({
      stateId: resolvedState.id?.toString() || "",
      label: "Resolve",
      icon: IconProp.CheckCircle,
      buttonStyle: ButtonStyleType.PRIMARY,
      id: "episode-resolve-btn",
    });
  }

  const timing: EpisodeTiming = getEpisodeTiming({
    // Older episodes predate declaredAt; they started when they were created.
    startedAt: episode?.declaredAt || episode?.createdAt || undefined,
    resolvedAt: episode?.resolvedAt || undefined,
    list: StateListType.IncidentState,
    states: incidentStates.map((state: IncidentState) => {
      return {
        id: state.id?.toString() || "",
        name: state.name,
        order: state.order,
        isAcknowledgedState: state.isAcknowledgedState,
        isResolvedState: state.isResolvedState,
      };
    }),
    timelines: timelineDates,
  });

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

  /*
   * The modal looks its title, description and button text up; the ones
   * that name the chosen state are filled in here, in the reader's language.
   */
  const selectedStateName: TranslatableTerm = translatableTerm(
    selectedIncidentState?.name || "",
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
    "You are about to mark this episode as {{state}}. This will also update all incidents in this episode.",
    { state: selectedStateName },
  );

  /*
   * What the change does, in a sentence or two; the optional note is the
   * folded "Add a private note" line under it. Acknowledging stops the on-call
   * escalation of the episode and - as it acknowledges its incidents too -
   * of theirs, so the confirm says so.
   */
  /*
   * Acknowledging it: a move into the project's acknowledged state while it
   * is not acknowledged yet. Picking a state placed after Acknowledged
   * ("Investigating") names that state; the acknowledged state picked for a
   * record already acknowledged - in a state after it - is no
   * acknowledgement, only a move back up the list.
   */
  const isAcknowledgeTarget: boolean = Boolean(
    ackState?.id &&
      selectedIncidentState?.id?.toString() === ackState.id.toString() &&
      !isAcknowledgedStateId(currentStateId),
  );

  // A move that resolves it: into a resolved state, from one that is not.
  const isResolveTarget: boolean = Boolean(
    selectedIncidentState &&
      ResolvedStateUtil.isResolved({
        list: StateListType.IncidentState,
        states: incidentStates,
        stateId: selectedIncidentState.id,
      }) &&
      !timing.isResolved,
  );

  if (isAcknowledgeTarget) {
    modalTitle = translationKey("Acknowledge Episode");
    modalSubmitButtonText = translationKey("Acknowledge");
    modalDescription = translationKey(
      "This records an acknowledgement on the episode timeline and also updates all incidents in this episode. Any on-call escalation for the episode and its incidents stops.",
    );
  } else if (isResolveTarget) {
    modalTitle = translationKey("Resolve Episode");
    modalSubmitButtonText = translationKey("Resolve");
    modalDescription = translationKey(
      "This marks the episode as resolved on the episode timeline and also updates all incidents in this episode.",
    );
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
        identifier={
          episode?.episodeNumberWithPrefix ||
          (episode?.episodeNumber ? "#" + episode.episodeNumber : undefined)
        }
        title={episode?.title || translator.translateText("Untitled episode")}
        currentStateId={currentIncidentState?.id?.toString()}
        severity={
          episode?.incidentSeverity
            ? {
                name: episode.incidentSeverity.name || "Unknown",
                color: episode.incidentSeverity.color || Black,
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
            groupingRuleName: episode?.incidentGroupingRule?.name,
            createdByName: getEpisodeCreatorName(
              episode?.createdByUser,
              translator,
            ),
            lastMemberAddedAt: episode?.lastIncidentAddedAt || undefined,
            memberNoun: "incident",
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
          modelType={IncidentEpisodeStateTimeline}
          name={"create-episode-state-timeline"}
          title={modalTitle}
          description={modalDescription}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={modalSubmitButtonText}
          onBeforeCreate={async (model: IncidentEpisodeStateTimeline) => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.incidentEpisodeId = props.episodeId;
            model.incidentStateId = selectedIncidentState!.id!;

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
            modelType: IncidentEpisodeStateTimeline,
            id: "create-episode-state-timeline",
            /*
             * Nothing else decides an episode's state change: just the
             * private note, folded under "Add a private note"
             * (EventView/StateChangeFormFields).
             */
            fields: getStateChangeFormFields<IncidentEpisodeStateTimeline>({
              noteType: BulkStateChangeNoteType.Private,
              noteDescription: translationKey(
                "Post a private note about this state change.",
              ),
              noteTemplates: noteTemplates,
              // Offered only to someone who may post a private note.
              noteModel: new IncidentEpisodeInternalNote(),
            }),
            formType: FormType.Create,
          }}
        />
      )}
    </>
  );
};

export default ChangeEpisodeState;
