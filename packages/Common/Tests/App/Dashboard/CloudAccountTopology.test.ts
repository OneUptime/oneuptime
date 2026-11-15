import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudRelationshipKind,
  CLOUD_RELATIONSHIP_LABELS,
} from "../../../Types/Cloud/CloudInventory";
import { CloudResourceLink } from "../../../Types/Cloud/CloudResourceIndex";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  CLOUD_ACCOUNT_REGION_PREFIX,
  CLOUD_ACCOUNT_ROOT_ID,
  CLOUD_TOPOLOGY_FACTS_MAX,
  CloudAccountTopologyResource,
  assessCloudTopologyResource,
  buildCloudAccountTopology,
  cloudRegionNodeId,
  cloudResourceTopologyKind,
  formatCloudTopologyCount,
  formatCloudTopologyFigure,
  formatCloudTopologySeconds,
  getCloudResourceParents,
  getCloudTopologyFactKeys,
  getCloudTopologyFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/CloudAccountTopology";
import {
  CloudHeadlineReading,
  getCloudHeadlineReadings,
} from "../../../Types/Cloud/CloudResourceHealth";
import {
  CLOUD_TOPOLOGY_ISSUE_ID_CHUNK,
  CLOUD_TOPOLOGY_ISSUE_ID_LIMIT,
  chunkCloudTopologyIssueIds,
  loadCloudAccountTopology,
  mergeOpenIssues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Loaders/CloudAccountTopologyLoader";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyIssue,
  ResourceTopologyNode,
  ResourceTopologyRelation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { OpenIssueRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import { OpenIssuesResult } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssuesLoader";
import { ResourceTopologyData } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyPage";
import { getResourceTopologyKind } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyKinds";
import { CLOUD_RELATIONSHIP_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudRelationshipWords";

/*
 * A cloud account's topology: its regions, and in them its resources the
 * way its inventory relates them - a parent by RunsIn, else PartOf, never
 * a loop - with every other relationship drawn across the tree, health
 * from whether each is still listed or reporting, and the open incidents
 * and alerts on the resource they are linked to.
 */

const NOW: Date = new Date("2026-10-26T12:00:00Z");
const RECENT: Date = new Date(NOW.getTime() - 10 * 60 * 1000);
const LONG_AGO: Date = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
const ACCOUNT: string = "123456789012";
const ACCOUNT_ROW_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function resource(
  data: Partial<CloudAccountTopologyResource> & { id: string; type: string },
): CloudAccountTopologyResource {
  return {
    name: data.id,
    providerResourceId: "",
    region: "eu-west-1",
    relationships: [],
    lastSeenAt: RECENT,
    isReporting: true,
    ...data,
  };
}

const VPC: CloudAccountTopologyResource = resource({
  id: id(1),
  name: "main",
  type: "AWS::EC2::VPC",
  providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:vpc/vpc-0main`,
});

const SUBNET: CloudAccountTopologyResource = resource({
  id: id(2),
  name: "private-a",
  type: "AWS::EC2::Subnet",
  providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:subnet/subnet-0abc`,
  relationships: [
    {
      kind: CloudRelationshipKind.RunsIn,
      target: "vpc-0main",
      targetType: "AWS::EC2::VPC",
    },
  ],
});

const INSTANCE: CloudAccountTopologyResource = resource({
  id: id(3),
  name: "web-1",
  type: "AWS::EC2::Instance",
  providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:instance/i-0web`,
  relationships: [
    {
      kind: CloudRelationshipKind.PartOf,
      target: "web-asg",
      targetType: "AWS::AutoScaling::AutoScalingGroup",
    },
    {
      kind: CloudRelationshipKind.RunsIn,
      target: "subnet-0abc",
      targetType: "AWS::EC2::Subnet",
    },
    // Attached to its subnet too: the nesting already says that.
    {
      kind: CloudRelationshipKind.AttachedTo,
      target: "subnet-0abc",
      targetType: "AWS::EC2::Subnet",
    },
  ],
});

const ASG: CloudAccountTopologyResource = resource({
  id: id(4),
  name: "web-asg",
  type: "AWS::AutoScaling::AutoScalingGroup",
  providerResourceId: `arn:aws:autoscaling:eu-west-1:${ACCOUNT}:autoScalingGroup:uuid:autoScalingGroupName/web-asg`,
});

const LOAD_BALANCER: CloudAccountTopologyResource = resource({
  id: id(5),
  name: "web-alb",
  type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
  providerResourceId: `arn:aws:elasticloadbalancing:eu-west-1:${ACCOUNT}:loadbalancer/app/web-alb/50dc6c495c0c9188`,
  relationships: [
    {
      kind: CloudRelationshipKind.RoutesTo,
      target: "i-0web",
      targetType: "AWS::EC2::Instance",
    },
  ],
});

// A global resource: no region, under the account itself.
const DISTRIBUTION: CloudAccountTopologyResource = resource({
  id: id(6),
  name: "assets",
  type: "AWS::CloudFront::Distribution",
  providerResourceId: `arn:aws:cloudfront::${ACCOUNT}:distribution/E2QWRUHAPOMQZL`,
  region: "",
  lastSeenAt: LONG_AGO,
  isReporting: false,
});

function graphOf(
  resources: Array<CloudAccountTopologyResource>,
  issues: Array<OpenIssueRecord> = [],
): ResourceTopologyGraph {
  return buildCloudAccountTopology({
    account: {
      id: ACCOUNT_ROW_ID,
      name: "Production",
      provider: "aws",
      lastSeenAt: RECENT,
    },
    resources,
    issues,
    now: NOW,
  });
}

function node(
  graph: ResourceTopologyGraph,
  nodeId: string,
): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(nodeId);

  if (!found) {
    throw new Error(`no ${nodeId} in the graph`);
  }

  return found;
}

function issue(data: {
  type: "incident" | "alert";
  id: string;
  cloudResources: Array<string>;
}): OpenIssueRecord {
  return {
    type: data.type,
    id: data.id,
    title: data.id,
    number: "#1",
    severityName: "Critical",
    severityColor: null,
    stateName: "Created",
    createdAt: NOW,
    seriesLabels: null,
    relatedIds: { cloudResources: data.cloudResources },
  };
}

describe("the account's tree", () => {
  const graph: ResourceTopologyGraph = graphOf([
    VPC,
    SUBNET,
    INSTANCE,
    ASG,
    LOAD_BALANCER,
    DISTRIBUTION,
  ]);

  test("the account at the root, its regions under it, and a global resource beside them", () => {
    const root: ResourceTopologyNode = node(graph, CLOUD_ACCOUNT_ROOT_ID);

    expect(root.kind).toBe("cloud.account");
    expect(root.name).toBe("Production");
    expect(root.link).toEqual({
      page: PageMap.CLOUD_ACCOUNT_VIEW,
      modelId: ACCOUNT_ROW_ID,
    });
    expect(node(graph, cloudRegionNodeId("eu-west-1")).parentId).toBe(
      CLOUD_ACCOUNT_ROOT_ID,
    );
    expect(node(graph, DISTRIBUTION.id).parentId).toBe(CLOUD_ACCOUNT_ROOT_ID);
  });

  test("a resource runs in what it runs in, before what it is part of", () => {
    expect(node(graph, SUBNET.id).parentId).toBe(VPC.id);
    expect(node(graph, INSTANCE.id).parentId).toBe(SUBNET.id);
    // The network sits in its region.
    expect(node(graph, VPC.id).parentId).toBe(cloudRegionNodeId("eu-west-1"));
    expect(node(graph, VPC.id).depth).toBe(2);
    expect(node(graph, INSTANCE.id).depth).toBe(4);
  });

  test("every other relationship is drawn across the tree, in its own words both ways", () => {
    const relations: Array<ResourceTopologyRelation> = graph.relations;

    expect(
      relations.map((relation: ResourceTopologyRelation): Array<string> => {
        return [
          relation.from,
          relation.to,
          relation.label,
          relation.inverseLabel,
        ];
      }),
    ).toEqual([
      // Part of the scaling group, which is not its parent.
      [INSTANCE.id, ASG.id, "Part of", "Includes"],
      [LOAD_BALANCER.id, INSTANCE.id, "Sends traffic to", "Gets traffic from"],
    ]);
    // Never a line to what holds it: attached to its own subnet is the nesting.
    expect(
      relations.some((relation: ResourceTopologyRelation): boolean => {
        return relation.from === INSTANCE.id && relation.to === SUBNET.id;
      }),
    ).toBe(false);
  });

  test("each resource is a card of its category, named, linked to its own page", () => {
    const instance: ResourceTopologyNode = node(graph, INSTANCE.id);

    expect(instance.kind).toBe("cloud.compute");
    expect(instance.link).toEqual({
      page: PageMap.CLOUD_RESOURCE_VIEW,
      modelId: INSTANCE.id,
    });
    expect(instance.keywords).toEqual(
      expect.arrayContaining([
        INSTANCE.providerResourceId,
        "AWS::EC2::Instance",
      ]),
    );
    expect(node(graph, VPC.id).kind).toBe("cloud.networking");
    expect(cloudResourceTopologyKind("aws", "AWS::Made::Up")).toBe(
      "cloud.resource",
    );
  });

  test("a resource listed or reporting is healthy; one neither lately is unknown, never a problem", () => {
    expect(node(graph, INSTANCE.id).health).toBe("healthy");
    expect(node(graph, DISTRIBUTION.id).health).toBe("unknown");
    expect(node(graph, DISTRIBUTION.id).needsAttention).toBe(false);
  });

  test("every kind it draws is in the catalog, with its own words", () => {
    for (const kind of [
      "cloud.account",
      "cloud.region",
      "cloud.compute",
      "cloud.networking",
      "cloud.resource",
    ]) {
      expect(getResourceTopologyKind(kind).label).not.toBe("Resource");
    }
  });
});

// Readings as a read keeps them on the row, all of one datapoint's time.
function readingsOf(
  values: Record<string, number>,
  at: Date = RECENT,
): Record<string, { value: number; time: string }> {
  const readings: Record<string, { value: number; time: string }> = {};

  for (const key of Object.keys(values)) {
    readings[key] = { value: values[key]!, time: at.toISOString() };
  }

  return readings;
}

const AZURE_DATABASE: CloudAccountTopologyResource = resource({
  id: id(20),
  name: "orders",
  type: "Microsoft.Sql/servers/databases",
  region: "westeurope",
  providerResourceId:
    "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/servers/sql-1/databases/orders",
});

function assess(
  provider: string,
  entry: CloudAccountTopologyResource,
): ReturnType<typeof assessCloudTopologyResource> {
  return assessCloudTopologyResource({ provider, resource: entry, now: NOW });
}

describe("how each resource is doing", () => {
  test("judged as its own page judges it: a status check failing is critical, with its reason", () => {
    const assessed: ReturnType<typeof assessCloudTopologyResource> = assess(
      "aws",
      {
        ...INSTANCE,
        readings: readingsOf({
          "aws/ec2/statuscheckfailed": 1,
          "aws/ec2/cpuutilization": 12,
        }),
        readingsAt: RECENT,
      },
    );

    expect(assessed.health).toBe("critical");
    expect(assessed.status).toEqual({ text: "Unhealthy" });
    expect(assessed.reasons).toEqual([
      {
        text: "Failing its status checks",
        values: undefined,
        plural: undefined,
      },
    ]);
  });

  test("a warning is a degraded resource, and a count-dependent reason keeps its plural", () => {
    const assessed: ReturnType<typeof assessCloudTopologyResource> = assess(
      "aws",
      resource({
        id: id(21),
        type: "AWS::ElasticLoadBalancing::LoadBalancer",
        readings: readingsOf({ "aws/elb/unhealthyhostcount": 2 }),
        readingsAt: RECENT,
      }),
    );

    expect(assessed.health).toBe("warning");
    expect(assessed.status).toEqual({ text: "Degraded" });
    expect(assessed.reasons).toEqual([
      {
        text: "{{count}} unhealthy hosts",
        values: { count: "2" },
        plural: { one: "{{count}} unhealthy host", count: 2 },
      },
    ]);
  });

  test("checked and well is Healthy; nothing to judge is Reporting; neither listed nor reporting is Not reporting", () => {
    expect(
      assess("azure", {
        ...AZURE_DATABASE,
        readings: readingsOf({ cpu_percent: 34, storage_percent: 61 }),
        readingsAt: RECENT,
      }),
    ).toEqual(
      expect.objectContaining({
        health: "healthy",
        status: { text: "Healthy" },
        reasons: [],
      }),
    );
    // A type no rule speaks for.
    expect(
      assess("aws", {
        ...VPC,
        readings: readingsOf({ "aws/ec2/whatever": 1 }),
        readingsAt: RECENT,
      }),
    ).toEqual(
      expect.objectContaining({
        health: "healthy",
        status: { text: "Reporting" },
      }),
    );
    expect(assess("aws", DISTRIBUTION)).toEqual(
      expect.objectContaining({
        health: "unknown",
        status: { text: "Not reporting" },
        facts: [],
      }),
    );
  });

  test("readings an hour old are not judged, and its card carries none of their numbers", () => {
    const stale: Date = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const assessed: ReturnType<typeof assessCloudTopologyResource> = assess(
      "aws",
      {
        ...INSTANCE,
        readings: readingsOf(
          { "aws/ec2/statuscheckfailed": 1, "aws/ec2/cpuutilization": 99 },
          stale,
        ),
        readingsAt: stale,
      },
    );

    expect(assessed.health).toBe("healthy");
    expect(assessed.status).toEqual({ text: "Reporting" });
    expect(assessed.facts).toEqual([]);
  });

  test("a resource listed lately is live even when its collector status says otherwise", () => {
    const assessed: ReturnType<typeof assessCloudTopologyResource> = assess(
      "azure",
      {
        ...AZURE_DATABASE,
        isReporting: false,
        lastSeenAt: RECENT,
        readings: readingsOf({ cpu_percent: 99, storage_percent: 40 }),
        readingsAt: RECENT,
      },
    );

    expect(assessed.health).toBe("warning");
    expect(assessed.reasons[0]).toEqual(
      expect.objectContaining({ text: "CPU at {{percent}}" }),
    );
  });

  test("the account's map draws each resource's health, reasons and numbers", () => {
    const graph: ResourceTopologyGraph = buildCloudAccountTopology({
      account: {
        id: ACCOUNT_ROW_ID,
        name: "Production",
        provider: "azure",
        lastSeenAt: RECENT,
      },
      resources: [
        {
          ...AZURE_DATABASE,
          readings: readingsOf({ cpu_percent: 22, storage_percent: 97 }),
          readingsAt: RECENT,
        },
      ],
      now: NOW,
    });
    const database: ResourceTopologyNode = node(graph, AZURE_DATABASE.id);

    expect(database.health).toBe("critical");
    expect(database.needsAttention).toBe(true);
    expect(database.status).toEqual({ text: "Unhealthy" });
    expect(database.reasons?.[0]).toEqual(
      expect.objectContaining({ text: "{{percent}} full" }),
    );
    expect(database.facts).toEqual([
      { label: "CPU", value: "22%" },
      { label: "Storage used", value: "97%" },
    ]);
    expect(graph.attentionCount).toBe(1);
  });
});

describe("the numbers on a resource's card", () => {
  test("the first readings its page leads with, in its page's order, at most two", () => {
    const keys: Array<string> = getCloudTopologyFactKeys(
      "azure",
      "Microsoft.Sql/servers/databases",
    );
    const values: Record<string, number> = {};

    keys.forEach((key: string, index: number) => {
      values[key] = 10 + index;
    });

    const facts: Array<ResourceTopologyFact> = getCloudTopologyFacts({
      provider: "azure",
      type: "Microsoft.Sql/servers/databases",
      readings: readingsOf(values) as never,
    });
    const headlines: Array<CloudHeadlineReading> = getCloudHeadlineReadings(
      "azure",
      "Microsoft.Sql/servers/databases",
    );

    expect(facts.length).toBe(Math.min(CLOUD_TOPOLOGY_FACTS_MAX, keys.length));
    expect(
      facts.map((fact: ResourceTopologyFact): string => {
        return fact.label;
      }),
    ).toEqual(
      headlines
        .slice(0, CLOUD_TOPOLOGY_FACTS_MAX)
        .map((headline: CloudHeadlineReading): string => {
          return headline.label;
        }),
    );
  });

  test("a reading the read did not bring is skipped, and the next one takes its place", () => {
    const keys: Array<string> = getCloudTopologyFactKeys(
      "azure",
      "Microsoft.Sql/servers/databases",
    );

    expect(keys.length).toBeGreaterThanOrEqual(2);

    const facts: Array<ResourceTopologyFact> = getCloudTopologyFacts({
      provider: "azure",
      type: "Microsoft.Sql/servers/databases",
      readings: readingsOf({ [keys[1]!]: 61 }) as never,
    });

    expect(facts).toEqual([expect.objectContaining({ value: "61%" })]);
  });

  test("a type its page leads with nothing for carries no numbers", () => {
    expect(
      getCloudTopologyFacts({
        provider: "aws",
        type: "AWS::EC2::VPC",
        readings: readingsOf({ "aws/ec2/cpuutilization": 50 }) as never,
      }),
    ).toEqual([]);
  });

  test("each figure in the format its page's tile uses", () => {
    expect(
      formatCloudTopologyFigure({
        format: "percent",
        value: 41.6,
        periodSeconds: 60,
      }),
    ).toBe("42%");
    expect(
      formatCloudTopologyFigure({
        format: "ratio",
        value: 0.416,
        periodSeconds: 60,
      }),
    ).toBe("42%");
    expect(
      formatCloudTopologyFigure({
        format: "bytes",
        value: 3 * 1024 * 1024 * 1024,
        periodSeconds: 60,
      }),
    ).toBe("3.0 GiB");
    expect(
      formatCloudTopologyFigure({
        format: "count",
        value: 12_400,
        periodSeconds: 60,
      }),
    ).toBe("12.4k");
    expect(
      formatCloudTopologyFigure({
        format: "seconds",
        value: 0.23,
        periodSeconds: 60,
      }),
    ).toBe("230 ms");
    expect(
      formatCloudTopologyFigure({
        format: "milliseconds",
        value: 1800,
        periodSeconds: 60,
      }),
    ).toBe("1.8 s");
    // A sum over five minutes, drawn per minute.
    expect(
      formatCloudTopologyFigure({
        format: "perPeriod",
        value: 600,
        periodSeconds: 300,
      }),
    ).toBe("120/min");
    expect(
      formatCloudTopologyFigure({
        format: "perSecond",
        value: 3.25,
        periodSeconds: 60,
      }),
    ).toBe("3.3/s");
    // Never a negative share or size.
    expect(
      formatCloudTopologyFigure({
        format: "percent",
        value: -3,
        periodSeconds: 60,
      }),
    ).toBe("0%");
  });

  test("counts and times read short", () => {
    expect(formatCloudTopologyCount(7.25)).toBe("7.3");
    expect(formatCloudTopologyCount(42)).toBe("42");
    expect(formatCloudTopologyCount(999)).toBe("999");
    expect(formatCloudTopologyCount(1500)).toBe("1.5k");
    expect(formatCloudTopologyCount(250_000)).toBe("250k");
    expect(formatCloudTopologyCount(3_100_000)).toBe("3.1M");
    expect(formatCloudTopologyCount(2_000_000_000)).toBe("2B");
    expect(formatCloudTopologySeconds(0.004)).toBe("4 ms");
    expect(formatCloudTopologySeconds(42)).toBe("42 s");
    expect(formatCloudTopologySeconds(720)).toBe("12 min");
    expect(formatCloudTopologySeconds(5 * 3600)).toBe("5 h");
  });
});

describe("the account's connections", () => {
  const graph: ResourceTopologyGraph = graphOf([
    VPC,
    SUBNET,
    INSTANCE,
    ASG,
    LOAD_BALANCER,
    DISTRIBUTION,
  ]);

  test("every link between two of its resources, the ones the tree draws by nesting too", () => {
    expect(graph.connections).not.toBeNull();
    expect(
      graph.connections!.map(
        (connection: ResourceTopologyRelation): Array<string> => {
          return [connection.from, connection.to, connection.label];
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        [SUBNET.id, VPC.id, "Runs in"],
        [INSTANCE.id, SUBNET.id, "Runs in"],
        [INSTANCE.id, ASG.id, "Part of"],
        [INSTANCE.id, SUBNET.id, "Attached to"],
        [LOAD_BALANCER.id, INSTANCE.id, "Sends traffic to"],
      ]),
    );
    expect(graph.connections!.length).toBe(5);
  });

  test("each read from both ends, by the parts it joins", () => {
    const ofInstance: Array<ResourceTopologyRelation> =
      graph.connectionsByNode.get(INSTANCE.id) || [];

    expect(ofInstance.length).toBe(4);
    expect(graph.connectionsByNode.get(DISTRIBUTION.id)).toBeUndefined();
    expect(graph.connectionsByNode.has(CLOUD_ACCOUNT_ROOT_ID)).toBe(false);
  });

  test("the tree's own relations still leave out what nesting says", () => {
    expect(graph.relations.length).toBe(2);
  });
});

describe("open incidents and alerts", () => {
  test("sit on the resource they are linked to, else on the account", () => {
    const graph: ResourceTopologyGraph = graphOf(
      [VPC, SUBNET, INSTANCE],
      [
        issue({ type: "incident", id: "inc-1", cloudResources: [INSTANCE.id] }),
        issue({ type: "alert", id: "alert-1", cloudResources: [id(99)] }),
      ],
    );

    expect(
      node(graph, INSTANCE.id).issues.map(
        (i: ResourceTopologyIssue): string => {
          return i.id;
        },
      ),
    ).toEqual(["inc-1"]);
    expect(node(graph, INSTANCE.id).effectiveHealth).toBe("critical");
    // Its parents count it below them.
    expect(node(graph, SUBNET.id).incidentsBelow).toBe(1);
    expect(
      node(graph, CLOUD_ACCOUNT_ROOT_ID).issues.map(
        (i: ResourceTopologyIssue): string => {
          return i.id;
        },
      ),
    ).toEqual(["alert-1"]);
  });
});

describe("parents", () => {
  test("RunsIn before PartOf, the first of each", () => {
    const links: Array<CloudResourceLink> = [
      { fromId: "a", toId: "group", kind: CloudRelationshipKind.PartOf },
      { fromId: "a", toId: "subnet-1", kind: CloudRelationshipKind.RunsIn },
      { fromId: "a", toId: "subnet-2", kind: CloudRelationshipKind.RunsIn },
      { fromId: "b", toId: "group", kind: CloudRelationshipKind.PartOf },
      { fromId: "c", toId: "a", kind: CloudRelationshipKind.RoutesTo },
    ];
    const parents: Map<string, CloudResourceLink> =
      getCloudResourceParents(links);

    expect(parents.get("a")?.toId).toBe("subnet-1");
    expect(parents.get("b")?.toId).toBe("group");
    expect(parents.has("c")).toBe(false);
  });

  test("a loop is cut where it closes, so the resource sits in its region", () => {
    const parents: Map<string, CloudResourceLink> = getCloudResourceParents([
      { fromId: "a", toId: "b", kind: CloudRelationshipKind.PartOf },
      { fromId: "b", toId: "c", kind: CloudRelationshipKind.PartOf },
      { fromId: "c", toId: "a", kind: CloudRelationshipKind.PartOf },
    ]);

    expect(parents.size).toBe(2);

    const a: CloudAccountTopologyResource = resource({
      id: id(10),
      type: "AWS::SQS::Queue",
      providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:a`,
      relationships: [{ kind: CloudRelationshipKind.PartOf, target: "b" }],
    });
    const b: CloudAccountTopologyResource = resource({
      id: id(11),
      type: "AWS::SQS::Queue",
      providerResourceId: `arn:aws:sqs:eu-west-1:${ACCOUNT}:b`,
      relationships: [{ kind: CloudRelationshipKind.PartOf, target: "a" }],
    });
    const graph: ResourceTopologyGraph = graphOf([a, b]);

    const parentsOfPair: Array<string | null> = [
      node(graph, a.id).parentId,
      node(graph, b.id).parentId,
    ];

    // One of the two sits in the region, the other under it: no loop.
    expect(parentsOfPair).toContain(cloudRegionNodeId("eu-west-1"));
    expect(
      parentsOfPair.filter((parent: string | null): boolean => {
        return Boolean(parent?.startsWith(CLOUD_ACCOUNT_REGION_PREFIX));
      }),
    ).toHaveLength(1);
  });
});

describe("the relationship words", () => {
  test("read from the resource that lists one, they are the words OneUptime AI reads", () => {
    for (const kind of Object.values(CloudRelationshipKind)) {
      expect(CLOUD_RELATIONSHIP_WORDS[kind].label).toBe(
        CLOUD_RELATIONSHIP_LABELS[kind],
      );
      expect(
        CLOUD_RELATIONSHIP_WORDS[kind].inverseLabel.length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("reading the open issues in groups", () => {
  test(`${CLOUD_TOPOLOGY_ISSUE_ID_CHUNK} ids a group, ${CLOUD_TOPOLOGY_ISSUE_ID_LIMIT} at most, saying when some were left out`, () => {
    const ids: Array<string> = Array.from(
      { length: CLOUD_TOPOLOGY_ISSUE_ID_LIMIT + 1 },
      (_value: unknown, index: number): string => {
        return id(index);
      },
    );

    const all: { chunks: Array<Array<string>>; isPartial: boolean } =
      chunkCloudTopologyIssueIds(ids);

    expect(all.chunks).toHaveLength(
      CLOUD_TOPOLOGY_ISSUE_ID_LIMIT / CLOUD_TOPOLOGY_ISSUE_ID_CHUNK,
    );
    expect(all.chunks[0]).toHaveLength(CLOUD_TOPOLOGY_ISSUE_ID_CHUNK);
    expect(all.isPartial).toBe(true);
    expect(chunkCloudTopologyIssueIds(ids.slice(0, 3))).toEqual({
      chunks: [ids.slice(0, 3)],
      isPartial: false,
    });
    expect(chunkCloudTopologyIssueIds([])).toEqual({
      chunks: [],
      isPartial: false,
    });
  });

  test("merged as one: a count is unknown when any group's is", () => {
    const one: OpenIssuesResult = {
      records: [issue({ type: "incident", id: "i", cloudResources: [] })],
      incidentCount: 1,
      alertCount: 0,
      isPartial: false,
    };
    const unreadable: OpenIssuesResult = {
      records: [],
      incidentCount: 2,
      alertCount: null,
      isPartial: true,
    };

    expect(mergeOpenIssues([one, one], false)).toMatchObject({
      incidentCount: 2,
      alertCount: 0,
      isPartial: false,
    });
    expect(mergeOpenIssues([one, unreadable], false)).toMatchObject({
      incidentCount: 3,
      alertCount: null,
      isPartial: true,
    });
    expect(mergeOpenIssues([], true).isPartial).toBe(true);
  });
});

describe("loading an account's topology", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the account, its live resources by cloud and account id, and their open issues", async () => {
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      new ObjectID("11111111-1111-4111-8111-111111111111"),
    );

    const account: CloudAccount = new CloudAccount();
    account.name = "Production";
    account.provider = CloudProvider.AWS;
    account.accountId = ACCOUNT;
    account.lastSeenAt = new Date();

    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(account);

    const rows: Array<CloudResource> = [VPC, SUBNET, INSTANCE].map(
      (entry: CloudAccountTopologyResource): CloudResource => {
        const row: CloudResource = new CloudResource();
        row._id = entry.id;
        row.name = entry.name;
        row.cloudResourceType = entry.type;
        row.providerResourceId = entry.providerResourceId;
        row.cloudRegion = entry.region;
        row.cloudRelationships = entry.relationships;
        row.otelCollectorStatus = "connected";
        return row;
      },
    );
    // The instance's last read found its status checks failing.
    rows[2]!.cloudReadings = readingsOf(
      { "aws/ec2/statuscheckfailed": 1 },
      new Date(),
    );
    rows[2]!.cloudReadingsAt = new Date();

    const incidentState: IncidentState = new IncidentState();
    incidentState._id = id(500);
    const alertState: AlertState = new AlertState();
    alertState._id = id(501);

    const openIncident: Incident = new Incident();
    openIncident._id = id(600);
    openIncident.title = "web-1 is down";
    (openIncident as unknown as Record<string, unknown>)["cloudResources"] = [
      { _id: INSTANCE.id },
    ];

    const getList: jest.SpyInstance = getJestSpyOn(
      ModelAPI,
      "getList",
    ).mockImplementation((request: { modelType: unknown }) => {
      if (request.modelType === CloudResource) {
        return Promise.resolve({
          data: rows,
          count: rows.length,
          skip: 0,
          limit: 10000,
        });
      }

      if (request.modelType === IncidentState) {
        return Promise.resolve({ data: [incidentState], count: 1 });
      }

      if (request.modelType === AlertState) {
        return Promise.resolve({ data: [alertState], count: 1 });
      }

      if (request.modelType === Incident) {
        return Promise.resolve({ data: [openIncident], count: 1 });
      }

      if (request.modelType === Alert) {
        return Promise.resolve({ data: [], count: 0 });
      }

      return Promise.resolve({ data: [], count: 0 });
    });

    const data: ResourceTopologyData = await loadCloudAccountTopology(
      new ObjectID(ACCOUNT_ROW_ID),
    );

    const resourceRead: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = getList.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          modelType: unknown;
          query: Record<string, unknown>;
          select: Record<string, unknown>;
        };
      })
      .find((request: { modelType: unknown }) => {
        return request.modelType === CloudResource;
      })!;

    // What its health and its card's numbers are read from.
    expect(resourceRead.select).toEqual(
      expect.objectContaining({
        cloudReadings: true,
        cloudReadingsAt: true,
        cloudProperties: true,
        otelCollectorStatus: true,
      }),
    );
    expect(resourceRead.query["cloudProvider"]).toBe("aws");
    expect(resourceRead.query["isArchived"]).toBe(false);
    expect((resourceRead.query["cloudAccountId"] as Includes).values).toContain(
      ACCOUNT,
    );

    const incidentRead: { query: Record<string, unknown> } = getList.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          modelType: unknown;
          query: Record<string, unknown>;
        };
      })
      .find((request: { modelType: unknown }) => {
        return request.modelType === Incident;
      })!;

    expect(
      (incidentRead.query["cloudResources"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([VPC.id, SUBNET.id, INSTANCE.id]);

    const graph: ResourceTopologyGraph = data.arrangements[0]!.graph;

    expect(
      node(graph, INSTANCE.id).issues.map(
        (i: ResourceTopologyIssue): string => {
          return i.id;
        },
      ),
    ).toEqual([id(600)]);
    expect(node(graph, INSTANCE.id).health).toBe("critical");
    expect(node(graph, INSTANCE.id).reasons?.[0]?.text).toBe(
      "Failing its status checks",
    );
    expect(node(graph, VPC.id).status).toEqual({ text: "Reporting" });
    // The Connections view is offered: the account's links are its connections.
    expect(graph.connections).not.toBeNull();
    expect(data.masterTopologyRoute).toBeNull();
    expect(data.issuesArePartial).toBe(false);
  });

  test("an account that cannot be read is an error the page shows", async () => {
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      new ObjectID("11111111-1111-4111-8111-111111111111"),
    );
    getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(null);

    await expect(
      loadCloudAccountTopology(new ObjectID(ACCOUNT_ROW_ID)),
    ).rejects.toThrow("Cloud account not found.");
  });
});
