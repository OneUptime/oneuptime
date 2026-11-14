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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { DOCS_URL } from "Common/UI/Config";
import {
  RecordingHealthAction,
  RecordingHealthActionTarget,
  RecordingHealthDiagnosis,
  RecordingHealthSeverity,
} from "Common/Types/Rum/SessionReplayHealth";
import { formatRelativeAge } from "Common/Utils/SessionReplay/SessionReplayHealth";
import {
  ComposedValue,
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  formatList,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { RecommendationStatusFilter } from "../Recommendations/RecommendationViewModel";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  SessionReplayHealthError,
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
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

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

/*
 * One application's Recommendations page, opened on its session replay
 * storage budget alerts. `search` pre-fills that page's search box
 * (MonitorRecommendations), and "budget" matches those alerts' names and no
 * other RUM recommendation. `status=All` shows them whether they are still
 * to set up or already created - the page otherwise opens on the ones still
 * available, which is an empty list once they exist. Route.addQueryParams
 * appends values verbatim, which single plain words survive unencoded;
 * populateRouteParams returns a fresh Route, so the shared RouteMap entry is
 * never appended to.
 */
export function getBudgetAlertRecommendationsRoute(
  rumApplicationId: ObjectID | string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_RECOMMENDATIONS] as Route,
    { modelId: new ObjectID(rumApplicationId.toString()) },
  ).addQueryParams({
    search: "budget",
    status: RecommendationStatusFilter.All,
  });
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

/*
 * The policy's choices by the words the settings page gives them. Each is a
 * key of the Dashboard's locales, looked up where it is drawn (labelEnum).
 */
export const CAPTURE_TRIGGER_LABELS: Record<string, string> = {
  [SessionReplayCaptureTrigger.Always]: translationKey("Always"),
  [SessionReplayCaptureTrigger.OnErrorOrFrustration]: translationKey(
    "On error or frustration",
  ),
};

export const CONSENT_MODE_LABELS: Record<string, string> = {
  [SessionReplayConsentMode.NotRequired]: translationKey("Not required"),
  [SessionReplayConsentMode.RequireExplicit]: translationKey(
    "Explicit consent required",
  ),
};

export const MASKING_MODE_LABELS: Record<string, string> = {
  [SessionReplayMaskingMode.MaskSensitiveInputsOnly]: translationKey(
    "Sensitive inputs masked, page text recorded",
  ),
  [SessionReplayMaskingMode.MaskInputsOnly]: translationKey(
    "All inputs masked, page text recorded",
  ),
  [SessionReplayMaskingMode.MaskAllText]: translationKey(
    "All text masked (wireframe)",
  ),
};

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A fixed line in the translator's language.
function translateLine(text: string, translator: Translator): string {
  return translator.translateText(text) || text;
}

/*
 * A raw enum value never reaches the screen; unknown values say so. In the
 * reader's language when the caller hands its Translator in, in English
 * without one.
 */
export function labelEnum(
  labels: Record<string, string>,
  value: string,
  translator: Translator = ENGLISH,
): string {
  if (value.length === 0) {
    return translator.translateText("not reported") || "not reported";
  }

  const label: string | undefined = labels[value];

  if (label === undefined) {
    return translator.translateTemplate("unrecognised value ({{value}})", {
      value: value,
    });
  }

  return translator.translateText(label) || label;
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
  const translator: Translator = useTranslator();
  const [text, setText] = useState<string>("");
  /*
   * The text that was explained, not its explanation: the explanation is
   * written when it is drawn, so it follows the reader's language.
   */
  const [explainedText, setExplainedText] = useState<string | null>(null);

  const result: RecorderDiagnosticsResult | null =
    explainedText === null
      ? null
      : explainRecorderDiagnostics(explainedText, translator);

  const explain: () => void = (): void => {
    setExplainedText(text);
  };

  const showHeading: boolean = props.showHeading !== false;

  return (
    <div data-testid="diagnostics-paste-box">
      {showHeading && (
        <>
          <div className="text-xs font-semibold text-gray-700">
            {translator.translateText("Ask the browser instead")}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {translator.translateText(
              "Anything that stops the recorder before it uploads - a blocked script, a Do Not Track signal, an unsampled session, consent that was never granted - is only visible in the browser. On the page that is not recording, run this in the console, then paste the result below:",
            )}
          </p>
        </>
      )}
      {!showHeading && (
        <p className="text-sm text-gray-600">
          {translator.translateText(
            "On the page that is not recording, run this in the browser console, then paste the result below.",
          )}
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
          <span>
            {translator.translateText("Every code, explained in the docs")}
          </span>
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

/*
 * The explanation as RecorderDiagnosticsExplainer writes it, already in the
 * reader's language; what the recorder wrote (codes, the record's detail,
 * its capabilities) is drawn as written.
 */
function RecorderDiagnosticsExplanationView(props: {
  explanation: RecorderDiagnosticsExplanation;
}): ReactElement {
  const { explanation } = props;
  const translator: Translator = useTranslator();

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
              <dt className="shrink-0 text-gray-500">
                {translator.translateText("Capabilities")}:
              </dt>
              <dd className="min-w-0 break-words text-gray-900">
                {formatList(explanation.capabilities, translator)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {explanation.unknownCodes.length > 0 && (
        <div className="mt-3 text-xs text-amber-700">
          {translator.translatePlural(
            {
              one: "{{count}} code newer than this dashboard: {{codes}}. The docs link above lists every code.",
              other:
                "{{count}} codes newer than this dashboard: {{codes}}. The docs link above lists every code.",
            },
            explanation.unknownCodes.length,
            {
              // The codes as the recorder wrote them, listed the sentence's way.
              codes: composedValue((sentence: Translator): string => {
                return formatList(explanation.unknownCodes, sentence);
              }),
            },
            { setsValuesApart: true },
          )}
        </div>
      )}

      {explanation.records.length === 0 ? (
        <div className="mt-3 text-sm text-gray-500">
          {translator.translateText(
            "The records array is empty: the recorder made no decision on that page at all, which means the loader never ran. Check that the script tag is on the page.",
          )}
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

/*
 * The note under a status kept on screen after a failed refresh: why the
 * refresh failed, and how old the status shown is ("earlier" when it was
 * never read). One whole sentence per failure kind, with and without the
 * time it was read, so no translated title is lower-cased into another
 * sentence. Every health surface that keeps a status on a failed refresh
 * says it in these words.
 */
export function describeStaleHealthRead(
  error: SessionReplayHealthError,
  fetchedAtUnixMs: number | null,
  nowUnixMs: number,
  translator: Translator,
): string {
  if (fetchedAtUnixMs === null) {
    if (error.kind === "permission") {
      return translateLine(
        "The last refresh failed (you cannot see recording health); showing the status read earlier.",
        translator,
      );
    }

    if (error.kind === "plan") {
      return translateLine(
        "The last refresh failed (recording health is not included in this project's plan); showing the status read earlier.",
        translator,
      );
    }

    return translateLine(
      "The last refresh failed (recording health could not be loaded); showing the status read earlier.",
      translator,
    );
  }

  // When it was read, in the language the sentence is read in.
  const values: { age: ComposedValue } = {
    age: composedValue((sentence: Translator): string => {
      return formatRelativeAge(fetchedAtUnixMs, nowUnixMs, sentence);
    }),
  };

  if (error.kind === "permission") {
    return translator.translateTemplate(
      "The last refresh failed (you cannot see recording health); showing the status read {{age}}.",
      values,
    );
  }

  if (error.kind === "plan") {
    return translator.translateTemplate(
      "The last refresh failed (recording health is not included in this project's plan); showing the status read {{age}}.",
      values,
    );
  }

  return translator.translateTemplate(
    "The last refresh failed (recording health could not be loaded); showing the status read {{age}}.",
    values,
  );
}

export interface RecordingHealthSummaryViewProps {
  rumApplicationId: ObjectID | string;
  health: SessionReplayHealthSnapshot;
}

/*
 * Pure: the policy page's one-line reading of one snapshot, with a way to
 * the full health page. A failed refresh keeps the last diagnosis on screen
 * and says how old it is, like every other health surface. The diagnosis
 * comes in the reader's language (useSessionReplayHealth writes it so).
 */
export const RecordingHealthSummaryView: FunctionComponent<
  RecordingHealthSummaryViewProps
> = (props: RecordingHealthSummaryViewProps): ReactElement => {
  const { health } = props;
  const translator: Translator = useTranslator();

  let body: ReactElement;

  if (health.isLoading) {
    body = (
      <div className="text-sm text-gray-500" data-testid="health-card-loading">
        {translator.translateText("Checking recording health…")}
      </div>
    );
  } else if (health.status === null && health.error) {
    const described: { title: string; detail: string } = describeHealthError(
      health.error,
      translator,
    );

    body = (
      <div
        className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
        data-testid="health-card-error"
      >
        <div className="text-sm font-semibold text-gray-900">
          {described.title}
        </div>
        <div className="mt-0.5 text-sm text-gray-700">{described.detail}</div>
        <div className="mt-1 text-xs text-gray-500">
          <ErrorSentence
            template="Server said: {{message}}"
            error={health.error.message}
            errorPlaceholder="message"
          />
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
            {describeStaleHealthRead(
              health.error,
              health.fetchedAtUnixMs,
              health.nowUnixMs,
              translator,
            )}
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
