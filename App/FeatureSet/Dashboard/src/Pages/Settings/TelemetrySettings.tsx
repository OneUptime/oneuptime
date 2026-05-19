import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import TelemetryRetentionConfigForm from "Common/UI/Components/Telemetry/TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "Common/UI/Components/Telemetry/TelemetryRetentionConfigSummary";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TelemetrySettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <CardModelDetail
        name="Telemetry Data Retention"
        cardProps={{
          title: "Telemetry Data Retention",
          description:
            "Umbrella default for how long telemetry data is retained. Used when neither the per-pillar config nor a service override applies.",
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
      <CardModelDetail
        name="Per-Pillar Retention Overrides"
        cardProps={{
          title: "Per-Pillar Retention Overrides",
          description:
            "Override retention per telemetry pillar (logs, traces, metrics, profiles), and customize logs by severity or traces by span status. Anything left blank falls back to the umbrella default above.",
        }}
        isEditable={true}
        editButtonText="Edit Overrides"
        formFields={[
          {
            field: { telemetryRetentionConfig: true },
            title: "Retention Overrides",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<Project>,
              props: CustomElementProps,
            ) => {
              return (
                <TelemetryRetentionConfigForm
                  {...props}
                  value={
                    value.telemetryRetentionConfig as
                      | TelemetryRetentionConfig
                      | undefined
                  }
                />
              );
            },
          },
        ]}
        onSaveSuccess={() => {
          Navigation.reload();
        }}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-telemetry-retention-overrides",
          fields: [
            {
              field: { telemetryRetentionConfig: true },
              fieldType: FieldType.Element,
              title: "Retention Overrides",
              getElement: (item: Project) => {
                return (
                  <TelemetryRetentionConfigSummary
                    config={item.telemetryRetentionConfig}
                  />
                );
              },
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </Fragment>
  );
};

export default TelemetrySettings;
