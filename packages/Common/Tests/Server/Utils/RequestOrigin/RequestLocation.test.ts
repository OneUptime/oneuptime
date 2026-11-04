import RequestLocation, {
  MAX_PLACE_NAME_LENGTH,
  TrustedGeoHeaderNames,
} from "../../../../Server/Utils/RequestOrigin/RequestLocation";
import { UserAgentRequestHeaders } from "../../../../Server/Utils/RequestOrigin/UserAgentDevice";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, it, test } from "@jest/globals";

/*
 * Roughly where a request came from, as the CDN in front of an installation
 * says in the headers its operator named (RequestLocation): read only from
 * those headers, decoded the way CDNs encode them, and nothing that is not
 * written like a place name.
 */

const CLOUDFLARE: TrustedGeoHeaderNames = {
  country: "cf-ipcountry",
  region: "cf-region",
  city: "cf-ipcity",
};

type LocationFunction = (
  headers: UserAgentRequestHeaders,
  headerNames?: TrustedGeoHeaderNames,
) => string | undefined;

const locationOf: LocationFunction = (
  headers: UserAgentRequestHeaders,
  headerNames: TrustedGeoHeaderNames = CLOUDFLARE,
): string | undefined => {
  return RequestLocation.fromHeaders({
    headers: headers,
    headerNames: headerNames,
  });
};

describe("reads the headers the operator named", () => {
  it("city, region and country, in that order", () => {
    expect(
      locationOf({
        "cf-ipcity": "San Francisco",
        "cf-region": "California",
        "cf-ipcountry": "US",
      }),
    ).toBe("San Francisco, California, United States");
  });

  it("a country code becomes the country's name", () => {
    expect(locationOf({ "cf-ipcountry": "DE" })).toBe("Germany");
    expect(locationOf({ "cf-ipcountry": "in" })).toBe("India");
  });

  it("a country written as a name is kept as it is", () => {
    expect(
      locationOf(
        { "cloudfront-viewer-country-name": "Germany" },
        { country: "cloudfront-viewer-country-name" },
      ),
    ).toBe("Germany");
  });

  it("names a place once: a city that is also its region or country", () => {
    expect(
      locationOf({
        "cf-ipcity": "Berlin",
        "cf-region": "Berlin",
        "cf-ipcountry": "DE",
      }),
    ).toBe("Berlin, Germany");
    expect(
      locationOf({
        "cf-ipcity": "Singapore",
        "cf-region": "",
        "cf-ipcountry": "SG",
      }),
    ).toBe("Singapore");
  });

  it("whatever part is missing is left out", () => {
    expect(locationOf({ "cf-ipcity": "Lyon", "cf-ipcountry": "FR" })).toBe(
      "Lyon, France",
    );
    expect(locationOf({ "cf-region": "Ontario" })).toBe("Ontario");
  });

  it("names nothing when no header is named, whatever the request carries", () => {
    expect(
      locationOf(
        {
          "cf-ipcity": "Berlin",
          "cf-region": "Berlin",
          "cf-ipcountry": "DE",
        },
        {},
      ),
    ).toBeUndefined();
    expect(
      locationOf({ "cf-ipcountry": "DE" }, { country: "", city: "" }),
    ).toBeUndefined();
  });

  it("names nothing when the named headers are not there", () => {
    expect(locationOf({})).toBeUndefined();
    expect(
      RequestLocation.fromHeaders({
        headers: undefined,
        headerNames: CLOUDFLARE,
      }),
    ).toBeUndefined();
  });

  it("reads the first of a header sent twice", () => {
    expect(locationOf({ "cf-ipcountry": ["NL", "DE"] })).toBe("Netherlands");
  });
});

describe("country codes that are not a country", () => {
  test.each([["XX"], ["xx"], ["ZZ"]])("%s names no country", (code: string) => {
    expect(locationOf({ "cf-ipcountry": code })).toBeUndefined();
  });

  it("Tor's code says Tor", () => {
    expect(locationOf({ "cf-ipcountry": "T1" })).toBe("Tor network");
  });

  it("a code no country has is shown as it came", () => {
    expect(RequestLocation.describeCountry("QQ")).toBe("QQ");
  });
});

describe("decoded the way CDNs encode a place", () => {
  it("Vercel percent-encodes a city", () => {
    expect(
      locationOf(
        {
          "x-vercel-ip-city": "S%C3%A3o%20Paulo",
          "x-vercel-ip-country": "BR",
        },
        { city: "x-vercel-ip-city", country: "x-vercel-ip-country" },
      ),
    ).toBe("São Paulo, Brazil");
  });

  it("UTF-8 bytes that Node read as Latin-1 are read as UTF-8", () => {
    const asNodeReadsIt: string = Buffer.from("München", "utf8").toString(
      "latin1",
    );

    expect(asNodeReadsIt).not.toBe("München");
    expect(locationOf({ "cf-ipcity": asNodeReadsIt })).toBe("München");
  });

  it("Latin-1 that is not UTF-8 is kept as it is", () => {
    expect(locationOf({ "cf-ipcity": "Malmö" })).toBe("Malmö");
  });

  it("a percent sign that is not percent-encoding is not a place name", () => {
    expect(locationOf({ "cf-ipcity": "100%ZZ" })).toBeUndefined();
  });

  it("place names in any script, with the punctuation they use", () => {
    expect(locationOf({ "cf-ipcity": "東京" })).toBe("東京");
    expect(locationOf({ "cf-ipcity": "St. John's" })).toBe("St. John's");
    expect(locationOf({ "cf-ipcity": "Saint-Étienne" })).toBe("Saint-Étienne");
  });

  it("runs of white space and control characters become one space", () => {
    expect(locationOf({ "cf-ipcity": "  New \t  York\u0000 " })).toBe(
      "New York",
    );
  });
});

describe("nothing that is not written like a place name", () => {
  test.each([
    ["<script>alert(1)</script>"],
    ["https://evil.example/reset"],
    ["Call +1 800 555 0100"],
    ["Berlin; DROP TABLE"],
    ["{{brandName}}"],
    ["evil@example.com"],
  ])("%s", (value: string) => {
    expect(locationOf({ "cf-ipcity": value })).toBeUndefined();
  });

  it("nor anything longer than a place name", () => {
    expect(locationOf({ "cf-ipcity": "A".repeat(MAX_PLACE_NAME_LENGTH) })).toBe(
      "A".repeat(MAX_PLACE_NAME_LENGTH),
    );
    expect(
      locationOf({ "cf-ipcity": "A".repeat(MAX_PLACE_NAME_LENGTH + 1) }),
    ).toBeUndefined();
  });

  it("a header of megabytes is refused without reading it all", () => {
    const header: string = "%41".repeat(1024 * 1024);
    const timed: FastestRun<string | undefined> = fastestRun({
      run: (): string | undefined => {
        return locationOf({ "cf-ipcity": header });
      },
      limitInMs: 1000,
    });

    expect(timed.result).toBeUndefined();
    expect(timed.inMs).toBeLessThan(1000);
  });

  it("one bad part leaves the others", () => {
    expect(
      locationOf({
        "cf-ipcity": "<b>Berlin</b>",
        "cf-ipcountry": "DE",
      }),
    ).toBe("Germany");
  });
});
