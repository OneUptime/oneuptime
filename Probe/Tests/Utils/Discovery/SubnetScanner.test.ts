// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner from "../../../Utils/Discovery/SubnetScanner";
import { describe, expect, it } from "@jest/globals";

describe("SubnetScanner.countHosts", () => {
  it("counts a /24 as 254 usable hosts (excludes network + broadcast)", () => {
    expect(SubnetScanner.countHosts("192.168.1.0/24")).toBe(254);
  });

  it("counts a /30 as 2 usable hosts", () => {
    expect(SubnetScanner.countHosts("10.0.0.0/30")).toBe(2);
  });

  it("counts /31 and /32 as every address (no network/broadcast exclusion)", () => {
    expect(SubnetScanner.countHosts("10.0.0.0/31")).toBe(2);
    expect(SubnetScanner.countHosts("10.0.0.5/32")).toBe(1);
  });

  it("counts a /8 as ~16.7M without allocating them", () => {
    /*
     * The whole point: this must be derivable from the prefix, not by
     * building the address array.
     */
    expect(SubnetScanner.countHosts("10.0.0.0/8")).toBe(Math.pow(2, 24) - 2);
  });

  it("returns 0 for malformed or out-of-range CIDRs", () => {
    expect(SubnetScanner.countHosts("not-a-cidr")).toBe(0);
    expect(SubnetScanner.countHosts("10.0.0.0")).toBe(0);
    expect(SubnetScanner.countHosts("10.0.0.0/33")).toBe(0);
    expect(SubnetScanner.countHosts("999.0.0.0/24")).toBe(0);
  });

  it("agrees with expandCidr for reasonable subnets", () => {
    for (const cidr of ["192.168.1.0/29", "172.16.5.0/28", "10.1.1.0/30"]) {
      expect(SubnetScanner.countHosts(cidr)).toBe(
        SubnetScanner.expandCidr(cidr).length,
      );
    }
  });
});

describe("SubnetScanner.scan oversized-subnet guard", () => {
  it("rejects an oversized subnet before expanding it (no OOM)", async () => {
    // A /8 would materialize ~16.7M strings if the guard ran after expansion.
    await expect(SubnetScanner.scan({ cidr: "10.0.0.0/8" })).rejects.toThrow(
      /exceeding the/,
    );
  });

  it("rejects a malformed CIDR", async () => {
    await expect(SubnetScanner.scan({ cidr: "not-a-cidr" })).rejects.toThrow(
      /Invalid or empty CIDR/,
    );
  });
});
