import {
  SECURITY_BLOCK_DURATION_IN_MS,
  SecurityBlockAction,
  SecurityBlockDuration,
  describeSecurityBlockLength,
} from "../../Types/SecurityBlocklist/SecurityBlock";
import FeedMarkdown, { MarkdownText, mdText } from "../Markdown/FeedMarkdown";

/*
 * WHAT A CASE'S TIMELINE SAYS OF AN AUTOMATIC RESPONSE (#10350), and what
 * a policy's record says of why it left an address alone: English, as the
 * timeline's other lines are (SecurityBlockTimeline), each naming the
 * address as code and the policy by its name.
 *
 *   "OneUptime challenged 35.205.11.131 at Cloudflare for 1 hour (Scanners
 *   policy), 41 seconds after its first request."
 */

// "a", "a and b", "a, b and c".
function joinNames(names: ReadonlyArray<string>): string {
  const kept: Array<string> = names
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });

  if (kept.length <= 1) {
    return kept[0] || "";
  }

  return `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
}

// How long a block of a policy lasts: "1 hour", "24 hours", "7 days".
export function describeAutomaticBlockLength(
  duration: SecurityBlockDuration,
): string {
  if (duration === SecurityBlockDuration.UntilLifted) {
    return "until someone lifts it";
  }

  return (
    describeSecurityBlockLength({
      from: new Date(0),
      until: new Date(SECURITY_BLOCK_DURATION_IN_MS[duration]),
    }) || ""
  );
}

/*
 * How long after the first request: "41 seconds", "3 minutes", "2 hours".
 * Seconds under two minutes, minutes under two hours.
 */
export function formatTimeAfterFirstRequest(seconds: number): string {
  const whole: number = Number.isFinite(seconds)
    ? Math.max(0, Math.round(seconds))
    : 0;

  if (whole < 120) {
    return whole === 1 ? "1 second" : `${whole} seconds`;
  }

  const minutes: number = Math.round(whole / 60);

  if (minutes < 120) {
    return `${minutes} minutes`;
  }

  return `${Math.round(minutes / 60)} hours`;
}

// What the ladder climbed on: "it was blocked once before in the last 30 days".
function describeBlockedBefore(priorBlockCount: number): string {
  return priorBlockCount === 1
    ? "it was blocked once before in the last 30 days"
    : `it was blocked ${priorBlockCount} times before in the last 30 days`;
}

function verbOf(action: SecurityBlockAction): string {
  return action === SecurityBlockAction.Challenge ? "challenged" : "blocked";
}

/*
 * The case's line once a policy's block takes hold: where, for how long, by
 * which policy, and how long after the address's first request. A
 * challenge an edge holds as a block, because it cannot challenge, is said
 * after it.
 */
export function automaticResponseBlockedMarkdown(data: {
  action: SecurityBlockAction;
  address: string;
  // Every destination where it took hold.
  enforcedAt: ReadonlyArray<string>;
  // Those of them that cannot challenge, and hold a challenge as a block.
  heldAsBlockAt?: ReadonlyArray<string> | undefined;
  duration: SecurityBlockDuration;
  policyName: string;
  secondsAfterFirstRequest: number | null;
  priorBlockCount?: number | undefined;
}): MarkdownText {
  const enforcedAt: string = joinNames(data.enforcedAt);
  const heldAsBlockAt: string =
    data.action === SecurityBlockAction.Challenge
      ? joinNames(data.heldAsBlockAt || [])
      : "";
  const where: string = enforcedAt ? ` at ${enforcedAt}` : "";
  const after: string =
    data.secondsAfterFirstRequest === null
      ? ""
      : `, ${formatTimeAfterFirstRequest(data.secondsAfterFirstRequest)} after its first request`;
  const heldAsBlock: MarkdownText = heldAsBlockAt
    ? mdText` ${heldAsBlockAt} cannot challenge, so it blocks the address there for the same time.`
    : FeedMarkdown.empty();
  const ladder: MarkdownText =
    data.priorBlockCount && data.priorBlockCount > 0
      ? mdText` The block is longer because ${describeBlockedBefore(data.priorBlockCount)}.`
      : FeedMarkdown.empty();

  return mdText`🛡️ OneUptime ${verbOf(data.action)} ${FeedMarkdown.code(data.address)}${where} for ${describeAutomaticBlockLength(data.duration)} (${FeedMarkdown.textInLine(data.policyName)} policy)${after}.${heldAsBlock}${ladder}`;
}

// What a policy in its trial run would have done: recorded, and nothing done.
export function automaticResponseTrialMarkdown(data: {
  action: SecurityBlockAction;
  address: string;
  duration: SecurityBlockDuration;
  policyName: string;
  priorBlockCount?: number | undefined;
}): MarkdownText {
  const ladder: MarkdownText =
    data.priorBlockCount && data.priorBlockCount > 0
      ? mdText` For that long because ${describeBlockedBefore(data.priorBlockCount)}.`
      : FeedMarkdown.empty();

  return mdText`🧪 Trial run: the ${FeedMarkdown.textInLine(data.policyName)} policy would have ${verbOf(data.action)} ${FeedMarkdown.code(data.address)} for ${describeAutomaticBlockLength(data.duration)}.${ladder} It only records what it would do until it is turned on, so nothing was blocked.`;
}

// Why a policy left an address alone: a guardrail's sentence.
export function automaticResponseSparedMarkdown(data: {
  address: string;
  policyName: string;
  detail: string;
  isTrialRun: boolean;
}): MarkdownText {
  const lead: MarkdownText = data.isTrialRun
    ? mdText`🧪 Trial run: the ${FeedMarkdown.textInLine(data.policyName)} policy would have left ${FeedMarkdown.code(data.address)} alone.`
    : mdText`🛡️ The ${FeedMarkdown.textInLine(data.policyName)} policy left ${FeedMarkdown.code(data.address)} alone.`;

  return mdText`${lead} ${FeedMarkdown.textInLine(data.detail)}`;
}

// The hourly limit reached: the policy stopped, and the security owners were paged.
export function automaticResponseLimitMarkdown(data: {
  action: SecurityBlockAction;
  address: string;
  policyName: string;
  limit: number;
  wasPaged: boolean;
  isTrialRun: boolean;
}): MarkdownText {
  if (data.isTrialRun) {
    return mdText`🧪 Trial run: the ${FeedMarkdown.textInLine(data.policyName)} policy would not have ${verbOf(data.action)} ${FeedMarkdown.code(data.address)}: it would have reached the most automatic blocks your project makes in an hour, ${String(data.limit)}, and paged your security owners.`;
  }

  const paged: MarkdownText = data.wasPaged
    ? mdText` Your security owners were paged: an attack this large needs a person.`
    : mdText` OneUptime could not page your security owners: make sure the project has a Security Admin or a Project Owner who can be paged.`;

  return mdText`⚠️ The ${FeedMarkdown.textInLine(data.policyName)} policy did not ${data.action === SecurityBlockAction.Challenge ? "challenge" : "block"} ${FeedMarkdown.code(data.address)}: your automatic response policies made ${String(data.limit)} blocks in the last hour, the most they make in an hour, so they stopped.${paged}`;
}

// A block lifted on doubt: a signed-in user was seen from the address.
export function automaticResponseLiftedOnDoubtMarkdown(data: {
  address: string;
  policyName: string;
  users: ReadonlyArray<string>;
  wasTold: boolean;
}): MarkdownText {
  const told: MarkdownText = data.wasTold
    ? mdText` Your security owners were told.`
    : FeedMarkdown.empty();

  return mdText`↩️ The ${FeedMarkdown.textInLine(data.policyName)} policy lifted its block of ${FeedMarkdown.code(data.address)}: a signed-in user was seen from it since (${FeedMarkdown.textInLine(joinNames(data.users) || "a signed-in user")}).${told}`;
}

// Who a signed-in check found, in a sentence: "jane@example.com and bob@example.com".
export function describeSignedInUserNames(
  users: ReadonlyArray<string>,
): string {
  return joinNames(users);
}
