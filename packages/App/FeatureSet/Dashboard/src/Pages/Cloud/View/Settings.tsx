import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { useCloudResourceViewContext } from "./CloudResourceViewContext";
import Route from "Common/Types/API/Route";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ObjectID from "Common/Types/ObjectID";
import ModelDetailField from "Common/UI/Components/ModelDetail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import { isCloudResourceKindResource } from "Common/Types/Cloud/CloudResourceKind";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * What, besides its account and region, says which environment or resource
 * a row is - shown, never edited: those columns take no updates, because
 * telemetry is matched by them and a hand edit would only drift from what
 * the collector reports.
 */
const ENVIRONMENT_IDENTITY_DETAILS: Array<ModelDetailField<CloudResource>> = [
  {
    field: { cloudPlatform: true },
    title: "Cloud Platform (cloud.platform)",
    fieldType: FieldType.Text,
  },
];

const RESOURCE_IDENTITY_DETAILS: Array<ModelDetailField<CloudResource>> = [
  {
    field: { cloudResourceType: true },
    title: "Resource Type",
    fieldType: FieldType.Text,
  },
  {
    field: { providerResourceId: true },
    title: "Provider Resource ID",
    fieldType: FieldType.Text,
  },
  {
    field: { cloudResourceGroup: true },
    title: "Resource Group",
    fieldType: FieldType.Text,
  },
];

const CloudResourceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const { cloudResourceKind } = useCloudResourceViewContext();
  const isResource: boolean = isCloudResourceKindResource(cloudResourceKind);

  return (
    <Fragment>
      {/*
       * A cloud environment is matched to its telemetry by its platform,
       * account and region, and a resource discovered from cloud monitoring
       * by what its provider reports about it; neither ever changes, so
       * both are shown, never edited.
       */}
      <ResourceDetailsCard<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        id="cloud-resource-details"
        title="Resource Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this resource appears. Telemetry is not matched by the display name, so renaming is safe.",
          placeholder: isResource
            ? "vm-prod-01"
            : "AWS ECS · us-east-1 · 123456789012",
        }}
        descriptionField={{
          placeholder: isResource
            ? "Web tier VM for the checkout stack"
            : "Production ECS cluster for the checkout stack",
        }}
        identityFields={[
          {
            column: "cloudAccountId",
            title: "Cloud Account ID",
          },
          {
            column: "cloudRegion",
            title: "Cloud Region",
          },
        ]}
        detailFields={
          isResource ? RESOURCE_IDENTITY_DETAILS : ENVIRONMENT_IDENTITY_DETAILS
        }
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
        singularName={isResource ? "cloud resource" : "cloud environment"}
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[
            isResource
              ? PageMap.CLOUD_MONITORED_RESOURCES
              : PageMap.CLOUD_RESOURCES
          ] as Route,
        )}
      />
    </Fragment>
  );
};

export default CloudResourceSettings;
