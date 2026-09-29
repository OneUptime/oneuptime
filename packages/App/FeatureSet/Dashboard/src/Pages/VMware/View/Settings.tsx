import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import TelemetryRetentionConfigForm from "Common/UI/Components/Telemetry/TelemetryRetentionConfigForm";
import TelemetryRetentionConfigSummary from "Common/UI/Components/Telemetry/TelemetryRetentionConfigSummary";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const VMwareVCenterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<VMwareVCenter>
        name="vCenter Settings"
        cardProps={{
          title: "vCenter Settings",
          description: "Manage settings for this vCenter.",
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
              "Name for this vCenter. This should match the vmware.vcenter.name resource attribute reported by the VMware Agent (its VMWARE_VCENTER_NAME).",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "prod-vcenter",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            description: "Friendly description for this vCenter.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production vCenter Server in the US East datacenter",
          },
          {
            field: {
              retainTelemetryDataForDays: true,
            },
            title: "Retain Telemetry Data For (Days)",
            description:
              "Default retention for telemetry collected from this vCenter. Leave blank to use the project's default.",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "Use project default",
            validation: {
              minValue: 1,
            },
          },
        ]}
        modelDetailProps={{
          modelType: VMwareVCenter,
          id: "vmware-vcenter-settings",
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
                "Default retention for telemetry collected from this vCenter. Falls back to the project's default when not set.",
              fieldType: FieldType.Number,
              placeholder: "Using project default",
            },
          ],
        }}
      />
      <CardModelDetail<VMwareVCenter>
        name="Retention by Telemetry Type"
        cardProps={{
          title: "Retention by Telemetry Type",
          description:
            "Override retention for specific telemetry types for this vCenter. Any field left blank falls back to the vCenter default, then the project's settings.",
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
              value: FormValues<VMwareVCenter>,
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
          modelType: VMwareVCenter,
          id: "model-detail-vmware-vcenter-telemetry-retention-overrides",
          fields: [
            {
              field: { telemetryRetentionConfig: true },
              fieldType: FieldType.Element,
              title: "Retention Overrides",
              getElement: (item: VMwareVCenter) => {
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
      <ArchiveResourceCard<VMwareVCenter>
        modelType={VMwareVCenter}
        modelId={modelId}
        singularName="vCenter"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default VMwareVCenterSettings;
