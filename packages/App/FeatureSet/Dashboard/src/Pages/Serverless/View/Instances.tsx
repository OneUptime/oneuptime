import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ServerlessFunctionInstance from "Common/Models/DatabaseModels/ServerlessFunctionInstance";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";

const ServerlessFunctionInstances: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: Query<ServerlessFunctionInstance> = {
    serverlessFunctionId: modelId,
  } as any;

  return (
    <Fragment>
      <ModelTable<ServerlessFunctionInstance>
        modelType={ServerlessFunctionInstance}
        id="serverless-function-instances-table"
        userPreferencesKey="serverless-function-instances-table"
        name="Serverless Function Instances"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        query={query}
        cardProps={{
          title: "Instances",
          description:
            "Live inventory of this function's instances (faas.instance), as last reported via OpenTelemetry.",
        }}
        noItemsMessage="No instances reported yet. Instances appear when telemetry carries the faas.instance resource attribute."
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
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default ServerlessFunctionInstances;
