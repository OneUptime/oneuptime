import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  awsErrorCodeOf,
  classifyAwsError,
  getAwsHost,
  getAwsPartition,
  readXmlTag,
  sendAwsRequest,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import {
  AWS_ALL_COMMERCIAL_REGIONS,
  isAwsRegion,
  validateAwsRegions,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsRegions";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  AssumedRoleCache,
  getRoleSessionName,
  getStsRegion,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import {
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  CloudConnectionAwsRoleSetup,
  getAwsExternalIdForProject,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  createFakeAws,
  stsError,
} from "./FakeAwsApi";

/*
 * The pieces every AWS call of a cloud connection goes through: the hosts
 * of each partition, reading STS's XML and both protocols' error codes,
 * what each code means, retrying throttling and refusing past a read's
 * budget, the Regions a connection reads, and this OneUptime's own AWS
 * identity - offered only when it is configured and AWS accepts it.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  AwsServerIdentity.clearCache();
  AssumedRoleCache.clear();
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

describe("partitions and hosts", () => {
  test("China and GovCloud are partitions of their own", () => {
    expect(getAwsPartition("us-east-1")).toBe("aws");
    expect(getAwsPartition("us-gov-west-1")).toBe("aws-us-gov");
    expect(getAwsPartition("cn-north-1")).toBe("aws-cn");
    expect(getAwsHost("monitoring", "eu-west-1")).toBe(
      "monitoring.eu-west-1.amazonaws.com",
    );
    expect(getAwsHost("sts", "cn-north-1")).toBe(
      "sts.cn-north-1.amazonaws.com.cn",
    );
  });

  test("STS is called in the home Region of the connection's first Region's partition", () => {
    expect(getStsRegion([])).toBe("us-east-1");
    expect(getStsRegion(["eu-west-1"])).toBe("us-east-1");
    expect(getStsRegion(["us-gov-east-1"])).toBe("us-gov-west-1");
    expect(getStsRegion(["cn-northwest-1"])).toBe("cn-north-1");
  });

  test("a role session is named after its connection, as CloudTrail shows it", () => {
    expect(getRoleSessionName("33333333-3333-4333-8333-333333333333")).toBe(
      "OneUptime-33333333333343338333333333333333",
    );
    expect(getRoleSessionName("")).toBe("OneUptime-test");
    expect(getRoleSessionName("x".repeat(200)).length).toBe(64);
  });
});

describe("reading AWS's answers", () => {
  test("a tag's text, with XML's entities decoded", () => {
    expect(
      readXmlTag(
        "<a><Code>Access&amp;Denied &lt;x&gt; &quot;y&quot; &apos;z&apos;</Code></a>",
        "Code",
      ),
    ).toBe(`Access&Denied <x> "y" 'z'`);
    expect(readXmlTag("<a></a>", "Code")).toBe("");
    expect(readXmlTag("<Code>unclosed", "Code")).toBe("");
  });

  test("an error code from either protocol", () => {
    expect(
      awsErrorCodeOf(
        '{"__type":"com.amazonaws.coral#AccessDeniedException","message":"x"}',
      ),
    ).toBe("AccessDeniedException");
    expect(awsErrorCodeOf('{"code":"Throttling"}')).toBe("Throttling");
    expect(
      awsErrorCodeOf(
        "<ErrorResponse><Error><Code>InvalidClientTokenId</Code></Error></ErrorResponse>",
      ),
    ).toBe("InvalidClientTokenId");
    expect(awsErrorCodeOf("{not json")).toBe("");
    expect(awsErrorCodeOf("")).toBe("");
  });

  test.each([
    ["InvalidClientTokenId", CloudConnectionFailureKind.Authentication],
    ["UnrecognizedClientException", CloudConnectionFailureKind.Authentication],
    ["SignatureDoesNotMatch", CloudConnectionFailureKind.Authentication],
    ["ExpiredToken", CloudConnectionFailureKind.Authentication],
    ["AccessDenied", CloudConnectionFailureKind.Permission],
    ["AccessDeniedException", CloudConnectionFailureKind.Permission],
    ["Throttling", CloudConnectionFailureKind.RateLimited],
    ["ThrottlingException", CloudConnectionFailureKind.RateLimited],
  ])("%s means %s", (code: string, kind: CloudConnectionFailureKind) => {
    const failure: LlmProviderError = classifyAwsError({
      error: new BadDataException(
        `Data source responded with HTTP 400: {"__type":"x#${code}","message":"m"}`,
      ),
      step: "request",
      providerTitle: "AWS",
      secretValues: [],
    });

    expect(failure.kind).toBe(kind);
  });

  test("an answer with no known code keeps the status's meaning", () => {
    expect(
      classifyAwsError({
        error: new BadDataException(
          "Data source responded with HTTP 503: Service Unavailable",
        ),
        step: "request",
        providerTitle: "AWS",
        secretValues: [],
      }).kind,
    ).toBe(CloudConnectionFailureKind.Unavailable);
  });
});

describe("sending", () => {
  test("a read's budget refuses the call past its limit, before anything is sent", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 0,
      maxDurationMs: 60000,
    });

    await expect(
      sendAwsRequest({
        transport: fake.transport,
        credentials: {
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "s",
        },
        service: "sts",
        region: "us-east-1",
        body: { Action: "GetCallerIdentity", Version: "2011-06-15" },
        step: "sign-in check",
        providerTitle: "AWS",
        budget,
      }),
    ).rejects.toBeInstanceOf(CloudReadBudgetSpent);
    expect(fake.requests).toHaveLength(0);
    expect(budget.isSpent()).toBe(true);
  });

  test("throttling is retried three times, waiting longer each time, then given up", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      callerIdentityError: stsError(400, "Throttling", "Rate exceeded"),
    });
    const waits: Array<number> = [];

    await expect(
      sendAwsRequest({
        transport: fake.transport,
        credentials: {
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "s",
        },
        service: "sts",
        region: "us-east-1",
        body: { Action: "GetCallerIdentity", Version: "2011-06-15" },
        step: "sign-in check",
        providerTitle: "AWS",
        sleep: async (milliseconds: number) => {
          waits.push(milliseconds);
        },
      }),
    ).rejects.toMatchObject({ kind: CloudConnectionFailureKind.RateLimited });
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(fake.requests).toHaveLength(4);
  });

  test("a query-protocol call is a signed form", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });

    const answer: { text: string } = await sendAwsRequest({
      transport: fake.transport,
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "s",
        sessionToken: "token",
      },
      service: "sts",
      region: "us-east-1",
      body: { Action: "GetCallerIdentity", Version: "2011-06-15" },
      step: "sign-in check",
      providerTitle: "AWS",
    });

    expect(readXmlTag(answer.text, "Account")).toBe(FAKE_ACCOUNT_ID);

    const headers: Record<string, string> = fake.requests[0]!.headers as Record<
      string,
      string
    >;

    expect(headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded; charset=utf-8",
    );
    expect(headers["X-Amz-Security-Token"]).toBe("token");
    expect(fake.requests[0]!.body).toBe(
      "Action=GetCallerIdentity&Version=2011-06-15",
    );
  });
});

describe("Regions", () => {
  test("a Region code is letters and a number", () => {
    for (const region of [
      "us-east-1",
      "eu-central-2",
      "us-gov-west-1",
      "ap-southeast-7",
    ]) {
      expect(isAwsRegion(region)).toBe(true);
    }
    for (const region of [
      "",
      "us-east",
      "us_east_1",
      "us-east-1a",
      "1-2-3",
      "us--1",
      "x".repeat(30),
    ]) {
      expect(isAwsRegion(region)).toBe(false);
    }
  });

  test("every Region a connection sweeps by itself is a Region, once", () => {
    expect(new Set(AWS_ALL_COMMERCIAL_REGIONS).size).toBe(
      AWS_ALL_COMMERCIAL_REGIONS.length,
    );
    for (const region of AWS_ALL_COMMERCIAL_REGIONS) {
      expect(isAwsRegion(region)).toBe(true);
    }
    expect(AWS_ALL_COMMERCIAL_REGIONS).toContain("us-east-1");
  });

  test("at most 40 named Regions", () => {
    expect(() => {
      validateAwsRegions(new Array(41).fill("us-east-1"));
    }).toThrow("at most 40");
  });
});

describe("this OneUptime's AWS identity", () => {
  test("none without both settings: the role way is not offered", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });

    expect(AwsServerIdentity.isConfigured()).toBe(false);

    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    expect(AwsServerIdentity.isConfigured()).toBe(false);

    const setup: CloudConnectionAwsRoleSetup =
      await AwsServerIdentity.getRoleSetup({
        projectId: PROJECT,
        transport: fake.transport,
      });

    expect(setup).toEqual({
      isAvailable: false,
      externalId: getAwsExternalIdForProject(PROJECT),
    });
    expect(fake.requests).toHaveLength(0);
  });

  test("configured, it trusts its whole account, asked of AWS once an hour", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] = "server-secret";
    const fake: FakeAws = createFakeAws({
      regions: {},
      account: "999988887777",
    });

    const setup: CloudConnectionAwsRoleSetup =
      await AwsServerIdentity.getRoleSetup({
        projectId: PROJECT,
        transport: fake.transport,
      });
    await AwsServerIdentity.getRoleSetup({
      projectId: PROJECT,
      transport: fake.transport,
    });

    expect(setup).toEqual({
      isAvailable: true,
      trustedPrincipalArn: "arn:aws:iam::999988887777:root",
      externalId: getAwsExternalIdForProject(PROJECT),
    });
    expect(fake.stsCalls).toHaveLength(1);
  });

  test("an identity AWS refuses is not offered, and asked again later", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] = "server-secret";
    const fake: FakeAws = createFakeAws({
      regions: {},
      callerIdentityError: stsError(403, "InvalidClientTokenId"),
    });

    const setup: CloudConnectionAwsRoleSetup =
      await AwsServerIdentity.getRoleSetup({
        projectId: PROJECT,
        transport: fake.transport,
      });

    expect(setup.isAvailable).toBe(false);
    expect(setup.trustedPrincipalArn).toBeUndefined();
  });

  test("a GovCloud identity trusts its GovCloud account", () => {
    expect(
      AwsServerIdentity.getTrustedPrincipalArn({
        account: "111122223333",
        arn: "arn:aws-us-gov:iam::111122223333:user/x",
      }),
    ).toBe("arn:aws-us-gov:iam::111122223333:root");
  });
});
