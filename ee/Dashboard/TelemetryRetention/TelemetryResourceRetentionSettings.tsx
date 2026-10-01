import {
  TelemetryResourceRetentionSettingsProps,
  TelemetryRetentionModel,
} from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
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

/**
 * The retention controls of a service's or telemetry resource's Settings
 * page (OneUptime Enterprise): the resource's own retention, and its
 * retention by telemetry type.
 *
 * Core's Components/TelemetryResource/TelemetryResourceRetentionSettings is
 * what every Settings page renders; it renders this component through the
 * Dashboard plugin (the "TelemetryResourceRetentionSettings" key), or the
 * upsell card when the project is not eligible or the build has no
 * Enterprise plugin.
 *
 * Without a valid Enterprise license (after the trial or the grace period),
 * or with one that leaves retention overrides out, the server stops applying
 * the overrides and refuses to set new ones: the notice says so and the
 * cards become read-only.
 */
const TelemetryResourceRetentionSettings: FunctionComponent<
  TelemetryResourceRetentionSettingsProps
> = (props: TelemetryResourceRetentionSettingsProps): ReactElement => {
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.TelemetryRetention,
  );
  const isEditable: boolean = !isEnterpriseConfigurationReadOnly(licenseMode);

  return (
    <Fragment>
      <TelemetryRetentionLicenseNotice mode={licenseMode} />
      <CardModelDetail<TelemetryRetentionModel>
        name="Telemetry Data Retention"
        cardProps={{
          title: "Telemetry Data Retention",
          description: `Set the default retention for telemetry collected from this ${props.resourceName}.`,
        }}
        isEditable={isEditable}
        editButtonText="Edit Retention"
        formFields={[
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Retain Telemetry Data For (Days)",
            description:
              "Leave blank to use the project's default telemetry retention.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "Use project default",
            validation: {
              minValue: 1,
            },
          },
        ]}
        modelDetailProps={{
          modelType: props.modelType,
          id: `${props.modelDetailIdPrefix}-telemetry-retention`,
          modelId: props.modelId,
          fields: [
            {
              field: {
                retainTelemetryDataForDays: true,
              },
              title: "Retain Telemetry Data For (Days)",
              description:
                "Falls back to the project's default telemetry retention when not set.",
              fieldType: FieldType.Number,
              placeholder: "Using project default",
            },
          ],
        }}
      />

      <CardModelDetail<TelemetryRetentionModel>
        name="Retention by Telemetry Type"
        cardProps={{
          title: "Retention by Telemetry Type",
          description: `Override retention for specific telemetry types collected from this ${props.resourceName}. Any field left blank falls back to the ${props.resourceName}'s default above, then the project's settings.`,
        }}
        isEditable={isEditable}
        editButtonText="Edit Overrides"
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: { telemetryRetentionConfig: true },
            title: "Retention Overrides",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<TelemetryRetentionModel>,
              customElementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <TelemetryRetentionConfigForm
                  {...customElementProps}
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
        modelDetailProps={{
          modelType: props.modelType,
          id: `${props.modelDetailIdPrefix}-telemetry-retention-overrides`,
          fields: [
            {
              field: { telemetryRetentionConfig: true },
              fieldType: FieldType.Element,
              title: "Retention Overrides",
              getElement: (item: TelemetryRetentionModel): ReactElement => {
                return (
                  <TelemetryRetentionConfigSummary
                    config={item.telemetryRetentionConfig}
                  />
                );
              },
            },
          ],
          modelId: props.modelId,
        }}
      />
    </Fragment>
  );
};

export default TelemetryResourceRetentionSettings;
