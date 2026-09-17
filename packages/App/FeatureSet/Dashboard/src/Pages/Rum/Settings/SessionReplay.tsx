import PageComponentProps from "../../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * Project-level session replay controls, under Real User Monitoring >
 * Settings. What belongs here is everything that is project-shaped:
 *
 *   - the master switch, which is the control a data-protection owner
 *     reaches for and must be findable without knowing which application
 *     is at fault. It is never plan-gated: being able to stop recording
 *     your end users must not depend on a subscription.
 *   - a read-only roster so somebody auditing the project can see every
 *     application's policy and whether it is actually recording, and
 *     click through to change one.
 *
 * Everything operational - health, the policy, the installation test,
 * targeted capture - lives on the application's own Replay Policy page,
 * next to the recordings it governs. The two panels used to be mounted
 * here as well, with an application picker that defaulted to the first
 * application alphabetically; a link from application B's empty list
 * landed on A's test. They are gone from here on purpose.
 */

/*
 * Both budget counters the ingest gate stamps this column from are bucketed
 * on UTC windows - the project's daily byte cap on the UTC day, the
 * application's monthly budget on the UTC month (SessionReplayUsage's key
 * builders). A stamp from an earlier month therefore belongs to a window
 * that has certainly rolled over, whichever cap wrote it.
 */
export function isInCurrentUtcMonth(
  value: Date | string,
  nowUnixMs?: number,
): boolean {
  const stamp: Date =
    value instanceof Date ? value : OneUptimeDate.fromString(value);
  const stampUnixMs: number = stamp.getTime();

  if (!Number.isFinite(stampUnixMs)) {
    return false;
  }

  const now: Date = new Date(nowUnixMs ?? Date.now());

  return (
    stamp.getUTCFullYear() === now.getUTCFullYear() &&
    stamp.getUTCMonth() === now.getUTCMonth()
  );
}

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

      <Alert
        type={AlertType.INFO}
        dataTestId="project-replay-pointer"
        strongTitle="Looking for the installation test, recording health or targeted capture?"
        title="They live on each application's Replay Policy page (open an application below), so every check runs against the application you are actually setting up."
      />

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
          sessionReplayConsentMode: true,
          sessionReplayAllowedOrigins: true,
          sessionReplaySamplePercentage: true,
          sessionReplayLastChunkReceivedAt: true,
          sessionReplayBudgetExceededAt: true,
        }}
        cardProps={{
          title: "Per-application Policy",
          description:
            "Masking, consent, sampling and retention are configured on each application. This is a read-only roster - open an application to change its policy or test its installation.",
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
              /*
               * settings-setup-4: the flag alone said "On" for an
               * application whose budget was spent. The budget stamp is a
               * column this roster can read; the project switch is the card
               * above, so it is not repeated per row.
               */
              if (!item.isSessionReplayEnabled) {
                return <Pill color={Red} text="Off" />;
              }

              /*
               * server-1: the stamp is the LAST exhaustion and is never
               * cleared, so this pill claimed an application was over
               * budget for as long as the row lived. Both budget windows
               * that write it (the project's UTC day, the application's
               * UTC month) have certainly rolled over once the stamp is
               * from an earlier month, and this roster has no usage
               * counter to say more than that - so it qualifies the claim
               * by window and the application's own page, which does read
               * the live counters, gives the exact answer.
               */
              if (
                item.sessionReplayBudgetExceededAt &&
                isInCurrentUtcMonth(item.sessionReplayBudgetExceededAt)
              ) {
                return (
                  <Pill color={Yellow} text="On, budget exhausted this month" />
                );
              }

              return <Pill color={Green} text="On" />;
            },
          },
          {
            field: { sessionReplayLastChunkReceivedAt: true },
            title: "Last recording",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              if (!item.sessionReplayLastChunkReceivedAt) {
                return (
                  <span className="text-xs text-amber-700">Never received</span>
                );
              }

              return (
                <span className="text-xs text-gray-700">
                  {OneUptimeDate.fromNow(
                    OneUptimeDate.fromString(
                      item.sessionReplayLastChunkReceivedAt,
                    ),
                  )}
                </span>
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
            field: { sessionReplayConsentMode: true },
            title: "Consent",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: RumApplication): ReactElement => {
              return (
                <span className="text-xs text-gray-700">
                  {item.sessionReplayConsentMode ===
                  SessionReplayConsentMode.RequireExplicit
                    ? "Explicit consent required"
                    : "Not required"}
                </span>
              );
            },
          },
          {
            field: { sessionReplaySamplePercentage: true },
            title: "Sampling",
            type: FieldType.Element,
            getElement: (item: RumApplication): ReactElement => {
              /* settings-setup-11: never print 0% for a value that is not set. */
              if (
                item.sessionReplaySamplePercentage === undefined ||
                item.sessionReplaySamplePercentage === null
              ) {
                return <span className="text-xs text-gray-500">not set</span>;
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
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: RumApplication): ReactElement => {
              const origins: Array<string> =
                item.sessionReplayAllowedOrigins ?? [];

              /*
               * Empty accepts every origin the ingestion key allows. That
               * reads as "unset" unless it is spelled out.
               */
              if (origins.length === 0) {
                return (
                  <span className="text-xs text-amber-700">
                    Any origin the key allows
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
         * View opens the application's own Replay Policy page rather than
         * its overview: this roster exists to answer "which application has
         * the wrong policy", so the click that follows should land on the
         * thing that changes it.
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
