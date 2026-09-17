import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import TelemetrySourceMap from "Common/Models/DatabaseModels/TelemetrySourceMap";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceSourceMaps: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<TelemetrySourceMap>
        modelType={TelemetrySourceMap}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          serviceId: modelId,
        }}
        id="service-source-maps-table"
        name="Service > Source Maps"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName="Source Map"
        userPreferencesKey="service-source-maps-table"
        cardProps={{
          title: "Source Maps",
          description:
            "Source maps uploaded for this service, used to unminify browser exception stack traces. Upload maps from CI with the source map upload API — see the Source Maps page in the documentation. Maps are matched to exceptions by release (the service.version resource attribute) and deleted automatically after 90 days.",
        }}
        noItemsMessage={
          "No source maps uploaded for this service yet. Upload them from your CI pipeline with a telemetry ingestion key — see the Source Maps page in the documentation."
        }
        showRefreshButton={true}
        searchableFields={["bundlePath", "serviceVersion"]}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        filters={[
          {
            field: {
              serviceVersion: true,
            },
            type: FieldType.Text,
            title: "Release",
          },
          {
            field: {
              bundlePath: true,
            },
            type: FieldType.Text,
            title: "Bundle",
          },
        ]}
        columns={[
          {
            field: {
              bundlePath: true,
            },
            title: "Bundle",
            type: FieldType.Text,
          },
          {
            field: {
              serviceVersion: true,
            },
            title: "Release",
            type: FieldType.Text,
          },
          {
            field: {
              sizeInBytes: true,
            },
            title: "Size (bytes)",
            type: FieldType.Number,
            noValueMessage: "-",
          },
          {
            field: {
              createdAt: true,
            },
            title: "Uploaded At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default ServiceSourceMaps;
