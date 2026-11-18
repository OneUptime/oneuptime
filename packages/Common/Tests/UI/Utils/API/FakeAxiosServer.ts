import HTTPMethod from "../../../../Types/API/HTTPMethod";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

/*
 * A scripted stand-in for the server, sitting where axios's transport would -
 * and where the page's fetch would, for the one request the clients send
 * with it: the sign-out, keepalive (UI/Utils/SignOutRequest, issue #9508).
 *
 * Common/Utils/API.ts calls `axios(config)` and relies on axios for the one
 * behaviour everything in these tests hangs on: a 4xx/5xx REJECTS with an
 * AxiosError carrying `response.status`, and a request that never got an answer
 * rejects with no `response` at all. The fake reproduces exactly that, with real
 * AxiosError instances, so `axios.isAxiosError` and the 401 branch in
 * fetchUntraced see what they would see in a browser.
 *
 * Every route is scripted with the replies it gives, in order. A request the
 * script did not expect - an extra refresh, a replay that should not have
 * happened - is answered with a plain Error, which the client turns into a
 * thrown APIException that fails the test naming the unexpected request.
 */

export type FakeTransport = jest.MockedFunction<
  (config: AxiosRequestConfig) => Promise<AxiosResponse>
>;

export interface FakeReply {
  // HTTP status to answer with. 2xx resolves; anything else rejects, as axios does.
  status?: number | undefined;
  data?: JSONObject | JSONArray | undefined;
  headers?: Dictionary<string> | undefined;
  // Fail without any response, the way a refused or dropped connection does.
  networkErrorCode?: string | undefined;
  // Hold the reply until this settles, to keep a request in flight on purpose.
  gate?: Promise<void> | undefined;
}

/*
 * The identity server's answer to a renewal it made (POST
 * /identity/refresh-token, Identity/API/Authentication.ts): the session's
 * new tokens beside the cookies it sets. A 200 without them is no renewal
 * (BaseAPI.isSessionRenewalAnswer, issue #8838), so a fake renewal that
 * succeeds answers this.
 */
export const RENEWED_SESSION: FakeReply = {
  status: 200,
  data: {
    accessToken: "renewed-access-token",
    refreshToken: "renewed-refresh-token",
    refreshTokenExpiresAt: "2026-12-16T09:00:00.000Z",
  },
};

/*
 * A private status page's answer to a renewal it made (StatusPageAuthentication's
 * /refresh-token/:statuspageid): the reader, with the new access token
 * under _miscData.token (the status page's API.isSessionRenewalAnswer).
 */
export const RENEWED_STATUS_PAGE_SESSION: FakeReply = {
  status: 200,
  data: {
    _id: "status-page-reader",
    _miscData: { token: "renewed-status-page-token" },
  },
};

export interface SentRequest {
  method: string;
  url: string;
  data: unknown;
  headers: Dictionary<string>;
  // Sent with fetch: whether with keepalive, and which cookies it carried.
  keepalive?: boolean | undefined;
  credentials?: string | undefined;
  /*
   * Whether the server answered it: it read the request and acted on it.
   * Not for one a page change cancelled first (changePage).
   */
  answered?: boolean | undefined;
  // Cancelled by a page change before the server answered (changePage).
  cancelled?: boolean | undefined;
}

export interface Gate {
  promise: Promise<void>;
  open: () => void;
}

export const createGate: () => Gate = (): Gate => {
  let open: () => void = (): void => {};

  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });

  return { promise: promise, open: open };
};

/*
 * Lets every promise chain that is already runnable finish. A macrotask runs
 * only once the microtask queue is empty, so after this every request that
 * could reach the fake without outside help has done so.
 */
export const settle: () => Promise<void> = async (): Promise<void> => {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
};

export default class FakeAxiosServer {
  public readonly sent: Array<SentRequest> = [];

  // Called for every request as it arrives, before it is answered.
  public onRequest: ((request: SentRequest) => void) | null = null;

  private readonly routes: Map<string, Array<FakeReply>> = new Map();

  private readonly transport: FakeTransport;

  // Every request the server has not answered yet.
  private readonly onTheirWay: Set<SentRequest> = new Set();

  public constructor(transport: FakeTransport) {
    this.transport = transport;

    this.transport.mockImplementation(
      async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
        return await this.handle(config);
      },
    );

    this.installFetch();
  }

  /*
   * The page changes - the sign-in page, loaded in full - as Firefox changes
   * it: every request still on its way is cancelled at once, and the server
   * never acts on it, but one sent with keepalive, which the browser lets
   * outlive its page (issue #9508). Chrome cancelled later, which is why
   * only Firefox users were left signed in.
   */
  public changePage(): void {
    for (const request of this.onTheirWay) {
      if (!request.keepalive) {
        request.cancelled = true;
      }
    }
  }

  public on(method: HTTPMethod, url: string, replies: Array<FakeReply>): this {
    const key: string = FakeAxiosServer.key(method, url);

    this.routes.set(key, [...(this.routes.get(key) || []), ...replies]);

    return this;
  }

  public requestsTo(method: HTTPMethod, url: string): Array<SentRequest> {
    return this.sent.filter((request: SentRequest): boolean => {
      return (
        request.method.toUpperCase() === method.toUpperCase() &&
        request.url === url
      );
    });
  }

  private static key(method: string, url: string): string {
    return `${method.toUpperCase()} ${url}`;
  }

  private async handle(config: AxiosRequestConfig): Promise<AxiosResponse> {
    const request: SentRequest = {
      method: String(config.method || ""),
      url: String(config.url || ""),
      data: config.data,
      headers: { ...((config.headers || {}) as Dictionary<string>) },
    };

    const reply: FakeReply = await this.receive(request);

    const internalConfig: InternalAxiosRequestConfig = {
      ...config,
      headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig;

    if (reply.networkErrorCode) {
      throw new AxiosError(
        `connect ${reply.networkErrorCode}`,
        reply.networkErrorCode,
        internalConfig,
        {},
      );
    }

    const status: number = reply.status ?? 200;

    const response: AxiosResponse = {
      data: reply.data ?? {},
      status: status,
      statusText: "",
      headers: reply.headers ?? {},
      config: internalConfig,
    };

    if (status >= 200 && status < 300) {
      return response;
    }

    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
      internalConfig,
      {},
      response,
    );
  }

  /*
   * A request arriving, by either transport: kept, and answered with the
   * next reply scripted for its route once its gate opens - unless a page
   * change cancelled it first, which the client sees as an abort.
   */
  private async receive(request: SentRequest): Promise<FakeReply> {
    this.sent.push(request);
    this.onTheirWay.add(request);

    if (this.onRequest) {
      this.onRequest(request);
    }

    const queue: Array<FakeReply> | undefined = this.routes.get(
      FakeAxiosServer.key(request.method, request.url),
    );

    const reply: FakeReply | undefined = queue ? queue.shift() : undefined;

    if (!reply) {
      this.onTheirWay.delete(request);

      throw new Error(
        `Unexpected request: ${request.method.toUpperCase()} ${request.url}`,
      );
    }

    if (reply.gate) {
      await reply.gate;
    }

    this.onTheirWay.delete(request);

    if (request.cancelled) {
      throw new Error(
        `Cancelled by a page change: ${request.method.toUpperCase()} ${request.url}`,
      );
    }

    request.answered = !reply.networkErrorCode;

    return reply;
  }

  /*
   * The page's fetch (window.fetch, where the clients look for it), routed
   * to the same script. Defined rather than assigned: in App's tests the
   * window is Node's own global, whose fetch would reach the network.
   */
  private installFetch(): void {
    if (typeof window === "undefined") {
      return;
    }

    Object.defineProperty(window, "fetch", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: async (
        input: string | { toString: () => string },
        init?: RequestInit,
      ): Promise<Response> => {
        return await this.handleFetch(String(input), init || {});
      },
    });
  }

  // As fetch answers: a Response for any status, a TypeError for no answer at all.
  private async handleFetch(url: string, init: RequestInit): Promise<Response> {
    const request: SentRequest = {
      method: String(init.method || "GET"),
      url: url,
      data: init.body,
      headers: { ...((init.headers || {}) as Dictionary<string>) },
      keepalive: init.keepalive === true,
      credentials: init.credentials,
    };

    let reply: FakeReply;

    try {
      reply = await this.receive(request);
    } catch (err) {
      throw new TypeError((err as Error).message || "Failed to fetch");
    }

    if (reply.networkErrorCode) {
      throw new TypeError("Failed to fetch");
    }

    const status: number = reply.status ?? 200;
    const data: JSONObject | JSONArray = reply.data ?? {};

    return {
      ok: status >= 200 && status < 300,
      status: status,
      headers: reply.headers ?? {},
      json: async (): Promise<JSONObject | JSONArray> => {
        return data;
      },
      text: async (): Promise<string> => {
        return JSON.stringify(data);
      },
    } as unknown as Response;
  }
}
