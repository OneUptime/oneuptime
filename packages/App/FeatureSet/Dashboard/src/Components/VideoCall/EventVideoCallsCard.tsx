import AlertVideoCall from "Common/Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { getLineDirection } from "Common/UI/Utils/LineDirection";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "Common/UI/Utils/PrivateRecordScope";
import {
  TranslatableTerm,
  Translator,
  formatInline,
  getInlineSeparator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { scrollToAIInvestigationPanel } from "../AI/AIInvestigationStatus";
import CallTranscriptBlock from "./CallTranscriptBlock";
import {
  formatCallTranscriptTime,
  getCallSummarySectionId,
} from "./CallTranscriptState";
import StartVideoCallModal from "./StartVideoCallModal";
import { EventVideoCall, VideoCallEventKind } from "./useEventVideoCalls";
import { getOpenableJoinUrl } from "./VideoCallJoinLink";
import VideoCallProviderLogo, {
  getDisplayedVideoCallProvider,
} from "./VideoCallProviderLogo";

/*
 * The incident's (or alert's) calls, on its page: the newest first and
 * largest, with a Join button that opens it, then any earlier ones. A
 * responder who may start calls can start one here - a new meeting, the
 * Slack huddle or a link of their own - and remove one that is no longer
 * used.
 */

export interface ComponentProps {
  kind: VideoCallEventKind;
  eventId: ObjectID;
  calls: Array<EventVideoCall>;
  // Whether the calls of this event have been read once.
  hasLoaded: boolean;
  error?: string | undefined;
  // A call was started or removed: refresh the calls and the feed.
  onChanged: () => void;
  onRetry: () => void;
  /*
   * Opens what OneUptime AI read in a call's transcript, on the AI
   * Investigation card. Scrolls to the call's section there when not given.
   */
  onReviewCallSummary?: ((callId: string) => void) | undefined;
}

/*
 * Brings a call's section of the AI Investigation card into view - the
 * whole card while the section is not there yet - and moves the focus to it.
 */
export function scrollToCallSummary(callId: string): void {
  const section: HTMLElement | null = document.getElementById(
    getCallSummarySectionId(callId),
  );

  if (!section) {
    scrollToAIInvestigationPanel();
    return;
  }

  const prefersReducedMotion: boolean =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  section.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
  section.focus({ preventScroll: true });
}

/*
 * What a call is called on the page, in English; the card shows it through
 * the translator. A link of one's own is called by its title, a standing
 * link by its connection's name, and a meeting by its provider.
 */
export function getVideoCallHeadline(call: EventVideoCall): string {
  if (call.provider === VideoCallProvider.CustomLink && call.title) {
    return call.title;
  }

  switch (getDisplayedVideoCallProvider(call.provider, call.joinUrl)) {
    case VideoCallProvider.Zoom:
      return translationKey("Zoom meeting");
    case VideoCallProvider.GoogleMeet:
      return translationKey("Google Meet call");
    case VideoCallProvider.MicrosoftTeams:
      return translationKey("Microsoft Teams meeting");
    case VideoCallProvider.SlackHuddle:
      return translationKey("Slack huddle");
    default:
      return (
        call.videoCallConnection?.name ||
        call.title ||
        translationKey("Video call")
      );
  }
}

// The line under a call that says who started it and when: one line of text.
export const EVENT_VIDEO_CALL_STARTED_LINE_CLASS_NAME: string =
  "mt-0.5 truncate text-xs text-gray-500";

/*
 * The same line when the name in it reads the other way from the page: a
 * row of boxes on one line, in the page's direction. The words around the
 * name and the time keep their width; the name gives way (min-w-0) and is
 * cut short at its own end.
 */
export const EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME: string =
  "mt-0.5 flex min-w-0 overflow-hidden whitespace-nowrap text-xs text-gray-500";

export const EVENT_VIDEO_CALL_STARTER_NAME_CLASS_NAME: string =
  "min-w-0 truncate";

/*
 * A piece of that row's words - "Started by ", " · 3 minutes ago" - as a
 * box that keeps its width and its spaces (a flex row drops the spaces at
 * the ends of loose text), so the line still has a space between its
 * words, and its text reads as one sentence to a screen reader.
 */
export const EVENT_VIDEO_CALL_STARTED_ROW_TEXT_CLASS_NAME: string =
  "shrink-0 whitespace-pre";

function renderStartedRowText(text: string): ReactElement {
  return (
    <span className={EVENT_VIDEO_CALL_STARTED_ROW_TEXT_CLASS_NAME}>{text}</span>
  );
}

interface CallRowProps {
  call: EventVideoCall;
  isPrimary: boolean;
  canRemove: boolean;
  onRemove: () => void;
  /*
   * An incident's call keeps its transcript (issue #4875): shown under the
   * call, with what may be done with it. An alert's call has none.
   */
  transcript?:
    | {
        canManage: boolean;
        onReview: () => void;
        onChanged: () => void;
      }
    | undefined;
}

const CallRow: FunctionComponent<CallRowProps> = (
  props: CallRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const call: EventVideoCall = props.call;
  const joinUrl: string = call.joinUrl || "";
  // No Join link for a link that is not an http or https address.
  const openableJoinUrl: string | undefined = getOpenableJoinUrl(joinUrl);

  // The person who started it: their name, or their email without one.
  const starterName: string = call.workspaceNotificationRuleId
    ? ""
    : call.createdByUser?.name?.toString() ||
      call.createdByUser?.email?.toString() ||
      "";

  /*
   * Who started it. A person's name is set apart from the sentence
   * (setsValuesApart): an English name in an Arabic or Persian sentence
   * keeps its own order and its punctuation, and the time after it stays
   * where the sentence puts it.
   */
  const startedBy: string = call.workspaceNotificationRuleId
    ? translator.translateText("Started automatically by a workspace rule") ||
      ""
    : starterName
      ? translator.translateTemplate(
          "Started by {{name}}",
          { name: starterName },
          { setsValuesApart: true },
        )
      : translator.translateText("Started from the API") || "";

  /*
   * A name that reads the other way from the page - an English name on an
   * Arabic or Persian page. Inside the sentence's one line, cut short where
   * the card ends, such a name lost its start: that line ends at the left,
   * where an English name starts ("...SRE, EU West on-call)"). So the line
   * is drawn as a row of boxes instead, and the name is a box of its own
   * that reads its way and is cut at its own end ("Maya Chen-Rodriguez
   * (Pla...").
   */
  const starterNameDirection: string | undefined = starterName
    ? getLineDirection(starterName, translator.language)
    : undefined;

  // "5 minutes ago" in the reader's language, as the transcript's line says it.
  const startedAt: string = call.createdAt
    ? formatCallTranscriptTime({
        date: OneUptimeDate.fromString(call.createdAt),
        language: translator.language,
        now: OneUptimeDate.getCurrentDate(),
      })
    : "";

  const isHuddle: boolean = call.provider === VideoCallProvider.SlackHuddle;

  const transcriptBlock: ReactElement = props.transcript ? (
    <CallTranscriptBlock
      call={call as IncidentVideoCall}
      callLabel={
        translator.translateText(getVideoCallHeadline(call)) ||
        getVideoCallHeadline(call)
      }
      canManage={props.transcript.canManage}
      isCompact={!props.isPrimary}
      onReview={props.transcript.onReview}
      onChanged={props.transcript.onChanged}
    />
  ) : (
    <></>
  );

  return (
    <li
      data-testid="event-video-call"
      className={
        props.isPrimary
          ? "rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          : "py-3"
      }
    >
      <div className="flex items-start gap-3">
        <VideoCallProviderLogo
          provider={call.provider}
          joinUrl={joinUrl}
          size={props.isPrimary ? "lg" : "md"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">
            {translator.translateText(getVideoCallHeadline(call))}
          </p>
          {props.isPrimary &&
            call.title &&
            call.provider !== VideoCallProvider.CustomLink && (
              /*
               * The meeting's own title, cut short at its own end
               * (IsolatedLine): an English one on an Arabic page lost its
               * start.
               */
              <IsolatedLine
                as="p"
                text={call.title}
                className="truncate text-sm text-gray-600"
                title={call.title}
                dataTestId="event-video-call-title"
              />
            )}
          {/*
           * Who started it and when, set off from each other as the
           * reader's language does (formatInline): a bullet beside
           * Persian digits, whose zero is a dot.
           */}
          {starterNameDirection ? (
            <p
              className={EVENT_VIDEO_CALL_STARTED_ROW_CLASS_NAME}
              data-testid="event-video-call-started"
            >
              <TranslatedSentence
                template="Started by {{name}}"
                slots={{
                  name: (
                    <IsolatedLine
                      as="span"
                      text={starterName}
                      className={EVENT_VIDEO_CALL_STARTER_NAME_CLASS_NAME}
                      title={starterName}
                      dataTestId="event-video-call-started-by-name"
                    />
                  ),
                }}
                renderText={renderStartedRowText}
              />
              {startedAt
                ? renderStartedRowText(
                    `${getInlineSeparator(translator.language)}${startedAt}`,
                  )
                : null}
            </p>
          ) : (
            <p
              className={EVENT_VIDEO_CALL_STARTED_LINE_CLASS_NAME}
              data-testid="event-video-call-started"
            >
              {startedAt
                ? formatInline([startedBy, startedAt], translator)
                : startedBy}
            </p>
          )}
          {props.isPrimary ? <></> : transcriptBlock}
        </div>
        {!props.isPrimary && openableJoinUrl && (
          <a
            href={openableJoinUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="event-video-call-join-secondary"
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
          >
            {translator.translateText(isHuddle ? "Join huddle" : "Join")}
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {props.isPrimary && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {openableJoinUrl && (
            <a
              href={openableJoinUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="event-video-call-join"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <Icon icon={IconProp.VideoCamera} className="h-4 w-4" />
              {translator.translateText(isHuddle ? "Join huddle" : "Join call")}
            </a>
          )}
          {/*
            Copy link and Remove wrap as one: when the row is too narrow
            for all three, Join call takes its line and the two go under
            it, never Remove on a line of its own.
          */}
          <div
            data-testid="event-video-call-secondary-actions"
            className="flex flex-shrink-0 items-center gap-2"
          >
            <CopyTextButton
              textToBeCopied={joinUrl}
              label="Copy link"
              size="md"
              variant="soft"
            />
            {props.canRemove && (
              <Button
                title="Remove"
                icon={IconProp.Trash}
                buttonStyle={ButtonStyleType.ICON}
                buttonSize={ButtonSize.Small}
                ariaLabel={translator.translateText("Remove this call")}
                tooltip={translator.translateText(
                  "Remove this call from the page. The meeting itself is not deleted.",
                )}
                onClick={props.onRemove}
              />
            )}
          </div>
        </div>
      )}

      {props.isPrimary ? transcriptBlock : <></>}
    </li>
  );
};

const EventVideoCallsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [callToRemove, setCallToRemove] = useState<EventVideoCall | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);

  const model: IncidentVideoCall | AlertVideoCall =
    props.kind === VideoCallEventKind.Incident
      ? new IncidentVideoCall()
      : new AlertVideoCall();

  /*
   * On a private incident or alert, its calls are started, read again and
   * removed only through a team of the reader's that owns it
   * (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(model);

  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
    privateRecordOptions,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Delete,
    privateRecordOptions,
  );

  // Filled into the sentences below in the reader's language.
  const eventNoun: TranslatableTerm = translatableTerm(
    props.kind === VideoCallEventKind.Incident ? "incident" : "alert",
    { inSentence: true },
  );

  const [primary, ...earlier] = props.calls;

  // An incident's calls keep their transcripts; an alert's do not (yet).
  const transcriptOf: (call: EventVideoCall) => CallRowProps["transcript"] = (
    call: EventVideoCall,
  ): CallRowProps["transcript"] => {
    if (props.kind !== VideoCallEventKind.Incident) {
      return undefined;
    }

    const callId: string = call.id?.toString() || "";

    return {
      canManage: createGate.isAllowed,
      onReview: () => {
        if (props.onReviewCallSummary) {
          props.onReviewCallSummary(callId);
          return;
        }

        scrollToCallSummary(callId);
      },
      onChanged: props.onChanged,
    };
  };

  let body: ReactElement;

  if (!props.hasLoaded && props.calls.length === 0) {
    body = <ComponentLoader />;
  } else if (props.error) {
    body = (
      <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
    );
  } else if (!primary) {
    /*
     * Most events never get a call, so the empty card is one quiet row
     * rather than a panel that pushes the details down. The button goes
     * under the words whenever the row is too narrow for both - the column
     * beside an event's details is, on a 1280px screen - rather than
     * squeezing them to a word a line.
     */
    body = (
      <div
        data-testid="event-video-calls-empty"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-3"
      >
        <div className="flex min-w-0 grow basis-44 items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Icon icon={IconProp.VideoCamera} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {translator.translateText("No call yet")}
            </p>
            <p className="text-xs text-gray-500">
              {translator.translateTemplate(
                "Start a dedicated call so the {{eventNoun}}'s responders can talk it through.",
                { eventNoun },
              )}
            </p>
          </div>
        </div>
        {createGate.isAllowed && (
          <div className="flex-shrink-0">
            <Button
              title="Start call"
              icon={IconProp.VideoCamera}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId="event-video-call-start"
              onClick={() => {
                setIsStarting(true);
              }}
            />
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-2">
        <ul>
          <CallRow
            call={primary}
            isPrimary={true}
            canRemove={deleteGate.isAllowed}
            onRemove={() => {
              setCallToRemove(primary);
            }}
            transcript={transcriptOf(primary)}
          />
        </ul>
        {earlier.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText("Earlier calls")}
            </p>
            <ul className="divide-y divide-gray-100">
              {earlier.map((call: EventVideoCall): ReactElement => {
                return (
                  <CallRow
                    key={call.id?.toString()}
                    call={call}
                    isPrimary={false}
                    canRemove={false}
                    onRemove={() => {}}
                    transcript={transcriptOf(call)}
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title="Video Call"
        description={
          props.kind === VideoCallEventKind.Incident
            ? "Where this incident's responders talk it through."
            : "Where this alert's responders talk it through."
        }
        headerLayout="stacked"
        buttons={
          primary && createGate.isAllowed
            ? [
                {
                  title: "Start another",
                  icon: IconProp.Add,
                  buttonStyle: ButtonStyleType.NORMAL,
                  onClick: () => {
                    setIsStarting(true);
                  },
                },
              ]
            : []
        }
      >
        <div data-testid="event-video-calls-card">{body}</div>
      </Card>

      {isStarting && (
        <StartVideoCallModal
          kind={props.kind}
          eventId={props.eventId}
          onClose={() => {
            setIsStarting(false);
          }}
          onStarted={() => {
            setIsStarting(false);
            props.onChanged();
          }}
        />
      )}

      {callToRemove && (
        <ConfirmModal
          title="Remove this call?"
          description={translator.translateTemplate(
            "“{{call}}” is removed from this {{eventNoun}}'s page. The meeting itself is not deleted, and anyone with the link can still join it.",
            {
              call:
                translator.translateText(getVideoCallHeadline(callToRemove)) ||
                getVideoCallHeadline(callToRemove),
              eventNoun,
            },
          )}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={removeError}
          onClose={() => {
            setCallToRemove(null);
            setRemoveError(undefined);
          }}
          onSubmit={async () => {
            setIsRemoving(true);
            setRemoveError(undefined);

            try {
              if (props.kind === VideoCallEventKind.Incident) {
                await ModelAPI.deleteItem<IncidentVideoCall>({
                  modelType: IncidentVideoCall,
                  id: callToRemove.id!,
                });
              } else {
                await ModelAPI.deleteItem<AlertVideoCall>({
                  modelType: AlertVideoCall,
                  id: callToRemove.id!,
                });
              }

              setIsRemoving(false);
              setCallToRemove(null);
              props.onChanged();
            } catch (err) {
              setIsRemoving(false);
              setRemoveError(API.getFriendlyErrorMessage(err as Error));
            }
          }}
        />
      )}
    </Fragment>
  );
};

export default EventVideoCallsCard;
