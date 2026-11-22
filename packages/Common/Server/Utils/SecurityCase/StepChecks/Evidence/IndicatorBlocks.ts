import SecurityBlock from "../../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityBlockEnforcementService from "../../../../Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../Services/SecurityBlockService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockReach,
  SecurityBlockState,
  getSecurityBlockValueKey,
  isSecurityBlockInForce,
} from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockEnforcementState,
  isSecurityBlockEnforcementHolding,
} from "../../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";

/*
 * A VALUE'S BLOCKS AND WHERE EACH HOLDS (#10346): what the Response Plan's
 * "Block on every machine" steps are checked against - a domain, a file, a
 * command-and-control address - read from the blocklist: the value's
 * blocks in force, each with the destinations that hold it now (applied,
 * and read back within ten minutes) and those that do not, and why; and
 * when its last block ended, for a step that held and stopped.
 *
 * Read as OneUptime: the step is the case's, whoever reads it. Throws when
 * the blocklist cannot be read: the step then cannot be told.
 */

// The most blocks of one value read: a few at most, at each reach and ended.
const BLOCKS_READ: number = 20;

export interface IndicatorBlockDestination {
  destination: string;
  provider: string;
  appliedAt: Date | null;
}

export interface IndicatorBlock {
  id: string;
  reach: SecurityBlockReach;
  action: SecurityBlockAction;
  createdAt: Date;
  expiresAt: Date | null;
  holding: Array<IndicatorBlockDestination>;
  notHolding: Array<{
    destination: string;
    provider: string;
    reason: string | null;
  }>;
}

export interface IndicatorBlockReading {
  // The value's blocks in force, the newest first.
  blocks: Array<IndicatorBlock>;
  // When the value's last block ended, when one did.
  lastEndedAt: Date | null;
}

export default class IndicatorBlocks {
  public static async read(data: {
    projectId: ObjectID;
    value: string;
    now: Date;
  }): Promise<IndicatorBlockReading> {
    const rows: Array<SecurityBlock> = await SecurityBlockService.findBy({
      query: {
        projectId: data.projectId,
        value: getSecurityBlockValueKey(data.value),
      },
      select: {
        _id: true,
        reach: true,
        action: true,
        state: true,
        createdAt: true,
        expiresAt: true,
        liftedAt: true,
      },
      sort: { createdAt: SortOrder.Descending },
      skip: 0,
      limit: BLOCKS_READ,
      props: { isRoot: true },
    });

    const inForce: Array<SecurityBlock> = rows.filter(
      (row: SecurityBlock): boolean => {
        return Boolean(row.id) && isSecurityBlockInForce(row, data.now);
      },
    );

    const enforcements: Array<SecurityBlockEnforcement> =
      inForce.length > 0
        ? await SecurityBlockEnforcementService.findBy({
            query: {
              projectId: data.projectId,
              securityBlockId: QueryHelper.any(
                inForce.map((row: SecurityBlock): ObjectID => {
                  return row.id!;
                }),
              ),
            },
            select: {
              _id: true,
              securityBlockId: true,
              destinationName: true,
              provider: true,
              state: true,
              appliedAt: true,
              lastConfirmedAt: true,
              error: true,
            },
            skip: 0,
            limit: inForce.length * 20,
            props: { isRoot: true },
          })
        : [];

    const blocks: Array<IndicatorBlock> = inForce.map(
      (row: SecurityBlock): IndicatorBlock => {
        const holding: Array<IndicatorBlockDestination> = [];
        const notHolding: IndicatorBlock["notHolding"] = [];

        for (const enforcement of enforcements) {
          if (
            enforcement.securityBlockId?.toString() !== row.id!.toString() ||
            enforcement.state === SecurityBlockEnforcementState.Removed ||
            enforcement.state === SecurityBlockEnforcementState.Removing
          ) {
            continue;
          }

          const destination: string = enforcement.destinationName || "";
          const provider: string = enforcement.provider || "";

          if (isSecurityBlockEnforcementHolding(enforcement, data.now)) {
            holding.push({
              destination,
              provider,
              appliedAt: enforcement.appliedAt
                ? new Date(enforcement.appliedAt)
                : null,
            });
          } else {
            notHolding.push({
              destination,
              provider,
              reason: enforcement.error || null,
            });
          }
        }

        return {
          id: row.id!.toString(),
          reach: (row.reach as SecurityBlockReach) || SecurityBlockReach.Edge,
          action:
            (row.action as SecurityBlockAction) || SecurityBlockAction.Block,
          createdAt: row.createdAt ? new Date(row.createdAt) : data.now,
          expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
          holding,
          notHolding,
        };
      },
    );

    // The last end of a block that is not in force: lifted, expired, or past its end.
    let lastEndedAt: Date | null = null;

    for (const row of rows) {
      if (isSecurityBlockInForce(row, data.now)) {
        continue;
      }

      const ended: Date | null =
        row.state === SecurityBlockState.Lifted && row.liftedAt
          ? new Date(row.liftedAt)
          : row.expiresAt
            ? new Date(row.expiresAt)
            : null;

      if (ended && (!lastEndedAt || ended.getTime() > lastEndedAt.getTime())) {
        lastEndedAt = ended;
      }
    }

    return { blocks, lastEndedAt };
  }
}
