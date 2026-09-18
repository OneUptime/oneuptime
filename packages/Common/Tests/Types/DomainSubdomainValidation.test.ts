import Domain from "../../Types/Domain";
import URL from "../../Types/API/URL";
import { describe, expect, test } from "@jest/globals";

/*
 * StatusPageDomain.subdomain and DashboardDomain.subdomain are ShortText that
 * used to be trimmed and lower-cased and nothing else. Both services build
 * fullDomain as `${subdomain}.${baseDomain}` and then interpolate it into
 * "https://" + fullDomain + "/status-page-api/...", which the certificate
 * cron fetches unattended every 15 minutes. Because URL parsing takes
 * everything before the first "/" as the host, a subdomain carrying a "/"
 * gave an attacker the host, the port and the path of that request.
 */

describe("Domain.isValidSubdomain accepts ordinary subdomains", () => {
  const valid: Array<string> = [
    "status",
    "dashboard",
    "status-page",
    "eu-west-1",
    "a",
    "status.eu",
    "deep.nested.label",
    "s1",
    "1status",
  ];

  test.each(valid)("accepts %s", (subdomain: string) => {
    expect(Domain.isValidSubdomain(subdomain)).toBe(true);
  });
});

describe("Domain.isValidSubdomain rejects anything that is not a DNS label", () => {
  const invalid: Array<string> = [
    // The metadata-endpoint injection this exists to stop.
    "169.254.169.254/latest/meta-data/#",
    "169.254.169.254/latest/meta-data/iam/security-credentials/#",
    "status/../../admin",
    "status/path",
    // Scheme, port, credentials, query, fragment.
    "http://169.254.169.254",
    "169.254.169.254:80",
    "user@169.254.169.254",
    "status?x=1",
    "status#frag",
    "status\\evil",
    // Structural junk.
    "-status",
    "status-",
    "sta tus",
    "",
    "@",
    ".",
    "status..double",
    ".status",
    "status.",
  ];

  test.each(invalid)("rejects %s", (subdomain: string) => {
    expect(Domain.isValidSubdomain(subdomain)).toBe(false);
  });

  test("rejects a label longer than 63 characters", () => {
    expect(Domain.isValidSubdomain("a".repeat(63))).toBe(true);
    expect(Domain.isValidSubdomain("a".repeat(64))).toBe(false);
  });
});

describe("the injection this blocks, end to end", () => {
  test("an unvalidated subdomain would have redirected the cert check to metadata", () => {
    /*
     * Demonstrates why a subdomain check is the fix rather than trusting the
     * URL builder: with the malicious label in place, the host of the
     * resulting URL is the metadata endpoint and the base domain has been
     * demoted into the path.
     */
    const maliciousSubdomain: string = "169.254.169.254/latest/meta-data/#";
    const baseDomain: string = "example.com";
    const fullDomain: string = `${maliciousSubdomain}.${baseDomain}`;

    const url: URL = URL.fromString(
      "https://" + fullDomain + "/status-page-api/cname-verification/token",
    );

    expect(url.hostname.hostname).toBe("169.254.169.254");

    // And the validator refuses to let that subdomain be stored at all.
    expect(Domain.isValidSubdomain(maliciousSubdomain)).toBe(false);
  });
});
