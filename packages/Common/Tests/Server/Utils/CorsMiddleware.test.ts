import CorsMiddleware from "../../../Server/Utils/CorsMiddleware";
import {
  createExpressApp,
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "../../../Server/Utils/Express";
import WebhookVerification, {
  WebhookVerificationAnswer,
} from "../../../Server/Utils/WebhookVerification";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

/*
 * THE SHARED APP'S CORS MIDDLEWARE, AND THE ONE OPTIONS REQUEST IT LETS BY.
 *
 * https://github.com/OneUptime/oneuptime/issues/8429
 *
 * cors answers every OPTIONS request itself, as a preflight: 204, and no
 * route runs. Azure Event Grid validates a CloudEvents 1.0 subscription's
 * endpoint with an OPTIONS request naming itself in WebHook-Request-Origin,
 * granted only by an answer carrying WebHook-Allowed-Origin - which cors
 * never writes, so such a subscription could not be created. That request
 * goes on to the route now; a browser's preflight, which always carries
 * Access-Control-Request-Method, is answered by cors as before.
 *
 * Over HTTP: the middleware in front of a route that answers the
 * validation as an Incoming Request monitor's URL does.
 */

let server: http.Server;
let port: number = 0;
let routeReached: number = 0;

interface Answer {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
}

function options(headers: Record<string, string>): Promise<Answer> {
  return new Promise(
    (resolve: (answer: Answer) => void, reject: (err: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          method: "OPTIONS",
          path: "/incoming-request/2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee",
          headers: headers,
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode || 0,
              headers: response.headers,
            });
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end();
    },
  );
}

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();

  app.use(CorsMiddleware);
  app.options(
    "/incoming-request/:secretkey",
    (req: ExpressRequest, res: ExpressResponse) => {
      routeReached++;

      const answer: WebhookVerificationAnswer | null =
        WebhookVerification.recognize(WebhookVerification.readRequest(req));

      if (answer) {
        WebhookVerification.send(res, answer);
        return;
      }

      res.status(200).json({});
    },
  );

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve: (value: unknown) => void) => {
    server.once("listening", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve: (value: unknown) => void) => {
    server.close(resolve);
  });
});

describe("a browser's CORS preflight", () => {
  test("is answered by cors itself, as before, and reaches no route", async () => {
    const before: number = routeReached;

    const answer: Answer = await options({
      origin: "https://shop.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    });

    expect(answer.statusCode).toBe(204);
    expect(answer.headers["access-control-allow-origin"]).toBe("*");
    expect(answer.headers["access-control-max-age"]).toBe("86400");
    expect(answer.headers["webhook-allowed-origin"]).toBeUndefined();
    expect(routeReached).toBe(before);
  });

  test("that names a WebHook-Request-Origin too is still a preflight", async () => {
    const before: number = routeReached;

    const answer: Answer = await options({
      origin: "https://shop.example.com",
      "access-control-request-method": "POST",
      "webhook-request-origin": "eventgrid.azure.net",
    });

    expect(answer.statusCode).toBe(204);
    expect(answer.headers["webhook-allowed-origin"]).toBeUndefined();
    expect(routeReached).toBe(before);
  });
});

describe("a CloudEvents validation, as Azure Event Grid sends it", () => {
  test("goes on to the route, which grants it", async () => {
    const before: number = routeReached;

    const answer: Answer = await options({
      "webhook-request-origin": "eventgrid.azure.net",
    });

    expect(routeReached).toBe(before + 1);
    expect(answer.statusCode).toBe(200);
    expect(answer.headers["webhook-allowed-origin"]).toBe(
      "eventgrid.azure.net",
    );
    expect(answer.headers["webhook-allowed-rate"]).toBe("*");
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("with an origin no service would send goes on too, and is granted nothing", async () => {
    const answer: Answer = await options({
      "webhook-request-origin": "not a host name",
    });

    expect(answer.statusCode).toBe(200);
    expect(answer.headers["webhook-allowed-origin"]).toBeUndefined();
  });
});
