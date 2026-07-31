import PageComponentProps from "../../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "Common/Types/Rum/SessionReplay";
import Navigation from "Common/UI/Utils/Navigation";
import InstallationTestPanel from "../../../Components/SessionReplay/InstallationTestPanel";

/*
 * Privacy controls for session replay.
 *
 * Two levels, deliberately. The project-level switch is the kill switch a
 * data-protection owner needs and is intentionally NOT plan-gated: being able
 * to stop recording your end users must never depend on a subscription. The
 * per-application settings below are the operational policy, and every single
 * default is the safe one - recording off, all text masked, explicit consent
 * required, 0% sampling, an empty (and therefore refusing) origin allowlist.
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

const RumSessionReplaySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <CardModelDetail<Project>
        name="Session Replay Availability"
        cardProps={{
          title: "Session Replay for this Project",
          description:
            "Master switch for recording your end users' screens. While this is off, no application in this project can record and any chunk that arrives is refused at ingest. This control is never plan-gated.",
        }}
        isEditable={true}
        editButtonText="Update"
        formFields={[
          {
            field: {
              isSessionReplayAllowed: true,
            },
            title: "Allow session replay in this project",
            description:
              "Session replay records what real people did on your site, including anything not masked at capture. Turn it on only once you have confirmed your masking policy and your lawful basis for the recording.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-session-replay",
          fields: [
            {
              field: {
                isSessionReplayAllowed: true,
              },
              title: "Allow session replay in this project",
              placeholder: "Not allowed",
              fieldType: FieldType.Boolean,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      <ModelTable<RumApplication>
        modelType={RumApplication}
        id="rum-application-session-replay-settings-table"
        userPreferencesKey="rum-application-session-replay-settings-table"
        name="Settings > RUM Application Session Replay"
        isDeleteable={false}
        isEditable={true}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        createEditModalWidth={ModalWidth.Large}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          isSessionReplayEnabled: true,
          sessionReplayMaskingMode: true,
          sessionReplayAllowedOrigins: true,
          sessionReplaySamplePercentage: true,
        }}
        cardProps={{
          title: "Per-application Session Replay Policy",
          description:
            "Masking, consent, sampling and retention for each RUM application. Masking is applied in the end user's browser before anything is uploaded, so loosening it cannot be undone for recordings already taken - and tightening it does not scrub recordings already stored.",
        }}
        noItemsMessage="No RUM applications yet. Create one first, then configure its replay policy here."
        filters={[
          { field: { name: true }, title: "Application", type: FieldType.Text },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Application",
            type: FieldType.Text,
          },
          {
            field: { isSessionReplayEnabled: true },
            title: "Recording",
            type: FieldType.Element,
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
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              /*
               * MaskInputsOnly records page text verbatim. It is flagged
               * amber everywhere it appears so nobody discovers what it does
               * by watching a recording of a customer's order details.
               */
              return item.sessionReplayMaskingMode ===
                SessionReplayMaskingMode.MaskInputsOnly ? (
                <Pill color={Yellow} text="Inputs only (records page text)" />
              ) : (
                <Pill color={Green} text="All text masked" />
              );
            },
          },
          {
            field: { sessionReplaySamplePercentage: true },
            title: "Sampling",
            type: FieldType.Element,
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
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: RumApplication): ReactElement => {
              const origins: Array<string> =
                item.sessionReplayAllowedOrigins ?? [];

              /*
               * Empty is an allowlist with nothing on it, so ingest refuses
               * everything. That reads as "unset" unless it is spelled out.
               */
              if (origins.length === 0) {
                return (
                  <span className="text-xs text-amber-700">
                    None — all chunks refused
                  </span>
                );
              }

              return (
                <span className="truncate text-xs text-gray-700">
                  {origins.join(", ")}
                </span>
              );
            },
          },
        ]}
        formSteps={[
          { title: "Recording", id: "recording" },
          { title: "Privacy", id: "privacy" },
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
              "Off by default. Also requires session replay to be allowed for the project above.",
          },
          {
            field: { sessionReplayCaptureTrigger: true },
            title: "When to upload a recording",
            stepId: "recording",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
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
              "JSON array of origins allowed to post recordings. This is an allowlist: while it is empty every chunk is refused at ingest. It is one of the few real anti-abuse controls, since a browser can always regenerate ids until sampling passes.",
          },

          {
            field: { sessionReplayMaskingMode: true },
            title: "Masking mode",
            stepId: "privacy",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              SessionReplayMaskingMode,
            ),
            required: false,
            description:
              "MaskAllText (default, safe) replaces every text node and input value at capture, giving a wireframe. MaskInputsOnly is the LESS SAFE option: static page text is recorded verbatim, so any personal data rendered into the page - order ids, email addresses in a header, an error banner quoting user data - ends up in the recording.",
          },
          {
            field: { sessionReplayConsentMode: true },
            title: "Consent",
            stepId: "privacy",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              SessionReplayConsentMode,
            ),
            required: false,
            description:
              "RequireExplicit (default) uploads nothing until your page calls grantConsent(); the recorder still buffers in memory so the run-up to an error is not lost while a banner is on screen. NotRequired asserts you have a lawful basis that does not need a per-session grant.",
          },
          {
            field: { sessionReplayMaskSelectors: true },
            title: "Additional mask selectors",
            stepId: "privacy",
            fieldType: FormFieldSchemaType.JSON,
            required: false,
            placeholder: '[".customer-name", "#invoice-total"]',
            description:
              "JSON array of CSS selectors whose text is masked on top of whatever the masking mode already covers.",
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
              "Off by default. Turning this on is what converts a pseudonymous recording into an identified one: the reference your page supplies is stored alongside the hash used for erasure requests.",
          },
          {
            field: { sessionReplayCaptureGeo: true },
            title: "Capture country",
            stepId: "privacy",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Off by default. Stores a country code only. End-user IP addresses are never stored.",
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
        viewPageRoute={Navigation.getCurrentRoute()}
      />

      {/*
       * The diagnostic both the README and the customer docs point at.
       * Placed after the policy tables because its failing checks refer the
       * user back up to them.
       */}
      <InstallationTestPanel />
    </Fragment>
  );
};

export default RumSessionReplaySettings;
