import PageComponentProps from "../../../PageComponentProps";
import ResourceFeed from "../../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import CloudAccountFeed, {
  CloudAccountFeedEventType,
} from "Common/Models/DatabaseModels/CloudAccountFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's feed (Activity → Feed): what happened to the account
 * in OneUptime - its Cloud AI agent connecting or being reset, its
 * configuration changing what OneUptime AI may do there, and every such
 * change a person made, with who made it. What changed in the cloud itself
 * is the Changes page beside it.
 */
const CloudAccountFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<CloudAccountFeed>
      modelType={CloudAccountFeed}
      resourceIdColumn="cloudAccountId"
      resourceId={modelId}
      eventTypeColumn="cloudAccountFeedEventType"
      eventTypes={Object.values(CloudAccountFeedEventType)}
      title="Cloud Account Feed"
      description="What happened to this account in OneUptime: its Cloud AI agent connecting or being reset, and every change to what OneUptime AI may do here."
      noItemsMessage="Nothing has happened to this account in OneUptime yet."
    />
  );
};

export default CloudAccountFeedPage;
