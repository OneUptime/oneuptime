import APIException from "../../Types/Exception/ApiException";
import API from "../../Utils/API";
import ProxyTunnelRefusal, {
  PROXY_TUNNEL_ERROR_CODE,
} from "../../Utils/ProxyTunnelRefusal";
import { describe, expect, test } from "@jest/globals";
import { AxiosError } from "axios";

/*
 * A TUNNEL THE OUTBOUND PROXY REFUSED IS SAID AS ITS REFUSAL, NEVER WITH ITS
 * ADDRESS (issue #10442).
 *
 * Every https request through an outbound proxy now opens its tunnel with
 * Node's own proxy support, which fails a refused tunnel with
 * ERR_PROXY_TUNNEL and a message naming the proxy. What a webhook's, a
 * data source's or a workflow's error says is the proxy's answer and where
 * the request was going: the proxy's address is the operator's.
 */

// Node's error for a tunnel the proxy at `proxy` answered with `answer`.
function nodeTunnelError(destination: string, answer: string): Error {
  return Object.assign(
    new Error(
      `Failed to establish tunnel to ${destination} via http://proxy.corp.internal:3128/: ${answer}`,
    ),
    { code: PROXY_TUNNEL_ERROR_CODE },
  );
}

describe("ProxyTunnelRefusal.describe", () => {
  test("names where the request was going and what the proxy answered, never the proxy", () => {
    const sentence: string | null = ProxyTunnelRefusal.describe(
      nodeTunnelError("hooks.example.com:443", "HTTP/1.1 403 Forbidden"),
    );

    expect(sentence).toBe(
      "The outbound proxy did not open a connection to hooks.example.com:443: it answered HTTP/1.1 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
    expect(sentence).not.toContain("proxy.corp.internal");
    expect(sentence).not.toContain("3128");
  });

  test("says a 407 is the proxy refusing OneUptime's user name and password", () => {
    expect(
      ProxyTunnelRefusal.describe(
        nodeTunnelError(
          "api.example.com:443",
          "HTTP/1.1 407 Proxy Authentication Required",
        ),
      ),
    ).toBe(
      "The outbound proxy did not take OneUptime's user name and password: it answered HTTP/1.1 407 Proxy Authentication Required, so the request to api.example.com:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
  });

  test("a refusal with no answer in it still names where the request was going", () => {
    const error: Error = Object.assign(
      new Error(
        "Failed to establish tunnel to hooks.example.com:443 via http://proxy.corp.internal:3128/: socket hang up",
      ),
      { code: PROXY_TUNNEL_ERROR_CODE },
    );

    expect(ProxyTunnelRefusal.describe(error)).toBe(
      "The outbound proxy did not open a connection to hooks.example.com:443, so the request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
  });

  test("finds the refusal inside the errors that carry it: axios's and the API client's", () => {
    const nodeError: Error = nodeTunnelError(
      "hooks.example.com:443",
      "HTTP/1.1 403 Forbidden",
    );
    const axiosError: AxiosError = AxiosError.from(nodeError);
    const apiException: APIException = new APIException(
      "Request failed to https://hooks.example.com/hook.",
      axiosError,
    );
    const wrapped: Error = Object.assign(new Error("wrapped"), {
      cause: nodeError,
    });

    for (const error of [axiosError, apiException, wrapped]) {
      expect(ProxyTunnelRefusal.describe(error)).toContain(
        "did not open a connection to hooks.example.com:443",
      );
    }
  });

  test("any other error is not a refused tunnel", () => {
    for (const error of [
      new Error("connect ECONNREFUSED 10.0.0.5:443"),
      Object.assign(new Error("getaddrinfo ENOTFOUND x"), {
        code: "ENOTFOUND",
      }),
      "a string",
      undefined,
      null,
      {},
    ]) {
      expect(ProxyTunnelRefusal.describe(error)).toBeNull();
    }
  });
});

describe("the API client", () => {
  test("words a refused tunnel as the proxy's refusal in its friendly message", () => {
    const axiosError: AxiosError = AxiosError.from(
      nodeTunnelError("hooks.example.com:443", "HTTP/1.1 403 Forbidden"),
    );

    expect(API.getFriendlyErrorMessage(axiosError)).toBe(
      "The outbound proxy did not open a connection to hooks.example.com:443: it answered HTTP/1.1 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.",
    );
  });

  test("leaves every other error's friendly message as it was", () => {
    expect(
      API.getFriendlyErrorMessage(new Error("connect ECONNREFUSED 10.0.0.5")),
    ).toBe("Connection Refused.");
  });
});
