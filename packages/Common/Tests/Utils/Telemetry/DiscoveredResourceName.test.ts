import { describe, expect, test } from "@jest/globals";
import {
  getCloudEnvironmentNameFromIdentity,
  getNameFromIdentity,
} from "../../../Utils/Telemetry/DiscoveredResourceName";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatformDescriptor,
  buildCloudEnvironmentKey,
  buildCloudEnvironmentName,
} from "../../../Types/Cloud/CloudPlatform";

/*
 * What a resource found in telemetry is called when nobody names it: the
 * rule the Dashboard's create forms fill the display name in with, and the
 * services fill a missing name in with. Discovery names its rows the same
 * way (HostService.findOrCreateByHostIdentifier and its siblings, and
 * OtelIngestBaseService for cloud environments), so a resource added by
 * hand reads exactly like a discovered one.
 */

describe("the name of a resource matched by one identifier", () => {
  test("is the identifier", () => {
    expect(getNameFromIdentity("web-01")).toBe("web-01");
    expect(getNameFromIdentity("storefront-web")).toBe("storefront-web");
  });

  test("keeps the identifier's case and inner spaces, as typed", () => {
    /*
     * Ingest folds host.name to lower case before it names a discovered
     * host; a person's name for a host is left as they typed it. Only the
     * spaces around it go.
     */
    expect(getNameFromIdentity("PRIMARY01")).toBe("PRIMARY01");
    expect(getNameFromIdentity("checkout handler")).toBe("checkout handler");
  });

  test("drops the spaces around the identifier", () => {
    expect(getNameFromIdentity("  web-01  ")).toBe("web-01");
    expect(getNameFromIdentity("\tweb-01\n")).toBe("web-01");
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty identifier", ""],
    ["an identifier of spaces", "   "],
    ["a number", 42],
    ["an object", { value: "web-01" }],
  ])("is empty for %s", (_label: string, identity: unknown) => {
    expect(getNameFromIdentity(identity)).toBe("");
  });
});

describe("the name of a cloud environment", () => {
  test("is ingest's: platform, region, account", () => {
    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBe("AWS ECS · us-east-1 · 123456789012");
  });

  test("is built by the same function ingest builds it with, for every managed platform", () => {
    expect(MANAGED_CLOUD_PLATFORMS.length).toBeGreaterThan(5);

    MANAGED_CLOUD_PLATFORMS.forEach(
      (descriptor: ManagedCloudPlatformDescriptor): void => {
        expect(
          getCloudEnvironmentNameFromIdentity({
            cloudPlatform: descriptor.platform,
            cloudAccountId: "acct",
            cloudRegion: "region-1",
          }),
        ).toBe(
          buildCloudEnvironmentName({
            platform: descriptor.platform,
            accountId: "acct",
            region: "region-1",
          }),
        );
      },
    );
  });

  test("leaves out an account or a region it was not given", () => {
    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: "gcp_cloud_run",
        cloudRegion: "us-central1",
      }),
    ).toBe("GCP Cloud Run · us-central1");

    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: "gcp_cloud_run",
        cloudAccountId: "",
        cloudRegion: "   ",
      }),
    ).toBe("GCP Cloud Run");
  });

  test("drops the spaces around each value", () => {
    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: " aws_ecs ",
        cloudAccountId: " 123456789012 ",
        cloudRegion: " us-east-1 ",
      }),
    ).toBe("AWS ECS · us-east-1 · 123456789012");
  });

  test("names an unknown platform by its raw value, as ingest does", () => {
    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: "acme_compute",
        cloudRegion: "mars-1",
      }),
    ).toBe("acme_compute · mars-1");
  });

  test("is read from the key when only the key is given", () => {
    const key: string = buildCloudEnvironmentKey({
      platform: "azure_container_apps",
      accountId: "00000000-0000-0000-0000-000000000000",
      region: "eastus",
    });

    expect(
      getCloudEnvironmentNameFromIdentity({ resourceIdentifier: key }),
    ).toBe(
      buildCloudEnvironmentName({
        platform: "azure_container_apps",
        accountId: "00000000-0000-0000-0000-000000000000",
        region: "eastus",
      }),
    );

    // A key with empty segments, as ingest keeps them.
    expect(
      getCloudEnvironmentNameFromIdentity({
        resourceIdentifier: "aws_ecs||us-east-1",
      }),
    ).toBe("AWS ECS · us-east-1");
  });

  test("prefers the values given apart over the key", () => {
    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: "aws_ecs",
        cloudRegion: "eu-west-1",
        resourceIdentifier: "gcp_cloud_run|p|us-central1",
      }),
    ).toBe("AWS ECS · eu-west-1");
  });

  test("is the key itself when the key names no platform", () => {
    expect(
      getCloudEnvironmentNameFromIdentity({
        resourceIdentifier: "not-a-key",
      }),
    ).toBe("not-a-key");

    expect(
      getCloudEnvironmentNameFromIdentity({
        resourceIdentifier: "  |123|us-east-1",
      }),
    ).toBe("|123|us-east-1");
  });

  test("is empty with nothing to name it after", () => {
    expect(getCloudEnvironmentNameFromIdentity({})).toBe("");
    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: "",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBe("");
    expect(
      getCloudEnvironmentNameFromIdentity({
        cloudPlatform: 7,
        resourceIdentifier: null,
      }),
    ).toBe("");
  });
});
