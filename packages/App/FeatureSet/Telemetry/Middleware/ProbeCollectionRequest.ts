import ProbeAuthorization from "./ProbeAuthorization";
import { ProbeExpressRequest } from "../Types/Request";
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import RequestBodyOpening, {
  RequestBodyOpeningCheck,
} from "Common/Server/Middleware/RequestBodyOpening";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import { MAX_REPORT_OPENING_BYTES } from "Common/Server/Utils/Probe/ProbeReportOpening";
import RequestBodyJson from "Common/Server/Utils/RequestBodyJson";
import {
  LARGE_REQUEST_BODY_LIMIT,
  REPORT_REQUEST_BODY_LIMIT,
  RequestBodyLimit,
} from "Common/Server/Utils/RequestBodyLimit";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";

/*
 * A PROBE'S COLLECTION, AUTHENTICATED BEFORE IT IS READ (#10222, #10260).
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
 *   2. the body read (readCollectionBody). For a probe its headers named,
 *      whole, inflated and counted as it inflates, up to a collection's
 *      8,000,000 values. For a request with no such headers - an older
 *      probe's - no further than its report's opening, the id and key every
 *      probe release writes first: a few kilobytes, checked before another
 *      byte is read (ProbeAuthorization.isAuthorizedFromReportOpening). A
 *      wrong key, or a body that opens with anything else, is refused with
 *      the rest unread; a right key has the rest read as a known probe's;
 *   3. the report parsed (parseCollectionBody), counted first;
 *   4. the request timed as every probe request is
 *      (isAuthorizedServiceMiddleware), and, for a body something parsed
 *      before these ran, its key read from it as every probe route reads it.
 *
 * So every probe, of whichever release, has its report read whole, and a
 * client without the right key is refused after a few kilobytes, however
 * the body it sends is compressed, sized or shaped (#10260): a bomb, a body
 * nested a million deep, a report that opens with a probe's id and a wrong
 * key. It used to have a collection's 50 MiB inflated and 8,000,000 values
 * counted before its key was looked at.
 */

// A probe its headers named: its body, held to a collection's size and values.
const readKnownCollectionBody: RequestHandler =
  RequestBodyAfterAuthentication.readBytes(REPORT_REQUEST_BODY_LIMIT);

/*
 * The opening of a report no header named the probe of, checked as a key in
 * the headers is: true once the request is the probe's, false when it was
 * refused (answered).
 */
export function checkReportOpening(
  data: RequestBodyOpeningCheck,
): Promise<boolean> {
  return new Promise<boolean>(
    (
      resolve: (isAccepted: boolean) => void,
      reject: (err: unknown) => void,
    ) => {
      ProbeAuthorization.isAuthorizedFromReportOpening({
        req: data.req as ProbeExpressRequest,
        res: data.res,
        opening: data.opening,
        next: ((err?: unknown): void => {
          if (err) {
            reject(err);
            return;
          }

          resolve(true);
        }) as NextFunction,
      }).then(
        // Done without going on: it answered the request.
        (): void => {
          resolve(false);
        },
        reject,
      );
    },
  );
}

// An older probe's body: its opening checked before the rest is read.
const readCollectionBodyAfterOpening: RequestHandler =
  RequestBodyOpening.readBytes({
    openingBytes: MAX_REPORT_OPENING_BYTES,
    limit: REPORT_REQUEST_BODY_LIMIT,
    check: checkReportOpening,
  });

/*
 * The body's bytes, read once its probe is known (see above): whole for a
 * probe its headers named, and past its opening only once the key there is
 * right for any other.
 */
export const readCollectionBody: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if ((req as ProbeExpressRequest).probe?.id) {
    return readKnownCollectionBody(req, res, next);
  }

  return readCollectionBodyAfterOpening(req, res, next);
};

/*
 * What a collection is parsed under: by whether its probe is known.
 * readCollectionBody leaves bytes only for a known probe; a large route's
 * limit is the safeguard for bytes that reach here any other way.
 */
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
  parseCollectionBody as RequestHandler,
  ProbeAuthorization.isAuthorizedServiceMiddleware as RequestHandler,
];
