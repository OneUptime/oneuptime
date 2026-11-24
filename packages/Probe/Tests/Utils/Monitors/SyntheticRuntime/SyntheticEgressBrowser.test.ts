import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import dgram from "dgram";
import dns from "dns";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import net, { AddressInfo } from "net";
import { LaunchOptions, chromium, firefox } from "playwright";
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
import { approveOnLoopback } from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
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
      extraArgs: Record<string, number> = {},
      // Hosts the egress proxy reaches directly, as NO_PROXY names them.
      noProxy?: string,
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
          proxy: {
            server: fakeInternet.url(),
            ...(noProxy ? { bypass: noProxy } : {}),
          },
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
          args: { site: sitePort, loopback: loopbackPort, ...extraArgs },
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

      // The script is told why, in the egress proxy's words, as axios tells it.
      const result: SandboxExecutionResult = await check(`
        const port = args.loopback;
        const attempt = async (url) => {
          try {
            return "loaded " + (await page.goto(url)).status();
          } catch (error) {
            return error.message;
          }
        };
        return { data: {
          plain: await attempt("http://127.0.0.1:" + port + "/secret"),
          localhost: await attempt("http://localhost:" + port + "/secret"),
          ipv6: await attempt("http://[::1]:" + port + "/secret"),
          mapped: await attempt("http://[::ffff:127.0.0.1]:" + port + "/secret"),
          // Last: see the redirect test below.
          https: await attempt("https://127.0.0.1:" + port + "/secret"),
        } };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          plain:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
          localhost: "Monitor target host localhost could not be reached.",
          ipv6: "Monitor target host ::1 is not allowed: loopback address.",
          mapped:
            "Monitor target host ::ffff:7f00:1 is not allowed: loopback address.",
          https:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
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
        const attempt = async (url) => {
          try {
            return "loaded " + (await page.goto(url)).status();
          } catch (error) {
            return error.message;
          }
        };
        await page.setExtraHTTPHeaders({ "Metadata-Flavor": "Google" });
        return { data: {
          gcp: await attempt(
            "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token"
          ),
          azure: await attempt("http://169.254.169.254/metadata/instance?api-version=2021-02-01"),
          alibaba: await attempt("http://100.100.100.200/latest/meta-data/"),
        } };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          gcp: "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
          azure:
            "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
          alibaba:
            "Monitor target host 100.100.100.200 is not allowed: cloud metadata address.",
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
        const attempt = async (url) => {
          try {
            return "loaded " + (await page.goto(url)).status();
          } catch (error) {
            return error.message;
          }
        };
        const toLoopback = await attempt(
          site + "/redirect?to=" + encodeURIComponent("http://127.0.0.1:" + args.loopback + "/secret")
        );
        const toMetadata = await attempt(
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
        /*
         * Last: Chromium commits its error page for a failed navigation a
         * moment after reporting the failure, and a navigation started in
         * that moment is interrupted by it, whatever proxy is in use.
         */
        const toLoopbackOverHttps = await attempt(
          site + "/redirect?to=" + encodeURIComponent("https://127.0.0.1:" + args.loopback + "/secret")
        );
        return { data: {
          toLoopback,
          toLoopbackOverHttps,
          toMetadata,
          fetched,
          viaAxios,
        } };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          toLoopback:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
          toLoopbackOverHttps:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
          toMetadata:
            "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
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
          const attempt = async (url) => {
            try {
              return "loaded " + (await page.goto(url)).status();
            } catch (error) {
              return error.message;
            }
          };
          return { data: {
            http: await attempt("http://kubernetes.default.svc:" + args.site + "/api"),
            https: await attempt("https://kubernetes.default.svc/api"),
          } };
        `);

        // The same words as for a name that does not exist at all.
        expect(result.returnValue).toEqual({
          data: {
            http: "Monitor target host kubernetes.default.svc could not be reached.",
            https:
              "Monitor target host kubernetes.default.svc could not be reached.",
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
          const attempt = async (url) => {
            try {
              return "loaded " + (await page.goto(url)).status();
            } catch (error) {
              return error.message;
            }
          };
          const internal = await page.goto("http://${PRIVATE_SITE}:" + args.site + "/");
          const internalTitle = await page.title();
          const loopback = await attempt("http://127.0.0.1:" + args.loopback + "/");
          const metadata = await attempt("http://169.254.169.254/");
          return { data: {
            internal: internal.status(),
            internalTitle,
            loopback,
            metadata,
          } };
        `,
        CUSTOM_PROBE_WITH_PRIVATE_ACCESS,
      );

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          internal: 200,
          internalTitle: "Public site",
          loopback:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
          metadata:
            "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
        },
      });
      expect(loopbackConnections).toBe(before);
    });

    test("refuses a private address on a global probe, saying where a private one can be deployed", async () => {
      const result: SandboxExecutionResult = await check(`
        await page.goto("http://${PRIVATE_SITE}:" + args.site + "/");
        return { data: "loaded" };
      `);

      // Not caught: the check fails with the probe's reason as its error.
      expect(result.returnValue).toBeUndefined();
      expect(result.scriptError).toBe(
        `Monitor target host ${PRIVATE_SITE} is not allowed: private network address. Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.`,
      );
    });

    /*
     * WebRTC is the one way a page opens UDP, which no HTTP proxy carries.
     * A page's STUN and TURN servers, and a remote peer's host candidate,
     * are all on loopback here; the listeners count what reaches them. In
     * the full Chrome for Testing build the probe runs, the switch spelled
     * for chrome-headless-shell alone left about a hundred datagrams going
     * to them in six seconds.
     */
    test("sends no WebRTC traffic around the proxy: STUN and TURN servers and a peer on loopback get nothing", async () => {
      let datagrams: number = 0;
      let tcpConnections: number = 0;
      const udp: dgram.Socket = dgram.createSocket("udp4");
      udp.on("message", (): void => {
        datagrams++;
      });
      await new Promise<void>((resolve: () => void): void => {
        udp.bind(0, "127.0.0.1", resolve);
      });
      const tcp: Server = http.createServer();
      tcp.on("connection", (socket: net.Socket): void => {
        tcpConnections++;
        socket.destroy();
      });
      const tcpPort: number = await listen(tcp);

      try {
        const result: SandboxExecutionResult = await check(
          `
            const outcome = await page.evaluate(async ({ udpPort, tcpPort }) => {
              const caller = new RTCPeerConnection({
                iceServers: [
                  { urls: "stun:127.0.0.1:" + udpPort },
                  { urls: "turn:127.0.0.1:" + udpPort + "?transport=udp", username: "u", credential: "p" },
                  { urls: "turn:127.0.0.1:" + tcpPort + "?transport=tcp", username: "u", credential: "p" },
                ],
              });
              const callee = new RTCPeerConnection();
              caller.createDataChannel("probe");
              const offer = await caller.createOffer();
              await caller.setLocalDescription(offer);
              await callee.setRemoteDescription(offer);
              const answer = await callee.createAnswer();
              await callee.setLocalDescription(answer);
              await caller.setRemoteDescription(answer);
              for (const candidate of [
                "candidate:1 1 udp 2122260223 127.0.0.1 " + udpPort + " typ host",
                "candidate:2 1 tcp 1518280447 127.0.0.1 " + tcpPort + " typ host tcptype passive",
              ]) {
                try {
                  await caller.addIceCandidate({ candidate, sdpMid: "0", sdpMLineIndex: 0 });
                } catch (error) {
                  // A candidate the browser refuses to take sends nothing either.
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 6000));
              caller.close();
              callee.close();
              return "settled";
            }, { udpPort: args.udp, tcpPort: args.tcp });
            return { data: outcome };
          `,
          HOSTED_GLOBAL_PROBE,
          { udp: (udp.address() as AddressInfo).port, tcp: tcpPort },
        );

        expect(result.scriptError).toBeUndefined();
        expect(result.returnValue).toEqual({ data: "settled" });
        expect({ datagrams, tcpConnections }).toEqual({
          datagrams: 0,
          tcpConnections: 0,
        });
      } finally {
        udp.close();
        await close(tcp);
      }
    });

    /*
     * Firefox reads a bypass entry as a bare suffix (Juggler's
     * host.endsWith(entry)) and resolves a bypassed name itself, so with the
     * runtime's controller host on its list, any name ending in it that the
     * probe's resolver answers for - a search-domain wildcard, /etc/hosts -
     * went straight there. network.dns.localDomains stands in for such a
     * resolver here, answering the look-alike name with loopback.
     */
    test("sends a host that only ends in the runtime's own name through the egress proxy", async () => {
      const before: number = loopbackConnections;
      const lookAlike: string = "x.synthetic-runtime.oneuptime.invalid";
      const launchFirefox: typeof firefox.launch = firefox.launch.bind(firefox);
      const launch: ReturnType<typeof jest.spyOn> = jest
        .spyOn(firefox, "launch")
        .mockImplementation((async (options?: LaunchOptions) => {
          return await launchFirefox({
            ...options,
            firefoxUserPrefs: {
              ...options?.firefoxUserPrefs,
              "network.dns.localDomains": lookAlike,
            },
          });
        }) as never);

      try {
        const result: SandboxExecutionResult = await check(`
          try {
            const response = await page.goto("http://${lookAlike}:" + args.loopback + "/secret");
            return { data: "loaded " + response.status() + " " + (await page.textContent("body")) };
          } catch (error) {
            return { data: error.message };
          }
        `);

        expect(result.returnValue).toEqual({
          data: `Monitor target host ${lookAlike} could not be reached.`,
        });
        expect(loopbackConnections).toBe(before);
      } finally {
        launch.mockRestore();
      }
    });

    /*
     * Every request goes to one proxy, so a browser's limit on connections
     * to a proxy is a limit on the whole page. Firefox's default (32) left 60
     * slow requests to 60 hosts taking twice as long as in Chromium.
     */
    test("opens as many connections at once as the page has hosts to reach", async () => {
      const hosts: number = 48;
      let inFlight: number = 0;
      let mostInFlight: number = 0;
      const slow: Server = http.createServer(
        (_request: IncomingMessage, response: ServerResponse): void => {
          inFlight++;
          mostInFlight = Math.max(mostInFlight, inFlight);
          setTimeout((): void => {
            inFlight--;
            response.writeHead(200, {
              "Content-Type": "text/plain",
              "Access-Control-Allow-Origin": "*",
            });
            response.end("ok");
          }, 2_000);
        },
      );
      const slowPort: number = await listen(slow);

      for (let index: number = 1; index <= hosts; index++) {
        fakeInternet.route(`93.184.216.${index}`, slowPort, slowPort);
      }

      try {
        const result: SandboxExecutionResult = await check(
          `
            await page.setContent("<!doctype html><title>Many hosts</title>");
            const answers = await page.evaluate(async ({ hosts, port }) => {
              const all = [];
              for (let index = 1; index <= hosts; index++) {
                all.push(
                  fetch("http://93.184.216." + index + ":" + port + "/slow")
                    .then((answer) => answer.text(), () => "failed"),
                );
              }
              return await Promise.all(all);
            }, { hosts: args.hosts, port: args.slow });
            return { data: answers.filter((answer) => answer === "ok").length };
          `,
          HOSTED_GLOBAL_PROBE,
          { hosts, slow: slowPort },
        );

        expect(result.scriptError).toBeUndefined();
        expect(result.returnValue).toEqual({ data: hosts });
        expect(mostInFlight).toBe(hosts);
      } finally {
        await close(slow);
      }
    });

    /*
     * The page can read the probe's mark: after a refused navigation it sits
     * at the refused origin, and the egress proxy answers its own fetch
     * there. A site the script points at can then echo the mark on its own
     * page; that page loaded, and is not reported as a refusal.
     */
    test("does not take a site's page for the probe's refusal, though the page read the probe's mark", async () => {
      const result: SandboxExecutionResult = await check(`
        let refusal;
        try {
          await page.goto("http://127.0.0.1:" + args.loopback + "/refused");
          refusal = "loaded";
        } catch (error) {
          refusal = error.message;
        }
        const marker = await page.evaluate(async () => {
          try {
            return (await fetch(location.href)).headers.get("x-oneuptime-egress-refusal");
          } catch (error) {
            return null;
          }
        });
        const echoed = await page.goto(
          "http://${PUBLIC_SITE}:" + args.site + "/echo?m=" + encodeURIComponent(marker || "")
        );
        return { data: {
          refusal,
          markerRead: typeof marker === "string" && marker.length > 0,
          echoed: echoed.status() + " " + (await page.textContent("body")),
        } };
      `);

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        data: {
          refusal:
            "Monitor target host 127.0.0.1 is not allowed: loopback address.",
          markerRead: true,
          echoed: "200 the site's own page",
        },
      });
    });

    /*
     * Only the navigation's own request is told in the proxy's words. Here
     * the page loads, an image on its host gets an answer the proxy cannot
     * relay, and another never answers: the navigation times out, and says
     * so, rather than taking the image's failure for its own.
     */
    test("reports a navigation that timed out as a timeout, though a resource on its host failed at the proxy", async () => {
      const asked: Array<string> = [];
      const sockets: Set<net.Socket> = new Set<net.Socket>();
      const flaky: net.Server = net.createServer((socket: net.Socket): void => {
        sockets.add(socket);
        socket.on("error", (): void => {
          // The proxy gave up on it.
        });
        let received: string = "";
        socket.on("data", (chunk: Buffer): void => {
          received += chunk.toString("latin1");
          if (!received.includes("\r\n\r\n")) {
            return;
          }
          const path: string = received.split(" ")[1] || "";
          received = "";
          asked.push(path);
          if (path === "/page") {
            const body: string =
              '<!doctype html><title>Flaky</title><img src="/bad"><img src="/hang">';
            socket.write(
              `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
            );
          } else if (path === "/bad") {
            socket.end("HTTP/1.1 099 Odd\r\nContent-Length: 0\r\n\r\n");
          }
          // "/hang" is never answered: the page never finishes loading.
        });
      });
      await new Promise<void>((resolve: () => void): void => {
        flaky.listen(0, "127.0.0.1", resolve);
      });
      // A site the proxy reaches directly; loopback stands in for its public address.
      approveOnLoopback({ "flaky.example.test": ["127.0.0.1"] });

      try {
        const result: SandboxExecutionResult = await check(
          `
            try {
              await page.goto("http://flaky.example.test:" + args.flaky + "/page", { timeout: 4000 });
              return { data: "loaded" };
            } catch (error) {
              return { data: error.message };
            }
          `,
          HOSTED_GLOBAL_PROBE,
          { flaky: (flaky.address() as AddressInfo).port },
          "flaky.example.test",
        );
        const message: string = String(
          (result.returnValue as { data: unknown }).data,
        );

        expect(asked).toEqual(expect.arrayContaining(["/page", "/bad"]));
        expect(message).toContain("Timeout 4000ms exceeded");
        expect(message).not.toContain("could not read");
      } finally {
        jest.restoreAllMocks();
        for (const socket of sockets) {
          socket.destroy();
        }
        await new Promise<void>((resolve: () => void): void => {
          flaky.close((): void => {
            resolve();
          });
        });
      }
    });

    test("never falls back to a direct connection once the egress proxy is gone", async () => {
      const before: number = loopbackConnections;
      const session: SyntheticBrowserSession = await SyntheticBrowser.start({
        config: {
          code: "",
          browserType,
          screenSizeType: ScreenSizeType.Desktop,
          executablePath: executablePath(),
          viewport: { width: 800, height: 600 },
          timeoutInMs: 60_000,
          chromiumSandboxEnabled: false,
          egressPolicy: HOSTED_GLOBAL_PROBE,
          args: {},
        },
      });

      try {
        await session.egress.close();

        const answers: Array<string> = await session.page.evaluate(
          async (port: number): Promise<Array<string>> => {
            const results: Array<string> = [];
            for (const url of [
              `http://127.0.0.1:${port}/direct`,
              `http://localhost:${port}/direct`,
            ]) {
              try {
                results.push(await (await fetch(url)).text());
              } catch {
                results.push("failed");
              }
            }
            return results;
          },
          loopbackPort,
        );

        expect(answers).toEqual(["failed", "failed"]);
        expect(loopbackConnections).toBe(before);
      } finally {
        await SyntheticBrowser.close({
          browser: session.browser,
          egress: session.egress,
        });
      }
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
    case "/echo":
      // A site writing the probe's mark on its own page.
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "x-oneuptime-egress-refusal": url.searchParams.get("m") || "",
      });
      response.end(
        "<!doctype html><title>Echo</title><p>the site's own page</p>",
      );
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
