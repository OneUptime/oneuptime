import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
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
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import {
  InventoryPlacementOption,
  getInventoryPlacementOptionsLimit,
  getInventoryPlacementSearch,
} from "Common/Server/Utils/Inventory/InventoryPlacementOptions";
import { isInventoryPlacementLevel } from "Common/Utils/Inventory/InventoryItemPlacement";

/*
 * The choices of Inventory's Cluster, Host and Datacenter chips (#11470):
 *
 *   POST /inventory-item/placement-options
 *   { "level": "cluster" | "host" | "datacenter",
 *     "search": "esx", "isArchived": false, "limit": 50 }
 *
 * answers { "options": [{ "value": "esx-node-07", "count": 42 }, ...] }:
 * the places of that level the project's items sit in, with how many items
 * are in each, counted by Postgres as the caller may read the list
 * (InventoryItemService.getPlacementOptions). Safe beside the InventoryItem
 * CRUD router for the reason InventoryOverview is: BaseAPI's single-segment
 * routes under `/inventory-item` are PUT and DELETE `/:id`.
 */

export const INVENTORY_PLACEMENT_OPTIONS_ROUTE: string =
  "/inventory-item/placement-options";

export const INVENTORY_PLACEMENT_LEVEL_ERROR: string =
  "Choose what to list: cluster, host or datacenter.";

export default class InventoryPlacementOptionsAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      INVENTORY_PLACEMENT_OPTIONS_ROUTE,
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

          const body: JSONObject =
            req.body && typeof req.body === "object" ? req.body : {};

          const level: unknown = body["level"];
          if (!isInventoryPlacementLevel(level)) {
            throw new BadDataException(INVENTORY_PLACEMENT_LEVEL_ERROR);
          }

          const options: Array<InventoryPlacementOption> =
            await InventoryItemService.getPlacementOptions({
              projectId: props.tenantId,
              level: level,
              search: getInventoryPlacementSearch(body["search"]),
              isArchived: body["isArchived"] === true,
              limit: getInventoryPlacementOptionsLimit(body["limit"]),
              props: props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            options: options.map(
              (option: InventoryPlacementOption): JSONObject => {
                return { value: option.value, count: option.count };
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
