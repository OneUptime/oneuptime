import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";

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
}

// Whether a destination can hold an entry, and if not, why.
export type SecurityBlockSupport =
  | { isSupported: true }
  | {
      isSupported: false;
      // Shown on the block as "Not applied: <reason>": "Azure WAF cannot challenge".
      reason: string;
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
}

// What became of one entry a destination was asked to add or remove.
export interface SecurityBlockWriteResult {
  value: string;
  action: SecurityBlockAction;
  isDone: boolean;
  providerRef?: string | undefined;
  // Why it was not done, in the provider's words after OneUptime's.
  error?: string | undefined;
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
}
