import http, { IncomingMessage, Server, ServerResponse } from "http";
import net, { AddressInfo } from "net";
import { chromium } from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import MonitorSecretValueRedaction, {
  HIDDEN_SECRET_MARKER,
  HiddenSecretValues,
} from "Common/Server/Utils/Monitor/MonitorSecretValueRedaction";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import escapeRegExp from "Common/Utils/RegExpEscape";
import FakeInternet from "../SyntheticRuntime/Fixtures/FakeInternet";

/*
 * A MONITOR SECRET A SYNTHETIC SCRIPT SAYS BACK, IN REAL PLAYWRIGHT (#10825).
 *
 * The server fills {{monitorSecrets.NAME}} into a Synthetic monitor's
 * script before the probe runs it, so the script the probe runs holds the
 * value itself. These run such scripts through the probe's own Synthetic
 * monitor - the real worker process, Playwright and Chromium - and check
 * the two places the value went:
 *
 *   - what the probe reports: Playwright's error quotes the URL a page
 *     failed to load, token and all (net::ERR_CONNECTION_CLOSED at
 *     https://...?token=...), a script logs what it holds, and a page
 *     echoes the URL it was asked for. The server reads that report for the
 *     monitor's secrets as it takes it in (MonitorSecretValueRedaction):
 *     read so, no form of the value is left, and everything around it - the
 *     error, the host, the path, the parameter's name - is;
 *   - the probe's own log lines, which say the script failed but never what
 *     it failed with: the probe cannot tell which text was a secret.
 *
 * The pages are on public addresses, as a monitored site is: every request
 * of a check goes through its egress proxy, which refuses loopback
 * (GHSA-9rx7-vwfj-whp7). The probe's outbound proxy here is FakeInternet,
 * which answers for those addresses from servers on loopback.
 */

jest.setTimeout(600_000);

// A site that echoes the address it was asked for.
const ECHO_SITE: string = "93.184.215.14";
// A site whose TLS port closes every connection it accepts.
const CLOSING_SITE: string = "93.184.215.15";

// A value of the alphabets a secret is written in: quotes, spaces, unicode.
function makeSecret(random: SeededRandom): string {
  const alphabet: string = "abcXYZ019-_.~!$'()*+,;=:@ \"\\é日";
  let secret: string = "Tok3n";

  for (let index: number = 0; index < 14; index++) {
    secret += alphabet.charAt(random(alphabet.length));
  }

  return `${secret}Z`;
}

// The forms a browser, a URL or a JSON text writes a value in.
function formsOf(secret: string): Array<string> {
  const forms: Array<string> = [
    secret,
    encodeURIComponent(secret),
    encodeURI(secret),
    JSON.stringify(secret).slice(1, -1),
    new URL(`https://forms.example.invalid/?t=${secret}`).search.slice(3),
    new URL(`https://forms.example.invalid/${secret}`).pathname.slice(1),
  ];

  return forms.filter((form: string, index: number): boolean => {
    return forms.indexOf(form) === index;
  });
}

// Every text in a value, its object keys included.
function textsOf(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item: unknown): Array<string> => {
      return textsOf(item);
    });
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, item]: [string, unknown]): Array<string> => {
        return [key, ...textsOf(item)];
      },
    );
  }

  return [];
}

// The forms of the value a text still holds, in any case.
function formsLeftIn(value: unknown, secret: string): Array<string> {
  const left: Array<string> = [];

  for (const text of textsOf(value)) {
    for (const form of formsOf(secret)) {
      if (text.toLowerCase().includes(form.toLowerCase())) {
        left.push(form);
      }
    }
  }

  return left;
}

// A script's runs as the probe reports them, read as the server reads them.
function readByServer(
  responses: Array<SyntheticMonitorResponse>,
  secret: string,
): ProbeMonitorResponse {
  const values: HiddenSecretValues | null = MonitorSecretValueRedaction.compile(
    [secret],
  );

  expect(values).not.toBeNull();

  return MonitorSecretValueRedaction.redactCheck(
    {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      failureCause: "",
      monitoredAt: new Date(),
      syntheticMonitorResponse: responses,
    },
    values,
  );
}

interface SyntheticMonitorClass {
  execute(options: {
    script: string;
    browserTypes: Array<BrowserType>;
    screenSizeTypes: Array<ScreenSizeType>;
    retryCountOnError?: number;
  }): Promise<Array<SyntheticMonitorResponse> | null>;
}

interface ProxyConfigClass {
  isProxyConfigured(): boolean;
  getHttpProxyUrl(): string | null;
  getHttpsProxyUrl(): string | null;
}

interface LoggerClass {
  error(message: unknown, attributes?: unknown): void;
  warn(message: unknown, attributes?: unknown): void;
  info(message: unknown, attributes?: unknown): void;
  debug(message: unknown, attributes?: unknown): void;
}

describe("a monitor secret a Synthetic script says back, in real Playwright", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  const random: SeededRandom = seededRandom(10825);

  let SyntheticMonitor: SyntheticMonitorClass & {
    getChromeExecutablePath(): Promise<string>;
  };
  let ProxyConfig: ProxyConfigClass;
  let logger: LoggerClass;
  let echoServer: Server;
  let echoUrl: string;
  let closingServer: net.Server;
  let fakeInternet: FakeInternet;
  let chromeExecutablePath: string;
  let logged: Array<string> = [];

  beforeAll(async () => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";

    SyntheticMonitor = jest.requireActual<{
      default: typeof SyntheticMonitor;
    }>("../../../../Utils/Monitors/MonitorTypes/SyntheticMonitor").default;
    ProxyConfig = jest.requireActual<{ default: ProxyConfigClass }>(
      "../../../../Utils/ProxyConfig",
    ).default;
    logger = jest.requireActual<{ default: LoggerClass }>(
      "Common/Server/Utils/Logger",
    ).default;
    /*
     * The probe's own lookup finds the Linux builds its image installs;
     * elsewhere - a developer's machine - Playwright's own Chromium is used.
     */
    chromeExecutablePath =
      await SyntheticMonitor.getChromeExecutablePath().catch((): string => {
        return chromium.executablePath();
      });

    // An error page that quotes the address it was asked for, as many do.
    echoServer = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        const asked: string = decodeURIComponent(request.url || "");
        const escaped: string = asked
          .split("&")
          .join("&amp;")
          .split("<")
          .join("&lt;")
          .split(">")
          .join("&gt;")
          .split('"')
          .join("&quot;");

        response.writeHead(404, {
          "Content-Type": "text/html; charset=utf-8",
          Connection: "close",
        });
        response.end(
          `<!doctype html><title>Not found</title><p id="said">No page at ${escaped}</p>`,
        );
      },
    );

    await new Promise<void>((resolve: () => void) => {
      echoServer.listen(0, "127.0.0.1", resolve);
    });

    // A TLS port that closes every connection: the browser's load fails.
    closingServer = net.createServer((socket: net.Socket): void => {
      socket.on("error", (): void => {
        // The tunnel went away first.
      });
      socket.destroy();
    });
    await new Promise<void>((resolve: () => void) => {
      closingServer.listen(0, "127.0.0.1", resolve);
    });

    fakeInternet = new FakeInternet();
    await fakeInternet.start();
    fakeInternet.route(
      ECHO_SITE,
      80,
      (echoServer.address() as AddressInfo).port,
    );
    fakeInternet.route(
      CLOSING_SITE,
      443,
      (closingServer.address() as AddressInfo).port,
    );

    echoUrl = `http://${ECHO_SITE}`;
  });

  beforeEach(() => {
    const lines: Array<string> = [];

    logged = lines;

    // Every line the probe logs, at any level, as it would print it.
    const record: (message: unknown, attributes?: unknown) => void = (
      message: unknown,
      attributes?: unknown,
    ): void => {
      lines.push(
        `${message instanceof Error ? message.message : String(message)} ${JSON.stringify(attributes ?? null)}`,
      );
    };

    for (const level of ["error", "warn", "info", "debug"] as const) {
      jest.spyOn(logger, level).mockImplementation(record);
    }

    // The probe's outbound proxy: what the check's egress proxy goes through.
    jest.spyOn(ProxyConfig, "isProxyConfigured").mockReturnValue(true);
    jest
      .spyOn(ProxyConfig, "getHttpsProxyUrl")
      .mockReturnValue(fakeInternet.url());
    jest.spyOn(ProxyConfig, "getHttpProxyUrl").mockReturnValue(null);
    jest
      .spyOn(SyntheticMonitor, "getChromeExecutablePath")
      .mockResolvedValue(chromeExecutablePath);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await fakeInternet.stop();
    await new Promise<void>((resolve: () => void) => {
      echoServer.close(() => {
        resolve();
      });
    });
    await new Promise<void>((resolve: () => void) => {
      closingServer.close(() => {
        resolve();
      });
    });

    if (originalOneUptimeUrl === undefined) {
      delete process.env["ONEUPTIME_URL"];
    } else {
      process.env["ONEUPTIME_URL"] = originalOneUptimeUrl;
    }

    if (originalProbeKey === undefined) {
      delete process.env["PROBE_KEY"];
    } else {
      process.env["PROBE_KEY"] = originalProbeKey;
    }
  });

  test("Playwright's error for a page it cannot load quotes the token, and the server's reading leaves none of it", async () => {
    const secret: string = makeSecret(random);
    /*
     * A site the egress proxy lets through, whose load then fails in the
     * browser: an error of Playwright's, which quotes the URL. (A host the
     * proxy cannot reach is reported in the proxy's words instead, which
     * name the host alone.)
     */
    const target: string = `https://${CLOSING_SITE}/login?user=ops&token=${secret}`;

    // The script as the server hands it over: the value filled in.
    const responses: Array<SyntheticMonitorResponse> | null =
      await SyntheticMonitor.execute({
        script: `await page.goto(${JSON.stringify(target)}, { timeout: 20000 }); return { data: "loaded" };`,
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
        retryCountOnError: 1,
      });

    expect(responses).toHaveLength(1);

    const reported: SyntheticMonitorResponse = responses![0]!;

    // What Playwright says, as it said it: the URL quoted, the value in it.
    expect(reported.scriptError).toMatch(
      new RegExp(
        `page\\.goto: net::ERR_[A-Z_]+ at https://${escapeRegExp(CLOSING_SITE)}/login`,
      ),
    );
    expect(reported.scriptError).toContain("navigating to");
    expect(formsLeftIn(reported.scriptError, secret).length).toBeGreaterThan(0);
    expect(reported.retryAttempts).toHaveLength(2);

    const read: ProbeMonitorResponse = readByServer(responses!, secret);
    const readRun: SyntheticMonitorResponse =
      read.syntheticMonitorResponse![0]!;

    expect(formsLeftIn(read, secret)).toEqual([]);

    // The rest is as Playwright wrote it: what failed, where, and which parameter.
    expect(readRun.scriptError).toMatch(
      new RegExp(
        `page\\.goto: net::ERR_[A-Z_]+ at https://${escapeRegExp(CLOSING_SITE)}/login\\?user=ops&token=`,
      ),
    );
    expect(readRun.scriptError).toContain(HIDDEN_SECRET_MARKER);
    expect(readRun.scriptError).toContain('waiting until "load"');

    for (const attempt of readRun.retryAttempts || []) {
      expect(attempt.scriptError).toMatch(/net::ERR_[A-Z_]+ at https:/);
      expect(attempt.scriptError).toContain(HIDDEN_SECRET_MARKER);
    }

    // The probe's own log lines say the script failed, never what with.
    expect(formsLeftIn(logged, secret)).toEqual([]);
    expect(
      logged.some((line: string): boolean => {
        return line.includes("Synthetic Monitor script failed");
      }),
    ).toBe(true);
  });

  test("a script's console output and returned data, and a page that echoes the URL, keep no form of the value", async () => {
    const secret: string = makeSecret(random);
    const target: string = `${echoUrl}/account/settings?api_key=${secret}`;

    const responses: Array<SyntheticMonitorResponse> | null =
      await SyntheticMonitor.execute({
        script: [
          `const secret = ${JSON.stringify(secret)};`,
          `console.log("signing in with " + secret);`,
          `await page.goto(${JSON.stringify(target)});`,
          `console.log("landed on " + page.url());`,
          `const said = await page.textContent("#said");`,
          `return { data: { said: said, url: page.url(), key: secret } };`,
        ].join("\n"),
        browserTypes: [BrowserType.Chromium],
        screenSizeTypes: [ScreenSizeType.Desktop],
      });

    expect(responses).toHaveLength(1);

    const reported: SyntheticMonitorResponse = responses![0]!;

    expect(reported.scriptError).toBeUndefined();
    // The page said the value back, and so did the script.
    expect(formsLeftIn(reported.result, secret).length).toBeGreaterThan(0);
    expect(formsLeftIn(reported.logMessages, secret).length).toBeGreaterThan(0);

    const read: ProbeMonitorResponse = readByServer(responses!, secret);
    const readRun: SyntheticMonitorResponse =
      read.syntheticMonitorResponse![0]!;

    expect(formsLeftIn(read, secret)).toEqual([]);

    // Everything else of the run is as it was.
    expect(readRun.logMessages).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`signing in with ${HIDDEN_SECRET_MARKER}`),
        expect.stringContaining(
          `landed on ${echoUrl}/account/settings?api_key=${HIDDEN_SECRET_MARKER}`,
        ),
      ]),
    );
    expect(JSON.stringify(readRun.result)).toContain(
      "No page at /account/settings?api_key=",
    );
    expect(readRun.screenshots).toEqual(reported.screenshots);
    expect(readRun.executionTimeInMS).toBe(reported.executionTimeInMS);
    expect(formsLeftIn(logged, secret)).toEqual([]);
  });
});
