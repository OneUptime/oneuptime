import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import MonitorService from "Common/Server/Services/MonitorService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Response from "Common/Server/Utils/Response";
import Monitor from "Common/Models/DatabaseModels/Monitor";

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

      const serverMonitorResponse: ServerMonitorResponse =
        JSONFunctions.deserialize(
          req.body["serverMonitorResponse"] as JSONObject,
        ) as any;

      if (!serverMonitorResponse) {
        throw new BadDataException("Invalid Server Monitor Response");
      }

      if (!monitor.id) {
        throw new BadDataException("Monitor id not found");
      }

      serverMonitorResponse.monitorId = monitor.id;

      // process probe response here.
      const probeApiIngestResponse: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(serverMonitorResponse);

      return Response.sendJsonObjectResponse(req, res, {
        probeApiIngestResponse: probeApiIngestResponse,
      } as any);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
