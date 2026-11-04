import { readOpenStackTraceId } from "Common/Utils/OpenStack/OpenStackTraces";
import crypto from "crypto";

/*
 * Signs a request so that OSProfiler traces it: what `openstack --os-profile <key>` does, for a
 * lifecycle run, so a slow boot has a trace to read.
 *
 * osprofiler/web.py reads two headers on each request a service receives: X-Trace-Info, the base64
 * of a JSON object holding base_id and parent_id, and X-Trace-HMAC, the hex HMAC-SHA1 of that very
 * base64 text, under a key in the service's hmac_keys (osprofiler/utils.py, signed_pack). A request
 * with a key the service does not hold just goes untraced, and is not an error. What the client
 * calls the Trace ID is base_id, and the driver makes it the OTLP trace ID whole
 * (OpenStackTraces, readOpenStackTraceId).
 *
 * A step's writes are what is signed, each step its own trace. The polls that wait for a server
 * are not: a signed request does more work in every service it crosses, and a wait of minutes is
 * dozens of them saying nothing a boot's own trace does not.
 */

export const OSPROFILER_TRACE_INFO_HEADER: string = "X-Trace-Info";
export const OSPROFILER_TRACE_HMAC_HEADER: string = "X-Trace-HMAC";

export interface OpenStackSignedHeaders {
  headers: Record<string, string>;
  // The OTLP trace id these make: base_id without its dashes.
  traceId: string | null;
}

export function signOpenStackRequest(data: {
  key: string;
  baseId: string;
}): OpenStackSignedHeaders {
  /*
   * parent_id is base_id, as the client's own first span has it (osprofiler/profiler.py,
   * _Profiler keeps [base_id, parent_id or base_id]). urlsafe_b64encode is what signed_pack writes.
   */
  const info: string = Buffer.from(
    JSON.stringify({ base_id: data.baseId, parent_id: data.baseId }),
    "utf8",
  )
    .toString("base64")
    .split("+")
    .join("-")
    .split("/")
    .join("_");

  return {
    headers: {
      [OSPROFILER_TRACE_INFO_HEADER]: info,
      [OSPROFILER_TRACE_HMAC_HEADER]: crypto
        .createHmac("sha1", Buffer.from(data.key, "utf8"))
        .update(info, "utf8")
        .digest("hex"),
    },
    traceId: readOpenStackTraceId(data.baseId),
  };
}
