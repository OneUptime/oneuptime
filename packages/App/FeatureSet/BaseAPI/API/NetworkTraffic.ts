import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import NetworkTrafficSummaryUtil, {
  ParsedNetworkTrafficFindRequest,
  ParsedNetworkTrafficRequest,
} from "Common/Server/Utils/NetworkFlow/NetworkTrafficSummary";
import NetworkTrafficUsageSummaryUtil, {
  ParsedNetworkTrafficUsageListRequest,
  ParsedNetworkTrafficUsageRequest,
} from "Common/Server/Utils/NetworkFlow/NetworkTrafficUsageSummary";
import NetworkControllerApplianceLink, {
  NetworkControllerApplianceLinkOutcome,
} from "Common/Server/Utils/NetworkController/NetworkControllerApplianceLink";
import {
  NetworkControllerApplianceLinkRequestUtil,
  NetworkControllerLinkableApplianceList,
} from "Common/Types/NetworkController/NetworkControllerApplianceLink";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  NetworkTrafficFindResult,
  NetworkTrafficSummary,
} from "Common/Types/NetFlow/NetworkTraffic";
import {
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageSummary,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

/*
 * The Traffic pages' one read: POST /network-traffic/summary - a device's,
 * a site's or the whole network's traffic over a window, narrowed by the
 * page's filters (NetworkTrafficSummaryUtil decides whose flows, and the
 * aggregation service reads them). It replaces the device-only
 * /network-device/flow/top-talkers.
 *
 * And its Meraki side: POST /network-traffic/usage-summary - the same
 * page's traffic as a Meraki connection read it (uplinks, applications,
 * destinations, clients), decided the same way whose it is
 * (NetworkTrafficUsageSummaryUtil).
 *
 * And "find an address" by its name (issue #5340): POST
 * /network-traffic/find-address - the addresses of the same page's window
 * whose name holds the text, busiest first, with the name the page calls
 * each (NetworkTrafficSummaryUtil.find, the page's scope and the caller's
 * read rights).
 *
 * And for the Meraki side (issue #5762):
 *
 *   - POST /network-traffic/usage-list - a page of one of the page's whole
 *     lists (every network, application or client, searched and sorted by
 *     the database), under the summary's own rules
 *     (NetworkTrafficUsageSummaryUtil.list);
 *   - POST /network-traffic/usage-appliances, /link-appliance and
 *     /unlink-appliance - the appliances a device can be linked to, the
 *     likely ones first, and the link itself: the appliance's serial number
 *     written on the device as the caller, its stored traffic filed under
 *     the device (NetworkControllerApplianceLink).
 */
export default class NetworkTrafficAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-traffic/summary",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const now: Date = OneUptimeDate.getCurrentDate();

          const request: ParsedNetworkTrafficRequest =
            NetworkTrafficSummaryUtil.parseRequest(req.body, now);

          const summary: NetworkTrafficSummary =
            await NetworkTrafficSummaryUtil.build({
              props: props,
              request: request,
              now: now,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            summary as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      "/network-traffic/find-address",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const request: ParsedNetworkTrafficFindRequest =
            NetworkTrafficSummaryUtil.parseFindRequest(
              req.body,
              OneUptimeDate.getCurrentDate(),
            );

          const result: NetworkTrafficFindResult =
            await NetworkTrafficSummaryUtil.find({
              props: props,
              request: request,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      "/network-traffic/usage-summary",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const now: Date = OneUptimeDate.getCurrentDate();

          const request: ParsedNetworkTrafficUsageRequest =
            NetworkTrafficUsageSummaryUtil.parseRequest(req.body, now);

          const summary: NetworkTrafficUsageSummary =
            await NetworkTrafficUsageSummaryUtil.build({
              props: props,
              request: request,
              now: now,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            summary as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      "/network-traffic/usage-list",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const request: ParsedNetworkTrafficUsageListRequest =
            NetworkTrafficUsageSummaryUtil.parseListRequest(
              req.body,
              OneUptimeDate.getCurrentDate(),
            );

          const result: NetworkTrafficUsageListResult =
            await NetworkTrafficUsageSummaryUtil.list({
              props: props,
              request: request,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      "/network-traffic/usage-appliances",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const result: NetworkControllerLinkableApplianceList =
            await NetworkControllerApplianceLink.listAppliances({
              props: props,
              request: NetworkControllerApplianceLinkRequestUtil.parseList(
                req.body,
              ),
              now: OneUptimeDate.getCurrentDate(),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            result as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      "/network-traffic/link-appliance",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const outcome: NetworkControllerApplianceLinkOutcome =
            await NetworkControllerApplianceLink.link({
              props: props,
              request: NetworkControllerApplianceLinkRequestUtil.parseLink(
                req.body,
              ),
              now: OneUptimeDate.getCurrentDate(),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            outcome as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    router.post(
      "/network-traffic/unlink-appliance",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const outcome: NetworkControllerApplianceLinkOutcome =
            await NetworkControllerApplianceLink.unlink({
              props: props,
              request: NetworkControllerApplianceLinkRequestUtil.parseUnlink(
                req.body,
              ),
              now: OneUptimeDate.getCurrentDate(),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            outcome as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
