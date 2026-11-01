import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
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
 * What, besides its account and region, says which resource a row is -
 * shown, never edited: those columns take no updates, because they are
 * what its provider reports and a hand edit would only drift from it.
 */
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

/*
 * A cloud resource's Settings: its details (the one place they are edited:
 * ResourceDetailsOnePlaceGuard) and Archive. An environment has its own, in
 * App Platforms.
 */
const CloudResourceSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <Fragment>
      {/*
       * A resource is matched by what its provider reports about it, which
       * never changes, so it is shown, never edited.
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
          placeholder: "vm-prod-01",
        }}
        descriptionField={{
          placeholder: "Web tier VM for the checkout stack",
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
        detailFields={RESOURCE_IDENTITY_DETAILS}
      />
      {/*
       * No retention card: a resource discovered from cloud monitoring is
       * never the row its telemetry is filed under. Its metrics arrive under
       * the collector's OpenTelemetry resource, shared by every resource the
       * collector reads, so a retention set here would change nothing.
       */}
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
};

export default CloudResourceSettings;
