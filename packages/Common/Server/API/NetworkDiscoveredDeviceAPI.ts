import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import {
  DiscoveredDeviceIdsResponse,
  DiscoveredDeviceListRequest,
  DiscoveredDeviceListResponse,
  DiscoveredDeviceMapChange,
  readDiscoveredDeviceIds,
  readDiscoveredDeviceListRequest,
} from "../../Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import CallerPlan from "../Utils/Billing/CallerPlan";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import DiscoveredDevices from "../Utils/NetworkDevice/DiscoveredDevices";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";

/*
 * THE DISCOVERED DEVICES LIST, OVER HTTP (Network > Discovered Devices,
 * OneUptime issue #5775).
 *
 *   POST /network-discovered-device/list
 *        { search, show, siteId, sort, sortOrder, limit, skip }
 *                                   one page of rows, and how many each
 *                                   choice of `show` holds
 *   POST /network-discovered-device/ids
 *        { search, show, siteId, sort, sortOrder }
 *                                   every matching row, named, up to what
 *                                   one bulk action takes: "select all"
 *   POST /network-discovered-device/hide-from-map   { endpointIds }
 *   POST /network-discovered-device/show-on-map     { endpointIds }
 *   POST /network-discovered-device/show-everything-on-map
 *                                   every hidden node of the map, the map's
 *                                   own "Show them"
 *
 * Adding devices to monitoring is an import, asked for at
 * /network-device-discovery-import/start-from-discovered-devices.
 *
 * A bare router: the list is worked out in the database across three
 * tables, so there is no one model's CRUD API to extend. Every route needs
 * a person signed in to the project; DiscoveredDevices checks the rights
 * each one needs before it reads or writes anything.
 */
const router: ExpressRouter = Express.getRouter();

async function getProps(req: ExpressRequest): Promise<{
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
}> {
  const props: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
    await CommonAPI.getDatabaseCommonInteractionProps(req),
  );

  const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(props);

  return { props: props, projectId: projectId };
}

function readBody(req: ExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

router.post(
  "/network-discovered-device/list",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getProps(req);
      const request: DiscoveredDeviceListRequest =
        readDiscoveredDeviceListRequest(readBody(req));

      const list: DiscoveredDeviceListResponse = await DiscoveredDevices.list({
        projectId: projectId,
        props: props,
        request: request,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        list as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-discovered-device/ids",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getProps(req);
      const request: DiscoveredDeviceListRequest =
        readDiscoveredDeviceListRequest(readBody(req));

      const matching: DiscoveredDeviceIdsResponse =
        await DiscoveredDevices.listIds({
          projectId: projectId,
          props: props,
          request: request,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        matching as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-discovered-device/hide-from-map",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getProps(req);
      const endpointIds: Array<string> = readDiscoveredDeviceIds(
        readBody(req)["endpointIds"],
      );

      const change: DiscoveredDeviceMapChange =
        await DiscoveredDevices.hideFromMap({
          projectId: projectId,
          props: props,
          endpointIds: endpointIds,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        change as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-discovered-device/show-on-map",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getProps(req);
      const endpointIds: Array<string> = readDiscoveredDeviceIds(
        readBody(req)["endpointIds"],
      );

      const change: DiscoveredDeviceMapChange =
        await DiscoveredDevices.showOnMap({
          projectId: projectId,
          props: props,
          endpointIds: endpointIds,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        change as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/network-discovered-device/show-everything-on-map",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { props, projectId } = await getProps(req);

      const change: { changed: number } =
        await DiscoveredDevices.showEverythingOnMap({
          projectId: projectId,
          props: props,
        });

      return Response.sendJsonObjectResponse(req, res, {
        changed: change.changed,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
