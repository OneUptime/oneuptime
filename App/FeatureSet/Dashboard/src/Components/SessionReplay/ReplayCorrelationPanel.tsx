import React, { FunctionComponent, ReactElement } from "react";
import TelemetryDetailPanel, {
  TelemetryDetailPanelTab,
} from "Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel";
import { SessionReplayGap } from "Common/Types/Rum/SessionReplay";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * Everything the player knows about a session that is not the picture:
 * provenance, correlation and - most importantly - what was NOT captured.
 *
 * Built on TelemetryViewer's TelemetryDetailPanel rather than a hand-rolled
 * fixed div, so it inherits Escape-to-close and the tab chrome the rest of
 * the telemetry surfaces already use.
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
       * a viewer is looking at depends entirely on it, and MaskInputsOnly
       * means real page text - potentially real personal data - was recorded.
       */}
      <DetailRow label="Masking mode" value={d.maskingMode} />
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
      {d.maskingMode === "MaskInputsOnly" && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          This application records page text verbatim and masks only input
          values. Any personal data rendered into the page is in this recording.
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
        <div className="text-xs text-gray-400">
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
        <div className="text-xs text-gray-400">
          No exception groups were correlated to this session.
        </div>
      )}
      <div className="space-y-1">
        {d.exceptionFingerprints.map((fingerprint: string): ReactElement => {
          return (
            <div
              key={fingerprint}
              className="truncate font-mono text-xs text-gray-600"
            >
              {fingerprint}
            </div>
          );
        })}
      </div>

      {/*
       * The arrays above are capped at 50 by the finalizer. Saying so beats
       * letting someone conclude a session touched exactly 50 traces.
       */}
      <div className="mt-3 text-[10px] text-gray-400">
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
        <div className="text-xs text-gray-400">
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
        <div className="text-xs text-gray-400">
          The recorder reported no capture limitations for this session.
        </div>
      )}
      <div className="space-y-1">
        {props.fidelityNotices.map((notice: string): ReactElement => {
          return (
            <div key={notice} className="text-xs text-gray-700">
              {notice}
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
    />
  );
};

export default ReplayCorrelationPanel;
