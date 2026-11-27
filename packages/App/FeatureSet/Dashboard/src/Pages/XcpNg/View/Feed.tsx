import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import XcpNgPoolFeed, {
  XcpNgPoolFeedEventType,
} from "Common/Models/DatabaseModels/XcpNgPoolFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const XcpNgPoolFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<XcpNgPoolFeed>
      modelType={XcpNgPoolFeed}
      resourceIdColumn="xcpNgPoolId"
      resourceId={modelId}
      eventTypeColumn="xcpNgPoolFeedEventType"
      eventTypes={Object.values(XcpNgPoolFeedEventType)}
      title="XCP-ng Pool Feed"
      description="Everything that has happened to this XCP-ng pool - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this XCP-ng pool yet."
    />
  );
};

export default XcpNgPoolFeedPage;
