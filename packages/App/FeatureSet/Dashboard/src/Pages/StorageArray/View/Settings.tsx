import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { StorageSystemUtil } from "Common/Types/StorageArray/StorageSystem";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StorageArraySettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<StorageArray>
        modelType={StorageArray}
        modelId={modelId}
        id="storage-array-details"
        title="Storage Array Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the storage.array.name the Storage Array Agent reports (its STORAGE_ARRAY_NAME). Telemetry is matched to this array by it: rename it on the agent too, or the agent's next report creates a new storage array.",
          placeholder: "pure-prod-01",
        }}
        descriptionField={{
          placeholder: "Production FlashArray backing block storage in US East",
        }}
        detailFields={[
          {
            field: {
              storageSystem: true,
            },
            title: "Platform",
            fieldType: FieldType.Element,
            getElement: (item: StorageArray): ReactElement => {
              return (
                <span>
                  {item.storageSystem
                    ? StorageSystemUtil.getDisplayName(item.storageSystem)
                    : "—"}
                </span>
              );
            },
          },
          {
            field: {
              reportedName: true,
            },
            title: "Name on the Array",
            fieldType: FieldType.Text,
          },
          {
            field: {
              systemId: true,
            },
            title: "System ID",
            fieldType: FieldType.Text,
          },
        ]}
      />
      <TelemetryResourceRetentionSettings<StorageArray>
        modelType={StorageArray}
        modelId={modelId}
        resourceName="storage array"
        modelDetailIdPrefix="model-detail-storage-array"
      />
      <ArchiveResourceCard<StorageArray>
        modelType={StorageArray}
        modelId={modelId}
        singularName="storage array"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STORAGE_ARRAYS] as Route,
        )}
      />
    </Fragment>
  );
};

export default StorageArraySettings;
