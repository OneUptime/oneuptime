import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
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
      {/*
       * WI-28: hyperconverged PVE ↔ Ceph cross-link. Manual link ONLY —
       * pve-exporter exposes no Ceph fsid, so there is no honest
       * auto-link heuristic. The linked cluster's health/capacity render
       * as a card on the Proxmox overview (without affecting the Proxmox
       * health badge).
       */}
      <CardModelDetail<ProxmoxCluster>
        name="Ceph Storage Link"
        cardProps={{
          title: "Ceph Storage Link",
          description:
            "Running Ceph under this Proxmox cluster? Link the OneUptime Ceph cluster that backs its storage to get a Ceph health and capacity card on the Proxmox overview. The link is manual — Proxmox metrics carry no Ceph cluster identity.",
        }}
        isEditable={true}
        editButtonText="Edit Link"
        formFields={[
          {
            field: {
              cephCluster: true,
            },
            title: "Ceph Cluster",
            description:
              "The OneUptime Ceph cluster backing this Proxmox cluster's storage. Leave empty to unlink. Ceph health never changes the Proxmox health badge — the two products alert separately.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            placeholder: "Not linked",
            dropdownModal: {
              type: CephCluster,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        modelDetailProps={{
          modelType: ProxmoxCluster,
          id: "proxmox-cluster-ceph-link",
          modelId: modelId,
          fields: [
            {
              field: {
                cephCluster: {
                  name: true,
                },
              },
              title: "Ceph Cluster",
              fieldType: FieldType.Element,
              getElement: (item: ProxmoxCluster): ReactElement => {
                return <span>{item.cephCluster?.name || "Not linked"}</span>;
              },
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
