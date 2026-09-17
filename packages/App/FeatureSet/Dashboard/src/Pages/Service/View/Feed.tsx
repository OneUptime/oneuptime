import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import ServiceFeed from "Common/Models/DatabaseModels/ServiceFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ServiceFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<ServiceFeed>
      modelType={ServiceFeed}
      resourceIdColumn="serviceId"
      resourceId={modelId}
      eventTypeColumn="serviceFeedEventType"
      title="Service Feed"
      description="Everything that has happened to this service - how and why it was created, who owns it, and every change since."
      noItemsMessage="No activity has been recorded for this service yet."
    />
  );
};

export default ServiceFeedPage;
