import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import axios, {
  AxiosAdapter,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * THE DASHBOARD'S REQUESTS, ANSWERED BY THE SERVER'S OWN ROUTES OVER HTTP
 * (#9997).
 *
 * A Dashboard test that replaces ModelAPI.create never sends what it was
 * handed: the model it checks is the model the page built. So a value the
 * server reads back from JSON as another class than the one its hook
 * expects passes the test and fails every customer. Add Custom Domain's new
 * project domain did exactly that: its tests replaced the create, and the
 * server refused every such domain with "Domain must be a string or an
 * instance of Domain."
 *
 * Here nothing on the Dashboard's side is replaced. Its API client builds
 * each request as it does in the browser, and axios serializes the body;
 * only the socket is swapped (axios's adapter) for an HTTP request to a
 * real Express app on localhost - Express's JSON body parser, the routes
 * under test, and the error handler the server answers with
 * (StartServer.expressErrorHandler). What the app answers goes back through
 * axios as the browser would get it, so the page reads the server's own
 * words.
 *
 *   const server: DashboardRequestsOverHttp = new DashboardRequestsOverHttp();
 *   await server.start([new DomainAPI().getRouter()]);
 *   ... render the page, or call ModelAPI ...
 *   await server.stop();
 *
 * Every request is kept in `requests`, in order: what was sent, as the
 * server read it, and what it answered.
 */

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

export interface SentRequest {
  // GET, POST, PUT or DELETE.
  method: string;
  // The path and query, from /api on: /api/domain.
  path: string;
  // The body as it went over the wire: the JSON text, parsed back.
  body: unknown;
  status: number;
  // The answer as it came back: the JSON text, parsed back.
  answer: unknown;
  // The answer's headers, by their names in lower case, as Node reads them.
  headers: Record<string, string>;
}

interface HttpAnswer {
  status: number;
  headers: Record<string, string>;
  text: string;
}

const parseOrKeep: (text: string) => unknown = (text: string): unknown => {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export default class DashboardRequestsOverHttp {
  public readonly requests: Array<SentRequest> = [];

  private server: http.Server | null = null;
  private port: number = 0;
  private previousAdapter: InternalAxiosRequestConfig["adapter"] = undefined;

  /*
   * Serves `routers` under /api, as the App serves its APIs, and sends
   * every request of axios's default instance - the Dashboard's API client -
   * to them.
   */
  public async start(routers: Array<ExpressRouter>): Promise<void> {
    const app: express.Express = express();
    app.use(express.json({ limit: "50mb" }));

    const api: ExpressRouter = express.Router();

    for (const router of routers) {
      api.use(router);
    }

    app.use("/api", api);
    app.use(expressErrorHandler);

    this.server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });

    this.port = (this.server.address() as AddressInfo).port;

    this.previousAdapter = axios.defaults.adapter;
    axios.defaults.adapter = this.adapter;
  }

  public async stop(): Promise<void> {
    if (this.previousAdapter === undefined) {
      delete axios.defaults.adapter;
    } else {
      axios.defaults.adapter = this.previousAdapter;
    }

    this.previousAdapter = undefined;

    if (!this.server) {
      return;
    }

    const server: http.Server = this.server;
    this.server = null;

    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  }

  // The requests sent to `method` `path` (a path from /api on), in order.
  public sentTo(method: string, path: string): Array<SentRequest> {
    return this.requests.filter((request: SentRequest): boolean => {
      return (
        request.method === method.toUpperCase() &&
        request.path.split("?")[0] === path
      );
    });
  }

  /*
   * Sends `body` as JSON text to `method` `path` (from /api on), as any
   * other API caller would - Terraform, a script, the API reference's
   * examples - and answers what the server answered.
   */
  public async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<SentRequest> {
    const text: string = body === undefined ? "" : JSON.stringify(body);
    const answer: HttpAnswer = await this.send(
      method.toUpperCase(),
      path,
      text,
    );

    const sent: SentRequest = {
      method: method.toUpperCase(),
      path: path,
      body: parseOrKeep(text),
      status: answer.status,
      answer: parseOrKeep(answer.text),
      headers: answer.headers,
    };

    this.requests.push(sent);

    return sent;
  }

  private readonly adapter: AxiosAdapter = async (
    config: InternalAxiosRequestConfig,
  ): Promise<AxiosResponse> => {
    const target: globalThis.URL = new globalThis.URL(
      config.url || "/",
      "http://localhost",
    );
    const method: string = (config.method || "get").toUpperCase();
    const path: string = `${target.pathname}${target.search}`;

    // What axios's transformRequest made of the body: its JSON text.
    const body: string =
      config.data === undefined || config.data === null
        ? ""
        : typeof config.data === "string"
          ? config.data
          : JSON.stringify(config.data);

    const answer: HttpAnswer = await this.send(method, path, body);

    this.requests.push({
      method: method,
      path: path,
      body: parseOrKeep(body),
      status: answer.status,
      answer: parseOrKeep(answer.text),
      headers: answer.headers,
    });

    const response: AxiosResponse = {
      // Raw, as a socket gives it: axios's transformResponse parses it.
      data: answer.text,
      status: answer.status,
      statusText: http.STATUS_CODES[answer.status] || "",
      headers: answer.headers,
      config: config,
      request: {},
    };

    const isOk: boolean = config.validateStatus
      ? config.validateStatus(answer.status)
      : answer.status >= 200 && answer.status < 300;

    if (isOk) {
      return response;
    }

    throw new AxiosError(
      `Request failed with status code ${answer.status}`,
      answer.status >= 500
        ? AxiosError.ERR_BAD_RESPONSE
        : AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    );
  };

  private send(
    method: string,
    path: string,
    body: string,
  ): Promise<HttpAnswer> {
    return new Promise<HttpAnswer>(
      (resolve: (answer: HttpAnswer) => void, reject: (e: Error) => void) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: this.port,
            path: path,
            method: method,
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });

            response.on("end", () => {
              const headers: Record<string, string> = {};

              for (const [name, value] of Object.entries(response.headers)) {
                if (value !== undefined) {
                  headers[name] = Array.isArray(value)
                    ? value.join(", ")
                    : value;
                }
              }

              resolve({
                status: response.statusCode || 0,
                headers: headers,
                text: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );

        request.on("error", reject);

        if (body) {
          request.write(body);
        }

        request.end();
      },
    );
  }
}
