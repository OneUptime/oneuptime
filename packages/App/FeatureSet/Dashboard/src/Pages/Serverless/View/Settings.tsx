import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServerlessFunctionSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <Fragment>
      {/*
       * The function name its telemetry carries (faas.name) never changes:
       * it is shown, never edited (its column takes no updates).
       */}
      <ResourceDetailsCard<ServerlessFunction>
        modelType={ServerlessFunction}
        modelId={modelId}
        id="serverless-function-details"
        title="Function Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this resource appears. Telemetry is not matched by the display name, so renaming is safe.",
          placeholder: "Checkout handler",
        }}
        descriptionField={{
          placeholder: "Handles checkout events",
        }}
        identityFields={[
          {
            column: "functionIdentifier",
            title: "Function Name (faas.name)",
          },
        ]}
      />
      <TelemetryResourceRetentionSettings<ServerlessFunction>
        modelType={ServerlessFunction}
        modelId={modelId}
        resourceName="serverless function"
        modelDetailIdPrefix="serverless-function"
      />
      <ArchiveResourceCard<ServerlessFunction>
        modelType={ServerlessFunction}
        modelId={modelId}
        singularName="function"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SERVERLESS_FUNCTIONS] as Route,
        )}
      />
    </Fragment>
  );
};

export default ServerlessFunctionSettings;
