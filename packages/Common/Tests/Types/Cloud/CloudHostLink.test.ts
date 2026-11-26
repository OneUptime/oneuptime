import { describe, expect, test } from "@jest/globals";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AZURE_VM_ID_PROPERTY,
  CLOUD_HOST_VM_TYPES,
  CloudHostFacts,
  CloudMachineIdentity,
  CloudVmFacts,
  GCE_INSTANCE_ID_ATTRIBUTE,
  getAwsPartitionOfRegion,
  getCloudHostIdentity,
  getCloudMachineKey,
  getCloudVmIdentity,
  getCloudVmInstanceId,
  getEc2InstanceArn,
  isCloudHostOfVm,
  isCloudHostVmType,
  isCloudInstanceId,
  linkCloudHostsToVms,
  normalizeCloudAccount,
  normalizeCloudRegion,
  readCloudHostProvider,
} from "../../../Types/Cloud/CloudHostLink";

/*
 * THE HOST A CLOUD VM IS (#11013). A host whose collector ran the cloud
 * detection step carries its cloud, account, Region and host.id - the
 * cloud's own instance ID - and is the VM its cloud connection lists when
 * all four agree. The parts are each cloud's own, read the way the
 * collector's detectors stamp them (an Azure VM's vmId, as one did on an
 * Azure VM with otelcol-contrib 0.165.0: host.id a GUID, cloud.region
 * "eastus"). A host name never links anything, nor does an ID its cloud
 * does not give an instance - the machine-id the system detector stamps
 * off a cloud - and a key two hosts or two VMs claim links neither.
 */

const AWS_ACCOUNT: string = "123456789012";
const AWS_INSTANCE: string = "i-0abc123def4567890";
const AZURE_SUBSCRIPTION: string = "5B31F3FF-7021-4486-8B6B-9B0E156C9B2C";
const AZURE_VM_ID: string = "a795d522-f96c-433d-93df-d1657a8f80b3";
const GCE_ID: string = "4728196572738160511";

function awsHost(overrides: Partial<CloudHostFacts> = {}): CloudHostFacts {
  return {
    id: "host-aws",
    hostId: AWS_INSTANCE,
    cloudProvider: "aws",
    cloudAccountId: AWS_ACCOUNT,
    cloudRegion: "eu-west-1",
    ...overrides,
  };
}

function awsVm(overrides: Partial<CloudVmFacts> = {}): CloudVmFacts {
  return {
    id: "vm-aws",
    provider: "aws",
    type: CLOUD_HOST_VM_TYPES[CloudProvider.AWS],
    accountId: AWS_ACCOUNT,
    region: "eu-west-1",
    providerResourceId: `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:instance/${AWS_INSTANCE}`,
    ...overrides,
  };
}

function azureHost(overrides: Partial<CloudHostFacts> = {}): CloudHostFacts {
  return {
    id: "host-azure",
    hostId: AZURE_VM_ID,
    cloudProvider: "azure",
    cloudAccountId: AZURE_SUBSCRIPTION.toLowerCase(),
    cloudRegion: "eastus",
    ...overrides,
  };
}

function azureVm(overrides: Partial<CloudVmFacts> = {}): CloudVmFacts {
  return {
    id: "vm-azure",
    provider: "azure",
    type: CLOUD_HOST_VM_TYPES[CloudProvider.Azure],
    accountId: AZURE_SUBSCRIPTION,
    region: "East US",
    providerResourceId: `/subscriptions/${AZURE_SUBSCRIPTION}/resourceGroups/dev/providers/Microsoft.Compute/virtualMachines/dev`,
    properties: { [AZURE_VM_ID_PROPERTY]: AZURE_VM_ID.toUpperCase() },
    ...overrides,
  };
}

function gceHost(overrides: Partial<CloudHostFacts> = {}): CloudHostFacts {
  return {
    id: "host-gce",
    hostId: GCE_ID,
    cloudProvider: "gcp",
    cloudAccountId: "shop-prod",
    cloudRegion: "us-central1",
    ...overrides,
  };
}

function gceVm(overrides: Partial<CloudVmFacts> = {}): CloudVmFacts {
  return {
    id: "vm-gce",
    provider: "gcp",
    type: CLOUD_HOST_VM_TYPES[CloudProvider.GCP],
    accountId: "shop-prod",
    region: "us-central1",
    providerResourceId:
      "//compute.googleapis.com/projects/shop-prod/zones/us-central1-a/instances/web-1",
    telemetryAttributes: { [GCE_INSTANCE_ID_ATTRIBUTE]: GCE_ID },
    ...overrides,
  };
}

describe("each cloud's VMs", () => {
  test("a VM a host can be is an EC2 instance, a Compute Engine VM or an Azure VM, and nothing else", () => {
    expect(isCloudHostVmType("aws", "AWS::EC2::Instance")).toBe(true);
    expect(isCloudHostVmType("AWS", "AWS::EC2::Instance")).toBe(true);
    expect(isCloudHostVmType("gcp", "gce_instance")).toBe(true);
    expect(
      isCloudHostVmType("azure", "Microsoft.Compute/virtualMachines"),
    ).toBe(true);
    expect(isCloudHostVmType("aws", "AWS::RDS::DBInstance")).toBe(false);
    expect(isCloudHostVmType("azure", "AWS::EC2::Instance")).toBe(false);
    expect(isCloudHostVmType("openstack", "server")).toBe(false);
    expect(isCloudHostVmType(null, null)).toBe(false);
  });

  test("a provider is read as OpenTelemetry's cloud.provider writes it", () => {
    expect(readCloudHostProvider(" AWS ")).toBe(CloudProvider.AWS);
    expect(readCloudHostProvider("gcp")).toBe(CloudProvider.GCP);
    expect(readCloudHostProvider("azure")).toBe(CloudProvider.Azure);
    expect(readCloudHostProvider("alibaba_cloud")).toBeNull();
    expect(readCloudHostProvider(3)).toBeNull();
  });

  test("a Region and an account are compared without case or spaces", () => {
    expect(normalizeCloudRegion("East US")).toBe("eastus");
    expect(normalizeCloudRegion(" eu-west-1 ")).toBe("eu-west-1");
    expect(normalizeCloudAccount(AZURE_SUBSCRIPTION)).toBe(
      AZURE_SUBSCRIPTION.toLowerCase(),
    );
  });

  test("an instance ID is one its cloud gives: never the machine-id a host stamps off a cloud", () => {
    expect(isCloudInstanceId(CloudProvider.AWS, AWS_INSTANCE)).toBe(true);
    expect(isCloudInstanceId(CloudProvider.AWS, "i-1234abcd")).toBe(true);
    expect(isCloudInstanceId(CloudProvider.AWS, "i-xyz")).toBe(false);
    expect(isCloudInstanceId(CloudProvider.GCP, GCE_ID)).toBe(true);
    expect(isCloudInstanceId(CloudProvider.GCP, "web-1")).toBe(false);
    expect(isCloudInstanceId(CloudProvider.Azure, AZURE_VM_ID)).toBe(true);
    // A Linux machine-id: 32 hex digits, no dashes.
    const machineId: string = "4d5c0e9a2b1f4e7c8a3b6d9e0f1a2b3c";
    for (const provider of [
      CloudProvider.AWS,
      CloudProvider.GCP,
      CloudProvider.Azure,
    ]) {
      expect({ provider, ok: isCloudInstanceId(provider, machineId) }).toEqual(
        { provider, ok: false },
      );
    }
  });
});

describe("a VM's own instance ID, each cloud's way", () => {
  test("EC2: the end of its ARN, in any partition", () => {
    expect(getCloudVmInstanceId(awsVm())).toBe(AWS_INSTANCE);
    expect(
      getCloudVmInstanceId(
        awsVm({
          providerResourceId: `arn:aws-cn:ec2:cn-north-1:${AWS_ACCOUNT}:instance/${AWS_INSTANCE.toUpperCase()}`,
        }),
      ),
    ).toBe(AWS_INSTANCE);
    expect(
      getCloudVmInstanceId(
        awsVm({ providerResourceId: `arn:aws:ec2:eu-west-1:${AWS_ACCOUNT}:volume/vol-1` }),
      ),
    ).toBeNull();
  });

  test("Compute Engine: the numeric ID its telemetry carries, not its name", () => {
    expect(getCloudVmInstanceId(gceVm())).toBe(GCE_ID);
    expect(
      getCloudVmInstanceId(gceVm({ telemetryAttributes: {} })),
    ).toBeNull();
    expect(
      getCloudVmInstanceId(
        gceVm({ telemetryAttributes: { [GCE_INSTANCE_ID_ATTRIBUTE]: "web-1" } }),
      ),
    ).toBeNull();
  });

  test("Azure: its vmId, as the inventory keeps it, in lower case", () => {
    expect(getCloudVmInstanceId(azureVm())).toBe(AZURE_VM_ID);
    expect(getCloudVmInstanceId(azureVm({ properties: {} }))).toBeNull();
    expect(getCloudVmInstanceId(azureVm({ properties: null }))).toBeNull();
  });

  test("a resource of another type keeps no instance ID a host can be", () => {
    expect(
      getCloudVmInstanceId(awsVm({ type: "AWS::RDS::DBInstance" })),
    ).toBeNull();
  });
});

describe("a host and a VM, as one machine", () => {
  test.each([
    ["AWS", awsHost(), awsVm()],
    ["Azure, whose location the inventory may spell as its display name", azureHost(), azureVm()],
    ["Google Cloud", gceHost(), gceVm()],
  ])("%s: all four parts agree", (_label: string, host: CloudHostFacts, vm: CloudVmFacts) => {
    expect(isCloudHostOfVm(host, vm)).toBe(true);

    const identity: CloudMachineIdentity | null = getCloudHostIdentity(host);
    expect(identity).not.toBeNull();
    expect(getCloudMachineKey(identity!)).toBe(
      getCloudMachineKey(getCloudVmIdentity(vm)!),
    );
  });

  test.each([
    ["another account", awsHost({ cloudAccountId: "210987654321" })],
    ["another Region", awsHost({ cloudRegion: "eu-west-2" })],
    ["another instance", awsHost({ hostId: "i-0fff123def4567890" })],
    ["another cloud", awsHost({ cloudProvider: "gcp" })],
    ["no Region stamped", awsHost({ cloudRegion: "" })],
    ["no account stamped", awsHost({ cloudAccountId: null })],
    ["the system's machine-id, off a cloud", awsHost({ hostId: "4d5c0e9a2b1f4e7c8a3b6d9e0f1a2b3c" })],
    ["a Kubernetes node", awsHost({ kubernetesClusterId: "cluster-1" })],
    ["an archived host", awsHost({ isArchived: true })],
  ])("never with %s", (_label: string, host: CloudHostFacts) => {
    expect(isCloudHostOfVm(host, awsVm())).toBe(false);
  });

  test("never an archived VM", () => {
    expect(isCloudHostOfVm(awsHost(), awsVm({ isArchived: true }))).toBe(false);
  });
});

describe("linking a project's hosts to its VMs", () => {
  test("each VM to the one host that is it, and nothing else", () => {
    const links: Map<string, string> = linkCloudHostsToVms({
      hosts: [
        awsHost(),
        azureHost(),
        gceHost(),
        awsHost({ id: "host-nothing", hostId: "i-0eee123def4567890" }),
      ],
      vms: [awsVm(), azureVm(), gceVm()],
    });

    expect(Object.fromEntries(links)).toEqual({
      "vm-aws": "host-aws",
      "vm-azure": "host-azure",
      "vm-gce": "host-gce",
    });
  });

  test("a key two hosts claim - a cloned machine - links neither, and so does one two VMs claim", () => {
    expect(
      linkCloudHostsToVms({
        hosts: [awsHost(), awsHost({ id: "host-clone" })],
        vms: [awsVm()],
      }).size,
    ).toBe(0);
    expect(
      linkCloudHostsToVms({
        hosts: [awsHost()],
        vms: [awsVm(), awsVm({ id: "vm-twice" })],
      }).size,
    ).toBe(0);
  });

  test("one host listed twice is still one host", () => {
    expect(
      Object.fromEntries(
        linkCloudHostsToVms({ hosts: [awsHost(), awsHost()], vms: [awsVm()] }),
      ),
    ).toEqual({ "vm-aws": "host-aws" });
  });
});

describe("the ARN a host on EC2 is", () => {
  test.each([
    ["eu-west-1", "aws"],
    ["cn-north-1", "aws-cn"],
    ["us-gov-west-1", "aws-us-gov"],
    ["us-iso-east-1", "aws-iso"],
    ["us-isob-east-1", "aws-iso-b"],
  ])("in %s, in the %s partition", (region: string, partition: string) => {
    expect(getAwsPartitionOfRegion(region)).toBe(partition);
    expect(
      getEc2InstanceArn({
        provider: CloudProvider.AWS,
        accountId: AWS_ACCOUNT,
        region,
        instanceId: AWS_INSTANCE,
      }),
    ).toBe(
      `arn:${partition}:ec2:${region}:${AWS_ACCOUNT}:instance/${AWS_INSTANCE}`,
    );
  });
});
