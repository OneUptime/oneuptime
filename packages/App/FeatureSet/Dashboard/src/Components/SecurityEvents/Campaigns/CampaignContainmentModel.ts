import {
  ADDRESSES_SELECTED,
  BLOCKED_ADDRESSES_TOAST,
  CAMPAIGN_OF_ADDRESS_LINE,
  CHALLENGED_ADDRESSES_TOAST,
  CHALLENGED_NETWORK_TOAST,
  CHALLENGED_NETWORK_UNTIL_LIFTED_TOAST,
  CHALLENGE_NETWORK_DOES,
  CHALLENGE_ONE_RANGE,
  CHALLENGE_WHOLE_ASN,
  LEFT_OUT_SIGNED_IN,
  LEFT_OUT_TOAST,
  NETWORK_ADDRESS_COUNT,
  NETWORK_MORE_ADDRESSES,
  NETWORK_NOT_HELD_ASN,
  NETWORK_NOT_HELD_RANGE,
  NETWORK_PROTECTED,
  NETWORK_RANGES,
  NETWORK_SIGNED_IN,
  NETWORK_UNCHECKED,
  NETWORK_UNCHECKED_ASN,
  NETWORK_UNCHECKED_NEEDS_ADMIN,
  REPEAT_MANY,
  REPEAT_MANY_NO_CASE,
  REPEAT_ONCE,
  REPEAT_ONCE_NO_CASE,
  REPEAT_TWICE,
  REPEAT_TWICE_NO_CASE,
  ROW_BLOCKED,
  ROW_BLOCKED_UNTIL,
  ROW_CHALLENGED,
  ROW_CHALLENGED_UNTIL,
  ROW_HELD_BY,
  WILL_BLOCK,
  WILL_CHALLENGE,
} from "./CampaignContainmentCopy";
import { DURATION_COUNTS } from "../Blocklist/BlocklistCopy";
import {
  writeBlockSentence,
  writeSecurityProtection,
} from "../Blocklist/BlocklistWords";
import { formatNamesInSentence } from "../../SecurityCase/Response/SecurityCaseBlockStepModel";
import OneUptimeDate from "Common/Types/Date";
import { SecurityRepeatOffenderSummary } from "Common/Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SECURITY_BLOCK_SENTENCES,
  SecurityBlockAction,
  SecurityBlockDuration,
  getSecurityBlockAlreadyBlockedSentence,
  getSecurityBlockCheckFailedSentence,
  getSecurityBlockLargestPrefix,
  readSecurityBlockValue,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityAttackCampaign,
  SecurityAttackCampaignBlock,
} from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import {
  MomentRole,
  momentPhrase,
  writeReaderMoment,
} from "Common/Utils/MomentPhrases";
import {
  SecurityAttackNetwork,
  SecurityAttackNetworkKind,
  SecurityAttackNetworkRange,
  getSecurityAttackNetworkChallengeValues,
} from "Common/Types/SecurityEvent/SecurityAttackNetwork";
import {
  SecurityCampaignAddressCheck,
  SecurityCampaignAddressStanding,
  SecurityCampaignAddressesCheck,
  SecurityCampaignSignedInUser,
  SecurityNetworkChallengeCheck,
  SecurityNetworkChallengeStanding,
  SecurityNetworkUncheckedReason,
  isSecurityCampaignAddressLeftOut,
} from "Common/Types/SecurityEvent/SecurityCampaignContainment";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import { Translator, formatList } from "Common/UI/Utils/TranslateTemplate";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";

/*
 * CAMPAIGNS' ACTIONS, AS THE DASHBOARD SAYS THEM (#10354): which rows may
 * be selected, what Block Addresses' check says of each address, the row's
 * pill for the block that holds it, a network row's lines, what Challenge
 * This Network's check says, and a case's repeat-offender line.
 * React-free, so a plain test pins each sentence.
 */

// ---------- Rows ----------

/*
 * A campaign's address can be blocked from the page when it is a public
 * one: a private or local address never reaches the app from the internet,
 * and one a scrub rule hid has no address to block.
 */
export function isCampaignBlockable(
  campaign: Pick<SecurityAttackCampaign, "sourceIp">,
): boolean {
  return (
    Boolean(campaign.sourceIp) &&
    getSecurityAddressScope(campaign.sourceIp) === SecurityAddressScope.Public
  );
}

/*
 * Whether Block Addresses can take a row: one it can block, that no block
 * holds already. The row of requests whose address nobody knew, or a scrub
 * rule hid, has no address to take.
 */
export function isCampaignSelectable(
  campaign: Pick<SecurityAttackCampaign, "sourceIp" | "block">,
): boolean {
  return isCampaignBlockable(campaign) && !campaign.block;
}

// The page's rows Block Addresses can take, as their addresses.
export function getSelectableAddresses(
  campaigns: ReadonlyArray<SecurityAttackCampaign>,
): Array<string> {
  return campaigns
    .filter(isCampaignSelectable)
    .map((campaign: SecurityAttackCampaign): string => {
      return campaign.sourceIp;
    });
}

// Of the selection, the addresses still on the page and selectable: a reload can take some away.
export function keepSelectable(data: {
  selected: ReadonlyArray<string>;
  campaigns: ReadonlyArray<SecurityAttackCampaign>;
}): Array<string> {
  const selectable: Set<string> = new Set(
    getSelectableAddresses(data.campaigns),
  );

  return data.selected.filter((address: string): boolean => {
    return selectable.has(address);
  });
}

export function writeSelectedCount(
  count: number,
  translator: Translator,
): string {
  return translator.translatePlural(ADDRESSES_SELECTED, count);
}

export interface RowBlockPill {
  text: string;
  tone: PillTone;
  // What holds the row, when it is a range or a network rather than the row's own value.
  tooltip?: string | undefined;
}

/*
 * The pill of the block that holds a row: "Blocked until 10:42" today,
 * "Blocked until 24 Nov at 10:42" on another day (the moment brings its own
 * words, #10932), "Challenged" for a block that ends when it is lifted,
 * with what holds it on hover when that is a range or a network around the
 * row.
 */
export function writeRowBlockPill(data: {
  block: SecurityAttackCampaignBlock;
  // The row's own value: its address, or its network.
  value: string;
  translator: Translator;
  now?: Date | undefined;
}): RowBlockPill {
  const { block, translator } = data;
  const isChallenge: boolean = block.action === SecurityBlockAction.Challenge;
  const expiresAt: Date | null = block.expiresAt
    ? new Date(block.expiresAt)
    : null;
  const text: string =
    expiresAt && Number.isFinite(expiresAt.getTime())
      ? translator.translateTemplate(
          isChallenge ? ROW_CHALLENGED_UNTIL : ROW_BLOCKED_UNTIL,
          {
            until: momentPhrase(
              MomentRole.Until,
              writeReaderMoment(expiresAt, data.now || new Date()),
            ),
          },
        )
      : translator.translateText(isChallenge ? ROW_CHALLENGED : ROW_BLOCKED) ||
        (isChallenge ? ROW_CHALLENGED : ROW_BLOCKED);
  const own: string =
    readSecurityBlockValue(data.value)?.value || data.value.trim();

  return {
    text,
    tone: isChallenge ? PillTone.Info : PillTone.Neutral,
    ...(block.value !== own
      ? {
          tooltip: translator.translateTemplate(ROW_HELD_BY, {
            value: block.value,
          }),
        }
      : {}),
  };
}

// ---------- Block Addresses ----------

// A length in words: "24 hours", "7 days".
export function writeDurationWords(
  duration: SecurityBlockDuration,
  translator: Translator,
): string {
  if (duration === SecurityBlockDuration.UntilLifted) {
    return "";
  }

  const counted: { count: number; plural: { one: string; other: string } } =
    DURATION_COUNTS[duration];

  return translator.translatePlural(counted.plural, counted.count);
}

// The names of the users who signed in, as a sentence lists them.
export function writeSignedInNames(
  users: ReadonlyArray<SecurityCampaignSignedInUser>,
  translator: Translator,
): string {
  return formatNamesInSentence(
    users
      .map((user: SecurityCampaignSignedInUser): string => {
        return user.name;
      })
      .filter((name: string, index: number, names: Array<string>) => {
        return Boolean(name) && names.indexOf(name) === index;
      })
      .slice(0, 3),
    translator,
  );
}

/*
 * Why an address is left out, in the reader's words; null for one that is
 * blocked or will be.
 */
export function describeCampaignAddressCheck(data: {
  check: SecurityCampaignAddressCheck;
  translator: Translator;
}): string | null {
  const { check, translator } = data;
  const value: string = check.value || check.typed;

  switch (check.standing) {
    case SecurityCampaignAddressStanding.Blockable:
    case SecurityCampaignAddressStanding.Blocked:
      return null;
    case SecurityCampaignAddressStanding.AlreadyBlocked:
      return writeBlockSentence(
        translator,
        getSecurityBlockAlreadyBlockedSentence({
          value,
          by: check.coveredBy || value,
        }),
      );
    case SecurityCampaignAddressStanding.Protected:
      return check.protection
        ? writeSecurityProtection(translator, {
            value,
            protection: check.protection,
          })
        : check.problem || null;
    case SecurityCampaignAddressStanding.SignedIn:
      return translator.translateTemplate(LEFT_OUT_SIGNED_IN, {
        names: writeSignedInNames(check.users || [], translator),
      });
    case SecurityCampaignAddressStanding.CannotTell:
      return writeBlockSentence(
        translator,
        getSecurityBlockCheckFailedSentence(value),
      );
    default:
      // A refusal the server words: drawn as written.
      return check.problem || null;
  }
}

// The addresses a check would block, and the ones it leaves out.
export function splitCampaignChecks(
  checks: ReadonlyArray<SecurityCampaignAddressCheck>,
): {
  blocking: Array<SecurityCampaignAddressCheck>;
  leftOut: Array<SecurityCampaignAddressCheck>;
} {
  return {
    blocking: checks.filter((check: SecurityCampaignAddressCheck) => {
      return !isSecurityCampaignAddressLeftOut(check.standing);
    }),
    leftOut: checks.filter((check: SecurityCampaignAddressCheck) => {
      return isSecurityCampaignAddressLeftOut(check.standing);
    }),
  };
}

// "Blocks 3 addresses for 24 hours." - or challenges them.
export function writeWillBlock(data: {
  count: number;
  action: SecurityBlockAction;
  duration: SecurityBlockDuration;
  translator: Translator;
}): string {
  return data.translator.translatePlural(
    data.action === SecurityBlockAction.Challenge ? WILL_CHALLENGE : WILL_BLOCK,
    data.count,
    { duration: writeDurationWords(data.duration, data.translator) },
  );
}

// What Block Addresses did, in one toast: "Blocked 3 addresses. 2 were left out."
export function writeBlockedToast(data: {
  outcome: SecurityCampaignAddressesCheck;
  action: SecurityBlockAction;
  translator: Translator;
}): string {
  const blocked: number = data.outcome.addresses.filter(
    (check: SecurityCampaignAddressCheck): boolean => {
      return check.standing === SecurityCampaignAddressStanding.Blocked;
    },
  ).length;
  const leftOut: number = data.outcome.addresses.length - blocked;
  const done: string = data.translator.translatePlural(
    data.action === SecurityBlockAction.Challenge
      ? CHALLENGED_ADDRESSES_TOAST
      : BLOCKED_ADDRESSES_TOAST,
    blocked,
  );

  return leftOut > 0
    ? joinSentences([
        done,
        data.translator.translatePlural(LEFT_OUT_TOAST, leftOut),
      ])
    : done;
}

// ---------- Network rows ----------

export function writeNetworkAddressCount(
  network: Pick<SecurityAttackNetwork, "addressCount">,
  translator: Translator,
): string {
  return translator.translatePlural(
    NETWORK_ADDRESS_COUNT,
    network.addressCount,
  );
}

/*
 * Some values of many, as a sentence lists them: "a, b and c", or "a, b, c
 * and 10 more" when there are more than are shown.
 */
function writeSomeOf(data: {
  values: ReadonlyArray<string>;
  total: number;
  shown: number;
  translator: Translator;
}): string {
  const shown: Array<string> = data.values.slice(0, data.shown);
  const more: number = Math.max(0, data.total - shown.length);

  if (more === 0) {
    return formatNamesInSentence(shown, data.translator);
  }

  return data.translator.translatePlural(NETWORK_MORE_ADDRESSES, more, {
    addresses: formatList(shown, data.translator),
  });
}

// The addresses a row names: "203.0.113.7, 203.0.113.9, 203.0.113.12 and 10 more".
export function writeNetworkAddresses(data: {
  network: Pick<SecurityAttackNetwork, "addresses" | "addressCount">;
  translator: Translator;
  shown?: number | undefined;
}): string {
  return writeSomeOf({
    values: data.network.addresses,
    total: data.network.addressCount,
    shown: data.shown || 3,
    translator: data.translator,
  });
}

// An ASN row's ranges: "Sent from 5 ranges: 203.0.113.0/24, ... and 2 more" - none for a range's row.
export function writeNetworkRanges(data: {
  network: Pick<SecurityAttackNetwork, "kind" | "ranges">;
  translator: Translator;
}): string | null {
  if (data.network.kind !== SecurityAttackNetworkKind.Asn) {
    return null;
  }

  return data.translator.translatePlural(
    NETWORK_RANGES,
    data.network.ranges.length,
    {
      ranges: writeSomeOf({
        values: data.network.ranges.map(
          (range: SecurityAttackNetworkRange): string => {
            return range.range;
          },
        ),
        total: data.network.ranges.length,
        shown: 3,
        translator: data.translator,
      }),
    },
  );
}

// Whether a network row may be offered Challenge This Network: a range on the internet, or an ASN.
export function isNetworkChallengeable(
  network: Pick<SecurityAttackNetwork, "network" | "kind">,
): boolean {
  if (!network.network || !network.kind) {
    return false;
  }

  if (network.kind === SecurityAttackNetworkKind.Asn) {
    return true;
  }

  const first: string = network.network.split("/")[0] || "";

  return getSecurityAddressScope(first) === SecurityAddressScope.Public;
}

// ---------- Challenge This Network ----------

export interface NetworkChallengeOption {
  value: string;
  label: string;
}

/*
 * What a network row may be challenged as, in the reader's words: an
 * ASN's row the whole network first, then each of its ranges.
 */
export function getNetworkChallengeOptions(data: {
  network: Pick<SecurityAttackNetwork, "network" | "kind" | "ranges">;
  translator: Translator;
}): Array<NetworkChallengeOption> {
  return getSecurityAttackNetworkChallengeValues(data.network).map(
    (value: string): NetworkChallengeOption => {
      if (value === data.network.network) {
        return {
          value,
          label:
            data.network.kind === SecurityAttackNetworkKind.Asn
              ? data.translator.translateTemplate(CHALLENGE_WHOLE_ASN, {
                  network: value,
                })
              : value,
        };
      }

      const range: SecurityAttackNetworkRange | undefined =
        data.network.ranges.find((candidate: SecurityAttackNetworkRange) => {
          return candidate.range === value;
        });

      return {
        value,
        label: data.translator.translatePlural(
          CHALLENGE_ONE_RANGE,
          range?.addressCount || 0,
          { range: value },
        ),
      };
    },
  );
}

/*
 * The network's first choice: its own for a Security Admin; for anyone
 * else, an ASN row's largest range, which is theirs to challenge.
 */
export function getDefaultNetworkChallengeValue(data: {
  network: Pick<SecurityAttackNetwork, "network" | "kind" | "ranges">;
  isAdmin: boolean;
}): string {
  const values: Array<string> = getSecurityAttackNetworkChallengeValues(
    data.network,
  );

  if (
    !data.isAdmin &&
    data.network.kind === SecurityAttackNetworkKind.Asn &&
    values.length > 1
  ) {
    return values[1]!;
  }

  return values[0] || data.network.network;
}

// What the challenge does: where, to whom, for how long.
export function writeNetworkChallengeDoes(data: {
  check: Pick<SecurityNetworkChallengeCheck, "value" | "holders">;
  duration: SecurityBlockDuration;
  translator: Translator;
}): string | null {
  if (data.check.holders.length === 0) {
    return null;
  }

  return data.translator.translateTemplate(CHALLENGE_NETWORK_DOES, {
    network: data.check.value,
    destinations: formatNamesInSentence(data.check.holders, data.translator),
    duration: writeDurationWords(data.duration, data.translator),
  });
}

export enum NetworkCheckTone {
  // Nothing in the way.
  None = "None",
  // It may go ahead knowingly, or it is done already.
  Warning = "Warning",
  // Refused.
  Danger = "Danger",
}

export interface NetworkCheckWords {
  tone: NetworkCheckTone;
  sentences: Array<string>;
  // The server's own words, drawn as written: why its signed-in check could not tell.
  asWritten?: string | undefined;
}

// What Challenge This Network's check says, in the reader's words.
export function describeNetworkCheck(data: {
  check: SecurityNetworkChallengeCheck;
  translator: Translator;
}): NetworkCheckWords {
  const { check, translator } = data;
  const network: string = check.value;

  switch (check.standing) {
    case SecurityNetworkChallengeStanding.Challengeable:
      return { tone: NetworkCheckTone.None, sentences: [] };
    case SecurityNetworkChallengeStanding.SignedIn:
      return {
        tone: NetworkCheckTone.Danger,
        sentences: [
          translator.translateTemplate(NETWORK_SIGNED_IN, {
            network,
            names: writeSignedInNames(check.users || [], translator),
          }),
        ],
      };
    case SecurityNetworkChallengeStanding.Protected:
      return {
        tone: NetworkCheckTone.Danger,
        sentences: [
          translator.translateTemplate(NETWORK_PROTECTED, { network }),
          ...(check.protection
            ? [
                writeSecurityProtection(translator, {
                  value: network,
                  protection: check.protection,
                }),
              ]
            : []),
        ],
      };
    case SecurityNetworkChallengeStanding.AlreadyCovered:
      return {
        tone: NetworkCheckTone.Warning,
        sentences: [
          writeBlockSentence(
            translator,
            getSecurityBlockAlreadyBlockedSentence({
              value: network,
              by: check.coveredBy?.value || network,
            }),
          ),
        ],
      };
    case SecurityNetworkChallengeStanding.NeedsSecurityAdmin: {
      const read: ReturnType<typeof readSecurityBlockValue> =
        readSecurityBlockValue(network);

      return {
        tone: NetworkCheckTone.Danger,
        sentences: [
          read
            ? translator.translateTemplate(SECURITY_BLOCK_SENTENCES.tooWide, {
                value: network,
                largest: `/${getSecurityBlockLargestPrefix(read.block.family)}`,
              })
            : translator.translateTemplate(
                SECURITY_BLOCK_SENTENCES.asnTakesAdmin,
                { value: network },
              ),
        ],
      };
    }
    case SecurityNetworkChallengeStanding.NotHeld:
      return {
        tone: NetworkCheckTone.Danger,
        sentences: [
          translator.translateTemplate(
            check.kind === SecurityAttackNetworkKind.Asn
              ? NETWORK_NOT_HELD_ASN
              : NETWORK_NOT_HELD_RANGE,
            { network },
          ),
        ],
      };
    case SecurityNetworkChallengeStanding.Unchecked:
      return {
        tone: check.isAdmin
          ? NetworkCheckTone.Warning
          : NetworkCheckTone.Danger,
        sentences: [
          check.uncheckedReason === SecurityNetworkUncheckedReason.Asn
            ? translator.translatePlural(
                NETWORK_UNCHECKED_ASN,
                check.seenAddressCount || 0,
                { network },
              )
            : translator.translateTemplate(NETWORK_UNCHECKED, { network }),
          ...(check.isAdmin
            ? []
            : [
                translator.translateText(NETWORK_UNCHECKED_NEEDS_ADMIN) ||
                  NETWORK_UNCHECKED_NEEDS_ADMIN,
              ]),
        ],
        ...(check.uncheckedReason ===
          SecurityNetworkUncheckedReason.SignedInCheck &&
        check.uncheckedReasonText
          ? { asWritten: check.uncheckedReasonText }
          : {}),
      };
    default:
      return {
        tone: NetworkCheckTone.Danger,
        sentences: [],
        ...(check.problem ? { asWritten: check.problem } : {}),
      };
  }
}

/*
 * What Challenge This Network says once it is done: "Challenged
 * 203.0.113.0/24 until 14:25." today, "... until 27 Nov at 14:25." on
 * another day - the moment brings its own words (#10932) - and the network
 * alone for a challenge that ends when it is lifted, never "until" with
 * nothing after it.
 */
export function writeNetworkChallengedToast(data: {
  // What the challenge holds, and when it ends: null when it is lifted by hand.
  challenged: { value: string; expiresAt: Date | null };
  translator: Translator;
  now?: Date | undefined;
}): string {
  const { challenged, translator } = data;

  if (
    !challenged.expiresAt ||
    !Number.isFinite(challenged.expiresAt.getTime())
  ) {
    return translator.translateTemplate(CHALLENGED_NETWORK_UNTIL_LIFTED_TOAST, {
      network: challenged.value,
    });
  }

  return translator.translateTemplate(CHALLENGED_NETWORK_TOAST, {
    network: challenged.value,
    until: momentPhrase(
      MomentRole.Until,
      writeReaderMoment(challenged.expiresAt, data.now || new Date()),
    ),
  });
}

// ---------- A case's repeat offender ----------

/*
 * "Blocked twice before, last on Nov 12 (case CASE-812)." - none for an
 * address never blocked before.
 */
export function writeRepeatOffenderLine(data: {
  summary: Pick<SecurityRepeatOffenderSummary, "offenceCount" | "last">;
  translator: Translator;
}): string | null {
  const { summary, translator } = data;

  if (summary.offenceCount <= 0 || !summary.last) {
    return null;
  }

  const values: Record<string, string> = {
    date: OneUptimeDate.getDateAsLocalDayMonthString(summary.last.createdAt),
    caseNumber: summary.last.caseNumber || "",
  };
  const hasCase: boolean = Boolean(summary.last.caseNumber);

  if (summary.offenceCount === 1) {
    return translator.translateTemplate(
      hasCase ? REPEAT_ONCE : REPEAT_ONCE_NO_CASE,
      values,
    );
  }

  if (summary.offenceCount === 2) {
    return translator.translateTemplate(
      hasCase ? REPEAT_TWICE : REPEAT_TWICE_NO_CASE,
      values,
    );
  }

  return translator.translatePlural(
    hasCase ? REPEAT_MANY : REPEAT_MANY_NO_CASE,
    summary.offenceCount,
    values,
  );
}

// "11 more addresses sent the same requests with the same tools over the last 7 days."
export function writeCampaignOfAddressLine(data: {
  count: number;
  days: number;
  translator: Translator;
}): string {
  return data.translator.translatePlural(CAMPAIGN_OF_ADDRESS_LINE, data.count, {
    days: data.translator.formatNumber(data.days),
  });
}
