import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import {
  LocalHttpServer,
  PROXY_HOST_NAME,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import { afterEach, describe, expect, test } from "@jest/globals";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

/*
 * A PROBE'S OWN PROXY AGENTS ARE ITS REQUEST'S ROUTE, WITH NO PROXY OF
 * AXIOS'S ON TOP (issue #10442).
 *
 * The probe hands its calls to the server the agents of its own proxy
 * (ProxyConfig: HTTP_PROXY_URL / HTTPS_PROXY_URL, or HTTP_PROXY /
 * HTTPS_PROXY). Axios still read HTTPS_PROXY from the environment as well:
 * for https it put a tunnel of its own in place of the probe's agent and
 * signed in to that proxy with its password percent-encoded, and for http
 * it rewrote the request for a proxy the agent proxied once more. The API
 * client now turns axios's proxy off for a request that brings agents of
 * its own (OutboundProxyAgents.routeAxiosRequest), so the probe's agents -
 * which decode the user name and password - route it alone.
 */

clearOutboundProxyEnvironmentForEachTest();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(() => {
  OutboundProxyAgents.destroySharedAgents();
});

async function settle(sending: Promise<unknown>): Promise<void> {
  try {
    await sending;
  } catch {
    // The probe's proxy refuses every tunnel here.
  }
}

describe("a probe request on its own proxy agents", () => {
  test("over https, is tunnelled by the probe's proxy alone, signed in with its real password", async () => {
    const probeProxy: LocalHttpServer = await serve({ name: "probe proxy" });
    const environmentProxy: LocalHttpServer = await serve({
      name: "environment proxy",
    });
    process.env["HTTPS_PROXY"] = `http://${PROXY_HOST_NAME}:${environmentProxy.port}`;
    const httpsAgent: HttpsProxyAgent<string> = new HttpsProxyAgent(
      proxyUrlWithCredentials(probeProxy.port, RESERVED_CHARACTER_CREDENTIALS),
    );

    await settle(
      API.post<JSONObject>({
        url: URL.fromString("https://ingest.example.test/probe/heartbeat"),
        data: {},
        options: { httpsAgent: httpsAgent, timeout: 5000 },
      }),
    );
    httpsAgent.destroy();

    expect(probeProxy.connects).toEqual(["ingest.example.test:443"]);
    expect(probeProxy.connectCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
    expect(environmentProxy.isUntouched).toBe(true);
  });

  test("over http, is forwarded by the probe's proxy alone, signed in with its real password", async () => {
    const probeProxy: LocalHttpServer = await serve({ name: "probe proxy" });
    const environmentProxy: LocalHttpServer = await serve({
      name: "environment proxy",
    });
    process.env["HTTP_PROXY"] = `http://${PROXY_HOST_NAME}:${environmentProxy.port}`;
    const httpAgent: HttpProxyAgent<string> = new HttpProxyAgent(
      proxyUrlWithCredentials(probeProxy.port, RESERVED_CHARACTER_CREDENTIALS),
    );

    await API.post<JSONObject>({
      url: URL.fromString("http://ingest.example.test/probe/heartbeat"),
      data: {},
      options: { httpAgent: httpAgent, timeout: 5000 },
    });
    httpAgent.destroy();

    expect(
      probeProxy.requests.map((seen: { url: string }) => {
        return seen.url;
      }),
    ).toEqual(["http://ingest.example.test/probe/heartbeat"]);
    expect(probeProxy.requestCredentials).toEqual([
      signedInAs(RESERVED_CHARACTER_CREDENTIALS),
    ]);
    expect(environmentProxy.isUntouched).toBe(true);
  });
});
