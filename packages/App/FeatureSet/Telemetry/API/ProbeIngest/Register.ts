import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { RegisterProbeKey } from "Common/Server/EnvironmentConfig";
import ProbeService from "Common/Server/Services/ProbeService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";

const router: ExpressRouter = Express.getRouter();

// Register Global Probe. Custom Probe can be registered via dashboard.
router.post(
  "/register",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body;

      const registerProbeKey: string | undefined = data[
        "registerProbeKey"
      ] as string;

      if (
        !registerProbeKey ||
        registerProbeKey !== RegisterProbeKey.toString()
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid or missing registerProbeKey. Please check REGISTER_PROBE_KEY environment variable.",
          ),
        );
      }

      if (!data["probeKey"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeId or ProbeKey is missing"),
        );
      }

      const probeKey: string = data["probeKey"] as string;

      const probe: Probe | null = await ProbeService.findOneBy({
        query: {
          key: probeKey,
          isGlobalProbe: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (probe) {
        await ProbeService.updateOneById({
          id: probe.id!,
          data: {
            name: data["probeName"] as string,
            description: data["probeDescription"] as string,
            lastAlive: OneUptimeDate.getCurrentDate(),
            connectionStatus: ProbeConnectionStatus.Connected,
          },
          props: {
            isRoot: true,
          },
        });

        return Response.sendJsonObjectResponse(req, res, {
          _id: probe._id?.toString(),
          message: "Probe already registered",
        });
      }

      let newProbe: Probe = new Probe();
      newProbe.isGlobalProbe = true;
      newProbe.key = probeKey;
      newProbe.name = data["probeName"] as string;
      newProbe.description = data["probeDescription"] as string;
      newProbe.lastAlive = OneUptimeDate.getCurrentDate();
      newProbe.connectionStatus = ProbeConnectionStatus.Connected;
      newProbe.shouldAutoEnableProbeOnNewMonitors = true;

      newProbe = await ProbeService.create({
        data: newProbe,
        props: {
          isRoot: true,
        },
      });

      return Response.sendJsonObjectResponse(req, res, {
        _id: newProbe._id?.toString(),
        message: "Probe registered successfully",
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
