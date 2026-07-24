import * as http from "http";
import { HEALTH_PORT } from "./Config";
import Logger from "./Logger";
import { Poller } from "./Poller";
import { Shipper } from "./Shipper";

export const startHealthServer: (args: {
  poller: Poller;
  shipper: Shipper;
}) => http.Server = (args: {
  poller: Poller;
  shipper: Shipper;
}): http.Server => {
  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      if (req.url === "/" || req.url === "/healthz") {
        const healthy: boolean = args.shipper.healthy();
        const body: Record<string, unknown> = {
          status: healthy ? "ok" : "degraded",
          lastPollError: args.poller.lastError(),
          lastShipError: args.shipper.lastError(),
        };
        res.writeHead(healthy ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404);
      res.end();
    },
  );
  server.listen(HEALTH_PORT, (): void => {
    Logger.info("health server listening", { port: HEALTH_PORT });
  });
  return server;
};
