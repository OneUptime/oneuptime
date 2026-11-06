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
 * ONE REGION'S ELASTIC BEANSTALK ENVIRONMENTS, for the inventory.
 *
 * Cloud Control lists an AWS::ElasticBeanstalk::Environment by its name
 * alone, and an environment is named by its ARN - which holds its
 * application's name too - everywhere a change names it (the cloud
 * catalog's restart-service). So the inventory lists environments with
 * Elastic Beanstalk's own DescribeEnvironments (the Query protocol,
 * version 2010-12-01), which answers each one's ARN, application, version
 * and health:
 *
 *   Action=DescribeEnvironments&IncludeDeleted=false&MaxRecords=1000[&NextToken]
 *   -> <Environments><member><EnvironmentName/><EnvironmentArn/>
 *        <ApplicationName/><VersionLabel/><Status/><Health/>...</member>
 *      </Environments><NextToken/>
 *
 * Each environment is handed on as Cloud Control would list it: its ARN as
 * the identifier, and the properties the inventory keeps. Read with
 * elasticbeanstalk:DescribeEnvironments, a free read the connection's role
 * holds from its setup command; a connection set up before is refused, and
 * the inventory goes on without them (AwsInventoryCatalog).
 */

export const ELASTIC_BEANSTALK_API_VERSION: string = "2010-12-01";

const SERVICE: string = "elasticbeanstalk";
const PROVIDER_TITLE: string = "AWS Elastic Beanstalk";
const PAGE_SIZE: string = "1000";
// Pages of one Region at most: 20,000 environments.
export const AWS_BEANSTALK_MAX_PAGES: number = 20;

// What an environment says of itself, kept by the inventory (no secret is among them).
const PROPERTIES: ReadonlyArray<string> = [
  "EnvironmentName",
  "EnvironmentId",
  "ApplicationName",
  "EnvironmentArn",
  "VersionLabel",
  "Status",
  "Health",
  "HealthStatus",
  "SolutionStackName",
  "PlatformArn",
  "CNAME",
  "EndpointURL",
];

// One <member> of the answer, as a listed resource; null without its ARN.
export function readBeanstalkEnvironment(
  member: AwsXmlElement,
): AwsListedResource | null {
  const arn: string = xmlText(member, "EnvironmentArn").trim();

  if (!arn) {
    return null;
  }

  const properties: JSONObject = {};

  for (const name of PROPERTIES) {
    const value: string = xmlText(member, name).trim();

    if (value) {
      properties[name] = value;
    }
  }

  const tier: string = xmlText(member, "Tier/Name").trim();

  if (tier) {
    properties["Tier"] = { Name: tier };
  }

  return { identifier: arn, properties };
}

export async function listBeanstalkEnvironments(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  const resources: Array<AwsListedResource> = [];
  let token: string = "";

  for (let page: number = 0; page < AWS_BEANSTALK_MAX_PAGES; page++) {
    const body: Dictionary<string> = {
      Action: "DescribeEnvironments",
      Version: ELASTIC_BEANSTALK_API_VERSION,
      IncludeDeleted: "false",
      MaxRecords: PAGE_SIZE,
    };

    if (token) {
      body["NextToken"] = token;
    }

    const answer: { text: string } = await sendAwsRequest({
      transport: options.transport,
      credentials: options.credentials,
      service: SERVICE,
      region: options.region,
      body,
      step: `Elastic Beanstalk environments request in ${options.region}`,
      providerTitle: PROVIDER_TITLE,
      now: options.now,
      timeoutInMs: options.timeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });
    const root: AwsXmlElement = parseAwsXml(answer.text);

    for (const member of xmlList(xmlFind(root, "Environments"), "")) {
      const listed: AwsListedResource | null = readBeanstalkEnvironment(member);

      if (listed) {
        resources.push(listed);
      }
    }

    const next: string = xmlText(
      xmlFind(root, "DescribeEnvironmentsResult"),
      "NextToken",
    ).trim();

    if (!next || next === token) {
      return { resources, complete: true };
    }

    token = next;
  }

  return { resources, complete: false };
}
