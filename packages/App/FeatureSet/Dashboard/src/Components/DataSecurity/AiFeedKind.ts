import IconProp from "Common/Types/Icon/IconProp";
import {
  FeedEntryKind,
  FeedTone,
} from "Common/UI/Components/Feed/FeedEntryKind";

/*
 * How what OneUptime AI proposed for an issue, and what became of it,
 * looks on the issue's and the store's timelines (#10364) - the same on
 * both, by the event's name, which the two feeds' enums share: proposed;
 * approved first, where two people approve a riskier change; made, after
 * approval or without asking; dismissed; undone; or failed.
 *
 * Kept free of React so the mapping can be pinned against the enums.
 */
export const AI_FEED_KINDS: Readonly<Record<string, FeedEntryKind>> = {
  AiProposed: { icon: IconProp.Sparkles, tone: FeedTone.AI },
  AiProposalApproved: { icon: IconProp.HandThumbUp, tone: FeedTone.AI },
  AiChangeMade: { icon: IconProp.ShieldCheck, tone: FeedTone.Success },
  AiProposalDismissed: { icon: IconProp.XCircle, tone: FeedTone.Neutral },
  AiChangeUndone: { icon: IconProp.ArrowUturnLeft, tone: FeedTone.Neutral },
  AiChangeFailed: { icon: IconProp.ExclaimationCircle, tone: FeedTone.Danger },
};

export function getAiFeedKind(eventType: string): FeedEntryKind | undefined {
  return Object.prototype.hasOwnProperty.call(AI_FEED_KINDS, eventType)
    ? AI_FEED_KINDS[eventType]
    : undefined;
}
