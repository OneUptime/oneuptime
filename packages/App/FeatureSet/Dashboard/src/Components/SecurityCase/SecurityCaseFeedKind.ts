import { SecurityCaseFeedEventType } from "Common/Models/DatabaseModels/SecurityCaseFeed";
import IconProp from "Common/Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
  SHARED_FEED_ENTRY_KINDS,
} from "Common/UI/Components/Feed/FeedEntryKind";

export type GetSecurityCaseFeedKindFunction = (
  eventType: string,
) => FeedEntryKind | undefined;

/*
 * How each entry on a case's timeline looks, handed to ResourceFeed as
 * `getKind`. A status change, a note and an assignment look the way they do
 * on an incident's feed; what only a case has - a detection joining it, a
 * playbook step, an approval, a containment action - gets an icon of its
 * own. Entries whose tone is Record are drawn in the color the server chose
 * for them: a status change in the new status's color, a step in its
 * outcome's.
 *
 * Kept free of React so the mapping is pinned against the enum in a plain
 * test.
 */
export const getSecurityCaseFeedKind: GetSecurityCaseFeedKindFunction = (
  eventType: string,
): FeedEntryKind | undefined => {
  switch (eventType) {
    case SecurityCaseFeedEventType.CaseOpened:
      return { icon: IconProp.ShieldExclamation, tone: FeedTone.Danger };
    case SecurityCaseFeedEventType.DetectionAdded:
      return { icon: IconProp.Bolt, tone: FeedTone.Warning };
    case SecurityCaseFeedEventType.StatusChanged:
      return SHARED_FEED_ENTRY_KINDS.StateChanged;
    case SecurityCaseFeedEventType.PriorityChanged:
      return SHARED_FEED_ENTRY_KINDS.SeverityChanged;
    case SecurityCaseFeedEventType.AssigneeChanged:
      return { icon: IconProp.User, tone: FeedTone.People };
    case SecurityCaseFeedEventType.CaseUpdated:
      return SHARED_FEED_ENTRY_KINDS.Updated;
    case SecurityCaseFeedEventType.PrivateNote:
      return SHARED_FEED_ENTRY_KINDS.PrivateNote;
    case SecurityCaseFeedEventType.PlaybookRun:
      return { icon: IconProp.Play, tone: FeedTone.Record };
    case SecurityCaseFeedEventType.PlaybookStep:
      return { icon: IconProp.ChevronRight, tone: FeedTone.Record };
    case SecurityCaseFeedEventType.ApprovalRequested:
      return { icon: IconProp.ExclaimationCircle, tone: FeedTone.Warning };
    case SecurityCaseFeedEventType.ApprovalDecided:
      return { icon: IconProp.CheckCircle, tone: FeedTone.Record };
    case SecurityCaseFeedEventType.ThreatIntel:
      return { icon: IconProp.Bug, tone: FeedTone.Warning };
    case SecurityCaseFeedEventType.EntityActivity:
      return { icon: IconProp.MagnifyingGlass, tone: FeedTone.Info };
    case SecurityCaseFeedEventType.Notification:
      return { icon: IconProp.Email, tone: FeedTone.Info };
    case SecurityCaseFeedEventType.IncidentDeclared:
      return { icon: IconProp.Alert, tone: FeedTone.Danger };
    case SecurityCaseFeedEventType.ResponseAction:
      return { icon: IconProp.ShieldCheck, tone: FeedTone.Record };
    // OneUptime AI's triage: drawn as an AI investigation's report is.
    case SecurityCaseFeedEventType.AiTriage:
      return SHARED_FEED_ENTRY_KINDS.AIRootCause;
    // A task added, done, opened again, handed on or deleted.
    case SecurityCaseFeedEventType.Task:
      return { icon: IconProp.ClipboardDocumentCheck, tone: FeedTone.Record };
    // Evidence kept on the case, or taken off it.
    case SecurityCaseFeedEventType.Evidence:
      return { icon: IconProp.PaperClip, tone: FeedTone.Record };
    /*
     * A response target about to be missed (amber) or missed (red), in the
     * color the server chose.
     */
    case SecurityCaseFeedEventType.ResponseTarget:
      return { icon: IconProp.Clock, tone: FeedTone.Record };
    default:
      return undefined;
  }
};
