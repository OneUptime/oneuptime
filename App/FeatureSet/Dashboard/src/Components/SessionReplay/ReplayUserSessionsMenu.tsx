import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import {
  ReplayUserSessionDescription,
  ReplayUserSessionItem,
  ReplayUserSessionsKind,
  describeReplayUserSession,
} from "./ReplayUserSessions";
import { ReplayPill, ReplayToolButton } from "./ReplayUi";

/*
 * The "N sessions" dropdown in the player's header: every recording of
 * the person being watched, newest first, with the one on screen marked
 * (github.com/OneUptime/oneuptime/issues/3705).
 *
 * The same shape as the speed menu in ReplayControls - a ReplayToolButton
 * trigger with the popup aria wiring, an absolutely positioned panel
 * that closes on an outside click - because a viewer who has learned one
 * menu in this chrome should not have to learn a second. It differs in
 * being a listbox rather than a radiogroup: choosing a session NAVIGATES
 * (the page remounts the player on the new session), so an option is an
 * action, not a setting, and arrow keys move focus without choosing.
 *
 * Presentational: the shell fetches and merges the list, decides what
 * "now" is, and owns the navigation. This file only draws and handles
 * the keys.
 */

export interface ReplayUserSessionsMenuProps {
  kind: ReplayUserSessionsKind;
  /* Newest first, the current session included. */
  sessions: Array<ReplayUserSessionItem>;
  currentSessionId: string;
  onOpenUserSession: (sessionId: string) => void;
  /*
   * The clock the relative times are printed against. Read once per
   * render by the shell so every row agrees on "now"; a test passes a
   * fixed value so "5 minutes ago" is stable.
   */
  nowUnixMs?: number | undefined;
}

function headerCopyFor(kind: ReplayUserSessionsKind): string {
  return kind === "visitor"
    ? "Sessions from this visitor · past 30 days"
    : "Sessions from this user · past 30 days";
}

const ReplayUserSessionsMenu: FunctionComponent<ReplayUserSessionsMenuProps> = (
  props: ReplayUserSessionsMenuProps,
): ReactElement => {
  const { sessions, currentSessionId, onOpenUserSession } = props;

  const {
    ref: menuRef,
    isComponentVisible: isOpen,
    setIsComponentVisible: setIsOpen,
  } = useComponentOutsideClick(false);
  const triggerRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);

  /*
   * One clock read per render rather than per row, so a list of forty
   * sessions cannot straddle a minute boundary and print "a minute ago"
   * above "just now" for two sessions that started in the same second.
   */
  const nowUnixMs: number = props.nowUnixMs ?? Date.now();

  const descriptions: Array<ReplayUserSessionDescription> = useMemo(() => {
    return sessions.map(
      (item: ReplayUserSessionItem): ReplayUserSessionDescription => {
        return describeReplayUserSession(item, nowUnixMs);
      },
    );
  }, [sessions, nowUnixMs]);

  const currentIndex: number = useMemo((): number => {
    return sessions.findIndex((item: ReplayUserSessionItem): boolean => {
      return item.sessionId === currentSessionId;
    });
  }, [sessions, currentSessionId]);

  const close: (shouldRefocusTrigger: boolean) => void = useCallback(
    (shouldRefocusTrigger: boolean): void => {
      setIsOpen(false);

      if (shouldRefocusTrigger) {
        triggerRef.current?.focus();
      }
    },
    [setIsOpen],
  );

  /*
   * Choosing the session already on screen is not a navigation: the
   * page would remount the player on the same key and restart playback
   * from zero, which is the one thing a viewer who mis-clicked the
   * highlighted row does not want.
   */
  const select: (sessionId: string) => void = useCallback(
    (sessionId: string): void => {
      close(sessionId === currentSessionId);

      if (sessionId !== currentSessionId) {
        onOpenUserSession(sessionId);
      }
    },
    [close, currentSessionId, onOpenUserSession],
  );

  /*
   * Focus lands on the current session when the menu opens - the viewer
   * is "here", and one ArrowDown is the older session, one ArrowUp the
   * newer, matching the buttons beside the trigger. Only on open, so a
   * list refresh while the menu is up does not yank focus.
   */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const index: number = currentIndex >= 0 ? currentIndex : 0;

    itemRefs.current[index]?.focus();
  }, [isOpen]);

  const handleListKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const focusedIndex: number = itemRefs.current.findIndex(
        (element: HTMLButtonElement | null): boolean => {
          return element !== null && element === document.activeElement;
        },
      );
      let nextIndex: number | null = null;

      if (event.key === "ArrowDown") {
        nextIndex = Math.min(sessions.length - 1, focusedIndex + 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(0, focusedIndex - 1);
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = sessions.length - 1;
      } else if (event.key === "Escape") {
        /*
         * Stopped here so the player's window listener does not ALSO
         * read it as its own Escape (close the details panel, leave
         * theater, clear the rail selection).
         */
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      } else if (event.key === "Enter" || event.key === " ") {
        /*
         * Handled explicitly rather than left to the button's native
         * activation so the keydown is consumed here: Space would
         * otherwise ALSO reach the window listener as play/pause the
         * moment the menu closed and focus moved.
         */
        const focused: ReplayUserSessionItem | undefined =
          focusedIndex >= 0 ? sessions[focusedIndex] : undefined;

        if (focused) {
          event.preventDefault();
          event.stopPropagation();
          select(focused.sessionId);
        }

        return;
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      itemRefs.current[nextIndex]?.focus();
    },
    [sessions, close, select],
  );

  const count: number = sessions.length;
  const kindNoun: string = props.kind === "visitor" ? "visitor" : "user";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <ReplayToolButton
        ref={triggerRef}
        dataTestId="replay-user-sessions-button"
        label={`${count} sessions`}
        variant="ghost"
        tone="accent"
        trailingIcon={IconProp.ChevronDown}
        hasPopup={true}
        isExpanded={isOpen}
        ariaLabel={`${count} sessions by this ${kindNoun}; open the list`}
        title={`Every session from this ${kindNoun} in the past 30 days`}
        onClick={(): void => {
          setIsOpen(!isOpen);
        }}
      />

      {isOpen && (
        <div
          data-testid="replay-user-sessions-menu"
          className="absolute left-0 z-20 mt-1 w-[26rem] max-w-[90vw] rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
        >
          <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {headerCopyFor(props.kind)}
          </div>
          <div
            role="listbox"
            aria-label={`Sessions from this ${kindNoun}`}
            className="max-h-80 overflow-y-auto"
            onKeyDown={handleListKeyDown}
          >
            {sessions.map(
              (item: ReplayUserSessionItem, index: number): ReactElement => {
                const description: ReplayUserSessionDescription =
                  descriptions[index] ?? describeReplayUserSession(item, nowUnixMs);
                const isCurrent: boolean = index === currentIndex;

                return (
                  <button
                    key={item.sessionId}
                    ref={(element: HTMLButtonElement | null): void => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    tabIndex={
                      isCurrent || (currentIndex < 0 && index === 0) ? 0 : -1
                    }
                    data-testid="replay-user-session-item"
                    data-session-id={item.sessionId}
                    title={
                      isCurrent
                        ? "The session you are watching"
                        : `Open session ${item.sessionId.slice(0, 8)}`
                    }
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isCurrent ? "bg-indigo-50" : ""
                    }`}
                    onClick={(): void => {
                      select(item.sessionId);
                    }}
                  >
                    <span className="w-28 shrink-0">
                      <span className="block text-sm font-medium text-gray-900">
                        {description.when}
                      </span>
                      <span className="block text-[11px] text-gray-500">
                        {description.absolute}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm text-gray-700"
                        title={item.entryUrl || undefined}
                      >
                        {description.path || "Unknown page"}
                      </span>
                      {description.deviceHint.length > 0 && (
                        <span className="block text-[11px] text-gray-500">
                          {description.deviceHint}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {isCurrent && (
                        <ReplayPill tone="accent">Watching</ReplayPill>
                      )}
                      {!item.isFinalized && (
                        <span
                          role="img"
                          aria-label="Recording now"
                          title="Still being recorded"
                          data-testid="replay-user-session-live"
                          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500"
                        />
                      )}
                      {item.errorCount > 0 && (
                        <span
                          data-testid="replay-user-session-errors"
                          title={`${item.errorCount} error${
                            item.errorCount === 1 ? "" : "s"
                          } in this session`}
                          className="rounded-full bg-rose-50 px-1.5 text-[11px] font-medium text-rose-700"
                        >
                          {item.errorCount}
                        </span>
                      )}
                      <span className="font-mono text-xs tabular-nums text-gray-600">
                        {description.duration}
                      </span>
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReplayUserSessionsMenu;
