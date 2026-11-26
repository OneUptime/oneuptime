import { describe, expect, test } from "@jest/globals";
import { CloudSavingKind } from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_COMMITMENT_PURCHASE_URLS,
  CLOUD_SAVINGS_ACTION_KINDS,
  CLOUD_SAVINGS_ACTION_KINDS_BY_PROVIDER,
  CLOUD_SAVINGS_ACTION_SENTENCES,
  CLOUD_SAVINGS_ACTION_STATUS_LABELS,
  CLOUD_SAVINGS_ACTION_TITLES,
  CLOUD_SAVINGS_ACTION_UNDO,
  CLOUD_SAVINGS_NOT_OFFERED_SENTENCES,
  CloudSavingsActionGroup,
  CloudSavingsActionKind,
  CloudSavingsActionPlanResult,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsActionsAccess,
  CloudSavingsNotOffered,
  CloudSavingsRecommendationFacts,
  CloudSavingsTarget,
  CloudSavingsTargetType,
  doesCloudSavingsActionRestart,
  getCloudSavingsActionGroup,
  getCloudSavingsActionPlan,
  getCloudSavingsActionUndo,
  getCloudSavingsActionsAccess,
  isAwsArmInstanceType,
  isCloudSavingsActionAllowed,
  isCloudSavingsActionInEffect,
  isCloudSavingsActionKind,
  isCloudSavingsActionOpen,
  readAwsDatabaseClass,
  readAwsInstanceType,
  readAwsSavingsTarget,
  readAzureSavingsTarget,
  readAzureVmSize,
  readGcpMachineType,
  readGcpSavingsTarget,
} from "../../../Types/Cloud/CloudSavingsAction";

/*
 * Which saving is which change (#11010): a recommendation read from AWS
 * Cost Optimization Hub, Azure Advisor or Google Cloud's Recommender - or
 * OneUptime's own right-sizing - is the one change OneUptime would make
 * through the account's cloud connection, or a reason it makes none. The
 * server and the Dashboard read it the same way, so a button is offered
 * exactly where the server would act.
 */

const AWS_ACCOUNT: string = "123456789012";
const SUBSCRIPTION: string = "6f0b7c1a-1d2e-4f3a-9b8c-7d6e5f4a3b2c";

function plan(
  facts: CloudSavingsRecommendationFacts,
): CloudSavingsActionPlanResult {
  return getCloudSavingsActionPlan(facts);
}

function kindOf(facts: CloudSavingsRecommendationFacts): string {
  const result: CloudSavingsActionPlanResult = plan(facts);
  return result.plan ? result.plan.kind : `not:${result.notOffered}`;
}

describe("reading an AWS resource from its id", () => {
  test("reads an instance, a volume, an Elastic IP and an RDS database from their ARNs", () => {
    expect(
      readAwsSavingsTarget({
        resourceId: `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:instance/i-0abc1234def567890`,
        region: "",
        account: "",
      }),
    ).toEqual({
      provider: CloudProvider.AWS,
      type: CloudSavingsTargetType.Instance,
      id: "i-0abc1234def567890",
      location: "eu-west-1",
      account: AWS_ACCOUNT,
    });

    expect(
      readAwsSavingsTarget({
        resourceId: `arn:aws:ec2:us-east-1:${AWS_ACCOUNT}:volume/vol-0123456789abcdef0`,
        region: "",
        account: "",
      })?.type,
    ).toBe(CloudSavingsTargetType.Volume);

    expect(
      readAwsSavingsTarget({
        resourceId: `arn:aws:ec2:us-east-1:${AWS_ACCOUNT}:elastic-ip/eipalloc-0a1b2c3d4e5f60718`,
        region: "",
        account: "",
      })?.type,
    ).toBe(CloudSavingsTargetType.Address);

    expect(
      readAwsSavingsTarget({
        resourceId: `arn:aws:rds:us-west-2:${AWS_ACCOUNT}:db:orders-replica-2`,
        region: "",
        account: "",
      }),
    ).toEqual({
      provider: CloudProvider.AWS,
      type: CloudSavingsTargetType.Database,
      id: "orders-replica-2",
      location: "us-west-2",
      account: AWS_ACCOUNT,
    });
  });

  test("a snapshot's ARN names no account, so the saving's account is used", () => {
    expect(
      readAwsSavingsTarget({
        resourceId: "arn:aws:ec2:us-east-1::snapshot/snap-0fedcba9876543210",
        region: "",
        account: AWS_ACCOUNT,
      }),
    ).toEqual({
      provider: CloudProvider.AWS,
      type: CloudSavingsTargetType.Snapshot,
      id: "snap-0fedcba9876543210",
      location: "us-east-1",
      account: AWS_ACCOUNT,
    });
  });

  test("a bare id takes the saving's Region and account", () => {
    expect(
      readAwsSavingsTarget({
        resourceId: "vol-0123456789abcdef0",
        region: "ap-southeast-2",
        account: AWS_ACCOUNT,
      }),
    ).toEqual({
      provider: CloudProvider.AWS,
      type: CloudSavingsTargetType.Volume,
      id: "vol-0123456789abcdef0",
      location: "ap-southeast-2",
      account: AWS_ACCOUNT,
    });
  });

  test("a GovCloud ARN keeps its Region", () => {
    expect(
      readAwsSavingsTarget({
        resourceId: `arn:aws-us-gov:ec2:us-gov-west-1:${AWS_ACCOUNT}:instance/i-0abc1234def567890`,
        region: "",
        account: "",
      })?.location,
    ).toBe("us-gov-west-1");
  });

  test.each([
    [
      "a Lambda function",
      `arn:aws:lambda:us-east-1:${AWS_ACCOUNT}:function:resize`,
    ],
    [
      "an Auto Scaling group",
      `arn:aws:autoscaling:us-east-1:${AWS_ACCOUNT}:autoScalingGroup:x`,
    ],
    ["a made-up id", "i-not-hex"],
    [
      "an id with a path in it",
      `arn:aws:ec2:us-east-1:${AWS_ACCOUNT}:volume/vol-0123456789abcdef0/../x`,
    ],
    [
      "an account that is not twelve digits",
      "arn:aws:ec2:us-east-1:1234:instance/i-0abc1234def567890",
    ],
    ["no Region to find it in", "i-0abc1234def567890"],
    [
      "an RDS identifier with a slash",
      `arn:aws:rds:us-east-1:${AWS_ACCOUNT}:db:a/b`,
    ],
  ])("refuses %s", (_what: string, resourceId: string) => {
    expect(
      readAwsSavingsTarget({ resourceId, region: "", account: AWS_ACCOUNT }),
    ).toBeNull();
  });
});

describe("reading an Azure resource from its ARM id", () => {
  test("reads a VM, a managed disk, a snapshot and a public IP, whatever the case of the provider", () => {
    const vm: CloudSavingsTarget | null = readAzureSavingsTarget(
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/web-rg/providers/microsoft.compute/VirtualMachines/web-01`,
    );

    expect(vm).toEqual({
      provider: CloudProvider.Azure,
      type: CloudSavingsTargetType.Instance,
      id: "web-01",
      location: "",
      account: SUBSCRIPTION,
      resourceGroup: "web-rg",
      armId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/web-rg/providers/microsoft.compute/VirtualMachines/web-01`,
    });

    expect(
      readAzureSavingsTarget(
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/disks/old-data`,
      )?.type,
    ).toBe(CloudSavingsTargetType.Volume);
    expect(
      readAzureSavingsTarget(
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/snapshots/nightly-2024`,
      )?.type,
    ).toBe(CloudSavingsTargetType.Snapshot);
    expect(
      readAzureSavingsTarget(
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Network/publicIPAddresses/old-ip`,
      )?.type,
    ).toBe(CloudSavingsTargetType.Address);
  });

  test.each([
    [
      "a storage account",
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/acct`,
    ],
    [
      "a subscription that is not a GUID",
      "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Compute/disks/d",
    ],
    [
      "a child resource",
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm/extensions/x`,
    ],
    [
      "a path that climbs",
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/../providers/Microsoft.Compute/disks/d`,
    ],
    [
      "a query in the id",
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/disks/d?x=1`,
    ],
    ["nothing", ""],
  ])("refuses %s", (_what: string, resourceId: string) => {
    expect(readAzureSavingsTarget(resourceId)).toBeNull();
  });
});

describe("reading a Google Cloud resource from its full name", () => {
  test("reads a zone's instance and disk, a Region's disk and address, a global address and an image", () => {
    expect(
      readGcpSavingsTarget(
        "//compute.googleapis.com/projects/shop-prod-123/zones/us-central1-a/instances/web-1",
      ),
    ).toEqual({
      provider: CloudProvider.GCP,
      type: CloudSavingsTargetType.Instance,
      id: "web-1",
      location: "us-central1-a",
      account: "shop-prod-123",
      gcpScope: "zone",
    });

    expect(
      readGcpSavingsTarget(
        "//compute.googleapis.com/projects/shop-dev-123/regions/europe-west1/disks/shared",
      )?.gcpScope,
    ).toBe("region");
    expect(
      readGcpSavingsTarget(
        "//compute.googleapis.com/projects/shop-dev-123/regions/europe-west1/addresses/old-lb",
      )?.type,
    ).toBe(CloudSavingsTargetType.Address);
    expect(
      readGcpSavingsTarget(
        "//compute.googleapis.com/projects/shop-dev-123/global/addresses/old-global",
      )?.location,
    ).toBe("global");
    expect(
      readGcpSavingsTarget(
        "//compute.googleapis.com/projects/shop-dev-123/global/images/base-2023",
      )?.type,
    ).toBe(CloudSavingsTargetType.Image);
    // The Recommender sometimes names an instance by its number.
    expect(
      readGcpSavingsTarget(
        "//compute.googleapis.com/projects/shop-dev-123/zones/us-central1-a/instances/4410394835736512345",
      )?.id,
    ).toBe("4410394835736512345");
  });

  test.each([
    [
      "another API's resource",
      "//sqladmin.googleapis.com/projects/p-12345/instances/db",
    ],
    [
      "an instance in a Region",
      "//compute.googleapis.com/projects/shop-dev-123/regions/us-central1/instances/x",
    ],
    [
      "a name with capitals",
      "//compute.googleapis.com/projects/shop-dev-123/zones/us-central1-a/disks/Disk",
    ],
    [
      "a path that climbs",
      "//compute.googleapis.com/projects/shop-dev-123/zones/../disks/d",
    ],
    [
      "a project too short",
      "//compute.googleapis.com/projects/ab/zones/us-central1-a/disks/d",
    ],
  ])("refuses %s", (_what: string, resourceId: string) => {
    expect(readGcpSavingsTarget(resourceId)).toBeNull();
  });
});

describe("which change an AWS saving is", () => {
  const instance: string = `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:instance/i-0abc1234def567890`;
  const volume: string = `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:volume/vol-0123456789abcdef0`;

  test("stopping an idle instance, which a press starts again", () => {
    const result: CloudSavingsActionPlanResult = plan({
      provider: CloudProvider.AWS,
      kind: CloudSavingKind.Idle,
      action: "Stop",
      resourceId: instance,
    });

    expect(result.plan?.kind).toBe(CloudSavingsActionKind.StopInstance);
    expect(result.plan?.restarts).toBe(false);
  });

  test("resizing an instance to the recommended size, a restart", () => {
    const result: CloudSavingsActionPlanResult = plan({
      provider: CloudProvider.AWS,
      kind: CloudSavingKind.Rightsize,
      action: "Rightsize",
      resourceId: instance,
      currentConfiguration: "m5.2xlarge",
      recommendedConfiguration: "m5.xlarge",
    });

    expect(result.plan).toMatchObject({
      kind: CloudSavingsActionKind.ResizeInstance,
      from: "m5.2xlarge",
      to: "m5.xlarge",
      restarts: true,
    });
  });

  test("a summary with more words in it still names its size", () => {
    expect(
      plan({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Upgrade,
        action: "Upgrade",
        resourceId: instance,
        currentConfiguration: "m4.large (2 vCPU, 8 GiB)",
        recommendedConfiguration: "m6i.large (2 vCPU, 8 GiB)",
      }).plan,
    ).toMatchObject({ from: "m4.large", to: "m6i.large" });
  });

  test("never moves an instance to an Arm size in place, nor off one", () => {
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Upgrade,
        action: "Migrate to Graviton",
        resourceId: instance,
        currentConfiguration: "m5.large",
        recommendedConfiguration: "m6g.large",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NeedsArmImage}`);

    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: instance,
        currentConfiguration: "m5.large",
        recommendedConfiguration: "t4g.medium",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NeedsArmImage}`);

    // Arm to a smaller Arm is fine.
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: instance,
        currentConfiguration: "m6g.xlarge",
        recommendedConfiguration: "m6g.large",
      }),
    ).toBe(CloudSavingsActionKind.ResizeInstance);
  });

  test("a resize that names no new size, or the same one, is not offered", () => {
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: instance,
        currentConfiguration: "m5.large",
        recommendedConfiguration: "",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NoTarget}`);
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: instance,
        currentConfiguration: "m5.large",
        recommendedConfiguration: "m5.large",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NoTarget}`);
  });

  test("deleting an unattached volume, with a final snapshot offered", () => {
    expect(
      plan({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Idle,
        action: "Delete",
        resourceId: volume,
      }).plan,
    ).toMatchObject({
      kind: CloudSavingsActionKind.DeleteVolume,
      finalSnapshot: "offered",
    });
  });

  test("gp2 to gp3, and nothing else a volume's rightsizing asks", () => {
    expect(
      plan({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: volume,
        currentConfiguration: "gp2 / 100 GiB",
        recommendedConfiguration: "gp3 / 100 GiB / 3000 IOPS",
      }).plan,
    ).toMatchObject({
      kind: CloudSavingsActionKind.ChangeVolumeType,
      from: "gp2",
      to: "gp3",
    });

    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: volume,
        currentConfiguration: "io1 / 500 GiB",
        recommendedConfiguration: "gp3 / 500 GiB",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NotOneStep}`);
  });

  test("a snapshot and an Elastic IP are deleted and released", () => {
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Idle,
        action: "Delete",
        resourceId: "arn:aws:ec2:us-east-1::snapshot/snap-0fedcba9876543210",
        accountId: AWS_ACCOUNT,
      }),
    ).toBe(CloudSavingsActionKind.DeleteSnapshot);

    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Idle,
        action: "Delete",
        resourceId: `arn:aws:ec2:us-east-1:${AWS_ACCOUNT}:elastic-ip/eipalloc-0a1b2c3d4e5f60718`,
      }),
    ).toBe(CloudSavingsActionKind.ReleaseAddress);
  });

  test("an RDS database is stopped, or resized to the class recommended", () => {
    const database: string = `arn:aws:rds:us-east-1:${AWS_ACCOUNT}:db:reports`;

    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Idle,
        action: "Stop",
        resourceId: database,
      }),
    ).toBe(CloudSavingsActionKind.StopDatabase);

    expect(
      plan({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: database,
        currentConfiguration: "db.r5.2xlarge",
        recommendedConfiguration: "db.r5.xlarge",
      }).plan,
    ).toMatchObject({
      kind: CloudSavingsActionKind.ResizeDatabase,
      from: "db.r5.2xlarge",
      to: "db.r5.xlarge",
      restarts: true,
    });

    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: database,
        currentConfiguration: "db.r5.large",
        recommendedConfiguration: "db.r6g.large",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NeedsArmImage}`);
  });

  test("a commitment is never bought, and links to the cloud's purchase page", () => {
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Commitment,
        action: "Purchase Savings Plans",
        resourceId: "",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.Commitment}`);

    for (const provider of Object.values(CloudProvider)) {
      expect(CLOUD_COMMITMENT_PURCHASE_URLS[provider]).toMatch(/^https:\/\//);
    }
  });

  test("a Lambda function's saving, or one about no resource, is not offered", () => {
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: `arn:aws:lambda:us-east-1:${AWS_ACCOUNT}:function:thumbnail`,
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NoResource}`);
    expect(
      kindOf({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Idle,
        action: "Stop",
        resourceId: "",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NoResource}`);
  });

  test("OneUptime's own right-sizing of an instance resizes it too", () => {
    expect(
      plan({
        provider: CloudProvider.AWS,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: "i-0abc1234def567890",
        region: "eu-central-1",
        accountId: AWS_ACCOUNT,
        currentConfiguration: "c5.4xlarge",
        recommendedConfiguration: "c5.2xlarge",
      }).plan,
    ).toMatchObject({
      kind: CloudSavingsActionKind.ResizeInstance,
      target: { location: "eu-central-1", account: AWS_ACCOUNT },
    });
  });
});

describe("which change an Azure saving is", () => {
  const vm: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/web/providers/Microsoft.Compute/virtualMachines/web-01`;

  test("a VM Advisor says to shut down is deallocated; one to resize, resized", () => {
    expect(
      kindOf({
        provider: CloudProvider.Azure,
        kind: CloudSavingKind.Idle,
        action: "Shut down or resize your virtual machine",
        resourceId: vm,
      }),
    ).toBe(CloudSavingsActionKind.StopInstance);

    expect(
      plan({
        provider: CloudProvider.Azure,
        kind: CloudSavingKind.Rightsize,
        action: "Right-size or shutdown underutilized virtual machines",
        resourceId: vm,
        currentConfiguration: "Standard_D8s_v5",
        recommendedConfiguration: "Standard_D4s_v5",
      }).plan,
    ).toMatchObject({
      kind: CloudSavingsActionKind.ResizeInstance,
      from: "Standard_D8s_v5",
      to: "Standard_D4s_v5",
    });
  });

  test("an unattached disk, an old snapshot and an idle public IP are deleted", () => {
    expect(
      kindOf({
        provider: CloudProvider.Azure,
        kind: CloudSavingKind.Idle,
        action: "Delete unattached disk",
        resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/disks/old`,
      }),
    ).toBe(CloudSavingsActionKind.DeleteVolume);
    expect(
      kindOf({
        provider: CloudProvider.Azure,
        kind: CloudSavingKind.Idle,
        action: "Delete old snapshots",
        resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/snapshots/old`,
      }),
    ).toBe(CloudSavingsActionKind.DeleteSnapshot);
    expect(
      kindOf({
        provider: CloudProvider.Azure,
        kind: CloudSavingKind.Idle,
        action: "Delete unassociated public IP",
        resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Network/publicIPAddresses/old`,
      }),
    ).toBe(CloudSavingsActionKind.ReleaseAddress);
  });

  test("a disk Advisor says to resize is not a delete", () => {
    expect(
      kindOf({
        provider: CloudProvider.Azure,
        kind: CloudSavingKind.Rightsize,
        action: "Use Standard SSD",
        resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/Microsoft.Compute/disks/old`,
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NotOneStep}`);
  });
});

describe("which change a Google Cloud saving is", () => {
  const instance: string =
    "//compute.googleapis.com/projects/shop-dev-123/zones/us-central1-a/instances/web-1";

  test("Stop VM stops it; Change machine type resizes it", () => {
    expect(
      kindOf({
        provider: CloudProvider.GCP,
        kind: CloudSavingKind.Idle,
        action: "Stop VM",
        resourceId: instance,
      }),
    ).toBe(CloudSavingsActionKind.StopInstance);

    expect(
      plan({
        provider: CloudProvider.GCP,
        kind: CloudSavingKind.Rightsize,
        action: "Change machine type",
        resourceId: instance,
        currentConfiguration: "n2-standard-8",
        recommendedConfiguration: "n2-standard-4",
      }).plan,
    ).toMatchObject({
      kind: CloudSavingsActionKind.ResizeInstance,
      from: "n2-standard-8",
      to: "n2-standard-4",
    });
  });

  test("Snapshot and delete disk always takes the snapshot; Delete disk offers it", () => {
    const disk: string =
      "//compute.googleapis.com/projects/shop-dev-123/zones/us-central1-a/disks/data-old";

    expect(
      plan({
        provider: CloudProvider.GCP,
        kind: CloudSavingKind.Idle,
        action: "Snapshot and delete disk",
        resourceId: disk,
      }).plan?.finalSnapshot,
    ).toBe("always");
    expect(
      plan({
        provider: CloudProvider.GCP,
        kind: CloudSavingKind.Idle,
        action: "Delete disk",
        resourceId: disk,
      }).plan?.finalSnapshot,
    ).toBe("offered");
  });

  test("an idle address is released and an old image deleted", () => {
    expect(
      kindOf({
        provider: CloudProvider.GCP,
        kind: CloudSavingKind.Idle,
        action: "Delete address",
        resourceId:
          "//compute.googleapis.com/projects/shop-dev-123/regions/us-central1/addresses/old",
      }),
    ).toBe(CloudSavingsActionKind.ReleaseAddress);
    expect(
      kindOf({
        provider: CloudProvider.GCP,
        kind: CloudSavingKind.Idle,
        action: "Delete image",
        resourceId:
          "//compute.googleapis.com/projects/shop-dev-123/global/images/base-2023",
      }),
    ).toBe(CloudSavingsActionKind.DeleteImage);
  });

  test("an Arm machine type is not offered in place", () => {
    expect(
      kindOf({
        provider: CloudProvider.GCP,
        kind: CloudSavingKind.Rightsize,
        action: "Change machine type",
        resourceId: instance,
        currentConfiguration: "n2-standard-4",
        recommendedConfiguration: "t2a-standard-4",
      }),
    ).toBe(`not:${CloudSavingsNotOffered.NeedsArmImage}`);
  });

  test("a machine type given as a URL is read by its last part", () => {
    expect(
      readGcpMachineType(
        "https://www.googleapis.com/compute/v1/projects/p/zones/us-central1-a/machineTypes/e2-small",
      ),
    ).toBe("e2-small");
  });
});

describe("the kinds, and what each needs", () => {
  test("every kind has a title, a sentence and an undo, and is made by at least one cloud", () => {
    for (const kind of CLOUD_SAVINGS_ACTION_KINDS) {
      expect(CLOUD_SAVINGS_ACTION_TITLES[kind]).toBeTruthy();
      expect(CLOUD_SAVINGS_ACTION_SENTENCES[kind]).toContain("{{resource}}");
      expect(CLOUD_SAVINGS_ACTION_UNDO[kind]).toBeTruthy();
      expect(
        Object.values(CLOUD_SAVINGS_ACTION_KINDS_BY_PROVIDER).some(
          (kinds: ReadonlyArray<CloudSavingsActionKind>): boolean => {
            return kinds.includes(kind);
          },
        ),
      ).toBe(true);
    }
  });

  test("a resize's sentence says it restarts, and only a resize restarts", () => {
    for (const kind of CLOUD_SAVINGS_ACTION_KINDS) {
      expect(doesCloudSavingsActionRestart(kind)).toBe(
        kind === CloudSavingsActionKind.ResizeInstance ||
          kind === CloudSavingsActionKind.ResizeDatabase,
      );
    }

    expect(
      CLOUD_SAVINGS_ACTION_SENTENCES[CloudSavingsActionKind.ResizeInstance],
    ).toContain("restarts");
  });

  test("a deleted disk is undone from its snapshot only when one was taken", () => {
    expect(
      getCloudSavingsActionUndo({
        kind: CloudSavingsActionKind.DeleteVolume,
        finalSnapshot: true,
      }),
    ).toBe(CloudSavingsActionUndo.FromSnapshot);
    expect(
      getCloudSavingsActionUndo({
        kind: CloudSavingsActionKind.DeleteVolume,
        finalSnapshot: false,
      }),
    ).toBe(CloudSavingsActionUndo.Never);
    expect(
      getCloudSavingsActionUndo({
        kind: CloudSavingsActionKind.ReleaseAddress,
      }),
    ).toBe(CloudSavingsActionUndo.Never);
    expect(
      getCloudSavingsActionUndo({ kind: CloudSavingsActionKind.StopInstance }),
    ).toBe(CloudSavingsActionUndo.Undoable);
  });

  test("Savings actions grants nothing when off, no resize until resize is picked", () => {
    for (const kind of CLOUD_SAVINGS_ACTION_KINDS) {
      expect(
        isCloudSavingsActionAllowed(CloudSavingsActionsAccess.Off, kind),
      ).toBe(false);
      expect(
        isCloudSavingsActionAllowed(CloudSavingsActionsAccess.Resize, kind),
      ).toBe(true);
    }

    expect(
      isCloudSavingsActionAllowed(
        CloudSavingsActionsAccess.CleanUp,
        CloudSavingsActionKind.ResizeInstance,
      ),
    ).toBe(false);
    expect(
      isCloudSavingsActionAllowed(
        CloudSavingsActionsAccess.CleanUp,
        CloudSavingsActionKind.DeleteVolume,
      ),
    ).toBe(true);
  });

  test("an unknown setting reads as off", () => {
    expect(getCloudSavingsActionsAccess(undefined)).toBe(
      CloudSavingsActionsAccess.Off,
    );
    expect(getCloudSavingsActionsAccess("on")).toBe(
      CloudSavingsActionsAccess.Off,
    );
    expect(getCloudSavingsActionsAccess("resize")).toBe(
      CloudSavingsActionsAccess.Resize,
    );
  });

  test("no group holds a change that cannot be undone", () => {
    expect(
      getCloudSavingsActionGroup(CloudSavingsActionKind.ReleaseAddress),
    ).toBeNull();
    expect(
      getCloudSavingsActionGroup(CloudSavingsActionKind.DeleteSnapshot),
    ).toBeNull();
    expect(
      getCloudSavingsActionGroup(CloudSavingsActionKind.DeleteImage),
    ).toBeNull();
    expect(
      getCloudSavingsActionGroup(CloudSavingsActionKind.StopDatabase),
    ).toBe(CloudSavingsActionGroup.Stop);
    expect(
      getCloudSavingsActionGroup(CloudSavingsActionKind.DeleteVolume),
    ).toBe(CloudSavingsActionGroup.DeleteVolume);
  });

  test("every reason a saving is not offered is said", () => {
    for (const reason of Object.values(CloudSavingsNotOffered)) {
      expect(CLOUD_SAVINGS_NOT_OFFERED_SENTENCES[reason]).toBeTruthy();
    }
  });

  test("statuses: what stands, what is still open, and every one has a label", () => {
    expect(isCloudSavingsActionInEffect(CloudSavingsActionStatus.Applied)).toBe(
      true,
    );
    expect(
      isCloudSavingsActionInEffect(
        CloudSavingsActionStatus.AppliedWithoutAsking,
      ),
    ).toBe(true);
    expect(isCloudSavingsActionInEffect(CloudSavingsActionStatus.Undone)).toBe(
      false,
    );
    expect(isCloudSavingsActionOpen(CloudSavingsActionStatus.Proposed)).toBe(
      true,
    );
    expect(isCloudSavingsActionOpen(CloudSavingsActionStatus.Applying)).toBe(
      true,
    );
    expect(isCloudSavingsActionOpen(CloudSavingsActionStatus.Failed)).toBe(
      false,
    );

    for (const status of Object.values(CloudSavingsActionStatus)) {
      expect(CLOUD_SAVINGS_ACTION_STATUS_LABELS[status]).toBeTruthy();
    }

    expect(isCloudSavingsActionKind("StopInstance")).toBe(true);
    expect(isCloudSavingsActionKind("TerminateInstance")).toBe(false);
  });
});

describe("reading sizes off a recommender's summary", () => {
  test("an instance type, a database class, an Azure size", () => {
    expect(readAwsInstanceType("t3a.medium")).toBe("t3a.medium");
    expect(readAwsInstanceType("db.t3.medium")).toBe("");
    expect(readAwsDatabaseClass("db.t3.medium (2 vCPU)")).toBe("db.t3.medium");
    expect(readAzureVmSize("Standard_B2ms")).toBe("Standard_B2ms");
    expect(readAzureVmSize("")).toBe("");
  });

  test("which AWS families are Arm", () => {
    for (const arm of [
      "m6g.large",
      "m7gd.xlarge",
      "c6gn.large",
      "t4g.nano",
      "x2gd.large",
      "im4gn.large",
      "a1.large",
    ]) {
      expect(isAwsArmInstanceType(arm)).toBe(true);
    }

    for (const intel of [
      "g4dn.xlarge",
      "m5.large",
      "m6i.large",
      "c7a.large",
      "t3.micro",
      "inf2.xlarge",
    ]) {
      expect(isAwsArmInstanceType(intel)).toBe(false);
    }
  });
});
