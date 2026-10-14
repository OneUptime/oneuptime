import ResourceFeed from "../ResourceFeed/ResourceFeed";
import { getSecurityCaseFeedKind } from "./SecurityCaseFeedKind";
import SecurityCaseFeedModel, {
  SecurityCaseFeedEventType,
} from "Common/Models/DatabaseModels/SecurityCaseFeed";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  securityCaseId: ObjectID;
}

/*
 * A case's timeline: how it opened, every detection that joined it, each
 * change of status, priority or assignee, the notes written on it, and
 * every playbook step that ran against it - with who did what.
 */
const SecurityCaseFeed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourceFeed<SecurityCaseFeedModel>
      modelType={SecurityCaseFeedModel}
      resourceIdColumn="securityCaseId"
      resourceId={props.securityCaseId}
      eventTypeColumn="securityCaseFeedEventType"
      eventTypes={Object.values(SecurityCaseFeedEventType)}
      title="Timeline"
      description="Everything that happened to this case - detections joining it, status and priority changes, notes, and each playbook step that ran."
      noItemsMessage="Nothing has happened on this case yet."
      getKind={getSecurityCaseFeedKind}
    />
  );
};

export default SecurityCaseFeed;
