import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import SessionReplayRetentionSettingsCard from "../../../Components/SessionReplay/SessionReplayRetentionSettingsCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ObjectID from "Common/Types/ObjectID";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const RumApplicationSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <Fragment>
      <TelemetryResourceRetentionSettings<RumApplication>
        modelType={RumApplication}
        modelId={modelId}
        resourceName="RUM application"
        modelDetailIdPrefix="rum-application"
      />
      <SessionReplayRetentionSettingsCard rumApplicationId={modelId} />
      <ArchiveResourceCard<RumApplication>
        modelType={RumApplication}
        modelId={modelId}
        singularName="application"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_APPLICATIONS] as Route,
        )}
      />
    </Fragment>
  );
};

export default RumApplicationSettings;
