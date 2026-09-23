import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  NoteNotificationSummary,
  NoteNotificationTone,
} from "./EventNotesUtil";

export interface ComponentProps {
  summary: NoteNotificationSummary;
  // What the notification was about, for the details dialog title.
  kindLabel: string;
  onRetry?: (() => Promise<void>) | undefined;
  dataTestId?: string | undefined;
}

const TONE_CLASS_NAMES: Record<NoteNotificationTone, string> = {
  [NoteNotificationTone.Neutral]: "bg-gray-50 text-gray-600 ring-gray-200",
  [NoteNotificationTone.Pending]: "bg-amber-50 text-amber-700 ring-amber-200",
  [NoteNotificationTone.Progress]: "bg-sky-50 text-sky-700 ring-sky-200",
  [NoteNotificationTone.Success]:
    "bg-emerald-50 text-emerald-700 ring-emerald-200",
  [NoteNotificationTone.Danger]: "bg-red-50 text-red-700 ring-red-200",
};

/*
 * Where the subscriber notification for a public note stands, as a small
 * pill in the note's header. A failed one also offers a retry, and one with a
 * message from the notification worker opens it in a dialog - that message
 * is usually the only explanation of why nobody was told.
 */
const NoteNotificationBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryError, setRetryError] = useState<string>("");

  const isRetryable: boolean = Boolean(
    props.summary.isRetryable && props.onRetry,
  );
  const hasDetails: boolean = Boolean(props.summary.detail) || isRetryable;

  const className: string = `inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
    TONE_CLASS_NAMES[props.summary.tone]
  }`;

  const content: ReactElement = (
    <>
      <Icon
        icon={props.summary.icon}
        className={`h-3.5 w-3.5 shrink-0 ${
          props.summary.tone === NoteNotificationTone.Progress
            ? "animate-spin"
            : ""
        }`}
      />
      <span className="truncate">{tx(props.summary.label)}</span>
    </>
  );

  const retry: () => Promise<void> = async (): Promise<void> => {
    if (!props.onRetry) {
      return;
    }

    setRetryError("");
    setIsRetrying(true);

    try {
      await props.onRetry();
      setIsDetailsOpen(false);
    } catch (err) {
      setRetryError(
        err instanceof Error && err.message
          ? err.message
          : tx("Could not queue the notification again."),
      );
    }

    setIsRetrying(false);
  };

  return (
    <>
      {hasDetails ? (
        <button
          type="button"
          data-testid={props.dataTestId}
          className={`${className} cursor-pointer transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
          title={tx("Show notification details")}
          onClick={() => {
            setRetryError("");
            setIsDetailsOpen(true);
          }}
        >
          {content}
        </button>
      ) : (
        <Tooltip text={tx(props.summary.label)}>
          <span data-testid={props.dataTestId} className={className}>
            {content}
          </span>
        </Tooltip>
      )}

      {isDetailsOpen && (
        <ConfirmModal
          title={tx(props.kindLabel)}
          description={
            <div className="space-y-3" data-testid="note-notification-details">
              <span className={className}>{content}</span>
              <p className="text-sm text-gray-600">
                {props.summary.detail ||
                  tx(
                    "No additional information is available for this notification.",
                  )}
              </p>
            </div>
          }
          isLoading={isRetrying}
          error={retryError || undefined}
          submitButtonText={
            isRetryable ? tx("Retry notification") : tx("Close")
          }
          submitButtonType={
            isRetryable ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
          }
          closeButtonText={isRetryable ? tx("Close") : undefined}
          onClose={
            isRetryable
              ? () => {
                  setIsDetailsOpen(false);
                }
              : undefined
          }
          onSubmit={() => {
            if (isRetryable) {
              retry();
              return;
            }

            setIsDetailsOpen(false);
          }}
        />
      )}
    </>
  );
};

export default NoteNotificationBadge;
