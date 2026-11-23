import { OutboundProxyRefusal } from "../../../Server/Utils/OutboundFetch";
import ProxyTunnelRefusal, {
  PROXY_TUNNEL_ERROR_CODE,
} from "../../../Utils/ProxyTunnelRefusal";
import { describe, expect, test } from "@jest/globals";

/*
 * NODE'S REFUSAL OF A TUNNEL, AS THE PROXY'S REFUSAL OF A REQUEST TO WHERE
 * IT WAS GOING (issue #10763).
 *
 * The Teams bot's token requests and replies are sent on Node's agents
 * (OutboundProxyAgents), whose refusal of a tunnel names the proxy:
 * "Failed to establish tunnel to <host>:443 via http://proxy:3128/:
 * HTTP/1.1 403 Forbidden". Each client knows where its request was going,
 * and words the refusal as OutboundFetch's refusals are worded, keeping
 * the proxy's answer alone (OutboundProxyRefusal.fromTunnelError).
 */

// Node's error for a tunnel the proxy refused with `answer`.
function nodeTunnelError(destination: string, answer: string): Error {
  return Object.assign(
    new Error(
      `Failed to establish tunnel to ${destination} via http://proxy.corp.internal:3128/: ${answer}`,
    ),
    { code: PROXY_TUNNEL_ERROR_CODE },
  );
}

describe("OutboundProxyRefusal.fromTunnelError", () => {
  test("words Node's refusal as the proxy's, for where the request was going, never naming the proxy", () => {
    const refusal: OutboundProxyRefusal | null =
      OutboundProxyRefusal.fromTunnelError(
        nodeTunnelError(
          "smba.trafficmanager.net:443",
          "HTTP/1.1 403 Forbidden",
        ),
        "smba.trafficmanager.net:443",
      );

    expect(refusal).toBeInstanceOf(OutboundProxyRefusal);
    expect(refusal!.message).toBe(
      "The outbound proxy did not open a connection to smba.trafficmanager.net:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
    expect(refusal!.message).not.toContain("proxy.corp.internal");
    expect(refusal!.code).toBe(PROXY_TUNNEL_ERROR_CODE);
    expect(refusal!.destination).toBe("smba.trafficmanager.net:443");
    expect(refusal!.statusCode).toBe(403);
    expect(refusal!.isRetryable).toBe(false);
    expect(ProxyTunnelRefusal.describe(refusal)).toBe(refusal!.message);
  });

  test("a 407 is the proxy not taking OneUptime's user name and password", () => {
    const refusal: OutboundProxyRefusal | null =
      OutboundProxyRefusal.fromTunnelError(
        nodeTunnelError(
          "login.microsoftonline.com:443",
          "HTTP/1.1 407 Proxy Authentication Required",
        ),
        "login.microsoftonline.com:443",
      );

    expect(refusal!.message).toBe(
      "The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to login.microsoftonline.com:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
  });

  test("a proxy that failed itself is worth another try", () => {
    expect(
      OutboundProxyRefusal.fromTunnelError(
        nodeTunnelError(
          "smba.trafficmanager.net:443",
          "HTTP/1.1 502 Bad Gateway",
        ),
        "smba.trafficmanager.net:443",
      )!.isRetryable,
    ).toBe(true);
  });

  test("names where the client says the request was going, whatever Node's words say", () => {
    expect(
      OutboundProxyRefusal.fromTunnelError(
        nodeTunnelError("10.0.0.5:443", "HTTP/1.1 403 Forbidden"),
        "smba.trafficmanager.net:443",
      )!.destination,
    ).toBe("smba.trafficmanager.net:443");
  });

  test.each([
    [
      "a tunnel Node says no answer for, whose words name no proxy",
      Object.assign(
        new Error("Connection to establish proxy tunnel ended unexpectedly"),
        { code: PROXY_TUNNEL_ERROR_CODE },
      ),
    ],
    [
      "another error",
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
        code: "ECONNREFUSED",
      }),
    ],
    ["no error at all", undefined],
    ["a string", "Failed to establish tunnel"],
  ])("is null for %s", (_name: string, error: unknown) => {
    expect(
      OutboundProxyRefusal.fromTunnelError(
        error,
        "smba.trafficmanager.net:443",
      ),
    ).toBeNull();
  });
});

describe("OutboundProxyRefusal.destinationOf", () => {
  test.each([
    ["https://smba.trafficmanager.net/teams/", "smba.trafficmanager.net:443"],
    ["http://connector.example/teams/", "connector.example:80"],
    ["https://login.example:8443/token", "login.example:8443"],
    ["http://[::1]:3978/api/messages", "[::1]:3978"],
  ])("%s is %s", (url: string, destination: string) => {
    expect(OutboundProxyRefusal.destinationOf(new URL(url))).toBe(destination);
  });
});
