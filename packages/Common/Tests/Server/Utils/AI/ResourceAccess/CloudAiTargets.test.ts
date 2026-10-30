import CloudAiTargets, {
  CloudChangeTarget,
  CloudChangeTargetCheck,
  getCloudUndoCommandText,
} from "../../../../../Server/Utils/AI/ResourceAccess/CloudAiTargets";
import CloudAccountService from "../../../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../../../Server/Services/CloudResourceService";
import CloudAccount from "../../../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../../../Models/DatabaseModels/CloudResource";
import ObjectID from "../../../../../Types/ObjectID";
import AiResourceType from "../../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { formatCloudReplacedValue } from "../../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a Cloud AI agent's change may name: a resource of the account's own
 * inventory, read as root in the account's project and cloud. A resource
 * declared as code is found by its tags (labels on Google Cloud), and a
 * change's exact undo is written from the value its output reports.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ACCOUNT_ROW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const SITE: string =
  "/subscriptions/00000000-0000-0000-0000-0000000000ab/resourceGroups/prod/providers/Microsoft.Web/sites/web";

describe("which code declares a resource", () => {
  test.each([
    [
      { "aws:cloudformation:stack-name": "web-prod" },
      'CloudFormation stack "web-prod"',
    ],
    [{ "goog-terraform-provisioned": "true" }, "Terraform"],
    [{ Terraform: "yes" }, "Terraform"],
    [{ "terraform:workspace": "prod" }, "Terraform"],
    [{ "pulumi:project": "web" }, "Pulumi"],
    [{ "managed-by": "OpenTofu" }, "OpenTofu"],
    [{ ManagedBy: "terraform-cloud" }, "Terraform"],
    [{ provisioner: "bicep" }, "Bicep"],
    [{ "deployed-by": "cdk" }, "the AWS CDK"],
  ])("%p is declared by %s", (tags: Record<string, string>, owner: string) => {
    expect(CloudAiTargets.getManagedAsCode(tags)).toBe(owner);
  });

  test("a CloudFormation stack wins over a tag that names a tool", () => {
    expect(
      CloudAiTargets.getManagedAsCode({
        "managed-by": "terraform",
        "aws:cloudformation:stack-name": "web",
      }),
    ).toBe('CloudFormation stack "web"');
  });

  test.each([
    [{}],
    [{ team: "web", "managed-by": "people" }],
    [{ terraform: "false" }],
    [null],
    [undefined],
  ])("%p is declared by no code", (tags: unknown) => {
    expect(
      CloudAiTargets.getManagedAsCode(tags as Record<string, string>),
    ).toBeNull();
  });
});

describe("the resource a command names", () => {
  test("is the canonical id of the catalog's parse", () => {
    expect(
      CloudAiTargets.readCommandResourceId({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count 4`,
      }),
    ).toBe(ECS);
    expect(
      CloudAiTargets.readCommandResourceId({
        resourceType: AiResourceType.GoogleCloudProject,
        command:
          "cloud reboot-instance //sqladmin.googleapis.com/projects/p-123456/instances/orders",
      }),
    ).toBe("//cloudsql.googleapis.com/projects/p-123456/instances/orders");
  });

  test("is nothing for whoami, a command of another cloud or one that does not parse", () => {
    for (const [type, command] of [
      [AiResourceType.AwsAccount, "cloud whoami"],
      [AiResourceType.AzureSubscription, `cloud restart-service ${ECS}`],
      [AiResourceType.AwsAccount, "docker ps"],
      [AiResourceType.DockerHost, `cloud describe ${ECS}`],
    ] as Array<[AiResourceType, string]>) {
      expect(
        CloudAiTargets.readCommandResourceId({ resourceType: type, command }),
      ).toBeNull();
    }
  });
});

describe("a change's target in the account's inventory", () => {
  let accountFind: ReturnType<typeof jest.spyOn>;
  let resourceFind: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    const account: CloudAccount = new CloudAccount();
    account._id = ACCOUNT_ROW_ID.toString();
    account.accountId = "123456789012";

    accountFind = jest
      .spyOn(CloudAccountService, "findOneBy")
      .mockResolvedValue(account);

    const resource: CloudResource = new CloudResource();
    resource.id = RESOURCE_ID;
    resource._id = RESOURCE_ID.toString();
    resource.name = "web";
    resource.providerResourceId = ECS;
    resource.cloudTags = { "aws:cloudformation:stack-name": "web-prod" };

    resourceFind = jest
      .spyOn(CloudResourceService, "findOneBy")
      .mockResolvedValue(resource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is read as root in the account's project, cloud and account, among live resources", async () => {
    const target: CloudChangeTarget | null =
      await CloudAiTargets.findChangeTarget({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.AwsAccount,
        cloudAccountId: ACCOUNT_ROW_ID,
        providerResourceId: ECS,
      });

    expect(target).toEqual({
      cloudResourceId: RESOURCE_ID,
      name: "web",
      providerResourceId: ECS,
      cloudTags: { "aws:cloudformation:stack-name": "web-prod" },
      managedAsCode: 'CloudFormation stack "web-prod"',
    });

    const accountQuery: Record<string, unknown> = accountFind.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(accountQuery["_id"]).toBe(ACCOUNT_ROW_ID.toString());
    expect(accountQuery["projectId"]).toBe(PROJECT_ID);
    expect(accountQuery["provider"]).toBe("aws");
    expect(accountFind.mock.calls[0]![0].props).toEqual({ isRoot: true });

    const resourceQuery: Record<string, unknown> = resourceFind.mock
      .calls[0]![0].query as Record<string, unknown>;
    expect(resourceQuery["projectId"]).toBe(PROJECT_ID);
    expect(resourceQuery["cloudProvider"]).toBe("aws");
    expect(resourceQuery["providerResourceId"]).toBe(ECS);
    expect(resourceQuery["isArchived"]).toBe(false);
    // The account id is compared without case, as the account's counts are.
    expect(resourceQuery["cloudAccountId"]).toBeDefined();
    expect(resourceQuery["cloudAccountId"]).not.toBe("123456789012");
  });

  test("an Azure id is compared without case", async () => {
    await CloudAiTargets.findChangeTarget({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AzureSubscription,
      cloudAccountId: ACCOUNT_ROW_ID,
      providerResourceId: SITE,
    });

    const resourceQuery: Record<string, unknown> = resourceFind.mock
      .calls[0]![0].query as Record<string, unknown>;
    expect(resourceQuery["providerResourceId"]).not.toBe(SITE);
    expect(resourceQuery["cloudProvider"]).toBe("azure");
  });

  test("is nothing when the account is not this project's cloud's", async () => {
    accountFind.mockResolvedValue(null);

    await expect(
      CloudAiTargets.findChangeTarget({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.AwsAccount,
        cloudAccountId: ACCOUNT_ROW_ID,
        providerResourceId: ECS,
      }),
    ).resolves.toBeNull();
    expect(resourceFind).not.toHaveBeenCalled();
  });

  test("a change whose resource the inventory lists passes, with what declares it", async () => {
    const check: CloudChangeTargetCheck = await CloudAiTargets.checkChange({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      cloudAccountId: ACCOUNT_ROW_ID,
      tier: ResourceCommandTier.SafeWrite,
      command: `cloud scale-out ${ECS} --count 4`,
    });

    expect(check.refusal).toBeNull();
    expect(check.target?.managedAsCode).toBe('CloudFormation stack "web-prod"');
  });

  test("a change whose resource the inventory does not list is refused, and says where ids come from", async () => {
    resourceFind.mockResolvedValue(null);

    const check: CloudChangeTargetCheck = await CloudAiTargets.checkChange({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      cloudAccountId: ACCOUNT_ROW_ID,
      tier: ResourceCommandTier.RiskyWrite,
      command: `cloud scale-in ${ECS} --count 2`,
    });

    expect(check.refusal).toContain(ECS);
    expect(check.refusal).toContain("not in this AWS account's inventory");
    expect(check.refusal).toContain("query_cloud_resource");
    expect(check.target).toBeNull();
  });

  test("a read is never checked", async () => {
    const check: CloudChangeTargetCheck = await CloudAiTargets.checkChange({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      cloudAccountId: ACCOUNT_ROW_ID,
      tier: ResourceCommandTier.Read,
      command: `cloud describe ${ECS}`,
    });

    expect(check).toEqual({ refusal: null, target: null });
    expect(accountFind).not.toHaveBeenCalled();
  });

  test("a change that names no resource is refused", async () => {
    const check: CloudChangeTargetCheck = await CloudAiTargets.checkChange({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      cloudAccountId: ACCOUNT_ROW_ID,
      tier: ResourceCommandTier.SafeWrite,
      command: "cloud whoami",
    });

    expect(check.refusal).toMatch(/names no resource/);
  });

  test("a failed lookup propagates, so the caller fails closed", async () => {
    resourceFind.mockRejectedValue(new Error("database down"));

    await expect(
      CloudAiTargets.checkChange({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.AwsAccount,
        cloudAccountId: ACCOUNT_ROW_ID,
        tier: ResourceCommandTier.SafeWrite,
        command: `cloud scale-out ${ECS} --count 4`,
      }),
    ).rejects.toThrow("database down");
  });
});

describe("the undo of a change that ran", () => {
  test("is the catalog's inverse with the value the output's first line reports", () => {
    expect(
      getCloudUndoCommandText({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count 4`,
        output: `${formatCloudReplacedValue({ count: "2" })}\nECS service web: desired count 2 → 4`,
      }),
    ).toBe(`cloud scale-in ${ECS} --count 2`);
  });

  test("is nothing without the replaced value, for a restart, or for a command that does not parse", () => {
    expect(
      getCloudUndoCommandText({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud scale-out ${ECS} --count 4`,
        output: "ECS service web: desired count 2 → 4",
      }),
    ).toBeNull();
    expect(
      getCloudUndoCommandText({
        resourceType: AiResourceType.AwsAccount,
        command: `cloud restart-service ${ECS}`,
        output: formatCloudReplacedValue({}),
      }),
    ).toBeNull();
    expect(
      getCloudUndoCommandText({
        resourceType: AiResourceType.AwsAccount,
        command: "cloud explode",
        output: "",
      }),
    ).toBeNull();
    expect(
      getCloudUndoCommandText({
        resourceType: AiResourceType.DockerHost,
        command: "docker stop web",
        output: "",
      }),
    ).toBeNull();
  });
});
