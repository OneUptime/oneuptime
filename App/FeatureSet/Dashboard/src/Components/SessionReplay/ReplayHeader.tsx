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
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
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
 * Recording context uses the same card and actions as other detail pages.
 * Playback-specific controls stay with the recording surface below it.
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

  const tabRefs: React.MutableRefObject<Map<string, HTMLButtonElement>> =
    useRef<Map<string, HTMLButtonElement>>(new Map());

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

  const focusableTabs: Array<ReplayHeaderTab> = props.tabs.filter(
    (tab: ReplayHeaderTab): boolean => {
      return tab.hasFootage;
    },
  );
  const focusableTabId: string | undefined =
    focusableTabs.find((tab: ReplayHeaderTab): boolean => {
      return tab.isActive;
    })?.tabId ?? focusableTabs[0]?.tabId;

  const handleTabKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ): void => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      focusableTabs.length === 0
    ) {
      return;
    }

    const currentIndex: number = focusableTabs.findIndex(
      (tab: ReplayHeaderTab): boolean => {
        return tab.tabId === tabId;
      },
    );
    let nextIndex: number;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % focusableTabs.length;
        break;
      case "ArrowLeft":
        nextIndex =
          (currentIndex - 1 + focusableTabs.length) % focusableTabs.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = focusableTabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const nextTab: ReplayHeaderTab | undefined = focusableTabs[nextIndex];

    if (nextTab) {
      tabRefs.current.get(nextTab.tabId)?.focus();

      if (!nextTab.isActive) {
        props.onSwitchTab(nextTab.tabId);
      }
    }
  };

  return (
    <header data-testid="replay-header" className="mb-5 min-w-0">
      <a
        href={props.backHref}
        onClick={handleBackClick}
        data-testid="replay-back-link"
        title="Back to the session list"
        className="mb-3 inline-flex items-center gap-2 rounded-md text-sm font-medium text-gray-500 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon icon={IconProp.ArrowLeft} className="h-4 w-4" />
        All recordings
      </a>

      <Card
        className="mb-0"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Session recording
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
          </span>
        }
        bodyClassName="mt-3"
        buttons={[
          ...(props.pinControl ? [props.pinControl] : []),
          <Button
            key="copy-link"
            dataTestId="replay-copy-link"
            title="Copy link"
            icon={IconProp.Link}
            tooltip="Copy a link to this moment (c)"
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={handleCopyLink}
          />,
          <Button
            key="details"
            dataTestId="replay-open-details"
            title="Session details"
            icon={IconProp.Info}
            tooltip="Session details (i)"
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={props.onOpenDetails}
          />,
          <ReplayButtonGroup key="layout" ariaLabel="Player layout">
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
          </ReplayButtonGroup>,
        ]}
      >
        <div>
          <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 xl:grid-cols-3">
            <div className="col-span-2 min-w-0 xl:col-span-1">
              <dt className="text-xs font-medium text-gray-500">
                User and device
              </dt>
              <dd className="mt-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    data-testid="replay-header-user"
                    className={`min-w-0 truncate text-sm ${identityClassName}`}
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
                </div>
                {props.facts.length > 0 && (
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
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
                  </div>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-gray-500">Recorded</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {startedAt ?? "Start time unavailable"}
                <span
                  className="mt-1 flex items-center gap-1 text-xs text-gray-500"
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
              </dd>
            </div>
            <div
              data-testid="replay-header-clock"
              className="min-w-0 tabular-nums"
            >
              <dt className="text-xs font-medium text-gray-500">
                Playback position
              </dt>
              <dd className="mt-1">
                {wallClock && (
                  <span
                    className="font-mono text-sm font-semibold text-gray-900"
                    title="Wall-clock time at the playhead"
                    data-testid="replay-header-wall-clock"
                  >
                    {wallClock}
                  </span>
                )}
                <span
                  className="mt-1 block text-xs text-gray-500"
                  title="Playhead / recording length"
                >
                  {offsetText}
                </span>
              </dd>
            </div>
          </dl>

          {(props.tabs.length > 1 || props.continueInTab) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
              <div className="min-w-0 flex-1">
                {props.tabs.length > 1 ? (
                  <div
                    role="tablist"
                    aria-label="Browser tabs in this recording"
                    className="flex items-center gap-1 overflow-x-auto"
                  >
                    {props.tabs.map((tab: ReplayHeaderTab): ReactElement => {
                      return (
                        <button
                          key={tab.tabId}
                          ref={(element: HTMLButtonElement | null): void => {
                            if (element) {
                              tabRefs.current.set(tab.tabId, element);
                            } else {
                              tabRefs.current.delete(tab.tabId);
                            }
                          }}
                          type="button"
                          role="tab"
                          aria-selected={tab.isActive}
                          tabIndex={tab.tabId === focusableTabId ? 0 : -1}
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
                          onKeyDown={(
                            event: React.KeyboardEvent<HTMLButtonElement>,
                          ): void => {
                            handleTabKeyDown(event, tab.tabId);
                          }}
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
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                    <Icon icon={IconProp.Window} className="h-4 w-4" />
                    {props.tabs[0]?.label ?? "Browser recording"}
                  </span>
                )}
                {props.continueInTab && (
                  <button
                    type="button"
                    data-testid="replay-continue-in-tab"
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    title="This tab has played out; the session continues in another tab"
                    onClick={(): void => {
                      props.onSwitchTab(props.continueInTab?.tabId ?? "");
                    }}
                  >
                    <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
                    Continue in {props.continueInTab.label}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

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
