import { describe, expect, test } from "@jest/globals";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackCatalogService,
  findOpenStackEndpoint,
  getOpenStackCatalogRegions,
  getOpenStackComputeRootUrl,
  parseOpenStackCatalog,
  toOpenStackServiceBaseUrl,
} from "../../../Utils/OpenStack/OpenStackCatalog";
import { loadScene, recordedTokenBody } from "./Helpers/RecordedCloud";
import { JSONObject } from "Common/Types/JSON";

/*
 * Which URL answers for which service, per region, from the catalog in the token. A real
 * DevStack's first, then what other clouds' catalogs do differently.
 */

function endpoint(
  url: string,
  regionName: string,
  interfaceName: string = "public",
): JSONObject {
  return { url: url, region_id: regionName, interface: interfaceName };
}

const TWO_REGIONS: Array<OpenStackCatalogService> = parseOpenStackCatalog([
  {
    type: "compute",
    name: "nova",
    endpoints: [
      endpoint("https://one.example.com/compute/v2.1", "One"),
      endpoint("http://10.0.0.1:8774/v2.1", "One", "internal"),
      endpoint("https://two.example.com/compute/v2.1", "Two"),
    ],
  },
  {
    type: "volumev3",
    name: "cinderv3",
    endpoints: [endpoint("https://one.example.com/volume/v3/abc", "One")],
  },
  {
    type: "block-storage",
    name: "cinder",
    endpoints: [endpoint("https://two.example.com/volume/v3", "Two")],
  },
  {
    type: "metering",
    name: "ceilometer",
    endpoints: [endpoint("https://three.example.com/", "OnlyMetering")],
  },
]);

describe("what the catalog says", () => {
  test("a real cloud's catalog names its one region, and each service in it", () => {
    const catalog: Array<OpenStackCatalogService> = parseOpenStackCatalog(
      (
        recordedTokenBody(loadScene("hibiscus-ovn", "healthy"))[
          "token"
        ] as JSONObject
      )["catalog"],
    );

    expect(getOpenStackCatalogRegions(catalog)).toEqual(["RegionOne"]);

    for (const service of Object.values(OpenStackServiceType)) {
      expect({
        service,
        url: findOpenStackEndpoint({
          catalog,
          service,
          regionName: "RegionOne",
          endpointInterface: "public",
        })?.startsWith("https://openstack.example/"),
      }).toEqual({ service, url: true });
    }
  });

  test("the regions are those of the services OneUptime reads", () => {
    expect(getOpenStackCatalogRegions(TWO_REGIONS)).toEqual(["One", "Two"]);
  });

  test("anything else in the catalog is left alone, not a crash", () => {
    expect(parseOpenStackCatalog(undefined)).toEqual([]);
    expect(parseOpenStackCatalog("nope")).toEqual([]);
    expect(
      parseOpenStackCatalog([
        null,
        { type: "compute" },
        { type: "image", endpoints: [null, { interface: "public" }] },
      ]),
    ).toEqual([
      { type: "compute", name: "", endpoints: [] },
      { type: "image", name: "", endpoints: [] },
    ]);
  });

  test("an endpoint's region can be named either way", () => {
    expect(
      parseOpenStackCatalog([
        {
          type: "compute",
          endpoints: [
            {
              url: "https://a.example.com",
              interface: "public",
              region: "Older",
            },
          ],
        },
      ])[0]?.endpoints[0]?.regionName,
    ).toBe("Older");
  });
});

describe("finding a service in a region", () => {
  test("each region has its own URL", () => {
    expect(
      findOpenStackEndpoint({
        catalog: TWO_REGIONS,
        service: OpenStackServiceType.Compute,
        regionName: "Two",
        endpointInterface: "public",
      }),
    ).toBe("https://two.example.com/compute/v2.1");
  });

  test("the interface a person picked is what they get, and nothing else", () => {
    expect(
      findOpenStackEndpoint({
        catalog: TWO_REGIONS,
        service: OpenStackServiceType.Compute,
        regionName: "One",
        endpointInterface: "internal",
      }),
    ).toBe("http://10.0.0.1:8774/v2.1");

    expect(
      findOpenStackEndpoint({
        catalog: TWO_REGIONS,
        service: OpenStackServiceType.Compute,
        regionName: "Two",
        endpointInterface: "internal",
      }),
    ).toBeNull();
  });

  test("a service that is not there is null, which is what not deployed means", () => {
    expect(
      findOpenStackEndpoint({
        catalog: TWO_REGIONS,
        service: OpenStackServiceType.Network,
        regionName: "One",
        endpointInterface: "public",
      }),
    ).toBeNull();
  });

  test("Cinder is found as block-storage on a current catalog, and volumev3 on an older one", () => {
    expect(
      findOpenStackEndpoint({
        catalog: TWO_REGIONS,
        service: OpenStackServiceType.Volume,
        regionName: "Two",
        endpointInterface: "public",
      }),
    ).toBe("https://two.example.com/volume/v3");

    expect(
      findOpenStackEndpoint({
        catalog: TWO_REGIONS,
        service: OpenStackServiceType.Volume,
        regionName: "One",
        endpointInterface: "public",
      }),
    ).toBe("https://one.example.com/volume/v3/abc");
  });

  test("a catalog with both prefers the current name", () => {
    expect(
      findOpenStackEndpoint({
        catalog: parseOpenStackCatalog([
          {
            type: "volumev3",
            endpoints: [endpoint("https://old.example.com/v3", "R")],
          },
          {
            type: "block-storage",
            endpoints: [endpoint("https://new.example.com/v3", "R")],
          },
        ]),
        service: OpenStackServiceType.Volume,
        regionName: "R",
        endpointInterface: "public",
      }),
    ).toBe("https://new.example.com/v3");
  });

  test("the legacy compute service is never mistaken for Nova", () => {
    expect(
      findOpenStackEndpoint({
        catalog: parseOpenStackCatalog([
          {
            type: "compute_legacy",
            endpoints: [endpoint("https://old.example.com/v2/abc", "R")],
          },
        ]),
        service: OpenStackServiceType.Compute,
        regionName: "R",
        endpointInterface: "public",
      }),
    ).toBeNull();
  });
});

describe("where a service's own paths live", () => {
  test.each([
    [
      OpenStackServiceType.Compute,
      "https://c.example.com/compute/v2.1",
      "https://c.example.com/compute/v2.1",
    ],
    [
      OpenStackServiceType.Compute,
      "https://c.example.com/compute/v2.1/",
      "https://c.example.com/compute/v2.1",
    ],
    [
      OpenStackServiceType.Compute,
      "https://c.example.com:8774/v2/abcdef",
      "https://c.example.com:8774/v2.1",
    ],
    [
      OpenStackServiceType.Compute,
      "https://c.example.com:8774",
      "https://c.example.com:8774/v2.1",
    ],
    [
      OpenStackServiceType.Network,
      "https://c.example.com/networking",
      "https://c.example.com/networking/v2.0",
    ],
    [
      OpenStackServiceType.Network,
      "https://c.example.com:9696/",
      "https://c.example.com:9696/v2.0",
    ],
    [
      OpenStackServiceType.Network,
      "https://c.example.com:9696/v2.0",
      "https://c.example.com:9696/v2.0",
    ],
    [
      OpenStackServiceType.Image,
      "https://c.example.com/image",
      "https://c.example.com/image/v2",
    ],
    [
      OpenStackServiceType.Image,
      "https://c.example.com:9292/v2",
      "https://c.example.com:9292/v2",
    ],
    [
      OpenStackServiceType.Volume,
      "https://c.example.com/volume/v3",
      "https://c.example.com/volume/v3",
    ],
    [
      OpenStackServiceType.Volume,
      "https://c.example.com:8776/v3/abcdef",
      "https://c.example.com:8776/v3/abcdef",
    ],
    [
      OpenStackServiceType.Volume,
      "https://c.example.com:8776",
      "https://c.example.com:8776/v3",
    ],
    [
      OpenStackServiceType.Placement,
      "https://c.example.com/placement/",
      "https://c.example.com/placement",
    ],
  ])(
    "%s at %s reads under %s",
    (service: OpenStackServiceType, catalogUrl: string, baseUrl: string) => {
      expect(toOpenStackServiceBaseUrl(service, catalogUrl)).toBe(baseUrl);
    },
  );

  test("a URL written badly comes back for the transport to refuse", () => {
    expect(
      toOpenStackServiceBaseUrl(OpenStackServiceType.Network, "not a url"),
    ).toBe("not a url");
  });

  test.each([
    ["https://c.example.com/compute/v2.1", "https://c.example.com/compute/"],
    ["https://c.example.com:8774/v2.1", "https://c.example.com:8774/"],
  ])("Nova at %s says what it speaks at %s", (base: string, root: string) => {
    expect(getOpenStackComputeRootUrl(base)).toBe(root);
  });
});
