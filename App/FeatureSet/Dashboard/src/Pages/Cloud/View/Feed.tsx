import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import CloudResourceFeed from "Common/Models/DatabaseModels/CloudResourceFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const CloudResourceFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<CloudResourceFeed>
      modelType={CloudResourceFeed}
      resourceIdColumn="cloudResourceId"
      resourceId={modelId}
      eventTypeColumn="cloudResourceFeedEventType"
      title="Cloud Resource Feed"
      description="Everything that has happened to this cloud resource - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this cloud resource yet."
    />
  );
};

export default CloudResourceFeedPage;
