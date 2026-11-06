import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import {
  OSPROFILER_TRACE_HMAC_HEADER,
  OSPROFILER_TRACE_INFO_HEADER,
  getOpenStackTraceHeaders,
} from "../../../../Server/Utils/OpenStack/OpenStackTraceSigning";

/*
 * What a request carries to be traced without OSProfiler on the side that sends it. The seam
 * #5749's lifecycle check signs through.
 *
 * The expected values below are what Tests/Ops/openstack-e2e/traces-read.py's `sign` prints for
 * this key and ID: that is what its signed-by-header scene sends to a real Nova.
 */

const TRACE_ID: string = "4e3e0ec6-2938-40b1-8504-09eb1d4b0dee";

describe("signing a request for OSProfiler", () => {
  test("writes exactly what the rig sent a real Nova", () => {
    expect(
      getOpenStackTraceHeaders({ hmacKey: "sekret", traceId: TRACE_ID }),
    ).toEqual({
      "X-Trace-Info":
        "eyJiYXNlX2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIiwicGFyZW50X2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIn0=",
      "X-Trace-HMAC": "9478501588ee443de42ca9e1a9c1cd154bb35fbe",
    });
  });

  test("holds what OSProfiler's middleware reads, and not the key", () => {
    const headers: Record<string, string> = getOpenStackTraceHeaders({
      hmacKey: "sekret",
      traceId: TRACE_ID,
      parentId: "9d1f0f6e-1f3b-4d6a-8a55-7a4f7b1d2c33",
    });
    const info: string = Buffer.from(
      headers[OSPROFILER_TRACE_INFO_HEADER]!,
      "base64url",
    ).toString("utf8");

    expect(JSON.parse(info)).toEqual({
      base_id: TRACE_ID,
      parent_id: "9d1f0f6e-1f3b-4d6a-8a55-7a4f7b1d2c33",
    });
    expect(info).not.toContain("sekret");
    expect(JSON.stringify(headers)).not.toContain("sekret");
  });

  test("the signature is over the info as it is sent, so a service can check it", () => {
    const headers: Record<string, string> = getOpenStackTraceHeaders({
      hmacKey: "another key",
      traceId: TRACE_ID,
    });

    expect(headers[OSPROFILER_TRACE_HMAC_HEADER]).toBe(
      crypto
        .createHmac("sha1", "another key")
        .update(headers[OSPROFILER_TRACE_INFO_HEADER]!)
        .digest("hex"),
    );
  });

  test("a different key is a different signature, which a service ignores", () => {
    expect(
      getOpenStackTraceHeaders({ hmacKey: "one", traceId: TRACE_ID })[
        OSPROFILER_TRACE_HMAC_HEADER
      ],
    ).not.toBe(
      getOpenStackTraceHeaders({ hmacKey: "two", traceId: TRACE_ID })[
        OSPROFILER_TRACE_HMAC_HEADER
      ],
    );
  });

  test("the URL-safe alphabet, as Python's urlsafe_b64encode writes it", () => {
    for (let index: number = 0; index < 64; index++) {
      const headers: Record<string, string> = getOpenStackTraceHeaders({
        hmacKey: "sekret",
        traceId: `${TRACE_ID}${"?".repeat(index)}>>>`,
      });

      expect(headers[OSPROFILER_TRACE_INFO_HEADER]).not.toContain("+");
      expect(headers[OSPROFILER_TRACE_INFO_HEADER]).not.toContain("/");
    }
  });
});
