import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "Common/Types/Rum/SessionReplay";
import { RecordingHealthDiagnosis } from "Common/Types/Rum/SessionReplayHealth";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecordingHealthCard, {
  CAPTURE_TRIGGER_LABELS,
  CONSENT_MODE_LABELS,
  labelEnum,
} from "../../../Components/SessionReplay/RecordingHealthCard";
import PrivacySummaryCard from "../../../Components/SessionReplay/PrivacySummaryCard";
import InstallationTestPanel from "../../../Components/SessionReplay/InstallationTestPanel";
import TargetedCapturePanel from "../../../Components/SessionReplay/TargetedCapturePanel";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  SessionReplayHealthSnapshot,
} from "../../../Components/SessionReplay/useSessionReplayHealth";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * THE settings page for one application's session replay.
 *
 * Top to bottom: recording health (is anything arriving, and if not, why),
 * the policy itself, what that policy means for the person being recorded,
 * the installation test for this application, and the targeted-capture
 * tool for this application. The project page keeps only the project-wide
 * master switch and a read-only roster; everything operational is here,
 * next to the recordings it governs.
 *
 * Every setting on this page takes effect in the END USER'S BROWSER, at
 * capture, before anything is uploaded. So loosening masking cannot be
 * undone for recordings already taken, and tightening it does not scrub
 * recordings already stored.
 */

/*
 * Retention is a closed set rather than a free number: under expiry-based
 * partitioning each distinct value creates its own ClickHouse partition per
 * ingest day, and it bounds the blast radius of a mis-set value.
 */
const RETENTION_OPTIONS: Array<DropdownOption> =
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS.map((days: number): DropdownOption => {
    return {
      label:
        days === DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS
          ? `${days} days (default)`
          : `${days} day${days === 1 ? "" : "s"}`,
      value: days,
    };
  });

/* The in-page anchor the privacy summary's "Change" links jump to. */
export const REPLAY_POLICY_ANCHOR_ID: string = "replay-policy";

/*
 * settings-setup-4: the pill used to say "On" from the application's own
 * flag alone, while the project switch was off or the budget was spent.
 * The effective state comes from the same diagnosis the health card shows,
 * so the two can never disagree; the flag alone is the fallback while the
 * diagnosis is still loading, and says so.
 */
export function describeEffectiveRecordingState(
  isApplicationEnabled: boolean | undefined,
  diagnosis: RecordingHealthDiagnosis | null,
): { text: string; color: typeof Green } {
  if (!isApplicationEnabled) {
    return { text: "Off for this application", color: Red };
  }

  if (diagnosis === null || diagnosis.state === "unknown") {
    return { text: "On (project switch not checked yet)", color: Yellow };
  }

  switch (diagnosis.state) {
    case "disabled-project":
      return { text: "Off: project switch is off", color: Red };
    case "disabled-app":
      return { text: "Off for this application", color: Red };
    case "budget-paused":
      return { text: "Paused: budget spent", color: Red };
    case "refusing":
      return { text: "On, but uploads are being refused", color: Yellow };
    case "never-loaded":
      return { text: "On, recorder never loaded", color: Yellow };
    case "loaded-never-uploaded":
      return { text: "On, nothing uploaded yet", color: Yellow };
    case "stale":
      return { text: "On, no chunk for a while", color: Yellow };
    case "healthy-quiet":
    case "healthy":
    default:
      return { text: "On", color: Green };
  }
}

function Chips(props: {
  values: Array<string> | undefined;
  emptyCopy: string;
}): ReactElement {
  const values: Array<string> = (props.values ?? []).filter(
    (value: string): boolean => {
      return typeof value === "string" && value.trim().length > 0;
    },
  );

  if (values.length === 0) {
    return <span className="text-sm text-gray-500">{props.emptyCopy}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value: string): ReactElement => {
        return (
          <code
            key={value}
            className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-800"
          >
            {value}
          </code>
        );
      })}
    </div>
  );
}

function describeBudgetMs(value: number | undefined): string {
  return value && value > 0 ? `${value} ms` : "Off";
}

const RumApplicationSessionReplaySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay-settings", so the model id is one segment
   * before the end. Same as Pages/Rum/View/Clients.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The loaded policy, captured from the detail card so the 0% alert and
   * the privacy summary read the same row the card shows, including after
   * an edit (the card refetches on save and calls onItemLoaded again).
   */
  const [application, setApplication] = useState<RumApplication | null>(null);

  const health: SessionReplayHealthSnapshot = useSessionReplayHealth(modelId, {
    pollIntervalMs: SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  });

  const diagnosis: RecordingHealthDiagnosis | null = health.isLoading
    ? null
    : health.diagnosis;

  const recordsNothing: boolean =
    application !== null &&
    application.sessionReplaySamplePercentage === 0 &&
    (application.sessionReplayCaptureTrigger ??
      SessionReplayCaptureTrigger.Always) ===
      SessionReplayCaptureTrigger.Always;

  return (
    <Fragment>
      <Alert
        type={AlertType.INFO}
        strongTitle="Recording must also be allowed for the project"
        title="These settings only take effect while session replay is allowed project-wide. That master switch lives under Real User Monitoring > Settings > Session Replay; the health card below says whether it is on."
      />

      <RecordingHealthCard rumApplicationId={modelId} />

      {recordsNothing && (
        <Alert
          type={AlertType.DANGER}
          dataTestId="sample-zero-alert"
          strongTitle="Nothing is being recorded"
          title="The sample percentage is 0% with the Always trigger, so no session is ever eligible. Set it to 100% (Edit Policy > Recording) to record the next visitor."
        />
      )}

      <div id={REPLAY_POLICY_ANCHOR_ID}>
        <CardModelDetail<RumApplication>
          name="Session Replay Policy"
          cardProps={{
            title: "Session Replay Policy",
            description:
              "Recording, masking, consent and limits for this application. Masking happens in the end user's browser before anything is uploaded.",
            buttons: [
              {
                title: "View recordings",
                icon: IconProp.Film,
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: (): void => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[
                        PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY
                      ] as Route,
                      { modelId: modelId },
                    ),
                  );
                },
              },
              {
                title: "Project-wide switch",
                icon: IconProp.Settings,
                buttonStyle: ButtonStyleType.OUTLINE,
                onClick: (): void => {
                  Navigation.navigate(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route,
                    ),
                  );
                },
              },
            ],
          }}
          isEditable={true}
          editButtonText="Edit Policy"
          createEditModalWidth={ModalWidth.Large}
          onSaveSuccess={(item: RumApplication): void => {
            setApplication(item);
          }}
          formSteps={[
            { title: "Recording", id: "recording" },
            { title: "Privacy", id: "privacy" },
            { title: "Performance & Tracing", id: "performance" },
            { title: "Limits", id: "limits" },
          ]}
          formFields={[
            {
              field: { isSessionReplayEnabled: true },
              title: "Record sessions for this application",
              stepId: "recording",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "On by default. Also requires session replay to be allowed for the project.",
            },
            {
              field: { sessionReplayCaptureTrigger: true },
              title: "When to upload a recording",
              stepId: "recording",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
                  SessionReplayCaptureTrigger,
                ),
              required: false,
              description:
                "Always (default) uploads every sampled session from its first event, so an ordinary session is just as watchable as a broken one. On error or frustration keeps a rolling in-memory buffer and only uploads when something actually went wrong, which costs roughly 15x less and stores far less end-user data - pick it when storage or data minimisation matters more than being able to watch a session that did not fail. In the list, an error-triggered session starts a few seconds before its first error.",
            },
            {
              field: { sessionReplaySamplePercentage: true },
              title: "Sample percentage",
              stepId: "recording",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "100",
              description:
                "Percentage of sessions eligible for recording, decided once per session from a hash of the session id so a session is never half-recorded. 100 by default. This is the dial for cost: with the Always trigger, halving it halves both the bytes stored and the end-user data at rest. 0 records nothing at all.",
              validation: { minValue: 0, maxValue: 100 },
            },
            {
              field: { sessionReplayAllowedOrigins: true },
              title: "Allowed origins",
              stepId: "recording",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '["https://app.example.com"]',
              description:
                "JSON array of origins allowed to post recordings for this application. Empty (the default) accepts any origin the ingestion key allows: the key has its own allowed-origins list, checked first, and a request must pass both. List your domains here before production so a copied key cannot write forged recordings from elsewhere.",
            },
            {
              field: { sessionReplayIgnoreErrorPatterns: true },
              title: "Ignored error patterns",
              stepId: "recording",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '["ResizeObserver loop", "third-party-tag\\\\.js"]',
              description:
                'JSON array of regex patterns matched against an uncaught error\'s message and source URL. Matching errors are still recorded in the session but no longer trigger an upload - use this to quiet a chronically-throwing third-party script without turning error capture off. Stackless cross-origin "Script error." noise is ignored automatically.',
            },

            {
              field: { sessionReplayMaskingMode: true },
              title: "Masking mode",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
                  SessionReplayMaskingMode,
                ),
              required: false,
              description:
                "Mask Sensitive Inputs Only (default) masks passwords and declared card / one-time-code fields and records the rest of the page as it looked: the player shows real page text. Mask Inputs Only additionally masks every other input value: the player shows page text but every form field as blocks. Mask All Text also replaces static page text: the player shows a wireframe with no readable copy. Anything your markup does not declare as sensitive - an account number in a plain text input, an order id in a heading - is only covered by the two stricter modes or by the selectors below.",
            },
            {
              field: { sessionReplayConsentMode: true },
              title: "Consent",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
                  SessionReplayConsentMode,
                ),
              required: false,
              description:
                "Not Required (the default) asserts you have a lawful basis that does not need a per-session grant. Require Explicit uploads nothing until your page calls grantConsent(); the recorder still buffers in memory so the run-up to an error is not lost while a banner is on screen. Under Require Explicit, a page that never grants consent shows up on the health card as consent-required refusals.",
            },
            {
              field: { sessionReplayMaskSelectors: true },
              title: "Additional mask selectors",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '[".customer-name", "#invoice-total"]',
              description:
                "JSON array of CSS selectors whose content is masked on top of whatever the masking mode already covers. This is the setting to reach for under the default masking mode, since it is what protects data your markup does not declare as sensitive. The player shows these elements as blocks.",
            },
            {
              field: { sessionReplayBlockSelectors: true },
              title: "Block selectors",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '["iframe.payment", ".id-document"]',
              description:
                "JSON array of CSS selectors that are not recorded at all - the element is replaced by an empty placeholder the player draws as a grey box. Use this for anything masking cannot make safe, including attribute values, which the recorder serialises verbatim.",
            },
            {
              field: { sessionReplayCaptureUserIdentity: true },
              title: "Capture end-user identity",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "On by default, so you can find the session a named customer is complaining about. This is what makes a recording identified rather than pseudonymous: the reference and traits your page supplies through identify() are stored alongside the hash used for erasure requests, and the list can be searched by user:. Turn it off to keep recordings pseudonymous.",
            },
            {
              field: { sessionReplayCaptureGeo: true },
              title: "Capture country",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "On by default. Stores a country code only. End-user IP addresses are never stored.",
            },
            {
              field: { sessionReplayRecordCanvas: true },
              title: "Record canvas contents",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "Off by default and expensive. Note that the player never replays canvas: doing so requires script execution inside the replay document, which is not acceptable for content authored by your end users. Recorded canvas frames are stored but shown as a fidelity notice instead.",
            },

            {
              field: { sessionReplayLcpBudgetMs: true },
              title: "Largest Contentful Paint budget (ms)",
              stepId: "performance",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "0",
              description:
                "Fire the performance capture trigger when the page's LCP exceeds this many milliseconds. 0 (default) turns this trigger off. A common starting point is 4000 - the boundary of a poor LCP.",
              validation: { minValue: 0 },
            },
            {
              field: { sessionReplayLongTaskBudgetMs: true },
              title: "Long task budget (ms)",
              stepId: "performance",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "0",
              description:
                "Fire the performance capture trigger when a single main-thread task blocks for at least this many milliseconds. 0 (default) turns this trigger off. Browsers only report tasks over 50ms; values of 200+ avoid recording ordinary jank.",
              validation: { minValue: 0 },
            },
            {
              field: { sessionReplaySlowRequestBudgetMs: true },
              title: "Slow request budget (ms)",
              stepId: "performance",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "0",
              description:
                "Fire the performance capture trigger when a fetch or XHR SUCCEEDS but takes at least this many milliseconds. 0 (default) turns this trigger off. Failed requests already trigger via the error path.",
              validation: { minValue: 0 },
            },
            {
              field: { sessionReplayTracePropagationOrigins: true },
              title: "Trace propagation origins",
              stepId: "performance",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '["https://api.example.com"]',
              description:
                "JSON array of origins whose fetch/XHR requests get a generated W3C traceparent header, linking recordings to backend traces without any browser tracing SDK - the player's rail then shows the backend spans behind each request. CAUTION: adding a header makes cross-origin requests preflighted - list an origin only if its API allows traceparent in Access-Control-Allow-Headers. Empty (default) never injects. Requests that already carry a traceparent are left untouched.",
            },

            {
              field: { sessionReplayRetentionInDays: true },
              title: "Retention",
              stepId: "limits",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: RETENTION_OPTIONS,
              required: false,
              description:
                "How long recordings are kept. Defaults to 7 days, not the 15 the other telemetry pillars use: replay is the highest-sensitivity pillar and a short retention is itself a privacy control. The session row - counts, signals, device - expires together with its footage; only the session's logs, spans and exceptions follow the telemetry retention.",
            },
            {
              field: { sessionReplayMonthlyBudgetInGB: true },
              title: "Monthly budget (GB)",
              stepId: "limits",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "No ceiling",
              description:
                "Upload budget for this application. Once exceeded, ingest tells live recorders to stop rather than silently dropping their chunks, and the health card says so. 0 or blank means no application-level ceiling; the project's daily byte limit still applies.",
              validation: { minValue: 0 },
            },
          ]}
          modelDetailProps={{
            modelType: RumApplication,
            id: "model-detail-rum-application-session-replay",
            onItemLoaded: (item: RumApplication): void => {
              setApplication(item);
            },
            fields: [
              {
                field: { isSessionReplayEnabled: true },
                title: "Recording",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  const state: { text: string; color: typeof Green } =
                    describeEffectiveRecordingState(
                      item.isSessionReplayEnabled,
                      diagnosis,
                    );

                  return <Pill color={state.color} text={state.text} />;
                },
              },
              {
                field: { sessionReplayCaptureTrigger: true },
                title: "Uploads when",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {labelEnum(
                        CAPTURE_TRIGGER_LABELS,
                        item.sessionReplayCaptureTrigger ?? "",
                      )}
                    </span>
                  );
                },
              },
              {
                field: { sessionReplaySamplePercentage: true },
                title: "Sampling",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  /*
                   * settings-setup-11: an undefined value used to print
                   * "0%", the one number that means "records nothing".
                   */
                  if (
                    item.sessionReplaySamplePercentage === undefined ||
                    item.sessionReplaySamplePercentage === null
                  ) {
                    return (
                      <span className="text-sm text-gray-500">
                        not set (defaults to 100%)
                      </span>
                    );
                  }

                  return (
                    <span className="font-mono text-sm tabular-nums text-gray-900">
                      {item.sessionReplaySamplePercentage}%
                    </span>
                  );
                },
              },
              {
                field: { sessionReplayAllowedOrigins: true },
                title: "Allowed origins",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  const origins: Array<string> =
                    item.sessionReplayAllowedOrigins ?? [];

                  /*
                   * An empty allowlist accepts everything the ingestion key
                   * allows - see SessionReplayGateCache.isOriginAllowed.
                   * Rendering a blank cell would read as "nothing gets
                   * through", which is the exact opposite of what it does.
                   */
                  if (origins.length === 0) {
                    return (
                      <span className="text-sm text-amber-700">
                        Any origin the ingestion key allows - list your domains
                        before production
                      </span>
                    );
                  }

                  return <Chips values={origins} emptyCopy="" />;
                },
              },
              {
                field: { sessionReplayIgnoreErrorPatterns: true },
                title: "Ignored error patterns",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <Chips
                      values={item.sessionReplayIgnoreErrorPatterns}
                      emptyCopy="None: every uncaught error can trigger an upload"
                    />
                  );
                },
              },
              {
                field: { sessionReplayMaskingMode: true },
                title: "Masking",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  /*
                   * The two relaxed modes both record readable page text, so
                   * both are flagged amber. Only the wireframe mode is green:
                   * nobody should discover what the default records by
                   * watching a recording of a customer's order details.
                   */
                  if (
                    item.sessionReplayMaskingMode ===
                    SessionReplayMaskingMode.MaskAllText
                  ) {
                    return (
                      <Pill
                        color={Green}
                        text="All text masked: wireframe replay"
                      />
                    );
                  }

                  return item.sessionReplayMaskingMode ===
                    SessionReplayMaskingMode.MaskInputsOnly ? (
                    <Pill
                      color={Yellow}
                      text="Inputs masked, page text recorded"
                    />
                  ) : (
                    <Pill
                      color={Yellow}
                      text="Sensitive inputs masked, rest recorded"
                    />
                  );
                },
              },
              {
                field: { sessionReplayConsentMode: true },
                title: "Consent",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {labelEnum(
                        CONSENT_MODE_LABELS,
                        item.sessionReplayConsentMode ?? "",
                      )}
                    </span>
                  );
                },
              },
              {
                field: { sessionReplayMaskSelectors: true },
                title: "Additional mask selectors",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <Chips
                      values={item.sessionReplayMaskSelectors}
                      emptyCopy="None beyond the masking mode"
                    />
                  );
                },
              },
              {
                field: { sessionReplayBlockSelectors: true },
                title: "Block selectors",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <Chips
                      values={item.sessionReplayBlockSelectors}
                      emptyCopy="None: every element is recorded (subject to masking)"
                    />
                  );
                },
              },
              {
                field: { sessionReplayCaptureUserIdentity: true },
                title: "Captures end-user identity",
                fieldType: FieldType.Boolean,
              },
              {
                field: { sessionReplayCaptureGeo: true },
                title: "Captures country",
                fieldType: FieldType.Boolean,
              },
              {
                field: { sessionReplayRecordCanvas: true },
                title: "Records canvas contents",
                fieldType: FieldType.Boolean,
              },
              {
                field: { sessionReplayLcpBudgetMs: true },
                title: "LCP budget",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {describeBudgetMs(item.sessionReplayLcpBudgetMs)}
                    </span>
                  );
                },
              },
              {
                field: { sessionReplayLongTaskBudgetMs: true },
                title: "Long task budget",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {describeBudgetMs(item.sessionReplayLongTaskBudgetMs)}
                    </span>
                  );
                },
              },
              {
                field: { sessionReplaySlowRequestBudgetMs: true },
                title: "Slow request budget",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {describeBudgetMs(item.sessionReplaySlowRequestBudgetMs)}
                    </span>
                  );
                },
              },
              {
                field: { sessionReplayTracePropagationOrigins: true },
                title: "Trace propagation origins",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <Chips
                      values={item.sessionReplayTracePropagationOrigins}
                      emptyCopy="None: no traceparent header is injected"
                    />
                  );
                },
              },
              {
                field: { sessionReplayRetentionInDays: true },
                title: "Retention",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  const days: number | undefined =
                    item.sessionReplayRetentionInDays;

                  return (
                    <span className="text-sm text-gray-900">
                      {days
                        ? `${days} day${days === 1 ? "" : "s"}`
                        : `not set (defaults to ${DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS} days)`}
                    </span>
                  );
                },
              },
              {
                field: { sessionReplayMonthlyBudgetInGB: true },
                title: "Monthly budget",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  const gb: number | undefined =
                    item.sessionReplayMonthlyBudgetInGB;

                  return (
                    <span className="text-sm text-gray-900">
                      {gb && gb > 0 ? `${gb} GB` : "No ceiling (0 or blank)"}
                    </span>
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />
      </div>

      <PrivacySummaryCard
        policy={
          application
            ? {
                maskingMode: application.sessionReplayMaskingMode,
                consentMode: application.sessionReplayConsentMode,
                captureUserIdentity:
                  application.sessionReplayCaptureUserIdentity,
                captureGeo: application.sessionReplayCaptureGeo,
                retentionInDays: application.sessionReplayRetentionInDays,
                maskSelectors: application.sessionReplayMaskSelectors,
                blockSelectors: application.sessionReplayBlockSelectors,
                recordCanvas: application.sessionReplayRecordCanvas,
              }
            : null
        }
        isLoading={application === null}
        changeHref={`#${REPLAY_POLICY_ANCHOR_ID}`}
      />

      <InstallationTestPanel rumApplicationId={modelId} />

      <TargetedCapturePanel rumApplicationId={modelId} />
    </Fragment>
  );
};

export default RumApplicationSessionReplaySettings;
