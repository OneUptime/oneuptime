import { DataSecurityIssueFeedEventType } from "Common/Models/DatabaseModels/DataSecurityIssueFeed";
import IconProp from "Common/Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
  SHARED_FEED_ENTRY_KINDS,
} from "Common/UI/Components/Feed/FeedEntryKind";

export type GetDataSecurityIssueFeedKindFunction = (
  eventType: string,
) => FeedEntryKind | undefined;

/*
 * How each entry on an issue's timeline looks, handed to ResourceFeed as
 * `getKind`. A status or severity change and an assignment look the way
 * they do on an incident's feed; what only an issue has - its check
 * failing for the first time, a risk accepted or running out, a re-check
 * asked for - gets an icon of its own. Status changes are drawn in the
 * colour the server chose: the new status's.
 *
 * Kept free of React so the mapping can be pinned against the enum.
 */
export const getDataSecurityIssueFeedKind: GetDataSecurityIssueFeedKindFunction =
  (eventType: string): FeedEntryKind | undefined => {
    switch (eventType) {
      case DataSecurityIssueFeedEventType.IssueOpened:
        return { icon: IconProp.ShieldExclamation, tone: FeedTone.Danger };
      case DataSecurityIssueFeedEventType.SeverityChanged:
        return SHARED_FEED_ENTRY_KINDS.SeverityChanged;
      case DataSecurityIssueFeedEventType.EvidenceChanged:
        return { icon: IconProp.DocumentMagnifyingGlass, tone: FeedTone.Info };
      case DataSecurityIssueFeedEventType.StatusChanged:
        return SHARED_FEED_ENTRY_KINDS.StateChanged;
      case DataSecurityIssueFeedEventType.Resolved:
        return { icon: IconProp.CheckCircle, tone: FeedTone.Success };
      case DataSecurityIssueFeedEventType.Reopened:
        return { icon: IconProp.Refresh, tone: FeedTone.Danger };
      case DataSecurityIssueFeedEventType.Accepted:
        return { icon: IconProp.ShieldCheck, tone: FeedTone.Warning };
      case DataSecurityIssueFeedEventType.AcceptanceExpired:
        return { icon: IconProp.Clock, tone: FeedTone.Warning };
      case DataSecurityIssueFeedEventType.AssigneeChanged:
        return { icon: IconProp.User, tone: FeedTone.People };
      case DataSecurityIssueFeedEventType.RecheckRequested:
        return { icon: IconProp.Refresh, tone: FeedTone.Info };
      // A security case opened for it.
      case DataSecurityIssueFeedEventType.SecurityCaseOpened:
        return { icon: IconProp.ShieldExclamation, tone: FeedTone.Warning };
      case DataSecurityIssueFeedEventType.AlertRaised:
        return { icon: IconProp.Alert, tone: FeedTone.Danger };
      case DataSecurityIssueFeedEventType.OwnersNotified:
        return SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent;
      // OneUptime AI's explanation, or a fix it was asked to open.
      case DataSecurityIssueFeedEventType.AiExplanation:
        return SHARED_FEED_ENTRY_KINDS.AIRootCause;
      case DataSecurityIssueFeedEventType.AiFixRequested:
        return { icon: IconProp.Bolt, tone: FeedTone.AI };
      default:
        return undefined;
    }
  };
