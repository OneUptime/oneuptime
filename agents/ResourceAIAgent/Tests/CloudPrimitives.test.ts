import "./Helpers/TestSupport";
import assert from "assert";
import http from "http";
import net, { AddressInfo } from "net";
import { after, before, describe, test } from "node:test";
import {
  AwsSignedRequest,
  awsUriEncode,
  buildAwsPath,
  canonicalAwsQueryString,
  deriveAwsSigningKey,
  encodeAwsForm,
  formatAmzDate,
  signAwsRequest,
} from "../Executors/Cloud/AwsSigV4";
import {
  MAX_XML_DEPTH,
  XmlElement,
  decodeXmlText,
  parseXml,
  xmlChildren,
  xmlFind,
  xmlText,
} from "../Executors/Cloud/CloudXml";
import {
  CloudAgentSettings,
  carriesRequiredTag,
  getCloudChangeNames,
  parseCloudAgentSettings,
} from "../Executors/Cloud/CloudSettings";
import {
  buildAwsSessionPolicy,
  buildRoleSessionName,
  isAwsReadAction,
  readAwsRegion,
} from "../Executors/Cloud/AwsCredentials";
import {
  accountOfArn,
  awsDnsSuffix,
  readAwsError,
  stsEndpoint,
} from "../Executors/Cloud/AwsApi";
import {
  parseSqsQueueUrl,
  parseTaskDefinitionArn,
  sqsQueueUrl,
  withoutTrailingSlashes,
} from "../Executors/Cloud/AwsOperations";
import { readVmPowerState } from "../Executors/Cloud/AzureOperations";
import { shortRevisionName } from "../Executors/Cloud/GcpOperations";
import {
  CloudHttpResponse,
  CloudTransportError,
  cloudTransport,
  directHttpTransport,
  fetchTransport,
  isPlatformHost,
} from "../Executors/Cloud/CloudHttp";
import { boundsOf, withArticle } from "../Executors/Cloud/CloudChange";
import { reply } from "./Helpers/FakeCloud";

/*
 * The Cloud AI agent's building blocks: SigV4 against AWS's published
 * example and against requests the AWS CLI signed (the agent carries no
 * AWS SDK), the XML reader, the agent's own settings, the session policy,
 * how AWS errors are read, and the real transports against local servers.
 */

const EXAMPLE_SECRET: string = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

describe("SigV4: known answers", () => {
  test("AWS's published example (IAM ListUsers): canonical request, string to sign, signing key and signature", () => {
    const signed: AwsSignedRequest = signAwsRequest({
      method: "GET",
      path: "/",
      query: { Action: "ListUsers", Version: "2010-05-08" },
      host: "iam.amazonaws.com",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: "",
      service: "iam",
      region: "us-east-1",
      date: new Date("2015-08-30T12:36:00Z"),
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: EXAMPLE_SECRET,
        sessionToken: null,
      },
    });

    assert.strictEqual(
      signed.canonicalRequest,
      [
        "GET",
        "/",
        "Action=ListUsers&Version=2010-05-08",
        "content-type:application/x-www-form-urlencoded; charset=utf-8",
        "host:iam.amazonaws.com",
        "x-amz-date:20150830T123600Z",
        "",
        "content-type;host;x-amz-date",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n"),
    );
    assert.strictEqual(
      signed.stringToSign,
      [
        "AWS4-HMAC-SHA256",
        "20150830T123600Z",
        "20150830/us-east-1/iam/aws4_request",
        "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59",
      ].join("\n"),
    );
    assert.strictEqual(
      deriveAwsSigningKey({
        secretAccessKey: EXAMPLE_SECRET,
        dateStamp: "20150830",
        region: "us-east-1",
        service: "iam",
      }).toString("hex"),
      "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9",
    );
    assert.strictEqual(
      signed.signature,
      "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
    assert.strictEqual(
      signed.headers["Authorization"],
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
    assert.strictEqual(signed.headers["X-Amz-Date"], "20150830T123600Z");
    assert.strictEqual(
      signed.queryString,
      "Action=ListUsers&Version=2010-05-08",
    );
  });

  test("the test suite's get-vanilla", () => {
    assert.strictEqual(
      signAwsRequest({
        method: "GET",
        path: "/",
        query: {},
        host: "example.amazonaws.com",
        headers: {},
        body: "",
        service: "service",
        region: "us-east-1",
        date: new Date("2015-08-30T12:36:00Z"),
        credentials: {
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: EXAMPLE_SECRET,
          sessionToken: null,
        },
      }).signature,
      "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  /*
   * Requests the AWS CLI (botocore) signed, captured with --debug against an
   * unreachable endpoint: the same signature means the same canonical request.
   */
  test("as the AWS CLI signs a Lambda REST call: an ARN in the path, encoded twice, and a session token", () => {
    const path: string = buildAwsPath([
      "2017-03-31",
      "tags",
      "arn:aws:lambda:us-east-1:123456789012:function:my-fn",
    ]);
    const signed: AwsSignedRequest = signAwsRequest({
      method: "GET",
      path,
      query: {},
      host: "127.0.0.1:9",
      headers: {},
      body: "",
      service: "lambda",
      region: "us-east-1",
      date: new Date("2026-10-27T19:24:37Z"),
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: EXAMPLE_SECRET,
        sessionToken: "session-token-example",
      },
    });

    assert.strictEqual(
      path,
      "/2017-03-31/tags/arn%3Aaws%3Alambda%3Aus-east-1%3A123456789012%3Afunction%3Amy-fn",
    );
    assert.strictEqual(
      signed.canonicalRequest.split("\n")[1],
      "/2017-03-31/tags/arn%253Aaws%253Alambda%253Aus-east-1%253A123456789012%253Afunction%253Amy-fn",
    );
    assert.strictEqual(
      signed.signature,
      "d3ccce751f6d395d5261d2638139a9e79cc9b432edf5909312644dc4e2c5363d",
    );
    assert.strictEqual(
      signed.headers["X-Amz-Security-Token"],
      "session-token-example",
    );
  });

  test("as the AWS CLI signs a JSON 1.1 call (ECS UpdateService)", () => {
    assert.strictEqual(
      signAwsRequest({
        method: "POST",
        path: "/",
        query: {},
        host: "127.0.0.1:9",
        headers: {
          "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.UpdateService",
          "Content-Type": "application/x-amz-json-1.1",
        },
        body: '{"cluster": "prod", "service": "web", "desiredCount": 4}',
        service: "ecs",
        region: "us-east-1",
        date: new Date("2026-10-27T19:24:55Z"),
        credentials: {
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: EXAMPLE_SECRET,
          sessionToken: null,
        },
      }).signature,
      "43ae85111dd55d6021369ebe9379abab9edbb90ff9371fca1bb65f69929dcd28",
    );
  });

  test("as the AWS CLI signs a Query call with a JSON session policy in its form body (STS AssumeRole)", () => {
    const body: string = encodeAwsForm([
      ["Action", "AssumeRole"],
      ["Version", "2011-06-15"],
      ["RoleArn", "arn:aws:iam::123456789012:role/OneUptimeAiAgentWrite"],
      ["RoleSessionName", "oneuptime-ai-scale-out-1a2b3c4d"],
      [
        "Policy",
        '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["ecs:UpdateService"],"Resource":["arn:aws:ecs:us-east-1:123456789012:service/prod/web"]}]}',
      ],
      ["DurationSeconds", "900"],
    ]);

    // The same 428 bytes the CLI sent.
    assert.strictEqual(Buffer.byteLength(body), 428);
    assert.strictEqual(
      signAwsRequest({
        method: "POST",
        path: "/",
        query: {},
        host: "127.0.0.1:9",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body,
        service: "sts",
        region: "eu-west-1",
        date: new Date("2026-10-27T19:26:01Z"),
        credentials: {
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: EXAMPLE_SECRET,
          sessionToken: "tok/en+example=",
        },
      }).signature,
      "88194365f3a72337417cad44020a3a7441da09783569456b6441cfd6de896c57",
    );
  });

  test("encoding: RFC 3986 unreserved characters only, UTF-8 bytes, a sorted query", () => {
    assert.strictEqual(awsUriEncode("a-b_c.d~e", true), "a-b_c.d~e");
    assert.strictEqual(
      awsUriEncode("a b/c:d*e+f=", true),
      "a%20b%2Fc%3Ad%2Ae%2Bf%3D",
    );
    assert.strictEqual(awsUriEncode("/a b/", false), "/a%20b/");
    assert.strictEqual(awsUriEncode("ሴ", true), "%E1%88%B4");
    assert.strictEqual(
      canonicalAwsQueryString({ MaxItems: "50", Marker: "page 2", "A b": "x" }),
      "A%20b=x&Marker=page%202&MaxItems=50",
    );
    assert.strictEqual(
      formatAmzDate(new Date("2026-10-27T09:05:03.456Z")),
      "20261027T090503Z",
    );
  });
});

describe("the XML reader", () => {
  test("elements, text, children; prefixes, prolog, comments, CDATA and attributes", () => {
    const root: XmlElement | null =
      parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment -->
<a:Response xmlns:a="urn:x" note="1 > 0">
  <Item><Name>one &amp; two</Name><Empty/></Item>
  <Item><Name><![CDATA[<three>]]></Name></Item>
  <Code>&#65;&#x42;&lt;&gt;&quot;&apos;</Code>
</a:Response>`);

    assert.strictEqual(root?.name, "Response");
    assert.deepStrictEqual(
      xmlChildren(root, "Item").map((item: XmlElement): string | null => {
        return xmlText(item, "Name");
      }),
      ["one & two", "<three>"],
    );
    assert.strictEqual(xmlText(root, "Item", "Empty"), "");
    assert.strictEqual(xmlText(root, "Code"), `AB<>"'`);
    assert.strictEqual(xmlText(root, "Missing"), null);
    assert.strictEqual(xmlFind(root, "Empty")?.name, "Empty");
  });

  test("an answer it cannot read for certain is not read at all", () => {
    for (const text of [
      "<a><b></a>",
      "<a>",
      "<a></b>",
      "<a/><b/>",
      "text<a/>",
      "<a>&unknown;</a>",
      "<a>&#xD800;</a>",
      '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>',
      "<a b='unclosed></a>",
      "<?xml",
      "< a/>",
    ]) {
      assert.strictEqual(parseXml(text), null, text);
    }
  });

  test("depth is bounded; deep but allowed trees are searched without recursion", () => {
    const tooDeep: string = `${"<a>".repeat(MAX_XML_DEPTH + 1)}${"</a>".repeat(MAX_XML_DEPTH + 1)}`;
    const deep: string = `${"<a>".repeat(MAX_XML_DEPTH - 1)}<b>x</b>${"</a>".repeat(MAX_XML_DEPTH - 1)}`;

    assert.strictEqual(parseXml(tooDeep), null);
    assert.strictEqual(xmlFind(parseXml(deep), "b")?.text, "x");
  });

  test("a large answer reads in linear time", () => {
    const items: string = "<item><key>k</key><value>v</value></item>".repeat(
      20_000,
    );
    const startedAt: number = Date.now();
    const root: XmlElement | null = parseXml(`<tagSet>${items}</tagSet>`);

    assert.strictEqual(xmlChildren(root, "item").length, 20_000);
    assert.ok(Date.now() - startedAt < 2_000, "parsed within two seconds");
    assert.strictEqual(decodeXmlText("a &amp;&amp; b"), "a && b");
  });
});

describe("the agent's own cloud settings", () => {
  test("unset: every change this cloud has", () => {
    const aws: CloudAgentSettings = parseCloudAgentSettings({}, "aws");

    assert.deepStrictEqual(aws.enabledOperations, getCloudChangeNames("aws"));
    assert.strictEqual(aws.operationsLimited, false);
    assert.deepStrictEqual(aws.warnings, []);
    assert.deepStrictEqual(getCloudChangeNames("gcp"), [
      "start-instance",
      "scale-out",
      "scale-in",
      "reboot-instance",
      "roll-back-service",
      "set-concurrency",
      "fail-over-database",
      "stop-instance",
    ]);
  });

  test("a list: canonical names in catalog order, aliases and case accepted", () => {
    const settings: CloudAgentSettings = parseCloudAgentSettings(
      {
        ONEUPTIME_AI_CLOUD_OPERATIONS:
          " Failover-Database, scale-out,,rollback-service ",
      },
      "aws",
    );

    assert.deepStrictEqual(settings.enabledOperations, [
      "scale-out",
      "roll-back-service",
      "fail-over-database",
    ]);
    assert.strictEqual(settings.operationsLimited, true);
    assert.deepStrictEqual(settings.warnings, []);
  });

  test("the required tag: key=value, trimmed; an empty value is a value; anything else is a problem", () => {
    assert.deepStrictEqual(
      parseCloudAgentSettings(
        { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: " team = sre " },
        "aws",
      ).requiredTag,
      { key: "team", value: "sre" },
    );
    assert.deepStrictEqual(
      parseCloudAgentSettings(
        { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=" },
        "aws",
      ).requiredTag,
      { key: "oneuptime-ai", value: "" },
    );

    for (const value of ["oneuptime-ai", "=allow", `${"k".repeat(129)}=v`]) {
      const settings: CloudAgentSettings = parseCloudAgentSettings(
        { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: value },
        "gcp",
      );

      assert.strictEqual(settings.requiredTag, null, value);
      assert.match(
        String(settings.requiredTagProblem),
        /is not a tag written as key=value/,
        value,
      );
    }
  });

  test("the write role: an IAM role ARN, AWS only", () => {
    assert.strictEqual(
      parseCloudAgentSettings(
        {
          ONEUPTIME_AI_AWS_WRITE_ROLE_ARN:
            "arn:aws-us-gov:iam::123456789012:role/path/OneUptimeAiAgentWrite",
        },
        "aws",
      ).awsWriteRoleArn,
      "arn:aws-us-gov:iam::123456789012:role/path/OneUptimeAiAgentWrite",
    );
    assert.match(
      String(
        parseCloudAgentSettings(
          {
            ONEUPTIME_AI_AWS_WRITE_ROLE_ARN:
              "arn:aws:iam::123456789012:user/someone",
          },
          "aws",
        ).awsWriteRoleProblem,
      ),
      /is not an IAM role ARN/,
    );
  });

  test("a resource carries the required tag exactly: AWS exactly, Azure names without case, Google labels lowercased", () => {
    const tag: { key: string; value: string } = {
      key: "OneUptime-AI",
      value: "Allow",
    };

    assert.strictEqual(
      carriesRequiredTag({
        provider: "aws",
        tag,
        tags: { "OneUptime-AI": "Allow" },
      }),
      true,
    );
    assert.strictEqual(
      carriesRequiredTag({
        provider: "aws",
        tag,
        tags: { "oneuptime-ai": "Allow" },
      }),
      false,
    );
    assert.strictEqual(
      carriesRequiredTag({
        provider: "azure",
        tag,
        tags: { "oneuptime-ai": "Allow" },
      }),
      true,
    );
    assert.strictEqual(
      carriesRequiredTag({
        provider: "azure",
        tag,
        tags: { "oneuptime-ai": "allow" },
      }),
      false,
    );
    assert.strictEqual(
      carriesRequiredTag({
        provider: "gcp",
        tag,
        tags: { "oneuptime-ai": "allow" },
      }),
      true,
    );
    assert.strictEqual(
      carriesRequiredTag({ provider: "gcp", tag, tags: {} }),
      false,
    );
  });
});

describe("AWS sessions and answers", () => {
  test("the session policy: changes on the resources, reads on *, deduplicated; nothing allowed is an explicit deny", () => {
    assert.deepStrictEqual(
      JSON.parse(
        buildAwsSessionPolicy({
          permissions: [
            "ecs:UpdateService",
            "ecs:DescribeServices",
            "ecs:UpdateService",
            "ecs:ListTaskDefinitions",
          ],
          writeResources: ["arn:a", "arn:a", "arn:b"],
        }),
      ),
      {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "OneUptimeAiChange",
            Effect: "Allow",
            Action: ["ecs:UpdateService"],
            Resource: ["arn:a", "arn:b"],
          },
          {
            Sid: "OneUptimeAiRead",
            Effect: "Allow",
            Action: ["ecs:DescribeServices", "ecs:ListTaskDefinitions"],
            Resource: "*",
          },
        ],
      },
    );
    assert.deepStrictEqual(
      JSON.parse(
        buildAwsSessionPolicy({ permissions: [], writeResources: [] }),
      ),
      {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "OneUptimeAiNothing",
            Effect: "Deny",
            Action: "*",
            Resource: "*",
          },
        ],
      },
    );
    assert.strictEqual(isAwsReadAction("lambda:GetFunctionConcurrency"), true);
    assert.strictEqual(isAwsReadAction("sqs:ListDeadLetterSourceQueues"), true);
    assert.strictEqual(isAwsReadAction("sqs:ReceiveMessage"), false);
    assert.strictEqual(isAwsReadAction("rds:RebootDBInstance"), false);
  });

  test("the session name: oneuptime-ai-<operation>-<id>, within STS's characters and 64 characters", () => {
    assert.strictEqual(
      buildRoleSessionName("scale-out", "1a2b3c4d"),
      "oneuptime-ai-scale-out-1a2b3c4d",
    );
    assert.ok(buildRoleSessionName("x".repeat(80), "id").length <= 64);
    assert.strictEqual(
      buildRoleSessionName("a b/c", "1"),
      "oneuptime-ai-a-b-c-1",
    );
  });

  test("an error answer in any protocol: its code and message", () => {
    assert.deepStrictEqual(
      readAwsError(
        reply(
          400,
          '{"__type":"com.amazonaws.ecs#ClientException","message":"bad"}',
        ),
      ),
      { code: "ClientException", message: "bad" },
    );
    assert.deepStrictEqual(
      readAwsError(
        reply(403, '{"Message":"denied"}', {
          "x-amzn-ErrorType":
            "AccessDeniedException:http://internal.amazon.com/coral/com.amazon.coral.service/",
        }),
      ),
      { code: "AccessDeniedException", message: "denied" },
    );
    assert.deepStrictEqual(
      readAwsError(
        reply(
          400,
          "<Response><Errors><Error><Code>InvalidInstanceID.NotFound</Code><Message>gone</Message></Error></Errors></Response>",
        ),
      ),
      { code: "InvalidInstanceID.NotFound", message: "gone" },
    );
    assert.deepStrictEqual(
      readAwsError(
        reply(
          403,
          "<ErrorResponse><Error><Type>Sender</Type><Code>AccessDenied</Code><Message>no</Message></Error></ErrorResponse>",
        ),
      ),
      { code: "AccessDenied", message: "no" },
    );
  });

  test("endpoints, partitions, ARNs and queue URLs", () => {
    assert.strictEqual(awsDnsSuffix("cn-north-1"), "amazonaws.com.cn");
    assert.strictEqual(awsDnsSuffix("us-gov-west-1"), "amazonaws.com");
    assert.deepStrictEqual(stsEndpoint("eu-west-1"), {
      host: "sts.eu-west-1.amazonaws.com",
      region: "eu-west-1",
    });
    assert.deepStrictEqual(stsEndpoint(null), {
      host: "sts.amazonaws.com",
      region: "us-east-1",
    });
    assert.strictEqual(
      accountOfArn("arn:aws:sts::123456789012:assumed-role/R/s"),
      "123456789012",
    );
    assert.strictEqual(accountOfArn("not-an-arn"), null);
    assert.strictEqual(
      readAwsRegion({ AWS_REGION: "bogus", AWS_DEFAULT_REGION: "ap-south-1" }),
      "ap-south-1",
    );
    assert.deepStrictEqual(
      parseTaskDefinitionArn(
        "arn:aws:ecs:us-east-1:1:task-definition/web-api:41",
      ),
      {
        family: "web-api",
        revision: 41,
      },
    );
    assert.strictEqual(parseTaskDefinitionArn("web"), null);
    assert.strictEqual(
      sqsQueueUrl({
        region: "us-east-1",
        account: "123456789012",
        name: "jobs.fifo",
      }),
      "https://sqs.us-east-1.amazonaws.com/123456789012/jobs.fifo",
    );
    assert.deepStrictEqual(
      parseSqsQueueUrl("https://sqs.us-east-1.amazonaws.com/123456789012/jobs"),
      {
        host: "sqs.us-east-1.amazonaws.com",
        account: "123456789012",
        name: "jobs",
      },
    );
    assert.strictEqual(
      parseSqsQueueUrl("http://sqs.us-east-1.amazonaws.com/123456789012/jobs"),
      null,
    );
  });
});

describe("small readers", () => {
  test("a VM's power state, a revision's short name, articles, bounds", () => {
    assert.strictEqual(
      readVmPowerState({
        properties: {
          instanceView: {
            statuses: [
              { code: "ProvisioningState/succeeded" },
              { code: "PowerState/Deallocated" },
            ],
          },
        },
      }),
      "deallocated",
    );
    assert.strictEqual(readVmPowerState({}), "");
    assert.strictEqual(
      shortRevisionName(
        "projects/p/locations/l/services/s/revisions/s-00042-abc",
      ),
      "s-00042-abc",
    );
    assert.strictEqual(withArticle("ECS service"), "an ECS service");
    assert.strictEqual(withArticle("SQS queue"), "an SQS queue");
    assert.strictEqual(withArticle("virtual machine"), "a virtual machine");
    assert.deepStrictEqual(boundsOf({ current: 3, unit: "count" }).maximum, 6);
    assert.strictEqual(
      boundsOf({
        current: 3,
        unit: "count",
        maximum: 10,
        maximumSource: "its max",
      }).maximum,
      10,
    );
    assert.strictEqual(
      boundsOf({ current: 0, unit: "count" }).maximumIsPlatformLimit,
      false,
    );
  });

  test("the hosts the proxy-free road may reach over plain http", () => {
    for (const host of [
      "169.254.169.254",
      "169.254.170.2",
      "127.0.0.1",
      "localhost",
      "[::1]",
      "metadata.google.internal",
      "fd00:ec2::23",
    ]) {
      assert.strictEqual(isPlatformHost(host), true, host);
    }

    for (const host of [
      "10.0.0.5",
      "example.com",
      "169.255.0.1",
      "2001:db8::1",
    ]) {
      assert.strictEqual(isPlatformHost(host), false, host);
    }
  });
});

/*
 * The ECS task metadata address the agent asks for its own task, without
 * its trailing slashes - in time linear in its length, whatever it holds
 * (a /\/+$/ replace retries from every slash of a run that is not at the
 * end: about 55,000 slashes before one other character took seconds).
 */
describe("an address without its trailing slashes", () => {
  test("drops every trailing slash and nothing else", () => {
    assert.strictEqual(
      withoutTrailingSlashes("http://169.254.170.2/v4/abc"),
      "http://169.254.170.2/v4/abc",
    );
    assert.strictEqual(
      withoutTrailingSlashes("http://169.254.170.2/v4/abc///"),
      "http://169.254.170.2/v4/abc",
    );
    assert.strictEqual(withoutTrailingSlashes("/a//b/"), "/a//b");
    assert.strictEqual(withoutTrailingSlashes("///"), "");
    assert.strictEqual(withoutTrailingSlashes(""), "");
  });

  test("is linear on its worst case: a long run of slashes that does not end it", () => {
    const worst: string = `${"/".repeat(400_000)}x/`;
    let fastest: number = Number.POSITIVE_INFINITY;

    for (let attempt: number = 0; attempt < 3; attempt++) {
      const startedAt: number = Date.now();
      assert.strictEqual(
        withoutTrailingSlashes(worst),
        `${"/".repeat(400_000)}x`,
      );
      fastest = Math.min(fastest, Date.now() - startedAt);
    }

    assert.ok(fastest < 2_000, `took ${fastest} ms`);
  });
});

// ---- The real transports, against local servers --------------------------------------------

describe("the transports", () => {
  let server: http.Server;
  let base: string;
  let closedPort: number;
  const seen: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];

  before(async () => {
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        const chunks: Array<Buffer> = [];

        request.on("data", (chunk: Buffer): void => {
          chunks.push(chunk);
        });
        request.on("end", (): void => {
          seen.push({
            method: request.method || "",
            url: request.url || "",
            headers: request.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });

          if (request.url === "/redirect") {
            response.writeHead(302, {
              Location: "http://example.com/elsewhere",
            });
            response.end();
            return;
          }

          if (request.url === "/large") {
            response.writeHead(200, { "Content-Type": "text/plain" });
            response.end("x".repeat(10_000));
            return;
          }

          if (request.url === "/silent") {
            // Never answers.
            return;
          }

          response.writeHead(200, {
            "Content-Type": "application/json",
            "X-Custom": "Yes",
          });
          response.end(JSON.stringify({ ok: true }));
        });
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const probe: net.Server = net.createServer();

    await new Promise<void>((resolve: () => void): void => {
      probe.listen(0, "127.0.0.1", resolve);
    });
    closedPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve: () => void): void => {
      probe.close((): void => {
        resolve();
      });
    });
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });
  });

  (
    [
      ["the direct (metadata) transport", directHttpTransport],
      ["the fetch (API) transport", fetchTransport],
    ] as Array<[string, typeof directHttpTransport]>
  ).forEach(([name, transport]: [string, typeof directHttpTransport]): void => {
    test(`${name}: the request as given, the answer with lowercased headers`, async () => {
      seen.length = 0;

      const response: CloudHttpResponse = await transport({
        method: "POST",
        url: `${base}/api?x=1`,
        headers: {
          "X-Amz-Target": "Service.Op",
          "Content-Type": "application/json",
        },
        body: '{"a":1}',
        timeoutInMs: 5_000,
        maxResponseBytes: 1_000,
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers["x-custom"], "Yes");
      assert.strictEqual(response.body, '{"ok":true}');
      assert.strictEqual(response.truncated, false);
      assert.strictEqual(seen[0]?.method, "POST");
      assert.strictEqual(seen[0]?.url, "/api?x=1");
      assert.strictEqual(seen[0]?.headers["x-amz-target"], "Service.Op");
      assert.strictEqual(seen[0]?.body, '{"a":1}');
    });

    test(`${name}: a redirect is returned, never followed`, async () => {
      seen.length = 0;

      const response: CloudHttpResponse = await transport({
        method: "GET",
        url: `${base}/redirect`,
        headers: {},
        body: null,
        timeoutInMs: 5_000,
        maxResponseBytes: 1_000,
      });

      assert.strictEqual(response.status, 302);
      assert.strictEqual(
        response.headers["location"],
        "http://example.com/elsewhere",
      );
      assert.strictEqual(seen.length, 1);
    });

    test(`${name}: the answer is read up to its cap`, async () => {
      const response: CloudHttpResponse = await transport({
        method: "GET",
        url: `${base}/large`,
        headers: {},
        body: null,
        timeoutInMs: 5_000,
        maxResponseBytes: 100,
      });

      assert.strictEqual(response.body.length, 100);
      assert.strictEqual(response.truncated, true);
    });

    test(`${name}: no answer in time is a timeout (it may have been sent); no listener is a connect failure`, async () => {
      await assert.rejects(
        transport({
          method: "GET",
          url: `${base}/silent`,
          headers: {},
          body: null,
          timeoutInMs: 150,
          maxResponseBytes: 100,
        }),
        (err: unknown): boolean => {
          return (
            err instanceof CloudTransportError &&
            err.kind === "timeout" &&
            err.mayHaveBeenSent
          );
        },
      );
      await assert.rejects(
        transport({
          method: "GET",
          url: `http://127.0.0.1:${closedPort}/`,
          headers: {},
          body: null,
          timeoutInMs: 2_000,
          maxResponseBytes: 100,
        }),
        (err: unknown): boolean => {
          return (
            err instanceof CloudTransportError &&
            err.kind === "connect" &&
            !err.mayHaveBeenSent
          );
        },
      );
    });
  });

  test("cloudTransport sends plain http over the direct road", async () => {
    seen.length = 0;

    const response: CloudHttpResponse = await cloudTransport({
      method: "GET",
      url: `${base}/metadata`,
      headers: { "Metadata-Flavor": "Google" },
      body: null,
      timeoutInMs: 5_000,
      maxResponseBytes: 1_000,
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(seen[0]?.headers["metadata-flavor"], "Google");
  });
});
