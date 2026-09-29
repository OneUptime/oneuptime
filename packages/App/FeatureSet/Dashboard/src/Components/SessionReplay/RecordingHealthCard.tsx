import React, { FunctionComponent, ReactElement, useState } from "react";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import { DOCS_URL } from "Common/UI/Config";
import {
  RecordingHealthAction,
  RecordingHealthActionTarget,
  RecordingHealthDiagnosis,
  RecordingHealthSeverity,
} from "Common/Types/Rum/SessionReplayHealth";
import { formatRelativeAge } from "Common/Utils/Rum/SessionReplayHealth";
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
 * The shared vocabulary of every recording-health surface, and the compact
 * summary the Replay Policy page shows.
 *
 * The full picture - the pipeline, refusals and drops, budgets, the policy
 * as the recorder sees it, the recorder's capabilities and the paste box -
 * lives on its own Replay Health page (RecordingHealthDashboard.tsx). The
 * policy page keeps only the one-line diagnosis, because that is what a
 * person editing the policy needs to see change, and links to the rest.
 */

const HEALTH_DOCS_PATH: string = "/telemetry/session-replay";
export const TROUBLESHOOTING_DOCS_PATH: string =
  "/rum/session-replay-troubleshooting";

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
          RouteMap[
            PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION
          ] as Route,
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

/* The Replay Health page for one application. */
export function getRecordingHealthPageRoute(
  rumApplicationId: ObjectID | string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_HEALTH] as Route,
    { modelId: new ObjectID(rumApplicationId.toString()) },
  );
}

/* The Replay Policy page for one application. */
export function getReplayPolicyPageRoute(
  rumApplicationId: ObjectID | string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS] as Route,
    { modelId: new ObjectID(rumApplicationId.toString()) },
  );
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
      {link.openInNewTab && (
        <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
      )}
    </Link>
  );
}

/* The diagnosis as a banner: icon, title, detail, one action. */
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

export interface RecorderDiagnosticsPasteBoxProps {
  /*
   * false when the surrounding panel already says what the box is for (the
   * Replay Health page's "Ask the browser" panel): only the instruction and
   * the box itself are drawn.
   */
  showHeading?: boolean | undefined;
}

/*
 * The paste box. getDiagnostics() output is the browser's half of the
 * story - a blocked script, a privacy signal, an unsampled draw, consent
 * never granted - and none of it is visible from the server. This is the
 * fallback, no longer the primary path: the live facts on the health page
 * answer most cases without it.
 */
export function RecorderDiagnosticsPasteBox(
  props: RecorderDiagnosticsPasteBoxProps,
): ReactElement {
  const [text, setText] = useState<string>("");
  const [result, setResult] = useState<RecorderDiagnosticsResult | null>(null);

  const explain: () => void = (): void => {
    setResult(explainRecorderDiagnostics(text));
  };

  const showHeading: boolean = props.showHeading !== false;

  return (
    <div data-testid="diagnostics-paste-box">
      {showHeading && (
        <>
          <div className="text-xs font-semibold text-gray-700">
            Ask the browser instead
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Anything that stops the recorder before it uploads - a blocked
            script, a Do Not Track signal, an unsampled session, consent that
            was never granted - is only visible in the browser. On the page that
            is not recording, run this in the console, then paste the result
            below:
          </p>
        </>
      )}
      {!showHeading && (
        <p className="text-sm text-gray-600">
          On the page that is not recording, run this in the browser console,
          then paste the result below.
        </p>
      )}
      <div className="mt-2">
        <CodeBlock
          language="javascript"
          code={`copy(JSON.stringify(OneUptimeReplay.getDiagnostics()));
// To also see every decision live: localStorage.setItem("oneuptime.sessionReplay.debug", "true"); then reload.`}
        />
      </div>
      <div className="mt-3">
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
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          title="Explain it"
          icon={IconProp.Beaker}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId="diagnostics-explain"
          disabled={text.trim().length === 0}
          onClick={explain}
        />
        <Link
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
          openInNewTab={true}
          to={URL.fromString(
            `${DOCS_URL.toString()}${TROUBLESHOOTING_DOCS_PATH}`,
          )}
        >
          <span>Every code, explained in the docs</span>
          <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
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

export interface RecordingHealthSummaryViewProps {
  rumApplicationId: ObjectID | string;
  health: SessionReplayHealthSnapshot;
}

/*
 * Pure: the policy page's one-line reading of one snapshot, with a way to
 * the full health page. A failed refresh keeps the last diagnosis on screen
 * and says how old it is, like every other health surface.
 */
export const RecordingHealthSummaryView: FunctionComponent<
  RecordingHealthSummaryViewProps
> = (props: RecordingHealthSummaryViewProps): ReactElement => {
  const { health } = props;

  let body: ReactElement;

  if (health.isLoading) {
    body = (
      <div className="text-sm text-gray-500" data-testid="health-card-loading">
        Checking recording health…
      </div>
    );
  } else if (health.status === null && health.error) {
    body = (
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
    );
  } else {
    body = (
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
      </>
    );
  }

  return (
    <Card
      title="Recording health"
      description="Whether recordings are arriving for this application under this policy. The Health page has the full picture: every stage, refusals, budgets and the recorder."
      buttons={[
        {
          title: "View health details",
          icon: IconProp.Heartbeat,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: (): void => {
            Navigation.navigate(
              getRecordingHealthPageRoute(props.rumApplicationId),
            );
          },
        },
      ]}
    >
      <div
        data-testid="health-card"
        data-state={health.isLoading ? "loading" : health.diagnosis.state}
      >
        {body}
      </div>
    </Card>
  );
};

export interface ComponentProps {
  rumApplicationId: ObjectID | string;
  pollIntervalMs?: number | undefined;
}

/* Connected: owns its subscription to the shared poller. */
const RecordingHealthCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const health: SessionReplayHealthSnapshot = useSessionReplayHealth(
    props.rumApplicationId,
    {
      pollIntervalMs:
        props.pollIntervalMs ?? SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
    },
  );

  return (
    <RecordingHealthSummaryView
      rumApplicationId={props.rumApplicationId}
      health={health}
    />
  );
};

export default RecordingHealthCard;
