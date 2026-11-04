import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import OpenStackDataCollectionCard from "../../../Components/OpenStack/OpenStackDataCollectionCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceMoreSettings from "../../../Components/TelemetryResource/TelemetryResourceMoreSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OpenStackCloudSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<OpenStackCloud>
        modelType={OpenStackCloud}
        modelId={modelId}
        id="openstack-cloud-details"
        title="Cloud Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the openstack.cloud.name the OpenStack agent reports, if it sends this cloud. Rename it there too, or its next report creates a new one.",
          placeholder: "prod-eu",
        }}
        descriptionField={{
          placeholder: "Production OpenStack cloud running in EU West",
        }}
      />
      <OpenStackDataCollectionCard modelId={modelId} />
      <TelemetryResourceMoreSettings<OpenStackCloud>
        modelType={OpenStackCloud}
        modelId={modelId}
        resourceName="OpenStack cloud"
        modelDetailIdPrefix="model-detail-openstack-cloud"
      />
      <ArchiveResourceCard<OpenStackCloud>
        modelType={OpenStackCloud}
        modelId={modelId}
        singularName="cloud"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.OPENSTACK_CLOUDS] as Route,
        )}
      />
    </Fragment>
  );
};

export default OpenStackCloudSettings;
