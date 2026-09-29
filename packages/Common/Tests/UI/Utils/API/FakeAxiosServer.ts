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
 * A scripted stand-in for the server, sitting where axios's transport would.
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

export interface SentRequest {
  method: string;
  url: string;
  data: unknown;
  headers: Dictionary<string>;
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

  public constructor(transport: FakeTransport) {
    this.transport = transport;

    this.transport.mockImplementation(
      async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
        return await this.handle(config);
      },
    );
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

    this.sent.push(request);

    if (this.onRequest) {
      this.onRequest(request);
    }

    const queue: Array<FakeReply> | undefined = this.routes.get(
      FakeAxiosServer.key(request.method, request.url),
    );

    const reply: FakeReply | undefined = queue ? queue.shift() : undefined;

    if (!reply) {
      throw new Error(
        `Unexpected request: ${request.method.toUpperCase()} ${request.url}`,
      );
    }

    if (reply.gate) {
      await reply.gate;
    }

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
}
