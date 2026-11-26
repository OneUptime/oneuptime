import SecurityBlockCloudWaf from "../../../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import AwsWafBlocklistGroup from "../../../../../Server/Utils/CloudConnection/Aws/AwsWafBlocklist";
import AwsWafBlockDestination from "../../../../../Server/Utils/SecurityBlocklist/AwsWafBlockDestination";
import SecurityBlockDestination from "../../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import { AddressBlockEvidence } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AddressBlocks";
import {
  AWS_WAF_SAMPLE_WINDOW_IN_MS,
  createAwsWafBlockedRequests,
  getAwsWafConsoleUrl,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/AwsWafBlockedRequests";
import TestSecurityBlockDestination from "../../../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import {
  AwsWafArn,
  getAwsWafBlocklistRuleNames,
  getAwsWafSampleClientAddress,
  parseAwsWafArn,
} from "../../../../../Types/CloudConnection/AwsWafBlocklist";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  CHECK_BLOCK_AWS_WAF_SAMPLED,
  CHECK_CHALLENGE_AWS_WAF_SAMPLED,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  FakeAwsWaf,
  FakeWafWebAcl,
  WAF_ERRORS,
  createFakeAwsWaf,
} from "../../CloudConnection/FakeAwsWaf";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * AWS WAF'S OWN WORD THAT A BLOCK HOLDS (#10344): the requests a web ACL's
 * rule of the blocklist turned away, from those AWS WAF sampled in the
 * last three hours, as the evidence of a Response Plan's "Block this
 * address" step - "AWS WAF blocked requests from 35.205.11.131 at prod-alb
 * (sampled)." Read against AWS WAF as it answers (FakeAwsWaf).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const EXTERNAL_ID: string = getAwsExternalIdForProject(PROJECT_ID.toString());
const RULES: { block: string; challenge: string } =
  getAwsWafBlocklistRuleNames(EXTERNAL_ID);
const NOW: Date = new Date("2026-11-21T10:42:00.000Z");
const ADDRESS: string = "35.205.11.131";

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function sample(data: {
  clientIp: string;
  at: Date;
  action?: string | undefined;
  headers?: Array<[string, string]> | undefined;
}): JSONObject {
  return {
    Request: {
      ClientIP: data.clientIp,
      Country: "BE",
      URI: "/login",
      Method: "POST",
      HTTPVersion: "HTTP/1.1",
      Headers: (data.headers || []).map(
        ([name, value]: [string, string]): JSONObject => {
          return { Name: name, Value: value };
        },
      ),
    },
    Weight: 1,
    Timestamp: seconds(data.at),
    Action: data.action || "BLOCK",
    RuleNameWithinRuleGroup: null,
  } as unknown as JSONObject;
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

// A web ACL that enforces the blocklist, its destination, and what AWS WAF sampled for its rules.
function enforcing(data: {
  samples?: Record<string, Array<JSONObject>> | undefined;
  clientAddress?: SecurityBlockClientAddress | undefined;
  status?: SecurityBlockCloudWafStatus | undefined;
  sampledMetricNames?: JSONObject | undefined;
  addsRule?: boolean | undefined;
}): {
  fake: FakeAwsWaf;
  destination: AwsWafBlockDestination;
  acl: FakeWafWebAcl;
} {
  const probe: FakeAwsWaf = createFakeAwsWaf();
  const probeAcl: FakeWafWebAcl = probe.addWebAcl({
    region: "eu-west-1",
    scope: "REGIONAL",
    name: "prod-alb",
    id: "a1b2c3d4-5678-90ab-cdef-111111111111",
  });
  const arn: string = probeAcl.webAcl["ARN"] as string;
  const fake: FakeAwsWaf = createFakeAwsWaf({
    sampledRequests: Object.fromEntries(
      Object.entries(data.samples || {}).map(
        ([metric, samples]: [string, Array<JSONObject>]): [
          string,
          Array<JSONObject>,
        ] => {
          return [`${arn}|${metric}`, samples];
        },
      ),
    ),
  });
  const acl: FakeWafWebAcl = fake.addWebAcl({
    region: "eu-west-1",
    scope: "REGIONAL",
    name: "prod-alb",
    id: "a1b2c3d4-5678-90ab-cdef-111111111111",
  });
  const webAcl: AwsWafArn = parseAwsWafArn(acl.webAcl["ARN"])!;
  const row: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();

  row._id = "cccccccc-cccc-4ccc-8ccc-000000000001";
  row.projectId = PROJECT_ID;
  row.cloudConnectionId = CONNECTION_ID;
  row.cloudProvider = CloudProvider.AWS;
  row.wafId = webAcl.arn;
  row.name = "prod-alb";
  row.region = "eu-west-1";
  row.clientAddress = data.clientAddress || SecurityBlockClientAddress.SourceIp;
  row.status = data.status || SecurityBlockCloudWafStatus.Enforcing;
  row.ruleDetails = {
    sampledMetricNames: data.sampledMetricNames || {},
  } as never;

  const group: AwsWafBlocklistGroup = new AwsWafBlocklistGroup({
    settings: {
      provider: CloudProvider.AWS,
      projectId: PROJECT_ID.toString(),
      config: {
        authMethod: CloudConnectionAuthMethod.AwsAccessKey,
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        wafBlocklist: data.addsRule === false ? "code" : "rule",
      },
      secrets: {
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
    },
    connectionId: CONNECTION_ID,
    externalId: EXTERNAL_ID,
    accountId: webAcl.accountId,
    region: webAcl.region,
    scope: webAcl.scope,
    options: {
      transport: fake.transport,
      now: (): Date => {
        return NOW;
      },
      sleep: async (): Promise<void> => {},
    },
  });

  return {
    fake,
    acl,
    destination: new AwsWafBlockDestination({
      row,
      webAcl,
      group,
      addsRule: data.addsRule !== false,
      lockKey: "AwsWaf:test",
      now: (): Date => {
        return NOW;
      },
    }),
  };
}

async function read(data: {
  destinations: Array<SecurityBlockDestination>;
  isBlocked?: boolean | undefined;
  address?: string | undefined;
}): Promise<Array<AddressBlockEvidence>> {
  return await createAwsWafBlockedRequests({
    isBlocked: async (): Promise<boolean> => {
      return data.isBlocked !== false;
    },
    findDestinations: async (): Promise<Array<SecurityBlockDestination>> => {
      return data.destinations;
    },
  }).readBlocks({
    projectId: PROJECT_ID,
    address: data.address || ADDRESS,
    now: NOW,
  });
}

describe("the requests AWS WAF turned away, as a block step's evidence", () => {
  test("OneUptime's rule blocked requests from the address: AWS WAF blocked requests from it at prod-alb (sampled), when it last did, with the web ACL in the console", async () => {
    const { fake, destination } = enforcing({
      samples: {
        [RULES.block]: [
          sample({ clientIp: ADDRESS, at: minutesAgo(50) }),
          sample({ clientIp: ADDRESS, at: minutesAgo(5) }),
          sample({ clientIp: "198.51.100.7", at: minutesAgo(1) }),
        ],
      },
    });

    const evidence: Array<AddressBlockEvidence> = await read({
      destinations: [destination],
    });

    expect(evidence).toEqual([
      {
        destination: "AWS WAF (prod-alb)",
        appliedAt: new Date(seconds(minutesAgo(5)) * 1000),
        sentence: {
          template: CHECK_BLOCK_AWS_WAF_SAMPLED,
          values: { address: ADDRESS, webAcl: "prod-alb" },
        },
        link: {
          kind: ResponseLinkKind.OpenProvider,
          provider: "AWS WAF",
          url: getAwsWafConsoleUrl(destination.webAcl),
        },
      },
    ]);
    expect(CHECK_BLOCK_AWS_WAF_SAMPLED).toBe(
      "AWS WAF blocked requests from {{address}} at {{webAcl}} (sampled).",
    );

    // Asked of the last three hours, for each of OneUptime's rules.
    const asked: Array<JSONObject> = fake.calls
      .filter((call: { action: string }): boolean => {
        return call.action === "GetSampledRequests";
      })
      .map((call: { body: JSONObject }): JSONObject => {
        return call.body;
      });

    expect(
      asked.map((body: JSONObject): unknown => {
        return body["RuleMetricName"];
      }),
    ).toEqual([RULES.block, RULES.challenge]);
    expect(asked[0]!["TimeWindow"]).toEqual({
      StartTime: seconds(new Date(NOW.getTime() - AWS_WAF_SAMPLE_WINDOW_IN_MS)),
      EndTime: seconds(NOW),
    });
    expect(asked[0]!["Scope"]).toBe("REGIONAL");
  });

  test("a challenge its rule answered says challenged; one a person passed is no evidence", async () => {
    const { destination } = enforcing({
      samples: {
        [RULES.challenge]: [
          sample({ clientIp: ADDRESS, at: minutesAgo(9), action: "CHALLENGE" }),
          // Passed: the request went on to the app.
          sample({ clientIp: ADDRESS, at: minutesAgo(2), action: "ALLOW" }),
        ],
      },
    });

    const evidence: Array<AddressBlockEvidence> = await read({
      destinations: [destination],
    });

    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sentence.template).toBe(
      CHECK_CHALLENGE_AWS_WAF_SAMPLED,
    );
    expect(evidence[0]!.appliedAt).toEqual(
      new Date(seconds(minutesAgo(9)) * 1000),
    );
  });

  test("a web ACL that reads X-Forwarded-For matches the address its rule reads - the last one - never one the request claimed", async () => {
    const { destination } = enforcing({
      clientAddress: SecurityBlockClientAddress.XForwardedFor,
      samples: {
        [RULES.block]: [
          // The proxy's source address; the client appended last by it.
          sample({
            clientIp: "10.0.0.5",
            at: minutesAgo(4),
            headers: [["X-Forwarded-For", `203.0.113.9, ${ADDRESS}`]],
          }),
        ],
      },
    });

    expect(await read({ destinations: [destination] })).toHaveLength(1);

    // Claimed by the sender, first in the header: not the address the rule blocked.
    expect(
      await read({ destinations: [destination], address: "203.0.113.9" }),
    ).toEqual([]);
  });

  test("a team's own rule in code is sampled under its own name, as its last check found it", async () => {
    const { fake, destination } = enforcing({
      addsRule: false,
      sampledMetricNames: { Block: "oneuptime-blocklist" },
      samples: {
        "oneuptime-blocklist": [
          sample({ clientIp: ADDRESS, at: minutesAgo(3) }),
        ],
      },
    });

    expect(await read({ destinations: [destination] })).toHaveLength(1);
    // No challenge rule found in its web ACL: nothing asked of one.
    expect(
      fake.calls
        .filter((call: { action: string }): boolean => {
          return call.action === "GetSampledRequests";
        })
        .map((call: { body: JSONObject }): unknown => {
          return call.body["RuleMetricName"];
        }),
    ).toEqual(["oneuptime-blocklist"]);
  });

  test("nothing is asked of AWS for an address the blocklist does not hold, nor of a web ACL not enforcing, nor of another destination", async () => {
    const { fake, destination } = enforcing({
      samples: {
        [RULES.block]: [sample({ clientIp: ADDRESS, at: minutesAgo(3) })],
      },
    });

    expect(
      await read({ destinations: [destination], isBlocked: false }),
    ).toEqual([]);

    const waiting: { fake: FakeAwsWaf; destination: AwsWafBlockDestination } =
      enforcing({ status: SecurityBlockCloudWafStatus.WaitingForRule });

    expect(
      await read({
        destinations: [waiting.destination, new TestSecurityBlockDestination()],
      }),
    ).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    expect(waiting.fake.calls).toHaveLength(0);
  });

  test("a web ACL AWS WAF will not answer for is left out - the source never fails the step - and the others still speak", async () => {
    const denied: { fake: FakeAwsWaf; destination: AwsWafBlockDestination } =
      enforcing({});
    const answering: { destination: AwsWafBlockDestination } = enforcing({
      samples: {
        [RULES.block]: [sample({ clientIp: ADDRESS, at: minutesAgo(3) })],
      },
    });

    denied.fake.failNext(
      "GetSampledRequests",
      WAF_ERRORS.denied("wafv2:GetSampledRequests"),
    );

    expect(
      await read({
        destinations: [denied.destination, answering.destination],
      }),
    ).toHaveLength(1);

    expect(
      await createAwsWafBlockedRequests({
        isBlocked: async (): Promise<boolean> => {
          throw new Error("Database not connected");
        },
        findDestinations: async (): Promise<
          Array<SecurityBlockDestination>
        > => {
          return [];
        },
      }).readBlocks({ projectId: PROJECT_ID, address: ADDRESS, now: NOW }),
    ).toEqual([]);
  });
});

describe("the address a sampled request was matched on", () => {
  test("the source address, or the header the web ACL reads - X-Forwarded-For's last, a single-address header's only one", () => {
    const headers: Record<string, Array<string>> = {
      "x-forwarded-for": ["203.0.113.9, 198.51.100.4", "35.205.11.131"],
      "cf-connecting-ip": ["2001:db8::1"],
    };

    expect(
      getAwsWafSampleClientAddress({
        clientIp: "10.0.0.5",
        headers,
        clientAddress: SecurityBlockClientAddress.SourceIp,
      }),
    ).toBe("10.0.0.5");
    expect(
      getAwsWafSampleClientAddress({
        clientIp: "10.0.0.5",
        headers,
        clientAddress: SecurityBlockClientAddress.XForwardedFor,
      }),
    ).toBe("35.205.11.131");
    expect(
      getAwsWafSampleClientAddress({
        clientIp: "10.0.0.5",
        headers,
        clientAddress: SecurityBlockClientAddress.CfConnectingIp,
      }),
    ).toBe("2001:db8::1");
    expect(
      getAwsWafSampleClientAddress({
        clientIp: "10.0.0.5",
        headers,
        clientAddress: SecurityBlockClientAddress.TrueClientIp,
      }),
    ).toBeNull();
  });

  test("a web ACL's sampled requests open in the AWS console, CloudFront's as global", () => {
    expect(
      getAwsWafConsoleUrl(
        parseAwsWafArn(
          "arn:aws:wafv2:eu-west-1:123456789012:regional/webacl/prod-alb/a1b2c3d4-5678-90ab-cdef-111111111111",
        )!,
      ),
    ).toBe(
      "https://console.aws.amazon.com/wafv2/homev2/web-acl/prod-alb/a1b2c3d4-5678-90ab-cdef-111111111111/overview?region=eu-west-1",
    );
    expect(
      getAwsWafConsoleUrl(
        parseAwsWafArn(
          "arn:aws:wafv2:us-east-1:123456789012:global/webacl/prod-cf/c3d4e5f6-5678-90ab-cdef-222222222222",
        )!,
      ),
    ).toBe(
      "https://console.aws.amazon.com/wafv2/homev2/web-acl/prod-cf/c3d4e5f6-5678-90ab-cdef-222222222222/overview?region=global",
    );
  });
});
