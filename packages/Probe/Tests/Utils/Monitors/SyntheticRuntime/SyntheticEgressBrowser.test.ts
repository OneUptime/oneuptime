import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import dns from "dns";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import net, { AddressInfo } from "net";
import { chromium, firefox } from "playwright";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticBrowser, {
  SyntheticBrowserSession,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticBrowser";
import WorkerController from "../../../../Utils/Monitors/SyntheticRuntime/WorkerController";
import { SandboxExecutionResult } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import { MonitorEgressPolicy } from "../../../../Utils/Monitors/MonitorEgressGuardOptions";
import PrivateNetworkMonitorPolicy, {
  ResolvedPrivateNetworkMonitorPolicy,
} from "../../../../Utils/PrivateNetworkMonitorPolicy";
import FakeInternet, { FakeInternetRequest } from "./Fixtures/FakeInternet";

/*
 * GHSA-9rx7-vwfj-whp7, in the browser: a synthetic check's browser loaded
 * whatever its script pointed it at - a page, an iframe, an image, a fetch,
 * a WebSocket, a redirect - and the script read it back. A fix to the axios
 * bridge alone would have left all of that open.
 *
 * These checks run the way the probe runs them, in a real Chromium and a
 * real Firefox: SyntheticBrowser.start launches the browser with the
 * production options (the check's egress proxy as its only proxy) and
 * WorkerController runs the script in its sandbox. The egress guard is the
 * real one, with the policy each kind of probe hands its checks.
 *
 * The internet is FakeInternet: the check's outbound proxy (config.proxy),
 * which answers for made-up public and private addresses from servers on
 * loopback. The sensitive target is a server on loopback that no check may
 * reach: it counts every connection made to it, and must count none.
 */

jest.setTimeout(120_000);

const PUBLIC_SITE: string = "93.184.215.14";
const OTHER_PUBLIC_SITE: string = "93.184.215.34";
const PRIVATE_SITE: string = "10.23.45.67";
const WEBSOCKET_GUID: string = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function probePolicy(data: {
  configuredValue: string | undefined;
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
}): MonitorEgressPolicy {
  const resolved: ResolvedPrivateNetworkMonitorPolicy =
    PrivateNetworkMonitorPolicy.resolve(data);
  return {
    allowPrivateNetworkAddresses: resolved.allowed,
    privateNetworkHint: resolved.refusalHint,
  };
}

// A global probe of OneUptime Cloud (BILLING_ENABLED), whatever its operator set.
const HOSTED_GLOBAL_PROBE: MonitorEgressPolicy = probePolicy({
  configuredValue: "true",
  isAutoRegisteredGlobalProbe: true,
  isBillingEnabled: true,
});

// A project's own probe, which its operator opened to private networks.
const CUSTOM_PROBE_WITH_PRIVATE_ACCESS: MonitorEgressPolicy = probePolicy({
  configuredValue: "true",
  isAutoRegisteredGlobalProbe: false,
  isBillingEnabled: true,
});

const BROWSERS: Array<{
  browserType: BrowserType;
  executablePath: () => string;
}> = [
  {
    browserType: BrowserType.Chromium,
    executablePath: (): string => {
      return chromium.executablePath();
    },
  },
  {
    browserType: BrowserType.Firefox,
    executablePath: (): string => {
      return firefox.executablePath();
    },
  },
];

describe.each(BROWSERS)(
  "a $browserType check, through the probe's egress policy",
  ({
    browserType,
    executablePath,
  }: {
    browserType: BrowserType;
    executablePath: () => string;
  }) => {
    let fakeInternet: FakeInternet;
    let site: Server;
    let sitePort: number;
    let loopback: Server;
    let loopbackPort: number;
    let loopbackConnections: number = 0;

    beforeAll(async () => {
      // Readable from any origin: whatever reached it could be read back.
      loopback = http.createServer(
        (_request: IncomingMessage, response: ServerResponse): void => {
          response.writeHead(200, {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
          });
          response.end("loopback-sentinel");
        },
      );
      loopback.on("connection", (): void => {
        loopbackConnections++;
      });
      loopbackPort = await listen(loopback);

      site = http.createServer(
        (request: IncomingMessage, response: ServerResponse): void => {
          servePublicSite(request, response, loopbackPort);
        },
      );
      site.on(
        "upgrade",
        (request: IncomingMessage, socket: net.Socket): void => {
          acceptWebSocket(request, socket);
        },
      );
      sitePort = await listen(site);

      fakeInternet = new FakeInternet();
      await fakeInternet.start();
      for (const address of [PUBLIC_SITE, OTHER_PUBLIC_SITE, PRIVATE_SITE]) {
        fakeInternet.route(address, sitePort, sitePort);
      }
    });

    afterAll(async () => {
      await fakeInternet.stop();
      await close(site);
      await close(loopback);
    });

    async function check(
      code: string,
      policy: MonitorEgressPolicy = HOSTED_GLOBAL_PROBE,
    ): Promise<SandboxExecutionResult> {
      const session: SyntheticBrowserSession = await SyntheticBrowser.start({
        config: {
          code,
          browserType,
          screenSizeType: ScreenSizeType.Desktop,
          executablePath: executablePath(),
          viewport: { width: 800, height: 600 },
          timeoutInMs: 60_000,
          chromiumSandboxEnabled: false,
          proxy: { server: fakeInternet.url() },
          egressPolicy: policy,
          args: {},
        },
      });

      try {
        return await WorkerController.execute({
          browserContext: session.browserContext,
          page: session.page,
          code,
          browserType,
          screenSizeType: ScreenSizeType.Desktop,
          args: { site: sitePort, loopback: loopbackPort },
          timeoutInMs: 60_000,
          egress: session.egress,
        });
      } finally {
        await SyntheticBrowser.close({
          browser: session.browser,
          egress: session.egress,
        });
      }
    }

    test("still checks a public site: its page, scripts, images, frames, fetch, WebSocket, redirects and axios", async () => {
      const before: number = loopbackConnections;

      const result: SandboxExecutionResult = await check(`
        const site = "http://${PUBLIC_SITE}:" + args.site;
        const other = "http://${OTHER_PUBLIC_SITE}:" + args.site;
        const response = await page.goto(site + "/");
        await page.waitForFunction(() => window.scriptLoaded === true);
        const title = await page.title();
        const imageLoaded = await page.evaluate(() => {
          const image = document.getElementById("pub");
          return image.complete && image.naturalWidth > 0;
        });
        const frameText = await page.frameLocator("#frame").locator("#f").textContent();
        const api = await page.evaluate(async () => (await fetch("/api")).json());
        const message = await page.evaluate((url) => new Promise((resolve) => {
          const socket = new WebSocket(url);
          socket.onmessage = (event) => { resolve(event.data); socket.close(); };
          socket.onerror = () => resolve("websocket error");
        }), "ws://${PUBLIC_SITE}:" + args.site + "/ws");
        const redirected = await page.goto(
          site + "/redirect?to=" + encodeURIComponent(other + "/frame")
        );
        const viaAxios = (await axios.get(site + "/api")).data;
        return { data: {
          status: response.status(),
          title,
          imageLoaded,
          frameText,
          api,
          message,
          redirectedTo: redirected.url(),
          viaAxios,
        } };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          status: 200,
          title: "Public site",
          imageLoaded: true,
          frameText: "framed",
          api: { ok: true },
          message: "hello over websocket",
          redirectedTo: `http://${OTHER_PUBLIC_SITE}:${sitePort}/frame`,
          viaAxios: { ok: true },
        },
      });
      expect(result.logMessages).toEqual([]);
      expect(loopbackConnections).toBe(before);
    });

    test("cannot load a loopback page, by address, name or IPv6, over http or https", async () => {
      const before: number = loopbackConnections;

      const result: SandboxExecutionResult = await check(`
        const port = args.loopback;
        const out = {};
        const plain = await page.goto("http://127.0.0.1:" + port + "/secret");
        out.plain = plain.status();
        out.plainBody = await page.textContent("body");
        out.localhost = (await page.goto("http://localhost:" + port + "/secret")).status();
        out.ipv6 = (await page.goto("http://[::1]:" + port + "/secret")).status();
        out.mapped = (await page.goto("http://[::ffff:127.0.0.1]:" + port + "/secret")).status();
        try {
          await page.goto("https://127.0.0.1:" + port + "/secret");
          out.https = "loaded";
        } catch (error) {
          out.https = "failed";
        }
        return { data: out };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          plain: 403,
          plainBody: `Monitor target host 127.0.0.1 is not allowed: loopback address.`,
          localhost: 502,
          ipv6: 403,
          mapped: 403,
          https: "failed",
        },
      });
      expect(JSON.stringify(result)).not.toContain("loopback-sentinel");
      expect(loopbackConnections).toBe(before);
      // What the browser only saw as a failed tunnel is said in the log.
      expect(result.logMessages).toContain(
        `The probe did not send the browser's request to 127.0.0.1:${loopbackPort}: Monitor target host 127.0.0.1 is not allowed: loopback address.`,
      );
    });

    test("cannot read the cloud metadata endpoint, with the headers it asks for or not", async () => {
      const result: SandboxExecutionResult = await check(`
        await page.setExtraHTTPHeaders({ "Metadata-Flavor": "Google" });
        const gcp = await page.goto(
          "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token"
        );
        const gcpBody = await page.textContent("body");
        const azure = await page.goto("http://169.254.169.254/metadata/instance?api-version=2021-02-01");
        const alibaba = await page.goto("http://100.100.100.200/latest/meta-data/");
        return { data: {
          gcp: gcp.status(),
          gcpBody,
          azure: azure.status(),
          alibaba: alibaba.status(),
        } };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          gcp: 403,
          gcpBody:
            "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
          azure: 403,
          alibaba: 403,
        },
      });
      expect(
        fakeInternet.requests.some((seen: FakeInternetRequest) => {
          return seen.url.includes("169.254") || seen.url.includes("100.100");
        }),
      ).toBe(false);
    });

    test("cannot reach loopback, metadata or private targets from a public page's images, frames, fetch, XHR, WebSocket, beacon or popup", async () => {
      const before: number = loopbackConnections;
      const seenBefore: number = fakeInternet.requests.length;

      const result: SandboxExecutionResult = await check(`
        await page.goto("http://${PUBLIC_SITE}:" + args.site + "/attack");
        await page.waitForFunction(() => window.attacksSent === true);
        await page.waitForTimeout(1500);
        return { data: await page.evaluate(() => window.attackResults) };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          // A no-cors fetch settles on the proxy's refusal as an opaque answer.
          noCorsFetch: "opaque",
          fetch: "failed",
          xhr: "failed",
          websocket: "failed",
        },
      });
      expect(loopbackConnections).toBe(before);
      const sent: Array<string> = fakeInternet.requests
        .slice(seenBefore)
        .map((seen: FakeInternetRequest) => {
          return seen.url;
        });
      expect(sent).toContain(`http://${PUBLIC_SITE}:${sitePort}/attack`);
      /*
       * None of what the page pointed elsewhere went out. (The browser's own
       * background requests - Chromium asks Google for the time - go through
       * the egress proxy too, as public addresses, so only the page's
       * targets are looked for here.)
       */
      expect(
        sent.filter((url: string) => {
          return ["127.0.0.1", "[::1]", "169.254.169.254", "10.0.0.5"].some(
            (target: string) => {
              return url.includes(target);
            },
          );
        }),
      ).toEqual([]);
      expect(result.logMessages).toEqual(
        expect.arrayContaining([
          `The probe did not send the browser's request to 127.0.0.1:${loopbackPort}: Monitor target host 127.0.0.1 is not allowed: loopback address.`,
          "The probe did not send the browser's request to 169.254.169.254:80: Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
        ]),
      );
    });

    test("does not follow a public site's redirect to loopback or the metadata endpoint", async () => {
      const before: number = loopbackConnections;

      const result: SandboxExecutionResult = await check(`
        const site = "http://${PUBLIC_SITE}:" + args.site;
        const toLoopback = await page.goto(
          site + "/redirect?to=" + encodeURIComponent("http://127.0.0.1:" + args.loopback + "/secret")
        );
        const loopbackBody = await page.textContent("body");
        const toMetadata = await page.goto(
          site + "/redirect?to=" + encodeURIComponent("http://169.254.169.254/latest/meta-data/")
        );
        const fetched = await page.evaluate(async (url) => {
          try { return (await fetch(url)).status; } catch (error) { return "failed"; }
        }, site + "/redirect?to=" + encodeURIComponent("http://127.0.0.1:" + args.loopback + "/secret"));
        let viaAxios;
        try {
          await axios.get(site + "/redirect?to=" + encodeURIComponent("http://127.0.0.1:" + args.loopback + "/secret"));
          viaAxios = "reached";
        } catch (error) {
          viaAxios = error.message;
        }
        return { data: {
          toLoopback: toLoopback.status(),
          loopbackBody,
          toMetadata: toMetadata.status(),
          fetched,
          viaAxios,
        } };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          toLoopback: 403,
          loopbackBody:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
          toMetadata: 403,
          // The proxy's refusal carries no CORS header: the page reads nothing.
          fetched: "failed",
          viaAxios:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
        },
      });
      expect(loopbackConnections).toBe(before);
    });

    test("cannot reach a name that resolves to a private address on a global probe, and is told nothing about it", async () => {
      const realLookup: typeof dns.promises.lookup = dns.promises.lookup.bind(
        dns.promises,
      );
      const lookup: ReturnType<typeof jest.spyOn> = jest
        .spyOn(dns.promises, "lookup")
        .mockImplementation((async (hostname: string, options: unknown) => {
          if (hostname === "kubernetes.default.svc") {
            return [{ address: PRIVATE_SITE, family: 4 }];
          }
          return await (realLookup as (...args: Array<unknown>) => unknown)(
            hostname,
            options,
          );
        }) as never);

      try {
        const result: SandboxExecutionResult = await check(`
          const response = await page.goto("http://kubernetes.default.svc:" + args.site + "/api");
          return { data: { status: response.status(), body: await page.textContent("body") } };
        `);

        expect(result.returnValue).toEqual({
          data: {
            status: 502,
            body: "Monitor target host kubernetes.default.svc could not be reached.",
          },
        });
        expect(
          fakeInternet.requests.some((seen: FakeInternetRequest) => {
            return seen.url.includes(PRIVATE_SITE);
          }),
        ).toBe(false);
      } finally {
        lookup.mockRestore();
      }
    });

    test("pins a name to the address it was approved at, though DNS rebinds it to loopback", async () => {
      const before: number = loopbackConnections;
      let asked: number = 0;
      const realLookup: typeof dns.promises.lookup = dns.promises.lookup.bind(
        dns.promises,
      );
      const lookup: ReturnType<typeof jest.spyOn> = jest
        .spyOn(dns.promises, "lookup")
        .mockImplementation((async (hostname: string, options: unknown) => {
          if (hostname === "rebind.example.test") {
            asked++;
            return [
              { address: asked === 1 ? PUBLIC_SITE : "127.0.0.1", family: 4 },
            ];
          }
          return await (realLookup as (...args: Array<unknown>) => unknown)(
            hostname,
            options,
          );
        }) as never);

      try {
        const result: SandboxExecutionResult = await check(`
          const site = "http://rebind.example.test:" + args.site;
          const first = await page.goto(site + "/");
          const again = await page.evaluate(async () => (await fetch("/api")).json());
          const viaAxios = (await axios.get(site + "/api")).data;
          return { data: { first: first.status(), again, viaAxios } };
        `);

        expect(result.scriptError).toBeUndefined();
        expect(result.returnValue).toEqual({
          data: { first: 200, again: { ok: true }, viaAxios: { ok: true } },
        });
        expect(asked).toBe(1);
        expect(loopbackConnections).toBe(before);
      } finally {
        lookup.mockRestore();
      }
    });

    test("holds a page's service worker to the policy too", async () => {
      const before: number = loopbackConnections;
      const realLookup: typeof dns.promises.lookup = dns.promises.lookup.bind(
        dns.promises,
      );
      /*
       * A service worker needs a secure context: a *.localhost origin is one
       * on a test machine. Its name is answered with the public site's
       * address, which the fake internet serves.
       */
      const lookup: ReturnType<typeof jest.spyOn> = jest
        .spyOn(dns.promises, "lookup")
        .mockImplementation((async (hostname: string, options: unknown) => {
          if (hostname === "service-worker.localhost") {
            return [{ address: PUBLIC_SITE, family: 4 }];
          }
          return await (realLookup as (...args: Array<unknown>) => unknown)(
            hostname,
            options,
          );
        }) as never);

      try {
        // The worker fetches as it activates and files what it read in Cache Storage.
        const result: SandboxExecutionResult = await check(`
          await page.goto("http://service-worker.localhost:" + args.site + "/sw-page");
          const registered = await page.evaluate(() => window.serviceWorkerReady);
          await page.waitForFunction(async () =>
            Boolean(await (await caches.open("egress")).match("/worker-result"))
          );
          const answer = await page.evaluate(async () =>
            (await (await caches.open("egress")).match("/worker-result")).text()
          );
          return { data: { registered, answer } };
        `);

        expect(result.scriptError).toBeUndefined();
        expect(result.returnValue).toEqual({
          data: {
            registered: true,
            // The worker's own fetch to loopback reached nothing it could read.
            answer: "worker read nothing from loopback",
          },
        });
        expect(loopbackConnections).toBe(before);
      } finally {
        lookup.mockRestore();
      }
    });

    test("reaches private addresses on a probe whose operator allowed them, and still never loopback", async () => {
      const before: number = loopbackConnections;

      const result: SandboxExecutionResult = await check(
        `
          const internal = await page.goto("http://${PRIVATE_SITE}:" + args.site + "/");
          const internalTitle = await page.title();
          const loopbackStatus = (await page.goto("http://127.0.0.1:" + args.loopback + "/")).status();
          const metadataStatus = (await page.goto("http://169.254.169.254/")).status();
          return { data: {
            internal: internal.status(),
            internalTitle,
            loopbackStatus,
            metadataStatus,
          } };
        `,
        CUSTOM_PROBE_WITH_PRIVATE_ACCESS,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          internal: 200,
          internalTitle: "Public site",
          loopbackStatus: 403,
          metadataStatus: 403,
        },
      });
      expect(loopbackConnections).toBe(before);
    });

    test("refuses a private address on a global probe, saying where a private one can be deployed", async () => {
      const result: SandboxExecutionResult = await check(`
        const response = await page.goto("http://${PRIVATE_SITE}:" + args.site + "/");
        return { data: { status: response.status(), body: await page.textContent("body") } };
      `);

      expect(result.returnValue).toEqual({
        data: {
          status: 403,
          body: `Monitor target host ${PRIVATE_SITE} is not allowed: private network address. Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.`,
        },
      });
    });
  },
);

function servePublicSite(
  request: IncomingMessage,
  response: ServerResponse,
  loopbackPort: number,
): void {
  const url: URL = new URL(request.url || "/", "http://site.invalid");
  const host: string = request.headers.host || "";
  const port: string = host.slice(host.lastIndexOf(":") + 1);

  switch (url.pathname) {
    case "/":
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Public site</title>
        <img id="pub" src="http://${OTHER_PUBLIC_SITE}:${port}/pixel.png">
        <script src="http://${OTHER_PUBLIC_SITE}:${port}/script.js"></script>
        <iframe id="frame" src="http://${OTHER_PUBLIC_SITE}:${port}/frame"></iframe>`);
      return;
    case "/pixel.png":
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      return;
    case "/script.js":
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end("window.scriptLoaded = true;");
      return;
    case "/frame":
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<!doctype html><title>frame</title><p id="f">framed</p>');
      return;
    case "/api":
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    case "/redirect":
      response.writeHead(302, {
        Location: url.searchParams.get("to") || "/",
        "Access-Control-Allow-Origin": "*",
      });
      response.end();
      return;
    case "/sw-page":
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Service worker</title><script>
        window.serviceWorkerReady = navigator.serviceWorker
          .register("/sw.js")
          .then(() => navigator.serviceWorker.ready)
          .then(() => true, (error) => "not registered: " + error.message);
      </script>`);
      return;
    case "/sw.js":
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(`
        self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", (event) => {
          event.waitUntil(
            fetch("http://127.0.0.1:${loopbackPort}/from-the-worker")
              .then((answer) => answer.text())
              .then(
                (text) => text.includes("loopback-sentinel")
                  ? "worker read loopback" : "worker read nothing from loopback",
                () => "worker read nothing from loopback",
              )
              .then((result) => caches.open("egress")
                .then((cache) => cache.put("/worker-result", new Response(result))))
          );
        });
      `);
      return;
    case "/attack":
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>Attack</title>
        <img src="http://127.0.0.1:${loopbackPort}/image">
        <img src="http://[::1]:${loopbackPort}/image">
        <iframe src="http://169.254.169.254/latest/meta-data/"></iframe>
        <iframe src="http://127.0.0.1:${loopbackPort}/frame"></iframe>
        <link rel="prefetch" href="http://127.0.0.1:${loopbackPort}/prefetch">
        <script>
          window.attackResults = {};
          const settle = (name, value) => { window.attackResults[name] = value; };
          fetch("http://127.0.0.1:${loopbackPort}/no-cors", { mode: "no-cors" })
            .then((answer) => settle("noCorsFetch", answer.type), () => settle("noCorsFetch", "failed"));
          fetch("http://127.0.0.1:${loopbackPort}/fetch")
            .then(() => settle("fetch", "read"), () => settle("fetch", "failed"));
          const xhr = new XMLHttpRequest();
          xhr.open("GET", "http://10.0.0.5/xhr");
          xhr.onload = () => settle("xhr", "loaded");
          xhr.onerror = () => settle("xhr", "failed");
          xhr.send();
          const socket = new WebSocket("ws://127.0.0.1:${loopbackPort}/ws");
          socket.onopen = () => settle("websocket", "open");
          socket.onerror = () => settle("websocket", "failed");
          navigator.sendBeacon("http://127.0.0.1:${loopbackPort}/beacon", "x");
          window.open("http://127.0.0.1:${loopbackPort}/popup");
          window.attacksSent = true;
        </script>`);
      return;
    default:
      response.writeHead(404);
      response.end();
  }
}

// Just enough of RFC 6455 to open a WebSocket and send one text message.
function acceptWebSocket(request: IncomingMessage, socket: net.Socket): void {
  const key: string = String(request.headers["sec-websocket-key"] || "");
  const accept: string = crypto
    .createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64");
  const message: Buffer = Buffer.from("hello over websocket", "utf8");

  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
  socket.on("error", (): void => {
    // The browser closes the socket once it has the message.
  });
  // An HTTP server's sockets stay half-open: close ours when the browser does.
  socket.on("end", (): void => {
    socket.end();
  });
}

const serverSockets: WeakMap<Server, Set<net.Socket>> = new WeakMap<
  Server,
  Set<net.Socket>
>();

async function listen(server: Server): Promise<number> {
  const sockets: Set<net.Socket> = new Set<net.Socket>();
  serverSockets.set(server, sockets);
  server.on("connection", (socket: net.Socket): void => {
    sockets.add(socket);
    socket.once("close", (): void => {
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as AddressInfo).port;
}

// Upgraded sockets are not the server's to close: every one is destroyed.
async function close(server: Server): Promise<void> {
  for (const socket of serverSockets.get(server) || []) {
    socket.destroy();
  }
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
}
