import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  isEnterpriseConfigurationReadOnly,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import TelemetryRetentionConfigForm from "./TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "./TelemetryRetentionConfigSummary";
import TelemetryRetentionLicenseNotice from "./TelemetryRetentionLicenseNotice";

/*
 * Settings > Telemetry (OneUptime Enterprise): the project's retention by
 * telemetry type.
 *
 * Core's Pages/Settings/TelemetrySettings keeps the project's default
 * retention, which every edition has, and renders this card below it through
 * the Dashboard plugin (the "SettingsTelemetryRetentionByType" key), or the
 * upsell card when the project is not eligible or the build has no
 * Enterprise plugin.
 *
 * Without a valid Enterprise license, or with one that leaves retention
 * overrides out, the notice says the overrides are not applied and the card
 * becomes read-only.
 */
const ProjectTelemetryRetentionByType: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.TelemetryRetention,
  );

  return (
    <Fragment>
      <TelemetryRetentionLicenseNotice mode={licenseMode} />
      <CardModelDetail<Project>
        name="Retention by Telemetry Type"
        cardProps={{
          title: "Retention by Telemetry Type",
          description:
            "Override retention for specific telemetry types (logs, traces, metrics, profiles), with optional finer-grained rules for log severity and trace status. Any field left blank uses the default retention above.",
        }}
        isEditable={!isEnterpriseConfigurationReadOnly(licenseMode)}
        editButtonText="Edit Overrides"
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: { telemetryRetentionConfig: true },
            title: "Retention Overrides",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<Project>,
              props: CustomElementProps,
            ): ReactElement => {
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
              getElement: (item: Project): ReactElement => {
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

export default ProjectTelemetryRetentionByType;
