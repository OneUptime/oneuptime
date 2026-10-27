import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import VMwareDataCollectionCard from "../../../Components/VMware/VMwareDataCollectionCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceMoreSettings from "../../../Components/TelemetryResource/TelemetryResourceMoreSettings";
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
            "Must match the vmware.vcenter.name the VMware Agent reports, if it sends this vCenter. Rename it there too, or its next report creates a new one.",
          placeholder: "prod-vcenter",
        }}
        descriptionField={{
          placeholder: "Production vCenter Server in the US East datacenter",
        }}
      />
      <VMwareDataCollectionCard modelId={modelId} />
      <TelemetryResourceMoreSettings<VMwareVCenter>
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
