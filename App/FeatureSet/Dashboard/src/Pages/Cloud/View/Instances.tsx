import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";

const CloudResourceInstances: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: Query<CloudResourceInstance> = {
    cloudResourceId: modelId,
  } as any;

  return (
    <Fragment>
      <ModelTable<CloudResourceInstance>
        modelType={CloudResourceInstance}
        id="cloud-resource-instances-table"
        userPreferencesKey="cloud-resource-instances-table"
        name="Cloud Resource Instances"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        query={query}
        selectMoreFields={{ latestCpuPercent: true, latestMemoryBytes: true }}
        cardProps={{
          title: "Instances",
          description:
            "Live inventory of this resource's instances / tasks (service.instance.id), as last reported via OpenTelemetry.",
        }}
        noItemsMessage="No instances reported yet. Instances appear when telemetry carries the service.instance.id resource attribute."
        filters={[
          {
            field: { instanceName: true },
            title: "Instance",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { instanceName: true },
            title: "Instance",
            type: FieldType.Text,
          },
          {
            field: { latestCpuPercent: true },
            title: "CPU %",
            type: FieldType.Text,
          },
          {
            field: { latestMemoryBytes: true },
            title: "Memory (bytes)",
            type: FieldType.Text,
          },
          {
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default CloudResourceInstances;
