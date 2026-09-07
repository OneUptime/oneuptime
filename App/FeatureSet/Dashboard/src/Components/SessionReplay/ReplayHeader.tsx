import React, {
  ForwardedRef,
  ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import {
  formatReplayDuration,
  formatReplayOffset,
  formatReplayWallClock,
} from "./ReplayTimeFormat";
import { SealedReasonCopy } from "./FidelityNoticeCopy";
import {
  ReplayButtonGroup,
  ReplayPill,
  ReplayToolButton,
  getReplaySegmentClassName,
} from "./ReplayUi";

/*
 * The player's header: who, what, when - and the handful of actions that
 * belong to the whole recording rather than to a moment of it.
 *
 * Row 1 answers "is this the right session" before the viewer presses
 * anything: a "Sessions" link back to the filtered list they came from,
 * the identified user (or an honest "anonymous" / "hidden") with the
 * Live and sealed pills beside it, the browser, OS and viewport facts as
 * its subtitle, and the clock - the session's start time and the
 * playhead as WALL-CLOCK time, so a viewer can line the picture up with
 * a dashboard by eye (design: REPLAY -> OUT 7).
 *
 * Row 2, under a hairline, is the transport-independent controls: tab
 * pills for multi-tab recordings (with real labels - ordinal, duration,
 * when the tab opened - instead of a hex fragment; player-shell-8 /
 * product-gap-19), and the actions: pin, copy link, wide, theater,
 * details.
 *
 * The two rows exist because one did not. Everything used to run at
 * text-xs on a single wrapping line broken up by a literal "|", so the
 * identity, four device facts, a clock, five action chips and the Live
 * pill all shouted at the same volume and the header re-flowed into a
 * different shape at every width. The hierarchy is now: identity at
 * text-sm, facts muted underneath, actions on their own shelf, and no
 * chip carries its own outline unless it is the one thing on the row a
 * viewer is meant to press.
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
      className={`mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3 ${
        props.isTheater ? "shadow-md" : "shadow-sm"
      }`}
    >
      {/*
       * ROW 1 - who and when.
       *
       * The old row ran everything at text-xs through a literal "|"
       * separator: the back link, the identity, a traits chip, four
       * device facts and the clock all carried the same weight, so the
       * one thing a viewer opens the page to check - is this the right
       * session - had to be hunted for. The identity is now the only
       * text-sm item on the header and the facts sit under it as a
       * subtitle, which is the whole hierarchy this page needed.
       */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <a
          href={props.backHref}
          onClick={handleBackClick}
          data-testid="replay-back-link"
          title="Back to the session list"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon icon={IconProp.ArrowLeft} className="h-3.5 w-3.5" />
          Sessions
        </a>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              data-testid="replay-header-user"
              className={`max-w-xs truncate text-sm ${identityClassName}`}
              title={identityTitle}
            >
              {identityText}
            </span>

            {traitCount > 0 && (
              <button
                type="button"
                className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900"
                title="Open the details panel to read the traits"
                onClick={props.onOpenDetails}
                data-testid="replay-header-traits"
              >
                {traitCount} trait{traitCount === 1 ? "" : "s"}
              </button>
            )}

            {props.isLive && (
              <ReplayPill
                dataTestId="replay-live-pill"
                tone="live"
                hasPulse={true}
                title="Still being recorded; new footage is added as it arrives"
              >
                Live
              </ReplayPill>
            )}

            {props.sealedReason && props.sealedReason.severity === "warn" && (
              <ReplayPill
                dataTestId="replay-sealed-pill"
                tone="warning"
                icon={IconProp.Alert}
                title={props.sealedReason.description}
              >
                {props.sealedReason.title}
              </ReplayPill>
            )}
          </div>

          {/*
           * The facts as one subtitle line rather than N free-floating
           * spans. ux-16: they used to disappear outright below md, so on
           * a tablet in portrait the viewer could not see which browser,
           * OS or viewport they were watching without opening Details.
           * Both renderings are kept - one truncated line when the header
           * is narrow, the separated facts when there is room - because
           * the compact line is what makes them survive a narrow viewport.
           */}
          {props.facts.length > 0 && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
              <span
                className="min-w-0 max-w-full truncate md:hidden"
                title={factsTitle}
                data-testid="replay-header-facts-compact"
              >
                {factsLine}
              </span>

              {props.facts.map(
                (fact: ReplayHeaderFact, index: number): ReactElement => {
                  return (
                    <React.Fragment key={fact.label}>
                      {index > 0 && (
                        <span
                          aria-hidden="true"
                          className="hidden h-1 w-1 shrink-0 rounded-full bg-gray-300 md:inline-block"
                        />
                      )}
                      <span
                        className="hidden max-w-[14rem] truncate md:inline"
                        title={`${fact.label}: ${fact.value}`}
                        data-testid="replay-header-fact"
                      >
                        {fact.value}
                      </span>
                    </React.Fragment>
                  );
                },
              )}
            </div>
          )}
        </div>

        {/*
         * The clock, as its own right-hand block: the wall-clock time at
         * the playhead is the number a viewer lines up against a
         * dashboard, so it leads, with the session's start date and the
         * offset pair under it (design: REPLAY -> OUT 7).
         */}
        <div
          className="shrink-0 text-right tabular-nums"
          data-testid="replay-header-clock"
        >
          {wallClock && (
            <div
              className="font-mono text-sm font-semibold text-gray-900"
              title="Wall-clock time at the playhead"
              data-testid="replay-header-wall-clock"
            >
              {wallClock}
            </div>
          )}
          <div className="mt-0.5 flex items-center justify-end gap-1.5 whitespace-nowrap text-[11px] text-gray-500">
            {startedAt && (
              <span title="When the session started (your local time)">
                {startedAt}
              </span>
            )}
            {startedAt && (
              <span
                aria-hidden="true"
                className="h-1 w-1 shrink-0 rounded-full bg-gray-300"
              />
            )}
            <span title="Playhead / recording length">{offsetText}</span>
          </div>
        </div>
      </div>

      {/*
       * ROW 2 - the actions, on their own hairline-separated shelf so
       * they stop competing with the facts above them.
       */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5">
        {props.tabs.length > 1 && (
          <ReplayButtonGroup
            role="tablist"
            ariaLabel="Browser tabs in this recording"
            className="flex-wrap"
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
                  className={getReplaySegmentClassName({
                    isSelected: tab.isActive,
                    isDisabled: !tab.hasFootage,
                  })}
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
          </ReplayButtonGroup>
        )}

        {props.continueInTab && (
          <button
            type="button"
            data-testid="replay-continue-in-tab"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
            title="This tab has played out; the session continues in another tab"
            onClick={(): void => {
              props.onSwitchTab(props.continueInTab?.tabId ?? "");
            }}
          >
            <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
            Continue in {props.continueInTab.label}
          </button>
        )}

        {/*
         * The id chip. Common/UI's Button was rendering its "Copy id"
         * title as visible text stacked under the icon, which blew the
         * chip's height out and pushed the row around; the copy action
         * is an icon with an accessible name, like every other icon-only
         * control in the chrome.
         */}
        <span
          className="hidden h-8 shrink-0 items-center gap-1 rounded-lg bg-gray-100 pl-2.5 pr-1 text-[11px] text-gray-500 sm:inline-flex"
          title={props.sessionId}
        >
          <span className="font-mono">{shortSessionId}</span>
          <ReplayToolButton
            dataTestId="replay-copy-session-id"
            icon={IconProp.Copy}
            title="Copy the session id"
            ariaLabel="Copy the session id"
            className="h-6 w-6"
            onClick={(): void => {
              /* ux-19: the same announced path the Link button uses. */
              copyValue(props.sessionId, "session-id");
            }}
          />
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {props.pinControl}

          <ReplayToolButton
            dataTestId="replay-copy-link"
            label="Link"
            icon={IconProp.Link}
            title="Copy a link to this moment (c)"
            onClick={handleCopyLink}
          />

          <ReplayButtonGroup ariaLabel="Player layout">
            <ReplayToolButton
              dataTestId="replay-toggle-wide"
              label="Wide"
              icon={IconProp.Expand}
              variant="segment"
              isPressed={props.isWide}
              title={
                props.isWide
                  ? "Show the application menu again (w)"
                  : "Hide the application menu (w)"
              }
              onClick={props.onToggleWide}
            />
            <ReplayToolButton
              dataTestId="replay-toggle-theater"
              label={props.isTheater ? "Exit theater" : "Theater"}
              icon={IconProp.Window}
              variant="segment"
              isPressed={props.isTheater}
              title={props.isTheater ? "Exit theater (Esc)" : "Theater (f)"}
              onClick={props.onToggleTheater}
            />
          </ReplayButtonGroup>

          <ReplayToolButton
            dataTestId="replay-open-details"
            label="Details"
            icon={IconProp.Info}
            title="Session details (i)"
            onClick={props.onOpenDetails}
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
            ? "mt-2 text-xs font-medium text-emerald-700"
            : "sr-only"
        }
      >
        {copyState.status === "copied"
          ? COPY_KIND_COPY[copyState.kind].announcement
          : ""}
      </div>

      {copyState.status === "fallback" && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-700"
          data-testid="replay-copy-link-fallback"
        >
          <span>{COPY_KIND_COPY[copyState.kind].fallbackPrompt}</span>
          <input
            ref={fallbackInputRef}
            type="text"
            readOnly={true}
            value={copyState.value}
            aria-label={COPY_KIND_COPY[copyState.kind].fieldLabel}
            className="min-w-[16rem] flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-gray-800"
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
