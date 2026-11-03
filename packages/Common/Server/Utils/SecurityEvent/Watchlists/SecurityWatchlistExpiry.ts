import SecurityWatchlistItem from "../../../../Models/DatabaseModels/SecurityWatchlistItem";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import SecurityWatchlistItemService from "../../../Services/SecurityWatchlistItemService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * VALUES THAT LEAVE THEIR LIST (SecurityWatchlistItem.expiresAt).
 *
 * A value given a moment to leave its list leaves it then: from that
 * moment no rule, monitor, hunt or search reads it - every read of a list
 * leaves it out (SecurityWatchlists.load) - and within a minute this sweep
 * deletes it, through the delete every value goes through, so its list
 * counts it no more and the project's audit log keeps the delete as
 * OneUptime's. A list read from an address takes it back at its next read
 * only if the file still holds it with a moment still to come.
 *
 * Every minute, a batch at a time - the values whose moment came first,
 * first - for as long as there are some and the sweep has batches left; a
 * value left over goes the minute after.
 */

// Values deleted at a time.
export const SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE: number = 500;

// Batches one sweep deletes at most: the rest go in the next minute's.
export const SECURITY_WATCHLIST_EXPIRY_MAX_BATCHES: number = 20;

export default class SecurityWatchlistExpiry {
  // Returns how many values the sweep took off their lists.
  @CaptureSpan()
  public static async removeExpiredValues(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<number> {
    let removed: number = 0;
    // Values a delete failed for stay where they are: the next batch reads past them.
    let failed: number = 0;

    for (
      let batch: number = 0;
      batch < SECURITY_WATCHLIST_EXPIRY_MAX_BATCHES;
      batch++
    ) {
      const items: Array<SecurityWatchlistItem> =
        await SecurityWatchlistItemService.findBy({
          query: {
            expiresAt: QueryHelper.lessThanEqualTo(now),
          },
          select: {
            _id: true,
            projectId: true,
          },
          sort: {
            expiresAt: SortOrder.Ascending,
          },
          limit: SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE,
          skip: failed,
          props: {
            isRoot: true,
          },
        });

      if (items.length === 0) {
        break;
      }

      // A delete reads one project's rows: the batch's values, project by project.
      const idsByProject: Map<string, Array<string>> = new Map();

      for (const item of items) {
        if (!item.id || !item.projectId) {
          continue;
        }

        const key: string = item.projectId.toString();
        const ids: Array<string> = idsByProject.get(key) || [];
        ids.push(item.id.toString());
        idsByProject.set(key, ids);
      }

      for (const [projectId, ids] of idsByProject) {
        try {
          await SecurityWatchlistItemService.deleteBy({
            query: {
              projectId: new ObjectID(projectId),
              _id: new Includes(ids),
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          removed += ids.length;
        } catch (error) {
          // One project's trouble never keeps another's values on their lists.
          failed += ids.length;
          logger.error(
            `SecurityWatchlistExpiry: values of project ${projectId} could not be taken off their lists:`,
          );
          logger.error(error);
        }
      }

      if (items.length < SECURITY_WATCHLIST_EXPIRY_BATCH_SIZE) {
        break;
      }
    }

    return removed;
  }
}
