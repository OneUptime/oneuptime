import React, {
  ForwardedRef,
  FunctionComponent,
  ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import {
  formatReplayDuration,
  formatReplayOffset,
  formatReplayWallClock,
} from "./ReplayTimeFormat";
import { SealedReasonCopy } from "./FidelityNoticeCopy";

/*
 * The player's header: who, what, when - and the handful of actions that
 * belong to the whole recording rather than to a moment of it.
 *
 * Line 1 answers "is this the right session" before the viewer presses
 * anything: a "Sessions" link back to the filtered list they came from,
 * the identified user (or an honest "anonymous" / "hidden"), the browser,
 * OS and viewport facts, and the clock - the session's start time, the
 * playhead as WALL-CLOCK time next to the offset, so a viewer can line
 * the picture up with a dashboard by eye (design: REPLAY -> OUT 7).
 *
 * Line 2 is the transport-independent controls: tab pills for multi-tab
 * recordings (with real labels - ordinal, duration, when the tab opened -
 * instead of a hex fragment; player-shell-8 / product-gap-19), the Live
 * pill, and the actions: pin, copy link, wide, theater, details.
 *
 * Copying never fails silently and never relabels a button
 * (player-shell-12, ux-19): every copyable value on this header - the
 * moment link, the session id, and the rail's row link through
 * handle.copyUrl - goes through one path that announces success in a live
 * region and, where the clipboard is unavailable (plain-http self-hosted
 * installs) or refuses, shows the value in a read-only field to copy by
 * hand.
 */

export interface ReplayHeaderFact {
  label: string;
  value: string;
}

export interface ReplayHeaderTab {
  tabId: string;
  /* "Tab 1", in the order the end user opened them. */
  label: string;
  durationMs: number;
  /* Session-clock offset the tab's footage starts at; null when unknown. */
  openedAtMs: number | null;
  hasFootage: boolean;
  isActive: boolean;
}

export interface ReplayHeaderIdentity {
  /*
   * null: the manifest omitted identity because the viewer lacks the
   * identity permission - say "hidden", never "anonymous". "": the page
   * never called identify(). Otherwise the label as supplied.
   */
  label: string | null;
  traits?: Record<string, string> | null | undefined;
}

export interface ReplayHeaderProps {
  sessionId: string;
  /* Where "Sessions" goes: the stamped list URL, or the bare list route. */
  backHref: string;
  onBack: () => void;
  identity: ReplayHeaderIdentity;
  facts: Array<ReplayHeaderFact>;
  /* The session clock's zero; null when the manifest did not say. */
  startTimeUnixMs: number | null;
  currentTimeMs: number;
  durationMs: number;
  isLive: boolean;
  tabs: Array<ReplayHeaderTab>;
  onSwitchTab: (tabId: string) => void;
  /* Set when the active tab has played out and this tab has later footage. */
  continueInTab?: ReplayHeaderTab | null | undefined;
  /* How the recording ended, when the finalizer said. */
  sealedReason?: SealedReasonCopy | null | undefined;
  isWide: boolean;
  onToggleWide: () => void;
  isTheater: boolean;
  onToggleTheater: () => void;
  onOpenDetails: () => void;
  /*
   * Builds the link for "Copy link at this moment" when clicked, so the
   * header does not re-render per tick to keep a URL fresh. null when no
   * link can be built (no application id).
   */
  buildMomentUrl: () => string | null;
  /* The pin control, rendered by the shell (it owns the API calls). */
  pinControl?: ReactElement | null | undefined;
}

/* What the shell drives from the keyboard map ("c") and the rail rows. */
export interface ReplayHeaderHandle {
  copyLink: () => void;
  /*
   * Copy an arbitrary link through the same announced-and-fallback path
   * (ux-10): the rail's per-row "Copy link to this moment" used to write
   * to navigator.clipboard directly, so it said nothing on success and
   * nothing at all on a plain-http install where the clipboard is absent.
   */
  copyUrl: (url: string) => void;
}

/* How long "Link copied" stays announced. */
export const REPLAY_HEADER_COPIED_MS: number = 2000;

/*
 * Clipboard write that reports failure instead of throwing or vanishing:
 * navigator.clipboard is absent on plain http and inside some sandboxed
 * frames, and writeText rejects when the document is not focused.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== "function"
    ) {
      return false;
    }

    await navigator.clipboard.writeText(text);

    return true;
  } catch {
    return false;
  }
}

/* "Tab 2 · 30s (opened 2:14)" */
export function formatReplayTabLabel(tab: ReplayHeaderTab): string {
  if (!tab.hasFootage) {
    return `${tab.label} · no footage`;
  }

  const parts: Array<string> = [
    tab.label,
    formatReplayDuration(tab.durationMs),
  ];

  if (tab.openedAtMs !== null && tab.openedAtMs > 0) {
    parts.push(`(opened ${formatReplayOffset(tab.openedAtMs)})`);
  }

  return parts.join(" · ");
}

/* What a copy was of, so the announcement and the fallback name it. */
type CopyKind = "link" | "session-id";

interface CopyKindCopy {
  announcement: string;
  fallbackPrompt: string;
  fieldLabel: string;
}

const COPY_KIND_COPY: Record<CopyKind, CopyKindCopy> = {
  link: {
    announcement: "Link copied to the clipboard.",
    fallbackPrompt:
      "The clipboard is not available here; copy the link by hand:",
    fieldLabel: "Link to this moment",
  },
  "session-id": {
    announcement: "Session id copied to the clipboard.",
    fallbackPrompt:
      "The clipboard is not available here; copy the session id by hand:",
    fieldLabel: "Session id",
  },
};

type CopyLinkState =
  | { status: "idle" }
  | { status: "copied"; value: string; kind: CopyKind }
  | { status: "fallback"; value: string; kind: CopyKind };

const ACTION_BUTTON_CLASS: string =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const ACTION_BUTTON_IDLE_CLASS: string =
  "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50";
const ACTION_BUTTON_ACTIVE_CLASS: string =
  "bg-indigo-50 text-indigo-800 ring-indigo-300 hover:bg-indigo-100";

interface ActionButtonProps {
  label: string;
  icon: IconProp;
  title: string;
  onClick: () => void;
  isPressed?: boolean | undefined;
  testId: string;
}

/*
 * Same-weight icon+label buttons with a stable width: the label never
 * changes on click (that was the "Copied!" layout jump), and the pressed
 * state (Wide, Theater) is carried by aria-pressed plus the tint.
 */
const ActionButton: FunctionComponent<ActionButtonProps> = (
  props: ActionButtonProps,
): ReactElement => {
  const pressedProps: { "aria-pressed": boolean } | Record<string, never> =
    props.isPressed === undefined ? {} : { "aria-pressed": props.isPressed };

  return (
    <button
      type="button"
      className={`${ACTION_BUTTON_CLASS} ${
        props.isPressed ? ACTION_BUTTON_ACTIVE_CLASS : ACTION_BUTTON_IDLE_CLASS
      }`}
      title={props.title}
      onClick={props.onClick}
      data-testid={props.testId}
      {...pressedProps}
    >
      <Icon icon={props.icon} className="h-3.5 w-3.5" />
      <span>{props.label}</span>
    </button>
  );
};

const ReplayHeaderComponent: React.ForwardRefRenderFunction<
  ReplayHeaderHandle,
  ReplayHeaderProps
> = (
  props: ReplayHeaderProps,
  ref: ForwardedRef<ReplayHeaderHandle>,
): ReactElement => {
  const [copyState, setCopyState] = useState<CopyLinkState>({
    status: "idle",
  });
  const copiedTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  /* The old header leaked its 2s timer past unmount (player-shell-12). */
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (copyState.status === "fallback") {
      fallbackInputRef.current?.focus();
      fallbackInputRef.current?.select();
    }
  }, [copyState.status]);

  const { buildMomentUrl } = props;

  /*
   * One copy path for every copyable value on this header (and, through
   * the handle, for the rail's row action): announce success in the live
   * region, and show the value in a read-only field when the clipboard
   * is missing or refuses. Nothing here is ever silent.
   */
  const copyValue: (value: string, kind: CopyKind) => void = useCallback(
    (value: string, kind: CopyKind): void => {
      if (!value) {
        return;
      }

      void copyTextToClipboard(value).then((isCopied: boolean): void => {
        if (!isCopied) {
          setCopyState({ status: "fallback", value: value, kind: kind });
          return;
        }

        setCopyState({ status: "copied", value: value, kind: kind });

        if (copiedTimerRef.current !== null) {
          clearTimeout(copiedTimerRef.current);
        }

        copiedTimerRef.current = setTimeout((): void => {
          copiedTimerRef.current = null;
          setCopyState({ status: "idle" });
        }, REPLAY_HEADER_COPIED_MS);
      });
    },
    [],
  );

  const handleCopyLink: () => void = useCallback((): void => {
    const url: string | null = buildMomentUrl();

    if (!url) {
      return;
    }

    copyValue(url, "link");
  }, [buildMomentUrl, copyValue]);

  const handleCopyUrl: (url: string) => void = useCallback(
    (url: string): void => {
      copyValue(url, "link");
    },
    [copyValue],
  );

  useImperativeHandle(ref, (): ReplayHeaderHandle => {
    return { copyLink: handleCopyLink, copyUrl: handleCopyUrl };
  }, [handleCopyLink, handleCopyUrl]);

  const handleBackClick: (event: React.MouseEvent<HTMLAnchorElement>) => void =
    useCallback(
      (event: React.MouseEvent<HTMLAnchorElement>): void => {
        /* Plain clicks stay in the SPA; modified clicks keep the browser's own behaviour. */
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        props.onBack();
      },
      [props.onBack],
    );

  /* ---- Identity. ---- */

  const traitCount: number = props.identity.traits
    ? Object.keys(props.identity.traits).length
    : 0;

  let identityText: string;
  let identityTitle: string;
  let identityClassName: string;

  if (props.identity.label === null) {
    identityText = "Identity hidden";
    identityTitle =
      "The end user's identity needs the identity permission to view.";
    identityClassName = "text-gray-500";
  } else if (props.identity.label.length === 0) {
    identityText = "Anonymous";
    identityTitle = "The page did not call OneUptimeReplay.identify().";
    identityClassName = "text-gray-600";
  } else {
    identityText = props.identity.label;
    identityTitle = props.identity.label;
    identityClassName = "font-semibold text-gray-900";
  }

  /* ---- Clock. ---- */

  const wallClock: string | null = formatReplayWallClock(
    props.startTimeUnixMs,
    props.currentTimeMs,
  );
  const startedAt: string | null =
    props.startTimeUnixMs !== null
      ? OneUptimeDate.getDateAsLocalFormattedString(
          new Date(props.startTimeUnixMs),
          false,
          false,
          true,
        )
      : null;

  const offsetText: string = `${formatReplayOffset(
    props.currentTimeMs,
  )} / ${formatReplayOffset(props.durationMs)}`;

  const shortSessionId: string = props.sessionId.slice(0, 8);

  /* One line of facts for narrow widths; the title carries the labels. */
  const factsLine: string = props.facts
    .map((fact: ReplayHeaderFact): string => {
      return fact.value;
    })
    .join(" · ");
  const factsTitle: string = props.facts
    .map((fact: ReplayHeaderFact): string => {
      return `${fact.label}: ${fact.value}`;
    })
    .join(" · ");

  return (
    <header
      data-testid="replay-header"
      className={`mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2 ${
        props.isTheater ? "shadow-sm" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <a
          href={props.backHref}
          onClick={handleBackClick}
          data-testid="replay-back-link"
          className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:text-indigo-900"
        >
          <Icon icon={IconProp.ArrowLeft} className="h-3.5 w-3.5" />
          Sessions
        </a>

        <span className="text-gray-300" aria-hidden="true">
          |
        </span>

        <span
          data-testid="replay-header-user"
          className={`max-w-xs truncate ${identityClassName}`}
          title={identityTitle}
        >
          {identityText}
        </span>

        {traitCount > 0 && (
          <button
            type="button"
            className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200"
            title="Open the details panel to read the traits"
            onClick={props.onOpenDetails}
            data-testid="replay-header-traits"
          >
            {traitCount} trait{traitCount === 1 ? "" : "s"}
          </button>
        )}

        {/*
         * ux-16: the facts used to disappear outright below md, so on a
         * tablet in portrait the viewer could not see which browser, OS
         * or viewport they were watching without opening Details. They
         * now collapse to one truncated line instead of vanishing.
         */}
        {props.facts.length > 0 && (
          <span
            className="min-w-0 max-w-[45%] truncate text-gray-700 md:hidden"
            title={factsTitle}
            data-testid="replay-header-facts-compact"
          >
            {factsLine}
          </span>
        )}

        {props.facts.map((fact: ReplayHeaderFact): ReactElement => {
          return (
            <span
              key={fact.label}
              className="hidden max-w-[14rem] truncate text-gray-700 md:inline"
              title={`${fact.label}: ${fact.value}`}
              data-testid="replay-header-fact"
            >
              {fact.value}
            </span>
          );
        })}

        <span
          className="ml-auto flex items-center gap-2 whitespace-nowrap tabular-nums text-gray-600"
          data-testid="replay-header-clock"
        >
          {startedAt && (
            <span title="When the session started (your local time)">
              {startedAt}
            </span>
          )}
          {wallClock && (
            <span
              className="font-medium text-gray-900"
              title="Wall-clock time at the playhead"
              data-testid="replay-header-wall-clock"
            >
              {wallClock}
            </span>
          )}
          <span title="Playhead / recording length">({offsetText})</span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {props.tabs.length > 1 && (
          <div
            role="tablist"
            aria-label="Browser tabs in this recording"
            className="inline-flex flex-wrap gap-1"
          >
            {props.tabs.map((tab: ReplayHeaderTab): ReactElement => {
              return (
                <button
                  key={tab.tabId}
                  type="button"
                  role="tab"
                  aria-selected={tab.isActive}
                  data-testid="replay-tab-pill"
                  data-tab-id={tab.tabId}
                  disabled={!tab.hasFootage}
                  title={
                    tab.hasFootage
                      ? `Switch to ${tab.label}; the playhead stays where it is`
                      : "No footage stored for this tab"
                  }
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                    tab.isActive
                      ? "bg-indigo-100 text-indigo-800 ring-indigo-200"
                      : tab.hasFootage
                        ? "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
                        : "cursor-not-allowed bg-gray-50 text-gray-400 ring-gray-200"
                  }`}
                  onClick={(): void => {
                    if (tab.hasFootage && !tab.isActive) {
                      props.onSwitchTab(tab.tabId);
                    }
                  }}
                >
                  {formatReplayTabLabel(tab)}
                </button>
              );
            })}
          </div>
        )}

        {props.continueInTab && (
          <button
            type="button"
            data-testid="replay-continue-in-tab"
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
            title="This tab has played out; the session continues in another tab"
            onClick={(): void => {
              props.onSwitchTab(props.continueInTab?.tabId ?? "");
            }}
          >
            <Icon icon={IconProp.ArrowRight} className="h-3 w-3" />
            Continue in {props.continueInTab.label}
          </button>
        )}

        {props.isLive && (
          <span
            data-testid="replay-live-pill"
            className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200"
            title="Still being recorded; new footage is added as it arrives"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            Live
          </span>
        )}

        {props.sealedReason && props.sealedReason.severity === "warn" && (
          <span
            data-testid="replay-sealed-pill"
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ring-1 ring-inset ring-amber-200"
            title={props.sealedReason.description}
          >
            <Icon icon={IconProp.Alert} className="h-3 w-3" />
            {props.sealedReason.title}
          </span>
        )}

        <span
          className="hidden items-center gap-1 text-[11px] text-gray-400 sm:inline-flex"
          title={props.sessionId}
        >
          <span className="font-mono">{shortSessionId}</span>
          <Button
            title="Copy id"
            buttonSize={ButtonSize.ExtraSmall}
            buttonStyle={ButtonStyleType.ICON_LIGHT}
            icon={IconProp.Copy}
            dataTestId="replay-copy-session-id"
            onClick={(): void => {
              /* ux-19: the same announced path the Link button uses. */
              copyValue(props.sessionId, "session-id");
            }}
          />
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {props.pinControl}

          <ActionButton
            label="Link"
            icon={IconProp.Link}
            title="Copy a link to this moment (c)"
            onClick={handleCopyLink}
            testId="replay-copy-link"
          />

          <ActionButton
            label="Wide"
            icon={IconProp.Expand}
            title={
              props.isWide
                ? "Show the application menu again (w)"
                : "Hide the application menu (w)"
            }
            onClick={props.onToggleWide}
            isPressed={props.isWide}
            testId="replay-toggle-wide"
          />

          <ActionButton
            label={props.isTheater ? "Exit theater" : "Theater"}
            icon={IconProp.Window}
            title={props.isTheater ? "Exit theater (Esc)" : "Theater (f)"}
            onClick={props.onToggleTheater}
            isPressed={props.isTheater}
            testId="replay-toggle-theater"
          />

          <ActionButton
            label="Details"
            icon={IconProp.Info}
            title="Session details (i)"
            onClick={props.onOpenDetails}
            testId="replay-open-details"
          />
        </div>
      </div>

      {/*
       * Announced, not relabelled: the button keeps its width and a
       * screen reader hears the outcome (player-shell-19).
       */}
      <div
        role="status"
        aria-live="polite"
        data-testid="replay-copy-link-status"
        className={
          copyState.status === "copied"
            ? "mt-1 text-xs text-emerald-700"
            : "sr-only"
        }
      >
        {copyState.status === "copied"
          ? COPY_KIND_COPY[copyState.kind].announcement
          : ""}
      </div>

      {copyState.status === "fallback" && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700"
          data-testid="replay-copy-link-fallback"
        >
          <span>{COPY_KIND_COPY[copyState.kind].fallbackPrompt}</span>
          <input
            ref={fallbackInputRef}
            type="text"
            readOnly={true}
            value={copyState.value}
            aria-label={COPY_KIND_COPY[copyState.kind].fieldLabel}
            className="min-w-[16rem] flex-1 rounded border border-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-gray-800"
            onFocus={(event: React.FocusEvent<HTMLInputElement>): void => {
              event.currentTarget.select();
            }}
          />
          <button
            type="button"
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
            onClick={(): void => {
              setCopyState({ status: "idle" });
            }}
          >
            Close
          </button>
        </div>
      )}
    </header>
  );
};

const ReplayHeader: React.ForwardRefExoticComponent<
  ReplayHeaderProps & React.RefAttributes<ReplayHeaderHandle>
> = forwardRef<ReplayHeaderHandle, ReplayHeaderProps>(ReplayHeaderComponent);

ReplayHeader.displayName = "ReplayHeader";

export default ReplayHeader;
