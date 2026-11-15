import { sanitizeRoute } from "../src/Sanitize";

/*
 * ---------------------------------------------------------------------------
 * A ROUTE IS SCRUBBED IN TIME IN LINE WITH ITS LENGTH.
 *
 * The recorder scrubs every route the app is opened at - a deep link
 * included, which anybody can write - before it leaves the device, and
 * takes an email-shaped segment out. That shape check is bounded to the
 * sizes a real address has and anchored, so a segment of 400,000
 * characters is read once, in well under two seconds, and a real address
 * is still taken out.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("sanitizeRoute reads a long segment in time in line with its length", () => {
  test.each([
    [
      "an address, dotted labels, then another at",
      "a@" + repeat("a.", LENGTH) + "@",
    ],
    [
      "a long first part, dotted labels, then another at",
      repeat("a", LENGTH / 2) + "@" + repeat("a.", LENGTH / 2) + "@",
    ],
    ["an address then dotted labels", "a@" + repeat("a.", LENGTH)],
    ["an at then dotted labels", repeat("a@a.", LENGTH)],
    // #8385: a token's dotted parts, and a segment read twice.
    ["a token's header then dotted parts", "eyJ" + repeat("a.", LENGTH)],
    [
      "a long header then one part too many",
      `eyJ${repeat("a", LENGTH)}.a.b.c.d.e`,
    ],
    ["headers over and over", repeat("eyJabcdefgh.", LENGTH)],
    ["escapes of escapes", repeat("%2525", LENGTH)],
    // #8489: standard base64's "+", and "=" that is no padding.
    [
      "a token in standard base64, then too many =",
      repeat("a+", LENGTH) + "===",
    ],
    ["equals signs", repeat("=", LENGTH)],
  ])("%s", (_label: string, segment: string) => {
    const startedAt: number = Date.now();

    sanitizeRoute(`/users/${segment}`);

    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

describe("sanitizeRoute still takes an address out", () => {
  test.each([
    ["/users/alice@example.com/profile", "/users/[redacted]/profile"],
    ["/users/alice%40example.com", "/users/[redacted]"],
    ["/u/first.last+tag@mail.example.co.uk", "/u/[redacted]"],
    // #8385: an address an app escaped twice.
    ["/users/alice%2540example.com", "/users/[redacted]"],
  ])("%s", (route: string, scrubbed: string) => {
    expect(sanitizeRoute(route)).toBe(scrubbed);
  });

  test("a segment that is no address is kept", () => {
    expect(sanitizeRoute("/settings/profile")).toBe("/settings/profile");
  });
});

/*
 * #8385: a JSON Web Token's dots kept it out of the token rule, so a route
 * that carried one - a deep link's sign-in callback - left the device
 * whole. A header is base64url JSON, so it starts "eyJ".
 */
describe("sanitizeRoute takes a JSON Web Token out", () => {
  const JWT: string =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  test.each([
    [`/auth/callback/${JWT}`, "/auth/callback/[redacted]"],
    [`myapp://open/session/${JWT}?next=home`, "/session/[redacted]"],
    ["/t/eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0./open", "/t/[redacted]/open"],
    [
      "/s/eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..T8xa6fPSdTEQd7Qv.lGzN6s5CeqZXyO8I8.XFBoMYUZodetZdvTiFvSkQ",
      "/s/[redacted]",
    ],
    ["/t/eyJhbGciOiJIUzI1NiJ9%252EeyJzdWIiOiIxIn0%252Esig", "/t/[redacted]"],
  ])("%s", (route: string, scrubbed: string) => {
    expect(sanitizeRoute(route)).toBe(scrubbed);
  });

  test.each([
    "/files/report-2026-11-15.pdf",
    "/docs/v14.2.0/notes",
    "/eyJ/eyJsb2.png",
    "/sale/50%2525-off",
  ])("keeps %s, which names no one", (route: string) => {
    expect(sanitizeRoute(route)).toBe(route);
  });
});

/*
 * #8489: a token in standard base64 keeps its "+" and its "=" padding in a
 * route, and the token rule read base64url alone.
 */
describe("sanitizeRoute takes a token in standard base64 out", () => {
  test.each([
    [
      "/verify/dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw==",
      "/verify/[redacted]",
    ],
    ["/reset/k3J+vT9mL4pR7sW1yB6nC3dF5gH0jKq2Zx8", "/reset/[redacted]"],
    [
      "/confirm/k3J%2BvT9mL4pR7sW1yB6nC3dF5gH0jK%2Fq2Zx8%3D%3D/done",
      "/confirm/[redacted]/done",
    ],
  ])("%s", (route: string, scrubbed: string) => {
    expect(sanitizeRoute(route)).toBe(scrubbed);
  });

  test.each(["/learn/c++", "/filter/size=large", "/a/b=c=d"])(
    "keeps %s, which names no one",
    (route: string) => {
      expect(sanitizeRoute(route)).toBe(route);
    },
  );
});
