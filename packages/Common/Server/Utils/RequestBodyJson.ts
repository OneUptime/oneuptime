import JsonElementCounter, {
  JsonElementTallyCount,
} from "../../Utils/JsonElementCount";
import { ExpressRequest, OneUptimeRequest } from "./Express";
import { RequestBodyLimit, getRequestBodyLimit } from "./RequestBodyLimit";
import {
  TOO_MANY_JSON_VALUES_TYPE,
  createTooManyJsonValuesError,
} from "./RequestBodyRefusal";

/*
 * A JSON BODY, COUNTED BEFORE IT IS PARSED (#10183).
 *
 * StartServer counts every JSON body it parses (its parsers' verify) and
 * every JSON body a gzip request inflates to (GzipRequestBody), against the
 * limit of the route it is for (RequestBodyLimit). A route that parses JSON
 * itself - an inflated gzip body reaches the route as its bytes, whatever
 * its Content-Type said - counts it here first, so JSON.parse never sees a
 * body that would parse into more than the route reads.
 */
export default class RequestBodyJson {
  /*
   * What a request's body is held to: what StartServer held it to, or else
   * what its path takes.
   */
  public static getLimit(req: ExpressRequest): RequestBodyLimit {
    return (
      (req as OneUptimeRequest).requestBodyLimit ||
      getRequestBodyLimit(req.path || "")
    );
  }

  /*
   * Throws the 413 a body with more values than the limit is refused with
   * (createTooManyJsonValuesError), shaped as a body parser's error, so
   * expressErrorHandler answers it.
   */
  public static assertWithinLimit(
    bytes: Uint8Array,
    limit: RequestBodyLimit,
  ): void {
    const count: JsonElementTallyCount = JsonElementCounter.countBytes(
      bytes,
      limit,
    );

    if (count.passed) {
      throw createTooManyJsonValuesError(count, limit);
    }
  }

  // The same for text: false when it holds more values than the limit.
  public static isTextWithinLimit(
    text: string,
    limit: RequestBodyLimit,
  ): boolean {
    return !JsonElementCounter.countText(text, limit).passed;
  }

  // UTF-8 JSON bytes, counted and then parsed. JSON.parse's SyntaxError too.
  public static parse(bytes: Uint8Array, limit: RequestBodyLimit): unknown {
    RequestBodyJson.assertWithinLimit(bytes, limit);

    return JSON.parse(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
        "utf8",
      ),
    );
  }

  // Whether an error is the refusal assertWithinLimit throws.
  public static isTooManyValuesError(error: unknown): boolean {
    return (
      Boolean(error) &&
      typeof error === "object" &&
      (error as { type?: unknown }).type === TOO_MANY_JSON_VALUES_TYPE
    );
  }

  /*
   * Whether body-parser decodes a JSON body as UTF-8: the charset it hands a
   * verify function (utf-8 when the request names none). JSON sent between
   * systems is UTF-8 (RFC 8259, section 8.1), and the count reads UTF-8.
   */
  public static isUtf8(encoding: string | null | undefined): boolean {
    if (!encoding) {
      return true;
    }

    const name: string = encoding.trim().toLowerCase();

    return name === "utf-8" || name === "utf8";
  }

  /*
   * The 415 for a JSON body in another charset, shaped as body-parser's own
   * (expressErrorHandler answers it in RequestBodyRefusal's words). A body
   * the count cannot read as it will be decoded is not parsed: in UTF-7 or
   * UTF-16, brackets need not be the bytes they are in UTF-8.
   */
  public static createCharsetUnsupportedError(encoding: string): Error {
    return Object.assign(
      new Error(`unsupported charset "${encoding.toUpperCase()}"`),
      {
        type: "charset.unsupported",
        charset: encoding.toLowerCase(),
        status: 415,
        statusCode: 415,
        expose: true,
      },
    );
  }
}
