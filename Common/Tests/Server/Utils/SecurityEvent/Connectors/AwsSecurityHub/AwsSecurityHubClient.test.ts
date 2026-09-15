import { describe, expect, test } from "@jest/globals";
import AwsSecurityHubClient, {
  AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
  AWS_SECURITY_HUB_MAX_PAGE_SIZE,
  AwsSecurityHubFailureKind,
  AwsSecurityHubFindingCount,
  AwsSecurityHubFindingsPage,
  AwsSecurityHubHttpError,
  AwsSigV4SignResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../../Types/JSON";

/*
 * The Security Hub client contract as the connector depends on it: the
 * hand-rolled Signature Version 4 signer checked against AWS's published
 * test-suite vectors, the GetFindings request (creation-time filter,
 * ascending order, page size, NextToken), the failure taxonomy per status
 * and AWS error code, and — above everything — that no credential can
 * leave through an error message. The transport is the injected seam;
 * nothing here touches the network.
 */

const REGION: string = "us-east-1";
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET_ACCESS_KEY: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const SESSION_TOKEN: string =
  "FwoGZXIvYXdzEBYaDHNlc3Npb24tdG9rZW4tZm9yLXRlc3RzLW9ubHktbm90LXJlYWwtdmFsdWU=";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");
const CLOCK: Date = new Date("2026-09-13T10:05:07.123Z");

/*
 * AWS Signature Version 4 test suite (the vectors AWS publishes for
 * signer implementations): access key AKIDEXAMPLE, secret
 * wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY, region us-east-1, service
 * "service", date 20150830T123600Z, host example.amazonaws.com.
 */
const SUITE_ACCESS_KEY_ID: string = "AKIDEXAMPLE";
const SUITE_SECRET: string = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const SUITE_DATE: Date = new Date("2015-08-30T12:36:00.000Z");
const SUITE_HOST: string = "example.amazonaws.com";
const SUITE_STS_TOKEN: string =
  "AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/qkPpKPi/kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38xVqr7ZD0u0iPPkUL64lIZbqBAz+scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA==";
const EMPTY_PAYLOAD_HASH: string =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  client: AwsSecurityHubClient;
}

function ok(body: JSONObject): DataSourceHttpResponse {
  return {
    statusCode: 200,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers: {},
  };
}

function status(
  code: number,
  body: string,
  headers: Record<string, string> = {},
): DataSourceHttpResponse {
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(body);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: code, bodyText: body, bodyJson, headers };
}

// The GuardDuty finding of the Security Hub integration reference, trimmed.
function finding(id: string): JSONObject {
  return {
    SchemaVersion: "2018-10-08",
    Id: `arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64/finding/${id}`,
    ProductArn: "arn:aws:securityhub:us-east-1::product/aws/guardduty",
    GeneratorId:
      "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64",
    AwsAccountId: "193043430472",
    Types: ["TTPs/Initial Access/UnauthorizedAccess:EC2-SSHBruteForce"],
    CreatedAt: "2026-09-12T12:34:34.146Z",
    UpdatedAt: "2026-09-12T12:34:34.146Z",
    Severity: { Label: "MEDIUM", Normalized: 40 },
    Title: "199.241.229.197 is performing SSH brute force attacks.",
    Resources: [
      {
        Type: "AwsEc2Instance",
        Id: "arn:aws:ec2:us-east-1:193043430472:instance/i-0c10c2c7863d1a356",
        Region: "us-east-1",
      },
    ],
    Workflow: { Status: "NEW" },
    RecordState: "ACTIVE",
  };
}

function awsError(type: string, message: string): string {
  return JSON.stringify({ __type: type, Message: message });
}

/*
 * Routes findings requests to scripted responders, consumed in order so a
 * test can script a sequence of pages or failures.
 */
function buildHarness(options: {
  responders?: Array<Responder>;
  requestTimeoutInMs?: number;
  sessionToken?: string;
  region?: string;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const responders: Array<Responder> = [...(options.responders || [])];

  const client: AwsSecurityHubClient = new AwsSecurityHubClient({
    region: options.region || REGION,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    sessionToken: options.sessionToken,
    requestTimeoutInMs: options.requestTimeoutInMs || 20000,
    now: (): Date => {
      return CLOCK;
    },
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      const responder: Responder | undefined = responders.shift();

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
  });

  return { requests, client };
}

function parsedBody(request: DataSourceHttpRequest): JSONObject {
  expect(typeof request.body).toBe("string");

  return JSON.parse(request.body as string) as JSONObject;
}

async function expectRejection(
  promise: Promise<unknown>,
): Promise<APIException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(APIException);
    return error as APIException;
  }

  throw new Error("Expected the call to reject.");
}

describe("AwsSecurityHubClient", () => {
  describe("construction and validation", () => {
    test("accepts documented Region codes and refuses anything that is not one", () => {
      for (const region of [
        "us-east-1",
        "us-gov-west-1",
        "ap-southeast-3",
        "eu-central-2",
        "il-central-1",
        "cn-north-1",
      ]) {
        expect(() => {
          AwsSecurityHubClient.validateRegion(region);
        }).not.toThrow();
      }

      for (const region of [
        "",
        "US-EAST-1",
        "us-east",
        "us east 1",
        "us-east-1/../x",
        "securityhub.us-east-1.amazonaws.com",
      ]) {
        expect(() => {
          AwsSecurityHubClient.validateRegion(region);
        }).toThrow(BadDataException);
      }
    });

    test("applies the IAM access key id shape", () => {
      expect(() => {
        AwsSecurityHubClient.validateAccessKeyId(ACCESS_KEY_ID);
      }).not.toThrow();
      expect(() => {
        AwsSecurityHubClient.validateAccessKeyId(` ${ACCESS_KEY_ID} `);
      }).not.toThrow();
      expect(() => {
        AwsSecurityHubClient.validateAccessKeyId("short");
      }).toThrow(BadDataException);
      expect(() => {
        AwsSecurityHubClient.validateAccessKeyId("AKIA/IOSFODNN7EXAMPLE");
      }).toThrow(BadDataException);
      expect(() => {
        AwsSecurityHubClient.validateAccessKeyId("");
      }).toThrow(BadDataException);
    });

    test("requires a secret access key and rejects a bad region before anything is contacted", () => {
      expect(() => {
        return new AwsSecurityHubClient({
          region: REGION,
          accessKeyId: ACCESS_KEY_ID,
          secretAccessKey: "",
          transport: (): Promise<DataSourceHttpResponse> => {
            throw new Error("must not be called");
          },
        });
      }).toThrow("Secret access key is required.");

      expect(() => {
        return new AwsSecurityHubClient({
          region: "nowhere",
          accessKeyId: ACCESS_KEY_ID,
          secretAccessKey: SECRET_ACCESS_KEY,
          transport: (): Promise<DataSourceHttpResponse> => {
            throw new Error("must not be called");
          },
        });
      }).toThrow(BadDataException);
    });

    test("builds the regional endpoint, with the China partition suffix for cn- regions", () => {
      expect(AwsSecurityHubClient.getEndpointHost("us-east-1")).toBe(
        "securityhub.us-east-1.amazonaws.com",
      );
      expect(AwsSecurityHubClient.getEndpointHost("us-gov-west-1")).toBe(
        "securityhub.us-gov-west-1.amazonaws.com",
      );
      expect(AwsSecurityHubClient.getEndpointHost("cn-north-1")).toBe(
        "securityhub.cn-north-1.amazonaws.com.cn",
      );
      expect(
        buildHarness({ region: "eu-west-2" }).client.getFindingsUrl(),
      ).toBe("https://securityhub.eu-west-2.amazonaws.com/findings");
    });

    test("clamps MaxResults to the documented maximum of 100 and never below one", () => {
      expect(AwsSecurityHubClient.clampPageSize(undefined)).toBe(
        AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
      );
      expect(AwsSecurityHubClient.clampPageSize(0)).toBe(
        AWS_SECURITY_HUB_DEFAULT_PAGE_SIZE,
      );
      expect(AwsSecurityHubClient.clampPageSize(-5)).toBe(1);
      expect(AwsSecurityHubClient.clampPageSize(0.5)).toBe(1);
      expect(AwsSecurityHubClient.clampPageSize(7.9)).toBe(7);
      expect(AwsSecurityHubClient.clampPageSize(5000)).toBe(
        AWS_SECURITY_HUB_MAX_PAGE_SIZE,
      );
      expect(AWS_SECURITY_HUB_MAX_PAGE_SIZE).toBe(100);
    });
  });

  describe("Signature Version 4 (AWS test-suite vectors)", () => {
    test("get-vanilla: canonical request, string to sign and signature match", () => {
      const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "GET",
        host: SUITE_HOST,
        path: "/",
        body: "",
        accessKeyId: SUITE_ACCESS_KEY_ID,
        secretAccessKey: SUITE_SECRET,
        region: "us-east-1",
        service: "service",
        date: SUITE_DATE,
      });

      expect(signed.amzDate).toBe("20150830T123600Z");
      expect(signed.canonicalRequest).toBe(
        `GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_PAYLOAD_HASH}`,
      );
      expect(signed.stringToSign).toBe(
        "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
      );
      expect(signed.headers["Authorization"]).toBe(
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
      );
    });

    test("post-vanilla: the method is part of the signature", () => {
      const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "POST",
        host: SUITE_HOST,
        path: "/",
        body: "",
        accessKeyId: SUITE_ACCESS_KEY_ID,
        secretAccessKey: SUITE_SECRET,
        region: "us-east-1",
        service: "service",
        date: SUITE_DATE,
      });

      expect(signed.stringToSign).toBe(
        "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n553f88c9e4d10fc9e109e2aeb65f030801b70c2f6468faca261d401ae622fc87",
      );
      expect(signed.signature).toBe(
        "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b",
      );
    });

    test("post-x-www-form-urlencoded: a body and a content-type header are hashed and signed", () => {
      const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "POST",
        host: SUITE_HOST,
        path: "/",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "Param1=value1",
        accessKeyId: SUITE_ACCESS_KEY_ID,
        secretAccessKey: SUITE_SECRET,
        region: "us-east-1",
        service: "service",
        date: SUITE_DATE,
      });

      expect(signed.canonicalRequest).toBe(
        "POST\n/\n\ncontent-type:application/x-www-form-urlencoded\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\ncontent-type;host;x-amz-date\n9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e",
      );
      expect(signed.headers["Authorization"]).toBe(
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
      );
    });

    test("post-header-key-sort: header names are lowercased and sorted, values trimmed", () => {
      const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "POST",
        host: SUITE_HOST,
        path: "/",
        headers: { "My-Header1": "  value1  " },
        body: "",
        accessKeyId: SUITE_ACCESS_KEY_ID,
        secretAccessKey: SUITE_SECRET,
        region: "us-east-1",
        service: "service",
        date: SUITE_DATE,
      });

      expect(signed.canonicalRequest).toBe(
        `POST\n/\n\nhost:example.amazonaws.com\nmy-header1:value1\nx-amz-date:20150830T123600Z\n\nhost;my-header1;x-amz-date\n${EMPTY_PAYLOAD_HASH}`,
      );
      expect(signed.signature).toBe(
        "c5410059b04c1ee005303aed430f6e6645f61f4dc9e1461ec8f8916fdf18852c",
      );
    });

    test("post-sts-header-before: a session token is signed as x-amz-security-token", () => {
      const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "POST",
        host: SUITE_HOST,
        path: "/",
        body: "",
        accessKeyId: SUITE_ACCESS_KEY_ID,
        secretAccessKey: SUITE_SECRET,
        sessionToken: SUITE_STS_TOKEN,
        region: "us-east-1",
        service: "service",
        date: SUITE_DATE,
      });

      expect(signed.stringToSign).toBe(
        "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nc237e1b440d4c63c32ca95b5b99481081cb7b13c7e40434868e71567c1a882f6",
      );
      expect(signed.headers["Authorization"]).toBe(
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=85d96828115b5dc0cfc3bd16ad9e210dd772bbebba041836c64533a82be05ead",
      );
      expect(signed.headers["X-Amz-Security-Token"]).toBe(SUITE_STS_TOKEN);
    });

    test("URI-encodes path segments and sorts encoded query parameters per AWS UriEncode", () => {
      expect(AwsSecurityHubClient.uriEncode("a b*c(d)!'~-_.")).toBe(
        "a%20b%2Ac%28d%29%21%27~-_.",
      );

      const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "GET",
        host: SUITE_HOST,
        path: "/a b/c",
        query: { "Z-key": "2", "a key": "x y", B: "" },
        body: "",
        accessKeyId: SUITE_ACCESS_KEY_ID,
        secretAccessKey: SUITE_SECRET,
        region: "us-east-1",
        service: "service",
        date: SUITE_DATE,
      });

      expect(signed.canonicalRequest.split("\n")[1]).toBe("/a%20b/c");
      expect(signed.canonicalRequest.split("\n")[2]).toBe(
        "B=&Z-key=2&a%20key=x%20y",
      );
    });

    test("formats x-amz-date without separators or fractional seconds", () => {
      expect(AwsSecurityHubClient.toAmzDate(CLOCK)).toBe("20260913T100507Z");
    });
  });

  describe("findings request", () => {
    test("posts a signed GetFindings for findings created in the window, oldest first, with MaxResults", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 4321,
        responders: [
          (): DataSourceHttpResponse => {
            return ok({ Findings: [finding("a")] });
          },
        ],
      });

      const page: AwsSecurityHubFindingsPage = await harness.client.getFindings(
        { startTime: START, endTime: END, maxResults: 25 },
      );

      expect(page.findings).toHaveLength(1);
      expect(page.nextToken).toBeNull();
      expect(harness.requests).toHaveLength(1);

      const request: DataSourceHttpRequest = harness.requests[0]!;
      expect(request.method).toBe("POST");
      expect(request.timeoutInMs).toBe(4321);

      const url: URL = new URL(request.url);
      expect(url.protocol).toBe("https:");
      expect(url.host).toBe("securityhub.us-east-1.amazonaws.com");
      expect(url.pathname).toBe("/findings");
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([]);

      expect(Object.keys(request.headers || {}).sort()).toEqual([
        "Authorization",
        "Content-Type",
        "X-Amz-Date",
      ]);
      expect(request.headers?.["Content-Type"]).toBe("application/json");
      expect(request.headers?.["X-Amz-Date"]).toBe("20260913T100507Z");
      expect(request.headers?.["Authorization"]).toMatch(
        new RegExp(
          `^AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/20260913/us-east-1/securityhub/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$`,
        ),
      );
      expect(request.formUrlEncoded).toBeFalsy();

      const body: JSONObject = parsedBody(request);
      expect(Object.keys(body).sort()).toEqual([
        "Filters",
        "MaxResults",
        "SortCriteria",
      ]);
      expect(body["Filters"]).toEqual({
        CreatedAt: [
          {
            Start: "2026-09-12T10:00:00.000Z",
            End: "2026-09-13T10:00:00.000Z",
          },
        ],
      });
      expect(body["SortCriteria"]).toEqual([
        { Field: "CreatedAt", SortOrder: "asc" },
      ]);
      expect(body["MaxResults"]).toBe(25);
    });

    test("signs the exact body string that is sent, so the transport cannot alter the payload hash", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return ok({ Findings: [] });
          },
        ],
      });

      await harness.client.getFindings({ startTime: START, endTime: END });

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const expected: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
        method: "POST",
        host: "securityhub.us-east-1.amazonaws.com",
        path: "/findings",
        headers: { "Content-Type": "application/json" },
        body: request.body as string,
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
        region: REGION,
        service: "securityhub",
        date: CLOCK,
      });

      expect(request.headers?.["Authorization"]).toBe(
        expected.headers["Authorization"],
      );
    });

    test("sends and signs the session token for temporary credentials", async () => {
      const harness: Harness = buildHarness({
        sessionToken: SESSION_TOKEN,
        responders: [
          (): DataSourceHttpResponse => {
            return ok({ Findings: [] });
          },
        ],
      });

      await harness.client.getFindings({ startTime: START, endTime: END });

      const request: DataSourceHttpRequest = harness.requests[0]!;
      expect(Object.keys(request.headers || {}).sort()).toEqual([
        "Authorization",
        "Content-Type",
        "X-Amz-Date",
        "X-Amz-Security-Token",
      ]);
      expect(request.headers?.["X-Amz-Security-Token"]).toBe(SESSION_TOKEN);
      expect(request.headers?.["Authorization"]).toContain(
        "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token,",
      );
    });

    test("uses the default page size of 100 and clamps larger requests", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return ok({ Findings: [] });
          },
          (): DataSourceHttpResponse => {
            return ok({ Findings: [] });
          },
        ],
      });

      await harness.client.getFindings({ startTime: START, endTime: END });
      await harness.client.getFindings({
        startTime: START,
        endTime: END,
        maxResults: 999,
      });

      expect(parsedBody(harness.requests[0]!)["MaxResults"]).toBe(100);
      expect(parsedBody(harness.requests[1]!)["MaxResults"]).toBe(100);
    });

    test("resends the same filter and sort with NextToken on the next page and stops when the last page has none", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return ok({ Findings: [finding("a")], NextToken: "page-2-token" });
          },
          (): DataSourceHttpResponse => {
            return ok({ Findings: [finding("b")], NextToken: "   " });
          },
        ],
      });

      const first: AwsSecurityHubFindingsPage =
        await harness.client.getFindings({ startTime: START, endTime: END });
      expect(first.nextToken).toBe("page-2-token");

      const second: AwsSecurityHubFindingsPage =
        await harness.client.getFindings({
          startTime: START,
          endTime: END,
          nextToken: first.nextToken,
        });
      expect(second.nextToken).toBeNull();
      expect(
        second.findings.map((item: JSONObject): JSONValue | undefined => {
          return item["Id"];
        }),
      ).toEqual([finding("b")["Id"]]);

      const body: JSONObject = parsedBody(harness.requests[1]!);
      expect(Object.keys(body).sort()).toEqual([
        "Filters",
        "MaxResults",
        "NextToken",
        "SortCriteria",
      ]);
      expect(body["NextToken"]).toBe("page-2-token");
      expect(body["Filters"]).toEqual(
        parsedBody(harness.requests[0]!)["Filters"],
      );
      expect(harness.client.getRequestCount()).toBe(2);
    });

    test("drops non-object entries from Findings rather than failing the page", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return ok({
              Findings: [finding("a"), null, "junk", 7, [finding("b")]],
            } as unknown as JSONObject);
          },
        ],
      });

      const page: AwsSecurityHubFindingsPage = await harness.client.getFindings(
        { startTime: START, endTime: END },
      );

      expect(page.findings).toHaveLength(1);
    });

    test("counts one bounded page and reports whether more exist", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return ok({
              Findings: [finding("a"), finding("b")],
              NextToken: "more",
            });
          },
          (): DataSourceHttpResponse => {
            return ok({ Findings: [] });
          },
        ],
      });

      const withMore: AwsSecurityHubFindingCount =
        await harness.client.countFindingsCreated({
          startTime: START,
          endTime: END,
          maxResults: 2,
        });
      const none: AwsSecurityHubFindingCount =
        await harness.client.countFindingsCreated({
          startTime: START,
          endTime: END,
        });

      expect(withMore).toEqual({ count: 2, hasMore: true });
      expect(none).toEqual({ count: 0, hasMore: false });
      expect(parsedBody(harness.requests[0]!)["MaxResults"]).toBe(2);
      expect(parsedBody(harness.requests[1]!)["MaxResults"]).toBe(100);
    });
  });

  describe("failure taxonomy", () => {
    test("names the step and the status on AccessDeniedException and hints at securityhub:GetFindings", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                Message:
                  "User: arn:aws:iam::193043430472:user/oneuptime is not authorized to perform: securityhub:GetFindings on resource: arn:aws:securityhub:us-east-1:193043430472:hub/default",
              }),
              { "x-amzn-errortype": "AccessDeniedException" },
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("not authorized to perform");
      expect(error.message).toContain("securityhub:GetFindings");
      expect(error.message).toContain("AWSSecurityHubReadOnlyAccess");
    });

    test("reads the error code from the body __type when there is no header, namespace-qualified or not", () => {
      expect(
        AwsSecurityHubClient.errorCode({
          bodyJson: {
            __type: "com.amazon.coral.service#UnrecognizedClientException",
          },
        }),
      ).toBe("UnrecognizedClientException");
      expect(
        AwsSecurityHubClient.errorCode({
          bodyJson: { Code: "InvalidSignatureException" },
        }),
      ).toBe("InvalidSignatureException");
      expect(
        AwsSecurityHubClient.errorCode({
          bodyJson: {},
          headers: {
            "x-amzn-errortype":
              "AccessDeniedException:http://internal.amazon.com/coral/com.amazonaws.securityhub/",
          },
        }),
      ).toBe("AccessDeniedException");
      expect(AwsSecurityHubClient.errorCode({ bodyJson: "nope" })).toBe("");
    });

    test("tells an unrecognized access key apart from a wrong secret and from an expired token", async () => {
      const cases: Array<[string, string, string]> = [
        [
          "UnrecognizedClientException",
          "The security token included in the request is invalid.",
          "does not recognize the Access key ID",
        ],
        [
          "InvalidSignatureException",
          "The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method.",
          "Secret access key does not match",
        ],
        [
          "ExpiredTokenException",
          "The security token included in the request is expired",
          "temporary credentials have expired",
        ],
        /*
         * This case used to expect the wrong-secret hint. "Signature
         * expired" shares InvalidSignatureException with a wrong secret but
         * means the host clock is off (review finding
         * aws-signature-errors-reported-as-iam-permission), so the hint now
         * points at NTP.
         */
        [
          "InvalidSignatureException",
          "Signature expired: 20260913T100507Z is now earlier than 20260913T101000Z (20260913T101500Z - 5 min.)",
          "Fix NTP",
        ],
      ];

      for (const [code, message, hint] of cases) {
        const harness: Harness = buildHarness({
          responders: [
            (): DataSourceHttpResponse => {
              return status(403, awsError(code, message));
            },
          ],
        });

        const error: APIException = await expectRejection(
          harness.client.getFindings({ startTime: START, endTime: END }),
        );

        expect(error.message).toMatch(
          /^AWS Security Hub findings request failed \(HTTP 403\): /,
        );
        expect(error.message).toContain(code);
        expect(error.message).toContain(hint);
        expect(error).toBeInstanceOf(AwsSecurityHubHttpError);
        expect((error as AwsSecurityHubHttpError).failureKind).toBe(
          "authentication",
        );
      }
    });

    /*
     * Review finding aws-signature-errors-reported-as-iam-permission: the
     * production transport throws "Data source responded with HTTP <n>:
     * <body>" and drops x-amzn-errortype, and a signature rejection's body
     * is only {"message": ...}. The code is recovered from AWS's wording,
     * so these are authentication failures with the key or clock hint,
     * never "the credentials are valid" with IAM guidance.
     */
    test.each<
      [string, number, string, string, AwsSecurityHubFailureKind, string]
    >([
      [
        "a wrong secret",
        403,
        "The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method.",
        "InvalidSignatureException",
        "authentication",
        "Secret access key does not match",
      ],
      [
        "an unknown key or stray session token",
        403,
        "The security token included in the request is invalid.",
        "UnrecognizedClientException",
        "authentication",
        "does not recognize the Access key ID",
      ],
      [
        "an expired session token",
        403,
        "The security token included in the request is expired",
        "ExpiredTokenException",
        "authentication",
        "temporary credentials have expired",
      ],
      [
        "an expired signature",
        403,
        "Signature expired: 20260913T100507Z is now earlier than 20260913T101000Z (20260913T101500Z - 5 min.)",
        "InvalidSignatureException",
        "authentication",
        "Fix NTP",
      ],
      [
        "an IAM denial",
        403,
        "User: arn:aws:iam::193043430472:user/oneuptime is not authorized to perform: securityhub:GetFindings",
        "AccessDeniedException",
        "authorization",
        "AWSSecurityHubReadOnlyAccess",
      ],
      [
        "a 403 that names nothing",
        403,
        "Forbidden",
        "",
        "other",
        "without naming an error code",
      ],
    ])(
      "classifies %s behind the production transport",
      async (
        _label: string,
        httpStatus: number,
        awsMessage: string,
        expectedCode: string,
        expectedKind: AwsSecurityHubFailureKind,
        hint: string,
      ) => {
        const harness: Harness = buildHarness({
          responders: [
            (): Promise<DataSourceHttpResponse> => {
              throw new BadDataException(
                `Data source responded with HTTP ${httpStatus}: ${JSON.stringify(
                  {
                    message: awsMessage,
                  },
                )}`,
              );
            },
          ],
        });

        const error: APIException = await expectRejection(
          harness.client.getFindings({ startTime: START, endTime: END }),
        );

        expect(error).toBeInstanceOf(AwsSecurityHubHttpError);

        const httpError: AwsSecurityHubHttpError =
          error as AwsSecurityHubHttpError;
        expect(httpError.statusCode).toBe(httpStatus);
        expect(httpError.errorCode).toBe(expectedCode);
        expect(httpError.failureKind).toBe(expectedKind);
        expect(error.message).toMatch(
          new RegExp(
            `^AWS Security Hub findings request failed \\(HTTP ${httpStatus}\\): `,
          ),
        );
        expect(error.message).toContain(hint);

        if (expectedKind !== "authorization") {
          expect(error.message).not.toContain("verified the signature");
          expect(error.message).not.toContain("AWSSecurityHubReadOnlyAccess");
        }
      },
    );

    test("classifies InvalidAccessException as authorization at the 401 the API reference documents", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): Promise<DataSourceHttpResponse> => {
            throw new BadDataException(
              `Data source responded with HTTP 401: ${JSON.stringify({
                Code: "InvalidAccessException",
                Message:
                  "Account 193043430472 is not subscribed to AWS Security Hub",
              })}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect((error as AwsSecurityHubHttpError).errorCode).toBe(
        "InvalidAccessException",
      );
      expect((error as AwsSecurityHubHttpError).failureKind).toBe(
        "authorization",
      );
      expect(error.message).toContain("Security Hub is not enabled");
      expect(error.message).not.toContain("AWS refused the credentials");
    });

    test("a declared code wins over the message wording, and wording is only a fallback", () => {
      expect(
        AwsSecurityHubClient.errorCode({
          bodyJson: {
            __type: "AccessDeniedException",
            message: "The security token included in the request is invalid.",
          },
        }),
      ).toBe("AccessDeniedException");
      expect(
        AwsSecurityHubClient.errorCode({
          bodyJson: undefined,
          bodyText:
            "<html>The request signature we calculated does not match</html>",
        }),
      ).toBe("InvalidSignatureException");
      expect(
        AwsSecurityHubClient.errorCodeFromMessage(
          "The security token included in the request is expired",
        ),
      ).toBe("ExpiredTokenException");
      expect(
        AwsSecurityHubClient.errorCodeFromMessage("Service Unavailable"),
      ).toBe("");
    });

    test("only AccessDeniedException and InvalidAccessException are authorization failures", () => {
      const cases: Array<[number, string, AwsSecurityHubFailureKind]> = [
        [403, "AccessDeniedException", "authorization"],
        [401, "InvalidAccessException", "authorization"],
        [403, "InvalidAccessException", "authorization"],
        [403, "InvalidSignatureException", "authentication"],
        [403, "UnrecognizedClientException", "authentication"],
        [400, "IncompleteSignatureException", "authentication"],
        [401, "", "authentication"],
        [403, "", "other"],
        [429, "LimitExceededException", "other"],
        [500, "InternalException", "other"],
      ];

      for (const [httpStatus, code, kind] of cases) {
        expect(AwsSecurityHubClient.classifyFailure(httpStatus, code)).toBe(
          kind,
        );
      }
    });

    test("hints at the server clock for a skewed request time", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              awsError(
                "RequestTimeTooSkewed",
                "The difference between the request time and the current time is too large.",
              ),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toContain("Fix NTP");
    });

    test("hints at enabling Security Hub on InvalidAccessException", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              awsError(
                "InvalidAccessException",
                "Account 193043430472 is not subscribed to AWS Security Hub",
              ),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("Security Hub is not enabled");
    });

    test("reports 401, 400, 404, throttling (429) and server-side failures (5xx) with their own hints", async () => {
      const cases: Array<[number, string, string]> = [
        [401, "", "AWS refused the credentials"],
        [
          400,
          awsError("InvalidInputException", "Invalid filter"),
          "report this message to OneUptime support",
        ],
        [404, "<html>not found</html>", "Check the Region code"],
        [
          429,
          awsError("LimitExceededException", "Rate exceeded"),
          "throttling GetFindings (3 requests per second",
        ],
        [
          500,
          awsError("InternalException", "Internal error"),
          "server-side problem",
        ],
        [503, "Service Unavailable", "server-side problem"],
      ];

      for (const [code, body, hint] of cases) {
        const harness: Harness = buildHarness({
          responders: [
            (): DataSourceHttpResponse => {
              return status(code, body);
            },
          ],
        });

        const error: APIException = await expectRejection(
          harness.client.getFindings({ startTime: START, endTime: END }),
        );

        expect(error.message).toMatch(
          new RegExp(
            `^AWS Security Hub findings request failed \\(HTTP ${code}\\): `,
          ),
        );
        expect(error.message).toContain(hint);
      }
    });

    test("describes an empty error body instead of printing nothing", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return status(502, "");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toContain("(empty response body)");
    });

    test("recovers the status from the production transport's thrown error", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): Promise<DataSourceHttpResponse> => {
            throw new BadDataException(
              `Data source responded with HTTP 403: ${awsError(
                "AccessDeniedException",
                "not authorized to perform: securityhub:GetFindings",
              )}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("AccessDeniedException");
    });

    test("surfaces a transport failure without a status under the step prefix", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): Promise<DataSourceHttpResponse> => {
            throw new BadDataException(
              "Could not reach data source: getaddrinfo ENOTFOUND securityhub.us-east-1.amazonaws.com",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        "AWS Security Hub findings request failed: Could not reach data source: getaddrinfo ENOTFOUND securityhub.us-east-1.amazonaws.com",
      );
    });

    test("gives up on a transport that never settles once the request timeout elapses", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 30,
        responders: [
          (): Promise<DataSourceHttpResponse> => {
            return new Promise<DataSourceHttpResponse>((): void => {
              // Never resolves: simulates a socket that neither answers nor closes.
            });
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^AWS Security Hub findings request timed out after \d+ seconds with no response\.$/,
      );
    });

    test("reports a non-JSON 200 body without guessing", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return status(200, "<html><title>Sign in</title></html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^AWS Security Hub findings request returned a non-JSON body: /,
      );
      expect(error.message).toContain("Sign in");
    });

    test("reports a JSON body without a Findings array, and a JSON array body, as unrecognized shapes", async () => {
      const objectHarness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return ok({ Results: [], Marker: "x" });
          },
        ],
      });
      const objectError: APIException = await expectRejection(
        objectHarness.client.getFindings({ startTime: START, endTime: END }),
      );
      expect(objectError.message).toBe(
        'AWS Security Hub findings request returned an unrecognized response shape: expected a "Findings" array, received keys Results, Marker.',
      );

      const arrayHarness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return status(200, "[]");
          },
        ],
      });
      const arrayError: APIException = await expectRejection(
        arrayHarness.client.getFindings({ startTime: START, endTime: END }),
      );
      expect(arrayError.message).toBe(
        "AWS Security Hub findings request returned an unrecognized response shape: expected a JSON object, received an array.",
      );
    });
  });

  describe("redaction", () => {
    test("never echoes the secret access key, session token or access key id that a body reflects back", async () => {
      const harness: Harness = buildHarness({
        sessionToken: SESSION_TOKEN,
        responders: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                __type: "InvalidSignatureException",
                Message: `The request signature we calculated does not match. AccessKeyId=${ACCESS_KEY_ID} SecretAccessKey=${SECRET_ACCESS_KEY}`,
                SecretAccessKey: SECRET_ACCESS_KEY,
                SessionToken: SESSION_TOKEN,
                Authorization: `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/20260913/us-east-1/securityhub/aws4_request, SignedHeaders=host, Signature=abc`,
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getFindings({ startTime: START, endTime: END }),
      );

      expect(error.message).toContain("InvalidSignatureException");
      expect(error.message).not.toContain(SECRET_ACCESS_KEY);
      expect(error.message).not.toContain(SESSION_TOKEN);
      expect(error.message).not.toContain(ACCESS_KEY_ID);
      expect(error.message).toContain("[REDACTED]");
    });

    test("redacts credentials reflected in a non-JSON body and in a transport error", async () => {
      const textHarness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return status(
              500,
              `gateway error while forwarding secret_access_key=${SECRET_ACCESS_KEY}`,
            );
          },
        ],
      });
      const textError: APIException = await expectRejection(
        textHarness.client.getFindings({ startTime: START, endTime: END }),
      );
      expect(textError.message).not.toContain(SECRET_ACCESS_KEY);

      const transportHarness: Harness = buildHarness({
        responders: [
          (): Promise<DataSourceHttpResponse> => {
            throw new Error(
              `proxy refused x-amz-security-token: ${SESSION_TOKEN}`,
            );
          },
        ],
      });
      const transportError: APIException = await expectRejection(
        transportHarness.client.getFindings({ startTime: START, endTime: END }),
      );
      expect(transportError.message).toMatch(
        /^AWS Security Hub findings request failed: /,
      );
      expect(transportError.message).not.toContain(SESSION_TOKEN);
    });
  });
});
