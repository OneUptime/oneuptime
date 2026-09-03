import OnlineCheck from "../../OnlineCheck";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import UnableToReachServer from "Common/Types/Exception/UnableToReachServer";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import PortMonitorTimings from "Common/Types/Monitor/PortMonitor/PortMonitorTimings";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";
import net from "net";
import Register from "../../../Services/Register";

export interface PortMonitorResponse {
  isOnline: boolean;
  responseTimeInMS?: PositiveNumber | undefined;
  failureCause: string;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
  portTimings?: PortMonitorTimings | undefined;
  requestFailedDetails?: RequestFailedDetails | undefined;
}

export interface PingOptions {
  timeout?: PositiveNumber;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

interface PortConnectionResult {
  responseTimeInMS: PositiveNumber;
  portTimings?: PortMonitorTimings | undefined;
}

interface ErrorWithCode extends Error {
  code?: string | undefined;
}

interface StructuralAggregateError extends Error {
  errors: Array<unknown>;
}

const durationInMilliseconds: (start: bigint, end: bigint) => number = (
  start: bigint,
  end: bigint,
): number => {
  return Math.max(0, Math.ceil(Number(end - start) / 1000000));
};

const normalizeError: (error: unknown) => Error = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

const isStructuralAggregateError: (
  error: unknown,
) => error is StructuralAggregateError = (
  error: unknown,
): error is StructuralAggregateError => {
  return (
    error instanceof Error &&
    error.name === "AggregateError" &&
    Array.isArray((error as Partial<StructuralAggregateError>).errors)
  );
};

const describeError: (error: unknown) => string = (error: unknown): string => {
  if (!isStructuralAggregateError(error)) {
    if (!(error instanceof Error)) {
      return String(error);
    }

    const description: string = error.toString();
    const errorCode: string | undefined = (error as ErrorWithCode).code;

    return errorCode && !description.includes(errorCode)
      ? `${description} (${errorCode})`
      : description;
  }

  const attemptFailures: Array<string> = error.errors.map(
    (attemptError: unknown): string => {
      return describeError(attemptError);
    },
  );
  const attemptFailureDescription: string = attemptFailures.length
    ? ` Attempts: ${attemptFailures.join("; ")}`
    : "";

  return (
    "Request failed with AggregateError (all connection attempts failed). " +
    `${error.toString()}.${attemptFailureDescription}`
  );
};

const getRepresentativeError: (error: unknown) => unknown = (
  error: unknown,
): unknown => {
  if (isStructuralAggregateError(error) && error.errors.length > 0) {
    return getRepresentativeError(error.errors[0]);
  }

  return error;
};

const getErrorCode: (error: unknown) => string | undefined = (
  error: unknown,
): string | undefined => {
  return error instanceof Error ? (error as ErrorWithCode).code : undefined;
};

const getRequestFailedDetails: (error: unknown) => RequestFailedDetails = (
  error: unknown,
): RequestFailedDetails => {
  const representativeError: unknown = getRepresentativeError(error);
  const errorCode: string | undefined = getErrorCode(representativeError);
  const rawErrorMessage: string = describeError(error);
  const lowerMessage: string = describeError(representativeError).toLowerCase();

  if (
    errorCode === "ENOTFOUND" ||
    errorCode === "EAI_AGAIN" ||
    errorCode === "EAI_FAIL" ||
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("getaddrinfo")
  ) {
    return {
      failedPhase: RequestFailedPhase.DNSResolution,
      errorCode: errorCode || "ENOTFOUND",
      errorDescription:
        "DNS resolution failed before a TCP connection could be attempted.",
      rawErrorMessage,
    };
  }

  if (
    error instanceof UnableToReachServer ||
    errorCode === "ETIMEDOUT" ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out")
  ) {
    return {
      failedPhase: RequestFailedPhase.RequestTimeout,
      errorCode: errorCode || "TIMEOUT",
      errorDescription:
        "The DNS and TCP connection attempt did not finish before the deadline.",
      rawErrorMessage,
    };
  }

  const tcpErrorCodes: Set<string> = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETUNREACH",
    "EPIPE",
  ]);

  if (
    (errorCode !== undefined && tcpErrorCodes.has(errorCode)) ||
    lowerMessage.includes("connect")
  ) {
    return {
      failedPhase: RequestFailedPhase.TCPConnection,
      errorCode,
      errorDescription:
        "TCP connection establishment failed before the port could be reached.",
      rawErrorMessage,
    };
  }

  return {
    failedPhase: RequestFailedPhase.NetworkError,
    errorCode,
    errorDescription: "The port check failed because of a network error.",
    rawErrorMessage,
  };
};

export default class PortMonitor {
  public static async ping(
    host: Hostname | IPv4 | IPv6 | URL,
    port: Port,
    pingOptions?: PingOptions,
  ): Promise<PortMonitorResponse | null> {
    if (!pingOptions) {
      pingOptions = {};
    }

    if (pingOptions.currentRetryCount === undefined) {
      pingOptions.currentRetryCount = 1;
    }

    if (!pingOptions.attempts) {
      pingOptions.attempts = [];
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
      /*
       * A monitor the tenant configured without a port. Their misconfiguration,
       * not our defect — and authoritative, so it is not promoted back to
       * code-fault by the probe-check unit of work.
       */
      throw new BadDataException("Port is not specified").asUserError();
    }

    const portNumber: number = port.toNumber();
    const timeout: number = pingOptions.timeout?.toNumber() || 5000;
    const destinationIsIpAddress: boolean = net.isIP(hostAddress) !== 0;

    /*
     * Some cloud providers block outbound SMTP. Keep the existing narrow
     * policy that treats a port-25 deadline as online when ICMP monitoring is
     * unavailable. The policy method is async, so it must be resolved before
     * the attempt starts; calling it as a boolean would never activate it.
     */
    const treatPort25TimeoutAsOnline: boolean =
      portNumber === 25 && !(await Register.isPingMonitoringEnabled());

    logger.debug(
      `Pinging host: ${pingOptions.monitorId?.toString()}  ${hostAddress}:${port.toString()} - Retry: ${
        pingOptions.currentRetryCount
      }`,
    );

    const attemptedAt: Date = new Date();
    const attemptStartedAtNs: bigint = process.hrtime.bigint();

    try {
      const connectionResult: PortConnectionResult = await new Promise(
        (
          resolve: (result: PortConnectionResult) => void,
          reject: (error: Error) => void,
        ): void => {
          const socket: net.Socket = new net.Socket();
          let firstSuccessfulLookupAtNs: bigint | undefined = undefined;
          let firstConnectionAttemptAtNs: bigint | undefined = undefined;
          let deadlineTimer: NodeJS.Timeout | undefined = undefined;
          let hasSettled: boolean = false;

          const removeListeners: () => void = (): void => {
            socket.removeListener("lookup", onLookup);
            socket.removeListener("connectionAttempt", onConnectionAttempt);
            socket.removeListener("connect", onConnect);
            socket.removeListener("error", onError);
          };

          const finish: () => void = (): void => {
            if (deadlineTimer) {
              clearTimeout(deadlineTimer);
              deadlineTimer = undefined;
            }

            removeListeners();
            socket.destroy();
          };

          const resolveOnce: (result: PortConnectionResult) => void = (
            result: PortConnectionResult,
          ): void => {
            if (hasSettled) {
              return;
            }

            hasSettled = true;
            finish();
            resolve(result);
          };

          const rejectOnce: (error: Error) => void = (error: Error): void => {
            if (hasSettled) {
              return;
            }

            hasSettled = true;
            finish();
            reject(error);
          };

          const onConnectionAttempt: () => void = (): void => {
            if (hasSettled || firstConnectionAttemptAtNs !== undefined) {
              return;
            }

            firstConnectionAttemptAtNs = process.hrtime.bigint();
          };

          const onLookup: (error: Error | null) => void = (
            error: Error | null,
          ): void => {
            if (
              hasSettled ||
              destinationIsIpAddress ||
              error ||
              firstSuccessfulLookupAtNs !== undefined
            ) {
              return;
            }

            /*
             * Node can skip connectionAttempt when lookup returns only one
             * address. Retain the first successful lookup as the TCP-start
             * fallback, while allowing connectionAttempt to supersede it for
             * multi-address family selection and fallback.
             *
             * A lookup error is intentionally left for the socket's error
             * event to settle so the native error and code remain intact.
             */
            firstSuccessfulLookupAtNs = process.hrtime.bigint();
          };

          const onConnect: () => void = (): void => {
            if (hasSettled) {
              return;
            }

            const connectedAtNs: bigint = process.hrtime.bigint();
            const totalConnectionInMs: number = durationInMilliseconds(
              attemptStartedAtNs,
              connectedAtNs,
            );
            const tcpStartedAtNs: bigint =
              firstConnectionAttemptAtNs ??
              firstSuccessfulLookupAtNs ??
              attemptStartedAtNs;
            const portTimings: PortMonitorTimings = {
              tcpConnectInMs: durationInMilliseconds(
                tcpStartedAtNs,
                connectedAtNs,
              ),
              totalConnectionInMs,
            };

            const dnsCompletedAtNs: bigint | undefined =
              firstConnectionAttemptAtNs ?? firstSuccessfulLookupAtNs;

            if (!destinationIsIpAddress && dnsCompletedAtNs !== undefined) {
              portTimings.dnsLookupInMs = durationInMilliseconds(
                attemptStartedAtNs,
                dnsCompletedAtNs,
              );
            }

            const responseTimeInMS: PositiveNumber = new PositiveNumber(
              totalConnectionInMs,
            );

            logger.debug(
              `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress}:${port.toString()} success: Response Time ${responseTimeInMS} ms`,
            );

            resolveOnce({
              responseTimeInMS,
              portTimings,
            });
          };

          const onError: (error: Error) => void = (error: Error): void => {
            logger.debug(`Could not connect to: ${host}:${port}`);
            rejectOnce(error);
          };

          const onDeadline: () => void = (): void => {
            logger.debug("Ping timeout");

            if (treatPort25TimeoutAsOnline) {
              logger.debug(
                "Ping monitoring is disabled because this is deployed in the cloud",
              );
              resolveOnce({
                responseTimeInMS: new PositiveNumber(timeout),
              });
              return;
            }

            rejectOnce(new UnableToReachServer("Ping timeout"));
          };

          socket.on("lookup", onLookup);
          socket.once("connectionAttempt", onConnectionAttempt);
          socket.once("connect", onConnect);
          socket.once("error", onError);

          /*
           * This is an absolute attempt deadline, not an idle socket timer.
           * It starts before connect() begins hostname resolution and covers
           * DNS plus every address-family connection attempt together.
           */
          deadlineTimer = setTimeout(onDeadline, timeout);

          try {
            /*
             * Let Node resolve the hostname and retain its automatic family
             * selection/fallback. Pre-resolving and connecting to one address
             * would lose that behavior.
             */
            socket.connect(portNumber, hostAddress);
          } catch (error: unknown) {
            rejectOnce(normalizeError(error));
          }
        },
      );

      const responseReceivedAt: Date = new Date();

      pingOptions.attempts.push({
        attemptNumber: pingOptions.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: connectionResult.responseTimeInMS.toNumber(),
        isOnline: true,
      });

      // if response time is greater than 10 seconds then give it one more try
      if (
        connectionResult.responseTimeInMS.toNumber() > 10000 &&
        pingOptions.currentRetryCount < (pingOptions.retry || 5)
      ) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(host, port, pingOptions);
      }

      return {
        isOnline: true,
        responseTimeInMS: connectionResult.responseTimeInMS,
        failureCause: "",
        probeAttempts: pingOptions.attempts,
        totalAttempts: pingOptions.attempts.length,
        portTimings: connectionResult.portTimings,
      };
    } catch (error: unknown) {
      const failedAtNs: bigint = process.hrtime.bigint();
      const err: Error = normalizeError(error);
      const failureCause: string = describeError(err);

      logger.debug(
        `Pinging host ${pingOptions.monitorId?.toString()} ${hostAddress}:${port.toString()} error: `,
      );
      logger.debug(err);

      const responseReceivedAt: Date = new Date();
      pingOptions.attempts.push({
        attemptNumber: pingOptions.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: durationInMilliseconds(
          attemptStartedAtNs,
          failedAtNs,
        ),
        isOnline: false,
        failureCause,
      });

      if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(host, port, pingOptions);
      }

      // check if the probe is online.
      if (!pingOptions.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorPortMonitors())) {
          logger.error(
            `PortMonitor Monitor - Probe is not online. Cannot ping ${pingOptions.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const requestFailedDetails: RequestFailedDetails =
        getRequestFailedDetails(err);
      const isTimeout: boolean =
        (err instanceof UnableToReachServer &&
          err.message === "Ping timeout") ||
        requestFailedDetails.failedPhase === RequestFailedPhase.RequestTimeout;

      return {
        isOnline: false,
        isTimeout,
        failureCause,
        requestFailedDetails,
        probeAttempts: pingOptions.attempts,
        totalAttempts: pingOptions.attempts.length,
      };
    }
  }
}
