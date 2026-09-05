import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Includes from "Common/Types/BaseDatabase/Includes";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryDetailPanel, {
  TelemetryDetailPanelTab,
} from "Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import { SessionReplayGap } from "Common/Types/Rum/SessionReplay";
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

export type ReplayCorrelationPanelTabId = "session" | "provenance" | "fidelity";

export const REPLAY_CORRELATION_PANEL_TAB_IDS: ReadonlyArray<ReplayCorrelationPanelTabId> =
  ["session", "provenance", "fidelity"];

export interface ReplaySessionDetails {
  entryUrl: string;
  exitUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  /*
   * null: the manifest did not supply identity - the viewer lacks the
   * identity permission, so the panel must not claim the session is
   * anonymous. "": supplied and empty - the page never called identify().
   */
  identifiedUserLabel: string | null;
  /* Only present when the manifest supplied them (same ACL as the label). */
  identifiedUserTraits?: Record<string, string> | null | undefined;
  tags?: Record<string, string> | null | undefined;
  maskingMode: string;
  consentState: string;
  triggerReason: string;
  recorderVersion: string;
  rrwebVersion: string;
  recorderCapabilities?: Array<string> | undefined;
  viewportWidth: number;
  viewportHeight: number;
  clockSkewMs: number;
  payloadBytes: number;
  startTime: string;
  endTime: string;
  durationMs?: number | undefined;
  /* Blank while the session is still open. */
  sealedReason?: string | undefined;
  isFinalized?: boolean | undefined;
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
}

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
  value: string;
  testId?: string | undefined;
}

const DetailRow: FunctionComponent<DetailRowProps> = (
  props: DetailRowProps,
): ReactElement => {
  return (
    <div
      className="flex items-start justify-between gap-4 border-b border-gray-100 py-1.5 last:border-b-0"
      data-testid={props.testId}
    >
      <div className="text-xs text-gray-500">{props.label}</div>
      <div className="max-w-[60%] break-words text-right text-xs text-gray-900">
        {props.value || "—"}
      </div>
    </div>
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
    <div className="mt-3" data-testid={props.testId}>
      <div className="mb-1 text-xs font-medium text-gray-700">
        {props.heading} ({Object.keys(props.map).length})
      </div>
      {Object.keys(props.map).map((key: string): ReactElement => {
        return (
          <DetailRow
            key={key}
            label={key}
            value={props.map[key] || ""}
            testId={`${props.testId}-row`}
          />
        );
      })}
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
  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-gray-100 py-1.5 last:border-b-0"
      data-testid={`details-rail-${props.railTab}`}
    >
      <div className="text-xs text-gray-700">
        {props.count === null ? (
          <span>
            {props.label}{" "}
            <span className="text-gray-400">(not fetched yet)</span>
          </span>
        ) : (
          <span>
            <span className="font-medium">{props.count}</span> {props.label}
          </span>
        )}
      </div>
      {props.onOpenRailTab && (
        <Button
          title="Open in rail"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.ArrowCircleRight}
          dataTestId={`details-open-rail-${props.railTab}`}
          onClick={(): void => {
            props.onOpenRailTab?.(props.railTab);
          }}
        />
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

  const sessionContent: ReactElement = (
    <div className="px-1" data-testid="details-tab-session">
      <DetailRow label="Session id" value={props.sessionId} />
      <DetailRow label="Entry URL" value={d.entryUrl} />
      <DetailRow label="Exit URL" value={d.exitUrl} />
      <DetailRow
        label="End user"
        value={endUserValue}
        testId="replay-details-end-user"
      />
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
      <div className="mt-3">
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

      {/*
       * The coarse correlation lists from the header (capped at 50 by the
       * finalizer) stay here for the viewer who wants the ids; the rail is
       * where they live on the clock.
       */}
      <div className="mb-1 mt-4 text-xs font-medium text-gray-700">
        In the rail
      </div>
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
      <div className="mt-2 text-[11px] text-gray-500">
        Backend rows reach the rail by carrying this session&apos;s id: the
        recorder stamps session.id on its own network requests (so spans for
        instrumented origins correlate by themselves); logs and spans from other
        SDKs correlate only when they are wired to add session.id, for example
        through OneUptimeReplay.onSessionChange().
      </div>

      {d.exceptionFingerprints.length > 0 && (
        <React.Fragment>
          <div className="mb-1 mt-4 text-xs font-medium text-gray-700">
            Exception groups ({d.exceptionFingerprints.length})
          </div>
          <div className="space-y-1" data-testid="details-fingerprints">
            {fingerprintLinks.map(
              (link: ReplayExceptionGroupLink): ReactElement => {
                if (!link.route) {
                  return (
                    <div
                      key={link.fingerprint}
                      className="truncate text-xs text-gray-600"
                      title={link.fingerprint}
                    >
                      {link.label}
                    </div>
                  );
                }

                return (
                  <div
                    key={link.fingerprint}
                    className="truncate hover:underline"
                    /* The hash stays reachable, as the title. */
                    title={
                      link.isDirect
                        ? link.fingerprint
                        : `${link.fingerprint} - opens the exceptions list filtered to this group`
                    }
                  >
                    <AppLink
                      to={link.route}
                      className="text-xs text-indigo-600"
                    >
                      {link.label}
                    </AppLink>
                  </div>
                );
              },
            )}
          </div>
        </React.Fragment>
      )}

      {d.traceIds.length > 0 && (
        <React.Fragment>
          <div className="mb-1 mt-4 text-xs font-medium text-gray-700">
            Trace ids ({d.traceIds.length})
          </div>
          <div className="space-y-1" data-testid="details-trace-ids">
            {d.traceIds.map((traceId: string): ReactElement => {
              return (
                <div key={traceId} className="truncate hover:underline">
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
        </React.Fragment>
      )}

      {(d.traceIds.length > 0 || d.exceptionFingerprints.length > 0) && (
        <div className="mt-3 text-[11px] text-gray-500">
          Correlated ids on the header are capped at 50 per session; the rail
          fetches the full set.
        </div>
      )}
    </div>
  );

  const provenanceContent: ReactElement = (
    <div className="px-1" data-testid="details-tab-provenance">
      {/*
       * Masking mode is the single most important field on this panel. What
       * a viewer is looking at depends entirely on it, and every mode except
       * MaskAllText means real page text - potentially real personal data -
       * was recorded.
       */}
      {/*
       * ux-20: the product label, not a de-camel-cased enum. The settings
       * page and the recording-health card already describe the modes in
       * these words; "Mask Sensitive Inputs Only" told a viewer the name
       * of a constant instead of what was recorded.
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
      <DetailRow label="Recorder version" value={d.recorderVersion} />
      <DetailRow label="rrweb version" value={d.rrwebVersion} />
      {d.recorderCapabilities && d.recorderCapabilities.length > 0 && (
        <DetailRow
          label="Recorder capabilities"
          value={d.recorderCapabilities.join(", ")}
        />
      )}
      <DetailRow
        label="Client clock skew"
        value={formatReplayClockSkew(d.clockSkewMs)}
        testId="replay-details-skew"
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
        <div
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800"
          data-testid="replay-details-readable-warning"
        >
          This recording contains readable page content. Any personal data
          rendered into the page is in it, and{" "}
          {d.maskingMode === SessionReplayMaskingMode.MaskSensitiveInputsOnly
            ? "so is anything typed into a field the page did not declare as sensitive."
            : "only input values were masked."}
        </div>
      )}
    </div>
  );

  const sealedReasonCopy: SealedReasonCopy | null = getSealedReasonCopy(
    d.sealedReason,
  );

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
    <div className="px-1" data-testid="details-tab-fidelity">
      <div className="mb-2 text-xs font-medium text-gray-700">
        How the recording ended
      </div>
      {sealedReasonCopy ? (
        <div className="text-xs" data-testid="replay-details-sealed-reason">
          <div
            className={`font-medium ${
              sealedReasonCopy.severity === "warn"
                ? "text-amber-800"
                : "text-gray-800"
            }`}
          >
            {sealedReasonCopy.title}
          </div>
          <div className="text-gray-500">{sealedReasonCopy.description}</div>
        </div>
      ) : (
        <div
          className="text-xs text-gray-500"
          data-testid="replay-details-sealed-reason"
        >
          {d.isFinalized === false
            ? "Still recording - the session has not been sealed yet, so more chunks may arrive."
            : "The recorder did not report why this recording ended."}
        </div>
      )}

      <div className="mb-2 mt-4 text-xs font-medium text-gray-700">
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
              <div
                key={index}
                className="text-xs text-amber-800"
                data-testid="replay-details-gap"
              >
                {formatReplayMilliseconds(gap.missingMs)} missing between chunk{" "}
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
        {orderedNotices.map((notice: string): ReactElement => {
          const copy: FidelityNoticeCopy = getFidelityNoticeCopy(notice);
          const isPlayback: boolean =
            getFidelityNoticeSeverity(notice) === "playback";

          return (
            <div
              key={notice}
              className="text-xs"
              data-testid="replay-details-notice"
            >
              <div
                className={`font-medium ${
                  isPlayback ? "text-amber-800" : "text-gray-800"
                }`}
              >
                {copy.title}
              </div>
              <div className="text-gray-500">{copy.description}</div>
            </div>
          );
        })}
      </div>

      {(props.missingAssets?.length ?? 0) > 0 && (
        <React.Fragment>
          <div className="mb-2 mt-4 text-xs font-medium text-gray-700">
            Missing assets ({props.missingAssets?.length ?? 0})
          </div>
          <div className="space-y-1">
            {(props.missingAssets ?? []).map((asset: string): ReactElement => {
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
      subtitle={props.sessionId}
      onClose={props.onClose}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={props.onTabChange}
      widthClassName={getReplayPanelWidthClassName(activeTabId)}
    />
  );
};

export default ReplayCorrelationPanel;
