import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import AuditLogService from "../../Services/AuditLogService";
import SecurityBlockService from "../../Services/SecurityBlockService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityBlocklistJobs from "./SecurityBlocklistJobs";
import SecurityBlockTimeline, {
  blockExpiredMarkdown,
} from "./SecurityBlockTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { SecurityBlockState } from "../../../Types/SecurityBlocklist/SecurityBlock";

/*
 * THE EVERY-MINUTE END OF BLOCKS WHOSE TIME IS UP (#10338).
 *
 * Every block expires unless someone keeps it until it is lifted. Each
 * minute, the active blocks past their expiry - read by the index on
 * expiresAt that only active blocks are in, the oldest first - are moved to
 * Expired, each in one compare-and-set on the state and expiry it was read
 * with: of two workers handed the same block, one ends it and the other
 * finds it ended, and a block extended in the meantime is left alone. Then
 * its case's timeline says so ("The block on 35.205.11.131 expired after 24
 * hours."), the audit log records it as OneUptime's own change, and the
 * project's blocklist is reconciled, which takes the block away from every
 * destination.
 *
 * A block past its expiry is not enforced even before this runs: the
 * reconciler reads only blocks in force (isSecurityBlockInForce).
 */

// Blocks read at once, and the most read in one run: 2,000 a minute.
export const SECURITY_BLOCK_EXPIRY_BATCH_SIZE: number = 100;
export const SECURITY_BLOCK_EXPIRY_MAX_BATCHES: number = 20;

export default class SecurityBlockExpiry {
  // Ends every block whose time is up. Returns how many this worker ended.
  @CaptureSpan()
  public static async expireDueBlocks(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    const seen: Set<string> = new Set();
    const projects: Map<string, ObjectID> = new Map();
    let expired: number = 0;

    for (
      let batch: number = 0;
      batch < SECURITY_BLOCK_EXPIRY_MAX_BATCHES;
      batch++
    ) {
      const blocks: Array<SecurityBlock> = await SecurityBlockService.findBy({
        query: {
          state: SecurityBlockState.Active,
          expiresAt: QueryHelper.lessThanEqualTo(now),
        },
        select: {
          _id: true,
          projectId: true,
          value: true,
          state: true,
          expiresAt: true,
          createdAt: true,
          securityCaseId: true,
        },
        sort: { expiresAt: SortOrder.Ascending },
        skip: 0,
        limit: SECURITY_BLOCK_EXPIRY_BATCH_SIZE,
        props: { isRoot: true },
      });

      // A block another worker holds may come back: each is looked at once a run.
      const fresh: Array<SecurityBlock> = blocks.filter(
        (block: SecurityBlock): boolean => {
          return Boolean(block.id && !seen.has(block.id.toString()));
        },
      );

      if (fresh.length === 0) {
        break;
      }

      for (const block of fresh) {
        seen.add(block.id!.toString());

        try {
          if (await this.expireBlock({ block, now })) {
            expired++;

            if (block.projectId) {
              projects.set(block.projectId.toString(), block.projectId);
            }
          }
        } catch (error) {
          logger.error(
            `SecurityBlockExpiry: could not end block ${block.id!.toString()}:`,
          );
          logger.error(error);
        }
      }

      if (blocks.length < SECURITY_BLOCK_EXPIRY_BATCH_SIZE) {
        break;
      }
    }

    for (const projectId of projects.values()) {
      await SecurityBlocklistJobs.queueReconcile(projectId);
    }

    return expired;
  }

  /*
   * Ends one block, if it is still active with the expiry it was read with:
   * true when this worker ended it, false when another had, or it was
   * lifted or extended first.
   */
  @CaptureSpan()
  public static async expireBlock(data: {
    block: SecurityBlock;
    now: Date;
  }): Promise<boolean> {
    const { block } = data;

    if (!block.id || !block.projectId || !block.expiresAt) {
      return false;
    }

    const isClaimed: boolean =
      await SecurityBlockService.compareAndSetColumnsByIdWithoutHooks({
        id: block.id,
        data: {
          state: SecurityBlockState.Expired,
        } as PartialEntity<SecurityBlock>,
        expectedData: {
          state: SecurityBlockState.Active,
          expiresAt: block.expiresAt,
        } as PartialEntity<SecurityBlock>,
      });

    if (!isClaimed) {
      return false;
    }

    // OneUptime's own change, in the audit log as one.
    await AuditLogService.recordUpdate({
      model: new SecurityBlock(),
      before: block,
      updatedFields: { state: SecurityBlockState.Expired },
      itemId: block.id,
      props: { isRoot: true, tenantId: block.projectId },
    });

    await SecurityBlockTimeline.write({
      projectId: block.projectId,
      securityCaseId: block.securityCaseId,
      markdown: blockExpiredMarkdown({
        value: block.value || "",
        createdAt: block.createdAt
          ? new Date(block.createdAt)
          : new Date(block.expiresAt),
        expiresAt: new Date(block.expiresAt),
      }),
      color: SecurityBlockTimeline.colors.ended,
      postedAt: data.now,
    });

    return true;
  }
}
