import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import VMwareDataCollectionCard from "../../../Components/VMware/VMwareDataCollectionCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
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
      <ResourceDetailsCard<VMwareVCenter>
        modelType={VMwareVCenter}
        modelId={modelId}
        id="vmware-vcenter-details"
        title="vCenter Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the vmware.vcenter.name the VMware Agent reports (its VMWARE_VCENTER_NAME), for a vCenter the agent sends: rename it on the agent too, or the agent's next report creates a new vCenter. A vCenter a probe collects can be renamed freely.",
          placeholder: "prod-vcenter",
        }}
        descriptionField={{
          placeholder: "Production vCenter Server in the US East datacenter",
        }}
      />
      <VMwareDataCollectionCard modelId={modelId} />
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
