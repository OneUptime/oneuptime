import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryDetailPanel, {
  TelemetryDetailPanelTab,
} from "Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SessionReplayGap,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode, {
  doesMaskingModeRecordReadableContent,
} from "Common/Types/Rum/SessionReplayMaskingMode";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ExceptionGroupSummary,
  indexExceptionGroupsByFingerprint,
} from "../../Utils/ExceptionCorrelation";
import {
  ReplayExceptionGroupLink,
  buildReplayExceptionGroupLinks,
  formatReplayClockSkew,
  formatReplayMilliseconds,
  getReplayConsentStateLabel,
  getReplayPanelWidthClassName,
  getReplayTriggerReasonLabel,
} from "../../Utils/ReplayCorrelation";
import {
  FidelityNoticeCopy,
  SealedReasonCopy,
  getFidelityNoticeCopy,
  getFidelityNoticeSeverity,
  getSealedReasonCopy,
} from "./FidelityNoticeCopy";
import { MASKING_MODE_LABELS, labelEnum } from "./RecordingHealthCard";
import { ReplayRailTabId } from "./Rail/ReplaySignalTypes";
import {
  getReplayClientLabel,
  getReplayEventFormatLabel,
  getReplayRecorderKindLabel,
  isMobileSessionReplay,
} from "./ReplayRecorderKind";
import { copyTextToClipboard } from "./ReplayHeader";
import { DEVICE_TYPE_OPTIONS } from "./SessionReplayFilterFields";

/*
 * Everything the player knows about a session that is not the picture and
 * is not a moment: provenance, privacy, and - most importantly - what was
 * NOT captured.
 *
 * Three tabs only. The old Logs / Errors / Correlation tabs embedded a
 * second copy of the logs viewer and the exceptions table in a drawer with
 * no clock; the rail beside the stage now shows the same rows on the
 * session clock, so this panel points at the rail ("Open in rail") instead
 * of competing with it.
 *
 * Built on TelemetryViewer's TelemetryDetailPanel rather than a hand-rolled
 * fixed div, so it inherits Escape-to-close and the tab chrome the rest of
 * the telemetry surfaces already use, and so the player keeps a controlled
 * activeTabId it can restore.
 */

import type { ReplaySessionDetails } from "./ReplaySessionDetails";

export type ReplayCorrelationPanelTabId = "session" | "provenance" | "fidelity";

export const REPLAY_CORRELATION_PANEL_TAB_IDS: ReadonlyArray<ReplayCorrelationPanelTabId> =
  ["session", "provenance", "fidelity"];

/*
 * The details shape lives in ReplaySessionDetails.ts, which imports no
 * React, so the manifest builder can produce one without this module.
 */
export type { ReplaySessionDetails };

/*
 * How many correlated ids the session header keeps, as the copy under the
 * lists quotes them. Server constants, so they are restated rather than
 * imported (no replay Dashboard file may import server code); a test reads
 * the server sources and fails when either side moves:
 *  - live: PROVISIONAL_HEADER_MAX_TRACE_IDS in SessionReplayIngestService
 *    (the provisional header carries no exception groups at all);
 *  - finalized: MAX_TRACE_IDS_PER_SESSION and
 *    MAX_EXCEPTION_FINGERPRINTS_PER_SESSION in the FinalizeSessions job.
 * The copy used to quote a flat cap of 50, which neither number was.
 */
export const REPLAY_HEADER_LIVE_TRACE_ID_CAP: number = 100;
export const REPLAY_HEADER_FINAL_TRACE_ID_CAP: number = 200;
export const REPLAY_HEADER_EXCEPTION_GROUP_CAP: number = 100;

/*
 * Counts the rail has already fetched, so the Session tab can say "37 logs"
 * without a second request. null (or absent) means "not fetched yet" and
 * renders as such - never as 0.
 */
export type ReplayRailCounts = Partial<Record<ReplayRailTabId, number | null>>;

export interface ReplayCorrelationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  sessionId: string;
  details: ReplaySessionDetails;
  /*
   * Every tab of this unfinalized session has closed
   * (SessionReplayManifest.hasRecordingEnded). It decides what "How the
   * recording ended" may say before the finalizer has run: a live
   * session's provisional header can carry "final-chunk" from a page the
   * user already navigated away from, so its sealed reason is only quoted
   * once the recording has really ended. A prop rather than a details
   * field so the details shape (ReplaySessionDetails.ts) stays the
   * manifest's header as served. Absent reads as false.
   */
  hasRecordingEnded?: boolean | undefined;
  fidelityNotices: Array<string>;
  /*
   * Assets the recorder could not capture. Optional because nothing on the
   * server produces them yet (player-shell-18): the shell was passing []
   * only to satisfy a required prop, which read as "we checked and there
   * are none" rather than "nobody measured".
   */
  missingAssets?: Array<string> | undefined;
  gaps: Array<SessionReplayGap>;
  /* Opens the rail on a tab (and closes nothing - the host decides). */
  onOpenRailTab?: ((tabId: ReplayRailTabId) => void) | undefined;
  railCounts?: ReplayRailCounts | undefined;
  /*
   * How bare exception fingerprints become readable groups. Injected so
   * the lookup can be replaced (and so this component stays renderable
   * without a server); the default asks the exceptions API once.
   */
  resolveExceptionGroups?:
    | ((
        fingerprints: Array<string>,
      ) => Promise<Map<string, ExceptionGroupSummary>>)
    | undefined;
}

/* The default lookup: one request for the whole (<= 50) fingerprint set. */
export async function fetchExceptionGroupsByFingerprint(
  fingerprints: Array<string>,
): Promise<Map<string, ExceptionGroupSummary>> {
  const result: ListResult<TelemetryException> =
    await ModelAPI.getList<TelemetryException>({
      modelType: TelemetryException,
      query: {
        fingerprint: new Includes(fingerprints),
      },
      limit: fingerprints.length,
      skip: 0,
      select: {
        _id: true,
        fingerprint: true,
        exceptionType: true,
        message: true,
      },
      sort: {},
    });

  return indexExceptionGroupsByFingerprint(result.data);
}

interface DetailRowProps {
  label: string;
  value: ReactNode;
  testId?: string | undefined;
  mono?: boolean | undefined;
}

const DetailRow: FunctionComponent<DetailRowProps> = (
  props: DetailRowProps,
): ReactElement => {
  const hasValue: boolean =
    props.value !== null &&
    props.value !== undefined &&
    !(typeof props.value === "string" && props.value.trim().length === 0);

  return (
    <div
      className="grid gap-1 border-b border-gray-100 py-3 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
      data-testid={props.testId}
    >
      <dt className="text-xs font-medium text-gray-500">{props.label}</dt>
      <dd
        className={`min-w-0 break-words text-sm text-gray-900 ${
          props.mono ? "font-mono text-xs" : ""
        }`}
      >
        {hasValue ? props.value : "—"}
      </dd>
    </div>
  );
};

interface DetailCopyButtonProps {
  value: string;
  title: string;
  className?: string | undefined;
}

const DETAIL_COPY_FEEDBACK_MS: number = 1000;

/* Compact copy control with inline SVG, so its button markup stays valid. */
const DetailCopyButton: FunctionComponent<DetailCopyButtonProps> = (
  props: DetailCopyButtonProps,
): ReactElement => {
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "pending" | "copied" | "unavailable"
  >("idle");
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const triggerRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const requestIdRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (copyStatus === "unavailable") {
      fallbackInputRef.current?.focus();
      fallbackInputRef.current?.select();
    }
  }, [copyStatus]);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    const requestId: number = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setCopyStatus("pending");
    const isCopied: boolean = await copyTextToClipboard(props.value);

    if (requestId !== requestIdRef.current) {
      return;
    }

    if (!isCopied) {
      setCopyStatus("unavailable");
      return;
    }

    setCopyStatus("copied");
    timerRef.current = setTimeout((): void => {
      timerRef.current = null;
      setCopyStatus("idle");
    }, DETAIL_COPY_FEEDBACK_MS);
  };

  const isCopied: boolean = copyStatus === "copied";
  const isPending: boolean = copyStatus === "pending";
  const isUnavailable: boolean = copyStatus === "unavailable";
  const accessibleLabel: string = isCopied
    ? "Copied"
    : isPending
      ? "Copying"
      : isUnavailable
        ? "Clipboard unavailable. Select the displayed value to copy it."
        : props.title;
  const valueLabel: string = props.title.replace(/^Copy\s+/, "");

  return (
    <div className={`relative inline-flex shrink-0 ${props.className || ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex h-8 shrink-0 items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
          isCopied
            ? "w-8 border-emerald-200 bg-emerald-50 text-emerald-600"
            : isUnavailable
              ? "gap-1.5 border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-700 hover:bg-amber-100"
              : isPending
                ? "w-8 cursor-wait border-gray-200 bg-gray-50 text-gray-400"
                : "w-8 border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:text-gray-600"
        }`}
        onClick={(): void => {
          void handleCopy();
        }}
        disabled={isPending}
        aria-busy={isPending || undefined}
        title={accessibleLabel}
        aria-label={accessibleLabel}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          {isCopied ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
            />
          )}
        </svg>
        {isUnavailable && <span>Copy unavailable</span>}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {isCopied
          ? `${valueLabel} copied.`
          : isUnavailable
            ? "Clipboard unavailable. The value is selected for manual copy."
            : ""}
      </span>
      {isUnavailable && (
        <div
          role="group"
          aria-label={`Manual copy help for ${valueLabel}`}
          className="absolute right-0 top-10 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-amber-200 bg-white p-2.5 text-xs text-gray-700 shadow-lg"
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setCopyStatus("idle");
              triggerRef.current?.focus();
            }
          }}
        >
          <div className="mb-1.5 font-medium text-amber-800">
            Clipboard unavailable. Copy manually:
          </div>
          <input
            ref={fallbackInputRef}
            type="text"
            readOnly={true}
            value={props.value}
            aria-label={`Manual copy ${valueLabel}`}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-[11px] text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onFocus={(event: React.FocusEvent<HTMLInputElement>): void => {
              event.currentTarget.select();
            }}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="rounded px-1.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={(): void => {
                setCopyStatus("idle");
                triggerRef.current?.focus();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface DetailSectionProps {
  title: string;
  description?: string | undefined;
  icon: IconProp;
  children: ReactNode;
  testId: string;
  badge?: number | undefined;
}

/* A consistent, scannable card for each kind of session metadata. */
const DetailSection: FunctionComponent<DetailSectionProps> = (
  props: DetailSectionProps,
): ReactElement => {
  const headingId: string = `${props.testId}-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="relative rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid={props.testId}
      data-section-icon={props.icon}
    >
      <div className="flex items-start gap-3 rounded-t-xl border-b border-gray-100 bg-gray-50/70 px-4 py-3">
        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Icon
            icon={props.icon}
            className="h-4 w-4"
            data-testid={`${props.testId}-icon`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 id={headingId} className="text-sm font-semibold text-gray-900">
              {props.title}
            </h3>
            {props.badge !== undefined && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gray-600">
                {props.badge}
              </span>
            )}
          </div>
          {props.description && (
            <p className="mt-0.5 text-xs leading-5 text-gray-500">
              {props.description}
            </p>
          )}
        </div>
      </div>
      <div className="px-4 py-1">{props.children}</div>
    </section>
  );
};

interface StringMapRowsProps {
  heading: string;
  map: Record<string, string>;
  testId: string;
}

/* Tags / traits: one row per key, in the order the recorder sent them. */
const StringMapRows: FunctionComponent<StringMapRowsProps> = (
  props: StringMapRowsProps,
): ReactElement => {
  return (
    <div className="border-t border-gray-100 py-3" data-testid={props.testId}>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {props.heading} ({Object.keys(props.map).length})
      </h4>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Object.keys(props.map).map((key: string): ReactElement => {
          return (
            <div
              key={key}
              className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
              data-testid={`${props.testId}-row`}
            >
              <dt className="truncate text-[11px] font-medium text-gray-500">
                {key}
              </dt>
              <dd className="mt-0.5 break-words text-xs text-gray-900">
                {props.map[key] || "—"}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
};

/** Only make recorder-provided URLs clickable when their scheme is safe. */
export function getReplayDetailsExternalUrl(value: string): string | null {
  const trimmed: string = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed: URL = new URL(trimmed);

    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

interface UrlDetailProps {
  label: string;
  value: string;
  testId: string;
}

const UrlDetail: FunctionComponent<UrlDetailProps> = (
  props: UrlDetailProps,
): ReactElement => {
  const externalUrl: string | null = getReplayDetailsExternalUrl(props.value);

  return (
    <div
      className="border-b border-gray-100 py-3 last:border-b-0"
      data-testid={props.testId}
    >
      <div className="mb-1.5 text-xs font-medium text-gray-500">
        {props.label}
      </div>
      <div className="flex min-w-0 items-start gap-2">
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex min-w-0 flex-1 items-start gap-1.5 rounded-md text-sm text-indigo-700 outline-none hover:text-indigo-900 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            aria-label={`${props.label}: ${props.value} (opens in a new tab)`}
            title={props.value}
          >
            <span className="min-w-0 break-all">{props.value}</span>
            <Icon
              icon={IconProp.ExternalLink}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400 group-hover:text-indigo-600"
            />
          </a>
        ) : (
          <span className="min-w-0 flex-1 break-all text-sm text-gray-900">
            {props.value || "—"}
          </span>
        )}
        {props.value && (
          <DetailCopyButton
            value={props.value}
            title={`Copy ${props.label}`}
            className="shrink-0"
          />
        )}
      </div>
    </div>
  );
};

interface EnvironmentTileProps {
  label: string;
  value: string;
  icon: IconProp;
  testId: string;
}

const EnvironmentTile: FunctionComponent<EnvironmentTileProps> = (
  props: EnvironmentTileProps,
): ReactElement => {
  return (
    <div
      className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
      data-testid={props.testId}
      data-tile-icon={props.icon}
    >
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
        <Icon icon={props.icon} className="h-3.5 w-3.5 text-gray-400" />
        {props.label}
      </dt>
      <dd
        className="mt-1 truncate text-sm font-medium text-gray-900"
        title={props.value}
      >
        {props.value || "—"}
      </dd>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) {
    return "—";
  }

  const units: Array<string> = ["B", "KiB", "MiB", "GiB"];
  let value: number = bytes;
  let index: number = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(1)} ${units[index]}`;
}

function hasEntries(
  map: Record<string, string> | null | undefined,
): map is Record<string, string> {
  return Boolean(map) && Object.keys(map as Record<string, string>).length > 0;
}

interface RailPointerRowProps {
  label: string;
  /* null: not fetched yet. */
  count: number | null;
  railTab: ReplayRailTabId;
  onOpenRailTab: ((tabId: ReplayRailTabId) => void) | undefined;
}

/*
 * "37 logs - Open in rail". The count is a fact only once something fetched
 * it; before that the row says so instead of showing a 0 that would read as
 * "none".
 */
const RailPointerRow: FunctionComponent<RailPointerRowProps> = (
  props: RailPointerRowProps,
): ReactElement => {
  const icon: IconProp =
    props.railTab === "traces"
      ? IconProp.FlowDiagram
      : props.railTab === "errors"
        ? IconProp.Error
        : IconProp.Logs;

  const content: ReactElement = (
    <React.Fragment>
      <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-gray-500 ring-1 ring-inset ring-gray-200">
        <Icon icon={icon} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        {props.count === null ? (
          <React.Fragment>
            <span className="block text-sm font-semibold capitalize text-gray-900">
              {props.label}
            </span>
            <span className="block text-xs text-gray-500">Not fetched yet</span>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <span className="block text-sm text-gray-900">
              <span className="font-semibold tabular-nums">{props.count}</span>{" "}
              {props.label}
            </span>
            <span className="block text-xs text-gray-500">
              View on timeline
            </span>
          </React.Fragment>
        )}
      </div>
      {props.onOpenRailTab && (
        <Icon
          icon={IconProp.ArrowRight}
          className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-600"
        />
      )}
    </React.Fragment>
  );

  return (
    <div
      className={`group relative flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 transition-colors ${
        props.onOpenRailTab
          ? "hover:border-indigo-200 hover:bg-indigo-50/50 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-2"
          : ""
      }`}
      data-testid={`details-rail-${props.railTab}`}
    >
      {content}
      {props.onOpenRailTab && (
        <button
          type="button"
          className="absolute inset-0 rounded-lg focus:outline-none"
          data-testid={`details-open-rail-${props.railTab}`}
          aria-label={`Open ${props.label} in rail`}
          title="Open in rail"
          onClick={(): void => {
            props.onOpenRailTab?.(props.railTab);
          }}
        >
          <span className="sr-only">Open {props.label} in rail</span>
        </button>
      )}
    </div>
  );
};

const ReplayCorrelationPanel: FunctionComponent<ReplayCorrelationPanelProps> = (
  props: ReplayCorrelationPanelProps,
): ReactElement | null => {
  const d: ReplaySessionDetails = props.details;

  /*
   * correlation-7: the header carries bare fingerprints, and a hash tells
   * a viewer nothing about what broke. The groups are resolved in ONE
   * request when the panel opens, so each entry can be titled with the
   * error and linked straight to it. Until (or unless) that lands the
   * entries still render, with the short-hash label and the
   * fingerprint-filtered list route - a lookup failure loses the label,
   * never the link.
   */
  const [exceptionGroups, setExceptionGroups] = useState<Map<
    string,
    ExceptionGroupSummary
  > | null>(null);

  const fingerprintKey: string = d.exceptionFingerprints.join(",");
  const { resolveExceptionGroups } = props;

  useEffect(() => {
    if (!props.isOpen || d.exceptionFingerprints.length === 0) {
      return;
    }

    let isCancelled: boolean = false;
    const resolve: (
      fingerprints: Array<string>,
    ) => Promise<Map<string, ExceptionGroupSummary>> =
      resolveExceptionGroups || fetchExceptionGroupsByFingerprint;

    void (async (): Promise<void> => {
      try {
        const groups: Map<string, ExceptionGroupSummary> = await resolve(
          d.exceptionFingerprints,
        );

        if (!isCancelled) {
          setExceptionGroups(groups);
        }
      } catch {
        /*
         * Read permission on exceptions is a separate grant from replay,
         * so a denial here is expected rather than exceptional. The links
         * stay, unlabelled.
         */
        if (!isCancelled) {
          setExceptionGroups(new Map<string, ExceptionGroupSummary>());
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
    /* Re-run only when the set of fingerprints actually changes. */
  }, [props.isOpen, fingerprintKey, resolveExceptionGroups]);

  const fingerprintLinks: Array<ReplayExceptionGroupLink> = useMemo(() => {
    return buildReplayExceptionGroupLinks({
      fingerprints: d.exceptionFingerprints,
      groups: exceptionGroups,
      exceptionsListRoute: RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
      ),
      exceptionViewRouteForId: (id: string): Route => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
          { modelId: id },
        );
      },
    });
  }, [d.exceptionFingerprints, exceptionGroups]);

  const railCounts: ReplayRailCounts = props.railCounts || {};

  const logsCount: number | null =
    typeof railCounts.logs === "number" ? railCounts.logs : null;
  const tracesCount: number | null =
    typeof railCounts.traces === "number"
      ? railCounts.traces
      : d.traceIds.length;
  const errorsCount: number | null =
    typeof railCounts.errors === "number"
      ? railCounts.errors
      : d.exceptionFingerprints.length;

  /*
   * Identity copy. null and "" mean different things (see the interface),
   * and the old form conflated them into "Shown on the session list", which
   * sent a viewer WITH the permission to another page for an answer this
   * one now has.
   */
  const endUserValue: string =
    d.identifiedUserLabel === null
      ? "Not shown - viewing identity needs the identity permission"
      : d.identifiedUserLabel ||
        "Anonymous - the page did not call OneUptimeReplay.identify()";

  const shortSessionId: string =
    props.sessionId.length > 12
      ? `${props.sessionId.slice(0, 12)}…`
      : props.sessionId;
  const isMobileReplay: boolean = isMobileSessionReplay(d.recorderKind);
  const clientLabel: "App" | "Browser" | "Client" = getReplayClientLabel(
    d.recorderKind,
  );
  const deviceTypeLabel: string =
    d.deviceType.toLowerCase() === "ios"
      ? "iOS"
      : d.deviceType.toLowerCase() === "android"
        ? "Android"
        : DEVICE_TYPE_OPTIONS.find((option: DropdownOption): boolean => {
            return option.value === d.deviceType;
          })?.label || d.deviceType;
  const deviceIcon: IconProp =
    isMobileReplay || d.deviceType === "mobile" || d.deviceType === "tablet"
      ? IconProp.DevicePhoneMobile
      : IconProp.ComputerDesktop;

  const sessionContent: ReactElement = (
    <div
      className="space-y-4 bg-gray-50/50 p-4"
      data-testid="details-tab-session"
    >
      <DetailSection
        title="Session"
        description="Identity and user context captured with this recording."
        icon={IconProp.Identification}
        testId="details-section-session"
      >
        <dl>
          <DetailRow
            label="Session ID"
            value={
              <div className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">
                  {props.sessionId}
                </span>
                <DetailCopyButton
                  value={props.sessionId}
                  title="Copy Session ID"
                  className="shrink-0"
                />
              </div>
            }
            testId="replay-details-session-id"
          />
          <DetailRow
            label="End user"
            value={endUserValue}
            testId="replay-details-end-user"
          />
        </dl>
        {hasEntries(d.identifiedUserTraits) && (
          <StringMapRows
            heading="Traits"
            map={d.identifiedUserTraits}
            testId="details-traits"
          />
        )}
        {hasEntries(d.tags) && (
          <StringMapRows heading="Tags" map={d.tags} testId="details-tags" />
        )}
      </DetailSection>

      <DetailSection
        title="Journey"
        description="The first and last pages observed during this session."
        icon={IconProp.GlobeAlt}
        testId="details-section-journey"
      >
        <UrlDetail
          label="Entry URL"
          value={d.entryUrl}
          testId="replay-details-entry-url"
        />
        <UrlDetail
          label="Exit URL"
          value={d.exitUrl}
          testId="replay-details-exit-url"
        />
      </DetailSection>

      <DetailSection
        title="Environment"
        description="Client and device information reported by the recorder."
        icon={deviceIcon}
        testId="details-section-environment"
      >
        <dl className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-2">
          <EnvironmentTile
            label={clientLabel}
            value={[d.browserName, d.browserVersion].filter(Boolean).join(" ")}
            icon={isMobileReplay ? IconProp.DevicePhoneMobile : IconProp.Window}
            testId="replay-details-browser"
          />
          <EnvironmentTile
            label="Operating system"
            value={d.osName}
            icon={deviceIcon}
            testId="replay-details-os"
          />
          <EnvironmentTile
            label="Device"
            value={deviceTypeLabel}
            icon={deviceIcon}
            testId="replay-details-device"
          />
          <EnvironmentTile
            label="Country"
            value={d.countryCode}
            icon={IconProp.MapPin}
            testId="replay-details-country"
          />
          <EnvironmentTile
            label="Viewport"
            value={
              d.viewportWidth && d.viewportHeight
                ? `${d.viewportWidth} × ${d.viewportHeight}`
                : ""
            }
            icon={IconProp.Expand}
            testId="replay-details-viewport"
          />
          <EnvironmentTile
            label="Recorded data"
            value={formatBytes(d.payloadBytes)}
            icon={IconProp.Database}
            testId="replay-details-payload"
          />
        </dl>
      </DetailSection>

      {/*
       * The coarse correlation lists from the header stay here for the
       * viewer who wants the ids; the rail is where they live on the clock.
       * Their caps are the ingest's and the finalizer's, quoted below.
       */}
      <DetailSection
        title="Related telemetry"
        description="Open signals correlated to this session on the replay timeline."
        icon={IconProp.Signal}
        testId="details-section-telemetry"
      >
        <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-3">
          <RailPointerRow
            label={tracesCount === 1 ? "trace" : "traces"}
            count={tracesCount}
            railTab="traces"
            onOpenRailTab={props.onOpenRailTab}
          />
          <RailPointerRow
            label={errorsCount === 1 ? "error" : "errors"}
            count={errorsCount}
            railTab="errors"
            onOpenRailTab={props.onOpenRailTab}
          />
          <RailPointerRow
            label={logsCount === 1 ? "log" : "logs"}
            count={logsCount}
            railTab="logs"
            onOpenRailTab={props.onOpenRailTab}
          />
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800 ring-1 ring-inset ring-blue-100">
          <Icon icon={IconProp.Info} className="mt-0.5 h-4 w-4 shrink-0" />
          {isMobileReplay ? (
            <p>
              Mobile traces and logs reach this rail when your OpenTelemetry
              instrumentation attaches this replay&apos;s{" "}
              <code>session.id</code>. Subscribe with{" "}
              <code>OneUptimeReplay.onSessionChange()</code> and update the
              attribute whenever the session rotates. The React Native SDK adds
              nothing to your app&apos;s own requests, so nothing links on its
              own.
            </p>
          ) : (
            <p data-testid="details-correlation-web">
              While a session uploads, requests the page makes to its own origin
              carry the session&apos;s trace context, so backend spans are
              stamped with its id at ingest and backend logs and exceptions join
              it by trace id - no code needed. An API on another origin links by
              trace id once it is listed in <em>Trace propagation origins</em>.{" "}
              <code>OneUptimeReplay.onSessionChange()</code> is optional, for
              stamping the page&apos;s own browser telemetry.
            </p>
          )}
        </div>

        {d.exceptionFingerprints.length > 0 && (
          <div className="border-t border-gray-100 py-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Exception groups ({d.exceptionFingerprints.length})
            </h4>
            <div className="space-y-1.5" data-testid="details-fingerprints">
              {fingerprintLinks.map(
                (link: ReplayExceptionGroupLink): ReactElement => {
                  if (!link.route) {
                    return (
                      <div
                        key={link.fingerprint}
                        className="truncate rounded-md bg-gray-50 px-2.5 py-2 text-xs text-gray-600"
                        title={link.fingerprint}
                      >
                        {link.label}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={link.fingerprint}
                      className="truncate rounded-md bg-gray-50 px-2.5 py-2 hover:bg-indigo-50"
                      /* The hash stays reachable, as the title. */
                      title={
                        link.isDirect
                          ? link.fingerprint
                          : `${link.fingerprint} - opens the exceptions list filtered to this group`
                      }
                    >
                      <AppLink
                        to={link.route}
                        className="text-xs font-medium text-indigo-700 hover:underline"
                      >
                        {link.label}
                      </AppLink>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}

        {d.traceIds.length > 0 && (
          <div className="border-t border-gray-100 py-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Trace IDs ({d.traceIds.length})
            </h4>
            <div className="space-y-1.5" data-testid="details-trace-ids">
              {d.traceIds.map((traceId: string): ReactElement => {
                return (
                  <div
                    key={traceId}
                    className="truncate rounded-md bg-gray-50 px-2.5 py-2 hover:bg-indigo-50"
                  >
                    <AppLink
                      to={
                        RouteUtil.populateRouteParams(
                          RouteMap[PageMap.TRACE_VIEW] as Route,
                          { modelId: traceId },
                        ) as Route
                      }
                      className="font-mono text-xs font-medium text-indigo-700 hover:underline"
                    >
                      {traceId}
                    </AppLink>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(d.traceIds.length > 0 || d.exceptionFingerprints.length > 0) && (
          <p
            className="border-t border-gray-100 py-3 text-[11px] leading-4 text-gray-500"
            data-testid="details-correlation-caps"
          >
            {`${
              d.isFinalized === false
                ? `While the session is live its header keeps at most ${REPLAY_HEADER_LIVE_TRACE_ID_CAP} trace IDs (${REPLAY_HEADER_FINAL_TRACE_ID_CAP} once it is finalized, with up to ${REPLAY_HEADER_EXCEPTION_GROUP_CAP} exception groups)`
                : `The session header keeps at most ${REPLAY_HEADER_FINAL_TRACE_ID_CAP} trace IDs and ${REPLAY_HEADER_EXCEPTION_GROUP_CAP} exception groups`
            }; the rail queries your telemetry directly, so it is not limited to these.`}
          </p>
        )}
      </DetailSection>
    </div>
  );

  const provenanceContent: ReactElement = (
    <div
      className="space-y-4 bg-gray-50/50 p-4"
      data-testid="details-tab-provenance"
    >
      <DetailSection
        title="Capture policy"
        description="What the recorder was allowed to collect in this session."
        icon={IconProp.ShieldCheck}
        testId="details-section-capture-policy"
      >
        <div className="py-3">
          {/*
           * Masking mode is the single most important field on this panel.
           * Every mode except MaskAllText means real page text - potentially
           * real personal data - was recorded.
           */}
          {doesMaskingModeRecordReadableContent(
            d.maskingMode as SessionReplayMaskingMode,
          ) ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-amber-900"
              data-testid="replay-details-readable-warning"
            >
              <Icon
                icon={IconProp.ShieldExclamation}
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
              />
              <div>
                <div className="text-sm font-semibold">
                  Readable page content was recorded
                </div>
                <p className="mt-0.5 text-xs leading-5 text-amber-800">
                  Any personal data rendered into the page is in this recording,
                  and{" "}
                  {d.maskingMode ===
                  SessionReplayMaskingMode.MaskSensitiveInputsOnly
                    ? "so is anything typed into a field the page did not declare as sensitive."
                    : "only input values were masked."}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-900"
              data-testid="replay-details-privacy-summary"
            >
              <Icon
                icon={IconProp.ShieldCheck}
                className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
              />
              <div>
                <div className="text-sm font-semibold">
                  Page content was masked
                </div>
                <p className="mt-0.5 text-xs leading-5 text-emerald-800">
                  Text and input values were replaced before this session left
                  the device.
                </p>
              </div>
            </div>
          )}

          <dl className="mt-2">
            {/*
             * ux-20: the product label, not a de-camel-cased enum. The
             * settings page and recording-health card use the same words.
             */}
            <DetailRow
              label="Masking mode"
              value={labelEnum(MASKING_MODE_LABELS, d.maskingMode)}
              testId="replay-details-masking-mode"
            />
            <DetailRow
              label="Consent"
              value={getReplayConsentStateLabel(d.consentState)}
              testId="replay-details-consent"
            />
            <DetailRow
              label="Why recorded"
              value={getReplayTriggerReasonLabel(d.triggerReason)}
              testId="replay-details-trigger"
            />
          </dl>
        </div>
      </DetailSection>

      <DetailSection
        title="Recorder"
        description="The client versions and capabilities that produced this recording."
        icon={IconProp.Code}
        testId="details-section-recorder"
      >
        <dl>
          <DetailRow
            label="Recording source"
            value={getReplayRecorderKindLabel(d.recorderKind)}
            testId="replay-details-recorder-kind"
          />
          <DetailRow label="Recorder version" value={d.recorderVersion} />
          <DetailRow
            label={getReplayEventFormatLabel(d.recorderKind)}
            value={d.rrwebVersion}
          />
          {d.recorderCapabilities && d.recorderCapabilities.length > 0 && (
            <DetailRow
              label="Capabilities"
              value={
                <span className="flex flex-wrap gap-1.5">
                  {d.recorderCapabilities.map(
                    (capability: string): ReactElement => {
                      return (
                        <span
                          key={capability}
                          className="rounded-md bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-700"
                        >
                          {capability}
                        </span>
                      );
                    },
                  )}
                </span>
              }
              testId="replay-details-capabilities"
            />
          )}
        </dl>
      </DetailSection>

      <DetailSection
        title="Timing"
        description="Clock alignment used to place backend telemetry on the replay timeline."
        icon={IconProp.Clock}
        testId="details-section-timing"
      >
        <dl>
          <DetailRow
            label="Client clock skew"
            value={formatReplayClockSkew(d.clockSkewMs)}
            testId="replay-details-skew"
          />
        </dl>
      </DetailSection>
    </div>
  );

  /*
   * Three states, not two. Finalized: the reason the finalizer wrote.
   * Not finalized but every tab closed: the reason the final chunk wrote
   * ("ended normally") is already true, with a note that the counts are
   * still to come. Not finalized and not ended: still recording, whatever
   * reason the provisional header happens to carry - "Recording ended
   * normally" beside a Live pill is the contradiction this avoids.
   */
  const isAwaitingFinalization: boolean = d.isFinalized === false;
  const hasRecordingEnded: boolean =
    isAwaitingFinalization && props.hasRecordingEnded === true;
  const isStillRecording: boolean =
    isAwaitingFinalization && !hasRecordingEnded;

  const sealedReasonCopy: SealedReasonCopy | null = isStillRecording
    ? null
    : getSealedReasonCopy(d.sealedReason);
  const sealedReasonTone: "info" | "success" | "warn" =
    sealedReasonCopy?.severity === "warn"
      ? "warn"
      : d.sealedReason === SessionReplaySealedReason.FinalChunk
        ? "success"
        : "info";
  const recordingStatusIcon: IconProp = isStillRecording
    ? IconProp.Clock
    : !sealedReasonCopy || sealedReasonTone === "info"
      ? IconProp.Info
      : sealedReasonTone === "warn"
        ? IconProp.Alert
        : IconProp.CheckCircle;

  /*
   * Playback problems first: "a stretch is unplayable" must not sit under
   * "web fonts not captured".
   */
  const orderedNotices: Array<string> = [...props.fidelityNotices].sort(
    (a: string, b: string): number => {
      const rank: (code: string) => number = (code: string): number => {
        return getFidelityNoticeSeverity(code) === "playback" ? 0 : 1;
      };

      return rank(a) - rank(b);
    },
  );

  const fidelityContent: ReactElement = (
    <div
      className="space-y-4 bg-gray-50/50 p-4"
      data-testid="details-tab-fidelity"
    >
      <DetailSection
        title="Recording status"
        description="How capture ended and whether final processing is complete."
        icon={recordingStatusIcon}
        testId="details-section-recording-status"
      >
        <div className="py-3">
          {sealedReasonCopy ? (
            <div
              className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${
                sealedReasonTone === "warn"
                  ? "border-amber-200 bg-amber-50"
                  : sealedReasonTone === "success"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-blue-200 bg-blue-50"
              }`}
              data-testid="replay-details-sealed-reason"
              data-tone={sealedReasonTone}
              data-state-icon={
                sealedReasonTone === "warn"
                  ? "alert"
                  : sealedReasonTone === "success"
                    ? "check-circle"
                    : "info"
              }
            >
              <Icon
                icon={
                  sealedReasonTone === "warn"
                    ? IconProp.Alert
                    : sealedReasonTone === "success"
                      ? IconProp.CheckCircle
                      : IconProp.Info
                }
                className={`mt-0.5 h-5 w-5 shrink-0 ${
                  sealedReasonTone === "warn"
                    ? "text-amber-600"
                    : sealedReasonTone === "success"
                      ? "text-emerald-600"
                      : "text-blue-600"
                }`}
              />
              <div>
                <div
                  className={`text-sm font-semibold ${
                    sealedReasonTone === "warn"
                      ? "text-amber-900"
                      : sealedReasonTone === "success"
                        ? "text-emerald-900"
                        : "text-blue-900"
                  }`}
                >
                  {sealedReasonCopy.title}
                </div>
                <p
                  className={`mt-0.5 text-xs leading-5 ${
                    sealedReasonTone === "warn"
                      ? "text-amber-800"
                      : sealedReasonTone === "success"
                        ? "text-emerald-800"
                        : "text-blue-800"
                  }`}
                >
                  {sealedReasonCopy.description}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
              data-testid="replay-details-sealed-reason"
            >
              <Icon
                icon={isStillRecording ? IconProp.Clock : IconProp.Info}
                className="mt-0.5 h-5 w-5 shrink-0 text-gray-500"
              />
              <p className="text-xs leading-5 text-gray-600">
                {isStillRecording
                  ? "Still recording - the session has not been sealed yet, so more chunks may arrive."
                  : hasRecordingEnded
                    ? "Every tab of this session has closed, so nothing more is being recorded."
                    : "The recorder did not report why this recording ended."}
              </p>
            </div>
          )}
          {hasRecordingEnded && (
            <div
              className="mt-2 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800 ring-1 ring-inset ring-blue-100"
              data-testid="replay-details-finalizing"
            >
              <Icon icon={IconProp.Info} className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Still being finalized: duration, pages and signals are counted
                shortly, when the session is finalized.
              </p>
            </div>
          )}
        </div>
      </DetailSection>

      <DetailSection
        title="Recording gaps"
        description="Missing chunks can create jumps in playback."
        icon={IconProp.SignalSlash}
        testId="details-section-gaps"
        badge={props.gaps.length}
      >
        <div className="space-y-2 py-3">
          {props.gaps.length === 0 && (
            <div
              className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-100"
              data-testid="replay-details-gaps-empty"
            >
              <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
              No chunks are missing from this recording.
            </div>
          )}
          {props.gaps.map(
            (gap: SessionReplayGap, index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"
                  data-testid="replay-details-gap"
                >
                  <Icon
                    icon={IconProp.Alert}
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                  />
                  <span>
                    {formatReplayMilliseconds(gap.missingMs)} missing between
                    chunk {gap.fromIndex} and chunk {gap.toIndex}
                  </span>
                </div>
              );
            },
          )}
        </div>
      </DetailSection>

      <DetailSection
        title="Capture limitations"
        description="Page content the browser could not include in the replay."
        icon={IconProp.EyeSlash}
        testId="details-section-limitations"
        badge={props.fidelityNotices.length}
      >
        <div className="space-y-2 py-3">
          {props.fidelityNotices.length === 0 && (
            <div
              className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-100"
              data-testid="replay-details-limitations-empty"
            >
              <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
              The recorder reported no capture limitations for this session.
            </div>
          )}
          {orderedNotices.map((notice: string): ReactElement => {
            const copy: FidelityNoticeCopy = getFidelityNoticeCopy(notice);
            const isPlayback: boolean =
              getFidelityNoticeSeverity(notice) === "playback";

            return (
              <div
                key={notice}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 ${
                  isPlayback
                    ? "border-amber-200 bg-amber-50"
                    : "border-gray-200 bg-gray-50"
                }`}
                data-testid="replay-details-notice"
              >
                <Icon
                  icon={isPlayback ? IconProp.Alert : IconProp.Info}
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    isPlayback ? "text-amber-600" : "text-gray-400"
                  }`}
                />
                <div>
                  <div
                    className={`text-xs font-semibold ${
                      isPlayback ? "text-amber-900" : "text-gray-800"
                    }`}
                  >
                    {copy.title}
                  </div>
                  <p
                    className={`mt-0.5 text-xs leading-5 ${
                      isPlayback ? "text-amber-800" : "text-gray-500"
                    }`}
                  >
                    {copy.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </DetailSection>

      {(props.missingAssets?.length ?? 0) > 0 && (
        <DetailSection
          title="Missing assets"
          description="Resources referenced by the page but unavailable to playback."
          icon={IconProp.LinkSlash}
          testId="details-section-missing-assets"
          badge={props.missingAssets?.length ?? 0}
        >
          <div className="space-y-2 py-3">
            {(props.missingAssets ?? []).map((asset: string): ReactElement => {
              return (
                <div
                  key={asset}
                  className="truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600"
                  title={asset}
                >
                  {asset}
                </div>
              );
            })}
          </div>
        </DetailSection>
      )}
    </div>
  );

  const tabs: Array<TelemetryDetailPanelTab> = [
    { id: "session", label: "Session", content: sessionContent },
    { id: "provenance", label: "Privacy", content: provenanceContent },
    {
      id: "fidelity",
      label: "Fidelity",
      content: fidelityContent,
      badge: props.gaps.length + props.fidelityNotices.length,
    },
  ];

  /*
   * A tab id the panel no longer has (an old ?tab= value, a stale pref)
   * falls back to the first tab rather than rendering an empty body.
   */
  const activeTabId: string = (
    REPLAY_CORRELATION_PANEL_TAB_IDS as ReadonlyArray<string>
  ).includes(props.activeTabId)
    ? props.activeTabId
    : "session";

  return (
    <TelemetryDetailPanel
      isOpen={props.isOpen}
      title="Session details"
      subtitle={
        <span title={props.sessionId}>
          Session <span className="font-mono">{shortSessionId}</span>
        </span>
      }
      headerActions={
        <DetailCopyButton
          value={props.sessionId}
          title="Copy full Session ID"
        />
      }
      onClose={props.onClose}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={props.onTabChange}
      widthClassName={getReplayPanelWidthClassName(activeTabId)}
    />
  );
};

export default ReplayCorrelationPanel;
