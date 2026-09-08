import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_INSTANCE_LIVE_WINDOW_MINUTES,
  CLOUD_PLATFORM_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  getCloudResourceAttributeDisplayKeys,
  getCloudResourceAttributeFilters,
  isCloudInstanceLive,
  isCloudResourceScoped,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudResourceTelemetryScope";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";

/*
 * Four pages scope telemetry onto a Cloud Environment through this helper.
 * The one behaviour that matters most is the negative: a platform-less
 * environment must report itself as unscoped, because the pages used to
 * spread an empty filter for it and show the whole project's telemetry.
 */

describe("getCloudResourceAttributeFilters", () => {
  test("maps all three identity columns onto resource.cloud.* attributes", () => {
    expect(
      getCloudResourceAttributeFilters({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "aws_ecs",
      [CLOUD_ACCOUNT_ID_ATTRIBUTE]: "123456789012",
      [CLOUD_REGION_ATTRIBUTE]: "us-east-1",
    });

    expect(CLOUD_PLATFORM_ATTRIBUTE).toBe("resource.cloud.platform");
    expect(CLOUD_ACCOUNT_ID_ATTRIBUTE).toBe("resource.cloud.account.id");
    expect(CLOUD_REGION_ATTRIBUTE).toBe("resource.cloud.region");
  });

  test("leaves out the parts that are missing so a detector without an account id still matches", () => {
    expect(
      getCloudResourceAttributeFilters({
        cloudPlatform: "gcp_cloud_run",
        cloudRegion: "europe-west1",
      }),
    ).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "gcp_cloud_run",
      [CLOUD_REGION_ATTRIBUTE]: "europe-west1",
    });

    expect(
      getCloudResourceAttributeFilters({
        cloudPlatform: "azure_container_apps",
        cloudAccountId: "   ",
        cloudRegion: "",
      }),
    ).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "azure_container_apps",
    });
  });

  test("trims stray whitespace off every value", () => {
    expect(
      getCloudResourceAttributeFilters({
        cloudPlatform: " aws_ecs ",
        cloudAccountId: " 123 ",
        cloudRegion: " us-east-1 ",
      }),
    ).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "aws_ecs",
      [CLOUD_ACCOUNT_ID_ATTRIBUTE]: "123",
      [CLOUD_REGION_ATTRIBUTE]: "us-east-1",
    });
  });

  test("is empty for an empty, null or undefined environment", () => {
    expect(getCloudResourceAttributeFilters({})).toEqual({});
    expect(getCloudResourceAttributeFilters(null)).toEqual({});
    expect(getCloudResourceAttributeFilters(undefined)).toEqual({});
  });

  test("reads a real CloudResource model the same way", () => {
    const resource: CloudResource = new CloudResource();
    resource.cloudPlatform = "aws_ecs";
    resource.cloudAccountId = "123456789012";
    resource.cloudRegion = "us-east-1";

    expect(getCloudResourceAttributeFilters(resource)).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "aws_ecs",
      [CLOUD_ACCOUNT_ID_ATTRIBUTE]: "123456789012",
      [CLOUD_REGION_ATTRIBUTE]: "us-east-1",
    });
  });
});

describe("getCloudResourceAttributeDisplayKeys", () => {
  test("labels exactly the attributes the filter carries", () => {
    expect(
      getCloudResourceAttributeDisplayKeys({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toEqual({
      [CLOUD_PLATFORM_ATTRIBUTE]: "Platform",
      [CLOUD_ACCOUNT_ID_ATTRIBUTE]: "Account",
      [CLOUD_REGION_ATTRIBUTE]: "Region",
    });
  });

  test("never labels an attribute the filter does not send", () => {
    const partial: Record<string, string> =
      getCloudResourceAttributeDisplayKeys({
        cloudPlatform: "gcp_cloud_run",
      });

    expect(partial).toEqual({ [CLOUD_PLATFORM_ATTRIBUTE]: "Platform" });
    expect(getCloudResourceAttributeDisplayKeys({})).toEqual({});
    expect(getCloudResourceAttributeDisplayKeys(null)).toEqual({});
  });

  test("always has the same key set as the filter", () => {
    const cases: Array<{
      cloudPlatform?: string;
      cloudAccountId?: string;
      cloudRegion?: string;
    }> = [
      {},
      { cloudPlatform: "aws_ecs" },
      { cloudPlatform: "aws_ecs", cloudRegion: "us-east-1" },
      { cloudAccountId: "only-an-account" },
      {
        cloudPlatform: "azure_app_service",
        cloudAccountId: "sub",
        cloudRegion: "eastus",
      },
    ];

    for (const resource of cases) {
      expect(
        Object.keys(getCloudResourceAttributeDisplayKeys(resource)).sort(),
      ).toEqual(Object.keys(getCloudResourceAttributeFilters(resource)).sort());
    }
  });
});

describe("isCloudResourceScoped", () => {
  test("is true only when a platform is present", () => {
    expect(isCloudResourceScoped({ cloudPlatform: "aws_ecs" })).toBe(true);
    expect(
      isCloudResourceScoped({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "1",
        cloudRegion: "r",
      }),
    ).toBe(true);
  });

  test("account id and region alone do not make a scope", () => {
    /*
     * Ingest never creates an environment without a platform, so this is a
     * hand-made one nothing has matched yet. Querying with just the account
     * and region would be wrong in the other direction — it would pull in
     * Lambda functions and VMs in that account.
     */
    expect(
      isCloudResourceScoped({
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBe(false);
  });

  test("is false for blank, empty, null and undefined", () => {
    expect(isCloudResourceScoped({ cloudPlatform: "   " })).toBe(false);
    expect(isCloudResourceScoped({ cloudPlatform: "" })).toBe(false);
    expect(isCloudResourceScoped({})).toBe(false);
    expect(isCloudResourceScoped(null)).toBe(false);
    expect(isCloudResourceScoped(undefined)).toBe(false);
  });
});

describe("isCloudInstanceLive", () => {
  const now: Date = new Date("2026-09-08T12:00:00.000Z");

  test("the window is the sweeper's 15 minutes", () => {
    expect(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES).toBe(15);
  });

  test("an instance seen inside the window is live, one outside it is not", () => {
    expect(isCloudInstanceLive(new Date("2026-09-08T11:59:00.000Z"), now)).toBe(
      true,
    );
    expect(isCloudInstanceLive(new Date("2026-09-08T11:44:59.000Z"), now)).toBe(
      false,
    );
  });

  test("the boundary itself counts as live", () => {
    expect(isCloudInstanceLive(new Date("2026-09-08T11:45:00.000Z"), now)).toBe(
      true,
    );
  });

  test("accepts the ISO string the API returns", () => {
    expect(isCloudInstanceLive("2026-09-08T11:50:00.000Z", now)).toBe(true);
    expect(isCloudInstanceLive("2026-09-08T11:00:00.000Z", now)).toBe(false);
  });

  test("is never live without a timestamp", () => {
    expect(isCloudInstanceLive(undefined, now)).toBe(false);
    expect(isCloudInstanceLive(null, now)).toBe(false);
    expect(isCloudInstanceLive("not a date", now)).toBe(false);
  });
});
