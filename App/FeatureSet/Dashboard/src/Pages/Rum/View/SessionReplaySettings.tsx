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
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Session replay policy for ONE application.
 *
 * Two levels exist, deliberately. The project-level master switch lives in
 * Real User Monitoring > Settings > Session Replay because it is the
 * control a data-protection owner reaches for, and it must be findable
 * without knowing which application is at fault. Everything here is the
 * operational policy for this application alone.
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

const RumApplicationSessionReplaySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route is ":id/session-replay-settings", so the model id is one segment
   * before the end. Same as Pages/Rum/View/Clients.tsx.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <Alert
        type={AlertType.INFO}
        strongTitle="Recording must also be allowed for the project"
        title="These settings only take effect while session replay is allowed project-wide. That master switch, the installation test and the targeted-capture tool live in Real User Monitoring > Settings > Session Replay."
      />

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
              title: "Project-wide replay settings",
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
              "On error or frustration keeps a rolling in-memory buffer and only uploads when something actually went wrong, which costs roughly 15x less and stores far less end-user data. Always uploads every sampled session from its first event.",
          },
          {
            field: { sessionReplaySamplePercentage: true },
            title: "Sample percentage",
            stepId: "recording",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "0",
            description:
              "Percentage of sessions eligible for recording, decided once per session from a hash of the session id so a session is never half-recorded. 0 means only the capture trigger above produces recordings.",
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
              "JSON array of origins allowed to post recordings. Leave it empty (the default) to accept any origin. Fill it in for production: your ingestion key is visible in your page's JavaScript, and this list is the only thing stopping someone who copies it from writing forged recordings into this project.",
          },
          {
            field: { sessionReplayIgnoreErrorPatterns: true },
            title: "Ignored error patterns",
            stepId: "recording",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            placeholder: '["ResizeObserver loop", "third-party-tag\\\\.js"]',
            description:
              'JSON array of regex patterns matched against an uncaught error\'s message and source URL. Matching errors are still recorded in the session but no longer trigger an upload — use this to quiet a chronically-throwing third-party script without turning error capture off. Stackless cross-origin "Script error." noise is ignored automatically.',
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
              "Mask Sensitive Inputs Only (default) masks passwords and declared card / one-time-code fields and records the rest of the page as it looked. Mask Inputs Only additionally masks every other input value. Mask All Text also replaces static page text, giving a wireframe with no readable copy. Anything your markup does not declare as sensitive — an account number in a plain text input, an order id in a heading — is only covered by the two stricter modes or by the selectors below.",
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
              "Not Required (default) asserts you have a lawful basis that does not need a per-session grant. Require Explicit uploads nothing until your page calls grantConsent(); the recorder still buffers in memory so the run-up to an error is not lost while a banner is on screen.",
          },
          {
            field: { sessionReplayMaskSelectors: true },
            title: "Additional mask selectors",
            stepId: "privacy",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            placeholder: '[".customer-name", "#invoice-total"]',
            description:
              "JSON array of CSS selectors whose content is masked on top of whatever the masking mode already covers. This is the setting to reach for under the default masking mode, since it is what protects data your markup does not declare as sensitive.",
          },
          {
            field: { sessionReplayBlockSelectors: true },
            title: "Block selectors",
            stepId: "privacy",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            placeholder: '["iframe.payment", ".id-document"]',
            description:
              "JSON array of CSS selectors that are not recorded at all - the element is replaced by an empty placeholder. Use this for anything masking cannot make safe, including attribute values, which the recorder serialises verbatim.",
          },
          {
            field: { sessionReplayCaptureUserIdentity: true },
            title: "Capture end-user identity",
            stepId: "privacy",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "On by default, so you can find the session a named customer is complaining about. This is what makes a recording identified rather than pseudonymous: the reference your page supplies is stored alongside the hash used for erasure requests. Turn it off to keep recordings pseudonymous.",
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
              "Fire the performance capture trigger when the page's LCP exceeds this many milliseconds. 0 (default) turns this trigger off. A common starting point is 4000 — the boundary of a poor LCP.",
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
              "JSON array of origins whose fetch/XHR requests get a generated W3C traceparent header, linking recordings to backend traces without any browser tracing SDK. CAUTION: adding a header makes cross-origin requests preflighted — list an origin only if its API allows traceparent in Access-Control-Allow-Headers. Empty (default) never injects. Requests that already carry a traceparent are left untouched.",
          },

          {
            field: { sessionReplayRetentionInDays: true },
            title: "Retention",
            stepId: "limits",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: RETENTION_OPTIONS,
            required: false,
            description:
              "How long recordings are kept. Defaults to 7 days, not the 15 the other telemetry pillars use: replay is the highest-sensitivity pillar and a short retention is itself a privacy control. Session metadata is kept longer than the recording, so counts stay accurate after playback expires.",
          },
          {
            field: { sessionReplayMonthlyBudgetInGB: true },
            title: "Monthly budget (GB)",
            stepId: "limits",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "0",
            description:
              "Upload budget for this application. Once exceeded, ingest tells live recorders to stop rather than silently dropping their chunks.",
            validation: { minValue: 0 },
          },
        ]}
        modelDetailProps={{
          modelType: RumApplication,
          id: "model-detail-rum-application-session-replay",
          fields: [
            {
              field: { isSessionReplayEnabled: true },
              title: "Recording",
              fieldType: FieldType.Element,
              getElement: (item: RumApplication): ReactElement => {
                return item.isSessionReplayEnabled ? (
                  <Pill color={Green} text="On" />
                ) : (
                  <Pill color={Red} text="Off" />
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
                  return <Pill color={Green} text="All text masked" />;
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
              field: { sessionReplayCaptureTrigger: true },
              title: "Uploads when",
              fieldType: FieldType.Text,
            },
            {
              field: { sessionReplaySamplePercentage: true },
              title: "Sampling",
              fieldType: FieldType.Element,
              getElement: (item: RumApplication): ReactElement => {
                return (
                  <span className="font-mono text-sm tabular-nums text-gray-900">
                    {item.sessionReplaySamplePercentage ?? 0}%
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
                 * An empty allowlist accepts everything - see
                 * SessionReplayGateCache.isOriginAllowed. Rendering a blank
                 * cell would read as "nothing gets through", which is the
                 * exact opposite of what it does.
                 */
                if (origins.length === 0) {
                  return (
                    <span className="text-sm text-amber-700">
                      Any origin accepted — list your domains before production
                    </span>
                  );
                }

                return (
                  <span className="text-sm text-gray-700">
                    {origins.join(", ")}
                  </span>
                );
              },
            },
            {
              field: { sessionReplayConsentMode: true },
              title: "Consent",
              fieldType: FieldType.Text,
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
              field: { sessionReplayRetentionInDays: true },
              title: "Retention (days)",
              fieldType: FieldType.Number,
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default RumApplicationSessionReplaySettings;
