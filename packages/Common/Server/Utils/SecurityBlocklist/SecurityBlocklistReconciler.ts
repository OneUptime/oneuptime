import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import SecurityBlockEnforcementService from "../../Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../Services/SecurityBlockService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityBlockDestination, {
  SECURITY_BLOCKLIST_LOCK_NAMESPACE,
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
} from "./SecurityBlockDestination";
import SecurityBlockDestinations, {
  SecurityBlockDestinationsFound,
} from "./SecurityBlockDestinations";
import SecurityBlocklistJobs from "./SecurityBlocklistJobs";
import SecurityBlockTimeline, {
  blockEnforcedMarkdown,
  blockNotAppliedMarkdown,
} from "./SecurityBlockTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockState,
  SecurityBlockValue,
  isSecurityBlockInForce,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockEnforcementState } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";

/*
 * KEEPS THE BLOCKLIST TRUE AT EVERY DESTINATION (#10338).
 *
 * The project's active blocks are what every destination should hold; the
 * reconciler makes it so, the way a Kubernetes controller keeps a resource,
 * on every pass - every minute (ReconcileSecurityBlocklist) and as soon as a
 * block changes (SecurityBlocklistJobs) - for each destination in turn:
 *
 *   1. it takes the destination's lock, so one reconciler at a time writes
 *      it (a destination busy with another pass is left to that pass);
 *   2. it reads what the destination holds of OneUptime's (readBack) and
 *      how much it holds (capacity);
 *   3. it removes what no active block wants any more - a lifted or expired
 *      block's item - and adds what the active blocks want and it does not
 *      hold: a new block, or one someone removed at the provider (drift);
 *   4. it reads the destination back, and records on each block's
 *      enforcement row what it found: Applied, with when it was confirmed;
 *      Pending; Failed, with why; Removing; Removed.
 *
 * It never touches what OneUptime did not add: it removes only what the
 * destination's readBack() returned, which is OneUptime's own lists' and
 * rules' items alone (SecurityBlockDestination).
 *
 * Nothing is dropped silently. A block a destination cannot hold says why
 * on its row ("Not applied: Azure WAF cannot challenge"), and so does one
 * that does not fit ("Not applied: the AWS WAF IP set is full (10,000)") -
 * the oldest blocks keep their place, so a full destination never trades a
 * block it holds for a newer one. A provider that refuses an entry, or is
 * down, has the rows say so and is tried again later, a minute after the
 * first failure and twice as long after each one after it, up to half an
 * hour; a block made meanwhile is tried at once.
 *
 * A case's timeline hears when a destination first holds its block and
 * when one does not apply it, once each; a pass that changes nothing writes
 * nothing.
 */

// How long one destination's lock lasts: longer than a pass over it takes.
export const SECURITY_BLOCKLIST_LOCK_TIMEOUT_IN_MS: number = 3 * 60 * 1000;

/*
 * Where a destination's lock is kept: whatever else writes a destination
 * outside a pass - setting up or taking down a cloud WAF
 * (SecurityBlockCloudWafs), taking Cloudflare's lists and rules away - takes
 * the same lock, so it and a pass never write the same provider's lists at
 * once. Kept with the destinations (SecurityBlockDestination), and said here
 * for what reads it from the reconciler.
 */
export { SECURITY_BLOCKLIST_LOCK_NAMESPACE };

// The first retry after a failure waits a minute, each after it twice as long, up to half an hour.
export const SECURITY_BLOCKLIST_FIRST_RETRY_IN_MS: number = 60 * 1000;
export const SECURITY_BLOCKLIST_LONGEST_RETRY_IN_MS: number = 30 * 60 * 1000;

/*
 * How stale a confirmation may get before a pass writes it again: rows
 * confirmed every minute are written every few, while a confirmation is
 * read as holding for ten (SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS).
 */
export const SECURITY_BLOCKLIST_CONFIRMATION_REFRESH_IN_MS: number =
  4 * 60 * 1000;

// The most active blocks of one project one pass reads.
export const SECURITY_BLOCKLIST_MAX_ACTIVE_BLOCKS: number = 20000;

// The most projects one every-minute pass queues.
export const SECURITY_BLOCKLIST_MAX_PROJECTS_PER_PASS: number = 1000;

export function getSecurityBlocklistRetryDelayInMs(
  failedAttempts: number,
): number {
  const attempts: number = Math.max(1, Math.floor(failedAttempts));

  return Math.min(
    SECURITY_BLOCKLIST_LONGEST_RETRY_IN_MS,
    SECURITY_BLOCKLIST_FIRST_RETRY_IN_MS * Math.pow(2, attempts - 1),
  );
}

// A held item's key: its action and its value as blocks are written.
export function getHeldItemKey(
  value: string,
  action: SecurityBlockAction,
): string {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  return `${action}|${read ? read.value : (value || "").trim().toLowerCase()}`;
}

function blockKey(block: SecurityBlock): string {
  return getHeldItemKey(
    block.value || "",
    block.action || SecurityBlockAction.Block,
  );
}

/*
 * What an entry says about itself where the provider keeps a comment:
 * "OneUptime case CASE-123 until 2026-11-21 10:42 UTC".
 */
export function getSecurityBlockEntryComment(block: SecurityBlock): string {
  const caseNumber: string = block.securityCase?.caseNumberWithPrefix || "";
  const who: string = caseNumber
    ? `OneUptime case ${caseNumber}`
    : "OneUptime blocklist";

  if (!block.expiresAt) {
    return `${who} until lifted`;
  }

  const until: string = new Date(block.expiresAt)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");

  return `${who} until ${until} UTC`;
}

// What one destination is to do in a pass, worked out from what it holds.
export interface SecurityBlocklistDestinationPlan {
  toAdd: Array<SecurityBlockEntry>;
  toRemove: Array<SecurityBlockHeldItem>;
  // Blocks it cannot hold, with why.
  unsupported: Map<string, string>;
  // Blocks that do not fit.
  overflow: Set<string>;
  // Blocks waiting for their retry after the provider refused them.
  waiting: Set<string>;
}

/*
 * The plan for one destination, without touching it: what to add and what
 * to remove so it holds exactly the active blocks it can, the oldest first.
 * Pure, so the rules are pinned in a plain test.
 */
export function planSecurityBlocklistDestination(data: {
  destination: Pick<SecurityBlockDestination, "supports">;
  // The blocks in force, the oldest first.
  blocks: Array<SecurityBlock>;
  rowsByBlock: Map<string, SecurityBlockEnforcement>;
  held: Array<SecurityBlockHeldItem>;
  capacity: SecurityBlockCapacity;
  now: Date;
}): SecurityBlocklistDestinationPlan {
  const heldKeys: Set<string> = new Set(
    data.held.map((item: SecurityBlockHeldItem): string => {
      return getHeldItemKey(item.value, item.action);
    }),
  );

  const unsupported: Map<string, string> = new Map();
  const desired: Array<SecurityBlock> = [];

  for (const block of data.blocks) {
    const support: SecurityBlockSupport = data.destination.supports({
      indicatorType:
        block.indicatorType || SecurityBlockIndicatorType.IpAddress,
      action: block.action || SecurityBlockAction.Block,
      value: block.value || "",
    });

    if (!support.isSupported) {
      unsupported.set(block.id!.toString(), support.reason);
      continue;
    }

    desired.push(block);
  }

  const desiredKeys: Set<string> = new Set(desired.map(blockKey));
  const heldDesired: number = desired.filter((block: SecurityBlock) => {
    return heldKeys.has(blockKey(block));
  }).length;

  const waiting: Set<string> = new Set();
  const candidates: Array<SecurityBlock> = [];

  for (const block of desired) {
    if (heldKeys.has(blockKey(block))) {
      continue;
    }

    const row: SecurityBlockEnforcement | undefined = data.rowsByBlock.get(
      block.id!.toString(),
    );

    if (
      row?.retryAt &&
      new Date(row.retryAt).getTime() > data.now.getTime() &&
      row.state === SecurityBlockEnforcementState.Failed
    ) {
      waiting.add(block.id!.toString());
      continue;
    }

    candidates.push(block);
  }

  const room: number =
    data.capacity.limit === null
      ? candidates.length
      : Math.max(0, data.capacity.limit - heldDesired);

  const overflow: Set<string> = new Set(
    candidates.slice(room).map((block: SecurityBlock): string => {
      return block.id!.toString();
    }),
  );

  return {
    toAdd: candidates
      .slice(0, room)
      .map((block: SecurityBlock): SecurityBlockEntry => {
        return {
          securityBlockId: block.id!,
          indicatorType:
            block.indicatorType || SecurityBlockIndicatorType.IpAddress,
          value: block.value || "",
          action: block.action || SecurityBlockAction.Block,
          expiresAt: block.expiresAt ? new Date(block.expiresAt) : null,
          comment: getSecurityBlockEntryComment(block),
        };
      }),
    toRemove: data.held.filter((item: SecurityBlockHeldItem): boolean => {
      return !desiredKeys.has(getHeldItemKey(item.value, item.action));
    }),
    unsupported,
    overflow,
    waiting,
  };
}

// What a row is to be, before it is compared with what it is.
interface RowTarget {
  state: SecurityBlockEnforcementState;
  error: string | null;
  providerRef?: string | null | undefined;
  appliedAt?: Date | null | undefined;
  lastConfirmedAt?: Date | null | undefined;
  failedAttempts: number;
  retryAt: Date | null;
}

export interface SecurityBlocklistPassResult {
  destinations: number;
  // Destinations left alone this pass: locked by another pass, or waiting for their retry.
  skipped: number;
  failed: number;
}

export default class SecurityBlocklistReconciler {
  /*
   * Queues a reconcile of every project with something to keep: an active
   * block, or a block's row still to settle. Returns how many were queued.
   */
  @CaptureSpan()
  public static async queueDueProjects(): Promise<number> {
    if (!SecurityBlockDestinations.hasSources()) {
      return 0;
    }

    const projectIds: Map<string, ObjectID> = new Map();

    for (const projectId of await SecurityBlockService.findProjectIdsWithWork({
      limit: SECURITY_BLOCKLIST_MAX_PROJECTS_PER_PASS,
    })) {
      projectIds.set(projectId.toString(), projectId);
    }

    /*
     * And those whose destinations have work of their own: blocking turned
     * on with no block yet, a setup to check, a removal to finish.
     */
    for (const projectId of await SecurityBlockDestinations.findProjectIdsWithWork(
      SECURITY_BLOCKLIST_MAX_PROJECTS_PER_PASS,
    )) {
      projectIds.set(projectId.toString(), projectId);
    }

    const queued: Array<ObjectID> = Array.from(projectIds.values()).slice(
      0,
      SECURITY_BLOCKLIST_MAX_PROJECTS_PER_PASS,
    );

    for (const projectId of queued) {
      await SecurityBlocklistJobs.queueReconcile(projectId);
    }

    return queued.length;
  }

  /*
   * One pass over a project's destinations. Never throws for a destination
   * that fails: its rows say why, and the next pass tries it again.
   */
  @CaptureSpan()
  public static async reconcileProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<SecurityBlocklistPassResult> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const found: SecurityBlockDestinationsFound =
      await SecurityBlockDestinations.findForProject(data.projectId);

    const blocks: Array<SecurityBlock> = (
      await SecurityBlockService.findBy({
        query: {
          projectId: data.projectId,
          state: SecurityBlockState.Active,
        },
        select: {
          _id: true,
          projectId: true,
          value: true,
          indicatorType: true,
          action: true,
          state: true,
          expiresAt: true,
          createdAt: true,
          securityCaseId: true,
          securityCase: { caseNumberWithPrefix: true },
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: SECURITY_BLOCKLIST_MAX_ACTIVE_BLOCKS,
        props: { isRoot: true },
      })
    ).filter((block: SecurityBlock): boolean => {
      // A block past its expiry is ended, even before the expiry worker marks it.
      return (
        Boolean(block.id && block.value) && isSecurityBlockInForce(block, now)
      );
    });

    const activeIds: Set<string> = new Set(
      blocks.map((block: SecurityBlock): string => {
        return block.id!.toString();
      }),
    );

    const rows: Array<SecurityBlockEnforcement> =
      await SecurityBlockEnforcementService.findForReconcile({
        projectId: data.projectId,
        activeBlockIds: blocks.map((block: SecurityBlock): ObjectID => {
          return block.id!;
        }),
      });

    // The ended blocks whose rows are still to settle, for their values.
    const endedIds: Array<ObjectID> = Array.from(
      new Map(
        rows
          .filter((row: SecurityBlockEnforcement): boolean => {
            return Boolean(
              row.securityBlockId &&
                !activeIds.has(row.securityBlockId.toString()),
            );
          })
          .map((row: SecurityBlockEnforcement): [string, ObjectID] => {
            return [row.securityBlockId!.toString(), row.securityBlockId!];
          }),
      ).values(),
    );

    const ended: Array<SecurityBlock> = await SecurityBlockService.findByIds({
      projectId: data.projectId,
      ids: endedIds,
    });

    const result: SecurityBlocklistPassResult = {
      destinations: found.destinations.length,
      skipped: 0,
      failed: 0,
    };

    for (const destination of found.destinations) {
      const outcome: "done" | "skipped" | "failed" =
        await this.reconcileDestination({
          projectId: data.projectId,
          destination,
          blocks,
          ended,
          rows: rows.filter((row: SecurityBlockEnforcement): boolean => {
            return row.destinationKey === destination.key;
          }),
          now,
        });

      if (outcome === "skipped") {
        result.skipped++;
      } else if (outcome === "failed") {
        result.failed++;
      }
    }

    await this.settleGoneDestinations({ found, rows, now });

    // Each kind's work beside its destinations: a Cloudflare connection turned off takes its lists away.
    await SecurityBlockDestinations.settle(data.projectId, now);

    return result;
  }

  /*
   * One destination, under its lock. "skipped" when another pass holds it
   * or it waits for its retry; "failed" when the provider could not be
   * read or written.
   */
  @CaptureSpan()
  public static async reconcileDestination(data: {
    projectId: ObjectID;
    destination: SecurityBlockDestination;
    blocks: Array<SecurityBlock>;
    ended: Array<SecurityBlock>;
    rows: Array<SecurityBlockEnforcement>;
    now: Date;
  }): Promise<"done" | "skipped" | "failed"> {
    const { destination, now } = data;

    const rowsByBlock: Map<string, SecurityBlockEnforcement> = new Map();

    for (const row of data.rows) {
      if (row.securityBlockId) {
        rowsByBlock.set(row.securityBlockId.toString(), row);
      }
    }

    const endedWithRows: Array<SecurityBlock> = data.ended.filter(
      (block: SecurityBlock): boolean => {
        const row: SecurityBlockEnforcement | undefined = rowsByBlock.get(
          block.id!.toString(),
        );

        return Boolean(
          row && row.state !== SecurityBlockEnforcementState.Removed,
        );
      },
    );

    if (
      !this.isDue({
        blocks: data.blocks,
        ended: endedWithRows,
        rowsByBlock,
        now,
      }) &&
      !destination.hasWorkOfItsOwn?.(now)
    ) {
      return "skipped";
    }

    let lock: SemaphoreMutex | null = null;

    try {
      lock = await Semaphore.lock({
        key: destination.lockKey || destination.key,
        namespace: SECURITY_BLOCKLIST_LOCK_NAMESPACE,
        lockTimeout: SECURITY_BLOCKLIST_LOCK_TIMEOUT_IN_MS,
        acquireTimeout: 1000,
        acquireAttemptsLimit: 1,
        refreshInterval: 0,
      });
    } catch (error) {
      logger.debug(
        `SecurityBlocklistReconciler: ${destination.key} is being reconciled by another pass. ${String(error)}`,
      );
      return "skipped";
    }

    try {
      return await this.reconcileLocked({
        ...data,
        rowsByBlock,
        ended: endedWithRows,
      });
    } finally {
      try {
        await Semaphore.release(lock);
      } catch (error) {
        logger.warn(
          `SecurityBlocklistReconciler: could not give back the lock of ${destination.key}; it runs out by itself. ${String(error)}`,
        );
      }
    }
  }

  /*
   * Whether a destination has work this pass: a block it has no row for
   * yet, or one whose row was removed (a destination that came back), an
   * ended block it may still hold, or a row due - every row but those
   * waiting for a retry, so a destination that is not failing is read back
   * every pass, and drift found within a minute.
   */
  private static isDue(data: {
    blocks: Array<SecurityBlock>;
    ended: Array<SecurityBlock>;
    rowsByBlock: Map<string, SecurityBlockEnforcement>;
    now: Date;
  }): boolean {
    const rows: Array<SecurityBlockEnforcement> = [];

    for (const block of data.blocks) {
      const row: SecurityBlockEnforcement | undefined = data.rowsByBlock.get(
        block.id!.toString(),
      );

      if (!row || row.state === SecurityBlockEnforcementState.Removed) {
        return true;
      }

      rows.push(row);
    }

    for (const block of data.ended) {
      const row: SecurityBlockEnforcement | undefined = data.rowsByBlock.get(
        block.id!.toString(),
      );

      if (row) {
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      return false;
    }

    return rows.some((row: SecurityBlockEnforcement): boolean => {
      return (
        !row.retryAt || new Date(row.retryAt).getTime() <= data.now.getTime()
      );
    });
  }

  private static async reconcileLocked(data: {
    projectId: ObjectID;
    destination: SecurityBlockDestination;
    blocks: Array<SecurityBlock>;
    ended: Array<SecurityBlock>;
    rowsByBlock: Map<string, SecurityBlockEnforcement>;
    now: Date;
  }): Promise<"done" | "failed"> {
    const { destination, now } = data;

    let capacity: SecurityBlockCapacity;
    let held: Array<SecurityBlockHeldItem>;

    // Its setup first: made when asked for, checked when due (SecurityBlockDestination.prepare).
    if (destination.prepare) {
      try {
        await destination.prepare();
      } catch (error) {
        await this.recordDestinationFailure({
          ...data,
          error: `${destination.name} is not ready to hold blocks: ${this.errorText(error)}`,
        });
        return "failed";
      }
    }

    try {
      capacity = await destination.capacity();
      held = await destination.readBack();
    } catch (error) {
      await this.recordDestinationFailure({
        ...data,
        error: `Could not read ${destination.name}: ${this.errorText(error)}`,
      });
      return "failed";
    }

    const plan: SecurityBlocklistDestinationPlan =
      planSecurityBlocklistDestination({
        destination,
        blocks: data.blocks,
        rowsByBlock: data.rowsByBlock,
        held,
        capacity,
        now,
      });

    let removed: Array<SecurityBlockWriteResult> = [];
    let applied: Array<SecurityBlockWriteResult> = [];

    try {
      if (
        destination.update &&
        (plan.toAdd.length > 0 || plan.toRemove.length > 0)
      ) {
        // A provider that replaces its lists whole writes each once.
        const written: {
          applied: Array<SecurityBlockWriteResult>;
          removed: Array<SecurityBlockWriteResult>;
        } = await destination.update({
          add: plan.toAdd,
          remove: plan.toRemove,
        });

        removed = written.removed;
        applied = written.applied;
      } else {
        if (plan.toRemove.length > 0) {
          removed = await destination.remove(plan.toRemove);
        }

        if (plan.toAdd.length > 0) {
          applied = await destination.apply(plan.toAdd);
        }
      }
    } catch (error) {
      await this.recordDestinationFailure({
        ...data,
        error: `Could not write to ${destination.name}: ${this.errorText(error)}`,
      });
      return "failed";
    }

    // What it holds now, read from it: what apply said is a request, this is the fact.
    let confirmed: Array<SecurityBlockHeldItem> | null = held;
    let readBackError: string | null = null;

    if (plan.toAdd.length > 0 || plan.toRemove.length > 0) {
      try {
        confirmed = await destination.readBack();
      } catch (error) {
        confirmed = null;
        readBackError = `Could not read ${destination.name} back: ${this.errorText(error)}`;
      }
    }

    await this.recordPass({
      ...data,
      plan,
      capacity,
      confirmed,
      readBackError,
      applied,
      removed,
    });

    return "done";
  }

  // Writes what a pass found on every row of the destination.
  private static async recordPass(data: {
    projectId: ObjectID;
    destination: SecurityBlockDestination;
    blocks: Array<SecurityBlock>;
    ended: Array<SecurityBlock>;
    rowsByBlock: Map<string, SecurityBlockEnforcement>;
    now: Date;
    plan: SecurityBlocklistDestinationPlan;
    capacity: SecurityBlockCapacity;
    confirmed: Array<SecurityBlockHeldItem> | null;
    readBackError: string | null;
    applied: Array<SecurityBlockWriteResult>;
    removed: Array<SecurityBlockWriteResult>;
  }): Promise<void> {
    const { destination, now, plan } = data;

    const confirmedByKey: Map<string, SecurityBlockHeldItem> = new Map(
      (data.confirmed || []).map(
        (item: SecurityBlockHeldItem): [string, SecurityBlockHeldItem] => {
          return [getHeldItemKey(item.value, item.action), item];
        },
      ),
    );

    const resultsByKey: (
      results: Array<SecurityBlockWriteResult>,
    ) => Map<string, SecurityBlockWriteResult> = (
      results: Array<SecurityBlockWriteResult>,
    ): Map<string, SecurityBlockWriteResult> => {
      return new Map(
        results.map(
          (
            result: SecurityBlockWriteResult,
          ): [string, SecurityBlockWriteResult] => {
            return [getHeldItemKey(result.value, result.action), result];
          },
        ),
      );
    };

    const appliedByKey: Map<string, SecurityBlockWriteResult> = resultsByKey(
      data.applied,
    );
    const removedByKey: Map<string, SecurityBlockWriteResult> = resultsByKey(
      data.removed,
    );

    const fullReason: string =
      data.capacity.fullReason ||
      `${destination.name} is full (${data.capacity.limit ?? 0})`;

    const activeKeys: Set<string> = new Set(data.blocks.map(blockKey));

    for (const block of data.blocks) {
      const id: string = block.id!.toString();
      const key: string = blockKey(block);
      const row: SecurityBlockEnforcement | undefined =
        data.rowsByBlock.get(id);

      if (plan.waiting.has(id)) {
        continue;
      }

      let target: RowTarget;

      if (plan.unsupported.has(id)) {
        target = {
          state: SecurityBlockEnforcementState.Failed,
          error: `Not applied: ${plan.unsupported.get(id)}`,
          failedAttempts: 0,
          retryAt: null,
        };
      } else if (plan.overflow.has(id)) {
        target = {
          state: SecurityBlockEnforcementState.Failed,
          error: `Not applied: ${fullReason}`,
          failedAttempts: 0,
          retryAt: null,
        };
      } else if (confirmedByKey.has(key)) {
        const item: SecurityBlockHeldItem = confirmedByKey.get(key)!;
        const providerRef: string | null =
          item.providerRef ||
          appliedByKey.get(key)?.providerRef ||
          row?.providerRef ||
          null;

        target = item.notInForceReason
          ? {
              /*
               * Held, but what enforces it was turned off or deleted at the
               * provider: not enforced, and why, until someone puts it back.
               * Nothing to try again: each pass reads it back.
               */
              state: SecurityBlockEnforcementState.Failed,
              error: item.notInForceReason,
              providerRef,
              failedAttempts: 0,
              retryAt: null,
            }
          : item.isPropagating
            ? {
                state: SecurityBlockEnforcementState.Pending,
                error: null,
                providerRef,
                failedAttempts: 0,
                retryAt: null,
              }
            : {
                state: SecurityBlockEnforcementState.Applied,
                error: null,
                providerRef,
                appliedAt: row?.appliedAt
                  ? new Date(row.appliedAt)
                  : item.confirmedAt || now,
                lastConfirmedAt: item.confirmedAt || now,
                failedAttempts: 0,
                retryAt: null,
              };
      } else if (appliedByKey.get(key) && !appliedByKey.get(key)!.isDone) {
        const attempts: number = (row?.failedAttempts || 0) + 1;

        target = {
          state: SecurityBlockEnforcementState.Failed,
          error: `Not applied: ${appliedByKey.get(key)!.error || `${destination.name} refused it`}`,
          failedAttempts: attempts,
          retryAt: new Date(
            now.getTime() + getSecurityBlocklistRetryDelayInMs(attempts),
          ),
        };
      } else if (data.confirmed === null) {
        const attempts: number = (row?.failedAttempts || 0) + 1;

        target = {
          state:
            row?.state === SecurityBlockEnforcementState.Applied
              ? SecurityBlockEnforcementState.Applied
              : SecurityBlockEnforcementState.Pending,
          error: data.readBackError,
          failedAttempts: attempts,
          retryAt: new Date(
            now.getTime() + getSecurityBlocklistRetryDelayInMs(attempts),
          ),
        };
      } else {
        // Asked for, not seen there yet: a provider that applies a write later.
        target = {
          state: SecurityBlockEnforcementState.Pending,
          error: null,
          failedAttempts: 0,
          retryAt: null,
        };
      }

      await this.writeRow({
        projectId: data.projectId,
        destination,
        block,
        row,
        target,
        now,
      });
    }

    for (const block of data.ended) {
      const id: string = block.id!.toString();
      const key: string = blockKey(block);
      const row: SecurityBlockEnforcement | undefined =
        data.rowsByBlock.get(id);

      if (!row) {
        continue;
      }

      let target: RowTarget;

      /*
       * Gone from the destination - or held for an active block of the same
       * value made since, whose item it is now.
       */
      if (
        activeKeys.has(key) ||
        (data.confirmed !== null && !confirmedByKey.has(key))
      ) {
        target = {
          state: SecurityBlockEnforcementState.Removed,
          error: null,
          failedAttempts: 0,
          retryAt: null,
        };
      } else {
        const removal: SecurityBlockWriteResult | undefined =
          removedByKey.get(key);
        const failed: boolean =
          data.confirmed === null || Boolean(removal && !removal.isDone);
        const attempts: number = failed ? (row.failedAttempts || 0) + 1 : 0;

        target = {
          state: SecurityBlockEnforcementState.Removing,
          error:
            data.confirmed === null
              ? data.readBackError
              : removal && !removal.isDone
                ? `Not removed: ${removal.error || `${destination.name} refused it`}`
                : null,
          failedAttempts: attempts,
          retryAt: failed
            ? new Date(
                now.getTime() + getSecurityBlocklistRetryDelayInMs(attempts),
              )
            : null,
        };
      }

      await this.writeRow({
        projectId: data.projectId,
        destination,
        block,
        row,
        target,
        now,
      });
    }
  }

  /*
   * A destination that could not be read or written: every row it has,
   * and a row for every block it has none for, says why, and waits its
   * retry. A row's state stays what it was - a block applied before is
   * probably applied still - but it is not confirmed until a read says so.
   * An ended block's row is Removing, as it is when a read back fails
   * (recordPass): the block ended, and the destination may hold it still.
   * Left Applied, a lifted block would show as enforced there.
   */
  private static async recordDestinationFailure(data: {
    projectId: ObjectID;
    destination: SecurityBlockDestination;
    blocks: Array<SecurityBlock>;
    ended: Array<SecurityBlock>;
    rowsByBlock: Map<string, SecurityBlockEnforcement>;
    now: Date;
    error: string;
  }): Promise<void> {
    logger.warn(`SecurityBlocklistReconciler: ${data.error}`);

    for (const block of [...data.blocks, ...data.ended]) {
      const row: SecurityBlockEnforcement | undefined = data.rowsByBlock.get(
        block.id!.toString(),
      );
      const isEnded: boolean = !data.blocks.includes(block);

      if (isEnded && !row) {
        continue;
      }

      const attempts: number = (row?.failedAttempts || 0) + 1;

      await this.writeRow({
        projectId: data.projectId,
        destination: data.destination,
        block,
        row,
        target: {
          state: isEnded
            ? SecurityBlockEnforcementState.Removing
            : row && row.state !== SecurityBlockEnforcementState.Removed
              ? (row.state as SecurityBlockEnforcementState)
              : SecurityBlockEnforcementState.Pending,
          error: data.error,
          failedAttempts: attempts,
          retryAt: new Date(
            data.now.getTime() + getSecurityBlocklistRetryDelayInMs(attempts),
          ),
        },
        now: data.now,
      });
    }
  }

  /*
   * Rows of destinations the project no longer has - a connection deleted,
   * blocking turned off - are no longer enforced there: Removed, saying so.
   * Not while the kind they belong to could not be listed: its destinations
   * may be there still.
   */
  private static async settleGoneDestinations(data: {
    found: SecurityBlockDestinationsFound;
    rows: Array<SecurityBlockEnforcement>;
    now: Date;
  }): Promise<void> {
    const keys: Set<string> = new Set(
      data.found.destinations.map(
        (destination: SecurityBlockDestination): string => {
          return destination.key;
        },
      ),
    );
    const unlisted: Set<string> = new Set(
      data.found.failedProviders.map((failed: { provider: string }): string => {
        return failed.provider;
      }),
    );

    for (const row of data.rows) {
      if (
        !row.id ||
        !row.destinationKey ||
        keys.has(row.destinationKey) ||
        unlisted.has(row.provider || "") ||
        row.state === SecurityBlockEnforcementState.Removed
      ) {
        continue;
      }

      await SecurityBlockEnforcementService.updateColumnsByIdWithoutHooks({
        id: row.id,
        data: {
          state: SecurityBlockEnforcementState.Removed,
          error: `${row.destinationName || "The destination"} no longer enforces the blocklist.`,
          retryAt: null,
        } as unknown as PartialEntity<SecurityBlockEnforcement>,
      });
    }
  }

  /*
   * One row as it is to be: created when the block has none here, written
   * when anything it says changed (or its confirmation went stale), and the
   * case's timeline told when the destination first holds the block or
   * first does not apply it.
   */
  private static async writeRow(data: {
    projectId: ObjectID;
    destination: SecurityBlockDestination;
    block: SecurityBlock;
    row: SecurityBlockEnforcement | undefined;
    target: RowTarget;
    now: Date;
  }): Promise<void> {
    const { destination, block, row, target, now } = data;

    if (!row) {
      const created: SecurityBlockEnforcement = new SecurityBlockEnforcement();
      created.projectId = data.projectId;
      created.securityBlockId = block.id!;
      created.destinationKey = destination.key;
      created.destinationName = destination.name.slice(0, 100);
      created.provider = destination.provider;

      if (destination.connectionId) {
        created.connectionId = destination.connectionId;
      }

      created.state = target.state;
      created.failedAttempts = target.failedAttempts;

      if (target.error) {
        created.error = target.error.slice(0, 500);
      }

      if (target.providerRef) {
        created.providerRef = target.providerRef.slice(0, 100);
      }

      if (target.appliedAt) {
        created.appliedAt = target.appliedAt;
      }

      if (target.lastConfirmedAt) {
        created.lastConfirmedAt = target.lastConfirmedAt;
      }

      if (target.retryAt) {
        created.retryAt = target.retryAt;
      }

      await SecurityBlockEnforcementService.create({
        data: created,
        props: { isRoot: true },
      });
    } else {
      const changes: Record<string, unknown> = {};
      const sameTime: (
        a: Date | string | null | undefined,
        b: Date | null | undefined,
      ) => boolean = (
        a: Date | string | null | undefined,
        b: Date | null | undefined,
      ): boolean => {
        return (a ? new Date(a).getTime() : null) === (b ? b.getTime() : null);
      };

      if (row.state !== target.state) {
        changes["state"] = target.state;
      }

      if (
        (row.error || null) !==
        (target.error ? target.error.slice(0, 500) : null)
      ) {
        changes["error"] = target.error ? target.error.slice(0, 500) : null;
      }

      if (
        target.providerRef !== undefined &&
        (row.providerRef || null) !== (target.providerRef || null)
      ) {
        changes["providerRef"] = target.providerRef
          ? target.providerRef.slice(0, 100)
          : null;
      }

      if (
        target.appliedAt !== undefined &&
        !sameTime(row.appliedAt, target.appliedAt)
      ) {
        changes["appliedAt"] = target.appliedAt;
      }

      if (target.lastConfirmedAt) {
        const last: number | null = row.lastConfirmedAt
          ? new Date(row.lastConfirmedAt).getTime()
          : null;

        if (
          changes["state"] !== undefined ||
          last === null ||
          target.lastConfirmedAt.getTime() - last >=
            SECURITY_BLOCKLIST_CONFIRMATION_REFRESH_IN_MS
        ) {
          changes["lastConfirmedAt"] = target.lastConfirmedAt;
        }
      }

      if ((row.failedAttempts || 0) !== target.failedAttempts) {
        changes["failedAttempts"] = target.failedAttempts;
      }

      if (!sameTime(row.retryAt, target.retryAt)) {
        changes["retryAt"] = target.retryAt;
      }

      if (Object.keys(changes).length > 0 && row.id) {
        await SecurityBlockEnforcementService.updateColumnsByIdWithoutHooks({
          id: row.id,
          data: changes as unknown as PartialEntity<SecurityBlockEnforcement>,
        });
      }
    }

    // The case hears it once: the first time a destination holds the block, or turns it down.
    const wasApplied: boolean =
      row?.state === SecurityBlockEnforcementState.Applied;
    const wasFailed: boolean =
      row?.state === SecurityBlockEnforcementState.Failed;

    if (
      target.state === SecurityBlockEnforcementState.Applied &&
      !wasApplied &&
      !row?.appliedAt
    ) {
      await SecurityBlockTimeline.write({
        projectId: data.projectId,
        securityCaseId: block.securityCaseId,
        markdown: blockEnforcedMarkdown({
          value: block.value || "",
          destinationName: destination.name,
        }),
        color: SecurityBlockTimeline.colors.enforced,
        postedAt: now,
      });
    } else if (
      target.state === SecurityBlockEnforcementState.Failed &&
      !wasFailed &&
      block.state === SecurityBlockState.Active
    ) {
      await SecurityBlockTimeline.write({
        projectId: data.projectId,
        securityCaseId: block.securityCaseId,
        markdown: blockNotAppliedMarkdown({
          value: block.value || "",
          destinationName: destination.name,
          error: target.error || "",
        }),
        color: SecurityBlockTimeline.colors.notApplied,
        postedAt: now,
      });
    }
  }

  private static errorText(error: unknown): string {
    return error instanceof Error && error.message
      ? error.message
      : String(error || "unknown error");
  }
}
