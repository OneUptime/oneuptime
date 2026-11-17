import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { sendAwsRequest } from "./AwsApi";
import {
  AwsCloudControlListing,
  AwsCloudControlOptions,
  AwsListedResource,
} from "./AwsCloudControl";
import {
  AwsXmlElement,
  parseAwsXml,
  xmlFind,
  xmlList,
  xmlText,
} from "../LiveRead/AwsXml";

/*
 * ONE REGION'S CLASSIC LOAD BALANCERS, for the inventory (#9375).
 *
 * Cloud Control does not list AWS::ElasticLoadBalancing::LoadBalancer, so
 * the inventory lists classic load balancers with Elastic Load Balancing's
 * own DescribeLoadBalancers (the Query protocol, version 2012-06-01), which
 * answers each one's name, DNS name, subnets, security groups, listeners
 * and the instances registered with it:
 *
 *   Action=DescribeLoadBalancers&PageSize=400[&Marker]
 *   -> <LoadBalancerDescriptions><member><LoadBalancerName/><DNSName/>
 *        <Scheme/><VPCId/><Subnets><member/></Subnets>
 *        <SecurityGroups><member/></SecurityGroups>
 *        <Instances><member><InstanceId/></member></Instances>
 *        <ListenerDescriptions><member><Listener>...</Listener></member>
 *        </ListenerDescriptions>...</member></LoadBalancerDescriptions>
 *      <NextMarker/>
 *
 * Each load balancer is handed on as Cloud Control would list it: its name
 * as the identifier (the LoadBalancerName its AWS/ELB metrics name it by),
 * and its properties in CloudFormation's own names. Read with
 * elasticloadbalancing:DescribeLoadBalancers, which the connection's role
 * has always held (the same action lists both kinds of load balancer).
 */

export const ELASTIC_LOAD_BALANCING_API_VERSION: string = "2012-06-01";

const SERVICE: string = "elasticloadbalancing";
const PROVIDER_TITLE: string = "AWS Elastic Load Balancing";
const PAGE_SIZE: string = "400";
// Pages of one Region at most: 8,000 load balancers.
export const AWS_CLASSIC_LOAD_BALANCER_MAX_PAGES: number = 20;

function texts(member: AwsXmlElement, path: string): Array<string> {
  return xmlList(member, path)
    .map((item: AwsXmlElement): string => {
      return item.text.trim();
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

// One <member> of the answer, as a listed resource; null without its name.
export function readClassicLoadBalancer(
  member: AwsXmlElement,
): AwsListedResource | null {
  const name: string = xmlText(member, "LoadBalancerName").trim();

  if (!name) {
    return null;
  }

  const properties: JSONObject = { LoadBalancerName: name };

  for (const field of [
    "DNSName",
    "Scheme",
    "CanonicalHostedZoneName",
    "CreatedTime",
  ]) {
    const value: string = xmlText(member, field).trim();

    if (value) {
      properties[field] = value;
    }
  }

  const vpc: string = xmlText(member, "VPCId").trim();

  if (vpc) {
    properties["VpcId"] = vpc;
  }

  const healthCheck: string = xmlText(member, "HealthCheck/Target").trim();

  if (healthCheck) {
    properties["HealthCheck"] = { Target: healthCheck };
  }

  properties["Subnets"] = texts(member, "Subnets");
  properties["SecurityGroups"] = texts(member, "SecurityGroups");
  properties["AvailabilityZones"] = texts(member, "AvailabilityZones");
  properties["Instances"] = xmlList(member, "Instances")
    .map((instance: AwsXmlElement): string => {
      return xmlText(instance, "InstanceId").trim();
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
  // "HTTP:80 -> HTTP:8080", as the console lists a listener.
  properties["Listeners"] = xmlList(member, "ListenerDescriptions")
    .map((description: AwsXmlElement): string => {
      const protocol: string = xmlText(description, "Listener/Protocol");
      const port: string = xmlText(description, "Listener/LoadBalancerPort");
      const instanceProtocol: string = xmlText(
        description,
        "Listener/InstanceProtocol",
      );
      const instancePort: string = xmlText(
        description,
        "Listener/InstancePort",
      );

      if (!protocol || !port) {
        return "";
      }

      return instancePort
        ? `${protocol}:${port} -> ${instanceProtocol || protocol}:${instancePort}`
        : `${protocol}:${port}`;
    })
    .filter((listener: string): boolean => {
      return listener.length > 0;
    });

  return { identifier: name, properties };
}

export async function listClassicLoadBalancers(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  const resources: Array<AwsListedResource> = [];
  let marker: string = "";

  for (
    let page: number = 0;
    page < AWS_CLASSIC_LOAD_BALANCER_MAX_PAGES;
    page++
  ) {
    const body: Dictionary<string> = {
      Action: "DescribeLoadBalancers",
      Version: ELASTIC_LOAD_BALANCING_API_VERSION,
      PageSize: PAGE_SIZE,
    };

    if (marker) {
      body["Marker"] = marker;
    }

    const answer: { text: string } = await sendAwsRequest({
      transport: options.transport,
      credentials: options.credentials,
      service: SERVICE,
      region: options.region,
      body,
      step: `classic load balancers request in ${options.region}`,
      providerTitle: PROVIDER_TITLE,
      now: options.now,
      timeoutInMs: options.timeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });
    const root: AwsXmlElement = parseAwsXml(answer.text);

    for (const member of xmlList(
      xmlFind(root, "LoadBalancerDescriptions"),
      "",
    )) {
      const listed: AwsListedResource | null = readClassicLoadBalancer(member);

      if (listed) {
        resources.push(listed);
      }
    }

    const next: string = xmlText(
      xmlFind(root, "DescribeLoadBalancersResult"),
      "NextMarker",
    ).trim();

    if (!next || next === marker) {
      return { resources, complete: true };
    }

    marker = next;
  }

  return { resources, complete: false };
}
