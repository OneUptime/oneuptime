import * as http from "http";
import { HEALTH_PORT } from "./Config";
import Logger from "./Logger";
import OTLPBatcher from "./OTLPBatcher";
import { PodWatcher } from "./PodWatcher";

export const startHealthServer: (args: {
  batcher: OTLPBatcher;
  watcher: PodWatcher;
}) => http.Server = (args: {
  batcher: OTLPBatcher;
  watcher: PodWatcher;
}): http.Server => {
  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      if (req.url === "/" || req.url === "/healthz") {
        const body: object = {
          status: args.batcher.healthy() ? "ok" : "degraded",
          activeStreams: args.watcher.activeStreamCount(),
          lastExportError: args.batcher.lastError(),
        };
        res.writeHead(args.batcher.healthy() ? 200 : 503, {
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
