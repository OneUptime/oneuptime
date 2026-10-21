import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import { InventoryOverviewCounts } from "Common/Server/Utils/Inventory/InventoryOverviewAggregation";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";

/*
 * The Inventory Overview landing page, in one request.
 *
 * The page used to download up to ten thousand inventory rows and count them
 * in the browser. Ten thousand is a cap, not an estate size: past it every
 * tile and the whole per-type breakdown quietly described whichever ten
 * thousand items had been seen most recently. The counts now come from
 * Postgres (see InventoryItemService.getOverviewCounts), and the only rows
 * this returns are the handful the "Recently added" card shows.
 */

// How many rows the "Recently added" card shows.
const RECENTLY_ADDED_LIMIT: number = 8;

async function getRecentlyAdded(data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Array<InventoryItem>> {
  return await InventoryItemService.findBy({
    query: {
      projectId: data.projectId,
      isArchived: false,
      /*
       * `ORDER BY ... DESC` is NULLS FIRST in Postgres, so a row with no
       * first-seen stamp would sit at the top of "newest" forever. Every
       * writer stamps it today; this keeps one that did not from taking over
       * the card.
       */
      firstSeenAt: QueryHelper.notNull(),
    },
    select: {
      _id: true,
      displayName: true,
      entityType: true,
      source: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
    sort: {
      firstSeenAt: SortOrder.Descending,
    },
    limit: RECENTLY_ADDED_LIMIT,
    skip: 0,
    props: data.props,
  });
}

export default class InventoryOverviewAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/inventory-item/overview",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }

          const projectId: ObjectID = props.tenantId;

          const [counts, recentlyAdded]: [
            InventoryOverviewCounts,
            Array<InventoryItem>,
          ] = await Promise.all([
            InventoryItemService.getOverviewCounts({
              projectId: projectId,
              props: props,
            }),
            getRecentlyAdded({ projectId: projectId, props: props }),
          ]);

          return Response.sendJsonObjectResponse(req, res, {
            counts: {
              total: counts.total,
              discovered: counts.discovered,
              mirrored: counts.mirrored,
              manual: counts.manual,
              stale: counts.stale,
            },
            countsByType: Object.keys(counts.countsByType).map(
              (entityType: string): JSONObject => {
                return {
                  entityType: entityType,
                  count: counts.countsByType[entityType] || 0,
                };
              },
            ),
            recentlyAdded: recentlyAdded.map(
              (item: InventoryItem): JSONObject => {
                return {
                  _id: item.id?.toString() || "",
                  displayName: item.displayName || "",
                  entityType: item.entityType || "",
                  source: item.source || "",
                  firstSeenAt: item.firstSeenAt
                    ? OneUptimeDate.toString(item.firstSeenAt)
                    : null,
                  lastSeenAt: item.lastSeenAt
                    ? OneUptimeDate.toString(item.lastSeenAt)
                    : null,
                };
              },
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    return router;
  }
}
