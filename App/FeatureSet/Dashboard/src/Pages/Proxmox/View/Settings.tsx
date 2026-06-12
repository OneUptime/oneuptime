import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import TelemetryRetentionConfigForm from "Common/UI/Components/Telemetry/TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "Common/UI/Components/Telemetry/TelemetryRetentionConfigSummary";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ProxmoxClusterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<ProxmoxCluster>
        name="Cluster Settings"
        cardProps={{
          title: "Cluster Settings",
          description: "Manage settings for this Proxmox cluster.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            description:
              "Name for this Proxmox cluster. This should match the proxmox.cluster.name resource attribute reported by the Proxmox Agent.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "pve-production",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            description: "Friendly description for this Proxmox cluster.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production Proxmox cluster running in US East",
          },
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Retain Telemetry Data For (Days)",
            description:
              "Default retention for telemetry collected from this Proxmox cluster. Leave blank to use the project's default.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "Use project default",
            validation: {
              minValue: 1,
            },
          },
        ]}
        modelDetailProps={{
          modelType: ProxmoxCluster,
          id: "proxmox-cluster-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                retainTelemetryDataForDays: true,
              },
              title: "Retain Telemetry Data For (Days)",
              description:
                "Default retention for telemetry collected from this Proxmox cluster. Falls back to the project's default when not set.",
              fieldType: FieldType.Number,
              placeholder: "Using project default",
            },
          ],
        }}
      />
      <CardModelDetail<ProxmoxCluster>
        name="Retention by Telemetry Type"
        cardProps={{
          title: "Retention by Telemetry Type",
          description:
            "Override retention for specific telemetry types for this Proxmox cluster. Any field left blank falls back to the cluster default, then the project's settings.",
        }}
        isEditable={true}
        editButtonText="Edit Overrides"
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: { telemetryRetentionConfig: true },
            title: "Retention Overrides",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            getCustomElement: (
              value: FormValues<ProxmoxCluster>,
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
        modelDetailProps={{
          modelType: ProxmoxCluster,
          id: "model-detail-proxmox-cluster-telemetry-retention-overrides",
          fields: [
            {
              field: { telemetryRetentionConfig: true },
              fieldType: FieldType.Element,
              title: "Retention Overrides",
              getElement: (item: ProxmoxCluster) => {
                return (
                  <TelemetryRetentionConfigSummary
                    config={item.telemetryRetentionConfig}
                  />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default ProxmoxClusterSettings;
