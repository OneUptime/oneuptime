import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  formatInline,
  getInlineSeparator,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import { RecordingHealthStatus } from "Common/Types/Rum/SessionReplayHealth";
import {
  formatCountForCopy,
  formatRelativeAge,
} from "Common/Utils/SessionReplay/SessionReplayHealth";
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
  describeStaleHealthRead,
  getBudgetAlertRecommendationsRoute,
  getReplayPolicyPageRoute,
  labelEnum,
} from "./RecordingHealthCard";
import {
  HealthCounterBreakdown,
  HealthCounterRow,
  HealthTone,
  RecordingPipelineStage,
  RecordingPipelineStageKey,
  UsageMeter,
  buildCounterBreakdown,
  buildRecordingPipeline,
  buildUsageMeter,
  describePollInterval,
} from "./RecordingHealthModel";
import { RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS } from "../MetricDescriptions/RumMetricDescriptions";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

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
 *      recorder receives it, the published artifact label and its capabilities.
 *   5. What does the browser say? The paste box for getDiagnostics().
 *
 * The rule every health surface keeps holds here too: a counter that could
 * not be read says "unknown" and is never drawn as zero or as green.
 *
 * Everything is drawn in the reader's language: the diagnosis comes so from
 * useSessionReplayHealth, the model's values and captions from the
 * translator handed to it, and the page's own words are looked up where
 * they are drawn. The panels below take their titles, labels and hints as
 * English literals and look them up themselves, as the shared components
 * do; the (i) beside a label gets the English, which it looks up itself.
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

/*
 * A stage's tone as a screen reader announces it after the stage's name.
 * English keys, looked up where they are drawn.
 */
const TONE_LABELS: Record<HealthTone, string> = {
  ok: translationKey("ok"),
  warning: translationKey("warning"),
  error: translationKey("error"),
  neutral: translationKey("neutral"),
};

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A fixed line in the translator's language.
function translateLine(text: string, translator: Translator): string {
  return translator.translateText(text) || text;
}

/*
 * A refusal's label standing on its own line: worded for the middle of a
 * sentence, so its first letter is raised here.
 */
function capitalize(value: string): string {
  return value.length === 0
    ? value
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/*
 * A white panel with a header; every section below the hero is one. Its
 * title and description are English literals, looked up here.
 */
function HealthPanel(props: {
  title: string;
  description?: string | undefined;
  icon: IconProp;
  dataTestId: string;
  headerRight?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <section
      className={`flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm ${props.className ?? ""}`}
      data-testid={props.dataTestId}
      aria-label={translator.translateText(props.title)}
    >
      <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200">
            <Icon icon={props.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText(props.title)}
            </h3>
            {props.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                {translator.translateText(props.description)}
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

// A link in a panel's header; its label is an English literal, looked up here.
function PanelLink(props: {
  to: Route;
  label: string;
  dataTestId: string;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Link
      to={props.to}
      /*
       * Every panel link opens another page of the product in place, like a
       * side menu link, so it starts that page at the top the way the side
       * menu does - not at this panel's scroll position, which lands a tall
       * page (Recommendations) scrolled past its search box and filters.
       */
      onClick={() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-indigo-600 hover:text-indigo-800"
    >
      <span data-testid={props.dataTestId}>
        {translator.translateText(props.label)}
      </span>
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
  const translator: Translator = useTranslator();
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
    title = translateLine("Checking recording health…", translator);
    detail = translateLine(
      "Reading what the server knows about recordings for this application.",
      translator,
    );
  } else if (hasNoStatus && health.error) {
    const described: { title: string; detail: string } = describeHealthError(
      health.error,
      translator,
    );

    title = described.title;
    detail = described.detail;
  }

  const fetchedAtUnixMs: number | null = health.fetchedAtUnixMs;

  const updatedCopy: string =
    fetchedAtUnixMs === null
      ? translateLine("Not read yet", translator)
      : translator.translateTemplate("Updated {{time}}", {
          time: composedValue((sentence: Translator): string => {
            return formatRelativeAge(
              fetchedAtUnixMs,
              Math.max(props.clockUnixMs, fetchedAtUnixMs),
              sentence,
            );
          }),
        });

  // "Recording health · acme-web": the page's name, then the application's.
  const eyebrow: string = health.status?.appIdentifier
    ? formatInline(
        [
          translateLine("Recording health", translator),
          health.status.appIdentifier,
        ],
        translator,
      )
    : translateLine("Recording health", translator);

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
              {eyebrow}
            </p>
            <h2
              className="mt-1 text-lg font-semibold leading-snug text-gray-900 sm:text-xl"
              data-testid="health-title"
            >
              {title}
            </h2>
            {/*
             * The state word the E2E suites read, as the code names the
             * state. Hidden from assistive technology as well: the title
             * says the same in the reader's words.
             */}
            <span
              className="sr-only"
              data-testid="health-level"
              aria-hidden="true"
            >
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
                <ErrorSentence
                  template="Server said: {{message}}"
                  error={health.error.message}
                  errorPlaceholder="message"
                />
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
            <span className="max-sm:hidden sm:inline">
              {getInlineSeparator(translator.language)}
              {describePollInterval(props.pollIntervalMs, translator)}
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
            {describeStaleHealthRead(
              health.error,
              health.fetchedAtUnixMs,
              health.nowUnixMs,
              translator,
            )}
          </span>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ Pipeline */

/*
 * What each stage's big value is read from, in the (i) beside its label.
 * The stage captions say what the value means for this status; these say
 * where it comes from and how often it moves.
 */
export const PIPELINE_STAGE_TOOLTIPS: Record<
  RecordingPipelineStageKey,
  string
> = {
  recorder: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.recorderLoaded,
  policy: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.recordingAllowed,
  uploads: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.chunksReceived,
  sessions: RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.sessionsLast24h,
};

function RecordingPipeline(props: {
  stages: Array<RecordingPipelineStage>;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid="health-pipeline"
      aria-label={translator.translateText("Recording pipeline")}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray-100 px-5 py-3 sm:px-6">
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateText("From page load to playable session")}
        </h3>
        <p className="text-xs text-gray-500">
          {translator.translateText(
            "Read left to right: the first amber or red step is where recordings stop.",
          )}
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
                    {translator.formatNumber(index + 1)}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    <span className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-gray-500">
                      {translator.translateText(stage.label)}
                    </span>
                    <InfoTooltip
                      label={stage.label}
                      text={PIPELINE_STAGE_TOOLTIPS[stage.key]}
                      dataTestId={`health-stage-${stage.key}-info`}
                    />
                  </span>
                  <Icon
                    icon={tone.icon}
                    className={`h-4 w-4 shrink-0 ${tone.iconClassName}`}
                  />
                  <span className="sr-only">
                    {translator.translateText(TONE_LABELS[stage.tone])}
                  </span>
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
                    className="absolute right-0 top-1/2 z-10 max-xl:hidden h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm xl:flex [&:dir(rtl)]:-translate-x-1/2"
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

/*
 * Refusals or drops by reason. Its title, hint and "none" line are English
 * literals, looked up here; the rows' labels come from the model in the
 * reader's language, and a reason the model has no words for is drawn as
 * the server wrote it.
 */
function CounterList(props: {
  title: string;
  hint: string;
  /* What is counted and over which window, in an (i) beside the title. */
  tooltip: string;
  noneCopy: string;
  breakdown: HealthCounterBreakdown;
  dataTestId: string;
  barClassName: string;
}): ReactElement {
  const { breakdown } = props;
  const translator: Translator = useTranslator();

  return (
    <div data-testid={props.dataTestId} data-kind={breakdown.kind}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="inline-flex items-center gap-1 text-sm font-medium text-gray-900">
          {translator.translateText(props.title)}
          <InfoTooltip
            label={props.title}
            text={props.tooltip}
            dataTestId={`${props.dataTestId}-info`}
          />
        </h4>
        {breakdown.kind === "list" && (
          <span
            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-700"
            data-testid={`${props.dataTestId}-total`}
          >
            {translator.translateTemplate("{{count}} total", {
              count: formatCountForCopy(breakdown.total, translator),
            })}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
        {translator.translateText(props.hint)}
      </p>

      {breakdown.kind === "unknown" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-600">
          <Icon icon={IconProp.Info} className="h-4 w-4 shrink-0" />
          <span>
            {translator.translateText(
              "Unknown: the counter store was unreachable.",
            )}
          </span>
        </div>
      )}

      {breakdown.kind === "none" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <Icon icon={IconProp.CheckCircle} className="h-4 w-4 shrink-0" />
          <span>{translator.translateText(props.noneCopy)}</span>
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
                    {formatCountForCopy(row.count, translator)}
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

/*
 * One byte budget. Its label and "no limit" line are English literals,
 * looked up here; the figures come from the model written the reader's way.
 */
function UsageMeterRow(props: {
  label: string;
  /* Which bytes, which window and which ceiling, in an (i) beside the label. */
  tooltip: string;
  meter: UsageMeter;
  noLimitCopy: string;
  dataTestId: string;
}): ReactElement {
  const { meter } = props;
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid={props.dataTestId}
      data-kind={meter.kind}
      data-tone={meter.kind === "limited" ? meter.tone : undefined}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-gray-900">
          {translator.translateText(props.label)}
          <InfoTooltip
            label={props.label}
            text={props.tooltip}
            dataTestId={`${props.dataTestId}-info`}
          />
        </span>
        {meter.kind === "limited" && (
          <span
            className={`text-sm font-semibold tabular-nums ${TONE_STYLES[meter.tone].valueClassName}`}
          >
            {translator.formatNumber(meter.percent)}%
          </span>
        )}
      </div>

      {meter.kind === "unknown" && (
        <p className="mt-1 text-sm text-gray-600">
          {translator.translateText(
            "Unknown: the usage counter was unreachable.",
          )}
        </p>
      )}

      {meter.kind === "unlimited" && (
        <>
          <p className="mt-1 text-sm tabular-nums text-gray-700">
            {translator.translateTemplate("{{used}} used", {
              used: meter.usedCopy,
            })}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {translator.translateText(props.noLimitCopy)}
          </p>
        </>
      )}

      {meter.kind === "limited" && (
        <>
          <p className="mt-0.5 text-xs tabular-nums text-gray-500">
            {translator.translateTemplate("{{used}} of {{limit}}", {
              used: meter.usedCopy,
              limit: meter.limitCopy,
            })}
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100"
            role="progressbar"
            aria-label={translator.translateText(props.label)}
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

// One setting of the policy; its label is an English literal, looked up here.
function DefinitionRow(props: {
  label: string;
  dataTestId: string;
  children: ReactNode;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <div
      className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-3 sm:gap-4"
      data-testid={props.dataTestId}
    >
      <dt className="text-xs font-medium text-gray-500 sm:pt-0.5">
        {translator.translateText(props.label)}
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

function describeSwitch(
  status: RecordingHealthStatus,
  translator: Translator,
): {
  text: string;
  tone: HealthTone;
} {
  if (!status.policy.isProjectEnabled) {
    return {
      text: translateLine("Off for the project", translator),
      tone: "error",
    };
  }

  if (!status.policy.isApplicationEnabled) {
    return {
      text: translateLine("Off for this application", translator),
      tone: "error",
    };
  }

  return { text: translateLine("On", translator), tone: "ok" };
}

function PolicyPanel(props: {
  rumApplicationId: ObjectID | string;
  status: RecordingHealthStatus;
}): ReactElement {
  const { status } = props;
  const translator: Translator = useTranslator();
  const recording: { text: string; tone: HealthTone } = describeSwitch(
    status,
    translator,
  );

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
          {labelEnum(
            CAPTURE_TRIGGER_LABELS,
            status.policy.captureTrigger,
            translator,
          )}
        </DefinitionRow>
        <DefinitionRow label="Sampling" dataTestId="health-policy-sampling">
          <span className="tabular-nums">
            {translator.formatNumber(status.policy.samplePercentage)}%
          </span>
        </DefinitionRow>
        <DefinitionRow label="Consent" dataTestId="health-policy-consent">
          {labelEnum(
            CONSENT_MODE_LABELS,
            status.policy.consentMode,
            translator,
          )}
        </DefinitionRow>
        <DefinitionRow label="Masking" dataTestId="health-policy-masking">
          {labelEnum(
            MASKING_MODE_LABELS,
            status.policy.maskingMode,
            translator,
          )}
        </DefinitionRow>
        <DefinitionRow label="Retention" dataTestId="health-policy-retention">
          {status.policy.retentionInDays === null
            ? translator.translateText("not reported")
            : translator.translatePlural(
                { one: "{{count}} day", other: "{{count}} days" },
                status.policy.retentionInDays,
              )}
        </DefinitionRow>
        <DefinitionRow
          label="Allowed origins"
          dataTestId="health-policy-origins"
        >
          {status.allowedOrigins.length === 0 ? (
            <span className="text-amber-700">
              {translator.translateText("Any origin the ingestion key allows")}
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
 * when a visitor is running an older, long-lived page, so its null copy has
 * to name WHICH silence it is looking at. "unknown" for both causes read as a
 * bug on every application that had simply never recorded.
 *
 * In the translator's language; English, word for word, without one. The
 * capabilities themselves are the recorder's own words, kept as written.
 */
export function describeRecorderCapabilities(
  status: RecordingHealthStatus,
  recorderCapabilities: Array<string> | null,
  translator: Translator = ENGLISH,
): { value: Array<string> | string; hint: string } {
  const translate: (text: string) => string = (text: string): string => {
    return translateLine(text, translator);
  };
  const hasEverRecorded: boolean = status.lastChunkReceivedAt !== null;

  if (recorderCapabilities === null) {
    if (!hasEverRecorded) {
      return {
        value: translate("not reported yet"),
        hint: translate(
          "Announced on a session's first chunk. No chunk has arrived for this application yet, so there is no recorder to read them from.",
        ),
      };
    }

    if (status.publishedRecorderVersion === null) {
      return {
        value: translate("not reported"),
        hint: translate(
          "Capabilities are announced on a session's first chunk, but the newest recording announced none and this deployment did not report a current recorder artifact to reload.",
        ),
      };
    }

    return {
      value: translate("not reported"),
      hint: translate(
        "Capabilities are announced on a session's first chunk, and nothing announced them here: the newest recording came from an older recorder, possibly on a page opened before the current deployment. A reload fetches the latest artifact.",
      ),
    };
  }

  if (recorderCapabilities.length === 0) {
    return {
      value: translate("none announced"),
      hint: translate(
        "The newest session's recorder uploaded without announcing any capability.",
      ),
    };
  }

  return {
    value: recorderCapabilities,
    hint: translate(
      "Read from the newest session's first chunk. Long-lived pages can keep an older recorder until they reload and fetch the latest artifact.",
    ),
  };
}

function RecorderPanel(props: {
  status: RecordingHealthStatus;
  recorderCapabilities: Array<string> | null;
}): ReactElement {
  const { status } = props;
  const translator: Translator = useTranslator();
  const capabilities: { value: Array<string> | string; hint: string } =
    describeRecorderCapabilities(
      status,
      props.recorderCapabilities,
      translator,
    );

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
            {translator.translateText("Published recorder")}
          </p>
          {status.publishedRecorderVersion === null ? (
            <>
              <p className="mt-1 text-sm text-gray-700">
                {translator.translateText("not reported")}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {translator.translateText(
                  "Either this deployment builds no recorder artifact, or the server did not say.",
                )}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 font-mono text-lg font-semibold text-gray-900">
                {status.publishedRecorderVersion}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {translator.translateText(
                  "The artifact label the /config route hands out to new page loads. Runtime chunks still report their exact build version.",
                )}
              </p>
            </>
          )}
        </div>
        <div data-testid="health-capabilities">
          <p className="text-xs font-medium text-gray-500">
            {translator.translateText("Capabilities (newest session)")}
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
  const translator: Translator = useTranslator();
  const status: RecordingHealthStatus | null = health.isLoading
    ? null
    : health.status;

  /*
   * Built on every render, in the reader's language: four stages are
   * cheap, and a language switch has to reach them.
   */
  const stages: Array<RecordingPipelineStage> = status
    ? buildRecordingPipeline(
        status,
        health.diagnosis,
        health.nowUnixMs,
        translator,
      )
    : [];

  /*
   * "Set up alerts" rides on the same fact that makes the Recommendations
   * page offer the storage budget alerts (the RUM row of
   * RecommendationResourceRegistry): replay is on for this application and
   * it has recorded. Before that, the link would open on a search that
   * matches no card.
   */
  const offersBudgetAlerts: boolean =
    status !== null &&
    status.policy.isApplicationEnabled &&
    Boolean(status.lastChunkReceivedAt);

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
                  tooltip={
                    RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.refusedAtGate
                  }
                  noneCopy={translationKey(
                    "No upload was refused in the last 24 hours.",
                  )}
                  breakdown={buildCounterBreakdown(
                    status.refusalsLast24h,
                    translator,
                  )}
                  dataTestId="health-refusals"
                  barClassName="bg-amber-400"
                />
                <CounterList
                  title="Dropped after acceptance"
                  hint="Accepted with a 202, then not stored by the worker: a different fact from a refusal, and the recorder was never told."
                  tooltip={
                    RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.droppedAfterAcceptance
                  }
                  noneCopy={translationKey(
                    "No accepted chunk was dropped in the last 24 hours.",
                  )}
                  breakdown={buildCounterBreakdown(
                    health.extras.dropsLast24h,
                    translator,
                  )}
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
              /*
               * Stacked rather than side by side: the header keeps this
               * column from shrinking, so two links in a row would squeeze
               * the title and description on a phone.
               */
              headerRight={
                <div className="flex flex-col items-end gap-1">
                  <PanelLink
                    to={getReplayPolicyPageRoute(props.rumApplicationId)}
                    label="Change budget"
                    dataTestId="health-change-budget"
                  />
                  {offersBudgetAlerts && (
                    <PanelLink
                      to={getBudgetAlertRecommendationsRoute(
                        props.rumApplicationId,
                      )}
                      label="Set up alerts"
                      dataTestId="health-budget-alerts"
                    />
                  )}
                </div>
              }
            >
              <div className="space-y-6">
                <UsageMeterRow
                  label="Project bytes today"
                  tooltip={
                    RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.projectBytesToday
                  }
                  meter={buildUsageMeter(
                    status.projectBytesUsedToday,
                    status.dailyByteLimit,
                    translator,
                  )}
                  noLimitCopy={translationKey(
                    "No daily limit is set on this deployment.",
                  )}
                  dataTestId="health-meter-project-day"
                />
                <UsageMeterRow
                  label="This application this month"
                  tooltip={
                    RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.applicationBytesThisMonth
                  }
                  meter={buildUsageMeter(
                    status.applicationBytesUsedThisMonth,
                    status.monthlyBudgetInGB === null
                      ? null
                      : status.monthlyBudgetInGB * 1024 * 1024 * 1024,
                    translator,
                  )}
                  noLimitCopy={translationKey(
                    "No monthly budget is set (0 or blank means no ceiling).",
                  )}
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
