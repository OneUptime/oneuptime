import RequestOriginUtil, {
  DEFAULT_EMAIL_TIMEZONE,
  RequestOriginEmailVars,
  RequestOriginRequestLike,
  UNKNOWN_DEVICE,
} from "../../../../Server/Utils/RequestOrigin/RequestOriginUtil";
import RequestOrigin from "../../../../Types/RequestOrigin";
import Timezone from "../../../../Types/Timezone";
import { describe, expect, it } from "@jest/globals";

/*
 * Where a request came from, for the security email it causes
 * (RequestOriginUtil): the address ClientIp trusts, the place the named CDN
 * headers carry, the device UserAgentDevice can name - and the variables an
 * email's request rows read, which hide whatever is not known.
 */

const CHROME_MAC: string =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type BuildRequestFunction = (options: {
  headers?: Record<string, string | Array<string>> | undefined;
  remoteAddress?: string | undefined;
}) => RequestOriginRequestLike;

const buildRequest: BuildRequestFunction = (options: {
  headers?: Record<string, string | Array<string>> | undefined;
  remoteAddress?: string | undefined;
}): RequestOriginRequestLike => {
  return {
    headers: options.headers || {},
    socket: { remoteAddress: options.remoteAddress },
  } as unknown as RequestOriginRequestLike;
};

describe("fromRequest", () => {
  it("reads the address, the place and the device", () => {
    const origin: RequestOrigin = RequestOriginUtil.fromRequest(
      buildRequest({
        headers: {
          "x-forwarded-for": "203.0.113.7",
          "user-agent": CHROME_MAC,
          "cf-ipcity": "Berlin",
          "cf-ipcountry": "DE",
        },
        remoteAddress: "10.0.0.2",
      }),
      {
        trustedGeoHeaders: {
          country: "cf-ipcountry",
          city: "cf-ipcity",
        },
      },
    );

    expect(origin).toEqual({
      ipAddress: "203.0.113.7",
      location: "Berlin, Germany",
      device: "Chrome 130 on macOS",
    });
  });

  it("the address is the one ClientIp trusts, not the one the caller wrote first", () => {
    const origin: RequestOrigin = RequestOriginUtil.fromRequest(
      buildRequest({
        headers: { "x-forwarded-for": "198.51.100.5, 203.0.113.7" },
        remoteAddress: "10.0.0.2",
      }),
    );

    expect(origin.ipAddress).toBe("203.0.113.7");
  });

  it("names no place from headers nobody named", () => {
    const origin: RequestOrigin = RequestOriginUtil.fromRequest(
      buildRequest({
        headers: {
          "x-forwarded-for": "203.0.113.7",
          "cf-ipcity": "Somewhere The Requester Chose",
          "cf-ipcountry": "DE",
        },
      }),
      { trustedGeoHeaders: {} },
    );

    expect(origin.location).toBeUndefined();
  });

  it("by default reads the headers TRUSTED_GEO_*_HEADER name, which are none", () => {
    expect(RequestOriginUtil.getTrustedGeoHeaders()).toEqual({
      country: "",
      region: "",
      city: "",
    });

    const origin: RequestOrigin = RequestOriginUtil.fromRequest(
      buildRequest({
        headers: { "x-forwarded-for": "203.0.113.7", "cf-ipcountry": "DE" },
      }),
    );

    expect(origin.location).toBeUndefined();
  });

  it("a request with no headers at all describes nothing, and does not throw", () => {
    const origin: RequestOrigin = RequestOriginUtil.fromRequest(
      {} as unknown as RequestOriginRequestLike,
    );

    expect(origin).toEqual({
      ipAddress: undefined,
      location: undefined,
      device: undefined,
    });
  });
});

describe("getEmailVars", () => {
  const AT: Date = new Date("2026-11-03T13:15:00.000Z");

  it("the time is in the recipient's own time zone, and names it", () => {
    const vars: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({
      at: AT,
      timezone: Timezone.EuropeBerlin,
    });

    expect(vars.requestedAt).toContain("Nov 3, 2026");
    expect(vars.requestedAt).toContain("2:15 PM");
    expect(vars.requestedAt).toContain("CET");
  });

  it("without a time zone of their own, the time is in UTC, and says so", () => {
    expect(DEFAULT_EMAIL_TIMEZONE).toBe(Timezone.UTC);

    for (const timezone of [undefined, null]) {
      const vars: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({
        at: AT,
        timezone: timezone,
      });

      expect(vars.requestedAt).toContain("1:15 PM");
      expect(vars.requestedAt).toContain("UTC");
    }
  });

  it("the time is now when no moment is given", () => {
    const vars: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({});

    expect(vars.requestedAt).toContain(String(new Date().getUTCFullYear()));
  });

  it("carries the address, the place and the device", () => {
    const vars: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({
      at: AT,
      origin: {
        ipAddress: "203.0.113.7",
        location: "Berlin, Germany",
        device: "Chrome 130 on macOS",
      },
    });

    expect(vars.requestIpAddress).toBe("203.0.113.7");
    expect(vars.requestLocation).toBe("Berlin, Germany");
    expect(vars.requestDevice).toBe("Chrome 130 on macOS");
  });

  it("a device nobody could name is an unknown device; a missing place is no place", () => {
    const vars: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({
      at: AT,
      origin: { ipAddress: "203.0.113.7" },
    });

    expect(vars.requestDevice).toBe(UNKNOWN_DEVICE);
    expect(vars.requestDevice).toBe("Unknown device");
    expect(vars.requestLocation).toBe("");
  });

  it("with no request to describe, only the time is said", () => {
    const vars: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({
      at: AT,
    });

    expect(vars.requestedAt.length).toBeGreaterThan(0);
    expect(vars.requestIpAddress).toBe("");
    expect(vars.requestLocation).toBe("");
    expect(vars.requestDevice).toBe("");
  });

  it("every variable is a string, as an email's vars are", () => {
    const vars: RequestOriginEmailVars = RequestOriginUtil.getEmailVars({
      at: AT,
      origin: RequestOriginUtil.fromRequest(
        buildRequest({
          headers: { "x-forwarded-for": "2001:db8::1", "user-agent": "curl/8" },
        }),
      ),
    });

    expect(vars).toEqual({
      requestedAt: expect.any(String),
      requestIpAddress: "2001:db8::1",
      requestLocation: "",
      requestDevice: "curl",
    });
  });
});
