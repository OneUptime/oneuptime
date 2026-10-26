import { describe, expect, test } from "@jest/globals";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import {
  CLOUD_ENDPOINT_MAX_MONITOR_HOSTS,
  CloudEndpointCandidate,
  CloudEndpointSuggestion,
  getCloudEndpointComparisonNames,
  getMonitorDestinationHosts,
  matchCloudEndpoints,
} from "../../../Types/Cloud/CloudEndpointMatch";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";

/*
 * Which cloud resource a monitor checks, by the host it checks: the hosts
 * a monitor's steps name, and the resources whose listed endpoints one of
 * the names the host leads to matches. A match is only ever a suggestion.
 */

function stepsWith(
  destinations: Array<URL | Hostname | IP | undefined>,
): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.setMonitorStepsInstanceArray(
    destinations.map(
      (destination: URL | Hostname | IP | undefined): MonitorStep => {
        return new MonitorStep().setMonitorDestination(destination);
      },
    ),
  );
  return steps;
}

function candidate(
  data: Partial<CloudEndpointCandidate> & { id: string },
): CloudEndpointCandidate {
  return {
    name: data.id,
    type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    provider: "aws",
    endpoints: [],
    ...data,
  };
}

describe("the hosts a monitor checks", () => {
  test("each step's destination as a host: a URL's, a host name, an address", () => {
    expect(
      getMonitorDestinationHosts(
        stepsWith([
          URL.fromString("https://Shop.Example.com:8443/checkout?x=1"),
          new Hostname("api.example.com"),
          new IP("203.0.113.10"),
        ]),
      ),
    ).toEqual(["shop.example.com", "api.example.com", "203.0.113.10"]);
  });

  test("read from the JSON a monitor is stored as, too", () => {
    const json: unknown = JSON.parse(
      JSON.stringify(
        stepsWith([URL.fromString("https://shop.example.com")]).toJSON(),
      ),
    );

    expect(getMonitorDestinationHosts(json)).toEqual(["shop.example.com"]);
  });

  test("a step with no destination, and one host named twice, add nothing", () => {
    expect(
      getMonitorDestinationHosts(
        stepsWith([
          undefined,
          URL.fromString("https://shop.example.com/a"),
          URL.fromString("https://SHOP.example.com/b"),
        ]),
      ),
    ).toEqual(["shop.example.com"]);
  });

  test(`at most ${CLOUD_ENDPOINT_MAX_MONITOR_HOSTS} hosts`, () => {
    const many: Array<URL> = Array.from(
      { length: CLOUD_ENDPOINT_MAX_MONITOR_HOSTS + 5 },
      (_value: unknown, index: number): URL => {
        return URL.fromString(`https://host-${index}.example.com`);
      },
    );

    expect(getMonitorDestinationHosts(stepsWith(many))).toHaveLength(
      CLOUD_ENDPOINT_MAX_MONITOR_HOSTS,
    );
  });

  test("nothing that is not a monitor's steps names a host", () => {
    expect(getMonitorDestinationHosts(undefined)).toEqual([]);
    expect(getMonitorDestinationHosts("https://shop.example.com")).toEqual([]);
    expect(getMonitorDestinationHosts({ data: {} })).toEqual([]);
    expect(
      getMonitorDestinationHosts({
        data: { monitorStepsInstanceArray: [null, 3, { data: null }] },
      }),
    ).toEqual([]);
  });
});

describe("the spellings a name is compared under", () => {
  test("as written, and without the dualstack. AWS puts before a load balancer's name", () => {
    expect(
      getCloudEndpointComparisonNames(
        "DualStack.web-alb-123.eu-west-1.elb.amazonaws.com.",
      ),
    ).toEqual([
      "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com",
      "web-alb-123.eu-west-1.elb.amazonaws.com",
    ]);
    expect(getCloudEndpointComparisonNames("dualstack.")).toEqual([
      "dualstack",
    ]);
  });

  test("nothing for what is not a host", () => {
    expect(getCloudEndpointComparisonNames("")).toEqual([]);
    expect(getCloudEndpointComparisonNames("not a host")).toEqual([]);
  });
});

describe("the resources a monitor's names lead to", () => {
  const ALB: CloudEndpointCandidate = candidate({
    id: "b",
    name: "web-alb",
    endpoints: ["web-alb-123.eu-west-1.elb.amazonaws.com"],
  });
  const CDN: CloudEndpointCandidate = candidate({
    id: "a",
    name: "assets-cdn",
    type: "AWS::CloudFront::Distribution",
    endpoints: ["d111111abcdef8.cloudfront.net"],
  });
  const INSTANCE: CloudEndpointCandidate = candidate({
    id: "c",
    name: "bastion",
    type: "AWS::EC2::Instance",
    endpoints: ["203.0.113.10", "ec2-203-0-113-10.compute-1.amazonaws.com"],
  });

  test("by the first name that leads to each, sorted by name", () => {
    const suggestions: Array<CloudEndpointSuggestion> = matchCloudEndpoints({
      names: [
        { name: "shop.example.com", via: "shop.example.com" },
        {
          name: "dualstack.web-alb-123.eu-west-1.elb.amazonaws.com",
          via: "shop.example.com",
        },
        { name: "d111111abcdef8.cloudfront.net", via: "cdn.example.com" },
        { name: "203.0.113.10", via: "bastion.example.com" },
      ],
      candidates: [ALB, CDN, INSTANCE],
    });

    expect(suggestions).toEqual([
      {
        cloudResourceId: "a",
        name: "assets-cdn",
        type: "AWS::CloudFront::Distribution",
        provider: "aws",
        endpoint: "d111111abcdef8.cloudfront.net",
        via: "cdn.example.com",
      },
      {
        cloudResourceId: "c",
        name: "bastion",
        type: "AWS::EC2::Instance",
        provider: "aws",
        endpoint: "203.0.113.10",
        via: "bastion.example.com",
      },
      {
        cloudResourceId: "b",
        name: "web-alb",
        type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        provider: "aws",
        endpoint: "web-alb-123.eu-west-1.elb.amazonaws.com",
        via: "shop.example.com",
      },
    ]);
  });

  test("a resource is suggested once, however many of its endpoints match", () => {
    expect(
      matchCloudEndpoints({
        names: [
          {
            name: "ec2-203-0-113-10.compute-1.amazonaws.com",
            via: "bastion.example.com",
          },
          { name: "203.0.113.10", via: "bastion.example.com" },
        ],
        candidates: [INSTANCE, INSTANCE],
      }),
    ).toHaveLength(1);
  });

  test("a name that is only like an endpoint matches nothing", () => {
    expect(
      matchCloudEndpoints({
        names: [
          { name: "elb.amazonaws.com", via: "shop.example.com" },
          {
            name: "web-alb-123.eu-west-1.elb.amazonaws.com.evil.example",
            via: "shop.example.com",
          },
        ],
        candidates: [ALB],
      }),
    ).toEqual([]);
  });

  test("endpoints that are not a list, or not hosts, match nothing", () => {
    expect(
      matchCloudEndpoints({
        names: [{ name: "shop.example.com", via: "shop.example.com" }],
        candidates: [
          candidate({ id: "x", endpoints: "shop.example.com" }),
          candidate({ id: "y", endpoints: { host: "shop.example.com" } }),
          candidate({ id: "z", endpoints: [42, null] }),
          candidate({ id: "", endpoints: ["shop.example.com"] }),
        ],
      }),
    ).toEqual([]);
  });
});
