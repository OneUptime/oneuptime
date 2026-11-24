import ProbeKeyHeaders, {
  PROBE_ID_HEADER,
  PROBE_KEY_HEADER,
  ProbeKeyHeadersRead,
} from "../../../Types/Probe/ProbeKeyHeaders";
import Dictionary from "../../../Types/Dictionary";
import { describe, expect, test } from "@jest/globals";
import http from "http";

/*
 * A PROBE'S ID AND KEY, IN A COLLECTION UPLOAD'S HEADERS (#10222).
 *
 * OneUptime checks a collection's key from these headers before it reads a
 * byte of the body. An operator may set PROBE_KEY to anything, and an HTTP
 * header can carry neither a character beyond Latin-1 nor the spaces at
 * either end of a value, so each value travels URI-encoded: whatever the key
 * is, the request can be sent, and the key arrives as it was set.
 */

const PROBE_ID: string = "11111111-2222-4333-8444-555555555555";

const KEYS: Array<string> = [
  // As the dashboard issues one.
  "0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601",
  // As an operator may type one.
  "pr0be-(key)!*~Zq9Lm2Xv8Nc4Bt6Hj1Kp",
  " spaces at both ends ",
  "clé 東京 Grüße 🚀",
  'quotes " and \\ backslashes',
  "percent %41 %zz signs",
  "a+plus&and=equals?question#hash",
  "line\nbreak\r\ttab",
];

describe("the headers", () => {
  test("are named, lower-cased as they arrive, apart from every other header", () => {
    expect(PROBE_ID_HEADER).toBe("x-oneuptime-probe-id");
    expect(PROBE_KEY_HEADER).toBe("x-oneuptime-probe-key");
  });

  test("carry any key a probe can have as a value HTTP can send", () => {
    for (const probeKey of KEYS) {
      const headers: Dictionary<string> = ProbeKeyHeaders.build({
        probeId: PROBE_ID,
        probeKey: probeKey,
      });

      expect(Object.keys(headers).sort()).toEqual(
        [PROBE_ID_HEADER, PROBE_KEY_HEADER].sort(),
      );

      for (const [name, value] of Object.entries(headers)) {
        // What Node's own client checks before it sends a header.
        expect(() => {
          http.validateHeaderValue(name, value);
        }).not.toThrow();
        // Nothing an HTTP parser trims from either end.
        expect(value).toBe(value.trim());
      }
    }
  });

  test("bring the key and id back as they were set", () => {
    for (const probeKey of KEYS) {
      const read: ProbeKeyHeadersRead | null = ProbeKeyHeaders.read(
        ProbeKeyHeaders.build({ probeId: PROBE_ID, probeKey: probeKey }),
      );

      expect({ probeKey, read }).toEqual({
        probeKey,
        read: { probeId: PROBE_ID, probeKey: probeKey },
      });
    }
  });

  test("are not sent by a probe that has no key or no id: its requests are refused whatever they carry", () => {
    for (const data of [
      { probeId: PROBE_ID, probeKey: "" },
      { probeId: PROBE_ID, probeKey: undefined },
      { probeId: PROBE_ID, probeKey: null },
      { probeId: "", probeKey: "key" },
      { probeId: null, probeKey: "key" },
    ]) {
      expect(ProbeKeyHeaders.build(data)).toEqual({});
    }
  });
});

describe("what a request's headers say", () => {
  test("nothing, when they carry neither: an older probe, whose key is in its body", () => {
    expect(ProbeKeyHeaders.read({})).toBeNull();
    expect(ProbeKeyHeaders.read(undefined)).toBeNull();
    expect(ProbeKeyHeaders.read(null)).toBeNull();
    expect(
      ProbeKeyHeaders.read({
        "content-type": "application/json",
        "content-encoding": "gzip",
        "x-oneuptime-ingestion-key": "not a probe's",
      }),
    ).toBeNull();
  });

  test("a missing one, when they carry the other", () => {
    expect(ProbeKeyHeaders.read({ [PROBE_ID_HEADER]: PROBE_ID })).toEqual({
      probeId: PROBE_ID,
      probeKey: null,
    });
    expect(ProbeKeyHeaders.read({ [PROBE_KEY_HEADER]: "key" })).toEqual({
      probeId: null,
      probeKey: "key",
    });
  });

  test("a missing one, for one sent empty or as no URI-encoded text", () => {
    expect(
      ProbeKeyHeaders.read({
        [PROBE_ID_HEADER]: "",
        [PROBE_KEY_HEADER]: "%E0%A4%A",
      }),
    ).toEqual({ probeId: null, probeKey: null });
  });

  test("the first of a header sent twice", () => {
    expect(
      ProbeKeyHeaders.read({
        [PROBE_ID_HEADER]: [PROBE_ID, "another"],
        [PROBE_KEY_HEADER]: ["first%20key", "second"],
      }),
    ).toEqual({ probeId: PROBE_ID, probeKey: "first key" });
  });
});
