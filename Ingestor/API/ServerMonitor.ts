import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ServerMonitor from "Common/Types/Monitor/ServerMonitor/ServerMonitor";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import MonitorService from "CommonServer/Services/MonitorService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "CommonServer/Utils/Express";
import MonitorService from "CommonServer/Utils/Monitor/Monitor";
import Response from "CommonServer/Utils/Response";
import Monitor from "Model/Models/Monitor";

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
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        throw new BadDataException("Monitor not found");
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

      const monitor: Monitor | null = await MonitorService.findOneBy({
        query: {
          serverMonitorSecretKey: new ObjectID(monitorSecretKeyAsString),
          monitorType: MonitorType.Server,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        throw new BadDataException("Monitor not found");
      }

      // now process this request.

      const serverMonitor: ServerMonitor =
        JSONFunctions.deserialize(
          req.body["serverMonitor"] as JSONObject,
        ) as any;

      if (!serverMonitor) {
        throw new BadDataException("Invalid Server Monitor Response");
      }

      if (!monitor.id) {
        throw new BadDataException("Monitor id not found");
      }

      serverMonitor.monitorId = monitor.id;

      // process probe response here.
      const probeApiIngestResponse: ProbeApiIngestResponse =
        await MonitorResourceService.monitorResource(
          serverMonitor,
        );

      return Response.sendJsonObjectResponse(req, res, {
        probeApiIngestResponse: probeApiIngestResponse,
      } as any);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
