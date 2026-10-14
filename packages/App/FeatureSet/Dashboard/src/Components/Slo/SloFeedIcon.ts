import { ServiceLevelObjectiveFeedEventType } from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import IconProp from "Common/Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
  SHARED_FEED_ENTRY_KINDS,
} from "Common/UI/Components/Feed/FeedEntryKind";

export type GetSloFeedEventKindFunction = (
  eventType: string,
) => FeedEntryKind | undefined;

export type GetSloFeedEventIconFunction = (
  eventType: string,
) => IconProp | undefined;

/*
 * Kinds for the SLO feed's own events, handed to ResourceFeed as `getKind`.
 *
 * Only what the shared suffix rules cannot express is mapped here. Created /
 * Updated / Archived / Restored and the four owner events return undefined on
 * purpose, so the SLO feed draws them exactly like every other resource feed.
 * Everything else would otherwise fall through to the anonymous dot - a
 * status change, a burn rate alert and a detached monitor all looking alike.
 *
 * Kept free of React so the mapping can be pinned exhaustively against the
 * enum in a plain test.
 */
export const getSloFeedEventKind: GetSloFeedEventKindFunction = (
  eventType: string,
): FeedEntryKind | undefined => {
  switch (eventType) {
    case ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveEnabled:
      return { icon: IconProp.Play, tone: FeedTone.Success };
    case ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled:
      return { icon: IconProp.Pause, tone: FeedTone.Neutral };
    case ServiceLevelObjectiveFeedEventType.StatusChanged:
      // Same kind the monitor and incident feeds use for a state change.
      return SHARED_FEED_ENTRY_KINDS.StateChanged;
    case ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised:
      return { icon: IconProp.ExclaimationCircle, tone: FeedTone.Warning };
    case ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared:
      return { icon: IconProp.Alert, tone: FeedTone.Danger };
    case ServiceLevelObjectiveFeedEventType.BurnRateAlertResolved:
    case ServiceLevelObjectiveFeedEventType.BurnRateIncidentResolved:
      return { icon: IconProp.CheckCircle, tone: FeedTone.Success };
    case ServiceLevelObjectiveFeedEventType.BurnRateRuleAdded:
    case ServiceLevelObjectiveFeedEventType.BurnRateRuleChanged:
    case ServiceLevelObjectiveFeedEventType.BurnRateRuleRemoved:
      // The burn rate rules page's own side menu icon.
      return { icon: IconProp.Fire, tone: FeedTone.Neutral };
    case ServiceLevelObjectiveFeedEventType.MonitorRuleAdded:
    case ServiceLevelObjectiveFeedEventType.MonitorRuleChanged:
    case ServiceLevelObjectiveFeedEventType.MonitorRuleRemoved:
      // The monitor rules page's own side menu icon.
      return { icon: IconProp.Filter, tone: FeedTone.Neutral };
    case ServiceLevelObjectiveFeedEventType.MonitorsAttached:
      return SHARED_FEED_ENTRY_KINDS.Linked;
    case ServiceLevelObjectiveFeedEventType.MonitorsDetached:
      return SHARED_FEED_ENTRY_KINDS.Unlinked;
    default:
      return undefined;
  }
};

// The icon of an SLO feed event's own kind, or undefined for a shared one.
export const getSloFeedEventIcon: GetSloFeedEventIconFunction = (
  eventType: string,
): IconProp | undefined => {
  return getSloFeedEventKind(eventType)?.icon;
};

export default getSloFeedEventIcon;
