import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "../Utils/Express";
import { closeConnectionAfterAnswer } from "../Utils/RequestBodyRefusal";

/*
 * A RESPONSE SENT BEFORE ANYONE READ ITS REQUEST'S BODY CLOSES THE
 * CONNECTION, RATHER THAN READ THE REST OF THE BODY (#10598).
 *
 * Once a response is sent, Node reads off the body of its request that
 * nobody read (IncomingMessage._dump), to keep a keep-alive connection
 * usable: every byte the client goes on sending. StartServer's parsers read
 * JSON, forms and protobuf, each no further than its route's limit
 * (RequestBodyParser); a body of any other type reaches the route unread,
 * and a route that answers without reading it - an unknown path's 404, a
 * wrong key's 401 - had the rest drained. Measured on Node 26: 64 MiB sent
 * as text/plain to an ordinary route were read in full after its answer, so
 * any Content-Type no parser reads had the App read as much as a client
 * chose to send, for nothing, before anyone was signed in.
 *
 * Now a response whose headers are written while its request's body is not
 * all in, and nobody has begun to read it, closes the connection once it is
 * sent, without a byte more read (closeConnectionAfterAnswer): the answer
 * says "Connection: close", and the client still reads it. A body a route
 * reads - whole, or until it refuses it - is not this one's: a reader that
 * refuses a body closes the connection itself, and a route that reads one
 * through answers once it is in.
 */

/*
 * Whether a request came with a body that is not all in, and that nobody
 * has begun to read: no data listener, pipe, resume or pause yet.
 */
export const isRequestBodyLeftUnread: (req: ExpressRequest) => boolean = (
  req: ExpressRequest,
): boolean => {
  const declaredLength: number = parseInt(
    headerValueToString(req.headers["content-length"]) || "",
    10,
  );

  const hasBody: boolean =
    req.headers["transfer-encoding"] !== undefined ||
    (!isNaN(declaredLength) && declaredLength > 0);

  return hasBody && !req.complete && req.readableFlowing === null;
};

export default class UnreadRequestBody {
  /*
   * Watches the response's headers: written with the body left unread, the
   * connection is closed once the answer is sent (see above).
   */
  public static closeConnectionInstead(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    const writeHead: ExpressResponse["writeHead"] = res.writeHead;

    res.writeHead = function writeHeadClosingUnreadBody(
      this: ExpressResponse,
      ...args: Array<unknown>
    ): ExpressResponse {
      if (isRequestBodyLeftUnread(req)) {
        closeConnectionAfterAnswer(res);
      }

      return (
        writeHead as unknown as (...headArgs: Array<unknown>) => ExpressResponse
      ).apply(this, args);
    } as ExpressResponse["writeHead"];

    next();
  }
}
