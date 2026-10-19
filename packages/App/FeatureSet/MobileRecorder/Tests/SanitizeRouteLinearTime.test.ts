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
  ])("%s", (route: string, scrubbed: string) => {
    expect(sanitizeRoute(route)).toBe(scrubbed);
  });

  test("a segment that is no address is kept", () => {
    expect(sanitizeRoute("/settings/profile")).toBe("/settings/profile");
  });
});
