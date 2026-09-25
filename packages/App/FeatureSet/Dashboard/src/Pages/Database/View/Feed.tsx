import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import DatabaseServerFeed, {
  DatabaseServerFeedEventType,
} from "Common/Models/DatabaseModels/DatabaseServerFeed";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DatabaseServerFeedPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <modelId>/feed, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceFeed<DatabaseServerFeed>
      modelType={DatabaseServerFeed}
      resourceIdColumn="databaseServerId"
      resourceId={modelId}
      eventTypeColumn="databaseServerFeedEventType"
      eventTypes={Object.values(DatabaseServerFeedEventType)}
      title="Database Feed"
      description="Everything that has happened to this database - how and why it was discovered or created, who owns it, when it was archived or restored, and every change since."
      noItemsMessage="No activity has been recorded for this database yet."
    />
  );
};

export default DatabaseServerFeedPage;
