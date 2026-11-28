import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  getSecurityBlockValueKey,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  CROWDSEC_DECISION_BAN,
  CROWDSEC_ENDS_WHEN_LIFTED,
  CROWDSEC_META_BLOCK,
  CROWDSEC_META_CONNECTION,
  CROWDSEC_META_ENDS,
  CrowdSecScope,
} from "../../../../Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import CrowdSecLapiClient, {
  CrowdSecAllowlist,
  CrowdSecBan,
  CrowdSecBanBatchResult,
  CrowdSecHeldDecision,
} from "../../SecurityEvent/Response/CrowdSecLapiClient";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEndMove,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
} from "../SecurityBlockDestination";

/*
 * THE BLOCKLIST IN CROWDSEC (#11158): one destination per CrowdSec
 * connection whose "Block addresses with CrowdSec" is on. Every call goes
 * through the connection's own LAPI client, signed in as the machine it
 * holds (CrowdSecLapiClient); CrowdSec's remediation components - its
 * firewall, nginx, Traefik and other bouncers - then enforce each ban
 * wherever they run, as they enforce CrowdSec's own.
 *
 * Each block of an address or a range is one ban decision, written as
 * `cscli decisions add` writes one (CrowdSecDecisions): CrowdSec holds it
 * as a manual decision, so it is never sent to CrowdSec's Central API
 * unless its owner shares manual decisions. CrowdSec bans; it does not
 * challenge for OneUptime (only some of its remediation components can, and
 * a firewall one would let the address through), so a challenge is not
 * applied here, and a policy's challenge that falls back to a block is
 * handed here as a block (canChallenge left out). A domain, a URL, a file
 * or an AS is no decision OneUptime makes in CrowdSec.
 *
 * How long a ban lasts:
 *
 *   - a block with an end is a decision until exactly that end: CrowdSec
 *     lifts it then by itself, whether or not OneUptime can reach it;
 *   - a block until it is lifted is a decision of a week, which OneUptime
 *     renews once three days or less are left: a ban OneUptime no longer
 *     keeps - the connection removed, its blocking turned off - ends
 *     within a week rather than in years, and a pass that cannot reach
 *     LAPI for days changes nothing meanwhile;
 *   - a block renewed, shortened or made permanent is a new decision with
 *     the new end, and the old one ended after it (moveEnds()): never a
 *     moment unbanned.
 *
 * CrowdSec's own allowlists are its owner's word on what it must never
 * ban, and `cscli decisions add` checks them; LAPI does not for a decision
 * a machine sends. So the destination reads them each pass (prepare())
 * and holds no ban of an address or range one of them holds, saying which
 * - and a ban it holds already is taken away once an allowlist holds it.
 * What the project trusts itself - its proxies, load balancers, edges -
 * is refused before any destination is asked (SecurityProtectedAddresses).
 *
 * OneUptime's own, and only them: a ban is filed under the scenario
 * oneuptime/blocklist, and its alert's meta names the connection that made
 * it; readBack() returns no other - so the reconciler never ends a
 * person's decision, CrowdSec's own, or another project's on the same LAPI.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// How long a ban of a block that stays until it is lifted lasts at a time.
export const CROWDSEC_UNTIL_LIFTED_IN_MS: number = 7 * DAY_IN_MS;

// When it is renewed: once this little of it is left.
export const CROWDSEC_RENEW_WHEN_LEFT_IN_MS: number = 3 * DAY_IN_MS;

// Why CrowdSec holds none of a kind of block, in words the block shows.
export const CROWDSEC_CANNOT_CHALLENGE: string =
  "OneUptime bans in CrowdSec, and does not challenge through it";
export const CROWDSEC_ADDRESSES_ONLY: string =
  "OneUptime bans addresses and ranges in CrowdSec, nothing else";

// A ban's lists: each allowlist's blocks, read once a pass.
interface ReadAllowlist {
  name: string;
  blocks: Array<NetworkAddressBlock>;
}

export function getCrowdSecAllowlistReason(data: {
  value: string;
  allowlist: string;
}): string {
  return `CrowdSec's allowlist ${data.allowlist || "(unnamed)"} holds ${data.value}`;
}

export default class CrowdSecBlockDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.CrowdSec;
  public readonly name: string;
  public readonly connectionId: ObjectID;

  private readonly client: CrowdSecLapiClient;
  private readonly now: () => Date;
  private allowlists: Array<ReadAllowlist> = [];

  public constructor(data: {
    connectionId: ObjectID;
    name: string;
    client: CrowdSecLapiClient;
    // For a test: the clock a pass runs by.
    now?: (() => Date) | undefined;
  }) {
    this.connectionId = data.connectionId;
    this.key = `CrowdSec:${data.connectionId.toString()}`;
    this.name = data.name;
    this.client = data.client;
    this.now =
      data.now ||
      ((): Date => {
        return new Date();
      });
  }

  /*
   * Signs in, and reads CrowdSec's allowlists for the pass. Throws when
   * LAPI cannot be reached or refuses the machine: the pass records why on
   * every row and tries again later.
   */
  public async prepare(): Promise<void> {
    await this.client.login();

    this.allowlists = (await this.client.readAllowlists()).map(
      (list: CrowdSecAllowlist): ReadAllowlist => {
        return {
          name: list.name,
          blocks: list.values
            .map((value: string): NetworkAddressBlock | null => {
              return NetworkAddressBlockUtil.parse(value);
            })
            .filter((block: NetworkAddressBlock | null): boolean => {
              return Boolean(block);
            }) as Array<NetworkAddressBlock>,
        };
      },
    );
  }

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    if (
      entry.indicatorType !== SecurityBlockIndicatorType.IpAddress &&
      entry.indicatorType !== SecurityBlockIndicatorType.IpRange
    ) {
      return { isSupported: false, reason: CROWDSEC_ADDRESSES_ONLY };
    }

    if (entry.action !== SecurityBlockAction.Block) {
      return { isSupported: false, reason: CROWDSEC_CANNOT_CHALLENGE };
    }

    const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
      entry.value,
    );

    if (!block) {
      return { isSupported: false, reason: CROWDSEC_ADDRESSES_ONLY };
    }

    for (const allowlist of this.allowlists) {
      if (
        allowlist.blocks.some((allowed: NetworkAddressBlock): boolean => {
          return NetworkAddressBlockUtil.overlaps(allowed, block);
        })
      ) {
        return {
          isSupported: false,
          reason: getCrowdSecAllowlistReason({
            value: entry.value,
            allowlist: allowlist.name,
          }),
        };
      }
    }

    return { isSupported: true };
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    // LAPI holds as many decisions as its database does: the community blocklist alone is tens of thousands.
    return { limit: null };
  }

  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    const now: Date = this.now();
    const held: Array<CrowdSecHeldDecision> = await this.client.listOwnBans(
      this.connectionId.toString(),
      now,
    );

    return held.map((decision: CrowdSecHeldDecision): SecurityBlockHeldItem => {
      return {
        value: getSecurityBlockValueKey(decision.value),
        /*
         * A ban is a block. Anything else under OneUptime's scenario was
         * changed at CrowdSec: held as what it is, so no block wants it,
         * the reconciler ends it, and bans the address again as it was.
         */
        action: (decision.type.toLowerCase() === CROWDSEC_DECISION_BAN
          ? SecurityBlockAction.Block
          : decision.type) as SecurityBlockAction,
        providerRef: decision.id,
        expiresAt: this.heldEnd(decision, now),
      };
    });
  }

  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const now: Date = this.now();
    const bans: Array<CrowdSecBan> = entries.map(
      (entry: SecurityBlockEntry): CrowdSecBan => {
        return this.toBan(entry, now);
      },
    );
    const batches: Array<CrowdSecBanBatchResult> = await this.client.addBans(
      bans,
      now,
    );

    const results: Array<SecurityBlockWriteResult> = [];
    let index: number = 0;

    for (const batch of batches) {
      for (let position: number = 0; position < batch.bans.length; position++) {
        const entry: SecurityBlockEntry = entries[index++]!;

        results.push({
          value: entry.value,
          action: entry.action,
          isDone: batch.isDone,
          ...(batch.isDone
            ? {}
            : { error: batch.error || "CrowdSec refused it" }),
        });
      }
    }

    return results;
  }

  public async remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const results: Array<SecurityBlockWriteResult> = [];

    for (const item of items) {
      try {
        await this.client.deleteDecision(item.providerRef || "");

        results.push({ value: item.value, action: item.action, isDone: true });
      } catch (error) {
        results.push({
          value: item.value,
          action: item.action,
          isDone: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /*
   * A ban whose end is no longer its block's: the new decision first, then
   * the old one ended - so the address is never unbanned between the two,
   * and a new one LAPI refused leaves the old one in force.
   */
  public async moveEnds(
    moves: Array<SecurityBlockEndMove>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    const applied: Array<SecurityBlockWriteResult> = await this.apply(
      moves.map((move: SecurityBlockEndMove): SecurityBlockEntry => {
        return move.entry;
      }),
    );

    const replaced: Array<SecurityBlockHeldItem> = moves
      .filter((_move: SecurityBlockEndMove, index: number): boolean => {
        return Boolean(applied[index]?.isDone);
      })
      .map((move: SecurityBlockEndMove): SecurityBlockHeldItem => {
        return move.item;
      });

    if (replaced.length > 0) {
      await this.remove(replaced);
    }

    return applied;
  }

  /*
   * When a ban ends, as the reconciler is to read it. A ban of a block with
   * an end ends when LAPI says. A ban of a block until lifted reads as
   * never ending, as its block does - until three days or less are left of
   * it: then its real end, which is not its block's, so the reconciler
   * renews it (moveEnds()).
   */
  private heldEnd(decision: CrowdSecHeldDecision, now: Date): Date | null {
    const ends: string = (decision.meta.get(CROWDSEC_META_ENDS) || [])[0] || "";

    if (ends !== CROWDSEC_ENDS_WHEN_LIFTED) {
      return decision.expiresAt;
    }

    if (
      decision.expiresAt &&
      decision.expiresAt.getTime() - now.getTime() <=
        CROWDSEC_RENEW_WHEN_LEFT_IN_MS
    ) {
      return decision.expiresAt;
    }

    return null;
  }

  private toBan(entry: SecurityBlockEntry, now: Date): CrowdSecBan {
    const lasts: number = entry.expiresAt
      ? entry.expiresAt.getTime() - now.getTime()
      : CROWDSEC_UNTIL_LIFTED_IN_MS;

    return {
      scope:
        entry.indicatorType === SecurityBlockIndicatorType.IpRange
          ? CrowdSecScope.Range
          : CrowdSecScope.Ip,
      value: entry.value,
      durationInSeconds: Math.max(1, Math.ceil(lasts / 1000)),
      message: entry.comment,
      meta: [
        { key: CROWDSEC_META_CONNECTION, value: this.connectionId.toString() },
        { key: CROWDSEC_META_BLOCK, value: entry.securityBlockId.toString() },
        {
          key: CROWDSEC_META_ENDS,
          value: entry.expiresAt
            ? entry.expiresAt.toISOString()
            : CROWDSEC_ENDS_WHEN_LIFTED,
        },
      ],
    };
  }
}
