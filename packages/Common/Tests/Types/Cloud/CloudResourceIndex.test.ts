import { describe, expect, test } from "@jest/globals";
import { CloudRelationshipKind } from "../../../Types/Cloud/CloudInventory";
import {
  CloudLinkedResource,
  CloudResolvedRelationship,
  CloudResourceIndex,
  CloudResourceLink,
  getCloudResourceLinks,
  resolveCloudRelationships,
} from "../../../Types/Cloud/CloudResourceIndex";
import ObjectID from "../../../Types/ObjectID";

/*
 * How the resources of one cloud account are found by the names other parts
 * of the cloud give them, and how their relationships read from either end:
 * the one matcher the change recorder, OneUptime AI's cloud tools, a
 * resource's Connected Resources card and an account's topology share.
 */

const ACCOUNT: string = "123456789012";

function id(n: number): ObjectID {
  return new ObjectID(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

function resource(
  data: Partial<CloudLinkedResource> & { id: ObjectID; type: string },
): CloudLinkedResource {
  return {
    name: "",
    providerResourceId: "",
    relationships: [],
    ...data,
  };
}

const VPC: CloudLinkedResource = resource({
  id: id(1),
  name: "main",
  providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:vpc/vpc-0main`,
  type: "AWS::EC2::VPC",
});

const SUBNET: CloudLinkedResource = resource({
  id: id(2),
  name: "private-a",
  providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:subnet/subnet-0abc`,
  type: "AWS::EC2::Subnet",
  relationships: [
    {
      kind: CloudRelationshipKind.RunsIn,
      target: "vpc-0main",
      targetType: "AWS::EC2::VPC",
    },
  ],
});

const INSTANCE: CloudLinkedResource = resource({
  id: id(3),
  name: "web-1",
  providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:instance/i-0web`,
  type: "AWS::EC2::Instance",
  relationships: [
    {
      kind: CloudRelationshipKind.RunsIn,
      target: "subnet-0abc",
      targetType: "AWS::EC2::Subnet",
    },
    {
      kind: CloudRelationshipKind.ProtectedBy,
      target: "sg-0gone",
      targetType: "AWS::EC2::SecurityGroup",
    },
  ],
});

const LOAD_BALANCER: CloudLinkedResource = resource({
  id: id(4),
  name: "web-alb",
  providerResourceId: `arn:aws:elasticloadbalancing:eu-west-1:${ACCOUNT}:loadbalancer/app/web-alb/50dc6c495c0c9188`,
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  relationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: "i-0web",
      targetType: "AWS::EC2::Instance",
    },
    // Listed twice by the cloud: one link.
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: `arn:aws:ec2:eu-west-1:${ACCOUNT}:instance/i-0web`,
    },
  ],
});

describe("the index", () => {
  test("one row given twice, as two ObjectID instances, is still one resource", () => {
    const index: CloudResourceIndex = new CloudResourceIndex([
      {
        id: new ObjectID(id(9).toString()),
        name: "orders",
        providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:orders`,
        type: "AWS::SQS::Queue",
      },
      {
        id: new ObjectID(id(9).toString()),
        name: "orders",
        providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:orders`,
        type: "AWS::SQS::Queue",
      },
    ]);

    expect(index.find({ id: "orders" })?.id.toString()).toBe(id(9).toString());
  });

  test("a row without a provider id is never found", () => {
    const index: CloudResourceIndex = new CloudResourceIndex([
      { id: id(9), name: "x", providerResourceId: "  ", type: "T" },
    ]);

    expect(index.find({ id: "x" })).toBeNull();
  });
});

describe("a resource's relationships, both ways", () => {
  test("its own come first, named after the resources held, then those naming it", () => {
    const resolved: Array<CloudResolvedRelationship> =
      resolveCloudRelationships({
        resource: INSTANCE,
        relationships: INSTANCE.relationships,
        neighbours: [VPC, SUBNET, INSTANCE, LOAD_BALANCER],
      });

    expect(
      resolved.map((relationship: CloudResolvedRelationship) => {
        return [
          relationship.direction,
          relationship.kind,
          relationship.otherName,
          relationship.otherType,
          relationship.other?.id.toString() || "",
        ];
      }),
    ).toEqual([
      [
        "out",
        CloudRelationshipKind.RunsIn,
        "private-a",
        "AWS::EC2::Subnet",
        SUBNET.id.toString(),
      ],
      // Not held: named as the cloud named it.
      [
        "out",
        CloudRelationshipKind.ProtectedBy,
        "sg-0gone",
        "AWS::EC2::SecurityGroup",
        "",
      ],
      // The load balancer lists it twice; both name it.
      [
        "in",
        CloudRelationshipKind.RoutesTo,
        "web-alb",
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        LOAD_BALANCER.id.toString(),
      ],
      [
        "in",
        CloudRelationshipKind.RoutesTo,
        "web-alb",
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        LOAD_BALANCER.id.toString(),
      ],
    ]);
  });

  test("the type of a relationship's target is the found resource's when the cloud did not say", () => {
    const resolved: Array<CloudResolvedRelationship> =
      resolveCloudRelationships({
        resource: LOAD_BALANCER,
        relationships: [
          {
            kind: CloudRelationshipKind.RoutesTo,
            target: `arn:aws:ec2:eu-west-1:${ACCOUNT}:instance/i-0web`,
          },
        ],
        neighbours: [INSTANCE],
      });

    expect(resolved[0]?.otherType).toBe("AWS::EC2::Instance");
    expect(resolved[0]?.other?.id.toString()).toBe(INSTANCE.id.toString());
  });

  test("a resource of another type that answers to the same name is not the target", () => {
    const topic: CloudLinkedResource = resource({
      id: id(7),
      name: "orders",
      providerResourceId: `arn:aws:sns:eu-west-1:${ACCOUNT}:orders`,
      type: "AWS::SNS::Topic",
      relationships: [
        // Names "orders", but a queue: not the queue's own topic.
        {
          kind: CloudRelationshipKind.RoutesTo,
          target: "orders",
          targetType: "AWS::SNS::Topic",
        },
      ],
    });
    const queue: CloudLinkedResource = resource({
      id: id(8),
      name: "orders",
      providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:orders`,
      type: "AWS::SQS::Queue",
    });

    const resolved: Array<CloudResolvedRelationship> =
      resolveCloudRelationships({
        resource: queue,
        relationships: [
          {
            kind: CloudRelationshipKind.DeadLettersTo,
            target: "orders",
            targetType: "AWS::SQS::Queue",
          },
        ],
        neighbours: [topic],
      });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.direction).toBe("out");
    expect(resolved[0]?.other).toBeNull();
  });

  test("a relationship of a kind it does not know is left out", () => {
    const resolved: Array<CloudResolvedRelationship> =
      resolveCloudRelationships({
        resource: INSTANCE,
        relationships: [
          {
            kind: "owns" as CloudRelationshipKind,
            target: "subnet-0abc",
          },
        ],
        neighbours: [
          SUBNET,
          resource({
            id: id(10),
            type: "AWS::Backup::Plan",
            relationships: [
              {
                kind: "backs-up" as CloudRelationshipKind,
                target: "i-0web",
              },
            ],
          }),
        ],
      });

    expect(resolved).toEqual([]);
  });

  test("its own relationships never come back as naming it", () => {
    const loop: CloudLinkedResource = resource({
      id: id(11),
      name: "self",
      providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:self`,
      type: "AWS::SQS::Queue",
      relationships: [
        { kind: CloudRelationshipKind.DeadLettersTo, target: "self" },
      ],
    });

    const resolved: Array<CloudResolvedRelationship> =
      resolveCloudRelationships({
        resource: loop,
        relationships: loop.relationships,
        neighbours: [loop],
      });

    expect(
      resolved.map((relationship: CloudResolvedRelationship) => {
        return relationship.direction;
      }),
    ).toEqual(["out"]);
  });
});

describe("an account's links", () => {
  test("every relationship both ends of are held, once, in the order listed", () => {
    const links: Array<CloudResourceLink> = getCloudResourceLinks([
      VPC,
      SUBNET,
      INSTANCE,
      LOAD_BALANCER,
    ]);

    expect(links).toEqual([
      {
        fromId: SUBNET.id.toString(),
        toId: VPC.id.toString(),
        kind: CloudRelationshipKind.RunsIn,
      },
      {
        fromId: INSTANCE.id.toString(),
        toId: SUBNET.id.toString(),
        kind: CloudRelationshipKind.RunsIn,
      },
      // The security group is not held: no link. The two listings: one link.
      {
        fromId: LOAD_BALANCER.id.toString(),
        toId: INSTANCE.id.toString(),
        kind: CloudRelationshipKind.RoutesTo,
      },
    ]);
  });

  test("a resource is never linked to itself", () => {
    const loop: CloudLinkedResource = resource({
      id: id(12),
      providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:loop`,
      type: "AWS::SQS::Queue",
      relationships: [
        { kind: CloudRelationshipKind.DeadLettersTo, target: "loop" },
      ],
    });

    expect(getCloudResourceLinks([loop])).toEqual([]);
  });

  test("no resources, no links", () => {
    expect(getCloudResourceLinks([])).toEqual([]);
  });
});
