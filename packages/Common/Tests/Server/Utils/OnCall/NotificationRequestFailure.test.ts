import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  classifyNotificationRequestFailure,
  getNotReachedStatusMessage,
  NotificationRequestFailureKind,
} from "../../../../Server/Utils/OnCall/NotificationRequestFailure";
import {
  NOTIFICATION_SERVICE_URL,
  refusedOnEveryAddressRequestError,
  refusedRequestError,
  requestFailedWith,
  resetRequestError,
  socketError,
} from "../../TestingUtils/NotificationRequestErrors";
import type {
  ProbedRequestError,
  ProbeReport,
} from "../../TestingUtils/NotificationRequestErrorsProbe";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";

/*
 * HOW A REQUEST TO THE NOTIFICATION SERVICE THAT THREW IS READ (issue #6873).
 *
 * A page asks the Notification service to send each notification. Common's
 * API.post throws only for a request that got no answer:
 *
 *  - never reached the service - refused, or a name that did not resolve:
 *    nothing was sent, and the page writes Error (OnCallSendFailure);
 *  - no answer - reset, hung up, timed out - once the request may have
 *    gone out: the service may still send it, so the page claims nothing.
 *
 * Read from the AxiosError API.post wraps in an APIException and the
 * socket error axios keeps as its cause, which says which call failed.
 *
 * First against what a real request throws on this Node and axios: a
 * bundled probe (NotificationRequestErrorsProbe) runs in a plain Node
 * process - Common's jest environment is jsdom, where axios would send
 * through XMLHttpRequest - and reports each real error's shape and
 * reading, next to the stand-ins every other suite throws
 * (NotificationRequestErrors), which must match them. Then every other
 * shape, built.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const PROBE_SOURCE: string = path.join(
  COMMON_ROOT,
  "Tests",
  "Server",
  "TestingUtils",
  "NotificationRequestErrorsProbe.ts",
);

const probeDirectory: string = fs.mkdtempSync(
  path.join(os.tmpdir(), "notification-request-errors-"),
);

let report: ProbeReport;

beforeAll(() => {
  const bundle: string = path.join(probeDirectory, "probe.js");

  // Bundled for Node, as the server runs: axios's Node build, its http adapter.
  childProcess.execFileSync(
    process.execPath,
    [
      "-e",
      `
      const esbuild = require(require.resolve("esbuild", { paths: [${JSON.stringify(COMMON_ROOT)}] }));
      esbuild.buildSync({
        entryPoints: [${JSON.stringify(PROBE_SOURCE)}],
        bundle: true,
        platform: "node",
        format: "cjs",
        outfile: ${JSON.stringify(bundle)},
        external: ["pg-native", "cpu-features"],
        logLevel: "error",
      });
      `,
    ],
    { cwd: COMMON_ROOT, stdio: ["ignore", "ignore", "pipe"] },
  );

  const output: string = childProcess.execFileSync(process.execPath, [bundle], {
    cwd: probeDirectory,
    encoding: "utf8",
    timeout: 60 * 1000,
    stdio: ["ignore", "pipe", "pipe"],
  });

  report = JSON.parse(output) as ProbeReport;
}, 120 * 1000);

afterAll(() => {
  fs.rmSync(probeDirectory, { recursive: true, force: true });
});

function real(name: string): ProbedRequestError {
  return report.real[name]!;
}

function standIn(name: string): ProbedRequestError {
  return report.standIn[name]!;
}

describe("what API.post really throws, and how it is read", () => {
  test("a refused connection: an APIException holding the AxiosError, whose cause says connect() was refused - never reached", () => {
    expect(real("refused").shape).toMatchObject({
      isAPIException: true,
      innerIsAxiosError: true,
      innerCode: "ECONNREFUSED",
      innerHasResponse: false,
      hasCause: true,
      causeCode: "ECONNREFUSED",
      causeSyscall: "connect",
    });
    expect(real("refused").failure).toEqual({
      kind: NotificationRequestFailureKind.NotReached,
      code: "ECONNREFUSED",
    });
  });

  test("a name with more than one address that took no connection: never reached", () => {
    /*
     * localhost is ::1 and 127.0.0.1 where the machine has IPv6, and Node
     * tries both (an AggregateError); one address where it has not.
     */
    expect(real("refusedOnEveryAddress").failure?.kind).toBe(
      NotificationRequestFailureKind.NotReached,
    );
    expect([
      "ECONNREFUSED",
      "EADDRNOTAVAIL",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ]).toContain(real("refusedOnEveryAddress").failure?.code);
  });

  test.each([
    ["nameNotFound", "ENOTFOUND"],
    ["nameNotResolvedYet", "EAI_AGAIN"],
  ])(
    "a name that did not resolve (%s): getaddrinfo's %s - never reached",
    (name: string, code: string) => {
      expect(real(name).shape).toMatchObject({
        isAPIException: true,
        innerIsAxiosError: true,
        innerCode: code,
        innerHasResponse: false,
        causeCode: code,
        causeSyscall: "getaddrinfo",
      });
      expect(real(name).failure).toEqual({
        kind: NotificationRequestFailureKind.NotReached,
        code: code,
      });
    },
  );

  test("a connection reset once the request was in: read() reset - no answer", () => {
    expect(real("reset").shape).toMatchObject({
      innerCode: "ECONNRESET",
      innerHasResponse: false,
      causeCode: "ECONNRESET",
      causeSyscall: "read",
    });
    expect(real("reset").failure).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "ECONNRESET",
    });
  });

  test("a server that hung up without answering - no answer", () => {
    expect(real("hungUp").message).toContain("socket hang up");
    expect(real("hungUp").failure).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "ECONNRESET",
    });
  });

  test("no answer in time: axios's own timeout, with no socket error - no answer", () => {
    expect(real("timedOut").message).toContain("timeout of 300ms exceeded");
    expect(real("timedOut").shape).toMatchObject({
      innerCode: "ECONNABORTED",
      hasCause: false,
    });
    expect(real("timedOut").failure).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "ECONNABORTED",
    });
  });

  test("the message API.post gives each names the service's address - which is why the notification is never given it", () => {
    expect(real("refused").message).toMatch(
      /^Request failed to http:\/\/127\.0\.0\.1:\d+\/api\/notification\/sms\/send\. connect ECONNREFUSED 127\.0\.0\.1:\d+$/,
    );
  });
});

describe("the stand-ins every other suite throws are what a real request throws", () => {
  test.each([
    "refused",
    "nameNotFound",
    "nameNotResolvedYet",
    "reset",
    "hungUp",
    "timedOut",
  ])(
    "%s: the same wrapper, AxiosError and cause, read the same",
    (name: string) => {
      expect(standIn(name).shape).toEqual(real(name).shape);
      expect(standIn(name).failure).toEqual(real(name).failure);
    },
  );

  test("refused on every address: Node's AggregateError of the attempts, where this machine raises one", () => {
    expect(standIn("refusedOnEveryAddress").shape).toMatchObject({
      innerName: "AggregateError",
      causeName: "AggregateError",
      causeCode: "ECONNREFUSED",
      causeAttempts: [
        { code: "ECONNREFUSED", syscall: "connect" },
        { code: "ECONNREFUSED", syscall: "connect" },
      ],
    });
    expect(standIn("refusedOnEveryAddress").failure).toEqual({
      kind: NotificationRequestFailureKind.NotReached,
      code: "ECONNREFUSED",
    });

    const realShape: ProbedRequestError["shape"] = real(
      "refusedOnEveryAddress",
    ).shape;

    if (realShape.causeName === "AggregateError") {
      expect(realShape).toMatchObject({
        isAPIException: true,
        innerIsAxiosError: true,
        innerName: "AggregateError",
        innerHasResponse: false,
        causeCode: standIn("refusedOnEveryAddress").shape.causeCode,
      });
      expect(
        (realShape.causeAttempts || []).every(
          (attempt: { code: unknown; syscall: unknown }) => {
            return attempt.syscall === "connect";
          },
        ),
      ).toBe(true);
    }
  });

  test("API.post's wrapper with no request error in it is not a request error, in Node as here", () => {
    expect(standIn("notARequest").failure).toBeNull();
    expect(
      classifyNotificationRequestFailure(new APIException("URL is required")),
    ).toBeNull();
  });

  test("read here - in jsdom - the stand-ins read as in Node", () => {
    expect(classifyNotificationRequestFailure(refusedRequestError())).toEqual(
      standIn("refused").failure,
    );
    expect(classifyNotificationRequestFailure(resetRequestError())).toEqual(
      standIn("reset").failure,
    );
    expect(
      classifyNotificationRequestFailure(refusedOnEveryAddressRequestError()),
    ).toEqual(standIn("refusedOnEveryAddress").failure);
  });
});

describe("every other way a request can fail", () => {
  function failedAt(code: string, syscall?: string): APIException {
    return requestFailedWith(
      socketError({
        message: `${syscall || "socket"} ${code} 10.0.0.5:3002`,
        code: code,
        syscall: syscall,
      }),
    );
  }

  test.each(["EHOSTUNREACH", "ENETUNREACH", "EADDRNOTAVAIL", "ETIMEDOUT"])(
    "%s raised by connect(): never reached",
    (code: string) => {
      expect(
        classifyNotificationRequestFailure(failedAt(code, "connect")),
      ).toEqual({
        kind: NotificationRequestFailureKind.NotReached,
        code: code,
      });
    },
  );

  test.each([
    ["EHOSTUNREACH", "read"],
    ["EHOSTUNREACH", undefined],
    ["ENETUNREACH", "write"],
    ["EADDRNOTAVAIL", undefined],
    ["ETIMEDOUT", "read"],
    ["ETIMEDOUT", undefined],
    ["EPIPE", "write"],
    ["ECONNRESET", "write"],
    ["ECONNABORTED", undefined],
    ["ERR_SOMETHING_NEW", undefined],
  ])(
    "%s from %s, not connect(): no answer - the request may have gone out",
    (code: string, syscall: string | undefined) => {
      expect(
        classifyNotificationRequestFailure(failedAt(code, syscall)),
      ).toEqual({
        kind: NotificationRequestFailureKind.NoAnswer,
        code: code,
      });
    },
  );

  test.each(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME", "EAI_NODATA"])(
    "a name lookup that failed with %s: never reached",
    (code: string) => {
      expect(
        classifyNotificationRequestFailure(failedAt(code, "getaddrinfo")),
      ).toEqual({
        kind: NotificationRequestFailureKind.NotReached,
        code: code,
      });
    },
  );

  test("ECONNREFUSED needs no syscall: only connect() raises it", () => {
    expect(
      classifyNotificationRequestFailure(failedAt("ECONNREFUSED")),
    ).toEqual({
      kind: NotificationRequestFailureKind.NotReached,
      code: "ECONNREFUSED",
    });
  });

  function aggregateOf(
    code: string,
    attempts: Array<Error>,
  ): Error & { code?: string; errors?: Array<Error> } {
    const aggregate: Error & { code?: string; errors?: Array<Error> } =
      new Error("every address");
    aggregate.name = "AggregateError";
    aggregate.code = code;
    aggregate.errors = attempts;
    return aggregate;
  }

  test("an AggregateError with one attempt that was not a connect failure: no answer", () => {
    const aggregate: Error = aggregateOf("ECONNREFUSED", [
      socketError({
        message: "connect ECONNREFUSED ::1:3002",
        code: "ECONNREFUSED",
        syscall: "connect",
      }),
      socketError({
        message: "read ECONNRESET",
        code: "ECONNRESET",
        syscall: "read",
      }),
    ]);

    expect(
      classifyNotificationRequestFailure(requestFailedWith(aggregate)),
    ).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "ECONNREFUSED",
    });
  });

  test("an AggregateError of connect failures of different kinds: never reached, under the first's code", () => {
    const aggregate: Error = aggregateOf("ENETUNREACH", [
      socketError({
        message: "connect ENETUNREACH ::1:3002",
        code: "ENETUNREACH",
        syscall: "connect",
      }),
      socketError({
        message: "connect ECONNREFUSED 127.0.0.1:3002",
        code: "ECONNREFUSED",
        syscall: "connect",
      }),
    ]);

    expect(
      classifyNotificationRequestFailure(requestFailedWith(aggregate)),
    ).toEqual({
      kind: NotificationRequestFailureKind.NotReached,
      code: "ENETUNREACH",
    });
  });

  test("an error that names itself among its attempts is read to a depth, and no further", () => {
    const aggregate: Error & { errors?: Array<Error> } = aggregateOf(
      "ECONNREFUSED",
      [],
    );
    aggregate.errors = [aggregate];

    expect(
      classifyNotificationRequestFailure(requestFailedWith(aggregate)),
    ).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "ECONNREFUSED",
    });
  });

  test("an AxiosError with no cause is read by its own code: refused and unresolved names need no syscall, the rest do", () => {
    const config: InternalAxiosRequestConfig = {
      url: NOTIFICATION_SERVICE_URL,
    } as unknown as InternalAxiosRequestConfig;

    expect(
      classifyNotificationRequestFailure(
        new AxiosError("refused", "ECONNREFUSED", config),
      ),
    ).toEqual({
      kind: NotificationRequestFailureKind.NotReached,
      code: "ECONNREFUSED",
    });
    expect(
      classifyNotificationRequestFailure(
        new AxiosError("not found", "ENOTFOUND", config),
      ),
    ).toEqual({
      kind: NotificationRequestFailureKind.NotReached,
      code: "ENOTFOUND",
    });
    expect(
      classifyNotificationRequestFailure(
        new AxiosError("unreachable", "EHOSTUNREACH", config),
      ),
    ).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "EHOSTUNREACH",
    });
    expect(
      classifyNotificationRequestFailure(
        new AxiosError("canceled", "ERR_CANCELED", config),
      ),
    ).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "ERR_CANCELED",
    });
    expect(
      classifyNotificationRequestFailure(new AxiosError("no code")),
    ).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "no answer",
    });
  });

  test("the AxiosError itself, not wrapped, is read as the wrapped one", () => {
    expect(
      classifyNotificationRequestFailure(refusedRequestError().error),
    ).toEqual({
      kind: NotificationRequestFailureKind.NotReached,
      code: "ECONNREFUSED",
    });
    expect(
      classifyNotificationRequestFailure(resetRequestError().error),
    ).toEqual({
      kind: NotificationRequestFailureKind.NoAnswer,
      code: "ECONNRESET",
    });
  });

  test("a request the service answered is not a request that got no answer", () => {
    const answered: AxiosError = new AxiosError(
      "Request failed with status code 500",
      AxiosError.ERR_BAD_RESPONSE,
      {
        url: NOTIFICATION_SERVICE_URL,
      } as unknown as InternalAxiosRequestConfig,
      undefined,
      { status: 500, data: {} } as unknown as AxiosResponse,
    );

    expect(classifyNotificationRequestFailure(answered)).toBeNull();
    expect(
      classifyNotificationRequestFailure(
        new APIException("Request failed", answered),
      ),
    ).toBeNull();
  });

  test.each([
    ["an APIException with no request error in it", new APIException("bad")],
    ["a plain Error", new Error("Email is not in valid format.")],
    ["a BadDataException", new BadDataException("No devices provided")],
    ["a TypeError", new TypeError("Cannot read properties of undefined")],
    ["a string", "boom"],
    ["undefined", undefined],
    ["null", null],
    ["an object with a code", { code: "ECONNREFUSED", syscall: "connect" }],
  ])(
    "%s: not a request that got no answer",
    (_name: string, error: unknown) => {
      expect(classifyNotificationRequestFailure(error)).toBeNull();
    },
  );
});

describe("what a notification whose request never reached the service says", () => {
  test("the code, not the service's address", () => {
    expect(getNotReachedStatusMessage("ECONNREFUSED")).toBe(
      "Could not reach the Notification service to send this (ECONNREFUSED).",
    );
  });
});
