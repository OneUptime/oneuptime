import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import SyntheticMonitor from "../../Utils/Monitors/MonitorTypes/SyntheticMonitor";
import ScreenSizeType from "../../Types/ScreenSizeType";
import BrowserType from "../../Types/BrowserType";
import SyntheticMonitorResponse from "../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";

const router: ExpressRouter = Express.getRouter();

interface TestMonitorSyntheticRequest {
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
}

router.post(
  "/testmonitor/synthetic/:monitorid",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const monitorId: ObjectID = new ObjectID(req.params["monitorid"] as string);
    const reqBody: TestMonitorSyntheticRequest =
      req.body as TestMonitorSyntheticRequest;
    logger.debug(`Testing synthetic monitor: ${monitorId?.toString()}`);

    try {
      const sytheticMonitorResults: SyntheticMonitorResponse[] | null =
        await SyntheticMonitor.execute({
          monitorId: monitorId,
          screenSizeTypes: reqBody.screenSizeTypes,
          browserTypes: reqBody.browserTypes,
          script: reqBody.script,
        });
      res.status(200).send(sytheticMonitorResults);
    } catch (err) {
      logger.error(err);
      next(err);
    }
  },
);

export default router;
