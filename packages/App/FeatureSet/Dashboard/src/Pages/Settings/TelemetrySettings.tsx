import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import { getTelemetryRetentionUpsell } from "../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import RetentionOverrideLeftover from "../../Components/TelemetryResource/RetentionOverrideLeftover";
import { RetentionOverrideLeftoverKind } from "../../Components/TelemetryResource/RetentionOverrideLeftoverCopy";
import { TELEMETRY_RETENTION_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Settings > Telemetry. The project's default retention is part of every
 * edition; retention by telemetry type is Enterprise
 * (ee/Dashboard/TelemetryRetention), shown when the project may use it and
 * this build includes it, and as an upsell card otherwise - with, on
 * OneUptime Cloud below the plan, the retention by type a trial left set
 * under it, so it can be removed (RetentionOverrideLeftover).
 */
const TelemetrySettings: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <CardModelDetail
        name="Telemetry Data Retention"
        cardProps={{
          title: "Telemetry Data Retention",
          description:
            "Project-wide default retention for telemetry data. Used whenever no retention override applies.",
        }}
        isEditable={true}
        editButtonText="Edit Retention Settings"
        formFields={[
          {
            field: { defaultTelemetryRetentionInDays: true },
            title: "Default Retention (Days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            description:
              "Number of days to retain telemetry data when no more specific retention is configured.",
            placeholder: "15",
            validation: {
              minValue: 1,
            },
          },
        ]}
        onSaveSuccess={() => {
          Navigation.reload();
        }}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-telemetry-retention",
          fields: [
            {
              field: { defaultTelemetryRetentionInDays: true },
              fieldType: FieldType.Number,
              title: "Default Retention (Days)",
              placeholder: "15",
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
      <EnterprisePluginPage<PageComponentProps>
        plugin={getDashboardPlugins().SettingsTelemetryRetentionByType}
        pluginProps={props}
        requiredPlan={TELEMETRY_RETENTION_REQUIRED_PLAN}
        upsell={getTelemetryRetentionUpsell("of each type")}
        belowPlan={
          <RetentionOverrideLeftover<Project>
            modelType={Project}
            modelId={ProjectUtil.getCurrentProjectId()!}
            kind={RetentionOverrideLeftoverKind.Project}
          />
        }
      />
    </Fragment>
  );
};

export default TelemetrySettings;
