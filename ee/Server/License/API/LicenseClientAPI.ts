import GlobalConfigAPI, {
  LICENSE_RESPONSE_CONFIG_SELECT,
} from "Common/Server/API/GlobalConfigAPI";
import {
  EnterpriseLicenseSnapshot,
  SeatUsage,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import LicenseClient from "../LicenseClient";
import licenseProvider from "../LicenseProvider";

/*
 * The license client's routes, mounted under "/api" ahead of core's
 * GlobalConfigAPI (whose GET on the same path stays in core).
 *
 *   POST /global-config/license          activate: {licenseKey} online, or
 *                                        {licenseToken} offline
 *   POST /global-config/license/refresh  re-fetch the stored key's license
 *
 * Both are master-admin only. They write the terms UserService enforces the
 * seat limit against, so anyone who can reach them can raise the ceiling on
 * the whole installation. The check is per route: an ee router holds routes
 * only, never router.use() - a path-less middleware here would run for every
 * core request that passes through "/api".
 */
export const LICENSE_ROUTE: string = "/global-config/license";
export const LICENSE_REFRESH_ROUTE: string = "/global-config/license/refresh";

/*
 * The answer to a successful write: the same body the GET gives a master
 * admin, read fresh after the write, so the dialog can show the new terms
 * without trusting two sources that could disagree.
 */
export const buildLicenseWriteResponse: () => Promise<JSONObject> =
  async (): Promise<JSONObject> => {
    const snapshot: EnterpriseLicenseSnapshot =
      await licenseProvider.getSnapshot();
    const seatUsage: SeatUsage | null = await licenseProvider.getSeatUsage();
    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: LICENSE_RESPONSE_CONFIG_SELECT,
      props: {
        isRoot: true,
      },
    });

    return GlobalConfigAPI.buildLicenseResponse({
      audience: "master-admin",
      isEnterpriseEditionLoaded: true,
      snapshot,
      config,
      seatUsage,
    });
  };

export const createLicenseClientRouter: () => ExpressRouter =
  (): ExpressRouter => {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      LICENSE_ROUTE,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: JSONObject = (req.body as JSONObject) || {};
          const licenseKey: string =
            typeof body["licenseKey"] === "string"
              ? body["licenseKey"].trim()
              : "";
          const licenseToken: string = LicenseClient.normalizePastedToken(
            body["licenseToken"],
          );

          if (licenseKey && licenseToken) {
            throw new BadDataException(
              "Send either a license key (online activation) or a license token (offline activation), not both.",
            );
          }

          if (licenseToken) {
            await LicenseClient.activateOffline(licenseToken);
          } else if (licenseKey) {
            await LicenseClient.validateWithLicenseServer({
              licenseKey,
              mode: "activate",
            });
          } else {
            throw new BadDataException(
              "License key is required. To activate an installation that cannot reach oneuptime.com, paste a signed license token instead.",
            );
          }

          return Response.sendJsonObjectResponse(
            req,
            res,
            await buildLicenseWriteResponse(),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Re-fetch the license this installation already holds.
     *
     * The seat limit and the expiry live on oneuptime.com and can change on
     * any day - a customer buys ten more seats at noon. The daily report job
     * picks that up eventually; this is the button an administrator presses
     * when "eventually" is not good enough. It takes no license key: it uses
     * the stored one.
     */
    router.post(
      LICENSE_REFRESH_ROUTE,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await LicenseClient.refreshStoredLicense();

          return Response.sendJsonObjectResponse(
            req,
            res,
            await buildLicenseWriteResponse(),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    return router;
  };
