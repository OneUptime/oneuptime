import ResourceFeed from "../ResourceFeed/ResourceFeed";
import { getDataSecurityIssueFeedKind } from "./IssueFeedKind";
import DataSecurityIssueFeed, {
  DataSecurityIssueFeedEventType,
} from "Common/Models/DatabaseModels/DataSecurityIssueFeed";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  dataSecurityIssueId: ObjectID;
}

/*
 * An issue's timeline: when its check first failed, every change of
 * severity, evidence, status and assignee, the cases, alerts and
 * notifications it caused, and what OneUptime AI said about it - with who
 * did what. Written by OneUptime as it happens; nobody edits an entry.
 */
const IssueFeed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourceFeed<DataSecurityIssueFeed>
      modelType={DataSecurityIssueFeed}
      resourceIdColumn="dataSecurityIssueId"
      resourceId={props.dataSecurityIssueId}
      eventTypeColumn="dataSecurityIssueFeedEventType"
      eventTypes={Object.values(DataSecurityIssueFeedEventType)}
      title="Timeline"
      description="Everything that happened to this issue: when it opened, status and severity changes, who was told, and what OneUptime AI said."
      noItemsMessage="Nothing has happened on this issue yet."
      getKind={getDataSecurityIssueFeedKind}
    />
  );
};

export default IssueFeed;
