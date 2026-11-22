import {
  BLOCK_LINE_BLOCKED,
  BLOCK_LINE_BLOCKED_BY,
  BLOCK_LINE_BLOCKED_BY_UNTIL_LIFTED,
  BLOCK_LINE_BLOCKED_UNTIL_LIFTED,
  BLOCK_LINE_CHALLENGED,
  BLOCK_LINE_CHALLENGED_BY,
  BLOCK_LINE_CHALLENGED_BY_UNTIL_LIFTED,
  BLOCK_LINE_CHALLENGED_UNTIL_LIFTED,
  BLOCK_LINE_NOT_ENFORCED,
  BLOCK_LINE_PENDING,
} from "./SecurityCaseResponseCopy";
import { writeCheckTime } from "./SecurityCaseResponseChecks";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  Translator,
  formatList,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { ResponseAddressBlock } from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";

/*
 * How a case's block step says what it knows (#10342), React-free so a plain
 * test pins each rule: the line of the block that holds the address -
 * where it is enforced, since when, by whom, until when - or that a
 * destination is still applying it, or that nothing enforces it; the
 * choices beside Block for 24 Hours; and the address filled into the places
 * people block an address by hand.
 */

// The last two names of a list a sentence reads: "Cloudflare and AWS WAF".
const NAMES_AND_LAST: string = translationKey("{{items}} and {{last}}");

/*
 * Names as a sentence lists them, in the reader's language: "Cloudflare",
 * "Cloudflare and AWS WAF", "Cloudflare, AWS WAF and Azure WAF" - a clause,
 * so the last two are joined as the language joins them, each name set
 * apart so a right-to-left sentence keeps the list's order.
 */
export function formatNamesInSentence(
  names: ReadonlyArray<string>,
  translator: Translator,
): string {
  if (names.length <= 1) {
    return names[0] || "";
  }

  return translator.translateTemplate(
    NAMES_AND_LAST,
    {
      items: formatList(names.slice(0, -1), translator),
      last: names[names.length - 1]!,
    },
    { setsValuesApart: true },
  );
}

// What a one-click block from the plan blocks, and for how long.
export interface BlockChoice {
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
}

// The one click: Block for 24 Hours.
export const BLOCK_DEFAULT_CHOICE: BlockChoice = {
  blockAction: SecurityBlockAction.Block,
  duration: SecurityBlockDuration.OneDay,
};

export const BLOCK_CHALLENGE_CHOICE: BlockChoice = {
  blockAction: SecurityBlockAction.Challenge,
  duration: SecurityBlockDuration.OneDay,
};

export const BLOCK_SEVEN_DAYS_CHOICE: BlockChoice = {
  blockAction: SecurityBlockAction.Block,
  duration: SecurityBlockDuration.SevenDays,
};

export const BLOCK_UNTIL_LIFTED_CHOICE: BlockChoice = {
  blockAction: SecurityBlockAction.Block,
  duration: SecurityBlockDuration.UntilLifted,
};

// Whether the block a step draws is a range around its address, not the address itself.
export function isRangeAroundAddress(data: {
  block: ResponseAddressBlock;
  address: string;
}): boolean {
  const block: SecurityBlockValue | null = readSecurityBlockValue(
    data.block.value,
  );
  const address: SecurityBlockValue | null = readSecurityBlockValue(
    data.address,
  );

  return Boolean(block && address && block.value !== address.value);
}

// The sentence of a block a destination holds, by what it does, who made it and whether it ends.
export function getEnforcedBlockTemplate(block: ResponseAddressBlock): string {
  const isChallenge: boolean = block.action === SecurityBlockAction.Challenge;
  const hasName: boolean = Boolean(block.createdByName);

  if (!block.expiresAt) {
    if (isChallenge) {
      return hasName
        ? BLOCK_LINE_CHALLENGED_BY_UNTIL_LIFTED
        : BLOCK_LINE_CHALLENGED_UNTIL_LIFTED;
    }

    return hasName
      ? BLOCK_LINE_BLOCKED_BY_UNTIL_LIFTED
      : BLOCK_LINE_BLOCKED_UNTIL_LIFTED;
  }

  if (isChallenge) {
    return hasName ? BLOCK_LINE_CHALLENGED_BY : BLOCK_LINE_CHALLENGED;
  }

  return hasName ? BLOCK_LINE_BLOCKED_BY : BLOCK_LINE_BLOCKED;
}

/*
 * The block's line in the reader's words: held, being applied, or held
 * nowhere. Its times on the reader's clock, the time alone for today.
 */
export function writeAddressBlockLine(data: {
  block: ResponseAddressBlock;
  translator: Translator;
  now?: Date | undefined;
}): string {
  const { block, translator } = data;
  const now: Date = data.now || new Date();
  const since: Date = block.enforcedSince || block.createdAt || now;

  if (block.enforcedAt.length > 0) {
    return translator.translateTemplate(getEnforcedBlockTemplate(block), {
      destinations: formatNamesInSentence(block.enforcedAt, translator),
      time: writeCheckTime(since, now),
      name: block.createdByName || "",
      until: block.expiresAt ? writeCheckTime(block.expiresAt, now) : "",
    });
  }

  if (block.pendingAt.length > 0) {
    return translator.translateTemplate(BLOCK_LINE_PENDING, {
      time: writeCheckTime(block.createdAt || now, now),
      destinations: formatNamesInSentence(block.pendingAt, translator),
    });
  }

  return translator.translateTemplate(BLOCK_LINE_NOT_ENFORCED, {
    time: writeCheckTime(block.createdAt || now, now),
  });
}

// The address in the places people block one by hand: the AWS CLI, nginx and nftables.
export interface BlockByHandCommands {
  awsCli: string;
  nginx: string;
  nftables: string;
}

export function getBlockByHandCommands(address: string): BlockByHandCommands {
  const read: SecurityBlockValue | null = readSecurityBlockValue(address);
  const value: string = read ? read.value : address.trim();
  const isIpv6: boolean = Boolean(read && read.block.family === 6);
  // An IP set holds ranges: a single address is written with its whole length.
  const asRange: string = value.includes("/")
    ? value
    : `${value}/${isIpv6 ? 128 : 32}`;

  return {
    awsCli: `aws wafv2 update-ip-set --name <ip-set-name> --id <ip-set-id> --scope REGIONAL --lock-token <lock-token> --addresses <addresses-it-holds> ${asRange}`,
    nginx: `deny ${value};`,
    nftables: `nft add element inet filter ${isIpv6 ? "blocklist6" : "blocklist"} { ${value} }`,
  };
}
