import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceMoreSettings from "../../../Components/TelemetryResource/TelemetryResourceMoreSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ObjectID from "Common/Types/ObjectID";
import ModelDetailField from "Common/UI/Components/ModelDetail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * What, besides its account and region, says which environment a row is -
 * shown, never edited: the column takes no updates, because telemetry is
 * matched by it and a hand edit would only drift from what the apps report.
 */
const ENVIRONMENT_IDENTITY_DETAILS: Array<ModelDetailField<CloudResource>> = [
  {
    field: { cloudPlatform: true },
    title: "Cloud Platform (cloud.platform)",
    fieldType: FieldType.Text,
  },
];

/*
 * An environment's Settings: its details (the one place they are edited:
 * ResourceDetailsOnePlaceGuard), how long its telemetry is kept, and
 * Archive. A resource in a cloud account has its own, in Cloud.
 */
const AppPlatformEnvironmentSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <Fragment>
      {/*
       * An environment is matched to its telemetry by its platform, account
       * and region, which never change, so they are shown, never edited.
       */}
      <ResourceDetailsCard<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        id="cloud-resource-details"
        title="Environment Details"
        description="How this environment is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this environment appears. Telemetry is not matched by the display name, so renaming is safe.",
          placeholder: "AWS ECS · us-east-1 · 123456789012",
        }}
        descriptionField={{
          placeholder: "Production ECS cluster for the checkout stack",
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
        detailFields={ENVIRONMENT_IDENTITY_DETAILS}
      />
      {/*
       * Retention follows the row telemetry is filed under, and an
       * environment is that row for everything its apps send.
       */}
      <TelemetryResourceMoreSettings<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        resourceName="cloud environment"
        modelDetailIdPrefix="cloud-resource"
      />
      <ArchiveResourceCard<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        singularName="cloud environment"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route,
        )}
      />
    </Fragment>
  );
};

export default AppPlatformEnvironmentSettings;
