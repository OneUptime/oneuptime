import { countRetentionTypeOverrides } from "@oneuptime/dashboard/Components/TelemetryResource/TelemetryRetentionFold";
import { ProjectTelemetryRetentionByTypeProps } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
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
 *
 * It waits folded under the page's More settings, telling the page how many
 * types it overrides, once read and after each save (onRetentionChange),
 * so the folded header can say so.
 */
const ProjectTelemetryRetentionByType: FunctionComponent<
  ProjectTelemetryRetentionByTypeProps
> = (props: ProjectTelemetryRetentionByTypeProps): ReactElement => {
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
            "Keep logs, traces, metrics or profiles for longer or shorter than the default above. Blank fields use the default.",
        }}
        isEditable={!isEnterpriseConfigurationReadOnly(licenseMode)}
        editButtonText="Edit Overrides"
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: { telemetryRetentionConfig: true },
            title: "Retention Overrides",
            description: "Leave a type blank to keep the default retention.",
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
          onItemLoaded: (item: Project): void => {
            props.onRetentionChange?.({
              typeOverrideCount: countRetentionTypeOverrides(
                item.telemetryRetentionConfig,
              ),
            });
          },
        }}
      />
    </Fragment>
  );
};

export default ProjectTelemetryRetentionByType;
