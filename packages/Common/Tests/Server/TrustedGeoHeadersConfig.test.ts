import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * TRUSTED_GEO_COUNTRY_HEADER, TRUSTED_GEO_REGION_HEADER and
 * TRUSTED_GEO_CITY_HEADER name the request headers a CDN in front of
 * OneUptime writes the visitor's place into, which security emails read
 * (RequestLocation). A request header is the caller's own writing unless a
 * proxy overwrites it, so none is read unless the operator names it, and
 * anything that is not a header name reads nothing.
 */

const VARIABLES: Array<string> = [
  "TRUSTED_GEO_COUNTRY_HEADER",
  "TRUSTED_GEO_REGION_HEADER",
  "TRUSTED_GEO_CITY_HEADER",
];

type TrustedGeoHeaders = {
  country: string;
  region: string;
  city: string;
};

const saved: Record<string, string | undefined> = {};

for (const name of VARIABLES) {
  saved[name] = process.env[name];
}

afterEach(() => {
  for (const name of VARIABLES) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
});

// EnvironmentConfig read afresh, with these variables set and the rest unset.
function load(env: Record<string, string>): TrustedGeoHeaders {
  for (const name of VARIABLES) {
    delete process.env[name];
  }

  Object.assign(process.env, env);

  let headers: TrustedGeoHeaders | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const config: Record<
      string,
      unknown
    > = require("../../Server/EnvironmentConfig");
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    headers = {
      country: config["TrustedGeoCountryHeader"] as string,
      region: config["TrustedGeoRegionHeader"] as string,
      city: config["TrustedGeoCityHeader"] as string,
    };
  });

  return headers!;
}

describe("the trusted geo headers", () => {
  test("none is read by default", () => {
    expect(load({})).toEqual({ country: "", region: "", city: "" });
  });

  test("each names its header", () => {
    expect(
      load({
        TRUSTED_GEO_COUNTRY_HEADER: "cf-ipcountry",
        TRUSTED_GEO_REGION_HEADER: "cf-region",
        TRUSTED_GEO_CITY_HEADER: "cf-ipcity",
      }),
    ).toEqual({
      country: "cf-ipcountry",
      region: "cf-region",
      city: "cf-ipcity",
    });
  });

  test("a name is lowercased and trimmed, as Node keeps a request's header names", () => {
    expect(
      load({ TRUSTED_GEO_CITY_HEADER: "  CloudFront-Viewer-City  " }).city,
    ).toBe("cloudfront-viewer-city");
  });

  test("an underscore is part of a name", () => {
    expect(load({ TRUSTED_GEO_COUNTRY_HEADER: "x_geo_country" }).country).toBe(
      "x_geo_country",
    );
  });

  test.each([
    ["cf ipcity"],
    ["cf-ipcity\r\nx-injected: 1"],
    ["cf:ipcity"],
    ["cf-ipcity,cf-region"],
    ["a".repeat(129)],
    [""],
    ["   "],
  ])("%j is not a header name, and reads nothing", (value: string) => {
    expect(load({ TRUSTED_GEO_CITY_HEADER: value }).city).toBe("");
  });

  test("one bad name leaves the others", () => {
    expect(
      load({
        TRUSTED_GEO_COUNTRY_HEADER: "cf-ipcountry",
        TRUSTED_GEO_CITY_HEADER: "not a header",
      }),
    ).toEqual({ country: "cf-ipcountry", region: "", city: "" });
  });
});
