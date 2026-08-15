import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import TelemetryDetailPanel, {
  TelemetryDetailPanelTab,
} from "Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel";
import { SessionReplayGap } from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode, {
  doesMaskingModeRecordReadableContent,
} from "Common/Types/Rum/SessionReplayMaskingMode";
import Text from "Common/Types/Text";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import AppLink from "../AppLink/AppLink";
import DashboardLogsViewer from "../Logs/LogsViewer";
import ExceptionInstanceTable from "../Exceptions/ExceptionInstanceTable";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ReplayFingerprintLink,
  buildReplayFingerprintLinks,
  buildReplaySessionExceptionsQuery,
  buildReplaySessionLogsQuery,
  getReplayPanelWidthClassName,
  getReplaySessionWindow,
} from "../../Utils/ReplayCorrelation";
import {
  FidelityNoticeCopy,
  getFidelityNoticeCopy,
} from "./FidelityNoticeCopy";

/*
 * Everything the player knows about a session that is not the picture:
 * provenance, correlation and - most importantly - what was NOT captured.
 *
 * Built on TelemetryViewer's TelemetryDetailPanel rather than a hand-rolled
 * fixed div, so it inherits Escape-to-close and the tab chrome the rest of
 * the telemetry surfaces already use.
 *
 * The Logs and Errors tabs each embed a real query surface (the dashboard
 * logs viewer, the exception instance table). TelemetryDetailPanel mounts
 * only the active tab's content — and nothing at all while the panel is
 * closed — so neither adds a request to the player's default load.
 */

export interface ReplaySessionDetails {
  entryUrl: string;
  exitUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  identifiedUserLabel: string;
  maskingMode: string;
  consentState: string;
  triggerReason: string;
  recorderVersion: string;
  rrwebVersion: string;
  viewportWidth: number;
  viewportHeight: number;
  clockSkewMs: number;
  payloadBytes: number;
  startTime: string;
  endTime: string;
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
}

export interface ReplayCorrelationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  sessionId: string;
  details: ReplaySessionDetails;
  fidelityNotices: Array<string>;
  missingAssets: Array<string>;
  gaps: Array<SessionReplayGap>;
}

interface DetailRowProps {
  label: string;
  value: string;
}

const DetailRow: FunctionComponent<DetailRowProps> = (
  props: DetailRowProps,
): ReactElement => {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-1.5 last:border-b-0">
      <div className="text-xs text-gray-500">{props.label}</div>
      <div className="max-w-[60%] break-words text-right text-xs text-gray-900">
        {props.value || "—"}
      </div>
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

const ReplayCorrelationPanel: FunctionComponent<ReplayCorrelationPanelProps> = (
  props: ReplayCorrelationPanelProps,
): ReactElement | null => {
  const d: ReplaySessionDetails = props.details;

  /*
   * "Now" is resolved at memo time, not render time: a still-open session
   * (no endTime yet) gets a window ending at the moment the panel learned
   * about it, and the memo keys keep that stable so the embedded viewers are
   * not handed a new window object every render.
   */
  const sessionWindow: InBetween<Date> | null = useMemo(() => {
    return getReplaySessionWindow({
      startTime: d.startTime,
      endTime: d.endTime,
    });
  }, [d.startTime, d.endTime]);

  const logsQuery: Query<Log> = useMemo(() => {
    return buildReplaySessionLogsQuery(sessionWindow);
  }, [sessionWindow]);

  const exceptionsQuery: Query<ExceptionInstance> | null = useMemo(() => {
    return buildReplaySessionExceptionsQuery({
      sessionId: props.sessionId,
      window: sessionWindow,
    });
  }, [props.sessionId, sessionWindow]);

  const fingerprintLinks: Array<ReplayFingerprintLink> = useMemo(() => {
    return buildReplayFingerprintLinks(
      d.exceptionFingerprints,
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
      ),
    );
  }, [d.exceptionFingerprints]);

  /*
   * Known only after the Logs tab has mounted and fetched — null keeps the
   * badge off entirely rather than showing a claimed count of 0 for a tab
   * that has never run its query.
   */
  const [logsCount, setLogsCount] = useState<number | null>(null);

  const sessionContent: ReactElement = (
    <div className="px-1">
      <DetailRow label="Session id" value={props.sessionId} />
      <DetailRow label="Entry URL" value={d.entryUrl} />
      <DetailRow label="Exit URL" value={d.exitUrl} />
      <DetailRow
        label="End user"
        value={d.identifiedUserLabel || "Anonymous (identity capture is off)"}
      />
      <DetailRow
        label="Browser"
        value={[d.browserName, d.browserVersion].filter(Boolean).join(" ")}
      />
      <DetailRow label="OS" value={d.osName} />
      <DetailRow label="Device" value={d.deviceType} />
      <DetailRow label="Country" value={d.countryCode} />
      <DetailRow
        label="Viewport"
        value={
          d.viewportWidth && d.viewportHeight
            ? `${d.viewportWidth} x ${d.viewportHeight}`
            : ""
        }
      />
      <DetailRow label="Recorded bytes" value={formatBytes(d.payloadBytes)} />
    </div>
  );

  const provenanceContent: ReactElement = (
    <div className="px-1">
      {/*
       * Masking mode is the single most important field on this panel. What
       * a viewer is looking at depends entirely on it, and every mode except
       * MaskAllText means real page text - potentially real personal data -
       * was recorded.
       */}
      <DetailRow
        label="Masking mode"
        value={Text.fromPascalCaseToReadable(d.maskingMode)}
      />
      <DetailRow label="Consent state" value={d.consentState} />
      <DetailRow label="Why recorded" value={d.triggerReason} />
      <DetailRow label="Recorder version" value={d.recorderVersion} />
      <DetailRow label="rrweb version" value={d.rrwebVersion} />
      <DetailRow
        label="Client clock skew"
        value={
          d.clockSkewMs
            ? `${Math.round(d.clockSkewMs / 1000)}s (server-clamped)`
            : "None"
        }
      />
      {/*
       * Keyed on "not the wireframe mode" rather than on one named mode.
       * The previous form tested only MaskInputsOnly, so adding
       * MaskSensitiveInputsOnly - which records page text AND ordinary
       * input values - would have silently stopped warning anyone on the
       * mode that is now the default.
       */}
      {doesMaskingModeRecordReadableContent(
        d.maskingMode as SessionReplayMaskingMode,
      ) && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          This recording contains readable page content. Any personal data
          rendered into the page is in it, and{" "}
          {d.maskingMode === SessionReplayMaskingMode.MaskSensitiveInputsOnly
            ? "so is anything typed into a field the page did not declare as sensitive."
            : "only input values were masked."}
        </div>
      )}
    </div>
  );

  const correlationContent: ReactElement = (
    <div className="px-1">
      <div className="mb-2 text-xs font-medium text-gray-700">
        Traces in this session ({d.traceIds.length})
      </div>
      {d.traceIds.length === 0 && (
        <div className="text-xs text-gray-500">
          No traces were correlated. Correlation needs session.id on the span,
          which the recorder sets on its own network instrumentation and which
          an independently configured OpenTelemetry SDK must be wired to add.
        </div>
      )}
      <div className="space-y-1">
        {d.traceIds.map((traceId: string): ReactElement => {
          return (
            <div key={traceId} className="hover:underline">
              <AppLink
                to={
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.TRACE_VIEW] as Route,
                    { modelId: traceId },
                  ) as Route
                }
                className="font-mono text-xs text-indigo-600"
              >
                {traceId}
              </AppLink>
            </div>
          );
        })}
      </div>

      <div className="mb-2 mt-4 text-xs font-medium text-gray-700">
        Exception groups ({d.exceptionFingerprints.length})
      </div>
      {d.exceptionFingerprints.length === 0 && (
        <div className="text-xs text-gray-500">
          No exception groups were correlated to this session.
        </div>
      )}
      <div className="space-y-1">
        {fingerprintLinks.map((link: ReplayFingerprintLink): ReactElement => {
          if (!link.route) {
            return (
              <div
                key={link.fingerprint}
                className="truncate font-mono text-xs text-gray-600"
              >
                {link.fingerprint}
              </div>
            );
          }

          return (
            <div key={link.fingerprint} className="truncate hover:underline">
              <AppLink
                to={link.route}
                className="font-mono text-xs text-indigo-600"
              >
                {link.fingerprint}
              </AppLink>
            </div>
          );
        })}
      </div>

      {/*
       * The arrays above are capped at 50 by the finalizer. Saying so beats
       * letting someone conclude a session touched exactly 50 traces.
       */}
      <div className="mt-3 text-[11px] text-gray-500">
        Correlated ids are capped at 50 per session.
      </div>
    </div>
  );

  const fidelityContent: ReactElement = (
    <div className="px-1">
      <div className="mb-2 text-xs font-medium text-gray-700">
        Recording gaps ({props.gaps.length})
      </div>
      {props.gaps.length === 0 && (
        <div className="text-xs text-gray-500">
          No chunks are missing from this recording.
        </div>
      )}
      <div className="space-y-1">
        {props.gaps.map(
          (gap: SessionReplayGap, index: number): ReactElement => {
            return (
              <div key={index} className="text-xs text-amber-800">
                {Math.round(gap.missingMs / 1000)}s missing between chunk{" "}
                {gap.fromIndex} and chunk {gap.toIndex}
              </div>
            );
          },
        )}
      </div>

      <div className="mb-2 mt-4 text-xs font-medium text-gray-700">
        Not captured ({props.fidelityNotices.length})
      </div>
      {props.fidelityNotices.length === 0 && (
        <div className="text-xs text-gray-500">
          The recorder reported no capture limitations for this session.
        </div>
      )}
      <div className="space-y-2">
        {props.fidelityNotices.map((notice: string): ReactElement => {
          const copy: FidelityNoticeCopy = getFidelityNoticeCopy(notice);

          return (
            <div key={notice} className="text-xs">
              <div className="font-medium text-gray-800">{copy.title}</div>
              <div className="text-gray-500">{copy.description}</div>
            </div>
          );
        })}
      </div>

      {props.missingAssets.length > 0 && (
        <React.Fragment>
          <div className="mb-2 mt-4 text-xs font-medium text-gray-700">
            Missing assets ({props.missingAssets.length})
          </div>
          <div className="space-y-1">
            {props.missingAssets.map((asset: string): ReactElement => {
              return (
                <div
                  key={asset}
                  className="truncate text-xs text-gray-600"
                  title={asset}
                >
                  {asset}
                </div>
              );
            })}
          </div>
        </React.Fragment>
      )}
    </div>
  );

  /*
   * "What did the backend log while this user's session was running." The
   * session filter rides the sessionIds prop so the histogram / facets /
   * analytics endpoints cover the same rows as the list; the logQuery
   * carries only the padded session window, which the viewer adopts as a
   * pinned CUSTOM picker value (the incident-preview pattern) instead of its
   * rolling default. syncUrlState stays off — this viewer is embedded, and
   * must neither read nor clobber the player page's URL.
   */
  const logsContent: ReactElement = (
    <div className="p-3">
      <div className="mb-3 text-xs text-gray-500">
        Backend logs stamped with this session&apos;s id
        {sessionWindow
          ? ", bounded to the recording window (padded 5 minutes each side)."
          : ". This session reported no start time, so the logs are not time-bounded."}
      </div>
      <DashboardLogsViewer
        id="session-replay-logs"
        sessionIds={[props.sessionId]}
        logQuery={logsQuery}
        limit={20}
        noLogsMessage="No backend logs carried this session's id. Correlation needs session.id on the log record, which an OpenTelemetry SDK must be wired to add."
        onCountChange={(count: number): void => {
          setLogsCount(count);
        }}
      />
    </div>
  );

  const errorsContent: ReactElement = (
    <div className="p-3">
      {exceptionsQuery ? (
        <ExceptionInstanceTable
          title="Errors in this session"
          description={
            sessionWindow
              ? "Exception instances stamped with this session's id, within the recording window (padded 5 minutes each side)."
              : "Exception instances stamped with this session's id."
          }
          query={exceptionsQuery}
          // Pinned to the session window; a URL-restored filter must not replace it.
          disableUrlState={true}
        />
      ) : (
        <div className="text-xs text-gray-500">
          This recording carries no session id to look up exceptions by.
        </div>
      )}
    </div>
  );

  const tabs: Array<TelemetryDetailPanelTab> = [
    { id: "session", label: "Session", content: sessionContent },
    { id: "provenance", label: "Privacy", content: provenanceContent },
    {
      id: "correlation",
      label: "Correlation",
      content: correlationContent,
      badge: d.traceIds.length + d.exceptionFingerprints.length,
    },
    {
      id: "logs",
      label: "Logs",
      content: logsContent,
      badge: logsCount === null ? undefined : logsCount,
    },
    { id: "errors", label: "Errors", content: errorsContent },
    {
      id: "fidelity",
      label: "Fidelity",
      content: fidelityContent,
      badge: props.gaps.length + props.fidelityNotices.length,
    },
  ];

  return (
    <TelemetryDetailPanel
      isOpen={props.isOpen}
      title="Session details"
      subtitle={props.sessionId}
      onClose={props.onClose}
      tabs={tabs}
      activeTabId={props.activeTabId}
      onTabChange={props.onTabChange}
      widthClassName={getReplayPanelWidthClassName(props.activeTabId)}
    />
  );
};

export default ReplayCorrelationPanel;
