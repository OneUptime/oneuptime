import { JSONArray, JSONObject } from "../../../Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressText,
  NextFunction,
  RequestHandler,
} from "../Express";

/*
 * JSON SENT AS TEXT/PLAIN, READ AS JSON.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * An Incoming Request monitor reads JSON and form bodies: StartServer's
 * parsers read application/json and application/x-www-form-urlencoded, and
 * any other body used to reach the monitor empty ({}). Amazon SNS posts
 * every message to an HTTPS subscription - the subscription confirmation
 * the owner must open, then every notification - as JSON with
 * "Content-Type: text/plain; charset=UTF-8". So an SNS topic pointed at a
 * monitor delivered empty bodies: no confirmation link to open, and nothing
 * for a Request Body criteria, a template or incident grouping to read.
 *
 * A text/plain body is now read too, and kept as the JSON it holds when it
 * is one JSON object or array - what application/json would have made of
 * it. Any other text still reaches the monitor empty, as before, and so
 * does a text that cannot be read (an unknown charset, a body over the
 * limit): a sender that never sent JSON sees no change, and nothing is
 * refused that was accepted.
 *
 * Used where the endpoint is served - the App's Incoming Request router -
 * and by a probe's incoming request ingress, which reads bodies as the App
 * does so a request it relays reaches the monitor as it would have
 * directly.
 */

export const TEXT_BODY_CONTENT_TYPE: string = "text/plain";

// The byte order mark a text may start with, which JSON.parse refuses.
const BYTE_ORDER_MARK: string = "﻿";

// What a body that holds no JSON object or array is kept as: empty.
export type EmptyBody = Record<string, never>;

export default class IncomingRequestBody {
  /*
   * The body a text/plain request is kept as: the JSON object or array the
   * text holds, else an empty body.
   */
  public static fromText(text: unknown): JSONObject | JSONArray | EmptyBody {
    if (typeof text !== "string" || !text) {
      return {};
    }

    const json: string = text.startsWith(BYTE_ORDER_MARK)
      ? text.slice(BYTE_ORDER_MARK.length)
      : text;

    try {
      const parsed: unknown = JSON.parse(json);

      if (parsed !== null && typeof parsed === "object") {
        return parsed as JSONObject | JSONArray;
      }
    } catch {
      // Not JSON: kept empty, as any other body is.
    }

    return {};
  }

  /*
   * The middleware that reads a text/plain body, up to `limit`, and keeps
   * it as fromText does. express.text reads the text whole and decodes its
   * charset. A body of any other type passes through untouched: the JSON
   * and form parsers before this have read it, or left it empty.
   *
   * A body something before this already read is left as it is: the App
   * inflates a gzip body into a Buffer (GzipRequestBody) without marking it
   * read, and reading its spent stream again would fail the request.
   */
  public static getTextBodyReader(limit: string): RequestHandler {
    const readText: RequestHandler = ExpressText({
      type: TEXT_BODY_CONTENT_TYPE,
      limit: limit,
    });

    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      if (req.readableEnded || Buffer.isBuffer(req.body)) {
        next();
        return;
      }

      readText(req, res, (err?: unknown): void => {
        req.body = err ? {} : IncomingRequestBody.keepJsonOf(req.body);
        next();
      });
    };
  }

  // What a body is kept as once express.text has had its turn.
  private static keepJsonOf(body: unknown): unknown {
    return typeof body === "string" ? IncomingRequestBody.fromText(body) : body;
  }
}
