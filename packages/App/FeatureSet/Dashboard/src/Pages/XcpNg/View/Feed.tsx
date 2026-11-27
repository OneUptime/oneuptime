import PageComponentProps from "../../PageComponentProps";
import ResourceFeed from "../../../Components/ResourceFeed/ResourceFeed";
import ObjectID from "Common/Types/ObjectID";
import XcpNgPoolFeed, {
  XcpNgPoolFeedEventType,
} from "Common/Models/DatabaseModels/XcpNgPoolFeed";
import IconProp from "Common/Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
} from "Common/UI/Components/Feed/FeedEntryKind";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The kinds of what a probe read of the pool (#10997): a message XAPI
 * wrote, the master moving, HA turned on or off or losing a host's worth
 * of room, a backup job that failed - each in the colour the server gave
 * it (XcpNgPoolEventsProcessing: red for what broke, amber for a warning).
 * Everything else is drawn as every resource feed draws it. Exported for
 * tests.
 */
export function getXcpNgPoolFeedKind(
  eventType: string,
): FeedEntryKind | undefined {
  switch (eventType) {
    case XcpNgPoolFeedEventType.XcpNgPoolMessage:
      return { icon: IconProp.Bell, tone: FeedTone.Record };
    case XcpNgPoolFeedEventType.XcpNgPoolMasterChanged:
      return { icon: IconProp.ArrowPath, tone: FeedTone.Record };
    case XcpNgPoolFeedEventType.XcpNgPoolHaChanged:
      return { icon: IconProp.ShieldCheck, tone: FeedTone.Record };
    case XcpNgPoolFeedEventType.XcpNgPoolBackupFailed:
      return { icon: IconProp.Archive, tone: FeedTone.Record };
    default:
      return undefined;
  }
}

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
      getKind={getXcpNgPoolFeedKind}
      title="XCP-ng Pool Feed"
      description="Everything that has happened to this XCP-ng pool - how and why it was created, who owns it, what XAPI and Xen Orchestra said of it, and every change since."
      noItemsMessage="No activity has been recorded for this XCP-ng pool yet."
    />
  );
};

export default XcpNgPoolFeedPage;
