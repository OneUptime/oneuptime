import {
  CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE,
  CLOUD_ENVIRONMENT_REGION_ATTRIBUTE,
  getCloudEnvironmentKeyOfFilter,
  getCloudEnvironmentKeyOfRow,
} from "../../../Types/Cloud/CloudEnvironmentTelemetryScope";
import {
  ManagedCloudPlatform,
  buildCloudEnvironmentKey,
  parseCloudEnvironmentKey,
} from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { describe, expect, test } from "@jest/globals";

/*
 * Which App Platforms environment a telemetry filter reads, and the key an
 * environment's row holds its telemetry by - the two sides scheduled
 * maintenance matches to hold the monitors of an environment's apps
 * (MonitorMaintenanceSuppression). A filter reads one environment only
 * when it pins everything that environment's key pins: its platform, and
 * the account and Region it has.
 */

const ECS_KEY: string = "aws_ecs|123456789012|us-east-1";

// What an app of checkout's environment filters its telemetry by.
const APP_FILTER: Record<string, string> = {
  [CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE]: "aws_ecs",
  [CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE]: "123456789012",
  [CLOUD_ENVIRONMENT_REGION_ATTRIBUTE]: "us-east-1",
  "resource.aws.ecs.task.family": "checkout-api",
  "resource.aws.ecs.cluster.arn":
    "arn:aws:ecs:us-east-1:123456789012:cluster/production",
};

describe("the attributes an environment's telemetry is selected by", () => {
  test("are the stored resource attributes of cloud.platform, cloud.account.id and cloud.region", () => {
    expect(CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE).toBe(
      "resource.cloud.platform",
    );
    expect(CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE).toBe(
      "resource.cloud.account.id",
    );
    expect(CLOUD_ENVIRONMENT_REGION_ATTRIBUTE).toBe("resource.cloud.region");
  });
});

describe("getCloudEnvironmentKeyOfFilter", () => {
  test("an app's filter reads its environment, whatever else it pins", () => {
    expect(getCloudEnvironmentKeyOfFilter(APP_FILTER)).toBe(ECS_KEY);
  });

  test("an environment's own filter reads it", () => {
    expect(
      getCloudEnvironmentKeyOfFilter({
        [CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE]: "aws_ecs",
        [CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE]: "123456789012",
        [CLOUD_ENVIRONMENT_REGION_ATTRIBUTE]: "us-east-1",
      }),
    ).toBe(ECS_KEY);
  });

  test("is the environment key ingest builds, so it is the environment's identifier", () => {
    expect(getCloudEnvironmentKeyOfFilter(APP_FILTER)).toBe(
      buildCloudEnvironmentKey({
        platform: ManagedCloudPlatform.AwsEcs,
        accountId: "123456789012",
        region: "us-east-1",
      }),
    );
    expect(
      parseCloudEnvironmentKey(getCloudEnvironmentKeyOfFilter(APP_FILTER)),
    ).toEqual({
      platform: "aws_ecs",
      accountId: "123456789012",
      region: "us-east-1",
    });
  });

  test("a part the filter leaves out is an empty segment: it reads more than one environment of that key's", () => {
    expect(
      getCloudEnvironmentKeyOfFilter({
        [CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE]: "aws_ecs",
        [CLOUD_ENVIRONMENT_REGION_ATTRIBUTE]: "us-east-1",
      }),
    ).toBe("aws_ecs||us-east-1");
    expect(
      getCloudEnvironmentKeyOfFilter({
        [CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE]: "gcp_cloud_run",
      }),
    ).toBe("gcp_cloud_run||");
  });

  test("a filter that pins no platform reads no one environment", () => {
    expect(
      getCloudEnvironmentKeyOfFilter({
        [CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE]: "123456789012",
        [CLOUD_ENVIRONMENT_REGION_ATTRIBUTE]: "us-east-1",
        "resource.service.name": "checkout-api",
      }),
    ).toBeNull();
    expect(getCloudEnvironmentKeyOfFilter({})).toBeNull();
  });

  test("an empty or blank platform pins nothing", () => {
    for (const platform of ["", "   "]) {
      expect(
        getCloudEnvironmentKeyOfFilter({
          ...APP_FILTER,
          [CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE]: platform,
        }),
      ).toBeNull();
    }
  });

  test("values are read trimmed, as the Dashboard writes them", () => {
    expect(
      getCloudEnvironmentKeyOfFilter({
        [CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE]: " aws_ecs ",
        [CLOUD_ENVIRONMENT_ACCOUNT_ID_ATTRIBUTE]: "123456789012 ",
        [CLOUD_ENVIRONMENT_REGION_ATTRIBUTE]: " us-east-1",
      }),
    ).toBe(ECS_KEY);
  });

  test("a value that is not text pins nothing: a search, a number, a list", () => {
    for (const value of [
      { values: ["aws_ecs"] },
      42,
      ["aws_ecs"],
      true,
      null,
    ]) {
      expect(
        getCloudEnvironmentKeyOfFilter({
          ...APP_FILTER,
          [CLOUD_ENVIRONMENT_PLATFORM_ATTRIBUTE]: value,
        }),
      ).toBeNull();
    }

    // A Region that is not text is left out, as if not pinned.
    expect(
      getCloudEnvironmentKeyOfFilter({
        ...APP_FILTER,
        [CLOUD_ENVIRONMENT_REGION_ATTRIBUTE]: { values: ["us-east-1"] },
      }),
    ).toBe("aws_ecs|123456789012|");
  });

  test("anything but an attribute map reads nothing", () => {
    for (const value of [undefined, null, "aws_ecs", 7, [APP_FILTER]]) {
      expect(getCloudEnvironmentKeyOfFilter(value)).toBeNull();
    }
  });

  test("an unprefixed cloud.platform is a span's own attribute, not the resource's: it pins nothing", () => {
    expect(
      getCloudEnvironmentKeyOfFilter({
        "cloud.platform": "aws_ecs",
        "cloud.account.id": "123456789012",
        "cloud.region": "us-east-1",
      }),
    ).toBeNull();
  });
});

describe("getCloudEnvironmentKeyOfRow", () => {
  test("an environment's row holds its telemetry by its three columns", () => {
    expect(
      getCloudEnvironmentKeyOfRow({
        cloudResourceKind: CloudResourceKind.Environment,
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBe(ECS_KEY);
  });

  test("a row that names no kind is an environment, as every row was before resources existed", () => {
    expect(
      getCloudEnvironmentKeyOfRow({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBe(ECS_KEY);
  });

  test("a part the environment has not is an empty segment, as its filter leaves it out", () => {
    expect(
      getCloudEnvironmentKeyOfRow({
        cloudResourceKind: CloudResourceKind.Environment,
        cloudPlatform: "azure_container_apps",
        cloudRegion: "eastus",
      }),
    ).toBe("azure_container_apps||eastus");
    expect(
      getCloudEnvironmentKeyOfRow({
        cloudResourceKind: CloudResourceKind.Environment,
        cloudPlatform: "aws_ecs",
        cloudAccountId: null,
        cloudRegion: "   ",
      }),
    ).toBe("aws_ecs||");
  });

  test("a cloud resource of a connected account holds no environment's telemetry", () => {
    expect(
      getCloudEnvironmentKeyOfRow({
        cloudResourceKind: CloudResourceKind.Resource,
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBeNull();
  });

  test("an environment made by hand, with no platform yet, holds nothing", () => {
    expect(
      getCloudEnvironmentKeyOfRow({
        cloudResourceKind: CloudResourceKind.Environment,
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    ).toBeNull();
    expect(getCloudEnvironmentKeyOfRow(null)).toBeNull();
    expect(getCloudEnvironmentKeyOfRow(undefined)).toBeNull();
  });

  test("a row and the filter of its own apps read the same key", () => {
    const row: Record<string, string> = {
      cloudResourceKind: CloudResourceKind.Environment,
      cloudPlatform: "aws_ecs",
      cloudAccountId: "123456789012",
      cloudRegion: "us-east-1",
    };

    expect(getCloudEnvironmentKeyOfRow(row)).toBe(
      getCloudEnvironmentKeyOfFilter(APP_FILTER),
    );
  });
});
