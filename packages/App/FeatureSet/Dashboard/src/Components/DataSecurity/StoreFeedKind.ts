import { DataStoreFeedEventType } from "Common/Models/DatabaseModels/DataStoreFeed";
import IconProp from "Common/Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
} from "Common/UI/Components/Feed/FeedEntryKind";

export type GetDataStoreFeedKindFunction = (
  eventType: string,
) => FeedEntryKind | undefined;

/*
 * How each entry on a data store's timeline looks, handed to ResourceFeed as
 * `getKind`. A store's Created, Updated, Archived and Restored entries, and
 * its owner and rule entries, look the way every other resource feed's do
 * (ResourceFeed's shared rules), so only what a store alone has is mapped
 * here: a response action that closed its exposure, drawn in the colour the
 * server chose - green when the store changed, grey when it was already so.
 *
 * Kept free of React so the mapping can be pinned against the enum.
 */
export const getDataStoreFeedKind: GetDataStoreFeedKindFunction = (
  eventType: string,
): FeedEntryKind | undefined => {
  switch (eventType) {
    case DataStoreFeedEventType.ResponseActionTaken:
      return { icon: IconProp.ShieldCheck, tone: FeedTone.Record };
    default:
      return undefined;
  }
};
