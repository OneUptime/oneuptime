import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CallSummaryRootCauseOutcome,
  RootCauseSuggestionStatus,
} from "Common/Types/VideoCall/CallSummary";
import { getVideoCallProviderDisplayName } from "Common/Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptInfo,
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailable,
  VideoCallTranscriptUnavailableReason,
} from "Common/Types/VideoCall/VideoCallTranscript";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AddCallTranscriptModal from "./AddCallTranscriptModal";
import {
  CALL_TRANSCRIPTS_DOCS_PATH,
  CallTranscriptFromProvider,
  getCallTranscriptFromProvider,
  readCallTranscriptAgain,
  removeCallTranscript,
} from "./CallTranscriptApi";
import CallTranscriptModal from "./CallTranscriptModal";
import {
  CallTranscriptReading,
  CallTranscriptView,
  formatCallTranscriptTime,
  getCallTranscriptView,
} from "./CallTranscriptState";
import { videoCallDocsUrl } from "./VideoCallApi";

/*
 * A call's transcript, under the call on the Video Call card (issue #4875).
 *
 * Laid out the same way with or without one: the word Transcript, a line
 * about it, then what can be done. Without one: what a transcript is for,
 * then Get from Zoom or Get from Google Meet for a meeting OneUptime started
 * there (the provider is asked), and Add transcript for any call; nothing
 * at all for a reader who may not add one. With one: how long it is and
 * where it came from, where OneUptime AI's reading of it stands - with that
 * state's one action at the end of its sentence - then View transcript; the
 * menu to replace, read again or remove it is a mark beside the heading.
 * What OneUptime AI found is on the AI Investigation card, which Review it
 * opens.
 *
 * When the provider has no transcript to give - not ready yet, never
 * turned on, a permission the connection lacks - the card says so in one
 * short sentence in the reader's language, with how to set it up where
 * setting up is the fix; the provider's own answer, which names scopes and
 * settings for whoever looks after the connection, is behind Show details.
 * It stays until the person puts it away: an answer, not an error.
 */

export interface ComponentProps {
  call: IncidentVideoCall;
  // "Zoom meeting", or a link's own title.
  callLabel: string;
  // Whether the reader may add, replace and remove transcripts.
  canManage: boolean;
  // A call under "Earlier calls": one line.
  isCompact?: boolean | undefined;
  // Opens what OneUptime AI read, on the AI Investigation card.
  onReview: () => void;
  // The call's transcript or its reading changed: read the calls again.
  onChanged: () => void;
}

const WARNING_REASONS: ReadonlyArray<VideoCallTranscriptUnavailableReason> = [
  VideoCallTranscriptUnavailableReason.PermissionMissing,
  VideoCallTranscriptUnavailableReason.ConnectionProblem,
];

/*
 * A provider's answer, which may name a long scope -
 * "cloud_recording:read:list_recording_files:admin" - in the card's narrow
 * column: it may break after each colon in it rather than mid-word.
 */
function withBreaksAfterColons(text: string): Array<ReactElement> {
  const pieces: Array<string> = text.split(":");

  return pieces.map((piece: string, index: number): ReactElement => {
    return (
      <Fragment key={index}>
        {piece}
        {index < pieces.length - 1 ? (
          <>
            :<wbr />
          </>
        ) : (
          <></>
        )}
      </Fragment>
    );
  });
}

// Answers the docs say how to fix: a scope to add, transcription to turn on.
const SET_UP_REASONS: ReadonlyArray<VideoCallTranscriptUnavailableReason> = [
  VideoCallTranscriptUnavailableReason.PermissionMissing,
  VideoCallTranscriptUnavailableReason.NotTranscribed,
];

/*
 * What the card says when the provider has no transcript to give, by why:
 * one short sentence, in English here and looked up in the reader's
 * language where it is shown, with {{provider}} for "Zoom" or "Google
 * Meet". The provider's own answer is shown under it on request.
 */
export function getTranscriptUnavailableHeadline(
  reason: VideoCallTranscriptUnavailableReason,
): string {
  switch (reason) {
    case VideoCallTranscriptUnavailableReason.NotReady:
      return translationKey(
        "{{provider}} is still preparing this meeting's transcript. Try again in a few minutes.",
      );
    case VideoCallTranscriptUnavailableReason.NotTranscribed:
      return translationKey(
        "{{provider}} kept no transcript of this meeting. Add it yourself, or turn transcripts on for the next call.",
      );
    case VideoCallTranscriptUnavailableReason.NoMeeting:
      return translationKey(
        "{{provider}} has no record of this meeting. If the call just ended, try again in a few minutes.",
      );
    case VideoCallTranscriptUnavailableReason.Expired:
      return translationKey(
        "{{provider}} no longer keeps this meeting's transcript. If you saved a copy, add it yourself.",
      );
    case VideoCallTranscriptUnavailableReason.PermissionMissing:
      return translationKey(
        "The {{provider}} connection is not allowed to read transcripts yet.",
      );
    case VideoCallTranscriptUnavailableReason.ConnectionProblem:
      return translationKey(
        "The {{provider}} connection stopped working. Reconnect it in Project Settings > Workspace > Video Calls.",
      );
    case VideoCallTranscriptUnavailableReason.NotSupported:
    default:
      return translationKey(
        "OneUptime cannot ask {{provider}} for this meeting's transcript. Add it yourself.",
      );
  }
}

export function describeTranscriptLength(
  info: VideoCallTranscriptInfo | null,
  translator: Translator,
): string {
  if (!info) {
    return "";
  }

  const parts: Array<string> = [];

  if (info.durationInSeconds && info.durationInSeconds >= 60) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} minute", other: "{{count}} minutes" },
        Math.round(info.durationInSeconds / 60),
      ),
    );
  }

  if (info.speakerCount > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} speaker", other: "{{count}} speakers" },
        info.speakerCount,
      ),
    );
  }

  if (parts.length === 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} remark", other: "{{count}} remarks" },
        info.lineCount,
      ),
    );
  }

  return parts.join(" · ");
}

const LINK_BUTTON_CLASS_NAME: string =
  "rounded-md font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

/*
 * Where OneUptime AI's reading stands, as one sentence beside its mark: the
 * sentence's one action closes it, in the sentence's own line, so the
 * action sits with the words and never under the mark.
 */
const ReadingLine: FunctionComponent<{
  testId: string;
  mark: ReactElement;
  role?: "status" | undefined;
  children: ReactNode;
}> = (props: {
  testId: string;
  mark: ReactElement;
  role?: "status" | undefined;
  children: ReactNode;
}): ReactElement => {
  return (
    <div
      role={props.role}
      data-testid={props.testId}
      className="flex items-start gap-1.5 text-xs text-gray-600"
    >
      <div className="mt-px flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        {props.mark}
      </div>
      <p className="min-w-0 flex-1 break-words">{props.children}</p>
    </div>
  );
};

const CallTranscriptBlock: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const now: Date = OneUptimeDate.getCurrentDate();
  const view: CallTranscriptView = getCallTranscriptView(props.call, now);
  const [isGetting, setIsGetting] = useState<boolean>(false);
  const [isRereading, setIsRereading] = useState<boolean>(false);
  const [unavailable, setUnavailable] =
    useState<VideoCallTranscriptUnavailable | null>(null);
  const [isShowingDetails, setIsShowingDetails] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [isViewing, setIsViewing] = useState<boolean>(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState<boolean>(false);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);

  const callId: string = props.call.id?.toString() || "";
  const outcomeDetailsId: string = `call-transcript-outcome-details-${callId}`;

  const putAnswerAway: () => void = (): void => {
    setUnavailable(null);
    setIsShowingDetails(false);
    setError(undefined);
  };

  const getFromProvider: () => Promise<void> = async (): Promise<void> => {
    setIsGetting(true);
    putAnswerAway();

    try {
      const result: CallTranscriptFromProvider =
        await getCallTranscriptFromProvider({ callId });

      setIsGetting(false);

      if (result.added) {
        props.onChanged();
        return;
      }

      setUnavailable({ reason: result.reason, message: result.message });
    } catch (err) {
      setIsGetting(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  const readAgain: () => Promise<void> = async (): Promise<void> => {
    setIsRereading(true);
    setError(undefined);

    try {
      await readCallTranscriptAgain({ callId });
      setIsRereading(false);
      props.onChanged();
    } catch (err) {
      setIsRereading(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  const providerName: string = getVideoCallProviderDisplayName(
    props.call.provider,
  );

  // "5 minutes ago", "vor 5 Minuten": in the reader's language.
  const when: (date: Date) => string = (date: Date): string => {
    return formatCallTranscriptTime({
      date,
      language: translator.language,
      now,
    });
  };

  const sourceLine: string = view.addedAt
    ? view.source === VideoCallTranscriptSource.Provider
      ? translator.translateTemplate("Read from {{provider}} {{when}}", {
          provider: providerName,
          when: when(view.addedAt),
        })
      : view.addedByName
        ? translator.translateTemplate("Added by {{name}} {{when}}", {
            name: view.addedByName,
            when: when(view.addedAt),
          })
        : translator.translateTemplate("Added {{when}}", {
            when: when(view.addedAt),
          })
    : "";

  const reviewButton: (
    testId: string,
    text: string | undefined,
  ) => ReactElement = (
    testId: string,
    text: string | undefined,
  ): ReactElement => {
    return (
      <button
        type="button"
        data-testid={testId}
        className={LINK_BUTTON_CLASS_NAME}
        onClick={props.onReview}
      >
        {text}
      </button>
    );
  };

  // Where OneUptime AI's reading stands, in one line with its one action.
  const readingLine: () => ReactElement = (): ReactElement => {
    switch (view.reading) {
      case CallTranscriptReading.Reading:
        return (
          <ReadingLine
            role="status"
            testId="call-transcript-reading"
            mark={
              <span className="h-3 w-3 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
            }
          >
            {translator.translateText("OneUptime AI is reading it…")}
          </ReadingLine>
        );
      case CallTranscriptReading.Stuck:
      case CallTranscriptReading.Failed:
        return (
          <ReadingLine
            testId="call-transcript-read-failed"
            mark={
              <Icon
                icon={IconProp.Alert}
                className="h-3.5 w-3.5 text-red-600"
              />
            }
          >
            <span className="text-gray-700">
              {view.reading === CallTranscriptReading.Stuck
                ? translator.translateText(
                    "OneUptime AI took too long to read it.",
                  )
                : translator.translateText("OneUptime AI could not read it.")}
            </span>
            {view.reading === CallTranscriptReading.Failed &&
            view.readingMessage ? (
              <span className="text-gray-500"> {view.readingMessage}</span>
            ) : (
              <></>
            )}
            {props.canManage ? (
              <>
                {" "}
                <button
                  type="button"
                  data-testid="call-transcript-read-again"
                  disabled={isRereading}
                  className={LINK_BUTTON_CLASS_NAME}
                  onClick={() => {
                    void readAgain();
                  }}
                >
                  {translator.translateText("Try again")}
                </button>
              </>
            ) : (
              <></>
            )}
          </ReadingLine>
        );
      case CallTranscriptReading.Skipped:
        /*
         * Skipped means one thing: AI is off for the project. Said in the
         * reader's language, with the page that turns it back on.
         */
        return (
          <ReadingLine
            testId="call-transcript-read-skipped"
            mark={
              <Icon
                icon={IconProp.Info}
                className="h-3.5 w-3.5 text-gray-400"
              />
            }
          >
            {translator.translateText(
              "AI is off for this project, so OneUptime AI did not read it.",
            )}{" "}
            <Link
              dataTestId="call-transcript-ai-settings"
              className={LINK_BUTTON_CLASS_NAME}
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_AI_FEATURES] as Route,
              )}
            >
              {translator.translateText("Open AI Features")}
            </Link>
          </ReadingLine>
        );
      case CallTranscriptReading.Ready: {
        const isAccepted: boolean =
          view.suggestion === RootCauseSuggestionStatus.Accepted;
        const message: string = isAccepted
          ? translator.translateText("Used as the incident's root cause.") || ""
          : view.suggestion === RootCauseSuggestionStatus.Dismissed
            ? translator.translateText(
                "OneUptime AI's suggested root cause was dismissed.",
              ) || ""
            : view.summary?.rootCause.outcome ===
                CallSummaryRootCauseOutcome.Suggested
              ? translator.translateText(
                  "OneUptime AI suggested a root cause.",
                ) || ""
              : translator.translateText(
                  "OneUptime AI read it: not enough was said to suggest a root cause.",
                ) || "";

        return (
          <ReadingLine
            testId="call-transcript-read"
            mark={
              <Icon
                icon={isAccepted ? IconProp.CheckCircle : IconProp.Sparkles}
                className={`h-3.5 w-3.5 ${
                  isAccepted ? "text-emerald-600" : "text-indigo-500"
                }`}
              />
            }
          >
            {message}{" "}
            {/*
              "Review it", not "Review": several languages word Review and
              View alike, and View transcript is the button under this line.
            */}
            {reviewButton(
              "call-transcript-review",
              view.suggestion === RootCauseSuggestionStatus.Suggested
                ? translator.translateText("Review it")
                : translator.translateText("See what it found"),
            )}
          </ReadingLine>
        );
      }
      default:
        return <></>;
    }
  };

  const outcome: ReactElement =
    unavailable || error ? (
      <div
        role="status"
        data-testid="call-transcript-outcome"
        data-reason={unavailable?.reason || "error"}
        className="mt-3 flex items-start gap-2 text-xs"
      >
        <Icon
          icon={
            error || WARNING_REASONS.includes(unavailable!.reason)
              ? IconProp.Alert
              : IconProp.Info
          }
          className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
            error
              ? "text-red-600"
              : WARNING_REASONS.includes(unavailable!.reason)
                ? "text-amber-500"
                : "text-gray-400"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p
            data-testid="call-transcript-outcome-headline"
            className="break-words text-gray-700"
          >
            {error ||
              translator.translateTemplate(
                getTranscriptUnavailableHeadline(unavailable!.reason),
                { provider: providerName },
              )}
          </p>
          {!error && unavailable ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {SET_UP_REASONS.includes(unavailable.reason) ? (
                <a
                  href={videoCallDocsUrl(CALL_TRANSCRIPTS_DOCS_PATH).toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="call-transcript-set-up-docs"
                  className={LINK_BUTTON_CLASS_NAME}
                >
                  {translator.translateText("How to set it up")}
                </a>
              ) : (
                <></>
              )}
              {unavailable.message ? (
                <button
                  type="button"
                  data-testid="call-transcript-outcome-details-toggle"
                  aria-expanded={isShowingDetails}
                  aria-controls={outcomeDetailsId}
                  className="rounded-md font-medium text-gray-500 hover:text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  onClick={() => {
                    setIsShowingDetails(!isShowingDetails);
                  }}
                >
                  {isShowingDetails
                    ? translator.translateText("Hide details")
                    : translator.translateText("Show details")}
                </button>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
          {!error && unavailable && isShowingDetails ? (
            /*
             * What the provider answered, as the server put it: the scope
             * to add, the setting to turn on. For whoever looks after the
             * connection, so it stays in English.
             */
            <p
              id={outcomeDetailsId}
              data-testid="call-transcript-outcome-details"
              className="mt-1.5 break-words text-gray-500"
            >
              {withBreaksAfterColons(unavailable.message)}
            </p>
          ) : (
            <></>
          )}
        </div>
        <button
          type="button"
          aria-label={translator.translateText("Dismiss")}
          className="-my-0.5 rounded-md p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={putAnswerAway}
        >
          <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : (
      <></>
    );

  const manageMenu: ReactElement =
    props.canManage && view.hasTranscript ? (
      <MoreMenu
        text=""
        menuIcon={IconProp.EllipsisHorizontal}
        ariaLabel={translator.translateTemplate("Transcript of the {{call}}", {
          call: props.callLabel,
        })}
        dataTestId="call-transcript-menu"
        elementToBeShownInsteadOfButton={
          /*
           * A quiet mark at the end of the heading's line, as a card's
           * own menu is: what it holds - replace, read again, remove - is
           * rarely needed. A target of 32px, 36px on a phone.
           */
          <button
            type="button"
            className="-my-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:h-8 md:w-8"
            data-testid="call-transcript-menu-button"
          >
            <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
          </button>
        }
      >
        {[
          <MoreMenuItem
            key="replace"
            text="Replace transcript"
            icon={IconProp.DocumentArrowUp}
            dataTestId="call-transcript-replace"
            onClick={() => {
              setIsAdding(true);
            }}
          />,
          ...(view.reading === CallTranscriptReading.Ready ||
          view.reading === CallTranscriptReading.Skipped
            ? [
                <MoreMenuItem
                  key="read-again"
                  text="Read it again"
                  icon={IconProp.Sparkles}
                  dataTestId="call-transcript-menu-read-again"
                  onClick={() => {
                    void readAgain();
                  }}
                />,
              ]
            : []),
          <MoreMenuItem
            key="remove"
            text="Remove transcript"
            icon={IconProp.Trash}
            isDestructive={true}
            dataTestId="call-transcript-remove"
            onClick={() => {
              setIsConfirmingRemove(true);
            }}
          />,
        ]}
      </MoreMenu>
    ) : (
      <></>
    );

  // "Get from Zoom": the button says where it gets the transcript.
  const getFromProviderTitle: string = translator.translateTemplate(
    "Get from {{provider}}",
    { provider: providerName },
  );

  /*
   * A Button keeps a left margin for a button row of its own; here they sit
   * in a wrapping row with a gap, so the margin goes.
   */
  const getAndAddButtons: ReactElement = props.canManage ? (
    <div className="flex flex-wrap items-center gap-2 [&>button]:ml-0 [&>button]:md:ml-0">
      {view.canGetFromProvider ? (
        <Button
          title={getFromProviderTitle}
          icon={IconProp.DocumentArrowDown}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          isLoading={isGetting}
          dataTestId="call-transcript-get"
          onClick={() => {
            void getFromProvider();
          }}
        />
      ) : (
        <></>
      )}
      <Button
        title="Add transcript"
        icon={IconProp.DocumentPlus}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        dataTestId="call-transcript-add"
        onClick={() => {
          setIsAdding(true);
        }}
      />
    </div>
  ) : (
    <></>
  );

  // The heading both states start with.
  const heading: ReactElement = (
    <p
      data-testid="call-transcript-heading"
      className="min-w-0 break-words text-sm font-medium text-gray-900"
    >
      {translator.translateText("Transcript")}
    </p>
  );

  let content: ReactElement;

  if (props.isCompact) {
    content = view.hasTranscript ? (
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
        <Icon icon={IconProp.DocumentText} className="h-3.5 w-3.5" />
        <span>
          {translator.translateText("Transcript")}
          {view.info
            ? ` · ${describeTranscriptLength(view.info, translator)}`
            : ""}
        </span>
        <button
          type="button"
          data-testid="call-transcript-view"
          className={`${LINK_BUTTON_CLASS_NAME} text-xs`}
          onClick={() => {
            setIsViewing(true);
          }}
        >
          {translator.translateText("View")}
        </button>
        {view.reading === CallTranscriptReading.Ready ? (
          <button
            type="button"
            data-testid="call-transcript-review"
            className={`${LINK_BUTTON_CLASS_NAME} text-xs`}
            onClick={props.onReview}
          >
            {translator.translateText("See what it found")}
          </button>
        ) : (
          <></>
        )}
      </div>
    ) : props.canManage ? (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
        {view.canGetFromProvider ? (
          <button
            type="button"
            data-testid="call-transcript-get"
            disabled={isGetting}
            className={`${LINK_BUTTON_CLASS_NAME} text-xs`}
            onClick={() => {
              void getFromProvider();
            }}
          >
            {isGetting
              ? translator.translateText("Getting the transcript…")
              : getFromProviderTitle}
          </button>
        ) : (
          <></>
        )}
        <button
          type="button"
          data-testid="call-transcript-add"
          className={`${LINK_BUTTON_CLASS_NAME} text-xs`}
          onClick={() => {
            setIsAdding(true);
          }}
        >
          {translator.translateText("Add transcript")}
        </button>
      </div>
    ) : (
      <></>
    );
  } else if (view.hasTranscript) {
    /*
     * The card sits in the page's narrow column, where "Transkription"
     * beside two buttons had room for "Tran…" only. The heading shares its
     * line with the transcript's menu alone - a narrow mark at the far
     * end - and View transcript sits under what is said about the
     * transcript, as Get and Add sit under the words without one, with
     * room for "Открыть расшифровку" on one line. On a phone it runs the
     * row's width, as Join call does.
     */
    const facts: string = [
      describeTranscriptLength(view.info, translator),
      sourceLine,
    ]
      .filter((fact: string): boolean => {
        return fact.length > 0;
      })
      .join(" · ");

    content = (
      <div className="space-y-2">
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            {heading}
            {manageMenu}
          </div>
          {facts ? (
            <p
              data-testid="call-transcript-facts"
              className="text-xs text-gray-500"
            >
              {facts}
            </p>
          ) : (
            <></>
          )}
        </div>
        {readingLine()}
        <div
          data-testid="call-transcript-actions"
          className="pt-0.5 [&>button]:ml-0 [&>button]:md:ml-0"
        >
          <Button
            title="View transcript"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="call-transcript-view"
            onClick={() => {
              setIsViewing(true);
            }}
          />
        </div>
      </div>
    );
  } else {
    content = (
      <div className="space-y-3">
        <div className="space-y-0.5">
          {heading}
          <p className="text-xs text-gray-500">
            {translator.translateText(
              "Add it after the call: OneUptime AI reads it and suggests the root cause, for you to review.",
            )}
          </p>
        </div>
        {getAndAddButtons}
      </div>
    );
  }

  /*
   * Without a transcript, and without permission to add one, there is
   * nothing to read and nothing to do: no "Add it after the call" for a
   * reader who cannot, and no hairline over an empty block.
   */
  if (!view.hasTranscript && !props.canManage) {
    return <></>;
  }

  return (
    <Fragment>
      <div
        data-testid="call-transcript-block"
        className={props.isCompact ? "" : "mt-4 border-t border-gray-100 pt-4"}
      >
        {content}
        {outcome}
      </div>

      {isAdding ? (
        <AddCallTranscriptModal
          callId={props.call.id!}
          callLabel={props.callLabel}
          provider={props.call.provider}
          isReplacing={view.hasTranscript}
          onClose={() => {
            setIsAdding(false);
          }}
          onAdded={() => {
            setIsAdding(false);
            putAnswerAway();
            props.onChanged();
          }}
        />
      ) : (
        <></>
      )}

      {isViewing ? (
        <CallTranscriptModal
          callId={props.call.id!}
          callLabel={props.callLabel}
          onClose={() => {
            setIsViewing(false);
          }}
        />
      ) : (
        <></>
      )}

      {isConfirmingRemove ? (
        <ConfirmModal
          title="Remove the transcript?"
          description={translator.translateTemplate(
            "The transcript of the {{call}} and what OneUptime AI read in it are removed from this incident. The incident's root cause is kept.",
            { call: props.callLabel },
          )}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={removeError}
          onClose={() => {
            setIsConfirmingRemove(false);
            setRemoveError(undefined);
          }}
          onSubmit={async () => {
            setIsRemoving(true);
            setRemoveError(undefined);

            try {
              await removeCallTranscript({ callId });
              setIsRemoving(false);
              setIsConfirmingRemove(false);
              props.onChanged();
            } catch (err) {
              setIsRemoving(false);
              setRemoveError(API.getFriendlyErrorMessage(err as Error));
            }
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default CallTranscriptBlock;
