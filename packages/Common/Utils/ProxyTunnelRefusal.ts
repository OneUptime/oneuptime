/*
 * A TUNNEL THE OUTBOUND PROXY WOULD NOT OPEN, IN WORDS THAT NAME ITS ANSWER
 * AND NOT ITS ADDRESS (issue #10442).
 *
 * An https request through an outbound proxy first asks the proxy for a
 * tunnel to its server (CONNECT). When the proxy refuses - a 403 from its
 * rules, a 407 for a user name and password it does not take - Node fails
 * the request with ERR_PROXY_TUNNEL and a message that names the proxy:
 * "Failed to establish tunnel to hooks.example.com:443 via
 * http://proxy.internal:3128/: HTTP/1.1 403 Forbidden". The request never
 * reached its server, and the proxy's address is the operator's, not what
 * the person reading a webhook's or a workflow's error needs.
 *
 * describe() says it as the proxy's refusal, naming where the request was
 * going and what the proxy answered, never the proxy itself. A Runbook HTTP
 * step words it the same way (getHttpStepProxyTunnelMessage).
 *
 * Browser-safe: the API client reads it, on a server and in a browser.
 */

export const PROXY_TUNNEL_ERROR_CODE: string = "ERR_PROXY_TUNNEL";

// "Failed to establish tunnel to <host>:<port> via <proxy>: <answer>"
const TUNNEL_DESTINATION: RegExp = /Failed to establish tunnel to (\S+) via /;

// What the proxy answered, its status line, at the end of Node's message.
const PROXY_ANSWER: RegExp = /: (HTTP\/\d(?:\.\d)? (\d{3})[^\r\n]*)$/;

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  error?: unknown;
}

export default class ProxyTunnelRefusal {
  /*
   * The refusal as the reader is told it, or null when `error` - or the
   * error it wraps (an APIException's, an AxiosError's cause) - is no tunnel
   * a proxy refused.
   */
  public static describe(error: unknown): string | null {
    const refusal: ErrorLike | null = ProxyTunnelRefusal.find(error, 0);

    if (!refusal) {
      return null;
    }

    const message: string =
      typeof refusal.message === "string" ? refusal.message : "";

    return ProxyTunnelRefusal.word({
      destination: TUNNEL_DESTINATION.exec(message)?.[1] || "the server",
      answer: ProxyTunnelRefusal.getAnswer(message),
    });
  }

  // What the proxy answered, its status line, in Node's message; or null.
  public static getAnswer(nodeMessage: string): string | null {
    return PROXY_ANSWER.exec(nodeMessage || "")?.[1] || null;
  }

  /*
   * The refusal of a tunnel to `destination` ("host:port"), with what the
   * proxy answered, when it said: a 407 is the proxy not taking OneUptime's
   * user name and password, anything else the proxy not letting the request
   * through.
   */
  public static word(data: {
    destination: string;
    answer: string | null;
  }): string {
    const status: string | undefined = data.answer
      ? PROXY_ANSWER.exec(`: ${data.answer}`)?.[2]
      : undefined;

    if (data.answer && status === "407") {
      return `The outbound proxy did not take OneUptime's user name and password: it answered ${data.answer}, so the request to ${data.destination} was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.`;
    }

    return data.answer
      ? `The outbound proxy did not open a connection to ${data.destination}: it answered ${data.answer}. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`
      : `The outbound proxy did not open a connection to ${data.destination}, so the request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`;
  }

  // The tunnel error `error` is or wraps, a few levels down at most.
  private static find(error: unknown, depth: number): ErrorLike | null {
    if (!error || typeof error !== "object" || depth > 4) {
      return null;
    }

    const value: ErrorLike = error as ErrorLike;

    if (value.code === PROXY_TUNNEL_ERROR_CODE) {
      return value;
    }

    return (
      ProxyTunnelRefusal.find(value.cause, depth + 1) ||
      ProxyTunnelRefusal.find(value.error, depth + 1)
    );
  }
}
