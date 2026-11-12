import dns from "dns";
import http from "http";
import net from "net";
import API from "../../../Utils/API";
import URL from "../../../Types/API/URL";
import {
  classifyNotificationRequestFailure,
  NotificationRequestFailure,
} from "../../../Server/Utils/OnCall/NotificationRequestFailure";
import {
  describeRequestError,
  hungUpRequestError,
  refusedOnEveryAddressRequestError,
  refusedRequestError,
  RequestErrorShape,
  resetRequestError,
  timedOutRequestError,
  unresolvedNameRequestError,
} from "./NotificationRequestErrors";
import APIException from "../../../Types/Exception/ApiException";

/*
 * WHAT API.post REALLY THROWS FOR A REQUEST THAT GOT NO ANSWER, read in a
 * plain Node process - Common's jest environment is jsdom, where axios
 * sends through XMLHttpRequest and never raises these.
 *
 * NotificationRequestFailure.test.ts bundles this file for Node, runs it,
 * and reads what it prints: for each way a request to the Notification
 * service fails - a port nothing listens on (by its address, and by a name
 * with more than one address), a server that resets the connection, one
 * that hangs up, one that never answers in time, a name that does not
 * resolve (dns.lookup stood in for) - the error's shape and how
 * classifyNotificationRequestFailure reads it, next to the same for the
 * stand-in other suites throw (NotificationRequestErrors).
 *
 * Not a test of its own: nothing imports it.
 */

export interface ProbedRequestError {
  message: string;
  shape: RequestErrorShape;
  failure: NotificationRequestFailure | null;
}

export interface ProbeReport {
  real: Record<string, ProbedRequestError>;
  standIn: Record<string, ProbedRequestError>;
}

function probed(error: unknown): ProbedRequestError {
  return {
    message: error instanceof Error ? error.message : String(error),
    shape: describeRequestError(error),
    failure: classifyNotificationRequestFailure(error),
  };
}

// What API.post threw for a request to `url` - it must throw.
async function errorOfRequest(url: string, timeout?: number): Promise<unknown> {
  try {
    await API.post({
      url: URL.fromString(url),
      data: { userOnCallLogTimelineId: "probe" },
      ...(timeout ? { options: { timeout: timeout } } : {}),
    });
  } catch (err) {
    return err;
  }

  throw new Error(`The request to ${url} was answered.`);
}

// A port nothing listens on: one that was free a moment ago.
async function closedPort(): Promise<number> {
  const probe: net.Server = net.createServer();

  await new Promise<void>((resolve: () => void) => {
    probe.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (probe.address() as net.AddressInfo).port;

  await new Promise<void>((resolve: () => void) => {
    probe.close(() => {
      resolve();
    });
  });

  return port;
}

// What a request makes while every name lookup fails with `code`.
async function errorWhileNamesFail(
  code: "ENOTFOUND" | "EAI_AGAIN",
): Promise<unknown> {
  const realLookup: typeof dns.lookup = dns.lookup;

  (dns as unknown as { lookup: unknown }).lookup = (
    hostname: string,
    optionsOrCallback: unknown,
    maybeCallback?: unknown,
  ): void => {
    const callback: (err: NodeJS.ErrnoException) => void = (
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback
    ) as (err: NodeJS.ErrnoException) => void;

    const err: NodeJS.ErrnoException & { hostname?: string } = new Error(
      `getaddrinfo ${code} ${hostname}`,
    );
    err.code = code;
    err.errno = code === "ENOTFOUND" ? -3008 : -3001;
    err.syscall = "getaddrinfo";
    err.hostname = hostname;

    process.nextTick(() => {
      callback(err);
    });
  };

  try {
    return await errorOfRequest(
      "http://notification-service.internal:3002/api/notification/sms/send",
    );
  } finally {
    (dns as unknown as { lookup: unknown }).lookup = realLookup;
  }
}

async function probe(): Promise<ProbeReport> {
  // A Notification service that resets, hangs up, or never answers.
  const server: http.Server = http.createServer(
    (request: http.IncomingMessage) => {
      request.on("data", () => {
        // read the body, as the service would
      });
      request.on("end", () => {
        const path: string = request.url || "";

        if (path.startsWith("/reset")) {
          request.socket.resetAndDestroy();
        } else if (path.startsWith("/hang-up")) {
          request.socket.destroy();
        }
        // "/no-answer" is never answered.
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const port: number = (server.address() as net.AddressInfo).port;
    const refusedPort: number = await closedPort();

    return {
      real: {
        refused: probed(
          await errorOfRequest(
            `http://127.0.0.1:${refusedPort}/api/notification/sms/send`,
          ),
        ),
        refusedOnEveryAddress: probed(
          await errorOfRequest(
            `http://localhost:${refusedPort}/api/notification/sms/send`,
          ),
        ),
        nameNotFound: probed(await errorWhileNamesFail("ENOTFOUND")),
        nameNotResolvedYet: probed(await errorWhileNamesFail("EAI_AGAIN")),
        reset: probed(await errorOfRequest(`http://127.0.0.1:${port}/reset`)),
        hungUp: probed(
          await errorOfRequest(`http://127.0.0.1:${port}/hang-up`),
        ),
        timedOut: probed(
          await errorOfRequest(`http://127.0.0.1:${port}/no-answer`, 300),
        ),
      },
      standIn: {
        refused: probed(refusedRequestError()),
        refusedOnEveryAddress: probed(refusedOnEveryAddressRequestError()),
        nameNotFound: probed(unresolvedNameRequestError("ENOTFOUND")),
        nameNotResolvedYet: probed(unresolvedNameRequestError("EAI_AGAIN")),
        reset: probed(resetRequestError()),
        hungUp: probed(hungUpRequestError()),
        timedOut: probed(timedOutRequestError()),
        // Not a request error at all, as API.post wraps one.
        notARequest: probed(new APIException("URL is required")),
      },
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

probe().then(
  (report: ProbeReport) => {
    process.stdout.write(JSON.stringify(report));
    process.exit(0);
  },
  (err: unknown) => {
    process.stderr.write(String((err as Error)?.stack || err));
    process.exit(1);
  },
);
