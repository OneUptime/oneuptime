import PageComponentProps from "../../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import InstallationTestPanel from "../../../Components/SessionReplay/InstallationTestPanel";
import TargetedCapturePanel from "../../../Components/SessionReplay/TargetedCapturePanel";

/*
 * Project-level session replay controls, under Real User Monitoring >
 * Settings. Session replay only exists for RUM applications, so this sits
 * beside the recordings and the applications it governs rather than in
 * project settings, where it was several clicks away from everything it
 * relates to.
 *
 * This page is deliberately NOT the place to edit one application's
 * masking or sampling - that lives on the application itself, under
 * Real User Monitoring > (application) > Session Replay Settings, next to
 * the recordings it governs. What belongs here is everything that is
 * project-shaped:
 *
 *   - the master switch, which is the control a data-protection owner
 *     reaches for and must be findable without knowing which application
 *     is at fault. It is never plan-gated: being able to stop recording
 *     your end users must not depend on a subscription.
 *   - the targeted-capture tool and the installation diagnostic, both of
 *     which already work across every application in the project.
 *
 * The table below is a read-only roster so somebody auditing the project
 * can see every application's policy at a glance, and click through to
 * change one.
 */

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

      {/*
       * Support workflow: arm a one-shot "record this user's next
       * session" target. Placed before the diagnostic panel because it is
       * an action, not a health readout.
       */}
      <TargetedCapturePanel />

      {/*
       * The diagnostic both the README and the customer docs point at.
       */}
      <InstallationTestPanel />

      <ModelTable<RumApplication>
        modelType={RumApplication}
        id="rum-application-session-replay-roster-table"
        userPreferencesKey="rum-application-session-replay-roster-table"
        name="Real User Monitoring > Settings > Session Replay > Applications"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        showViewIdButton={false}
        showRefreshButton={true}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          isSessionReplayEnabled: true,
          sessionReplayMaskingMode: true,
          sessionReplayAllowedOrigins: true,
          sessionReplaySamplePercentage: true,
        }}
        cardProps={{
          title: "Per-application Policy",
          description:
            "Masking, consent, sampling and retention are configured on each application. This is a read-only roster — open an application to change its policy.",
        }}
        noItemsMessage="No RUM applications yet. Create one under Real User Monitoring first."
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
               * Both relaxed modes record readable page text, so both are
               * flagged amber. Only the wireframe mode is green.
               */
              if (
                item.sessionReplayMaskingMode ===
                SessionReplayMaskingMode.MaskAllText
              ) {
                return <Pill color={Green} text="All text masked" />;
              }

              return item.sessionReplayMaskingMode ===
                SessionReplayMaskingMode.MaskInputsOnly ? (
                <Pill color={Yellow} text="Inputs masked" />
              ) : (
                <Pill color={Yellow} text="Sensitive inputs masked" />
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
               * Empty accepts every origin. That reads as "unset" unless
               * it is spelled out.
               */
              if (origins.length === 0) {
                return (
                  <span className="text-xs text-amber-700">
                    Any origin accepted
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
        /*
         * View opens the application's own Session Replay Settings tab
         * rather than its overview: this roster exists to answer "which
         * application has the wrong policy", so the click that follows
         * should land on the thing that changes it.
         */
        onViewPage={async (item: RumApplication): Promise<Route> => {
          return RouteUtil.populateRouteParams(
            RouteMap[
              PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
            ] as Route,
            { modelId: item.id! },
          );
        }}
      />
    </Fragment>
  );
};

export default RumSessionReplaySettings;
