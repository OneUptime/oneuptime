import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { RecordingHealthStatus } from "Common/Types/Rum/SessionReplayHealth";
import {
  formatCountForCopy,
  formatRelativeAge,
} from "Common/Utils/Rum/SessionReplayHealth";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  SessionReplayHealthSnapshot,
  UseSessionReplayHealthResult,
  describeHealthError,
} from "./useSessionReplayHealth";
import {
  CAPTURE_TRIGGER_LABELS,
  CONSENT_MODE_LABELS,
  MASKING_MODE_LABELS,
  RecorderDiagnosticsPasteBox,
  RecordingHealthActionButton,
  SEVERITY_STYLES,
  SeverityStyle,
  getReplayPolicyPageRoute,
  labelEnum,
} from "./RecordingHealthCard";
import {
  HealthCounterBreakdown,
  HealthCounterRow,
  HealthTone,
  RecordingPipelineStage,
  UsageMeter,
  buildCounterBreakdown,
  buildRecordingPipeline,
  buildUsageMeter,
  describePollInterval,
} from "./RecordingHealthModel";

/*
 * RecordingHealthDashboard: the Replay Health page.
 *
 * Top to bottom it answers, in the order a person debugging "why are there
 * no recordings?" asks:
 *
 *   1. Is it working? The diagnosis as a hero: one cause, quantified, one
 *      action, and when it was last read.
 *   2. Where does it stop? The four stages a recording passes through, left
 *      to right, each coloured by what the status says about it.
 *   3. What is the server doing with the uploads? Refusals and drops by
 *      reason, and both byte budgets.
 *   4. What was the recorder told, and what can it do? The policy as the
 *      recorder receives it, the published build and its capabilities.
 *   5. What does the browser say? The paste box for getDiagnostics().
 *
 * The rule every health surface keeps holds here too: a counter that could
 * not be read says "unknown" and is never drawn as zero or as green.
 */

interface ToneStyle {
  icon: IconProp;
  iconClassName: string;
  accentClassName: string;
  valueClassName: string;
  barClassName: string;
}

export const TONE_STYLES: Record<HealthTone, ToneStyle> = {
  ok: {
    icon: IconProp.CheckCircle,
    iconClassName: "text-emerald-600",
    accentClassName: "bg-emerald-500",
    valueClassName: "text-gray-900",
    barClassName: "bg-emerald-500",
  },
  warning: {
    icon: IconProp.Alert,
    iconClassName: "text-amber-600",
    accentClassName: "bg-amber-500",
    valueClassName: "text-amber-700",
    barClassName: "bg-amber-500",
  },
  error: {
    icon: IconProp.CircleClose,
    iconClassName: "text-rose-600",
    accentClassName: "bg-rose-500",
    valueClassName: "text-rose-700",
    barClassName: "bg-rose-500",
  },
  neutral: {
    icon: IconProp.MinusCircle,
    iconClassName: "text-gray-400",
    accentClassName: "bg-gray-300",
    valueClassName: "text-gray-500",
    barClassName: "bg-gray-400",
  },
};

const HERO_ICON_RING: Record<string, string> = {
  ok: "ring-emerald-200",
  info: "ring-gray-200",
  warning: "ring-amber-200",
  error: "ring-rose-200",
};

function capitalize(value: string): string {
  return value.length === 0
    ? value
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/* A white panel with a header; every section below the hero is one. */
function HealthPanel(props: {
  title: string;
  description?: string | undefined;
  icon: IconProp;
  dataTestId: string;
  headerRight?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}): ReactElement {
  return (
    <section
      className={`flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm ${props.className ?? ""}`}
      data-testid={props.dataTestId}
      aria-label={props.title}
    >
      <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200">
            <Icon icon={props.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              {props.title}
            </h3>
            {props.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                {props.description}
              </p>
            )}
          </div>
        </div>
        {props.headerRight && (
          <div className="shrink-0 pt-1">{props.headerRight}</div>
        )}
      </header>
      <div className="flex-1 px-5 py-4">{props.children}</div>
    </section>
  );
}

function PanelLink(props: {
  to: Route;
  label: string;
  dataTestId: string;
}): ReactElement {
  return (
    <Link
      to={props.to}
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-indigo-600 hover:text-indigo-800"
    >
      <span data-testid={props.dataTestId}>{props.label}</span>
      <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
    </Link>
  );
}

/* ---------------------------------------------------------------- Hero */

function HealthHero(props: {
  rumApplicationId: ObjectID | string;
  health: SessionReplayHealthSnapshot;
  clockUnixMs: number;
  pollIntervalMs: number;
  onRefresh?: (() => void) | undefined;
}): ReactElement {
  const { health } = props;
  const hasNoStatus: boolean = health.status === null && Boolean(health.error);

  /* The word the E2E suites read: the diagnosis state, or the load state. */
  const level: string = health.isLoading
    ? "loading"
    : hasNoStatus
      ? "error"
      : health.diagnosis.state;

  const severity: keyof typeof SEVERITY_STYLES =
    health.isLoading || hasNoStatus ? "info" : health.diagnosis.severity;
  const style: SeverityStyle = SEVERITY_STYLES[severity];

  let title: string = health.diagnosis.title;
  let detail: string = health.diagnosis.detail;

  if (health.isLoading) {
    title = "Checking recording health…";
    detail =
      "Reading what the server knows about recordings for this application.";
  } else if (hasNoStatus && health.error) {
    const described: { title: string; detail: string } = describeHealthError(
      health.error,
    );

    title = described.title;
    detail = described.detail;
  }

  const updatedCopy: string =
    health.fetchedAtUnixMs === null
      ? "Not read yet"
      : `Updated ${formatRelativeAge(health.fetchedAtUnixMs, Math.max(props.clockUnixMs, health.fetchedAtUnixMs))}`;

  return (
    <section
      className={`overflow-hidden rounded-xl border ${style.border} bg-white shadow-sm`}
      data-testid="health-hero"
      data-state={level}
      aria-live="polite"
    >
      <div
        className={`flex flex-col gap-5 px-5 py-5 sm:px-6 md:flex-row md:items-start md:justify-between ${style.background}`}
      >
        <div className="flex min-w-0 items-start gap-4">
          <span
            className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white ring-4 ${HERO_ICON_RING[severity]}`}
          >
            {health.isLoading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
            ) : (
              <Icon icon={style.icon} className={`h-6 w-6 ${style.text}`} />
            )}
            {level === "healthy" && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-3 w-3"
                aria-hidden="true"
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${style.text} opacity-75`}
            >
              Recording health
              {health.status?.appIdentifier
                ? ` · ${health.status.appIdentifier}`
                : ""}
            </p>
            <h2
              className="mt-1 text-lg font-semibold leading-snug text-gray-900 sm:text-xl"
              data-testid="health-title"
            >
              {title}
            </h2>
            <span className="sr-only" data-testid="health-level">
              {level}
            </span>
            <p
              className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-700"
              data-testid="health-detail"
            >
              {detail}
            </p>
            {hasNoStatus && health.error && (
              <p
                className="mt-1 text-xs text-gray-500"
                data-testid="health-error-message"
              >
                Server said: {health.error.message}
              </p>
            )}
            {!health.isLoading && !hasNoStatus && health.diagnosis.action && (
              <div className="mt-4">
                <RecordingHealthActionButton
                  action={health.diagnosis.action}
                  rumApplicationId={props.rumApplicationId}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-row items-center gap-3 md:flex-col md:items-end">
          {props.onRefresh && (
            <Button
              title={health.isRefreshing ? "Refreshing…" : "Refresh"}
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.OUTLINE}
              disabled={health.isRefreshing}
              dataTestId="health-refresh"
              onClick={props.onRefresh}
            />
          )}
          <p
            className="text-xs text-gray-500 md:text-right"
            data-testid="health-updated"
          >
            {updatedCopy}
            <span className="hidden sm:inline">
              {" "}
              · refreshes {describePollInterval(props.pollIntervalMs)}
            </span>
          </p>
        </div>
      </div>

      {!health.isLoading && !hasNoStatus && health.error && (
        <div
          className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800 sm:px-6"
          data-testid="health-stale"
        >
          <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 shrink-0" />
          <span>
            The last refresh failed (
            {describeHealthError(health.error).title.toLowerCase()}); showing
            the status read{" "}
            {health.fetchedAtUnixMs === null
              ? "earlier"
              : formatRelativeAge(health.fetchedAtUnixMs, health.nowUnixMs)}
            .
          </span>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ Pipeline */

function RecordingPipeline(props: {
  stages: Array<RecordingPipelineStage>;
}): ReactElement {
  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid="health-pipeline"
      aria-label="Recording pipeline"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray-100 px-5 py-3 sm:px-6">
        <h3 className="text-sm font-semibold text-gray-900">
          From page load to playable session
        </h3>
        <p className="text-xs text-gray-500">
          Read left to right: the first amber or red step is where recordings
          stop.
        </p>
      </header>
      <ol className="grid grid-cols-1 gap-px bg-gray-100 sm:grid-cols-2 xl:grid-cols-4">
        {props.stages.map(
          (stage: RecordingPipelineStage, index: number): ReactElement => {
            const tone: ToneStyle = TONE_STYLES[stage.tone];
            const isLast: boolean = index === props.stages.length - 1;

            return (
              <li
                key={stage.key}
                className="relative bg-white px-5 pb-5 pt-6 sm:px-6"
                data-testid={`health-stage-${stage.key}`}
                data-tone={stage.tone}
              >
                <span
                  className={`absolute inset-x-0 top-0 h-1 ${tone.accentClassName}`}
                  aria-hidden="true"
                />
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-gray-500">
                    {stage.label}
                  </span>
                  <Icon
                    icon={tone.icon}
                    className={`h-4 w-4 shrink-0 ${tone.iconClassName}`}
                  />
                  <span className="sr-only">{stage.tone}</span>
                </div>
                <p
                  className={`mt-3 text-2xl font-semibold tabular-nums ${tone.valueClassName}`}
                  data-testid={`health-stage-${stage.key}-value`}
                >
                  {stage.value}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">
                  {stage.caption}
                </p>
                {!isLast && (
                  <span
                    className="absolute right-0 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm xl:flex"
                    aria-hidden="true"
                  >
                    <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
                  </span>
                )}
              </li>
            );
          },
        )}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------- Uploads */

function CounterList(props: {
  title: string;
  hint: string;
  noneCopy: string;
  breakdown: HealthCounterBreakdown;
  dataTestId: string;
  barClassName: string;
}): ReactElement {
  const { breakdown } = props;

  return (
    <div data-testid={props.dataTestId} data-kind={breakdown.kind}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-medium text-gray-900">{props.title}</h4>
        {breakdown.kind === "list" && (
          <span
            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-700"
            data-testid={`${props.dataTestId}-total`}
          >
            {formatCountForCopy(breakdown.total)} total
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
        {props.hint}
      </p>

      {breakdown.kind === "unknown" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-600">
          <Icon icon={IconProp.Info} className="h-4 w-4 shrink-0" />
          <span>Unknown: the counter store was unreachable.</span>
        </div>
      )}

      {breakdown.kind === "none" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <Icon icon={IconProp.CheckCircle} className="h-4 w-4 shrink-0" />
          <span>{props.noneCopy}</span>
        </div>
      )}

      {breakdown.kind === "list" && (
        <ul className="mt-3 space-y-3">
          {breakdown.rows.map((row: HealthCounterRow): ReactElement => {
            return (
              <li
                key={row.reason}
                data-testid={`${props.dataTestId}-row`}
                data-reason={row.reason}
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words text-gray-800">
                    {row.label ? capitalize(row.label) : row.reason}
                    {row.label && (
                      <code className="ml-1.5 text-xs text-gray-400">
                        {row.reason}
                      </code>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-gray-900">
                    {formatCountForCopy(row.count)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${props.barClassName}`}
                    style={{ width: `${row.sharePercent}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Storage */

function UsageMeterRow(props: {
  label: string;
  meter: UsageMeter;
  noLimitCopy: string;
  dataTestId: string;
}): ReactElement {
  const { meter } = props;

  return (
    <div
      data-testid={props.dataTestId}
      data-kind={meter.kind}
      data-tone={meter.kind === "limited" ? meter.tone : undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-gray-900">{props.label}</span>
        {meter.kind === "limited" && (
          <span
            className={`text-sm font-semibold tabular-nums ${TONE_STYLES[meter.tone].valueClassName}`}
          >
            {meter.percent}%
          </span>
        )}
      </div>

      {meter.kind === "unknown" && (
        <p className="mt-1 text-sm text-gray-600">
          Unknown: the usage counter was unreachable.
        </p>
      )}

      {meter.kind === "unlimited" && (
        <>
          <p className="mt-1 text-sm tabular-nums text-gray-700">
            {meter.usedCopy} used
          </p>
          <p className="mt-0.5 text-xs text-gray-500">{props.noLimitCopy}</p>
        </>
      )}

      {meter.kind === "limited" && (
        <>
          <p className="mt-0.5 text-xs tabular-nums text-gray-500">
            {meter.usedCopy} of {meter.limitCopy}
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100"
            role="progressbar"
            aria-label={props.label}
            aria-valuenow={meter.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${TONE_STYLES[meter.tone].barClassName}`}
              style={{ width: `${Math.max(meter.percent, 1)}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Policy */

function DefinitionRow(props: {
  label: string;
  dataTestId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-3 sm:gap-4"
      data-testid={props.dataTestId}
    >
      <dt className="text-xs font-medium text-gray-500 sm:pt-0.5">
        {props.label}
      </dt>
      <dd className="min-w-0 text-sm text-gray-900 sm:col-span-2">
        {props.children}
      </dd>
    </div>
  );
}

function Chips(props: { values: Array<string> }): ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.values.map((value: string): ReactElement => {
        return (
          <code
            key={value}
            className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-800"
          >
            {value}
          </code>
        );
      })}
    </div>
  );
}

function describeSwitch(status: RecordingHealthStatus): {
  text: string;
  tone: HealthTone;
} {
  if (!status.policy.isProjectEnabled) {
    return { text: "Off for the project", tone: "error" };
  }

  if (!status.policy.isApplicationEnabled) {
    return { text: "Off for this application", tone: "error" };
  }

  return { text: "On", tone: "ok" };
}

function PolicyPanel(props: {
  rumApplicationId: ObjectID | string;
  status: RecordingHealthStatus;
}): ReactElement {
  const { status } = props;
  const recording: { text: string; tone: HealthTone } = describeSwitch(status);

  return (
    <HealthPanel
      title="Recording policy"
      description="What a recorder on your pages is told when it loads."
      icon={IconProp.ShieldCheck}
      dataTestId="health-policy"
      headerRight={
        <PanelLink
          to={getReplayPolicyPageRoute(props.rumApplicationId)}
          label="Edit policy"
          dataTestId="health-edit-policy"
        />
      }
    >
      <dl className="-my-2.5 divide-y divide-gray-100">
        <DefinitionRow label="Recording" dataTestId="health-policy-recording">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${TONE_STYLES[recording.tone].accentClassName}`}
              aria-hidden="true"
            />
            {recording.text}
          </span>
        </DefinitionRow>
        <DefinitionRow label="Uploads when" dataTestId="health-policy-trigger">
          {labelEnum(CAPTURE_TRIGGER_LABELS, status.policy.captureTrigger)}
        </DefinitionRow>
        <DefinitionRow label="Sampling" dataTestId="health-policy-sampling">
          <span className="tabular-nums">
            {status.policy.samplePercentage}%
          </span>
        </DefinitionRow>
        <DefinitionRow label="Consent" dataTestId="health-policy-consent">
          {labelEnum(CONSENT_MODE_LABELS, status.policy.consentMode)}
        </DefinitionRow>
        <DefinitionRow label="Masking" dataTestId="health-policy-masking">
          {labelEnum(MASKING_MODE_LABELS, status.policy.maskingMode)}
        </DefinitionRow>
        <DefinitionRow label="Retention" dataTestId="health-policy-retention">
          {status.policy.retentionInDays === null
            ? "not reported"
            : `${status.policy.retentionInDays} day${status.policy.retentionInDays === 1 ? "" : "s"}`}
        </DefinitionRow>
        <DefinitionRow
          label="Allowed origins"
          dataTestId="health-policy-origins"
        >
          {status.allowedOrigins.length === 0 ? (
            <span className="text-amber-700">
              Any origin the ingestion key allows
            </span>
          ) : (
            <Chips values={status.allowedOrigins} />
          )}
        </DefinitionRow>
      </dl>
    </HealthPanel>
  );
}

/* ------------------------------------------------------------ Recorder */

/*
 * docs-and-design-fidelity-3: this copy is what the docs send an operator to
 * when a visitor is stuck on a stale cached artifact, so its null copy has
 * to name WHICH silence it is looking at. "unknown" for both causes read as
 * a bug on every application that had simply never recorded.
 */
export function describeRecorderCapabilities(
  status: RecordingHealthStatus,
  recorderCapabilities: Array<string> | null,
): { value: Array<string> | string; hint: string } {
  const hasEverRecorded: boolean = status.lastChunkReceivedAt !== null;

  if (recorderCapabilities === null) {
    if (!hasEverRecorded) {
      return {
        value: "not reported yet",
        hint: "Announced on a session's first chunk. No chunk has arrived for this application yet, so there is no recorder to read them from.",
      };
    }

    return {
      value: "not reported",
      hint: `Capabilities are announced on a session's first chunk, and nothing announced them here: the newest recording was taken by an artifact older than the one that reports them${
        status.publishedRecorderVersion === null
          ? ""
          : ` (this deployment publishes ${status.publishedRecorderVersion})`
      }. A browser holding a cached artifact refreshes within its cache window.`,
    };
  }

  if (recorderCapabilities.length === 0) {
    return {
      value: "none announced",
      hint: "The newest session's recorder uploaded without announcing any capability.",
    };
  }

  return {
    value: recorderCapabilities,
    hint: "Read from the newest session's first chunk. A browser holding an older cached artifact refreshes within its cache window; until then its sessions lack the features missing here.",
  };
}

function RecorderPanel(props: {
  status: RecordingHealthStatus;
  recorderCapabilities: Array<string> | null;
}): ReactElement {
  const { status } = props;
  const capabilities: { value: Array<string> | string; hint: string } =
    describeRecorderCapabilities(status, props.recorderCapabilities);

  return (
    <HealthPanel
      title="Recorder"
      description="The browser script this deployment hands out, and what the newest session's recorder could capture."
      icon={IconProp.Code}
      dataTestId="health-recorder"
    >
      <div className="space-y-4">
        <div data-testid="health-recorder-version">
          <p className="text-xs font-medium text-gray-500">
            Published recorder
          </p>
          {status.publishedRecorderVersion === null ? (
            <>
              <p className="mt-1 text-sm text-gray-700">not reported</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Either this deployment builds no recorder artifact, or the
                server did not say.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 font-mono text-lg font-semibold text-gray-900">
                {status.publishedRecorderVersion}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                The build the /config route hands out to new page loads.
              </p>
            </>
          )}
        </div>
        <div data-testid="health-capabilities">
          <p className="text-xs font-medium text-gray-500">
            Capabilities (newest session)
          </p>
          <div className="mt-1.5">
            {typeof capabilities.value === "string" ? (
              <p className="text-sm text-gray-700">{capabilities.value}</p>
            ) : (
              <Chips values={capabilities.value} />
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
            {capabilities.hint}
          </p>
        </div>
      </div>
    </HealthPanel>
  );
}

/* --------------------------------------------------------------- Views */

function LoadingSkeleton(): ReactElement {
  return (
    <div
      className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="health-loading"
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((index: number): ReactElement => {
        return (
          <div key={index} className="animate-pulse bg-white p-6">
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="mt-4 h-6 w-16 rounded bg-gray-200" />
            <div className="mt-3 h-3 w-40 rounded bg-gray-100" />
          </div>
        );
      })}
    </div>
  );
}

export interface RecordingHealthDashboardViewProps {
  rumApplicationId: ObjectID | string;
  health: SessionReplayHealthSnapshot;
  onRefresh?: (() => void) | undefined;
  /* The wall clock for "Updated 12s ago"; defaults to the snapshot's clock. */
  clockUnixMs?: number | undefined;
  pollIntervalMs?: number | undefined;
}

/* Pure: renders one snapshot. */
export const RecordingHealthDashboardView: FunctionComponent<
  RecordingHealthDashboardViewProps
> = (props: RecordingHealthDashboardViewProps): ReactElement => {
  const { health } = props;
  const status: RecordingHealthStatus | null = health.isLoading
    ? null
    : health.status;

  const stages: Array<RecordingPipelineStage> =
    useMemo((): Array<RecordingPipelineStage> => {
      return status
        ? buildRecordingPipeline(status, health.diagnosis, health.nowUnixMs)
        : [];
    }, [status, health.diagnosis, health.nowUnixMs]);

  return (
    <div
      className="space-y-5"
      data-testid="health-page"
      data-state={health.isLoading ? "loading" : health.diagnosis.state}
    >
      <HealthHero
        rumApplicationId={props.rumApplicationId}
        health={health}
        clockUnixMs={props.clockUnixMs ?? health.nowUnixMs}
        pollIntervalMs={
          props.pollIntervalMs ?? SESSION_REPLAY_HEALTH_POLL_SLOW_MS
        }
        onRefresh={props.onRefresh}
      />

      {health.isLoading && <LoadingSkeleton />}

      {status !== null && (
        <>
          <RecordingPipeline stages={stages} />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <HealthPanel
              title="Uploads in the last 24 hours"
              description="What the server refused at the gate, and what it accepted but did not store."
              icon={IconProp.Upload}
              dataTestId="health-uploads"
            >
              <div className="space-y-6">
                <CounterList
                  title="Refused at the gate"
                  hint="Answered to the recorder with the same reason words its diagnostics quote."
                  noneCopy="No upload was refused in the last 24 hours."
                  breakdown={buildCounterBreakdown(status.refusalsLast24h)}
                  dataTestId="health-refusals"
                  barClassName="bg-amber-400"
                />
                <CounterList
                  title="Dropped after acceptance"
                  hint="Accepted with a 202, then not stored by the worker: a different fact from a refusal, and the recorder was never told."
                  noneCopy="No accepted chunk was dropped in the last 24 hours."
                  breakdown={buildCounterBreakdown(health.extras.dropsLast24h)}
                  dataTestId="health-drops"
                  barClassName="bg-rose-400"
                />
              </div>
            </HealthPanel>

            <HealthPanel
              title="Storage budget"
              description="Replay bytes against the project's daily limit and this application's monthly budget. Once a budget is spent, recorders are told to stop."
              icon={IconProp.Database}
              dataTestId="health-bytes"
              headerRight={
                <PanelLink
                  to={getReplayPolicyPageRoute(props.rumApplicationId)}
                  label="Change budget"
                  dataTestId="health-change-budget"
                />
              }
            >
              <div className="space-y-6">
                <UsageMeterRow
                  label="Project bytes today"
                  meter={buildUsageMeter(
                    status.projectBytesUsedToday,
                    status.dailyByteLimit,
                  )}
                  noLimitCopy="No daily limit is set on this deployment."
                  dataTestId="health-meter-project-day"
                />
                <UsageMeterRow
                  label="This application this month"
                  meter={buildUsageMeter(
                    status.applicationBytesUsedThisMonth,
                    status.monthlyBudgetInGB === null
                      ? null
                      : status.monthlyBudgetInGB * 1024 * 1024 * 1024,
                  )}
                  noLimitCopy="No monthly budget is set (0 or blank means no ceiling)."
                  dataTestId="health-meter-app-month"
                />
              </div>
            </HealthPanel>

            <PolicyPanel
              rumApplicationId={props.rumApplicationId}
              status={status}
            />

            <RecorderPanel
              status={status}
              recorderCapabilities={health.extras.recorderCapabilities}
            />
          </div>
        </>
      )}

      {!health.isLoading && (
        <HealthPanel
          title="Ask the browser"
          description="Anything that stops the recorder before it uploads - a blocked script, a Do Not Track signal, an unsampled session, consent that was never granted - is only visible in the browser."
          icon={IconProp.Beaker}
          dataTestId="health-browser-diagnostics"
        >
          <RecorderDiagnosticsPasteBox showHeading={false} />
        </HealthPanel>
      )}
    </div>
  );
};

/* How often the "Updated 12s ago" line re-reads the wall clock. */
export const HEALTH_CLOCK_TICK_MS: number = 10 * 1000;

export interface ComponentProps {
  rumApplicationId: ObjectID | string;
  pollIntervalMs?: number | undefined;
}

/* Connected: subscribes to the shared poller and ticks the "updated" clock. */
const RecordingHealthDashboard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const pollIntervalMs: number =
    props.pollIntervalMs ?? SESSION_REPLAY_HEALTH_POLL_SLOW_MS;

  const health: UseSessionReplayHealthResult = useSessionReplayHealth(
    props.rumApplicationId,
    { pollIntervalMs: pollIntervalMs },
  );

  const [clockUnixMs, setClockUnixMs] = useState<number>(Date.now());

  useEffect((): (() => void) => {
    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      setClockUnixMs(Date.now());
    }, HEALTH_CLOCK_TICK_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, []);

  return (
    <RecordingHealthDashboardView
      rumApplicationId={props.rumApplicationId}
      health={health}
      clockUnixMs={Math.max(clockUnixMs, health.nowUnixMs)}
      pollIntervalMs={pollIntervalMs}
      onRefresh={(): void => {
        void health.refresh();
      }}
    />
  );
};

export default RecordingHealthDashboard;
