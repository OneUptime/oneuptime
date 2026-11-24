import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ProductKey from "../../Types/Product/ProductKey";
import UserMiddleware from "../Middleware/UserAuthorization";
import EmptyNetworkSites, {
  EmptyNetworkSite,
  MAX_EMPTY_SITES_DELETED,
} from "../Utils/NetworkSite/EmptyNetworkSites";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import CommonAPI from "./CommonAPI";

/*
 * THE SITES PAGE'S DELETE EMPTY SITES, OVER HTTP (#10188;
 * Utils/NetworkSite/EmptyNetworkSites says what it does).
 *
 *   POST /network-site/empty-sites
 *     -> { sites: [{ id, name }] }: the project's empty sites the caller
 *        may read, by name.
 *
 *   POST /network-site/delete-empty-sites  { siteIds }
 *     -> { deletedCount, keptCount }: the sites of siteIds still empty,
 *        deleted as the caller.
 *
 * For a person or an API key of the project. Deleting asks the right to
 * delete sites, before anything is read.
 */
const router: ExpressRouter = Express.getRouter();

const SITES_PATH: string =
  new NetworkSite().getCrudApiPath()?.toString() || "/network-site";

export const EMPTY_SITES_PATH: string = `${SITES_PATH}/empty-sites`;
export const DELETE_EMPTY_SITES_PATH: string = `${SITES_PATH}/delete-empty-sites`;

export const DELETE_EMPTY_SITES_NOT_PERMITTED: string =
  "You may not delete sites in this project. Ask a Project Owner or Project Admin to delete the empty sites.";
export const DELETE_EMPTY_SITES_NO_SITES: string =
  "Pick the empty sites to delete.";
export const DELETE_EMPTY_SITES_TOO_MANY: string = `Delete at most ${MAX_EMPTY_SITES_DELETED} sites at a time.`;

// The site ids a delete names, checked: ids only, once each.
export function readEmptySiteIds(body: unknown): Array<string> {
  const value: unknown =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["siteIds"]
      : undefined;

  if (!Array.isArray(value) || value.length === 0) {
    throw new BadDataException(DELETE_EMPTY_SITES_NO_SITES);
  }

  if (value.length > MAX_EMPTY_SITES_DELETED) {
    throw new BadDataException(DELETE_EMPTY_SITES_TOO_MANY);
  }

  const ids: Set<string> = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string" || !ObjectID.isValidUUID(entry.trim())) {
      throw new BadDataException(DELETE_EMPTY_SITES_NO_SITES);
    }

    ids.add(entry.trim().toLowerCase());
  }

  return Array.from(ids);
}

router.post(
  EMPTY_SITES_PATH,
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      const sites: Array<EmptyNetworkSite> = await EmptyNetworkSites.find({
        projectId: projectId,
        props: props,
      });

      return Response.sendJsonObjectResponse(req, res, {
        sites: sites.map((site: EmptyNetworkSite): JSONObject => {
          return { id: site.id, name: site.name };
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  DELETE_EMPTY_SITES_PATH,
  UserMiddleware.getUserMiddleware,
  ServerProductRoutes.refuseWhileOff(ProductKey.Network),
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectPrincipal(props);

      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

      CommonAPI.assertPermittedInProject({
        databaseProps: props,
        allowedPermissions: new NetworkSite().getDeletePermissions(),
        errorMessage: DELETE_EMPTY_SITES_NOT_PERMITTED,
      });

      const siteIds: Array<string> = readEmptySiteIds(req.body);

      const outcome: { deletedCount: number; keptCount: number } =
        await EmptyNetworkSites.delete({
          projectId: projectId,
          siteIds: siteIds,
          props: props,
        });

      return Response.sendJsonObjectResponse(req, res, {
        deletedCount: outcome.deletedCount,
        keptCount: outcome.keptCount,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
