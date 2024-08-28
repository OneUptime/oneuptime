import LocalCache from "../Infrastructure/LocalCache";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import Telemetry from "../Utils/Telemetry";
import Exception from "Common/Types/Exception/Exception";
import ServerException from "Common/Types/Exception/ServerException";

export interface StatusAPIOptions {
  readyCheck: () => Promise<void>;
  liveCheck: () => Promise<void>;
}

export default class StatusAPI {
  

  public static init(options: StatusAPIOptions): ExpressRouter {

    const statusCheckSuccessCounter = Telemetry.getCounter({
      name: "status.check.success",
      description: "Status check counter",
    });
  
    // ready counter
    const stausReadySuccess = Telemetry.getCounter({
      name: "status.ready.success",
      description: "Ready check counter",
    });
    // live counter
  
    const stausLiveSuccess = Telemetry.getCounter({
      name: "status.live.success",
      description: "Live check counter",
    });
  
    // ready failed counter
    const stausReadyFailed = Telemetry.getCounter({
      name: "status.ready.failed",
      description: "Ready check counter",
    });
  
    // live failed counter
    const stausLiveFailed = Telemetry.getCounter({
      name: "status.live.failed",
      description: "Live check counter",
    });
    
    const router: ExpressRouter = Express.getRouter();

    router.get("/app-name", (_req: ExpressRequest, res: ExpressResponse) => {
      res.send({ app: LocalCache.getString("app", "name") });
    });

    // General status
    router.get("/status", (req: ExpressRequest, res: ExpressResponse) => {
      statusCheckSuccessCounter.add(1);

      logger.info("Status check: ok");

      Response.sendJsonObjectResponse(req, res, {
        status: "ok",
      });
    });

    //Healthy probe
    router.get(
      "/status/ready",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          logger.debug("Ready check");
          await options.readyCheck();
          logger.info("Ready check: ok");
          stausReadySuccess.add(1);
          Response.sendJsonObjectResponse(req, res, {
            status: "ok",
          });
        } catch (e) {
          stausReadyFailed.add(1);
          Response.sendErrorResponse(
            req,
            res,
            e instanceof Exception
              ? e
              : new ServerException("Server is not ready"),
          );
        }
      },
    );

    //Liveness probe
    router.get(
      "/status/live",
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          logger.debug("Live check");
          await options.readyCheck();
          logger.info("Live check: ok");
          stausLiveSuccess.add(1);

          Response.sendJsonObjectResponse(req, res, {
            status: "ok",
          });
        } catch (e) {
          stausLiveFailed.add(1);
          Response.sendErrorResponse(
            req,
            res,
            e instanceof Exception
              ? e
              : new ServerException("Server is not ready"),
          );
        }
      },
    );

    return router;
  }
}
