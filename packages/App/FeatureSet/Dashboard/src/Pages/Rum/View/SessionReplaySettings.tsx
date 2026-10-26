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
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
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
import {
  asksForIgnoredErrorPatterns,
  CAPTURE_TRIGGER_CHOICES,
  CONSENT_MODE_CHOICES,
  EDIT_SESSION_REPLAY_POLICY_TITLE,
  MASKING_MODE_CHOICES,
} from "../../../Components/SessionReplay/SessionReplayPolicyChoices";
import {
  formatSessionReplayRetention,
  SESSION_REPLAY_RETENTION_OPTIONS,
} from "../../../Components/SessionReplay/SessionReplayRetention";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  SessionReplayHealthSnapshot,
} from "../../../Components/SessionReplay/useSessionReplayHealth";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

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
 *
 * The page opens on the health card, with no banner above it. The project's
 * switch is on unless someone turned it off (Project.isSessionReplayAllowed
 * defaults to true), and when it is off the health card says "Session replay
 * is switched off for this project" with a "Turn it on" action - the
 * disabled-project diagnosis in Common/Utils/Rum/SessionReplayHealth.ts. A
 * blue "Recording must also be allowed for the project" banner used to sit
 * here on every visit, saying so in the case nothing was wrong.
 *
 * This is also the one place an application's replay retention is edited
 * (Edit Policy > Limits). The application's Settings page shows the value
 * and links here (SessionReplayRetentionSettingsCard).
 */

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

/*
 * The Recording pill reads the health poller itself instead of a diagnosis
 * handed down by the page. ModelDetail builds its field renderers once, when
 * it mounts, so a getElement that closes over page state keeps the value that
 * state had on that render. Health has not answered by then, so the pill
 * used to read "On (project switch not checked yet)" forever. The poller is
 * shared per application (RecordingHealthCard already subscribes to it), so
 * this adds no request.
 */
export function EffectiveRecordingStatePill(props: {
  rumApplicationId: ObjectID | string;
  isApplicationEnabled: boolean | undefined;
}): ReactElement {
  const health: SessionReplayHealthSnapshot = useSessionReplayHealth(
    props.rumApplicationId,
    { pollIntervalMs: SESSION_REPLAY_HEALTH_POLL_SLOW_MS },
  );

  const diagnosis: RecordingHealthDiagnosis | null = health.isLoading
    ? null
    : health.diagnosis;

  const state: { text: string; color: typeof Green } =
    describeEffectiveRecordingState(props.isApplicationEnabled, diagnosis);

  return <Pill color={state.color} text={state.text} />;
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

export const SAME_ORIGIN_TRACE_PROPAGATION_TITLE: string =
  "Same-origin trace propagation";

/*
 * The column is NOT NULL DEFAULT true, and the gate reads anything but an
 * explicit false as on, so an unset value is described as the "on" it is.
 */
export function describeSameOriginTracePropagation(
  value: boolean | null | undefined,
): string {
  return value === false
    ? "Off: nothing is added to requests to your own origin"
    : "On: requests to your own origin carry a traceparent and this session's id";
}

const RumApplicationSessionReplaySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Route is ":id/session-replay-settings", so the model id is one segment
   * before the end. Same as Pages/Rum/View/Clients.tsx.
   */
  const modelIdString: string = Navigation.getLastParamAsString(1);

  /*
   * ModelDetail refetches whenever the modelId it is handed changes by
   * identity, and this page lifts the loaded policy into state. A fresh
   * ObjectID per render would therefore refetch on every render, forever:
   * each load re-rendered the page, which handed the card a new id, which
   * loaded again, so the policy card sat on its loading bar. The id is
   * memoized on the route param it came from.
   */
  const modelId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(modelIdString);
  }, [modelIdString]);

  /*
   * The loaded policy, captured from the detail card so the 0% alert and
   * the privacy summary read the same row the card shows, including after
   * an edit (the card refetches on save and calls onItemLoaded again).
   */
  const [application, setApplication] = useState<RumApplication | null>(null);

  const recordsNothing: boolean =
    application !== null &&
    application.sessionReplaySamplePercentage === 0 &&
    (application.sessionReplayCaptureTrigger ??
      SessionReplayCaptureTrigger.Always) ===
      SessionReplayCaptureTrigger.Always;

  return (
    <Fragment>
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
          editModalTitle={EDIT_SESSION_REPLAY_POLICY_TITLE}
          createEditModalWidth={ModalWidth.Large}
          onSaveSuccess={(item: RumApplication): void => {
            setApplication(item);
          }}
          /*
           * An emptied number box is saved as its column's default - the
           * sample percentage's 100, a budget's 0 - or, for the monthly
           * budget, as no ceiling, as every form's is (ModelForm,
           * BlankColumnValue).
           */
          /*
           * Privacy was one step of seven settings. Masking asks what a
           * recording hides; Consent & Identity asks whether it may be
           * uploaded and what it says about the person recorded.
           */
          formSteps={[
            { title: "Recording", id: "recording" },
            { title: "Masking", id: "privacy" },
            { title: "Consent & Identity", id: "consent" },
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
            /*
             * The three modes of the policy are answers to pick, each saying
             * in one line what it does (SessionReplayPolicyChoices), so no
             * description above them names every mode again.
             */
            {
              field: { sessionReplayCaptureTrigger: true },
              title: "When to upload a recording",
              stepId: "recording",
              fieldType: FormFieldSchemaType.RadioButton,
              radioButtonOptions: CAPTURE_TRIGGER_CHOICES,
              required: true,
              hideColumnDescription: true,
              dataTestId: "session-replay-capture-trigger",
            },
            {
              field: { sessionReplayIgnoreErrorPatterns: true },
              title: "Ignored error patterns",
              stepId: "recording",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '["ResizeObserver loop", "third-party-tag\\\\.js"]',
              description:
                "A JSON array of regexes for errors that should not trigger an upload, such as a noisy third-party script. They are still recorded.",
              showIf: (values: FormValues<RumApplication>): boolean => {
                return asksForIgnoredErrorPatterns(
                  values.sessionReplayCaptureTrigger,
                );
              },
            },
            {
              field: { sessionReplaySamplePercentage: true },
              title: "Sample percentage",
              stepId: "recording",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "100",
              description:
                "The share of sessions to record, 100 by default. Lower it to cut cost: with Always, halving it halves what is stored.",
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
                "A JSON array of origins that may send recordings. Empty accepts any origin the ingestion key allows; list your domains before production.",
            },

            {
              field: { sessionReplayMaskingMode: true },
              title: "Masking mode",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.RadioButton,
              radioButtonOptions: MASKING_MODE_CHOICES,
              required: true,
              description:
                "For other sensitive data, pick a stricter mode or add selectors below.",
              dataTestId: "session-replay-masking-mode",
            },
            {
              field: { sessionReplayConsentMode: true },
              title: "Consent",
              stepId: "consent",
              fieldType: FormFieldSchemaType.RadioButton,
              radioButtonOptions: CONSENT_MODE_CHOICES,
              required: true,
              hideColumnDescription: true,
              dataTestId: "session-replay-consent-mode",
            },
            {
              field: { sessionReplayMaskSelectors: true },
              title: "Additional mask selectors",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '[".customer-name", "#invoice-total"]',
              description:
                "A JSON array of CSS selectors to mask as well, shown as blocks. Use it for sensitive data your markup does not mark.",
            },
            {
              field: { sessionReplayBlockSelectors: true },
              title: "Block selectors",
              stepId: "privacy",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '["iframe.payment", ".id-document"]',
              description:
                "A JSON array of CSS selectors never recorded at all, shown as grey boxes. Use it for anything masking cannot make safe.",
            },
            {
              field: { sessionReplayCaptureUserIdentity: true },
              title: "Capture end-user identity",
              stepId: "consent",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "Store the user your page passes to identify(), so you can search for a customer's sessions.",
            },
            {
              field: { sessionReplayCaptureGeo: true },
              title: "Capture country",
              stepId: "consent",
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
                "Store canvas frames too. Costly, and the player shows a notice instead of replaying them.",
            },

            {
              field: { sessionReplayLcpBudgetMs: true },
              title: "Largest Contentful Paint budget (ms)",
              stepId: "performance",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "0",
              description:
                "Capture a session when its LCP exceeds this many milliseconds, such as 4000. 0 (default) turns it off.",
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
                "Capture a session when a main-thread task blocks this long, such as 200 ms. 0 (default) turns it off.",
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
                "Capture a session when a successful request takes at least this many milliseconds. 0 (default) turns it off.",
              validation: { minValue: 0 },
            },
            {
              field: { sessionReplaySameOriginTracePropagation: true },
              title: SAME_ORIGIN_TRACE_PROPAGATION_TITLE,
              stepId: "performance",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "Link requests to your own origin to their backend traces. Turn it off if downloads or redirects break after installing Session Replay.",
            },
            {
              field: { sessionReplayTracePropagationOrigins: true },
              title: "Trace propagation origins",
              stepId: "performance",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              placeholder: '["https://api.example.com"]',
              description:
                "A JSON array of other origins whose requests get a traceparent header, linking them to backend traces. Their APIs must allow it (CORS).",
            },

            {
              field: { sessionReplayRetentionInDays: true },
              title: "Retention",
              stepId: "limits",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: SESSION_REPLAY_RETENTION_OPTIONS,
              required: true,
              description:
                "How long recordings and their session rows are kept, 7 days by default. A session's logs, spans and exceptions follow the telemetry retention.",
            },
            {
              field: { sessionReplayMonthlyBudgetInGB: true },
              title: "Monthly budget (GB)",
              stepId: "limits",
              fieldType: FormFieldSchemaType.Number,
              required: false,
              placeholder: "No ceiling",
              description:
                "Stop recording for this application after this many GB a month. Leave empty for no limit.",
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
                  /*
                   * The id comes from the loaded row, not from this render's
                   * modelId: ModelDetail keeps the closure from its first
                   * render, and the row is what the card is showing.
                   */
                  return (
                    <EffectiveRecordingStatePill
                      rumApplicationId={item.id?.toString() || modelIdString}
                      isApplicationEnabled={item.isSessionReplayEnabled}
                    />
                  );
                },
              },
              {
                field: { sessionReplayCaptureTrigger: true },
                title: "Uploads when",
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {/*
                       * The words Edit Policy's choices use, in the reader's
                       * language like those choices.
                       */}
                      {translator.translateText(
                        labelEnum(
                          CAPTURE_TRIGGER_LABELS,
                          item.sessionReplayCaptureTrigger ?? "",
                        ),
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
                        {translator.translateText("not set (defaults to 100%)")}
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
                        {translator.translateText(
                          "Any origin the ingestion key allows - list your domains before production",
                        )}
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
                      {translator.translateText(
                        labelEnum(
                          CONSENT_MODE_LABELS,
                          item.sessionReplayConsentMode ?? "",
                        ),
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
                field: { sessionReplaySameOriginTracePropagation: true },
                title: SAME_ORIGIN_TRACE_PROPAGATION_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: RumApplication): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {describeSameOriginTracePropagation(
                        item.sessionReplaySameOriginTracePropagation,
                      )}
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
                      emptyCopy="None: no cross-origin request gets a traceparent"
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
                      {formatSessionReplayRetention(days)}
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
                      {gb && gb > 0
                        ? `${gb} GB`
                        : translator.translateText("No ceiling (0 or blank)")}
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
                sameOriginTracePropagation:
                  application.sessionReplaySameOriginTracePropagation,
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
