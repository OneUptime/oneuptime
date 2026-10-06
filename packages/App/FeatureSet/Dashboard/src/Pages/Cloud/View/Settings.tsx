import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useCloudResourceViewContext } from "./CloudResourceViewContext";
import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";

const CloudResourceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const { cloudResourceKind } = useCloudResourceViewContext();

  /*
   * A resource discovered from cloud monitoring is matched to its metrics by
   * what its provider reports, which never changes either: shown, never
   * edited. Its retention and archive work as an environment's do.
   */
  if (isCloudResourceKindResource(cloudResourceKind)) {
    return (
      <Fragment>
        <ResourceDetailsCard<CloudResource>
          modelType={CloudResource}
          modelId={modelId}
          id="cloud-resource-details"
          title="Resource Details"
          description="How this resource is named, described and labelled everywhere it appears."
          nameField={{
            title: "Display Name",
            description:
              "Shown everywhere this resource appears. Metrics are not matched by the display name, so renaming is safe.",
            placeholder: "vm-prod-01",
          }}
          descriptionField={{
            placeholder: "Web tier VM for the checkout stack",
          }}
          identityFields={[
            {
              column: "cloudResourceType",
              title: "Resource Type",
            },
            {
              column: "providerResourceId",
              title: "Provider Resource ID",
            },
            {
              column: "cloudAccountId",
              title: "Cloud Account ID",
            },
            {
              column: "cloudRegion",
              title: "Cloud Region",
            },
            {
              column: "cloudResourceGroup",
              title: "Resource Group",
            },
          ]}
        />
        <TelemetryResourceRetentionSettings<CloudResource>
          modelType={CloudResource}
          modelId={modelId}
          resourceName="cloud resource"
          modelDetailIdPrefix="cloud-resource"
        />
        <ArchiveResourceCard<CloudResource>
          modelType={CloudResource}
          modelId={modelId}
          singularName="cloud resource"
          listRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.CLOUD_MONITORED_RESOURCES] as Route,
          )}
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      {/*
       * A cloud environment is matched to its telemetry by its platform,
       * account and region, which never change: they are shown, never
       * edited (their columns take no updates).
       */}
      <ResourceDetailsCard<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        id="cloud-resource-details"
        title="Environment Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this resource appears. Telemetry is not matched by the display name, so renaming is safe.",
          placeholder: "AWS ECS · us-east-1 · 123456789012",
        }}
        descriptionField={{
          placeholder: "Production ECS cluster for the checkout stack",
        }}
        identityFields={[
          {
            column: "cloudPlatform",
            title: "Cloud Platform (cloud.platform)",
          },
          {
            column: "cloudAccountId",
            title: "Cloud Account ID",
          },
          {
            column: "cloudRegion",
            title: "Cloud Region",
          },
        ]}
      />
      <TelemetryResourceRetentionSettings<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        resourceName="cloud resource"
        modelDetailIdPrefix="cloud-resource"
      />
      <ArchiveResourceCard<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        singularName="cloud environment"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_RESOURCES] as Route,
        )}
      />
    </Fragment>
  );
};

export default CloudResourceSettings;
