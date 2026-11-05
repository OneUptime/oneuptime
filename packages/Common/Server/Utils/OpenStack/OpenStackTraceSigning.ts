import crypto from "crypto";

/*
 * SIGNING A REQUEST WITHOUT OSPROFILER, FOR WHOEVER SENDS ONE.
 *
 * OSProfiler traces a request that carries two headers its WSGI middleware can check against
 * an HMAC key the service holds (osprofiler/web.py, signed_unpack in osprofiler/_utils.py). The
 * `openstack` client writes them when it is given a key. A probe has no OSProfiler, and these
 * are all it needs.
 *
 * Nothing calls this yet. It is what the lifecycle check of #5749 calls, once a run is given
 * the key: every request of that run goes out with these headers and one trace ID, so "a slow
 * boot has a trace", on the cloud's Traces page like any other, because that page finds spans
 * by the cloud's key and not by who signed them. The check then holds the trace ID to put on
 * the incident, and readOpenStackTraceId's OTLP form of it opens the trace.
 *
 * Tests/Ops/openstack-e2e/traces-record.sh's signed-by-header scene sends what this writes to a
 * real Nova, and the spans come back under that trace ID.
 *
 * The key is a secret: it must not be logged, and it is sent nowhere but into the HMAC.
 */

export const OSPROFILER_TRACE_INFO_HEADER: string = "X-Trace-Info";
export const OSPROFILER_TRACE_HMAC_HEADER: string = "X-Trace-HMAC";

export function getOpenStackTraceHeaders(data: {
  hmacKey: string;
  // OSProfiler's base ID, a UUID: what `openstack` prints as its Trace ID.
  traceId: string;
  /*
   * The span this request is a child of, also a UUID. Leave it out for a request that stands
   * on its own, which then starts the trace.
   */
  parentId?: string | undefined;
}): Record<string, string> {
  const info: string = Buffer.from(
    JSON.stringify({
      base_id: data.traceId,
      parent_id: data.parentId || data.traceId,
    }),
    "utf8",
  )
    .toString("base64")
    .split("+")
    .join("-")
    .split("/")
    .join("_");

  return {
    [OSPROFILER_TRACE_INFO_HEADER]: info,
    [OSPROFILER_TRACE_HMAC_HEADER]: crypto
      .createHmac("sha1", data.hmacKey)
      .update(info, "utf8")
      .digest("hex"),
  };
}
