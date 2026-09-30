import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
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
          ],
        }}
      />
      <TelemetryResourceRetentionSettings<VMwareVCenter>
        modelType={VMwareVCenter}
        modelId={modelId}
        resourceName="vCenter"
        modelDetailIdPrefix="model-detail-vmware-vcenter"
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
