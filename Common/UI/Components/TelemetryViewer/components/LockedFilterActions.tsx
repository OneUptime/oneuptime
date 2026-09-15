import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../../Icon/Icon";
import Link from "../../Link/Link";
import Tooltip from "../../Tooltip/Tooltip";
import IconProp from "../../../../Types/Icon/IconProp";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import {
  TELEMETRY_EXPLORER_LABELS,
  TelemetrySignal,
} from "../../../../Utils/Telemetry/LockedFilterSearch";
import { CopiedFeedback, useCopiedFeedback } from "./LockedFilterChip";

/*
 * The two ways out of a locked scope: copy every locked chip as search
 * syntax to paste into the main explorer, or open that explorer with the
 * same filters already applied. Rendered once, after the locked chips, so
 * the whole pinned scope travels together — a reader on a Docker host's
 * Logs tab wants "host AND runtime", not one of them.
 */

/** What the host viewer knows about reproducing its locked scope elsewhere. */
export interface LockedFilterActionOptions {
  /** Search-bar text reproducing every locked chip on the same-signal explorer. */
  copyText?: string | undefined;
  /** The same-signal explorer, with the locked filters in its URL. */
  openExplorerRoute?: Route | URL | undefined;
  /** Locked filters the link cannot carry, as short labels. */
  notCarried?: Array<string> | undefined;
}

export interface LockedFilterActionsProps extends LockedFilterActionOptions {
  signal: TelemetrySignal;
}

const ACTION_CLASS_NAME: string =
  "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

const ACTION_IDLE_CLASS_NAME: string =
  "text-gray-600 hover:bg-gray-100 hover:text-gray-900";

const ACTION_COPIED_CLASS_NAME: string = "bg-emerald-50 text-emerald-600";

const ACTION_FAILED_CLASS_NAME: string = "bg-rose-50 text-rose-600";

type GetCopyAriaLabelFunction = (explorerLabel: string) => string;

export const getCopyLockedFiltersAriaLabel: GetCopyAriaLabelFunction = (
  explorerLabel: string,
): string => {
  return `Copy locked filters as ${explorerLabel} search`;
};

type FormatNotCarriedFunction = (
  notCarried: Array<string> | undefined,
) => string;

/** " — not carried over: a, b", or "" when everything travels. */
export const formatNotCarriedSuffix: FormatNotCarriedFunction = (
  notCarried: Array<string> | undefined,
): string => {
  const labels: Array<string> = (notCarried || []).filter((label: string) => {
    return typeof label === "string" && label.trim().length > 0;
  });

  if (labels.length === 0) {
    return "";
  }

  return ` — not carried over: ${labels.join(", ")}`;
};

type GetOpenAriaLabelFunction = (
  explorerLabel: string,
  notCarried?: Array<string> | undefined,
) => string;

/**
 * The accessible name of the "Open in …" link: its visible text plus, when
 * the link cannot carry everything, the same caveat the tooltip shows. The
 * caveat rides a visually-hidden span inside the link rather than a title,
 * so a screen reader hears it before activating, and hovering shows one
 * bubble (the tooltip) instead of the tooltip and the browser's own.
 */
export const getOpenExplorerAriaLabel: GetOpenAriaLabelFunction = (
  explorerLabel: string,
  notCarried?: Array<string> | undefined,
): string => {
  return `Open in ${explorerLabel}${formatNotCarriedSuffix(notCarried)}`;
};

type CopyButtonTextFunction = (feedback: CopiedFeedback) => string;

const copyButtonText: CopyButtonTextFunction = (
  feedback: CopiedFeedback,
): string => {
  if (feedback.copied) {
    return "Copied!";
  }

  if (feedback.failed) {
    return "Copy failed";
  }

  return "Copy filter";
};

const LockedFilterActions: FunctionComponent<LockedFilterActionsProps> = (
  props: LockedFilterActionsProps,
): ReactElement | null => {
  const feedback: CopiedFeedback = useCopiedFeedback();

  const copyText: string = (props.copyText || "").trim();
  const hasCopy: boolean = copyText.length > 0;
  const hasOpen: boolean = Boolean(props.openExplorerRoute);

  if (!hasCopy && !hasOpen) {
    return null;
  }

  const explorerLabel: string = TELEMETRY_EXPLORER_LABELS[props.signal];
  const notCarriedSuffix: string = formatNotCarriedSuffix(props.notCarried);

  const copyClassName: string = feedback.copied
    ? ACTION_COPIED_CLASS_NAME
    : feedback.failed
      ? ACTION_FAILED_CLASS_NAME
      : ACTION_IDLE_CLASS_NAME;

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-0.5 shadow-sm"
      role="group"
      aria-label="Locked filter actions"
      data-testid="locked-filter-actions"
    >
      {hasCopy && (
        <Tooltip
          richContent={
            <div className="w-72 max-w-full space-y-1.5 p-1 text-left text-xs">
              <p className="text-gray-700">
                Copies the locked filters as search syntax. Paste it into the{" "}
                {explorerLabel} explorer search bar to see the same slice there.
              </p>
              <code className="block break-all rounded border border-gray-200 bg-gray-50 px-1.5 py-1 font-mono text-[11px] text-gray-800">
                {copyText}
              </code>
            </div>
          }
        >
          <button
            type="button"
            aria-label={getCopyLockedFiltersAriaLabel(explorerLabel)}
            className={`${ACTION_CLASS_NAME} ${copyClassName}`}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              event.stopPropagation();
              void feedback.copy(copyText);
            }}
          >
            <Icon
              icon={
                feedback.copied
                  ? IconProp.Check
                  : feedback.failed
                    ? IconProp.Close
                    : IconProp.Clipboard
              }
              className="h-3.5 w-3.5"
            />
            <span>{copyButtonText(feedback)}</span>
          </button>
        </Tooltip>
      )}
      {hasOpen && (
        <Tooltip
          text={`Opens the ${explorerLabel} explorer with these filters applied${notCarriedSuffix}`}
        >
          {/*
           * Tippy attaches to its child through a ref, which the Link
           * component (a plain function component) cannot take — the span
           * is the tooltip's anchor, the anchor inside it is the link. No
           * title on the link: Link mirrors a title into aria-label AND a
           * native bubble, which would both contradict the caveat and
           * double the tooltip.
           */}
          <span className="inline-flex">
            <Link
              to={props.openExplorerRoute}
              className={`${ACTION_CLASS_NAME} ${ACTION_IDLE_CLASS_NAME}`}
            >
              <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
              <span>Open in {explorerLabel}</span>
              {notCarriedSuffix && (
                <span className="sr-only">{notCarriedSuffix}</span>
              )}
            </Link>
          </span>
        </Tooltip>
      )}
    </div>
  );
};

export default LockedFilterActions;
