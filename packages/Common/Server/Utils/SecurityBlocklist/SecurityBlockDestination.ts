import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockReach,
  getSecurityBlockReach,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityBlockReason } from "../../../Types/SecurityBlocklist/SecurityBlockReason";

/*
 * A PLACE THAT ENFORCES THE BLOCKLIST (#10338): Cloudflare's lists, an AWS
 * WAF IP set, an Azure WAF policy, a Cloud Armor policy, the feed a
 * firewall reads, Microsoft Defender's or CrowdStrike's indicators. Each
 * provider's issue of #10335 implements this for its provider; the
 * blocklist ships with the interface, the reconciler that drives it
 * (SecurityBlocklistReconciler) and a destination for tests
 * (TestSecurityBlockDestination).
 *
 * The reconciler owns the desired state - the project's active blocks - and
 * a destination only says what it can hold and does what it is asked:
 *
 *   supports(entry)   whether it can hold this entry at all, and if not,
 *                     why, in words the block shows ("Azure WAF cannot
 *                     challenge", "Application Gateway matches IPv4 only");
 *   capacity()        how many entries it holds at most, and what a block
 *                     that does not fit says ("the AWS WAF IP set is full
 *                     (10,000)");
 *   apply(entries)    adds entries; says per entry whether it was taken;
 *   remove(items)     takes away items it holds; says per item;
 *   readBack()        what the provider actually holds of OneUptime's, read
 *                     from the provider itself, never from memory.
 *
 * A block is Applied at a destination only once readBack() shows it there:
 * what apply() says is a request, what readBack() says is the fact.
 *
 * The rules every destination keeps:
 *
 *   - OneUptime's own only. It writes, reads back and removes only what it
 *     created - lists, rules, items named as OneUptime's - and readBack()
 *     returns nothing else, so the reconciler can never remove a customer's
 *     own rule or entry.
 *   - Every entry is a value as blocks are written (SecurityBlock's
 *     readSecurityBlockValue): readBack() hands them back that way, so a
 *     provider that writes a single address as "/32" reads it back as the
 *     bare address.
 *   - Nothing is dropped silently: an entry a destination cannot take is
 *     answered as not taken, with why.
 *   - A destination is driven by one reconciler at a time (its lock key), so
 *     it needs no locking of its own; a provider that allows one pending
 *     write per account names that account in its lock key.
 */

/*
 * The namespace of the destinations' locks: a pass of the reconciler holds
 * a destination's lock key in it, and so does work a destination does
 * outside a pass (Cloudflare's removal), so the two never write at once.
 */
export const SECURITY_BLOCKLIST_LOCK_NAMESPACE: string =
  "SecurityBlocklistReconciler";

// One block, as a destination is asked to hold it.
export interface SecurityBlockEntry {
  securityBlockId: ObjectID;
  indicatorType: SecurityBlockIndicatorType;
  // The value as blocks are written: "35.205.11.131", "35.205.11.0/24".
  value: string;
  action: SecurityBlockAction;
  // When the block ends, for a provider that can expire it by itself; null for none.
  expiresAt: Date | null;
  /*
   * What the entry says about itself at the provider, where the provider
   * keeps a comment: "OneUptime case CASE-123 until 2026-11-21 10:42 UTC".
   */
  comment: string;
}

// What a destination holds of OneUptime's, as readBack() reads it.
export interface SecurityBlockHeldItem {
  // As blocks are written.
  value: string;
  action: SecurityBlockAction;
  // The provider's own ID of the item or rule that holds it.
  providerRef?: string | undefined;
  /*
   * When the provider was seen holding it, when that is earlier than the
   * read: a feed holds an entry from the fetch after the block was added.
   */
  confirmedAt?: Date | undefined;
  /*
   * Held, but not in force yet: a policy still on its way to every edge
   * (Azure Front Door's provisioning). The block stays Pending there.
   */
  isPropagating?: boolean | undefined;
  /*
   * When the provider ends it by itself (#10346), for a provider that
   * expires what it holds - Microsoft Defender deletes an indicator past
   * its expirationTime, CrowdStrike sets one to no action: null for never.
   * Left out by a provider that keeps what it holds until it is removed.
   * A block extended at OneUptime is extended there too (moveEnds()).
   */
  expiresAt?: Date | null | undefined;
  /*
   * Held, but not in force, and why, in words the block shows: what
   * enforces the item was turned off or deleted at the provider ("Your rule
   * in example.com was turned off: blocks there are not enforced"). Not done
   * - the block is Failed there, with this as why, and its case hears it -
   * until the provider is put back; the item is neither added again nor
   * removed meanwhile.
   */
  notInForceReason?: string | undefined;
  // The same, as a sentence the Dashboard words in the reader's language (#10629).
  notInForceSentence?: SecurityBlockReason | undefined;
}

// An entry to move the end of, and the item at the provider that holds it.
export interface SecurityBlockEndMove {
  entry: SecurityBlockEntry;
  item: SecurityBlockHeldItem;
}

// Whether a destination can hold an entry, and if not, why.
export type SecurityBlockSupport =
  | { isSupported: true }
  | {
      isSupported: false;
      // Shown on the block as "Not applied: <reason>": "Azure WAF cannot challenge".
      reason: string;
      // The same, as a sentence the Dashboard words in the reader's language (#10629).
      reasonSentence?: SecurityBlockReason | undefined;
    };

// How many entries a destination holds at most.
export interface SecurityBlockCapacity {
  // Null when it has no limit worth counting.
  limit: number | null;
  /*
   * What a block that does not fit says, after "Not applied: ": "the AWS
   * WAF IP set is full (10,000)". Without one: "<name> is full (<limit>)".
   */
  fullReason?: string | undefined;
  // The same, as a sentence the Dashboard words in the reader's language (#10629).
  fullSentence?: SecurityBlockReason | undefined;
}

// What became of one entry a destination was asked to add or remove.
export interface SecurityBlockWriteResult {
  value: string;
  action: SecurityBlockAction;
  isDone: boolean;
  providerRef?: string | undefined;
  // Why it was not done, in the provider's words after OneUptime's.
  error?: string | undefined;
  // The same, as a sentence the Dashboard words in the reader's language (#10629).
  errorSentence?: SecurityBlockReason | undefined;
}

export default interface SecurityBlockDestination {
  /*
   * Which destination this is, stable across runs: its provider, its
   * connection, and what in it when it holds more than one
   * ("Cloudflare:<connectionId>:<zoneId>"). Each block's enforcement row
   * is keyed by it.
   */
  readonly key: string;

  // One reconciler at a time per lock key; the key itself unless a provider shares one per account.
  readonly lockKey?: string | undefined;

  readonly provider: SecurityBlockDestinationProvider;

  // As people read it: "Cloudflare", "AWS WAF (prod-alb)".
  readonly name: string;

  // The connection it is enforced through, when there is one.
  readonly connectionId: ObjectID | null;

  /*
   * Whether it enforces on every machine (#10346) - an endpoint product,
   * Microsoft Defender or CrowdStrike - rather than at the edge in front of
   * the app. It is asked to hold an address only when the address is
   * blocked everywhere (SecurityBlockReach), so it never fills with every
   * scanner the edge turns away; a block at the edge alone is not its to
   * hold, and gets no row there. Left out: the edge.
   */
  readonly enforcesOnEveryMachine?: boolean | undefined;

  /*
   * Whether it quarantines the copies of a file it blocks (Microsoft
   * Defender's BlockAndRemediate), beside blocking it. A destination may
   * hold a block-and-quarantine of a file and only block it - CrowdStrike
   * prevents the file from running, and quarantines it only as the host's
   * prevention policy says - so a case never says a file is quarantined
   * where it is only blocked. Left out: it does not.
   */
  readonly quarantinesFiles?: boolean | undefined;

  /*
   * Readies the destination for a pass, under its lock and before anything
   * else is asked of it: sets up what the provider needs to hold blocks
   * when that was asked for (Cloudflare's lists and rules, when blocking is
   * turned on), and checks it is still in place when that is due. Throws
   * when it cannot, as a failed read does: the pass records why on every
   * row, and tries again later. Absent for a destination that needs nothing.
   */
  prepare?(): Promise<void>;

  /*
   * Whether the destination has work this pass that its blocks alone do not
   * give it: a setup asked for, a check of its setup that is due. Read
   * before the lock is taken, so a project with no block yet still has its
   * destination set up. Absent: only its blocks give it work.
   */
  hasWorkOfItsOwn?(now: Date): boolean;

  supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport;

  capacity(): Promise<SecurityBlockCapacity>;

  apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>>;

  remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>>;

  /*
   * What a pass removes and adds, in one go: for a provider whose lists are
   * replaced whole, so each list is written once a pass however many blocks
   * ended and began in it - an AWS WAF IP set (one UpdateIPSet a second per
   * account), and as they come an Azure WAF custom rule or a Cloud Armor
   * rule. The reconciler calls it in place of remove() and apply() when a
   * destination has it; each item is answered as those answer it.
   */
  update?(changes: {
    add: Array<SecurityBlockEntry>;
    remove: Array<SecurityBlockHeldItem>;
  }): Promise<{
    applied: Array<SecurityBlockWriteResult>;
    removed: Array<SecurityBlockWriteResult>;
  }>;

  readBack(): Promise<Array<SecurityBlockHeldItem>>;

  /*
   * Moves the end of entries it holds to their block's (#10346): for a
   * provider that ends what it holds by itself (readBack's expiresAt), so
   * a block renewed at OneUptime is renewed there, and the provider never
   * lifts a block OneUptime still holds. Left out by a provider that keeps
   * what it holds until it is removed.
   */
  moveEnds?(
    moves: Array<SecurityBlockEndMove>,
  ): Promise<Array<SecurityBlockWriteResult>>;
}

/*
 * Whether a destination is asked to hold a block at all: every block it
 * can hold, except - for one that enforces on every machine - an address
 * blocked at the edge alone. A block it is not asked to hold gets no row
 * there, rather than a row that says it was not applied.
 */
export function isSecurityBlockForDestination(data: {
  destination: Pick<SecurityBlockDestination, "enforcesOnEveryMachine">;
  block: {
    indicatorType?: SecurityBlockIndicatorType | string | undefined | null;
    reach?: SecurityBlockReach | string | undefined | null;
  };
}): boolean {
  if (!data.destination.enforcesOnEveryMachine) {
    return true;
  }

  return (
    getSecurityBlockReach({
      indicatorType: data.block.indicatorType,
      reach: data.block.reach,
    }) === SecurityBlockReach.Everywhere
  );
}
