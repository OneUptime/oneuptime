/*
 * Toolbox/Index MUST be imported before any individual tool module: the
 * toolbox sits in an import cycle (tool -> service -> ... -> AIToolbox), and
 * production always enters through Index.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  CloudNeighbour,
  MAX_LISTED_RELATIONSHIPS,
  QueryCloudAccountsTool,
  QueryCloudResourceTool,
  describeCloudRelationships,
  flattenCloudProperties,
} from "../../../../Server/Utils/AI/Toolbox/CloudTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * What OneUptime AI reads about a connected cloud: one resource as its
 * account's inventory lists it - tags, settings, endpoints, and its
 * relationships both ways, named after the resources the connection holds
 * - and the connected accounts with what they hold. Everything is read as
 * the caller, in the caller's project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INSTANCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SUBNET_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const LB_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SG_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const ACCOUNT: string = "123456789012";
const INSTANCE_ARN: string = `arn:aws:ec2:eu-west-1:${ACCOUNT}:instance/i-0abc`;

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true },
};

function neighbour(
  data: Partial<CloudNeighbour> & { id: ObjectID },
): CloudNeighbour {
  return {
    name: "",
    providerResourceId: "",
    type: "",
    relationships: [],
    ...data,
  };
}

const SUBNET: CloudNeighbour = neighbour({
  id: SUBNET_ID,
  name: "private-a",
  providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:subnet/subnet-0abc`,
  type: "AWS::EC2::Subnet",
});

const LOAD_BALANCER: CloudNeighbour = neighbour({
  id: LB_ID,
  name: "web-alb",
  providerResourceId: `arn:aws:elasticloadbalancing:eu-west-1:${ACCOUNT}:loadbalancer/app/web-alb/50dc6c495c0c9188`,
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  relationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: "i-0abc",
      targetType: "AWS::EC2::Instance",
    },
  ],
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a resource's relationships", () => {
  test("are named after the resources held, both ways", () => {
    const described: { rows: Array<JSONObject>; total: number } =
      describeCloudRelationships({
        resource: {
          id: INSTANCE_ID,
          providerResourceId: INSTANCE_ARN,
          type: "AWS::EC2::Instance",
        },
        relationships: [
          {
            kind: CloudRelationshipKind.RunsIn,
            target: "subnet-0abc",
            targetType: "AWS::EC2::Subnet",
          },
          {
            kind: CloudRelationshipKind.ProtectedBy,
            target: "sg-0unknown",
            targetType: "AWS::EC2::SecurityGroup",
          },
        ],
        neighbours: [SUBNET, LOAD_BALANCER],
        limit: MAX_LISTED_RELATIONSHIPS,
      });

    expect(described.total).toBe(3);
    expect(described.rows).toEqual([
      {
        relationship: "Runs in",
        direction: "out",
        other: "private-a",
        otherType: "AWS::EC2::Subnet",
        otherCloudResourceId: SUBNET_ID.toString(),
      },
      {
        relationship: "Protected by",
        direction: "out",
        other: "sg-0unknown",
        otherType: "AWS::EC2::SecurityGroup",
        otherCloudResourceId: "",
      },
      {
        relationship: "Sends traffic to",
        direction: "in",
        other: "web-alb",
        otherType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        otherCloudResourceId: LB_ID.toString(),
      },
    ]);
  });

  test("a name two resources of different types share never ties them", () => {
    const described: { rows: Array<JSONObject>; total: number } =
      describeCloudRelationships({
        resource: {
          id: INSTANCE_ID,
          providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:orders`,
          type: "AWS::SQS::Queue",
        },
        relationships: [
          {
            kind: CloudRelationshipKind.DeadLettersTo,
            target: "orders",
            targetType: "AWS::SQS::Queue",
          },
        ],
        neighbours: [
          neighbour({
            id: SG_ID,
            name: "orders",
            providerResourceId: `arn:aws:sns:eu-west-1:${ACCOUNT}:orders`,
            type: "AWS::SNS::Topic",
            relationships: [
              {
                kind: CloudRelationshipKind.RoutesTo,
                target: "orders",
                targetType: "AWS::SNS::Topic",
              },
            ],
          }),
        ],
        limit: MAX_LISTED_RELATIONSHIPS,
      });

    expect(described.rows).toEqual([
      {
        relationship: "Dead letters go to",
        direction: "out",
        other: "orders",
        otherType: "AWS::SQS::Queue",
        otherCloudResourceId: "",
      },
    ]);
  });

  test("are listed up to the limit, and counted past it", () => {
    const described: { rows: Array<JSONObject>; total: number } =
      describeCloudRelationships({
        resource: {
          id: INSTANCE_ID,
          providerResourceId: INSTANCE_ARN,
          type: "AWS::EC2::Instance",
        },
        relationships: [1, 2, 3].map((index: number) => {
          return {
            kind: CloudRelationshipKind.AttachedTo,
            target: `vol-${index}`,
          };
        }),
        neighbours: [],
        limit: 2,
      });

    expect(described.rows).toHaveLength(2);
    expect(described.total).toBe(3);
  });
});

describe("a resource's properties", () => {
  test("are read as dotted paths, lists joined", () => {
    expect(
      flattenCloudProperties({
        InstanceType: "m5.large",
        Placement: { AvailabilityZone: "eu-west-1a" },
        SecurityGroups: ["sg-1", "sg-2"],
        Empty: "",
        Missing: null,
      }),
    ).toEqual({
      InstanceType: "m5.large",
      "Placement.AvailabilityZone": "eu-west-1a",
      SecurityGroups: "sg-1, sg-2",
    });
  });

  test("anything that is not an object is nothing", () => {
    expect(flattenCloudProperties(null)).toEqual({});
    expect(flattenCloudProperties(["a"])).toEqual({});
    expect(flattenCloudProperties("text")).toEqual({});
  });
});

describe("query_cloud_resource", () => {
  test("is in the toolbox", () => {
    expect(
      AIToolbox.getTools().map((tool: { name: string }): string => {
        return tool.name;
      }),
    ).toEqual(
      expect.arrayContaining(["query_cloud_resource", "query_cloud_accounts"]),
    );
  });

  test("reads the resource in the caller's project, as the caller, and lists what its cloud says", async () => {
    const findOne: SpyInstance<typeof CloudResourceService.findOneBy> = jest
      .spyOn(CloudResourceService, "findOneBy")
      .mockResolvedValue({
        id: INSTANCE_ID,
        name: "web-1",
        cloudProvider: CloudProvider.AWS,
        cloudAccountId: ACCOUNT,
        cloudRegion: "eu-west-1",
        cloudResourceType: "AWS::EC2::Instance",
        providerResourceId: INSTANCE_ARN,
        cloudTags: { team: "payments", env: "prod" },
        cloudProperties: { InstanceType: "m5.large" },
        cloudRelationships: [
          {
            kind: CloudRelationshipKind.RunsIn,
            target: "subnet-0abc",
            targetType: "AWS::EC2::Subnet",
          },
        ],
        cloudEndpoints: ["ip-10-0-1-5.eu-west-1.compute.internal"],
        inventoriedAt: new Date("2026-10-21T12:00:00Z"),
      } as never);
    const findNeighbours: SpyInstance<typeof CloudResourceService.findBy> = jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([
        {
          id: SUBNET_ID,
          name: "private-a",
          providerResourceId: SUBNET.providerResourceId,
          cloudResourceType: "AWS::EC2::Subnet",
          cloudRelationships: [],
        },
        {
          id: LB_ID,
          name: "web-alb",
          providerResourceId: LOAD_BALANCER.providerResourceId,
          cloudResourceType: LOAD_BALANCER.type,
          cloudRelationships: LOAD_BALANCER.relationships,
        },
      ] as never);

    const result: ToolExecutionResult = await QueryCloudResourceTool.execute(
      { cloudResourceId: INSTANCE_ID.toString() },
      ctx,
    );

    const findArgs: JSONObject = findOne.mock.calls[0]![0] as never;
    expect((findArgs["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
    expect(findArgs["props"]).toBe(ctx.props);
    const neighbourArgs: JSONObject = findNeighbours.mock.calls[0]![0] as never;
    expect((neighbourArgs["query"] as JSONObject)["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(neighbourArgs["props"]).toBe(ctx.props);

    expect(result.dataForLlm).toContain("section=resource | name=web-1");
    expect(result.dataForLlm).toContain(
      "type=EC2 Instance (AWS::EC2::Instance)",
    );
    expect(result.dataForLlm).toContain(
      "section=tags | team=payments | env=prod",
    );
    expect(result.dataForLlm).toContain(
      "section=properties | InstanceType=m5.large",
    );
    expect(result.dataForLlm).toContain(
      "section=endpoints | hosts=ip-10-0-1-5.eu-west-1.compute.internal",
    );
    expect(result.dataForLlm).toContain(
      `relationship=Runs in | direction=out | other=private-a | otherType=AWS::EC2::Subnet | otherCloudResourceId=${SUBNET_ID.toString()}`,
    );
    expect(result.dataForLlm).toContain(
      `relationship=Sends traffic to | direction=in | other=web-alb`,
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.TelemetryResourceView,
      params: {
        resourceType: AIResourceType.CloudResource,
        resourceId: INSTANCE_ID.toString(),
      },
    });
  });

  test("a resource known from its metrics only says it has not been listed", async () => {
    jest.spyOn(CloudResourceService, "findOneBy").mockResolvedValue({
      id: INSTANCE_ID,
      name: "web-1",
      cloudProvider: CloudProvider.AWS,
      cloudAccountId: "",
    } as never);
    const findNeighbours: SpyInstance<typeof CloudResourceService.findBy> = jest
      .spyOn(CloudResourceService, "findBy")
      .mockResolvedValue([]);

    const result: ToolExecutionResult = await QueryCloudResourceTool.execute(
      { cloudResourceId: INSTANCE_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "The account's inventory has not listed this resource",
    );
    // Without an account there is nothing to read its neighbours from.
    expect(findNeighbours).not.toHaveBeenCalled();
  });

  test("an id that is not a UUID, or a resource the caller cannot read, is an error", async () => {
    await expect(
      QueryCloudResourceTool.execute({ cloudResourceId: "web-1" }, ctx),
    ).rejects.toBeInstanceOf(BadDataException);

    jest.spyOn(CloudResourceService, "findOneBy").mockResolvedValue(null);

    await expect(
      QueryCloudResourceTool.execute(
        { cloudResourceId: INSTANCE_ID.toString() },
        ctx,
      ),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("query_cloud_accounts", () => {
  test("lists the connected accounts with what they hold, as the caller", async () => {
    const find: SpyInstance<typeof CloudAccountService.findBy> = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([
        {
          name: "Production",
          provider: CloudProvider.AWS,
          accountId: ACCOUNT,
          providerAccountName: "acme-prod",
          resourceCount: 42,
          resourceSummary: {
            resourceCount: 42,
            types: [{ type: "AWS::Lambda::Function", count: 30 }],
            regions: [{ region: "eu-west-1", count: 42 }],
          },
          lastSeenAt: new Date("2026-10-21T12:00:00Z"),
        },
        {
          name: "Sandbox",
          provider: CloudProvider.AWS,
          accountId: "210987654321",
          resourceCount: 3,
        },
      ] as never);

    const result: ToolExecutionResult = await QueryCloudAccountsTool.execute(
      { provider: "aws", search: "PROD" },
      ctx,
    );

    const findArgs: JSONObject = find.mock.calls[0]![0] as never;
    expect(findArgs["query"]).toEqual({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
    });
    expect(findArgs["props"]).toBe(ctx.props);

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain(
      `name=Production | cloud=aws | accountId=${ACCOUNT} | nameInCloud=acme-prod | resources=42 | regions=eu-west-1 (42) | topTypes=Lambda Function (30)`,
    );
    expect(result.dataForLlm).not.toContain("Sandbox");
  });

  test("an unknown cloud filters nothing; no account says how to connect one", async () => {
    const find: SpyInstance<typeof CloudAccountService.findBy> = jest
      .spyOn(CloudAccountService, "findBy")
      .mockResolvedValue([]);

    const result: ToolExecutionResult = await QueryCloudAccountsTool.execute(
      { provider: "oracle" },
      ctx,
    );

    expect((find.mock.calls[0]![0] as never as JSONObject)["query"]).toEqual({
      projectId: PROJECT_ID,
    });
    expect(result.dataForLlm).toContain("Cloud > Connect");
  });
});
