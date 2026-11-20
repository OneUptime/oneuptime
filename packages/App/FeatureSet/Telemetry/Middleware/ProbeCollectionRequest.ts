import ProbeAuthorization from "./ProbeAuthorization";
import { ProbeExpressRequest } from "../Types/Request";
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import {
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import RequestBodyJson from "Common/Server/Utils/RequestBodyJson";
import {
  LARGE_REQUEST_BODY_LIMIT,
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "Common/Server/Utils/RequestBodyLimit";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";

/*
 * A PROBE'S COLLECTION, AUTHENTICATED BEFORE IT IS PARSED (#10222).
 *
 * A vCenter's or an OpenStack cloud's collection is up to 48 MiB of OTLP
 * metrics, gzip-compressed: some six million JSON values, which take
 * JSON.parse about 1.4 s and 490 MiB of heap. The probe's key used to be read
 * from the parsed report, so anyone who could reach the probe ingest could
 * have the App parse eight million values. Now StartServer leaves these
 * bodies unread (RequestBodyLimit, readsBodyAfterAuthentication), and each
 * collection route runs, in order:
 *
 *   1. the key in the request's headers, which probes send from #10222 on:
 *      a wrong one is refused before a byte of the body is read
 *      (ProbeAuthorization.isAuthorizedFromHeadersMiddleware);
 *   2. the body read, inflated and counted as it inflates, up to a
 *      collection's 8,000,000 values, and not parsed (readCollectionBody);
 *   3. for a request with no such headers - an older probe's - the id and
 *      key its report opens with, which every probe release writes first: a
 *      wrong key is refused with the report unparsed
 *      (isAuthorizedFromReportOpeningMiddleware);
 *   4. the report parsed (parseCollectionBody): up to 8,000,000 values for
 *      a probe whose key is right, and up to a large route's 1,000,000 for
 *      a body whose probe is still not known;
 *   5. the key in the parsed body, for that last kind
 *      (isAuthorizedServiceMiddleware), as every probe route reads it.
 *
 * So every probe, of whichever release, has its report read whole, and a
 * client with no key is held to what any large route takes.
 */

/*
 * The body's bytes, held to a collection's size and values: for a probe
 * that has not shown its key yet as much as for one that has, since an
 * older probe shows it only in the report.
 */
export const readCollectionBody: RequestHandler =
  RequestBodyAfterAuthentication.readBytes(REPORT_REQUEST_BODY_LIMIT);

// What a collection is parsed under: by whether its probe is known.
export function getCollectionParseLimit(
  req: ProbeExpressRequest,
): RequestBodyLimit {
  return req.probe?.id ? REPORT_REQUEST_BODY_LIMIT : LARGE_REQUEST_BODY_LIMIT;
}

/*
 * The collection's bytes, read as the JSON they are: counted first, and
 * refused with 413 past the limit getCollectionParseLimit gives before
 * JSON.parse sees them, whatever their Content-Type said. A body that is not
 * bytes - one read and parsed already - goes on as it is.
 */
export function parseCollectionBody(
  req: ProbeExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  const body: unknown = req.body;

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    try {
      req.body = RequestBodyJson.parse(body, getCollectionParseLimit(req));
    } catch (err) {
      if (RequestBodyJson.isTooManyValuesError(err)) {
        return next(err);
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("The collection report is not JSON."),
      );
    }
  }

  return next();
}

// What a collection route runs before its handler, in order (see above).
export const PROBE_COLLECTION_MIDDLEWARES: Array<RequestHandler> = [
  ProbeAuthorization.isAuthorizedFromHeadersMiddleware as RequestHandler,
  readCollectionBody,
  ProbeAuthorization.isAuthorizedFromReportOpeningMiddleware as RequestHandler,
  parseCollectionBody as RequestHandler,
  ProbeAuthorization.isAuthorizedServiceMiddleware as RequestHandler,
];
