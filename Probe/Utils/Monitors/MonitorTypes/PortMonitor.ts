import OnlineCheck from "../../OnlineCheck";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import UnableToReachServer from "Common/Types/Exception/UnableToReachServer";
import { PromiseRejectErrorFunction } from "Common/Types/FunctionTypes";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import PositiveNumber from "Common/Types/PositiveNumber";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";
import net from "net";
import Register from "../../../Services/Register";

// TODO - make sure it works for the IPV6
export interface PortMonitorResponse {
  isOnline: boolean;
  responseTimeInMS?: PositiveNumber | undefined;
  failureCause: string;
  isTimeout?: boolean | undefined;
}

export interface PingOptions {
  timeout?: PositiveNumber;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
}

export default class PortMonitor {
  public static async ping(
    host: Hostname | IPv4 | IPv6 | URL,
    port: Port,
    pingOptions?: PingOptions,
  ): Promise<PortMonitorResponse | null> {
    if (!pingOptions) {
      pingOptions = {};
    }

    if (pingOptions?.currentRetryCount === undefined) {
      pingOptions.currentRetryCount = 1;
    }

    let hostAddress: string = "";
    if (host instanceof Hostname) {
      hostAddress = host.hostname;

      if (host.port) {
        port = host.port;
      }
    } else if (host instanceof URL) {
      hostAddress = host.hostname.hostname;

      if (host.hostname.port) {
        port = host.hostname.port;
      }
    } else {
      hostAddress = host.toString();
    }

    if (!port) {
      throw new BadDataException("Port is not specified");
    }

    logger.debug(
      `Pinging host: ${pingOptions?.monitorId?.toString()}  ${hostAddress}:${port.toString()} - Retry: ${
        pingOptions?.currentRetryCount
      }`,
    );

    try {
      // Ping a host with port

      const promiseResult: Promise<PositiveNumber> = new Promise(
        (
          resolve: (responseTimeInMS: PositiveNumber) => void,
          reject: PromiseRejectErrorFunction,
        ) => {
          const startTime: [number, number] = process.hrtime();

          const socket: net.Socket = new net.Socket();

          const timeout: number = pingOptions?.timeout?.toNumber() || 5000;

          socket.setTimeout(timeout);

          if (!port) {
            throw new BadDataException("Port is not specified");
          }

          let hasPromiseResolved: boolean = false;

          socket.connect(port.toNumber(), hostAddress, () => {
            const endTime: [number, number] = process.hrtime(startTime);
            const responseTimeInMS: PositiveNumber = new PositiveNumber(
              Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000),
            );

            logger.debug(
              `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress}:${port!.toString()} success: Response Time ${responseTimeInMS} ms`,
            );

            socket.destroy(); // Close the connection after success
            if (!hasPromiseResolved) {
              resolve(responseTimeInMS);
            }

            hasPromiseResolved = true;
            return;
          });

          socket.on("timeout", () => {
            socket.destroy();
            logger.debug("Ping timeout");

            if (!hasPromiseResolved) {
              // this could mean port 25 is blocked by the cloud provider and is timing out but is actually online.
              // so we will return isOnline as true
              if (
                !Register.isPingMonitoringEnabled() &&
                port.toNumber() === 25
              ) {
                logger.debug(
                  "Ping monitoring is disabled because this is deployed in the cloud",
                );
                resolve(new PositiveNumber(timeout));
              } else {
                reject(new UnableToReachServer("Ping timeout"));
              }
            }

            hasPromiseResolved = true;
            return;
          });

          socket.on("error", (error: Error) => {
            socket.destroy();
            logger.debug("Could not connect to: " + host + ":" + port);

            if (!hasPromiseResolved) {
              reject(error);
            }

            hasPromiseResolved = true;
            return;
          });
        },
      );

      const responseTimeInMS: PositiveNumber =
        (await promiseResult) as PositiveNumber;

      // if response time is greater than 10 seconds then give it one more try

      if (
        responseTimeInMS.toNumber() > 10000 &&
        pingOptions.currentRetryCount < (pingOptions.retry || 5)
      ) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(host, port, pingOptions);
      }

      return {
        isOnline: true,
        responseTimeInMS: responseTimeInMS,
        failureCause: "",
      };
    } catch (err: unknown) {
      logger.debug(
        `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress}:${port.toString()} error: `,
      );

      logger.debug(err);

      if (!pingOptions) {
        pingOptions = {};
      }

      if (!pingOptions.currentRetryCount) {
        pingOptions.currentRetryCount = 0;
      }

      if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(host, port, pingOptions);
      }

      // check if the probe is online.
      if (!pingOptions.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorPortMonitors())) {
          logger.error(
            `PortMonitor Monitor - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const isTimeout: boolean =
        err instanceof UnableToReachServer &&
        (err as UnableToReachServer).message === "Ping timeout";

      if (isTimeout) {
        return {
          isOnline: true,
          failureCause: (err as any).toString(),
          isTimeout: true,
        };
      }

      // if AggregateError is thrown, it means that the request failed
      if ((err as any).toString().includes("AggregateError")) {
        return null;
      }

      return {
        isOnline: false,
        isTimeout: false,
        failureCause: (err as any).toString(),
      };
    }
  }
}
