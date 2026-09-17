import React, {
  ForwardedRef,
  ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import { formatReplayOffset, formatReplayWallClock } from "./ReplayTimeFormat";
import { SealedReasonCopy } from "./FidelityNoticeCopy";
import {
  ReplayButtonGroup,
  ReplayPill,
  ReplayToolButton,
  ReplayToolbarDivider,
} from "./ReplayUi";
import ReplayTabSwitcher from "./ReplayTabSwitcher";
import { ReplayTabSummary } from "./ReplayTabs";
import ReplayUserSessionsMenu from "./ReplayUserSessionsMenu";
import {
  ReplayAdjacentUserSessions,
  ReplayUserSessionsState,
  findAdjacentUserSessions,
} from "./ReplayUserSessions";

/*
 * One compact bar above the picture, not a detail card.
 *
 * The header used to be the shared `Card`: a 240px block of labelled
 * definition lists between the page and the recording, on a page whose
 * entire job is to show the recording. At 1440x900 that card plus the
 * timeline below it left the picture drawn at a third of its recorded
 * size. Everything it said is still said - identity, device facts, start
 * time, session id, playhead, the actions - in two ~20px rows, with the
 * labels kept for screen readers (`sr-only`) rather than deleted, because
 * "jane@acme.com" without "User" beside it is a string of unknown kind to
 * anyone who cannot see the layout.
 *
 * The browser tabs moved out into ReplayTabSwitcher, which is a third row
 * only when the recording actually has several tabs.
 */

export interface ReplayHeaderFact {
  label: string;
  value: string;
}

/*
 * The tab shape the header and the stage take. It is ReplayTabs'
 * ReplayTabSummary: the extra fields (status, page, counts) are optional,
 * so every literal that satisfied the old ReplayHeaderTab still does.
 */
export type ReplayHeaderTab = ReplayTabSummary;

/*
 * The tab model lives in ReplayTabs.ts now (it is pure, and the picker,
 * the strip and the shell all read it). Re-exported here because these
 * three are part of the header's published surface.
 */
export {
  REPLAY_TAB_STRIP_COMPACT_THRESHOLD,
  describeReplayTabOpened,
  formatReplayTabLabel,
} from "./ReplayTabs";
export type { ReplayTabLabelOptions } from "./ReplayTabs";

export interface ReplayHeaderIdentity {
  /*
   * null: the manifest omitted identity because the viewer lacks the
   * identity permission - say "hidden", never "anonymous". "": the page
   * never called identify(). Otherwise the label as supplied.
   */
  label: string | null;
  traits?: Record<string, string> | null | undefined;
  /*
   * The recorder's per-browser anonymous id, "" from an older recorder.
   * Only read when the label is "": an anonymous session that carries
   * one is still ONE person's browser, and the header says "Visitor
   * a1b2c3" rather than a bare "Anonymous" so the viewer knows the
   * sessions beside it in the menu are that same browser's.
   */
  visitorId?: string | undefined;
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
  /*
   * The WHOLE session's length on the session clock, which is not
   * durationMs: that one follows the engine, so it is the footage of the
   * tab being watched (the clock reads "0:41 / 4:12" within this tab).
   * The tab picker draws each tab's span against the session, so scaling
   * it by the watched tab's length would put every other tab's bar off
   * the end of the track. Absent on an older caller, where the picker
   * falls back to the furthest offset its own tabs report.
   */
  sessionDurationMs?: number | undefined;
  /*
   * Footage may still be recorded: not finalized and not every tab has
   * closed (isManifestRecordingLive). Drives the Live pill, so it goes out
   * once the server calls the session ended - about a minute after its
   * last tab closed - rather than when the finalizer counts it.
   */
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
  /*
   * The other sessions of the person being watched, as the shell's
   * lookup state (github.com/OneUptime/oneuptime/issues/3705). Absent
   * while the manifest is still loading; once present, every status
   * renders SOMETHING in the identity row - "finding", "couldn't load",
   * "only session", "not linked" - because a menu that silently fails to
   * appear reads as "this user has no other sessions", which is the one
   * wrong answer an evidence tool must not give.
   */
  userSessions?: ReplayUserSessionsState | null | undefined;
  /* Navigate to another of this user's sessions; the shell owns the route. */
  onOpenUserSession?: ((sessionId: string) => void) | undefined;
}

/*
 * The "newer" step's tooltip when the lookup could not page all the way
 * back to this session (ReplayUserSessionsState.isTruncated): the button
 * still goes to the nearest FETCHED session, which is a useful place to
 * be, but it must not be described as the next one. The older step keeps
 * its own titles whatever the flag says - that request is anchored on
 * this session, so its first rows are the nearest older ones by
 * construction, and "oldest in the window" is then a true claim.
 */
const REPLAY_USER_SESSIONS_TRUNCATED_TITLE: string =
  "More sessions than the switcher can show; open the session list for this user";

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
    const visitorId: string = props.identity.visitorId ?? "";

    if (visitorId.length > 0) {
      /*
       * Six hex characters is what a person can hold in their head while
       * comparing two rows; the full id is a random token the menu below
       * already groups by, so nothing is lost by shortening it here.
       */
      identityText = `Visitor ${visitorId.slice(0, 6)}`;
      identityTitle =
        "Anonymous visitor. The recorder links this browser's sessions with a random id so you can follow one person without identify().";
      identityClassName = "text-gray-700";
    } else {
      identityText = "Anonymous";
      identityTitle = "The page did not call OneUptimeReplay.identify().";
      identityClassName = "text-gray-600";
    }
  } else {
    identityText = props.identity.label;
    identityTitle = props.identity.label;
    identityClassName = "font-semibold text-gray-900";
  }

  /* ---- Other sessions of this user. ---- */

  const userSessions: ReplayUserSessionsState | null =
    props.userSessions ?? null;
  const adjacentUserSessions: ReplayAdjacentUserSessions =
    useMemo((): ReplayAdjacentUserSessions => {
      if (!userSessions || userSessions.status !== "ready") {
        return { newer: null, older: null };
      }

      return findAdjacentUserSessions(
        userSessions.sessions,
        userSessions.currentSessionId,
      );
    }, [userSessions]);

  const { onOpenUserSession } = props;

  const openOlderUserSession: () => void = useCallback((): void => {
    if (adjacentUserSessions.older && onOpenUserSession) {
      onOpenUserSession(adjacentUserSessions.older.sessionId);
    }
  }, [adjacentUserSessions, onOpenUserSession]);

  const openNewerUserSession: () => void = useCallback((): void => {
    if (adjacentUserSessions.newer && onOpenUserSession) {
      onOpenUserSession(adjacentUserSessions.newer.sessionId);
    }
  }, [adjacentUserSessions, onOpenUserSession]);

  /*
   * What the identity row says about the lookup. Every branch renders
   * text: see the prop's comment on why silence is the wrong answer.
   */
  let userSessionsElement: ReactElement | null = null;

  if (userSessions) {
    if (userSessions.kind === "none") {
      userSessionsElement = (
        <span
          data-testid="replay-user-sessions-unavailable"
          className="text-xs text-gray-400"
          title="This session carries neither a user reference nor a visitor id, so its siblings cannot be found. Call OneUptimeReplay.identify() or update the recorder."
        >
          Not linked to other sessions
        </span>
      );
    } else if (
      userSessions.status === "loading" ||
      userSessions.status === "idle"
    ) {
      userSessionsElement = (
        <span
          className="text-xs text-gray-400"
          data-testid="replay-user-sessions-loading"
        >
          Finding other sessions…
        </span>
      );
    } else if (userSessions.status === "error") {
      userSessionsElement = (
        <span
          className="text-xs text-amber-700"
          data-testid="replay-user-sessions-error"
        >
          Couldn&apos;t load other sessions
        </span>
      );
    } else if (userSessions.sessions.length < 2) {
      userSessionsElement = (
        <span
          data-testid="replay-user-sessions-only"
          className="text-xs text-gray-500"
          title="No other session from this person in the 30 days before this one"
        >
          Only session in 30 days
        </span>
      );
    } else {
      userSessionsElement = (
        <React.Fragment>
          <ReplayUserSessionsMenu
            kind={userSessions.kind}
            sessions={userSessions.sessions}
            currentSessionId={userSessions.currentSessionId}
            isTruncated={userSessions.isTruncated}
            onOpenUserSession={(sessionId: string): void => {
              onOpenUserSession?.(sessionId);
            }}
          />
          <ReplayButtonGroup ariaLabel="Move between this user's sessions">
            <ReplayToolButton
              dataTestId="replay-user-session-older"
              icon={IconProp.ChevronLeft}
              variant="segment"
              ariaLabel="Older session"
              title={
                adjacentUserSessions.older
                  ? "Older session by this user ({)"
                  : "This is the oldest session in the window"
              }
              isDisabled={adjacentUserSessions.older === null}
              onClick={openOlderUserSession}
            />
            <ReplayToolButton
              dataTestId="replay-user-session-newer"
              icon={IconProp.ChevronRight}
              variant="segment"
              ariaLabel="Newer session"
              title={
                userSessions.isTruncated
                  ? REPLAY_USER_SESSIONS_TRUNCATED_TITLE
                  : adjacentUserSessions.newer
                    ? "Newer session by this user (})"
                    : "This is the newest session in the window"
              }
              isDisabled={adjacentUserSessions.newer === null}
              onClick={openNewerUserSession}
            />
          </ReplayButtonGroup>
        </React.Fragment>
      );
    }
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

  const hasTabRow: boolean =
    props.tabs.length > 1 || Boolean(props.continueInTab);

  /* The dot between two runs of the facts row. Decorative, never read. */
  const separator: ReactElement = (
    <span aria-hidden="true" className="text-gray-300">
      ·
    </span>
  );

  return (
    <header
      data-testid="replay-header"
      className="mb-3 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm"
    >
      {/*
       * The card's visible "Session recording" title bought nothing a
       * viewer looking at a recording did not already know, and cost a
       * text-lg line. It stays as the region's heading for screen readers
       * and for the tests that name this landmark.
       */}
      <h2 className="sr-only">Session recording</h2>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <a
          href={props.backHref}
          onClick={handleBackClick}
          data-testid="replay-back-link"
          title="Back to the session list"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-sm font-medium text-gray-500 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon icon={IconProp.ArrowLeft} className="h-4 w-4" />
          All recordings
        </a>

        {/* ReplayToolbarDivider draws no responsive rule of its own. */}
        <span className="hidden sm:inline-flex">
          <ReplayToolbarDivider />
        </span>

        <div
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
          data-testid="replay-header-identity-row"
        >
          <span className="sr-only">User and device</span>
          <span
            data-testid="replay-header-user"
            className={`min-w-0 max-w-[18rem] truncate text-sm ${identityClassName}`}
            title={identityTitle}
          >
            {identityText}
          </span>
          {traitCount > 0 && (
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              title="Open the details panel to read the traits"
              onClick={props.onOpenDetails}
              data-testid="replay-header-traits"
            >
              {traitCount} trait{traitCount === 1 ? "" : "s"}
            </button>
          )}
          {userSessionsElement}
        </div>

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

        <div
          role="group"
          aria-label="Session recording controls"
          data-testid="replay-header-toolbar"
          className="flex w-full flex-wrap items-center justify-start gap-2 md:ml-auto md:w-auto md:justify-end"
        >
          <ReplayButtonGroup
            ariaLabel="Recording actions"
            dataTestId="replay-recording-actions"
            canWrap={true}
          >
            {props.pinControl}
            <ReplayToolButton
              dataTestId="replay-copy-link"
              label="Copy link"
              icon={IconProp.Link}
              variant="segment"
              title="Copy a link to this moment (c)"
              onClick={handleCopyLink}
            />
            <ReplayToolButton
              dataTestId="replay-open-details"
              label="Session details"
              icon={IconProp.Info}
              variant="segment"
              title="Session details (i)"
              onClick={props.onOpenDetails}
            />
          </ReplayButtonGroup>
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
        </div>
      </div>

      {/*
       * Everything the old card's definition list said, at one line of
       * text-xs. The labels are kept where a value cannot name itself.
       */}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        {props.facts.length > 0 && (
          <React.Fragment>
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
                        className="hidden text-gray-300 md:inline"
                      >
                        ·
                      </span>
                    )}
                    <span
                      className="hidden max-w-full truncate md:inline"
                      title={`${fact.label}: ${fact.value}`}
                      data-testid="replay-header-fact"
                    >
                      {fact.value}
                    </span>
                  </React.Fragment>
                );
              },
            )}
            {separator}
          </React.Fragment>
        )}

        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-gray-400">Recorded</span>
          <span
            className="min-w-0 truncate text-gray-700"
            data-testid="replay-header-started-at"
          >
            {startedAt ?? "Start time unavailable"}
          </span>
        </span>

        {separator}

        <span
          className="flex shrink-0 items-center gap-1"
          title={props.sessionId}
        >
          Session <span className="font-mono">{shortSessionId}</span>
          <button
            type="button"
            data-testid="replay-copy-session-id"
            title="Copy the session id"
            aria-label="Copy the session id"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={(): void => {
              copyValue(props.sessionId, "session-id");
            }}
          >
            <Icon icon={IconProp.Copy} className="h-3.5 w-3.5" />
          </button>
        </span>

        <span
          data-testid="replay-header-clock"
          className="flex min-w-0 shrink-0 items-center gap-1.5 tabular-nums md:ml-auto"
        >
          <span className="sr-only">Playback position</span>
          {wallClock && (
            <span
              className="font-mono font-semibold text-gray-900"
              title="Wall-clock time at the playhead"
              data-testid="replay-header-wall-clock"
            >
              {wallClock}
            </span>
          )}
          <span className="text-gray-500" title="Playhead / recording length">
            {offsetText}
          </span>
        </span>
      </div>

      {hasTabRow && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <ReplayTabSwitcher
            tabs={props.tabs}
            onSwitchTab={props.onSwitchTab}
            continueInTab={props.continueInTab}
            sessionDurationMs={props.sessionDurationMs ?? 0}
          />
        </div>
      )}

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
            ? "mt-1.5 text-xs font-medium text-emerald-700"
            : "sr-only"
        }
      >
        {copyState.status === "copied"
          ? COPY_KIND_COPY[copyState.kind].announcement
          : ""}
      </div>

      {copyState.status === "fallback" && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-700"
          data-testid="replay-copy-link-fallback"
        >
          <span>{COPY_KIND_COPY[copyState.kind].fallbackPrompt}</span>
          <input
            ref={fallbackInputRef}
            type="text"
            readOnly={true}
            value={copyState.value}
            aria-label={COPY_KIND_COPY[copyState.kind].fieldLabel}
            className="min-w-0 w-full flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-gray-800"
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
