import { JSONArray, JSONObject } from "../../Types/JSON";
import JsonElementCounter, {
  JsonElementLimits,
} from "../../Utils/JsonElementCount";
import RequestBodyJson from "../Utils/RequestBodyJson";
import {
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  ExpressText,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
} from "../Utils/Express";

/*
 * THE BODY OF A REQUEST SENT TO AN ENDPOINT THAT TAKES WHATEVER A TEAM POINTS
 * AT IT: AN INCOMING REQUEST MONITOR'S URL, A PROBE'S INCOMING REQUEST
 * INGRESS, A WORKFLOW'S WEBHOOK TRIGGER.
 *
 * StartServer's parsers read application/json and
 * application/x-www-form-urlencoded bodies, and any other body reaches a
 * route empty ({}). These endpoints read two more kinds:
 *
 *   - text/plain. Amazon SNS posts every message to an HTTPS subscription -
 *     the subscription confirmation its owner must open, then every
 *     notification - as JSON labelled "Content-Type: text/plain;
 *     charset=UTF-8" (https://github.com/OneUptime/oneuptime/issues/7723),
 *     so a text that holds a JSON object or array is kept as that JSON,
 *     what application/json would have made of it. Any other text - `curl
 *     -H "Content-Type: text/plain" -d "backup failed"`, a device posting a
 *     status line - is kept as the text it is (issue #8430): it used to
 *     arrive empty, so a Request Body criteria (the default one looks for
 *     `error`), a template and a JavaScript Expression could never read it.
 *   - JSON labelled with a +json type, such as application/cloudevents+json:
 *     Azure Event Grid delivers a CloudEvents subscription's events so
 *     (issue #8429), and they used to arrive empty too. Kept as the JSON they
 *     hold, or as their text when they hold none.
 *
 * A text over the limit, or in a charset nothing can read, still arrives
 * empty, as before: nothing is refused that was accepted.
 *
 * The App and the workflow trigger read these bodies as text (getReader). A
 * probe passes them on as the bytes that came (getRawReader), with their
 * Content-Type, so OneUptime reads a request a probe relays exactly as it
 * would have read it directly: its charset included.
 */

export const TEXT_BODY_CONTENT_TYPE: string = "text/plain";

// Any application/<name>+json type: application/cloudevents+json and the like.
export const JSON_SUFFIX_CONTENT_TYPE: string = "application/*+json";

// The content types these endpoints read beyond StartServer's JSON and forms.
export const WEBHOOK_BODY_CONTENT_TYPES: ReadonlyArray<string> = [
  TEXT_BODY_CONTENT_TYPE,
  JSON_SUFFIX_CONTENT_TYPE,
];

// The byte order mark a text may start with, which JSON.parse refuses.
const BYTE_ORDER_MARK: string = "﻿";

// What a request with no body to keep is kept as: empty.
export type EmptyBody = Record<string, never>;

export type WebhookBody = JSONObject | JSONArray | string | EmptyBody;

export default class WebhookRequestBody {
  /*
   * The body a text is kept as: the JSON object or array the text holds,
   * else the text itself. A text with nothing in it but whitespace is an
   * empty body, as no text is.
   *
   * With a limit (the route's, RequestBodyLimit), a text that holds more
   * JSON values than it is not parsed, and is kept as the text it is
   * (#10183): JSON.parse made 17 million empty arrays of 50 MB of "[],",
   * before anyone's key was checked.
   */
  public static fromText(
    text: unknown,
    limit?: JsonElementLimits | undefined,
  ): WebhookBody {
    if (typeof text !== "string") {
      return {};
    }

    const withoutMark: string = text.startsWith(BYTE_ORDER_MARK)
      ? text.slice(BYTE_ORDER_MARK.length)
      : text;

    if (!withoutMark.trim()) {
      return {};
    }

    if (limit && JsonElementCounter.countText(withoutMark, limit).passed) {
      return withoutMark;
    }

    try {
      const parsed: unknown = JSON.parse(withoutMark);

      if (parsed !== null && typeof parsed === "object") {
        return parsed as JSONObject | JSONArray;
      }
    } catch {
      // Not JSON: the text it is.
    }

    return withoutMark;
  }

  /*
   * The middleware that reads a text/plain or +json body, up to `limit`,
   * and keeps it as fromText does. express.text reads the text whole and
   * decodes its charset. A body of any other type passes through untouched:
   * the JSON and form parsers before this have read it, or left it empty.
   *
   * A body something before this already read is left as it is: the App
   * inflates a gzip body into a Buffer (GzipRequestBody) without marking it
   * read, and reading its spent stream again would fail the request.
   */
  public static getReader(limit: string): RequestHandler {
    const readText: RequestHandler = ExpressText({
      type: [...WEBHOOK_BODY_CONTENT_TYPES],
      limit: limit,
      /*
       * The bytes as they came, before their charset is decoded: what a
       * signature of the body is made over (IncomingRequestSignature).
       */
      verify: (req: ExpressRequest, _res: ExpressResponse, buf: Buffer) => {
        (req as OneUptimeRequest).rawBodyBytes = buf;
      },
    });

    return WebhookRequestBody.readWith(
      readText,
      (body: unknown, req: ExpressRequest): unknown => {
        return typeof body === "string"
          ? WebhookRequestBody.fromText(body, RequestBodyJson.getLimit(req))
          : body;
      },
    );
  }

  /*
   * For a request that carries a signature of its body (`isSigned`): reads a
   * body of any other type - one no parser reads, which reaches the route
   * empty - as its bytes, up to `limit`, only to check the signature over
   * (rawBodyBytes). The route still gets it empty, as before. Any other
   * request, and a body already read, passes through untouched.
   */
  public static getSignedBodyReader(
    limit: string,
    isSigned: (req: ExpressRequest) => boolean,
  ): RequestHandler {
    const readBytes: RequestHandler = ExpressRaw({
      type: (): boolean => {
        return true;
      },
      limit: limit,
    });

    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      if (
        req.readableEnded ||
        Buffer.isBuffer(req.body) ||
        (req as OneUptimeRequest).rawBody !== undefined ||
        (req as OneUptimeRequest).rawBodyBytes !== undefined ||
        !isSigned(req)
      ) {
        next();
        return;
      }

      const bodyBefore: unknown = req.body;

      readBytes(req, res, (err?: unknown): void => {
        if (!err && Buffer.isBuffer(req.body)) {
          (req as OneUptimeRequest).rawBodyBytes = req.body;
        }

        req.body = bodyBefore === undefined ? {} : bodyBefore;
        next();
      });
    };
  }

  /*
   * The middleware a relay reads the same bodies with: as the bytes that
   * came (inflated, when they came compressed), up to `limit`, for it to
   * pass on as they are, with their Content-Type. One it cannot read is
   * empty.
   */
  public static getRawReader(limit: string): RequestHandler {
    const readBytes: RequestHandler = ExpressRaw({
      type: [...WEBHOOK_BODY_CONTENT_TYPES],
      limit: limit,
    });

    return WebhookRequestBody.readWith(readBytes, (body: unknown): unknown => {
      return body;
    });
  }

  private static readWith(
    read: RequestHandler,
    keep: (body: unknown, req: ExpressRequest) => unknown,
  ): RequestHandler {
    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): void => {
      if (req.readableEnded || Buffer.isBuffer(req.body)) {
        next();
        return;
      }

      read(req, res, (err?: unknown): void => {
        req.body = err ? {} : keep(req.body, req);
        next();
      });
    };
  }
}
