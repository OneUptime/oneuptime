import AgentClient from "../../Services/RunnerClient";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import {
  LocalHttpServer,
  PLAIN_CREDENTIALS,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import { afterEach, describe, expect, test } from "@jest/globals";
import http from "http";

/*
 * THE RUNNER REACHES THE SERVER THROUGH ITS OUTBOUND PROXY WITH THE PROXY'S
 * REAL USER NAME AND PASSWORD (issue #10442).
 *
 * The Runner's client (RunnerClient) sent with an axios instance that left
 * the proxy to axios, which signed in to a proxy with its password as the
 * URL percent-encodes it: a Runner behind a proxy whose password holds an
 * @, a : or a % could not reach the server at all. Its instance is routed
 * by an interceptor now (OutboundProxyAgents.routeAxiosRequest). These send
 * real requests to a proxy on this machine (OutboundProxyFixture); the
 * Runner's server is http://localhost (Tests/jest.setup.ts).
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

describe("the Runner's calls to the server, behind an outbound proxy", () => {
  test.each([
    ["with @, : and % in its password", RESERVED_CHARACTER_CREDENTIALS],
    ["with no character a URL reserves", PLAIN_CREDENTIALS],
  ])(
    "go through HTTP_PROXY, signed in with its real user name and password, %s",
    async (_kind: string, credentials: typeof PLAIN_CREDENTIALS) => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        credentials,
      );

      expect(await AgentClient.disconnect()).toBe(true);

      expect(
        proxy.requests.map((seen: { method: string; url: string }) => {
          return `${seen.method} ${seen.url}`;
        }),
      ).toEqual(["POST http://localhost/runner-ingest/disconnect"]);
      expect(proxy.requestCredentials).toEqual([signedInAs(credentials)]);
    },
  );

  test("keep following only redirects that stay on the server", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    proxy.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      response.writeHead(307, {
        Location: "http://attacker.example.test/disconnect",
      });
      response.end();
    };

    let refused: boolean = false;

    try {
      await AgentClient.disconnect();
    } catch {
      refused = true;
    }

    // The Runner's key never went to another server.
    expect(refused).toBe(true);
    expect(proxy.requests).toHaveLength(1);
  });
});
