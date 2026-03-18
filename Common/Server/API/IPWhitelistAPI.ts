import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import { IpWhitelist } from "../EnvironmentConfig";

export default class IPWhitelistAPI {
  public static init(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.get(
      "/ip-whitelist",
      (req: ExpressRequest, res: ExpressResponse) => {
        const ipList: Array<string> = IpWhitelist
          ? IpWhitelist.split(",")
              .map((ip: string) => {
                return ip.trim();
              })
              .filter((ip: string) => {
                return ip.length > 0;
              })
          : [];

        Response.sendJsonObjectResponse(req, res, {
          ipWhitelist: ipList,
        });
      },
    );

    return router;
  }
}
