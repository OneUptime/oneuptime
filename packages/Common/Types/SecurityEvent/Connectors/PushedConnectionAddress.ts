/*
 * WHERE A PRODUCT SENDS ITS ALERTS, FOR ONE CONNECTION (#11158).
 *
 * A product whose alerts are sent to OneUptime (alertsArePushed, CrowdSec's
 * http notification plugin) posts them to the Security Events ingest with
 * the project's ingestion key in a header, and names its connection in the
 * address - an id, nothing secret - or in a header of its own. The ingest
 * (App/FeatureSet/Telemetry/API/SecurityEventsIngest.ts) reads both; the
 * Dashboard writes the address the product is given.
 */

// The ingest every source of security events posts to.
export const SECURITY_EVENTS_INGEST_PATH: string = "/security-events/v1/ingest";

// The query parameter that names the connection: ?connection=<id>.
export const PUSHED_CONNECTION_QUERY_PARAM: string = "connection";

// The header a sender may name the connection with, instead of ?connection=.
export const PUSHED_CONNECTION_HEADER: string =
  "x-oneuptime-security-connection";

/*
 * The address one connection's alerts are sent to: the ingest, naming the
 * connection and the format its alerts are in. The format is the
 * connection's own without it too; named, the address says what it takes.
 */
export function getPushedConnectionAddress(data: {
  // The ingest's address, such as https://oneuptime.example.com/security-events/v1/ingest.
  ingestUrl: string;
  connectionId: string;
  format: string;
}): string {
  const query: string = [
    `${PUSHED_CONNECTION_QUERY_PARAM}=${encodeURIComponent(data.connectionId)}`,
    `format=${encodeURIComponent(data.format)}`,
  ].join("&");

  return `${data.ingestUrl}?${query}`;
}
