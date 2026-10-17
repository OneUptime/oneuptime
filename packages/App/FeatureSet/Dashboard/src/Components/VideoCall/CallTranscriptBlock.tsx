import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CallSummaryRootCauseOutcome,
  RootCauseSuggestionStatus,
} from "Common/Types/VideoCall/CallSummary";
import {
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
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
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement, useState } from "react";
import AddCallTranscriptModal from "./AddCallTranscriptModal";
import {
  CallTranscriptFromProvider,
  getCallTranscriptFromProvider,
  readCallTranscriptAgain,
  removeCallTranscript,
} from "./CallTranscriptApi";
import CallTranscriptModal from "./CallTranscriptModal";
import {
  CallTranscriptReading,
  CallTranscriptView,
  getCallTranscriptView,
} from "./CallTranscriptState";

/*
 * A call's transcript, under the call on the Video Call card (issue #4875).
 *
 * Without one: what a transcript is for, and how to get it - Get transcript
 * for a Zoom or Google Meet meeting OneUptime started (its provider is
 * asked), Add transcript for any call. With one: how long it is, where it
 * came from, where OneUptime AI's reading of it stands, and View. What
 * OneUptime AI found is on the AI Investigation card, which Review opens.
 *
 * What the provider says when there is no transcript to read - not ready
 * yet, never turned on, a permission the connection lacks - is shown under
 * the buttons until the person dismisses it: an answer, not an error.
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

const CallTranscriptBlock: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const view: CallTranscriptView = getCallTranscriptView(
    props.call,
    OneUptimeDate.getCurrentDate(),
  );
  const [isGetting, setIsGetting] = useState<boolean>(false);
  const [isRereading, setIsRereading] = useState<boolean>(false);
  const [unavailable, setUnavailable] =
    useState<VideoCallTranscriptUnavailable | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [isViewing, setIsViewing] = useState<boolean>(false);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState<boolean>(false);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);

  const callId: string = props.call.id?.toString() || "";

  const getFromProvider: () => Promise<void> = async (): Promise<void> => {
    setIsGetting(true);
    setUnavailable(null);
    setError(undefined);

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

  const sourceLine: string = view.addedAt
    ? view.source === VideoCallTranscriptSource.Provider
      ? translator.translateTemplate("Read from {{provider}} {{when}}", {
          provider: providerName,
          when: OneUptimeDate.fromNow(view.addedAt),
        })
      : view.addedByName
        ? translator.translateTemplate("Added by {{name}} {{when}}", {
            name: view.addedByName,
            when: OneUptimeDate.fromNow(view.addedAt),
          })
        : translator.translateTemplate("Added {{when}}", {
            when: OneUptimeDate.fromNow(view.addedAt),
          })
    : "";

  const linkButtonClassName: string =
    "rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

  // Where OneUptime AI's reading stands, in one line with its one action.
  const readingLine: () => ReactElement = (): ReactElement => {
    switch (view.reading) {
      case CallTranscriptReading.Reading:
        return (
          <p
            role="status"
            data-testid="call-transcript-reading"
            className="flex items-center gap-2 text-xs text-gray-600"
          >
            <span className="h-3 w-3 flex-shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
            {translator.translateText("OneUptime AI is reading it…")}
          </p>
        );
      case CallTranscriptReading.Stuck:
      case CallTranscriptReading.Failed:
        return (
          <div data-testid="call-transcript-read-failed" className="text-xs">
            <p className="flex items-start gap-1.5 text-gray-700">
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-600"
              />
              <span>
                {view.reading === CallTranscriptReading.Stuck
                  ? translator.translateText(
                      "OneUptime AI took too long to read it.",
                    )
                  : translator.translateText(
                      "OneUptime AI could not read it.",
                    )}{" "}
                {view.reading === CallTranscriptReading.Failed &&
                view.readingMessage ? (
                  <span className="text-gray-500">{view.readingMessage}</span>
                ) : (
                  <></>
                )}
              </span>
            </p>
            {props.canManage ? (
              <button
                type="button"
                data-testid="call-transcript-read-again"
                disabled={isRereading}
                className={`ml-5 mt-1 ${linkButtonClassName} text-xs`}
                onClick={() => {
                  void readAgain();
                }}
              >
                {translator.translateText("Try again")}
              </button>
            ) : (
              <></>
            )}
          </div>
        );
      case CallTranscriptReading.Skipped:
        return (
          <p
            data-testid="call-transcript-read-skipped"
            className="text-xs text-gray-500"
          >
            {view.readingMessage ||
              translator.translateText(
                "AI is off for this project, so OneUptime AI did not read it.",
              )}
          </p>
        );
      case CallTranscriptReading.Ready: {
        const message: string =
          view.suggestion === RootCauseSuggestionStatus.Accepted
            ? translator.translateText("Used as the incident's root cause.") ||
              ""
            : view.suggestion === RootCauseSuggestionStatus.Dismissed
              ? translator.translateText(
                  "OneUptime AI's suggested root cause was dismissed.",
                ) || ""
              : view.summary?.rootCause.outcome ===
                  CallSummaryRootCauseOutcome.Suggested
                ? translator.translateText(
                    "OneUptime AI suggested a root cause for you to review.",
                  ) || ""
                : translator.translateText(
                    "OneUptime AI read it: not enough was said to suggest a root cause.",
                  ) || "";

        return (
          <p
            data-testid="call-transcript-read"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600"
          >
            <span className="flex items-center gap-1.5">
              <Icon
                icon={
                  view.suggestion === RootCauseSuggestionStatus.Accepted
                    ? IconProp.CheckCircle
                    : IconProp.Sparkles
                }
                className={`h-3.5 w-3.5 flex-shrink-0 ${
                  view.suggestion === RootCauseSuggestionStatus.Accepted
                    ? "text-emerald-600"
                    : "text-indigo-500"
                }`}
              />
              {message}
            </span>
            <button
              type="button"
              data-testid="call-transcript-review"
              className={`${linkButtonClassName} text-xs`}
              onClick={props.onReview}
            >
              {view.suggestion === RootCauseSuggestionStatus.Suggested
                ? translator.translateText("Review")
                : translator.translateText("See what it found")}
            </button>
          </p>
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
        <p className="min-w-0 flex-1 break-words text-gray-600">
          {error || unavailable!.message}
        </p>
        <button
          type="button"
          aria-label={translator.translateText("Dismiss")}
          className="-my-0.5 rounded-md p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            setUnavailable(null);
            setError(undefined);
          }}
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
          // As tall as the Small View button beside it.
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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

  const getAndAddButtons: ReactElement = props.canManage ? (
    <div className="flex flex-wrap items-center gap-2">
      {view.canGetFromProvider ? (
        <Button
          title="Get transcript"
          icon={IconProp.DocumentArrowDown}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          isLoading={isGetting}
          dataTestId="call-transcript-get"
          tooltip={translator.translateTemplate(
            "Ask {{provider}} for this meeting's transcript.",
            { provider: providerName },
          )}
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
        buttonStyle={
          view.canGetFromProvider
            ? ButtonStyleType.OUTLINE
            : ButtonStyleType.NORMAL
        }
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
          className={`${linkButtonClassName} text-xs`}
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
            className={`${linkButtonClassName} text-xs`}
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
            className={`${linkButtonClassName} text-xs`}
            onClick={() => {
              void getFromProvider();
            }}
          >
            {isGetting
              ? translator.translateText("Getting the transcript…")
              : translator.translateText("Get transcript")}
          </button>
        ) : (
          <></>
        )}
        <button
          type="button"
          data-testid="call-transcript-add"
          className={`${linkButtonClassName} text-xs`}
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
    content = (
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          <Icon icon={IconProp.DocumentText} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText("Transcript")}
            {view.info ? (
              <span className="font-normal text-gray-500">
                {" · "}
                {describeTranscriptLength(view.info, translator)}
              </span>
            ) : (
              <></>
            )}
          </p>
          {sourceLine ? (
            <p className="text-xs text-gray-500">{sourceLine}</p>
          ) : (
            <></>
          )}
          {readingLine()}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <Button
            title="View"
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="call-transcript-view"
            onClick={() => {
              setIsViewing(true);
            }}
          />
          {manageMenu}
        </div>
      </div>
    );
  } else {
    content = (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText("Transcript")}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {translator.translateText(
              "After the call, add its transcript: OneUptime AI reads it and suggests the root cause for you to review.",
            )}
          </p>
        </div>
        {getAndAddButtons}
      </div>
    );
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
            setUnavailable(null);
            setError(undefined);
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
