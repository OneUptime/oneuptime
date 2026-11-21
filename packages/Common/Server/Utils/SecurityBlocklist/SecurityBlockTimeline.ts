import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseFeedService from "../../Services/SecurityCaseFeedService";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
  SecurityBlockSource,
  describeSecurityBlockLength,
  isSecurityBlockAddressType,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT A CASE'S TIMELINE SAYS OF ITS BLOCKS (#10338): when an address is
 * blocked for the case, lifted, extended, expired, and when a destination
 * first holds it or turns it down. Each line names the address as code and
 * says who or what did it; the person, when there is one, is the feed item's
 * own (userId). Written as OneUptime, and never failing what it records: a
 * block stands whether or not its line could be written.
 *
 * Lines are written on a change, never on a pass of the reconciler that
 * found nothing new, so a timeline says each thing once.
 */

// Who made a block, as a sentence starts with it when no person did.
function madeBy(source: SecurityBlockSource): MarkdownText {
  switch (source) {
    case SecurityBlockSource.Playbook:
      return mdText`A playbook`;
    case SecurityBlockSource.AutomaticResponse:
      return mdText`An automatic response`;
    case SecurityBlockSource.OneUptimeAi:
      return mdText`OneUptime AI`;
    case SecurityBlockSource.Api:
      return mdText`An API key`;
    default:
      return mdText`Someone`;
  }
}

// "for 24 hours", or "until someone lifts it".
function howLong(data: {
  from: Date;
  until: Date | null | undefined;
}): MarkdownText {
  const length: string | null = describeSecurityBlockLength(data);

  return length ? mdText`for ${length}` : mdText`until someone lifts it`;
}

export function blockAddedMarkdown(data: {
  value: string;
  // What it holds: an address unless said (#10346).
  indicatorType?: SecurityBlockIndicatorType | undefined;
  action: SecurityBlockAction;
  // Where it is enforced: at the edge unless said.
  reach?: SecurityBlockReach | undefined;
  source: SecurityBlockSource;
  createdAt: Date;
  expiresAt: Date | null | undefined;
  reason?: string | undefined;
  // Whether anything is asked to hold it: a destination of its reach.
  hasDestinations: boolean;
}): MarkdownText {
  const value: MarkdownText = FeedMarkdown.code(data.value);
  const length: MarkdownText = howLong({
    from: data.createdAt,
    until: data.expiresAt,
  });
  const isChallenge: boolean = data.action === SecurityBlockAction.Challenge;
  const isQuarantine: boolean =
    data.action === SecurityBlockAction.BlockAndQuarantine;
  const isAddress: boolean = isSecurityBlockAddressType(
    data.indicatorType || SecurityBlockIndicatorType.IpAddress,
  );
  // An address blocked everywhere says so; a domain, a URL or a file always is.
  const where: MarkdownText =
    isAddress && data.reach === SecurityBlockReach.Everywhere
      ? mdText` on every machine`
      : FeedMarkdown.empty();

  const line: MarkdownText =
    data.source === SecurityBlockSource.Person
      ? isChallenge
        ? mdText`🚫 Challenged ${value} ${length}.`
        : isQuarantine
          ? mdText`🚫 Blocked and quarantined ${value} ${length}.`
          : mdText`🚫 Blocked ${value}${where} ${length}.`
      : isChallenge
        ? mdText`🚫 ${madeBy(data.source)} challenged ${value} ${length}.`
        : isQuarantine
          ? mdText`🚫 ${madeBy(data.source)} blocked and quarantined ${value} ${length}.`
          : mdText`🚫 ${madeBy(data.source)} blocked ${value}${where} ${length}.`;

  const reason: MarkdownText = data.reason
    ? mdText` Reason: ${FeedMarkdown.textInLine(data.reason)}`
    : FeedMarkdown.empty();

  const enforcement: MarkdownText = data.hasDestinations
    ? FeedMarkdown.empty()
    : isAddress && data.reach !== SecurityBlockReach.Everywhere
      ? mdText` Nothing enforces the blocklist yet, so it is not blocked anywhere: connect Cloudflare, AWS WAF, Azure WAF, Cloud Armor or a firewall that reads a list.`
      : mdText` Nothing blocks it on your machines yet: turn on blocking on your Microsoft Defender XDR or CrowdStrike Falcon connection.`;

  // The reason last: it is someone's words, which need not end a sentence.
  return mdText`${line}${enforcement}${reason}`;
}

// What ends a sentence: a full stop, a question or an exclamation mark, an ellipsis.
const SENTENCE_END: RegExp = /[.!?\u2026]$/;

export function blockLiftedMarkdown(data: {
  value: string;
  isByPerson: boolean;
  reason?: string | undefined;
}): MarkdownText {
  const value: MarkdownText = FeedMarkdown.code(data.value);
  const reason: MarkdownText = data.reason
    ? mdText`: ${FeedMarkdown.textInLine(data.reason)}`
    : FeedMarkdown.empty();

  // A reason that ends its own sentence takes no second full stop.
  const end: MarkdownText =
    data.reason && SENTENCE_END.test(data.reason.trim())
      ? FeedMarkdown.empty()
      : mdText`.`;

  return data.isByPerson
    ? mdText`✅ Lifted the block on ${value}${reason}${end}`
    : mdText`✅ The block on ${value} was lifted${reason}${end}`;
}

export function blockExtendedMarkdown(data: {
  value: string;
  now: Date;
  expiresAt: Date | null;
}): MarkdownText {
  const value: MarkdownText = FeedMarkdown.code(data.value);

  if (!data.expiresAt) {
    return mdText`🚫 The block on ${value} now stays until someone lifts it.`;
  }

  return mdText`🚫 The block on ${value} now ends in ${
    describeSecurityBlockLength({ from: data.now, until: data.expiresAt }) ||
    "a moment"
  }.`;
}

export function blockExpiredMarkdown(data: {
  value: string;
  createdAt: Date;
  expiresAt: Date;
}): MarkdownText {
  const length: string | null = describeSecurityBlockLength({
    from: data.createdAt,
    until: data.expiresAt,
  });

  return length
    ? mdText`⏱️ The block on ${FeedMarkdown.code(data.value)} expired after ${length}.`
    : mdText`⏱️ The block on ${FeedMarkdown.code(data.value)} expired.`;
}

export function blockEnforcedMarkdown(data: {
  value: string;
  destinationName: string;
}): MarkdownText {
  return mdText`🛡️ The block on ${FeedMarkdown.code(data.value)} is enforced at ${data.destinationName}.`;
}

export function blockNotAppliedMarkdown(data: {
  value: string;
  destinationName: string;
  error: string;
}): MarkdownText {
  return mdText`⚠️ The block on ${FeedMarkdown.code(data.value)} is not enforced at ${data.destinationName}. ${FeedMarkdown.textInLine(data.error)}`;
}

export default class SecurityBlockTimeline {
  // One line on the case's timeline. Never throws (SecurityCaseFeedService).
  public static async write(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID | null | undefined;
    markdown: MarkdownText;
    color: Color;
    userId?: ObjectID | null | undefined;
    postedAt?: Date | undefined;
  }): Promise<void> {
    if (!data.securityCaseId) {
      return;
    }

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown: data.markdown.toString(),
      eventType: SecurityCaseFeedEventType.ResponseAction,
      displayColor: data.color,
      ...(data.userId ? { userId: data.userId } : {}),
      ...(data.postedAt ? { postedAt: data.postedAt } : {}),
    });
  }

  public static readonly colors: {
    added: Color;
    ended: Color;
    enforced: Color;
    notApplied: Color;
  } = {
    added: Red500,
    ended: Gray500,
    enforced: Green500,
    notApplied: Yellow500,
  };
}
