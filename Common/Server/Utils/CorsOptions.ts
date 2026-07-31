import type { CorsOptions as ExpressCorsOptions } from "cors";

/*
 * CORS options for the shared Express app.
 *
 * These live in their own module rather than inline in StartServer so a test
 * can drive a real OPTIONS request through `cors(CorsOptions)` without
 * importing StartServer, which builds the whole API surface at module load.
 *
 * They are options on the cors middleware, not headers written by
 * setDefaultHeaders, because cors 2.8.5 short-circuits preflights:
 * `preflightContinue` defaults to false, so cors answers OPTIONS itself and
 * calls res.end() before setDefaultHeaders (registered after it) ever runs.
 * Anything a preflight has to carry therefore has to be configured here.
 */

/*
 * Only the CORS-safelisted response headers (Cache-Control, Content-Language,
 * Content-Type, Expires, Last-Modified, Pragma) are readable from a page on
 * another origin. The session replay recorder's entire stand-down mechanism
 * rides in these three, and the recorder runs on the customer's own origin,
 * so every one of its ingest responses is cross-origin: without exposing them
 * the recorder sees a bodyless 204 with no directive (removing the only fast
 * path for the kill switch) and a 429 with no Retry-After.
 */
export const CORS_EXPOSED_HEADERS: Array<string> = [
  "x-oneuptime-replay-directive",
  "x-oneuptime-replay-config-epoch",
  "Retry-After",
];

/*
 * Without this the browser applies its own default preflight cache (5 seconds
 * in Chrome), which would preflight very nearly every replay chunk flush,
 * doubling the request count on the highest-volume browser endpoint we have.
 * 24 hours is the maximum Chrome honours.
 */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS: number = 86400;

/*
 * `allowedHeaders` is deliberately absent: the cors default reflects
 * Access-Control-Request-Headers verbatim, which is strictly more permissive
 * than any list maintained here and cannot go stale the first time a client
 * starts sending a new header.
 */
const CorsOptions: ExpressCorsOptions = {
  exposedHeaders: CORS_EXPOSED_HEADERS,
  maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
};

export default CorsOptions;
