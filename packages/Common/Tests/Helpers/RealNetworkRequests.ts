import { afterAll, afterEach, expect } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO COMMON TEST REACHES THE NETWORK THROUGH JSDOM'S XMLHttpRequest.
 *
 * Every Common suite runs in jsdom (Tests/Utils/TimezoneEnvironment.js), where
 * axios - and so Common's API, ModelAPI and everything built on them - sends
 * through jsdom's XMLHttpRequest, which opens a real connection. A suite that
 * forgot to stand in for a read sent it to http://localhost/api and waited
 * for the refusal on the real clock: ContainerHostOverviewSlowLoads failed 16
 * of its 26 tests when one came back 200 ms late on a loaded runner (#8402),
 * and on a developer machine with OneUptime listening on port 80 the request
 * got a real answer instead. On 2026-11-15 the Common Test job's logs held
 * some 2,265 such refusals, from about a hundred suites (#8403).
 *
 * So jest.setup.ts installs refuseRealRequests(): a request that would leave
 * is refused at once - the XMLHttpRequest fails as a refused connection does
 * (status 0, an "error" event, axios's "Network Error"), on the next
 * microtask and never on the real clock - and the test that sent it fails,
 * naming each request and the code that sent it. Two lists let requests
 * through or keep a test from failing:
 *
 *   - SUITES_THAT_TALK_TO_A_LOCAL_SERVER: suites that start a server of their
 *     own and send to it; their requests to a loopback address on a port of
 *     its own are let through, and nothing else of theirs is;
 *   - SUITES_STILL_SENDING_REQUESTS: suites that sent requests when this came
 *     in, found by the census below. Their requests are refused at once too,
 *     but their tests do not fail for it, until each is fixed (stand in for
 *     API.get / API.post / ModelAPI as ContainerHostOverviewSlowLoads does)
 *     and taken off the list. A suite on neither list fails on its first
 *     request.
 *
 * The census: ONEUPTIME_NETWORK_CENSUS=1 prints one line per request, refused
 * or let through, to the worker's stdout - "[network census] " and a JSON
 * object with the suite, the test, the request and the code that sent it -
 * and fails no test for it. Tests/Helpers/RealNetworkRequests.test.ts holds
 * the rule to this.
 */

export interface RealRequest {
  // The test file, from packages/Common.
  suite: string;
  // The test, or "" when it was sent outside of one (a beforeAll, say).
  test: string;
  method: string;
  url: string;
  // The first frame of the stack in OneUptime's code that is not a transport.
  from: string;
  // Whether it was let through: a suite's own local server.
  letThrough: boolean;
}

/*
 * Suites that start a server of their own and send to it through Common's
 * API, from packages/Common. Only their requests to a loopback address on a
 * port named in the URL are let through.
 */
export const SUITES_THAT_TALK_TO_A_LOCAL_SERVER: ReadonlyArray<string> = [];

/*
 * Suites that still sent real requests when the rule came in (#8403). Their
 * requests are refused at once; their tests do not fail for it. Take a suite
 * off when it stands in for what it reads.
 */
export const SUITES_STILL_SENDING_REQUESTS: ReadonlyArray<string> = [];

export const CENSUS_ENVIRONMENT_VARIABLE: string = "ONEUPTIME_NETWORK_CENSUS";
export const CENSUS_LINE_PREFIX: string = "[network census] ";

// The files every request goes through on its way out, never its sender.
const TRANSPORT_FILES: ReadonlyArray<string> = [
  "/node_modules/",
  "/Tests/Helpers/RealNetworkRequests.ts",
  "/Utils/API.ts",
  "/UI/Utils/API/API.ts",
  "/UI/Utils/ModelAPI/ModelAPI.ts",
  "/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI.ts",
  "node:internal",
];

const LOOPBACK_HOSTS: ReadonlyArray<string> = [
  "localhost",
  "127.0.0.1",
  "[::1]",
];

const NETWORK_PROTOCOLS: ReadonlyArray<string> = ["http:", "https:"];

// "at f (/repo/packages/x.ts:12:5)": the file and line of a stack frame.
const STACK_FRAME_LOCATION: RegExp = /\(?(\/[^()\s]+:\d+):\d+\)?$/;

// A path from packages/Common, or from the repository for the other packages.
export function fromRepository(file: string): string {
  const marker: string = "/packages/";
  const at: number = file.lastIndexOf(marker);

  return at < 0 ? file : file.slice(at + marker.length);
}

/*
 * The first frame of `stack` in OneUptime's own code that is not the way out
 * (axios, API, ModelAPI, this file), as "packages/<file>:<line>".
 */
export function senderOf(stack: string): string {
  const frames: Array<string> = stack
    .split("\n")
    .map((line: string): string => {
      const match: RegExpExecArray | null = STACK_FRAME_LOCATION.exec(
        line.trim(),
      );

      return match ? match[1]! : "";
    })
    .filter((frame: string): boolean => {
      return frame.includes("/packages/");
    });
  const sender: string | undefined = frames.find((frame: string): boolean => {
    return !TRANSPORT_FILES.some((transport: string): boolean => {
      return frame.includes(transport);
    });
  });
  const shown: string | undefined =
    sender ||
    frames.find((frame: string): boolean => {
      return !frame.includes("/node_modules/");
    });

  return shown
    ? `packages/${fromRepository(shown)}`
    : "(no frame in packages/)";
}

// Whether a URL leaves for the network at all (not data:, blob:, file:).
export function isNetworkUrl(url: URL): boolean {
  return NETWORK_PROTOCOLS.includes(url.protocol);
}

// A loopback address on a port of its own: a server a suite started.
export function isLocalServerUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.includes(url.hostname) && url.port !== "";
}

export function isLetThrough(
  suite: string,
  url: URL,
  localServerSuites: ReadonlyArray<string> = SUITES_THAT_TALK_TO_A_LOCAL_SERVER,
): boolean {
  return localServerSuites.includes(suite) && isLocalServerUrl(url);
}

// What a test that sent requests fails with.
export function failureFor(requests: ReadonlyArray<RealRequest>): string {
  return [
    `This test sent ${requests.length === 1 ? "a request" : `${requests.length} requests`} to the network, which Tests/jest.setup.ts refused at once:`,
    ...requests.map((request: RealRequest): string => {
      return `  ${request.method} ${request.url} (from ${request.from})`;
    }),
    'Stand in for what it reads - jest.spyOn(API, "get" / "post"), ModelAPI, AnalyticsModelAPI - as Tests/App/Dashboard/ContainerHostOverviewSlowLoads.test.tsx does (Tests/Helpers/RealNetworkRequests.ts).',
  ].join("\n");
}

// What a request that failed before it sent anything reports of its progress.
interface NoProgress {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

interface XhrImplementation {
  readyState: number;
  status: number;
  statusText: string;
  flag: { synchronous?: boolean };
  properties: Record<string, unknown>;
}

const DONE: number = 4;
const OPENED: number = 1;

// jsdom keeps an XMLHttpRequest's state on its implementation object.
function implementationOf(request: XMLHttpRequest): XhrImplementation {
  const symbol: symbol | undefined = Object.getOwnPropertySymbols(request).find(
    (candidate: symbol): boolean => {
      return candidate.description === "impl";
    },
  );
  const implementation: XhrImplementation | undefined = symbol
    ? (request as unknown as Record<symbol, XhrImplementation>)[symbol]
    : undefined;

  if (
    !implementation ||
    implementation.readyState !== OPENED ||
    typeof implementation.properties !== "object"
  ) {
    throw new Error(
      "Tests/Helpers/RealNetworkRequests.ts could not refuse a request: jsdom's XMLHttpRequest no longer keeps its state where this reads it.",
    );
  }

  return implementation;
}

/*
 * Fails `request` as a refused connection does - jsdom's request error steps
 * (xhr-utils.js requestErrorSteps), without the network: loadstart now, as
 * send() fires it, then, on the next microtask, readystatechange to DONE with
 * status 0, error and loadend.
 */
export function refuse(request: XMLHttpRequest): void {
  const implementation: XhrImplementation = implementationOf(request);
  const progress: () => NoProgress = (): NoProgress => {
    return { loaded: 0, total: 0, lengthComputable: false };
  };
  const failAsNetworkError: () => void = (): void => {
    implementation.readyState = DONE;
    implementation.status = 0;
    implementation.statusText = "";
    implementation.properties["send"] = false;
    implementation.properties["responseBuffer"] = null;
    implementation.properties["responseCache"] = null;
    implementation.properties["responseTextCache"] = null;
    implementation.properties["responseXMLCache"] = null;
    implementation.properties["responseHeaders"] = {};
  };

  if (implementation.flag.synchronous) {
    failAsNetworkError();
    throw new DOMException("Refused by Tests/jest.setup.ts", "NetworkError");
  }

  // As send() does: the send flag set, so abort() still works until it fails.
  implementation.properties["send"] = true;
  request.dispatchEvent(new ProgressEvent("loadstart", progress()));

  // A promise, which fake timers never hold back, as they do queueMicrotask.
  void Promise.resolve().then((): void => {
    // Aborted in the meantime: abort() has run the error steps itself.
    if (implementation.properties["send"] !== true) {
      return;
    }

    failAsNetworkError();
    request.dispatchEvent(new Event("readystatechange"));
    request.dispatchEvent(new ProgressEvent("error", progress()));
    request.dispatchEvent(new ProgressEvent("loadend", progress()));
  });
}

/*
 * ---------------------------------------------------------------------------
 * The rule, as jest.setup.ts installs it in every suite.
 * ---------------------------------------------------------------------------
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

// The requests the running suite sent that no check has taken yet.
const sent: Array<RealRequest> = [];

// The running suite, from packages/Common: "Tests/App/Dashboard/X.test.tsx".
export function runningSuite(): string {
  const testPath: string | undefined = expect.getState().testPath;

  return testPath
    ? path.relative(COMMON_ROOT, testPath).split(path.sep).join("/")
    : "";
}

// What the running suite sent since this was last called, taken.
export function takeRequestsSent(): Array<RealRequest> {
  return sent.splice(0, sent.length);
}

/*
 * Throws, failing the test, when `suite` sent requests that were refused
 * and is not on SUITES_STILL_SENDING_REQUESTS.
 */
export function failIfSent(
  suite: string,
  requests: ReadonlyArray<RealRequest>,
  stillSending: ReadonlyArray<string> = SUITES_STILL_SENDING_REQUESTS,
): void {
  const refused: Array<RealRequest> = requests.filter(
    (request: RealRequest): boolean => {
      return !request.letThrough;
    },
  );

  if (refused.length > 0 && !stillSending.includes(suite)) {
    throw new Error(failureFor(refused));
  }
}

interface OpenedRequest {
  method: string;
  url: string;
}

/*
 * Installs the rule on jsdom's XMLHttpRequest: every request to an http(s)
 * address is recorded and refused at once, unless it is to the suite's own
 * local server, and - but in a census - fails the test that sent it.
 */
export function refuseRealRequests(options: { census: boolean }): void {
  if (
    typeof window === "undefined" ||
    typeof window.XMLHttpRequest !== "function"
  ) {
    return;
  }

  const prototype: XMLHttpRequest = window.XMLHttpRequest.prototype;
  const open: XMLHttpRequest["open"] = prototype.open;
  const send: XMLHttpRequest["send"] = prototype.send;
  const opened: WeakMap<XMLHttpRequest, OpenedRequest> = new WeakMap<
    XMLHttpRequest,
    OpenedRequest
  >();

  prototype.open = function (
    this: XMLHttpRequest,
    ...args: Array<unknown>
  ): void {
    opened.set(this, {
      method: String(args[0]).toUpperCase(),
      url: String(args[1]),
    });

    return (open as (...openArgs: Array<unknown>) => void).apply(this, args);
  };

  prototype.send = function (
    this: XMLHttpRequest,
    body?: Parameters<XMLHttpRequest["send"]>[0],
  ): void {
    const request: OpenedRequest | undefined = opened.get(this);
    let url: URL | null = null;

    try {
      url = request ? new URL(request.url, window.location.href) : null;
    } catch {
      url = null;
    }

    if (!request || !url || !isNetworkUrl(url)) {
      return send.call(this, body);
    }

    const suite: string = runningSuite();
    const previousLimit: number = Error.stackTraceLimit;

    Error.stackTraceLimit = 50;

    const stack: string = new Error().stack || "";

    Error.stackTraceLimit = previousLimit;

    const record: RealRequest = {
      suite: suite,
      test: expect.getState().currentTestName || "",
      method: request.method,
      url: url.href,
      from: senderOf(stack),
      letThrough: options.census
        ? isLocalServerUrl(url)
        : isLetThrough(suite, url),
    };

    sent.push(record);

    if (options.census) {
      fs.writeSync(1, `${CENSUS_LINE_PREFIX}${JSON.stringify(record)}\n`);
    }

    if (record.letThrough) {
      return send.call(this, body);
    }

    return refuse(this);
  };

  // A census lists the requests; the rule fails the test that sent one.
  const check: () => void = (): void => {
    const requests: Array<RealRequest> = takeRequestsSent();

    if (!options.census) {
      failIfSent(runningSuite(), requests);
    }
  };

  afterEach(check);
  // Sent outside of every test: in a beforeAll, or after the last test.
  afterAll(check);
}
