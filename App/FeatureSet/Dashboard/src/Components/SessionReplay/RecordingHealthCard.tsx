import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DOCS_URL } from "Common/UI/Config";
import {
  RecordingHealthAction,
  RecordingHealthActionTarget,
  RecordingHealthDiagnosis,
  RecordingHealthSeverity,
  RecordingHealthStatus,
} from "Common/Types/Rum/SessionReplayHealth";
import {
  formatCountForCopy,
  formatRelativeAge,
  parseHealthTimestamp,
} from "Common/Utils/Rum/SessionReplayHealth";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  SessionReplayHealthSnapshot,
  describeHealthError,
} from "./useSessionReplayHealth";
import {
  ExplainedRecorderFact,
  ExplainedRecorderRecord,
  RecorderDiagnosticsExplanation,
  RecorderDiagnosticsResult,
  explainRecorderDiagnostics,
} from "./RecorderDiagnosticsExplainer";

/*
 * RecordingHealthCard: the settings page's answer to "why are there no
 * recordings?", and the body the list page's health strip expands into.
 *
 * Top to bottom: the diagnosis (one cause, quantified, one action), then a
 * fact grid of everything the server knows (last policy fetch, last chunk,
 * sessions and playable sessions today, refusals and drops by reason, bytes
 * against both budgets, the published recorder and the newest session's
 * capabilities), then the paste box for the browser's own diagnostics -
 * the half the server cannot see.
 *
 * Every counter that could not be read says "unknown". "0 refusals" and
 * "the refusal counter is unreachable" are different facts.
 */

const HEALTH_DOCS_PATH: string = "/telemetry/session-replay";
const TROUBLESHOOTING_DOCS_PATH: string = "/rum/session-replay-troubleshooting";

export interface RecordingHealthActionLink {
  to: Route | URL;
  openInNewTab: boolean;
}

/*
 * Where each action target lands. Two targets go to the docs (consent and
 * CSP are things the customer changes in their own code), the rest stay in
 * the product on the page that owns the setting.
 */
export function getRecordingHealthActionLink(
  target: RecordingHealthActionTarget,
  rumApplicationId: ObjectID | string,
): RecordingHealthActionLink {
  const modelId: ObjectID = new ObjectID(rumApplicationId.toString());

  switch (target) {
    case "project-settings":
      return {
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route,
        ),
        openInNewTab: false,
      };
    case "setup-guide":
      return {
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY] as Route,
          { modelId: modelId },
        ),
        openInNewTab: false,
      };
    case "docs-consent":
      return {
        to: URL.fromString(`${DOCS_URL.toString()}${HEALTH_DOCS_PATH}#privacy`),
        openInNewTab: true,
      };
    case "docs-csp":
      return {
        to: URL.fromString(
          `${DOCS_URL.toString()}${HEALTH_DOCS_PATH}#content-security-policy`,
        ),
        openInNewTab: true,
      };
    case "app-settings":
    case "allowed-origins":
    case "budget":
    default:
      return {
        to: RouteUtil.populateRouteParams(
          RouteMap[
            PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
          ] as Route,
          { modelId: modelId },
        ),
        openInNewTab: false,
      };
  }
}

export interface SeverityStyle {
  dot: string;
  border: string;
  background: string;
  text: string;
  icon: IconProp;
}

export const SEVERITY_STYLES: Record<RecordingHealthSeverity, SeverityStyle> = {
  ok: {
    dot: "bg-emerald-500",
    border: "border-emerald-200",
    background: "bg-emerald-50",
    text: "text-emerald-900",
    icon: IconProp.CheckCircle,
  },
  info: {
    dot: "bg-gray-400",
    border: "border-gray-200",
    background: "bg-gray-50",
    text: "text-gray-800",
    icon: IconProp.Info,
  },
  warning: {
    dot: "bg-amber-500",
    border: "border-amber-200",
    background: "bg-amber-50",
    text: "text-amber-900",
    icon: IconProp.Alert,
  },
  error: {
    dot: "bg-rose-500",
    border: "border-rose-200",
    background: "bg-rose-50",
    text: "text-rose-900",
    icon: IconProp.CircleClose,
  },
};

export function RecordingHealthActionButton(props: {
  action: RecordingHealthAction;
  rumApplicationId: ObjectID | string;
  className?: string | undefined;
}): ReactElement {
  const link: RecordingHealthActionLink = getRecordingHealthActionLink(
    props.action.target,
    props.rumApplicationId,
  );

  return (
    <Link
      to={link.to}
      openInNewTab={link.openInNewTab}
      className={
        props.className ??
        "inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
      }
      id={`health-action-${props.action.target}`}
    >
      <span data-testid="health-action">{props.action.label}</span>
    </Link>
  );
}

/* The diagnosis as a banner: dot, title, detail, one action. */
export function RecordingHealthDiagnosisBanner(props: {
  diagnosis: RecordingHealthDiagnosis;
  rumApplicationId: ObjectID | string;
}): ReactElement {
  const style: SeverityStyle = SEVERITY_STYLES[props.diagnosis.severity];

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border ${style.border} ${style.background} px-4 py-3`}
      data-testid="health-diagnosis"
      data-state={props.diagnosis.state}
    >
      <Icon
        icon={style.icon}
        className={`mt-0.5 h-5 w-5 shrink-0 ${style.text}`}
      />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${style.text}`}>
          {props.diagnosis.title}
        </div>
        <div className="mt-0.5 text-sm text-gray-700">
          {props.diagnosis.detail}
        </div>
        {props.diagnosis.action && (
          <div className="mt-2">
            <RecordingHealthActionButton
              action={props.diagnosis.action}
              rumApplicationId={props.rumApplicationId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface HealthFact {
  key: string;
  label: string;
  value: string;
  /* A second, quieter line. */
  hint?: string | undefined;
}

/* "12s ago" or "never"; a timestamp the server did not send is "unknown". */
function describeStamp(
  iso: string | null,
  nowUnixMs: number,
  neverCopy: string,
): string {
  if (iso === null) {
    return neverCopy;
  }

  const unixMs: number | null = parseHealthTimestamp(iso);

  return unixMs === null ? "unknown" : formatRelativeAge(unixMs, nowUnixMs);
}

export const CAPTURE_TRIGGER_LABELS: Record<string, string> = {
  [SessionReplayCaptureTrigger.Always]: "Always",
  [SessionReplayCaptureTrigger.OnErrorOrFrustration]: "On error or frustration",
};

export const CONSENT_MODE_LABELS: Record<string, string> = {
  [SessionReplayConsentMode.NotRequired]: "Not required",
  [SessionReplayConsentMode.RequireExplicit]: "Explicit consent required",
};

export const MASKING_MODE_LABELS: Record<string, string> = {
  [SessionReplayMaskingMode.MaskSensitiveInputsOnly]:
    "Sensitive inputs masked, page text recorded",
  [SessionReplayMaskingMode.MaskInputsOnly]:
    "All inputs masked, page text recorded",
  [SessionReplayMaskingMode.MaskAllText]: "All text masked (wireframe)",
};

/* A raw enum value never reaches the screen; unknown values say so. */
export function labelEnum(
  labels: Record<string, string>,
  value: string,
): string {
  if (value.length === 0) {
    return "not reported";
  }

  return labels[value] ?? `unrecognised value (${value})`;
}

function buildFacts(
  status: RecordingHealthStatus,
  nowUnixMs: number,
  recorderCapabilities: Array<string> | null,
): Array<HealthFact> {
  const facts: Array<HealthFact> = [];

  facts.push({
    key: "config-fetch",
    label: "Recorder last loaded on your site",
    value: describeStamp(status.lastConfigFetchAt, nowUnixMs, "never"),
    hint: "Stamped each time a page fetches this application's replay policy.",
  });

  facts.push({
    key: "last-chunk",
    label: "Last chunk received",
    value: describeStamp(status.lastChunkReceivedAt, nowUnixMs, "never"),
    hint: "The end-to-end proof: a recorder on your site reached this server.",
  });

  const sessions: string =
    status.sessionsLast24h === null
      ? "unknown"
      : `${formatCountForCopy(status.sessionsLast24h)}${
          status.playableSessionsLast24h === null
            ? ""
            : ` (${formatCountForCopy(status.playableSessionsLast24h)} playable)`
        }`;

  facts.push({
    key: "sessions",
    label: "Sessions in the last 24h",
    value: sessions,
    hint:
      status.sessionsLast24h === null
        ? "The session count could not be read."
        : `Last session started ${describeStamp(status.lastSessionStartedAt, nowUnixMs, "never")}.`,
  });

  facts.push({
    key: "policy",
    label: "Policy",
    value: `${labelEnum(CAPTURE_TRIGGER_LABELS, status.policy.captureTrigger)}, sampling ${status.policy.samplePercentage}%`,
    hint: `${labelEnum(CONSENT_MODE_LABELS, status.policy.consentMode)}; ${labelEnum(MASKING_MODE_LABELS, status.policy.maskingMode)}; retention ${
      status.policy.retentionInDays === null
        ? "not reported"
        : `${status.policy.retentionInDays} days`
    }.`,
  });

  facts.push({
    key: "recorder-version",
    label: "Published recorder",
    value: status.publishedRecorderVersion ?? "not reported",
    hint:
      status.publishedRecorderVersion === null
        ? "Either this deployment builds no recorder artifact, or the server did not say."
        : "The build the /config route hands out to new page loads.",
  });

  facts.push({
    key: "capabilities",
    label: "Recorder capabilities (newest session)",
    value:
      recorderCapabilities === null
        ? "unknown"
        : recorderCapabilities.length === 0
          ? "none reported"
          : recorderCapabilities.join(", "),
    hint:
      recorderCapabilities === null
        ? "Reported by the first chunk of a session recorded by a recorder that announces its features; older recorders never send this."
        : "A cached older recorder refreshes within its cache window.",
  });

  return facts;
}

function describeCounterList(
  entries: Array<{ reason: string; count: number }> | null,
  noneCopy: string,
): Array<string> | string {
  if (entries === null) {
    return "unknown (the counter store was unreachable)";
  }

  if (entries.length === 0) {
    return noneCopy;
  }

  const sorted: Array<{ reason: string; count: number }> = [...entries].sort(
    (a: { count: number }, b: { count: number }): number => {
      return b.count - a.count;
    },
  );

  return sorted.map((entry: { reason: string; count: number }): string => {
    return `${formatCountForCopy(entry.count)} ${entry.reason}`;
  });
}

function BytesRow(props: {
  label: string;
  usedBytes: number | null;
  limitBytes: number | null;
  noLimitCopy: string;
}): ReactElement {
  const MB: number = 1024 * 1024;

  if (props.usedBytes === null) {
    return (
      <div>
        <div className="text-xs font-medium text-gray-700">{props.label}</div>
        <div className="text-sm text-gray-900">
          unknown (the usage counter was unreachable)
        </div>
      </div>
    );
  }

  if (props.limitBytes === null || props.limitBytes <= 0) {
    return (
      <div>
        <div className="text-xs font-medium text-gray-700">{props.label}</div>
        <div className="text-sm text-gray-900">
          {Math.round(props.usedBytes / MB)} MB used; {props.noLimitCopy}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-gray-700">
        {props.label}
      </div>
      <ProgressBar
        count={Math.round(props.usedBytes / MB)}
        totalCount={Math.round(props.limitBytes / MB)}
        suffix="MB"
        size={ProgressBarSize.Small}
      />
    </div>
  );
}

/*
 * The paste box. getDiagnostics() output is the browser's half of the
 * story - a blocked script, a privacy signal, an unsampled draw, consent
 * never granted - and none of it is visible from the server. This is the
 * fallback, no longer the primary path: the live facts above answer most
 * cases without it.
 */
export function RecorderDiagnosticsPasteBox(): ReactElement {
  const [text, setText] = useState<string>("");
  const [result, setResult] = useState<RecorderDiagnosticsResult | null>(null);

  const explain: () => void = (): void => {
    setResult(explainRecorderDiagnostics(text));
  };

  return (
    <div data-testid="diagnostics-paste-box">
      <div className="text-xs font-semibold text-gray-700">
        Ask the browser instead
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Anything that stops the recorder before it uploads - a blocked script, a
        Do Not Track signal, an unsampled session, consent that was never
        granted - is only visible in the browser. On the page that is not
        recording, run this in the console, then paste the result below:
      </p>
      <div className="mt-2">
        <CodeBlock
          language="javascript"
          code={`copy(JSON.stringify(OneUptimeReplay.getDiagnostics()));
// To also see every decision live: localStorage.setItem("oneuptime.sessionReplay.debug", "true"); then reload.`}
        />
      </div>
      <div className="mt-2">
        <TextArea
          value={text}
          placeholder='{"version": "...", "records": [...]}'
          dataTestId="diagnostics-paste-input"
          disableSpellCheck={true}
          onChange={(value: string): void => {
            setText(value);
          }}
        />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <Button
          title="Explain it"
          buttonStyle={ButtonStyleType.OUTLINE}
          dataTestId="diagnostics-explain"
          onClick={explain}
        />
        <Link
          className="text-xs text-indigo-600 hover:text-indigo-800"
          openInNewTab={true}
          to={URL.fromString(
            `${DOCS_URL.toString()}${TROUBLESHOOTING_DOCS_PATH}`,
          )}
        >
          Every code, explained in the docs
        </Link>
      </div>

      {result && !result.ok && (
        <div
          className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          data-testid="diagnostics-error"
        >
          {result.error}
        </div>
      )}

      {result && result.ok && (
        <RecorderDiagnosticsExplanationView explanation={result.explanation} />
      )}
    </div>
  );
}

function RecorderDiagnosticsExplanationView(props: {
  explanation: RecorderDiagnosticsExplanation;
}): ReactElement {
  const { explanation } = props;

  return (
    <div className="mt-3" data-testid="diagnostics-explanation">
      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-900">
        {explanation.headline}
      </div>

      {explanation.facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {explanation.facts.map(
            (fact: ExplainedRecorderFact, index: number): ReactElement => {
              return (
                <div key={index} className="flex gap-2">
                  <dt className="shrink-0 text-gray-500">{fact.label}:</dt>
                  <dd className="min-w-0 break-words text-gray-900">
                    {fact.value}
                  </dd>
                </div>
              );
            },
          )}
          {explanation.capabilities.length > 0 && (
            <div className="flex gap-2">
              <dt className="shrink-0 text-gray-500">Capabilities:</dt>
              <dd className="min-w-0 break-words text-gray-900">
                {explanation.capabilities.join(", ")}
              </dd>
            </div>
          )}
        </dl>
      )}

      {explanation.unknownCodes.length > 0 && (
        <div className="mt-3 text-xs text-amber-700">
          {explanation.unknownCodes.length} code
          {explanation.unknownCodes.length === 1 ? "" : "s"} newer than this
          dashboard: {explanation.unknownCodes.join(", ")}. The docs link above
          lists every code.
        </div>
      )}

      {explanation.records.length === 0 ? (
        <div className="mt-3 text-sm text-gray-500">
          The records array is empty: the recorder made no decision on that page
          at all, which means the loader never ran. Check that the script tag is
          on the page.
        </div>
      ) : (
        <ol className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-200">
          {explanation.records.map(
            (record: ExplainedRecorderRecord, index: number): ReactElement => {
              return (
                <li
                  key={index}
                  className="px-3 py-2"
                  data-testid="diagnostics-record"
                  data-code={record.code}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        record.level === "warn" ? "bg-amber-500" : "bg-gray-300"
                      }`}
                    />
                    <code className="text-gray-700">{record.code}</code>
                    {record.atUnixMs !== null && (
                      <span className="text-gray-400">
                        {new Date(record.atUnixMs).toISOString()}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-gray-900">
                    {record.explanation}
                  </div>
                  {record.action && (
                    <div className="mt-0.5 text-xs text-gray-600">
                      {record.action}
                    </div>
                  )}
                  {Object.keys(record.detail).length > 0 && (
                    <div className="mt-0.5 font-mono text-[11px] text-gray-500">
                      {Object.keys(record.detail)
                        .map((key: string): string => {
                          return `${key}=${String(record.detail[key])}`;
                        })
                        .join("  ")}
                    </div>
                  )}
                </li>
              );
            },
          )}
        </ol>
      )}
    </div>
  );
}

export interface RecordingHealthCardViewProps {
  rumApplicationId: ObjectID | string;
  health: SessionReplayHealthSnapshot;
  onRefresh?: (() => void) | undefined;
  /* The strip embeds the body without a second card frame. */
  embedded?: boolean | undefined;
  /* The installation test has its own paste box. */
  showDiagnosticsPasteBox?: boolean | undefined;
}

/* Pure: renders one snapshot. */
export const RecordingHealthCardView: FunctionComponent<
  RecordingHealthCardViewProps
> = (props: RecordingHealthCardViewProps): ReactElement => {
  const { health } = props;

  const facts: Array<HealthFact> = useMemo((): Array<HealthFact> => {
    return health.status
      ? buildFacts(
          health.status,
          health.nowUnixMs,
          health.extras.recorderCapabilities,
        )
      : [];
  }, [health.status, health.nowUnixMs, health.extras.recorderCapabilities]);

  const refusals: Array<string> | string = describeCounterList(
    health.status?.refusalsLast24h ?? null,
    "none in the last 24h",
  );
  const drops: Array<string> | string = describeCounterList(
    health.extras.dropsLast24h,
    "none in the last 24h",
  );

  const body: ReactElement = (
    <div data-testid="health-card" data-state={health.diagnosis.state}>
      {health.isLoading && (
        <div
          className="text-sm text-gray-500"
          data-testid="health-card-loading"
        >
          Checking recording health…
        </div>
      )}

      {!health.isLoading && health.error && health.status === null && (
        <div
          className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
          data-testid="health-card-error"
        >
          <div className="text-sm font-semibold text-gray-900">
            {describeHealthError(health.error).title}
          </div>
          <div className="mt-0.5 text-sm text-gray-700">
            {describeHealthError(health.error).detail}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Server said: {health.error.message}
          </div>
        </div>
      )}

      {!health.isLoading && health.status !== null && (
        <>
          <RecordingHealthDiagnosisBanner
            diagnosis={health.diagnosis}
            rumApplicationId={props.rumApplicationId}
          />

          {health.error && (
            <div
              className="mt-2 text-xs text-amber-700"
              data-testid="health-card-stale"
            >
              The last refresh failed (
              {describeHealthError(health.error).title.toLowerCase()}); showing
              the status read{" "}
              {health.fetchedAtUnixMs === null
                ? "earlier"
                : formatRelativeAge(health.fetchedAtUnixMs, health.nowUnixMs)}
              .
            </div>
          )}

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            {facts.map((fact: HealthFact): ReactElement => {
              return (
                <div key={fact.key} data-testid={`health-fact-${fact.key}`}>
                  <dt className="text-xs font-medium text-gray-700">
                    {fact.label}
                  </dt>
                  <dd className="text-sm text-gray-900">{fact.value}</dd>
                  {fact.hint && (
                    <dd className="text-xs text-gray-500">{fact.hint}</dd>
                  )}
                </div>
              );
            })}

            <div data-testid="health-fact-refusals">
              <dt className="text-xs font-medium text-gray-700">
                Uploads refused in the last 24h
              </dt>
              {typeof refusals === "string" ? (
                <dd className="text-sm text-gray-900">{refusals}</dd>
              ) : (
                <dd className="text-sm text-gray-900">
                  <ul>
                    {refusals.map((line: string): ReactElement => {
                      return <li key={line}>{line}</li>;
                    })}
                  </ul>
                </dd>
              )}
              <dd className="text-xs text-gray-500">
                Answered to the recorder at the gate, with the same reason words
                the recorder&apos;s diagnostics quote.
              </dd>
            </div>

            <div data-testid="health-fact-drops">
              <dt className="text-xs font-medium text-gray-700">
                Chunks dropped after acceptance in the last 24h
              </dt>
              {typeof drops === "string" ? (
                <dd className="text-sm text-gray-900">{drops}</dd>
              ) : (
                <dd className="text-sm text-gray-900">
                  <ul>
                    {drops.map((line: string): ReactElement => {
                      return <li key={line}>{line}</li>;
                    })}
                  </ul>
                </dd>
              )}
              <dd className="text-xs text-gray-500">
                Accepted with a 202, then not stored by the worker: a different
                fact from a refusal, and the recorder was never told.
              </dd>
            </div>
          </dl>

          <div
            className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"
            data-testid="health-bytes"
          >
            <BytesRow
              label="Project bytes today"
              usedBytes={health.status.projectBytesUsedToday}
              limitBytes={health.status.dailyByteLimit}
              noLimitCopy="no daily limit is set on this deployment"
            />
            <BytesRow
              label="This application this month"
              usedBytes={health.status.applicationBytesUsedThisMonth}
              limitBytes={
                health.status.monthlyBudgetInGB === null
                  ? null
                  : health.status.monthlyBudgetInGB * 1024 * 1024 * 1024
              }
              noLimitCopy="no monthly budget is set (0 or blank means no ceiling)"
            />
          </div>

          {props.showDiagnosticsPasteBox !== false && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <RecorderDiagnosticsPasteBox />
            </div>
          )}
        </>
      )}
    </div>
  );

  if (props.embedded) {
    return body;
  }

  return (
    <Card
      title="Recording health"
      description="Everything the server knows about whether recordings are arriving for this application, refreshed automatically."
      buttons={
        props.onRefresh
          ? [
              {
                title: health.isRefreshing ? "Refreshing…" : "Refresh",
                icon: IconProp.Refresh,
                buttonStyle: ButtonStyleType.OUTLINE,
                disabled: health.isRefreshing,
                onClick: props.onRefresh,
              },
            ]
          : undefined
      }
    >
      {body}
    </Card>
  );
};

export interface ComponentProps {
  rumApplicationId: ObjectID | string;
  pollIntervalMs?: number | undefined;
  showDiagnosticsPasteBox?: boolean | undefined;
}

/* Connected: owns its subscription to the shared poller. */
const RecordingHealthCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const health: SessionReplayHealthSnapshot & { refresh: () => Promise<void> } =
    useSessionReplayHealth(props.rumApplicationId, {
      pollIntervalMs:
        props.pollIntervalMs ?? SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
    });

  return (
    <RecordingHealthCardView
      rumApplicationId={props.rumApplicationId}
      health={health}
      showDiagnosticsPasteBox={props.showDiagnosticsPasteBox}
      onRefresh={(): void => {
        void health.refresh();
      }}
    />
  );
};

export default RecordingHealthCard;
