import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_REPEAT_OFFENDER_WINDOW_IN_MS,
  SecurityRepeatOffenderBlock,
  SecurityRepeatOffenderRecord,
  getSecurityRepeatOffenderDuration,
  isSecurityRepeatOffence,
} from "../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
  SecurityBlockValue,
  readSecurityBlockAsn,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import QueryHelper from "../../Types/Database/QueryHelper";
import SecurityBlockService from "../../Services/SecurityBlockService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { listSecuritySignedInAddresses } from "./SecuritySignedInAddresses";

/*
 * THE REPEAT-OFFENDER LADDER, READ (#10350): every block of an address or a
 * network in the last 30 days, from the blocklist, which keeps every block
 * it ever made (a block is lifted or expires, and is never deleted), and
 * how long the next one lasts (Types/SecurityAutomaticResponse/
 * SecurityRepeatOffenders).
 *
 *   - An address: blocks of it, and of any range around it - and, when
 *     the caller knows the networks it sent from (`asns`, which only
 *     Cloudflare's events name: SecurityRepeatOffenderNetworks), the
 *     blocks and challenges of those networks by their ASN, which held it
 *     too (#10895). Each such block keeps the network's value ("AS14061"),
 *     so the record says which network held it.
 *   - A network: blocks of it, of any range around it or inside it, and of
 *     the addresses inside it - listed one by one for an IPv4 /24 or
 *     narrower, and read among the window's address blocks otherwise.
 *
 * Read as OneUptime: a policy and a campaign ask it for any reader, and the
 * record names a block's case by its number alone.
 */

// The most blocks of addresses inside a wide network one read takes.
export const SECURITY_REPEAT_OFFENDER_MAX_ADDRESS_BLOCKS: number = 5000;

const BLOCK_SELECT: {
  _id: true;
  value: true;
  action: true;
  source: true;
  state: true;
  createdAt: true;
  securityCaseId: true;
  securityCase: { caseNumberWithPrefix: true };
} = {
  _id: true,
  value: true,
  action: true,
  source: true,
  state: true,
  createdAt: true,
  securityCaseId: true,
  securityCase: { caseNumberWithPrefix: true },
};

function toRecordBlock(block: SecurityBlock): SecurityRepeatOffenderBlock {
  return {
    securityBlockId: block.id?.toString() || "",
    value: block.value || "",
    action:
      block.action === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block,
    source: block.source || SecurityBlockSource.Person,
    state: block.state || SecurityBlockState.Active,
    createdAt: block.createdAt
      ? new Date(block.createdAt)
      : OneUptimeDate.getCurrentDate(),
    securityCaseId: block.securityCaseId?.toString() || null,
    caseNumber: block.securityCase?.caseNumberWithPrefix || null,
  };
}

export default class SecurityRepeatOffenders {
  /*
   * How often the address or network was blocked in the 30 days before
   * `now`, every block the latest first. Throws when the blocklist cannot be
   * read, or the value is not an address or a range.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    value: string;
    now?: Date | undefined;
    /*
     * The networks an address sent from, by their ASN as blocks write it
     * ("AS14061"): their blocks and challenges count too (#10895). Read
     * for an address only.
     */
    asns?: ReadonlyArray<string> | undefined;
  }): Promise<SecurityRepeatOffenderRecord> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const since: Date = new Date(
      now.getTime() - SECURITY_REPEAT_OFFENDER_WINDOW_IN_MS,
    );
    const read: SecurityBlockValue | null = readSecurityBlockValue(data.value);

    if (!read) {
      throw new BadDataException(
        `${data.value} is not an IP address or range.`,
      );
    }

    const inWindow: {
      projectId: ObjectID;
      createdAt: ReturnType<typeof QueryHelper.greaterThanEqualTo>;
    } = {
      projectId: data.projectId,
      createdAt: QueryHelper.greaterThanEqualTo(since),
    };
    const isNetwork: boolean = !NetworkAddressBlockUtil.isSingleAddress(
      read.block,
    );
    const listed: Array<string> | null = isNetwork
      ? listSecuritySignedInAddresses(read)
      : null;

    const reads: Array<Promise<Array<SecurityBlock>>> = [
      // The value itself.
      SecurityBlockService.findBy({
        query: { ...inWindow, value: read.value },
        select: BLOCK_SELECT,
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      // Ranges: around it, or inside the network.
      SecurityBlockService.findBy({
        query: {
          ...inWindow,
          indicatorType: SecurityBlockIndicatorType.IpRange,
        },
        select: BLOCK_SELECT,
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
    ];

    // The addresses inside a network.
    if (isNetwork) {
      reads.push(
        listed
          ? SecurityBlockService.findBy({
              query: { ...inWindow, value: new Includes(listed) },
              select: BLOCK_SELECT,
              sort: { createdAt: SortOrder.Descending },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: { isRoot: true },
            })
          : SecurityBlockService.findBy({
              query: {
                ...inWindow,
                indicatorType: SecurityBlockIndicatorType.IpAddress,
              },
              select: BLOCK_SELECT,
              sort: { createdAt: SortOrder.Descending },
              skip: 0,
              limit: SECURITY_REPEAT_OFFENDER_MAX_ADDRESS_BLOCKS,
              props: { isRoot: true },
            }),
      );
    }

    /*
     * The networks the address sent from, by their ASN (#10895): a block
     * of one is matched by its value alone - an address's ASN is none of
     * its text.
     */
    const asns: Array<string> = isNetwork
      ? []
      : Array.from(
          new Set(
            (data.asns || [])
              .map((asn: string): string | null => {
                return readSecurityBlockAsn(asn);
              })
              .filter((asn: string | null): asn is string => {
                return Boolean(asn);
              }),
          ),
        );
    const networkBlocks: Promise<Array<SecurityBlock>> =
      asns.length > 0
        ? SecurityBlockService.findBy({
            query: {
              ...inWindow,
              indicatorType: SecurityBlockIndicatorType.Asn,
              value: new Includes(asns),
            },
            select: BLOCK_SELECT,
            sort: { createdAt: SortOrder.Descending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          })
        : Promise.resolve([]);

    const found: Map<string, SecurityBlock> = new Map();
    const [ofNetworks, ...ofValue]: Array<Array<SecurityBlock>> =
      await Promise.all([networkBlocks, ...reads]);

    for (const block of ofNetworks || []) {
      if (block.id && asns.includes(readSecurityBlockAsn(block.value) || "")) {
        found.set(block.id.toString(), block);
      }
    }

    for (const blocks of ofValue) {
      for (const block of blocks) {
        const other: SecurityBlockValue | null = readSecurityBlockValue(
          block.value || "",
        );

        if (!block.id || !other) {
          continue;
        }

        const touches: boolean = isNetwork
          ? NetworkAddressBlockUtil.overlaps(other.block, read.block)
          : NetworkAddressBlockUtil.containsBlock(other.block, read.block);

        if (touches) {
          found.set(block.id.toString(), block);
        }
      }
    }

    const blocks: Array<SecurityRepeatOffenderBlock> = Array.from(
      found.values(),
    )
      .map(toRecordBlock)
      .sort(
        (
          a: SecurityRepeatOffenderBlock,
          b: SecurityRepeatOffenderBlock,
        ): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        },
      );
    const offences: Array<SecurityRepeatOffenderBlock> = blocks.filter(
      isSecurityRepeatOffence,
    );

    return {
      value: read.value,
      since,
      blocks,
      offenceCount: offences.length,
      last: offences[0] || null,
    };
  }

  // How long the next block of the address or network lasts, from `firstDuration`, up the ladder.
  public static nextDuration(data: {
    record: SecurityRepeatOffenderRecord;
    firstDuration: SecurityBlockDuration;
  }): SecurityBlockDuration {
    return getSecurityRepeatOffenderDuration({
      firstDuration: data.firstDuration,
      offenceCount: data.record.offenceCount,
    });
  }
}
