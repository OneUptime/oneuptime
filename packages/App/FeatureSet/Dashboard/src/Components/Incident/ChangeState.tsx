import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
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
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EventStatusPanel, {
  EventPanelAction,
  EventStateAction,
  EventStateItem,
  EventStatusFact,
} from "../EventView/EventStatusPanel";
import { getStateChangeFormFields } from "../EventView/StateChangeFormFields";
import EventHeaderSkeleton from "../EventView/EventHeaderSkeleton";
import {
  BulkStateChangeNoteType,
  toBulkStateChangeNoteTemplate,
} from "../../Utils/BulkStateChange";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import {
  fillNoteTemplate,
  NoteTemplateVariables,
} from "Common/Utils/Incident/IncidentNoteTemplateVariables";
import { fetchIncidentNoteTemplateVariables } from "./IncidentNoteTemplateVariables";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIInvestigationHeaderStatus, {
  AIInvestigationStatusLiveRegion,
} from "../AI/AIInvestigationHeaderStatus";
import {
  scrollToAIInvestigationPanel,
  shouldShowAIInvestigationHeaderStatus,
} from "../AI/AIInvestigationStatus";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import { StateListType } from "Common/Utils/StateOrder";
import { getEventEndDateForCurrentState } from "../../Utils/EventDuration";
import {
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  incidentId: ObjectID;
  onActionComplete: () => void;
  eventNumber?: string | undefined;
  title?: string | undefined;
  eventStartsAt?: Date | undefined;
  severity?: { name: string; color: Color } | undefined;
  isPrivate?: boolean | undefined;
  /*
   * Where "Notify Status Page Subscribers" starts in the state change form,
   * which also decides whether its public note notifies. False when the
   * incident was declared without notifying subscribers.
   */
  notifyStatusPageSubscribersByDefault?: boolean | undefined;
  aiInvestigationStatus?: AIRunStatus | null | undefined;
  /*
   * The completed investigation's TL;DR (or summary) as plain text. With a
   * Completed status it turns the header notice into the report's summary.
   */
  aiInvestigationSummary?: string | null | undefined;
  /*
   * A responder's Confirmed / Rejected verdict on that report, shown as a
   * badge beside it.
   */
  aiInvestigationVerdict?: AIRunHumanVerdict | null | undefined;
  // Context shown under the header pills ("Declared", "Declared by", ...).
  facts?: Array<EventStatusFact> | undefined;
  /*
   * Actions beside the state actions that change no state - Join call, when
   * the incident has a video call.
   */
  secondaryActions?: Array<EventPanelAction> | undefined;
  /*
   * Bump to read the incident's state again after it changed somewhere other
   * than this header - acknowledged by somebody else while the reader's
   * Escalate dialog asked (the dialog's onRecordChanged). The header stays
   * on screen while it reads.
   */
  refreshToken?: number | undefined;
}

/*
 * Holds the header's place while its states and timeline load, drawn as the
 * loaded header is (EventHeaderSkeleton): Acknowledge and Resolve, and how
 * long, the commander, the owners and the monitors.
 */
export const IncidentStatePlaceholder: FunctionComponent = (): ReactElement => {
  return (
    <EventHeaderSkeleton
      testId="incident-state-placeholder"
      loadingText="Loading incident status"
      buttonCount={2}
      factCount={4}
    />
  );
};

const ChangeIncidentState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);

  const notifySubscribersByDefault: boolean =
    props.notifyStatusPageSubscribersByDefault ?? true;

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

  /*
   * The values for a note template's {{incident.title}}-style placeholders,
   * read as the state change form opens (and only when there is a template
   * to pick), so a template picked there goes in filled. Until they arrive,
   * or if they cannot be read, a template goes in as written.
   */
  const [noteTemplateVariables, setNoteTemplateVariables] =
    useState<NoteTemplateVariables>({});

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
          order: true,
          isArchived: true,
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

  const lastRefreshTokenRef: MutableRefObject<number | undefined> = useRef<
    number | undefined
  >(props.refreshToken);

  // Read the state again, quietly, when the page says it changed.
  useEffect(() => {
    if (lastRefreshTokenRef.current === props.refreshToken) {
      return;
    }

    lastRefreshTokenRef.current = props.refreshToken;

    fetchIncidentStateTimelines().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.refreshToken]);

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

  /*
   * The project's acknowledged state - where Acknowledge moves the incident:
   * the first from the top flagged acknowledged - and whether a state counts
   * as acknowledged: it, any state placed after it, or a resolved one
   * (Common/Utils/AcknowledgedState). Acknowledge is offered only while the
   * incident is not.
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

  /*
   * The project's resolved state - where Resolve moves the incident - and
   * every state that counts as resolved: it and any state placed after it
   * (Common/Utils/ResolvedState).
   */
  const resolvedState: IncidentState | undefined =
    ResolvedStateUtil.getResolvedState({
      list: StateListType.IncidentState,
      states: incidentStates,
    }) || undefined;

  const resolvedStateIds: Array<string> = ResolvedStateUtil.getResolvedStateIds(
    {
      list: StateListType.IncidentState,
      states: incidentStates,
    },
  ).map((stateId: ObjectID) => {
    return stateId.toString();
  });

  const isResolvedStateId: (stateId: string | undefined) => boolean = (
    stateId: string | undefined,
  ): boolean => {
    return Boolean(stateId && resolvedStateIds.includes(stateId));
  };

  const currentStateId: string | undefined =
    currentIncidentState?.id?.toString();

  const actions: Array<EventStateAction> = [];

  if (ackState && !isAcknowledgedStateId(currentStateId)) {
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
  } else if (resolvedState && !isResolvedStateId(currentStateId)) {
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
  let durationPrefix: string = translationKey("Ongoing for");

  /*
   * Resolved now - in the resolved state, or a state placed after it: the
   * duration runs to when it was resolved this time.
   */
  const resolvedAt: Date | undefined = getEventEndDateForCurrentState(
    incidentStateTimelines.map((timeline: IncidentStateTimeline) => {
      return {
        stateId: timeline.incidentStateId?.toString(),
        startsAt: timeline.startsAt,
      };
    }),
    resolvedStateIds,
  );

  if (resolvedAt) {
    durationEndsAt = resolvedAt;
    /*
     * "Lasted", not "Resolved in": this runs to the CURRENT resolution,
     * while the stat bar's "Resolved in" counts to the FIRST one, so a
     * reopened incident would show one label with two different numbers.
     */
    durationPrefix = translationKey("Lasted");
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

    if (incidentNoteTemplates.length > 0) {
      loadNoteTemplateVariables();
    }
  };

  const loadNoteTemplateVariables: PromiseVoidFunction =
    async (): Promise<void> => {
      // Never the values of an earlier opening: the incident may have moved on.
      setNoteTemplateVariables({});

      try {
        setNoteTemplateVariables(
          await fetchIncidentNoteTemplateVariables(props.incidentId),
        );
      } catch {
        // The template goes in as written.
      }
    };

  /*
   * The modal looks its title, description and button text up; the ones
   * that name the chosen state are filled in here, in the reader's language.
   */
  const selectedStateName: TranslatableTerm = translatableTerm(
    selectedIncidentState?.name || "",
  );

  let modalTitle: string = translator.translateTemplate(
    "Mark Incident as {{state}}",
    { state: selectedStateName },
  );
  let modalSubmitButtonText: string = translator.translateTemplate(
    "Mark as {{state}}",
    { state: selectedStateName },
  );
  let modalDescription: string = translator.translateTemplate(
    "You are about to mark this incident as {{state}}.",
    { state: selectedStateName },
  );

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
  const isResolveTarget: boolean =
    isResolvedStateId(selectedIncidentState?.id?.toString()) &&
    !isResolvedStateId(currentStateId);

  /*
   * One sentence on what the change does. The optional note is not
   * mentioned: it is the folded "Add a public note" line right under it.
   * Acknowledging is what stops the incident's on-call escalation
   * (Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions),
   * so the confirm says so.
   */
  if (isAcknowledgeTarget) {
    modalTitle = translationKey("Acknowledge Incident");
    modalSubmitButtonText = translationKey("Acknowledge");
    modalDescription = translationKey(
      "This records an acknowledgement on the incident timeline and stops any on-call escalation for this incident.",
    );
  } else if (isResolveTarget) {
    modalTitle = translationKey("Resolve Incident");
    modalSubmitButtonText = translationKey("Resolve");
    modalDescription = translationKey(
      "This marks the incident as resolved on the incident timeline.",
    );
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
            order: state.order,
            isArchived: Boolean(state.isArchived),
          };
        })}
        stateList={StateListType.IncidentState}
        /*
         * A state change is a new row on the state timeline: someone who
         * may not add one sees the buttons locked, each saying why - in
         * the words of what they pressed, not the timeline's.
         */
        stateChangeGate={PermissionGate.check(
          new IncidentStateTimeline(),
          ModelAction.Create,
          {
            sentence: translationKey(
              "You do not have permission to change this incident's state.",
            ),
          },
        )}
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
        secondaryActions={props.secondaryActions}
        facts={props.facts}
        headerNoticeTone="ai"
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
          modelType={IncidentStateTimeline}
          name={"create-incident-state-timeline"}
          title={modalTitle}
          description={modalDescription}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={modalSubmitButtonText}
          /*
           * Seeded as a value, not only as the field's default: the form
           * drops a false default, and an unsent flag would fall back to
           * notifying. A private incident reaches no subscriber, and is not
           * asked about them: it notifies nobody.
           */
          initialValues={{
            shouldStatusPageSubscribersBeNotified: props.isPrivate
              ? false
              : notifySubscribersByDefault,
          }}
          onBeforeCreate={async (model: IncidentStateTimeline) => {
            const projectId: ObjectID | undefined | null =
              ProjectUtil.getCurrentProject()?.id;

            if (!projectId) {
              throw new BadDataException("ProjectId not found.");
            }

            model.projectId = projectId;
            model.incidentId = props.incidentId;
            model.incidentStateId = selectedIncidentState!.id!;

            /*
             * A private incident's dialog has no notify box, and the form
             * sends no value for a field it does not show - the seeded false
             * above included - so the column's default (notify) would be
             * recorded. Said here, as the Change State bulk action says it:
             * a private incident notifies nobody.
             */
            if (props.isPrivate) {
              model.shouldStatusPageSubscribersBeNotified = false;
            }

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
            /*
             * "Notify Status Page Subscribers", then the public note folded
             * under "Add a public note" (EventView/StateChangeFormFields). A
             * picked template's {{incident.*}} placeholders are filled with
             * this incident's values.
             *
             * A private incident takes no public notes and reaches no status
             * page subscriber (Common/Types/StatusPage/PrivateRecordPublicNotes):
             * its dialog folds a private note under "Add a private note", as
             * an alert's does, and asks nothing about subscribers.
             */
            fields: getStateChangeFormFields<IncidentStateTimeline>({
              ...(props.isPrivate
                ? {
                    noteType: BulkStateChangeNoteType.Private,
                    noteDescription: translationKey(
                      "Post a private note about this state change.",
                    ),
                    // Offered only to someone who may post a private note.
                    noteModel: new IncidentInternalNote(),
                  }
                : {
                    noteType: BulkStateChangeNoteType.Public,
                    noteDescription: translationKey(
                      "Post a public note about this state change to the status page.",
                    ),
                    notifySubscribers: {
                      byDefault: notifySubscribersByDefault,
                      quietDescription:
                        PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
                    },
                    // Offered only to someone who may post a public note.
                    noteModel: new IncidentPublicNote(),
                  }),
              noteTemplates: incidentNoteTemplates.map(
                toBulkStateChangeNoteTemplate,
              ),
              fillTemplate: (note: string): string => {
                return fillNoteTemplate(note, noteTemplateVariables);
              },
            }),
            formType: FormType.Create,
          }}
        />
      )}
    </>
  );
};

export default ChangeIncidentState;
