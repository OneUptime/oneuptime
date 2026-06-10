import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplicationClient from "Common/Models/DatabaseModels/RumApplicationClient";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Query from "Common/Types/BaseDatabase/Query";

const RumApplicationClients: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: Query<RumApplicationClient> = {
    rumApplicationId: modelId,
  } as any;

  return (
    <Fragment>
      <ModelTable<RumApplicationClient>
        modelType={RumApplicationClient}
        id="rum-application-clients-table"
        userPreferencesKey="rum-application-clients-table"
        name="RUM Application Clients"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        query={query}
        selectMoreFields={{ clientType: true }}
        cardProps={{
          title: "Clients",
          description:
            "Client platforms (browser / device) this application is seen on, as last reported via OpenTelemetry. Coarse by platform, not per end-user device.",
        }}
        noItemsMessage="No client platforms reported yet. Clients appear when telemetry carries browser.* / device.* resource attributes."
        filters={[
          {
            field: { clientName: true },
            title: "Client",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { clientName: true },
            title: "Client",
            type: FieldType.Text,
          },
          {
            field: { clientType: true },
            title: "Type",
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

export default RumApplicationClients;
