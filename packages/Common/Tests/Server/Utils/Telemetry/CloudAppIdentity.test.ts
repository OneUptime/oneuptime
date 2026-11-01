import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_APP_ATTRIBUTE_VALUE_MAX_LENGTH,
  CLOUD_APP_FIELD_MAX_LENGTH,
  CLOUD_APP_IMAGE_MAX_LENGTH,
  CloudAppIdentity,
  buildCloudAppKey,
  isTrackableRevision,
  resolveCloudAppIdentity,
  shortenEcsClusterArn,
} from "../../../../Server/Utils/Telemetry/CloudAppIdentity";
import {
  FAAS_CLOUD_PLATFORM_VALUES,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
} from "../../../../Types/Cloud/CloudPlatform";

/*
 * Which app of an App Platforms environment a resource belongs to, and
 * which revision it runs: named as each platform's console names them, read
 * from the attributes its detector stamps. The ingest keeps one CloudApp row
 * per (environment, appKey), so the key must be stable for one app and
 * different for two, and the revision must be something a deploy changes.
 */

const CLUSTER_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:cluster/production";
const STAGING_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:cluster/staging";

function resolve(
  platform: string,
  attributes: Record<string, string>,
): CloudAppIdentity | null {
  return resolveCloudAppIdentity({
    platform,
    getAttribute: (key: string): string | null => {
      return attributes[key] ?? null;
    },
  });
}

describe("which platforms have apps", () => {
  test.each([
    ["a FaaS platform", "aws_lambda"],
    ["a raw VM", "aws_ec2"],
    ["Kubernetes", "aws_eks"],
    ["an unknown platform", "hetzner_cloud"],
    ["no platform", ""],
  ])("%s has none", (_label: string, platform: string) => {
    expect(resolve(platform, { "service.name": "checkout" })).toBeNull();
  });

  test("no FaaS platform has apps: those are Serverless Functions", () => {
    for (const platform of FAAS_CLOUD_PLATFORM_VALUES) {
      expect(resolve(platform, { "faas.name": "checkout" })).toBeNull();
    }
  });

  test.each(MANAGED_CLOUD_PLATFORMS)(
    "every managed platform names its apps and their revisions ($platform)",
    (descriptor: ManagedCloudPlatformDescriptor) => {
      expect(descriptor.appAttributes.length).toBeGreaterThan(0);
      expect(descriptor.revisionAttributes.length).toBeGreaterThan(0);
      // Every platform's last resort is the app's own service.name.
      expect(descriptor.appAttributes).toContain("service.name");

      const identity: CloudAppIdentity | null = resolve(descriptor.platform, {
        "service.name": "checkout",
        "service.version": "1.4.2",
      });

      expect(identity).not.toBeNull();
      expect(identity!.name).toBe("checkout");
      expect(identity!.revision).toBe("1.4.2");
    },
  );
});

describe("AWS ECS", () => {
  test("an app is its task definition family, kept apart per cluster, its revision the task definition's", () => {
    const identity: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsEcs, {
      "aws.ecs.task.family": "checkout-api",
      "aws.ecs.task.revision": "43",
      "aws.ecs.cluster.arn": CLUSTER_ARN,
      "service.name": "checkout",
      "service.version": "1.4.2",
    })!;

    expect(identity).toEqual(
      expect.objectContaining({
        name: "checkout-api",
        nameAttribute: "aws.ecs.task.family",
        // The console's name for the cluster, not its ARN.
        groupName: "production",
        groupAttribute: "aws.ecs.cluster.arn",
        revision: "43",
        revisionAttribute: "aws.ecs.task.revision",
        serviceName: "checkout",
        serviceVersion: "1.4.2",
      }),
    );
    // Its telemetry is filtered by the values as sent: the ARN, not "production".
    expect(identity.telemetryAttributes).toEqual({
      "aws.ecs.task.family": "checkout-api",
      "aws.ecs.cluster.arn": CLUSTER_ARN,
    });
  });

  test("one family in two clusters is two apps; one app in two batches is one", () => {
    const production: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsEcs, {
      "aws.ecs.task.family": "checkout-api",
      "aws.ecs.cluster.arn": CLUSTER_ARN,
    })!;
    const staging: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsEcs, {
      "aws.ecs.task.family": "checkout-api",
      "aws.ecs.cluster.arn": STAGING_ARN,
    })!;
    const again: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsEcs, {
      "aws.ecs.task.family": "checkout-api",
      "aws.ecs.cluster.arn": CLUSTER_ARN,
      // A different task and revision of the same app.
      "aws.ecs.task.revision": "44",
      "aws.ecs.task.arn":
        "arn:aws:ecs:us-east-1:123456789012:task/production/abc",
    })!;

    expect(production.appKey).not.toBe(staging.appKey);
    expect(production.appKey).toBe(again.appKey);
    expect(production.appKey).toMatch(/^[0-9a-f]{40}$/);
  });

  test("without the ECS detector, the app is its service.name and its revision its service.version", () => {
    const identity: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsEcs, {
      "service.name": "checkout",
      "service.version": "2.0.0",
      "container.image.name":
        "123456789012.dkr.ecr.us-east-1.amazonaws.com/checkout",
      "container.image.tag": "2.0.0",
    })!;

    expect(identity.name).toBe("checkout");
    expect(identity.nameAttribute).toBe("service.name");
    expect(identity.groupName).toBeNull();
    expect(identity.revision).toBe("2.0.0");
    expect(identity.revisionAttribute).toBe("service.version");
    expect(identity.image).toBe(
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/checkout:2.0.0",
    );
  });

  test("a revision a deploy does not change is passed over for the next attribute", () => {
    const identity: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsEcs, {
      "aws.ecs.task.family": "checkout-api",
      "aws.ecs.task.revision": "latest",
      "service.version": "1.4.2",
    })!;

    expect(identity.revision).toBe("1.4.2");
    expect(identity.revisionAttribute).toBe("service.version");
  });

  test("the cluster's short name is the part after the last slash; a plain name is kept", () => {
    expect(shortenEcsClusterArn(CLUSTER_ARN)).toBe("production");
    expect(shortenEcsClusterArn("production")).toBe("production");
    expect(shortenEcsClusterArn("  arn:aws:ecs:x:1:cluster/  ")).toBe(
      "arn:aws:ecs:x:1:cluster/",
    );
  });
});

describe("the other platforms", () => {
  test("Cloud Run: the service and its revision, from K_SERVICE and K_REVISION", () => {
    const identity: CloudAppIdentity = resolve(
      ManagedCloudPlatform.GcpCloudRun,
      {
        "faas.name": "api",
        "faas.version": "api-00042-xyz",
        "service.name": "api-service",
      },
    )!;

    expect(identity.name).toBe("api");
    expect(identity.nameAttribute).toBe("faas.name");
    expect(identity.revision).toBe("api-00042-xyz");
    expect(identity.revisionAttribute).toBe("faas.version");
    expect(identity.telemetryAttributes).toEqual({ "faas.name": "api" });
  });

  test("Elastic Beanstalk keeps an app apart per environment", () => {
    const blue: CloudAppIdentity = resolve(
      ManagedCloudPlatform.AwsElasticBeanstalk,
      { "service.name": "web", "deployment.environment.name": "blue" },
    )!;
    const green: CloudAppIdentity = resolve(
      ManagedCloudPlatform.AwsElasticBeanstalk,
      // The older attribute name counts too.
      { "service.name": "web", "deployment.environment": "green" },
    )!;

    expect(blue.groupName).toBe("blue");
    expect(blue.groupAttribute).toBe("deployment.environment.name");
    expect(green.groupName).toBe("green");
    expect(green.groupAttribute).toBe("deployment.environment");
    expect(blue.appKey).not.toBe(green.appKey);
  });

  test("Container Apps take the image tag when no service.version is set", () => {
    const identity: CloudAppIdentity = resolve(
      ManagedCloudPlatform.AzureContainerApps,
      {
        "service.name": "orders",
        "container.image.name": "myregistry.azurecr.io/orders",
        "container.image.tag": "v7",
      },
    )!;

    expect(identity.revision).toBe("v7");
    expect(identity.revisionAttribute).toBe("container.image.tag");
    expect(identity.image).toBe("myregistry.azurecr.io/orders:v7");
  });

  test("an app with no revision attribute still is an app", () => {
    const identity: CloudAppIdentity = resolve(
      ManagedCloudPlatform.AzureAppService,
      { "service.name": "portal" },
    )!;

    expect(identity.name).toBe("portal");
    expect(identity.revision).toBeNull();
    expect(identity.revisionAttribute).toBeNull();
    expect(identity.serviceVersion).toBeNull();
    expect(identity.image).toBeNull();
  });
});

describe("what is not an app's name", () => {
  test.each([
    "unknown_service",
    "unknown_service:java",
    "UNKNOWN_SERVICE:node",
  ])("the SDK's %s names no app", (serviceName: string) => {
    expect(
      resolve(ManagedCloudPlatform.AzureContainerApps, {
        "service.name": serviceName,
      }),
    ).toBeNull();
  });

  test("an unknown service.name is passed over for the platform's own name, and not kept as the service", () => {
    const identity: CloudAppIdentity = resolve(
      ManagedCloudPlatform.GcpCloudRun,
      { "faas.name": "api", "service.name": "unknown_service:python" },
    )!;

    expect(identity.name).toBe("api");
    expect(identity.serviceName).toBeNull();
  });

  test("blank values are no values", () => {
    expect(
      resolve(ManagedCloudPlatform.AwsEcs, {
        "aws.ecs.task.family": "   ",
        "service.name": "",
      }),
    ).toBeNull();

    const identity: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsEcs, {
      "aws.ecs.task.family": "  checkout  ",
      "aws.ecs.task.revision": "  ",
    })!;
    expect(identity.name).toBe("checkout");
    expect(identity.revision).toBeNull();
  });
});

describe("what fits in a row", () => {
  test("a long name is cut to the column, but the key is the whole name's", () => {
    const long: string = "a".repeat(CLOUD_APP_FIELD_MAX_LENGTH + 20);
    const longer: string = `${long}b`;

    const one: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsAppRunner, {
      "service.name": long,
    })!;
    const other: CloudAppIdentity = resolve(ManagedCloudPlatform.AwsAppRunner, {
      "service.name": longer,
    })!;

    expect(one.name).toHaveLength(CLOUD_APP_FIELD_MAX_LENGTH);
    expect(one.appKey).not.toBe(other.appKey);
    // Still short enough to filter by.
    expect(one.telemetryAttributes).toEqual({ "service.name": long });
  });

  test("a name too long to filter telemetry by is not used as a filter", () => {
    const huge: string = "x".repeat(CLOUD_APP_ATTRIBUTE_VALUE_MAX_LENGTH + 1);

    const identity: CloudAppIdentity = resolve(
      ManagedCloudPlatform.AwsAppRunner,
      { "service.name": huge },
    )!;

    expect(identity.telemetryAttributes).toEqual({});
  });

  test("a revision too long to be one is not a revision", () => {
    expect(isTrackableRevision("r".repeat(CLOUD_APP_FIELD_MAX_LENGTH))).toBe(
      true,
    );
    expect(
      isTrackableRevision("r".repeat(CLOUD_APP_FIELD_MAX_LENGTH + 1)),
    ).toBe(false);
    expect(isTrackableRevision("latest")).toBe(false);
    expect(isTrackableRevision("")).toBe(false);
    expect(isTrackableRevision("43")).toBe(true);
  });

  test("a long image is cut to the column", () => {
    const identity: CloudAppIdentity = resolve(
      ManagedCloudPlatform.AwsAppRunner,
      {
        "service.name": "checkout",
        "container.image.name": "r".repeat(CLOUD_APP_IMAGE_MAX_LENGTH + 50),
      },
    )!;

    expect(identity.image).toHaveLength(CLOUD_APP_IMAGE_MAX_LENGTH);
  });
});

describe("buildCloudAppKey", () => {
  test("is stable, fixed length, and tells the attribute, name and group apart", () => {
    const base: string = buildCloudAppKey({
      nameAttribute: "service.name",
      name: "checkout",
      groupAttribute: null,
      group: null,
    });

    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(
      buildCloudAppKey({
        nameAttribute: "service.name",
        name: "checkout",
        groupAttribute: null,
        group: null,
      }),
    ).toBe(base);
    expect(
      buildCloudAppKey({
        nameAttribute: "faas.name",
        name: "checkout",
        groupAttribute: null,
        group: null,
      }),
    ).not.toBe(base);
    expect(
      buildCloudAppKey({
        nameAttribute: "service.name",
        name: "checkout",
        groupAttribute: "deployment.environment.name",
        group: "blue",
      }),
    ).not.toBe(base);
  });
});
