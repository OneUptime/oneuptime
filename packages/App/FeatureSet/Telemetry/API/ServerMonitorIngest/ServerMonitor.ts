import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectService from "Common/Server/Services/ProjectService";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";

const router: ExpressRouter = Express.getRouter();

// an api to see if secret key is valid
router.get(
  "/server-monitor/secret-key/verify/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const monitorSecretKeyAsString: string | undefined =
        req.params["secretkey"];

      if (!monitorSecretKeyAsString) {
        throw new BadDataException("Invalid Secret Key");
      }

      const monitor: Monitor | null = await MonitorService.findOneBy({
        query: {
          serverMonitorSecretKey: new ObjectID(monitorSecretKeyAsString),
          monitorType: MonitorType.Server,
          project: {
            ...ProjectService.getActiveProjectStatusQuery(),
          },
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        throw new BadDataException(ExceptionMessages.MonitorNotFound);
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/server-monitor/response/ingest/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const monitorSecretKeyAsString: string | undefined =
        req.params["secretkey"];

      if (!monitorSecretKeyAsString) {
        throw new BadDataException("Invalid Secret Key");
      }

      // return the response early.
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await TelemetryQueueService.addServerMonitorIngestJob({
        secretKey: monitorSecretKeyAsString,
        serverMonitorResponse: req.body as JSONObject,
      });

      return;
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
