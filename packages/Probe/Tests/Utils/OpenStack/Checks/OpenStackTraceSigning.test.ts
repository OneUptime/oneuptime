import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import {
  OSPROFILER_TRACE_HMAC_HEADER,
  OSPROFILER_TRACE_INFO_HEADER,
  OpenStackSignedHeaders,
  signOpenStackRequest,
} from "../../../../Utils/OpenStack/Checks/OpenStackTraceSigning";

/*
 * What a service's OSProfiler reads a signed request by. Checked here against its own rule as
 * osprofiler/utils.py writes it (signed_unpack): the HMAC-SHA1 of the base64 text as sent, under a
 * key the service holds, and JSON with base_id and parent_id inside. The rig checks the same
 * headers with a real OSProfiler (Tests/Ops/openstack-e2e/checks-record.sh).
 */

const KEY: string = "the-key-in-hmac-keys";
const BASE_ID: string = "4e3e0ec6-2938-40b1-8504-09eb1d4b0dee";

function signed(): OpenStackSignedHeaders {
  return signOpenStackRequest({ key: KEY, baseId: BASE_ID });
}

describe("signing a request as OSProfiler reads one", () => {
  test("the headers are the ones osprofiler/web.py reads", () => {
    expect(OSPROFILER_TRACE_INFO_HEADER).toBe("X-Trace-Info");
    expect(OSPROFILER_TRACE_HMAC_HEADER).toBe("X-Trace-HMAC");
  });

  test("a fixed answer, worked out by hand from osprofiler/utils.py", () => {
    /*
     * base64.urlsafe_b64encode(b'{"base_id":"4e3e0ec6-2938-40b1-8504-09eb1d4b0dee",
     * "parent_id":"4e3e0ec6-2938-40b1-8504-09eb1d4b0dee"}'), and hmac.new(key, data, sha1).
     */
    expect(signed().headers).toEqual({
      "X-Trace-Info":
        "eyJiYXNlX2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIiwicGFyZW50X2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIn0=",
      "X-Trace-HMAC": crypto
        .createHmac("sha1", KEY)
        .update(
          "eyJiYXNlX2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIiwicGFyZW50X2lkIjoiNGUzZTBlYzYtMjkzOC00MGIxLTg1MDQtMDllYjFkNGIwZGVlIn0=",
        )
        .digest("hex"),
    });
  });

  test("what is inside is base_id, and parent_id the same, as the client's first span has it", () => {
    const info: string = signed().headers["X-Trace-Info"] as string;

    expect(
      JSON.parse(
        Buffer.from(
          info.split("-").join("+").split("_").join("/"),
          "base64",
        ).toString("utf8"),
      ),
    ).toEqual({ base_id: BASE_ID, parent_id: BASE_ID });
  });

  test("the signature is over the very text sent, and verifies only under the same key", () => {
    const headers: Record<string, string> = signed().headers;
    const verify: (key: string) => boolean = (key: string): boolean => {
      return (
        crypto
          .createHmac("sha1", key)
          .update(headers["X-Trace-Info"] as string)
          .digest("hex") === headers["X-Trace-HMAC"]
      );
    };

    expect(verify(KEY)).toBe(true);
    expect(verify("another-key")).toBe(false);
  });

  test("urlsafe: never a + or a /, which would not survive being read back", () => {
    for (let index: number = 0; index < 200; index++) {
      const baseId: string = `4e3e0ec6-2938-40b1-8504-${String(index).padStart(12, "f")}`;
      const info: string = signOpenStackRequest({ key: KEY, baseId: baseId })
        .headers["X-Trace-Info"] as string;

      expect(info).not.toContain("+");
      expect(info).not.toContain("/");
    }
  });

  test("its trace is the id the driver stores: base_id without its dashes", () => {
    expect(signed().traceId).toBe("4e3e0ec6293840b1850409eb1d4b0dee");
  });

  test("the key is not in anything it makes", () => {
    expect(JSON.stringify(signed())).not.toContain(KEY);
  });
});
