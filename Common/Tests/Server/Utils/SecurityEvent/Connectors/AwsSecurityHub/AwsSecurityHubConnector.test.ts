import { describe, expect, jest, test } from "@jest/globals";
import AwsSecurityHubConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubConnector";
import AwsSecurityHubClient, {
  AWS_SECURITY_HUB_SERVICE,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import {
  ConnectorFetchResult,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import AwsSecurityHubNormalizer from "../../../../../../Utils/SecurityEvent/Connectors/AwsSecurityHubNormalizer";

/*
 * The AWS Security Hub connector as the framework calls it: settings
 * validation keyed by the catalog's field titles, the three test checks
 * and their remediation per AWS failure mode (a signature rejection is an
 * authentication failure, an AccessDenied after a verified signature is a
 * permission failure), and a creation-time fetch that follows NextToken,
 * respects the request and event bounds, accounts rejected and failed
 * records, signs every request with Signature Version 4 over the exact
 * body it sends, and never leaks the secret access key or session token.
 */

const REGION: string = "us-east-1";
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const TEMPORARY_ACCESS_KEY_ID: string = "ASIAIOSFODNN7EXAMPLE";
const SECRET_ACCESS_KEY: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const SESSION_TOKEN: string =
  "FwoGZXIvYXdzEBYaDHNlc3Npb24tdG9rZW4tZm9yLXRlc3RzLW9ubHktbm90LXJlYWwtdmFsdWU=";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  connector: AwsSecurityHubConnector;
}

function settings(
  overrides: Partial<SecurityConnectorSettings> = {},
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.AwsSecurityHub,
    config: { region: REGION, accessKeyId: ACCESS_KEY_ID },
    secrets: { secretAccessKey: SECRET_ACCESS_KEY },
    alertingOnly: false,
    ...overrides,
  };
}

function temporarySettings(): SecurityConnectorSettings {
  return settings({
    config: { region: REGION, accessKeyId: TEMPORARY_ACCESS_KEY_ID },
    secrets: {
      secretAccessKey: SECRET_ACCESS_KEY,
      sessionToken: SESSION_TOKEN,
    },
  });
}

function status(code: number, body: string): DataSourceHttpResponse {
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(body);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: code, bodyText: body, bodyJson, headers: {} };
}

function awsError(type: string, message: string): string {
  return JSON.stringify({ __type: type, Message: message });
}

function page(
  findings: Array<JSONObject>,
  nextToken?: string | undefined,
): DataSourceHttpResponse {
  return status(
    200,
    JSON.stringify({
      Findings: findings,
      ...(nextToken ? { NextToken: nextToken } : {}),
    }),
  );
}

// A GuardDuty finding as GetFindings returns it (ASFF), keyed by suffix.
function guardDutyFinding(suffix: string): JSONObject {
  return {
    SchemaVersion: "2018-10-08",
    Id: `arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64/finding/${suffix}`,
    ProductArn: "arn:aws:securityhub:us-east-1::product/aws/guardduty",
    ProductName: "GuardDuty",
    CompanyName: "Amazon",
    GeneratorId:
      "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64",
    AwsAccountId: "193043430472",
    Region: "us-east-1",
    Types: ["TTPs/Initial Access/UnauthorizedAccess:EC2-SSHBruteForce"],
    FirstObservedAt: "2026-09-12T12:20:00Z",
    LastObservedAt: "2026-09-12T12:33:49Z",
    CreatedAt: "2026-09-12T12:34:34.146Z",
    UpdatedAt: "2026-09-12T12:34:34.146Z",
    Severity: { Product: 2, Label: "MEDIUM", Normalized: 40 },
    Title: `199.241.229.197 is performing SSH brute force attacks against i-${suffix}.`,
    Description:
      "Brute force attacks are used to gain unauthorized access to your instance by guessing the SSH password.",
    Resources: [
      {
        Type: "AwsEc2Instance",
        Id: `arn:aws:ec2:us-east-1:193043430472:instance/i-${suffix}`,
        Partition: "aws",
        Region: "us-east-1",
      },
    ],
    WorkflowState: "NEW",
    Workflow: { Status: "NEW" },
    RecordState: "ACTIVE",
  };
}

// A Security Hub control finding: Compliance present, so class 2003.
function controlFinding(): JSONObject {
  return {
    SchemaVersion: "2018-10-08",
    Id: "arn:aws:securityhub:eu-central-1:123456789012:security-control/IAM.9/finding/5a3c1b0e-9b7c-4b1e-8d4a-2b3c4d5e6f70",
    ProductArn: "arn:aws:securityhub:eu-central-1::product/aws/securityhub",
    ProductName: "Security Hub",
    CompanyName: "AWS",
    GeneratorId: "security-control/IAM.9",
    AwsAccountId: "123456789012",
    Region: "eu-central-1",
    Types: [
      "Software and Configuration Checks/Industry and Regulatory Standards",
    ],
    FirstObservedAt: "2026-09-12T14:11:09.501Z",
    CreatedAt: "2026-09-12T14:11:09.501Z",
    UpdatedAt: "2026-09-12T14:11:09.501Z",
    Severity: { Label: "CRITICAL", Normalized: 90, Original: "CRITICAL" },
    Title: "IAM.9 MFA should be enabled for the root user",
    Description:
      "This AWS control checks whether your AWS account is enabled to use a multi-factor authentication (MFA) device to sign in with root user credentials.",
    Resources: [
      {
        Type: "AwsAccount",
        Id: "AWS::::Account:123456789012",
        Partition: "aws",
        Region: "eu-central-1",
      },
    ],
    Compliance: {
      Status: "FAILED",
      SecurityControlId: "IAM.9",
      AssociatedStandards: [
        {
          StandardsId:
            "standards/aws-foundational-security-best-practices/v/1.0.0",
        },
      ],
    },
    Workflow: { Status: "NOTIFIED" },
    RecordState: "ACTIVE",
  };
}

/*
 * Routes every findings request to scripted responders, consumed in
 * order, so a test can script pages, counts and failures in sequence.
 */
function buildHarness(responders: Array<Responder> = []): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const queue: Array<Responder> = [...responders];

  const connector: AwsSecurityHubConnector = new AwsSecurityHubConnector(
    async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      const responder: Responder | undefined = queue.shift();

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
  );

  return { requests, connector };
}

function checkByKey(
  checks: Array<SecurityConnectorCheck>,
  key: string,
): SecurityConnectorCheck {
  const check: SecurityConnectorCheck | undefined = checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );

  if (!check) {
    throw new Error(`Missing check ${key}`);
  }

  return check;
}

function statuses(checks: Array<SecurityConnectorCheck>): Array<string> {
  return checks.map((check: SecurityConnectorCheck): string => {
    return `${check.key}:${check.status}`;
  });
}

function parsedBody(request: DataSourceHttpRequest): JSONObject {
  expect(typeof request.body).toBe("string");

  return JSON.parse(request.body as string) as JSONObject;
}

function createdAtFilter(body: JSONObject): JSONObject {
  const filters: JSONObject = body["Filters"] as JSONObject;
  const createdAt: Array<JSONObject> = filters[
    "CreatedAt"
  ] as Array<JSONObject>;

  expect(createdAt).toHaveLength(1);

  return createdAt[0]!;
}

// YYYYMMDDTHHMMSSZ (x-amz-date) back to a Date.
function dateFromAmzDate(amzDate: string): Date {
  expect(amzDate).toMatch(/^\d{8}T\d{6}Z$/);

  return new Date(
    `${amzDate.substring(0, 4)}-${amzDate.substring(4, 6)}-${amzDate.substring(
      6,
      8,
    )}T${amzDate.substring(9, 11)}:${amzDate.substring(11, 13)}:${amzDate.substring(
      13,
      15,
    )}Z`,
  );
}

/*
 * A request is correctly signed when re-signing the exact body and
 * headers it carries, for the date it declares, reproduces its
 * Authorization header byte for byte. This checks the connector wired the
 * region, service, key, secret and token into the signer, and that the
 * transport receives the same string that was hashed.
 */
function expectSigned(
  request: DataSourceHttpRequest,
  options: {
    region?: string;
    accessKeyId?: string;
    sessionToken?: string;
  } = {},
): void {
  const headers: Dictionary<string> = request.headers || {};
  const url: URL = new URL(request.url);
  const region: string = options.region || REGION;
  const accessKeyId: string = options.accessKeyId || ACCESS_KEY_ID;

  expect(request.method).toBe("POST");
  expect(url.protocol).toBe("https:");
  expect(url.host).toBe(`securityhub.${region}.amazonaws.com`);
  expect(url.pathname).toBe("/findings");
  expect([...url.searchParams.keys()].sort()).toEqual([]);
  expect(headers["Content-Type"]).toBe("application/json");

  const amzDate: string = headers["X-Amz-Date"] || "";
  const expected: string = AwsSecurityHubClient.signRequest({
    method: "POST",
    host: url.host,
    path: url.pathname,
    headers: { "Content-Type": "application/json" },
    body: request.body as string,
    accessKeyId,
    secretAccessKey: SECRET_ACCESS_KEY,
    sessionToken: options.sessionToken,
    region,
    service: AWS_SECURITY_HUB_SERVICE,
    date: dateFromAmzDate(amzDate),
  }).headers["Authorization"]!;

  expect(headers["Authorization"]).toBe(expected);
  expect(headers["Authorization"]).toMatch(
    new RegExp(
      `^AWS4-HMAC-SHA256 Credential=${accessKeyId}/\\d{8}/${region}/securityhub/aws4_request, SignedHeaders=content-type;host;x-amz-date${
        options.sessionToken ? ";x-amz-security-token" : ""
      }, Signature=[0-9a-f]{64}$`,
    ),
  );

  if (options.sessionToken) {
    expect(headers["X-Amz-Security-Token"]).toBe(options.sessionToken);
  } else {
    expect(headers["X-Amz-Security-Token"]).toBeUndefined();
  }
}

function fetchOptions(
  overrides: Partial<{
    maxRequests: number;
    maxEvents: number;
    requestTimeoutInMs: number;
    sampleLimit: number;
  }> = {},
): {
  maxRequests: number;
  maxEvents: number;
  requestTimeoutInMs: number;
  sampleLimit: number;
} {
  return {
    maxRequests: 20,
    maxEvents: 10000,
    requestTimeoutInMs: 30000,
    sampleLimit: 5,
    ...overrides,
  };
}

async function expectRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }

  throw new Error("Expected the call to reject.");
}

describe("AwsSecurityHubConnector", () => {
  const definition: SecurityEventConnectorDefinition =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.AwsSecurityHub,
    )!;

  test("registers under the catalog's provider key", () => {
    expect(new AwsSecurityHubConnector().provider).toBe("aws-security-hub");
    expect(definition.provider).toBe(new AwsSecurityHubConnector().provider);
  });

  test("the catalog's field keys are the ones the connector reads", () => {
    expect(
      definition.configFields.map((field: { key: string }): string => {
        return field.key;
      }),
    ).toEqual(["region", "accessKeyId"]);
    expect(
      definition.secretFields.map((field: { key: string }): string => {
        return field.key;
      }),
    ).toEqual(["secretAccessKey", "sessionToken"]);
  });

  describe("validateSettings", () => {
    test("accepts a long-lived access key without a session token", () => {
      expect(() => {
        return new AwsSecurityHubConnector().validateSettings(settings());
      }).not.toThrow();
    });

    test("accepts a temporary access key with its session token", () => {
      expect(() => {
        return new AwsSecurityHubConnector().validateSettings(
          temporarySettings(),
        );
      }).not.toThrow();
    });

    test("accepts a Region in any letter case", () => {
      expect(() => {
        return new AwsSecurityHubConnector().validateSettings(
          settings({
            config: { region: "EU-Central-1", accessKeyId: ACCESS_KEY_ID },
          }),
        );
      }).not.toThrow();
    });

    test("refuses settings for another provider", () => {
      expect(() => {
        return new AwsSecurityHubConnector().validateSettings(
          settings({
            provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
          }),
        );
      }).toThrow(
        /^Settings are for provider "splunk", not AWS Security Hub\.$/,
      );
    });

    test("names the catalog field titles in every rejection", () => {
      const connector: AwsSecurityHubConnector = new AwsSecurityHubConnector();

      expect(() => {
        return connector.validateSettings(
          settings({ config: { accessKeyId: ACCESS_KEY_ID } }),
        );
      }).toThrow(/^Region must be an AWS Region code/);

      expect(() => {
        return connector.validateSettings(
          settings({
            config: {
              region: "securityhub.us-east-1.amazonaws.com",
              accessKeyId: ACCESS_KEY_ID,
            },
          }),
        );
      }).toThrow(BadDataException);

      expect(() => {
        return connector.validateSettings(
          settings({ config: { region: REGION } }),
        );
      }).toThrow(/^Access key ID must be 16-128 letters or digits/);

      expect(() => {
        return connector.validateSettings(
          settings({ config: { region: REGION, accessKeyId: "AKIA/short" } }),
        );
      }).toThrow(BadDataException);

      expect(() => {
        return connector.validateSettings(settings({ secrets: {} }));
      }).toThrow("Secret access key is required.");

      expect(() => {
        return connector.validateSettings(
          settings({
            config: { region: REGION, accessKeyId: TEMPORARY_ACCESS_KEY_ID },
          }),
        );
      }).toThrow(
        "Session token is required for a temporary access key (an Access key ID starting with ASIA).",
      );
    });
  });

  describe("testConnection", () => {
    test("passes all three checks with one signed probe and two bounded counts", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("0c10c2c7863d1a356")]);
        },
        (): DataSourceHttpResponse => {
          return page([
            guardDutyFinding("a"),
            guardDutyFinding("b"),
            controlFinding(),
          ]);
        },
        (): DataSourceHttpResponse => {
          return page(
            Array.from({ length: 100 }, (_value: unknown, index: number) => {
              return guardDutyFinding(`week-${index}`);
            }),
            "AQICAHhNextPageToken",
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 15000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:pass",
      ]);

      const authentication: SecurityConnectorCheck = checkByKey(
        checks,
        "authentication",
      );
      expect(authentication.name).toBe("Authenticate with AWS");
      expect(authentication.message).toContain("Signature Version 4");
      expect(authentication.message).toContain(REGION);

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.name).toBe("Read findings");
      expect(read.message).toContain("securityhub:GetFindings");
      expect(read.details).toEqual({ region: REGION, sampleFindingCount: 1 });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.name).toBe("Findings available to import");
      expect(available.message).toBe(
        "3 findings created in the last 24 hours and 100+ in the last 7 days.",
      );
      expect(available.details).toEqual({
        createdLast24h: 3,
        hasMoreLast24h: false,
        createdLast7d: 100,
        hasMoreLast7d: true,
      });
      expect(available.remediation).toBeUndefined();

      // One probe for a single finding, then the two counts at a full page.
      expect(harness.requests).toHaveLength(3);
      expect(parsedBody(harness.requests[0]!)["MaxResults"]).toBe(1);
      expect(parsedBody(harness.requests[1]!)["MaxResults"]).toBe(100);
      expect(parsedBody(harness.requests[2]!)["MaxResults"]).toBe(100);

      for (const request of harness.requests) {
        expectSigned(request);
        expect(request.timeoutInMs).toBe(15000);

        const body: JSONObject = parsedBody(request);
        expect(Object.keys(body).sort()).toEqual([
          "Filters",
          "MaxResults",
          "SortCriteria",
        ]);
        expect(body["SortCriteria"]).toEqual([
          { Field: "CreatedAt", SortOrder: "asc" },
        ]);
      }

      // The probe and the first count cover a day; the second count a week.
      const probeWindow: JSONObject = createdAtFilter(
        parsedBody(harness.requests[0]!),
      );
      const weekWindow: JSONObject = createdAtFilter(
        parsedBody(harness.requests[2]!),
      );
      const dayInMs: number = 24 * 60 * 60 * 1000;
      expect(
        new Date(String(probeWindow["End"])).getTime() -
          new Date(String(probeWindow["Start"])).getTime(),
      ).toBe(dayInMs);
      expect(
        new Date(String(weekWindow["End"])).getTime() -
          new Date(String(weekWindow["Start"])).getTime(),
      ).toBe(7 * dayInMs);
    });

    test("uses the singular when exactly one finding was created", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([]);
        },
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("only")]);
        },
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("only")]);
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(checkByKey(checks, "read-permission").message).toContain(
        "no finding was created in the last 24 hours",
      );
      expect(checkByKey(checks, "detections-available").message).toBe(
        "1 finding created in the last 24 hours and 1 in the last 7 days.",
      );
    });

    test("warns instead of passing when nothing was created in the last 7 days", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([]);
        },
        (): DataSourceHttpResponse => {
          return page([]);
        },
        (): DataSourceHttpResponse => {
          return page([]);
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:warn",
      ]);

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toContain(
        "No findings were created in the last 7 days",
      );
      expect(available.remediation).toContain("GuardDuty");
      expect(available.remediation).toContain("administrator");
    });

    test("fails authentication on an invalid setting without contacting AWS", async () => {
      const harness: Harness = buildHarness();

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings({ secrets: {} }), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);
      expect(checks[0]!.message).toBe("Secret access key is required.");
      expect(checks[0]!.remediation).toContain("Nothing was contacted");
      expect(checks[1]!.message).toContain("configuration is not usable");
      expect(harness.requests).toHaveLength(0);
    });

    test("fails authentication for a temporary key without its session token, naming the field", async () => {
      const harness: Harness = buildHarness();

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({
            config: { region: REGION, accessKeyId: TEMPORARY_ACCESS_KEY_ID },
          }),
          { requestTimeoutInMs: 1000 },
        );

      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toContain("Session token is required");
      expect(harness.requests).toHaveLength(0);
    });

    test("fails authentication on a rejected signature, skips the rest, and points at IAM security credentials", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            403,
            awsError(
              "InvalidSignatureException",
              `The request signature we calculated does not match the signature you provided. SecretAccessKey=${SECRET_ACCESS_KEY}`,
            ),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);
      expect(checks[0]!.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 403\): /,
      );
      expect(checks[0]!.message).toContain("InvalidSignatureException");
      expect(checks[0]!.message).toContain("Secret access key does not match");
      expect(checks[0]!.message).not.toContain(SECRET_ACCESS_KEY);
      expect(checks[0]!.remediation).toContain("Security credentials");
      expect(checks[1]!.message).toContain("authentication failed");
      expect(harness.requests).toHaveLength(1);
    });

    test("fails authentication on an unrecognized access key with the key hint", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            403,
            awsError(
              "UnrecognizedClientException",
              "The security token included in the request is invalid.",
            ),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)[0]).toBe("authentication:fail");
      expect(checks[0]!.message).toContain(
        "AWS does not recognize the Access key ID",
      );
    });

    test("fails authentication on expired temporary credentials with the STS remediation", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            403,
            awsError(
              "ExpiredTokenException",
              "The security token included in the request is expired",
            ),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(temporarySettings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)[0]).toBe("authentication:fail");
      expect(checks[0]!.remediation).toContain("expired");
      expect(checks[0]!.remediation).toContain("STS");
      expect(JSON.stringify(checks)).not.toContain(SESSION_TOKEN);
      expect(JSON.stringify(checks)).not.toContain(SECRET_ACCESS_KEY);
    });

    test("fails authentication on a skewed request time with the NTP remediation", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            403,
            awsError(
              "RequestTimeTooSkewed",
              "The difference between the request time and the current time is too large.",
            ),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)[0]).toBe("authentication:fail");
      expect(checks[0]!.remediation).toContain("NTP");
    });

    test("passes authentication but fails read-permission on AccessDeniedException, naming securityhub:GetFindings", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            403,
            awsError(
              "AccessDeniedException",
              "User: arn:aws:iam::123456789012:user/oneuptime is not authorized to perform: securityhub:GetFindings on resource: arn:aws:securityhub:us-east-1:123456789012:hub/default because no identity-based policy allows the securityhub:GetFindings action",
            ),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:fail",
        "detections-available:skip",
      ]);
      expect(checkByKey(checks, "authentication").message).toContain(
        "verified the request signature",
      );

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 403\): /,
      );
      expect(read.message).toContain("AccessDeniedException");
      expect(read.remediation).toContain("securityhub:GetFindings");
      expect(read.remediation).toContain("AWSSecurityHubReadOnlyAccess");
      expect(read.remediation).toContain("delegated administrator");
      expect(checkByKey(checks, "detections-available").message).toContain(
        "findings could not be read",
      );
      expect(harness.requests).toHaveLength(1);
    });

    test("fails read-permission on InvalidAccessException with the enable-Security-Hub remediation", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            403,
            awsError(
              "InvalidAccessException",
              "Account 123456789012 is not subscribed to AWS Security Hub",
            ),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:fail",
        "detections-available:skip",
      ]);
      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.remediation).toContain("Enable Security Hub in this Region");
      expect(read.remediation).toContain("delegated administrator");
    });

    test("fails authentication with the Region remediation when no endpoint answers (404)", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(404, "<html><title>404 Not Found</title></html>");
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)[0]).toBe("authentication:fail");
      expect(checks[0]!.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 404\): /,
      );
      expect(checks[0]!.remediation).toContain("Region");
    });

    test("fails authentication with the throttling remediation when the probe is throttled (429)", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            429,
            awsError("LimitExceededException", "Rate exceeded"),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)[0]).toBe("authentication:fail");
      expect(checks[0]!.remediation).toContain("throttling");
    });

    test("fails detections-available on a throttled count and keeps the earlier passes", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("probe")]);
        },
        (): DataSourceHttpResponse => {
          return status(
            429,
            awsError("LimitExceededException", "Rate exceeded"),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:fail",
      ]);
      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 429\): /,
      );
      expect(available.remediation).toContain("throttling");
    });

    test("fails detections-available on a server-side failure with the retry remediation", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([]);
        },
        (): DataSourceHttpResponse => {
          return page([]);
        },
        (): DataSourceHttpResponse => {
          return status(
            500,
            awsError("InternalException", "Internal service error"),
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("fail");
      expect(available.message).toMatch(
        /^AWS Security Hub findings request failed \(HTTP 500\): /,
      );
      expect(available.remediation).toContain("server-side");
    });

    test("fails authentication with the connectivity remediation when the transport never answers", async () => {
      const harness: Harness = buildHarness([
        (): Promise<DataSourceHttpResponse> => {
          return new Promise<DataSourceHttpResponse>((): void => {
            // Never settles; the client's own deadline must fire.
          });
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 50,
        });

      expect(statuses(checks)).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);
      expect(checks[0]!.message).toBe(
        "AWS Security Hub findings request timed out after 1 seconds with no response.",
      );
      expect(checks[0]!.remediation).toContain("outbound HTTPS");
      expect(checks[0]!.remediation).toContain(
        "securityhub.<region>.amazonaws.com",
      );
    });

    test("fails authentication with the connectivity remediation when the production transport cannot reach AWS", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          throw new BadDataException(
            "Could not reach data source: timeout of 1000ms exceeded",
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)[0]).toBe("authentication:fail");
      expect(checks[0]!.message).toBe(
        "AWS Security Hub findings request failed: Could not reach data source: timeout of 1000ms exceeded",
      );
      expect(checks[0]!.remediation).toContain("outbound HTTPS");
      expect(checks[0]!.remediation).not.toContain("IAM > Users");
    });

    test("fails authentication when the endpoint answers something other than JSON", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(
            200,
            "<!DOCTYPE html><html><title>Proxy</title></html>",
          );
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)[0]).toBe("authentication:fail");
      expect(checks[0]!.message).toMatch(
        /^AWS Security Hub findings request returned a non-JSON body: /,
      );
    });

    test("signs and sends the session token on every request for temporary credentials, and never prints it", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("probe")]);
        },
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("a")]);
        },
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("a"), guardDutyFinding("b")]);
        },
      ]);

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(temporarySettings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:pass",
      ]);
      expect(harness.requests).toHaveLength(3);

      for (const request of harness.requests) {
        expectSigned(request, {
          accessKeyId: TEMPORARY_ACCESS_KEY_ID,
          sessionToken: SESSION_TOKEN,
        });
      }

      for (const check of checks) {
        expect(JSON.stringify(check)).not.toContain(SESSION_TOKEN);
        expect(JSON.stringify(check)).not.toContain(SECRET_ACCESS_KEY);
      }
    });
  });

  describe("fetchEvents", () => {
    test("reads the window by creation time, normalizes with the catalog's vendor and product, and builds samples", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([
            guardDutyFinding("0c10c2c7863d1a356"),
            controlFinding(),
            guardDutyFinding("0fedcba9876543210"),
          ]);
        },
      ]);

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ sampleLimit: 2 }),
      );

      expect(result.complete).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.requestCount).toBe(1);
      expect(result.fetchedCount).toBe(3);
      expect(result.rejectedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.events).toHaveLength(3);

      for (const event of result.events) {
        expect(event.vendorName).toBe(definition.vendorName);
        expect(event.productName).toBe(definition.productName);
        expect(event.vendorName).toBe("Amazon Web Services");
        expect(event.productName).toBe("AWS Security Hub");
      }

      expect(
        result.events.map((event: { classUid: number }): number => {
          return event.classUid;
        }),
      ).toEqual([2004, 2003, 2004]);
      expect(result.events[1]!.className).toBe("Compliance Finding");
      expect(result.events[0]!.className).toBe("Detection Finding");

      expect(
        result.events.map((event: { eventUid: string }): string => {
          return event.eventUid;
        }),
      ).toEqual([
        "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64/finding/0c10c2c7863d1a356",
        "arn:aws:securityhub:eu-central-1:123456789012:security-control/IAM.9/finding/5a3c1b0e-9b7c-4b1e-8d4a-2b3c4d5e6f70",
        "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64/finding/0fedcba9876543210",
      ]);

      expect(result.samples).toHaveLength(2);
      expect(result.samples[0]).toEqual({
        id: "arn:aws:guardduty:us-east-1:193043430472:detector/d4b040365221be2b54a6264dc9a4bc64/finding/0c10c2c7863d1a356",
        title:
          "199.241.229.197 is performing SSH brute force attacks against i-0c10c2c7863d1a356.",
        severity: "Medium",
        createdTime: "2026-09-12T12:34:34.146Z",
        eventTime: "2026-09-12T12:20:00Z",
      });
      expect(result.samples[1]!.severity).toBe("Critical");

      const request: DataSourceHttpRequest = harness.requests[0]!;
      expectSigned(request);
      expect(request.timeoutInMs).toBe(30000);

      const body: JSONObject = parsedBody(request);
      expect(Object.keys(body).sort()).toEqual([
        "Filters",
        "MaxResults",
        "SortCriteria",
      ]);
      expect(createdAtFilter(body)).toEqual({
        Start: START.toISOString(),
        End: END.toISOString(),
      });
      expect(body["MaxResults"]).toBe(100);
      expect(body["SortCriteria"]).toEqual([
        { Field: "CreatedAt", SortOrder: "asc" },
      ]);
    });

    test("follows NextToken with the same filter and sort until the last page, signing every request", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page(
            [guardDutyFinding("p1a"), guardDutyFinding("p1b")],
            "tok-1",
          );
        },
        (): DataSourceHttpResponse => {
          return page(
            [guardDutyFinding("p2a"), guardDutyFinding("p2b")],
            "tok-2",
          );
        },
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("p3a")]);
        },
      ]);

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.requestCount).toBe(3);
      expect(result.fetchedCount).toBe(5);
      expect(result.events).toHaveLength(5);
      expect(result.samples).toHaveLength(5);
      expect(harness.requests).toHaveLength(3);

      const bodies: Array<JSONObject> = harness.requests.map(parsedBody);
      expect(Object.keys(bodies[0]!).sort()).toEqual([
        "Filters",
        "MaxResults",
        "SortCriteria",
      ]);
      expect(Object.keys(bodies[1]!).sort()).toEqual([
        "Filters",
        "MaxResults",
        "NextToken",
        "SortCriteria",
      ]);
      expect(bodies[1]!["NextToken"]).toBe("tok-1");
      expect(bodies[2]!["NextToken"]).toBe("tok-2");

      for (const body of bodies) {
        expect(body["Filters"]).toEqual(bodies[0]!["Filters"]);
        expect(body["SortCriteria"]).toEqual(bodies[0]!["SortCriteria"]);
        expect(body["MaxResults"]).toBe(100);
      }

      for (const request of harness.requests) {
        expectSigned(request);
      }
    });

    test("stops at the request bound, marks the fetch incomplete and warns so the cursor is held", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("p1a")], "tok-1");
        },
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("p2a")], "tok-2");
        },
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("p3a")]);
        },
      ]);

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxRequests: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        "Stopped after 2 findings requests (the per-run request limit)",
      );
      expect(result.warnings[0]).toContain("cursor is held");
      expect(harness.requests).toHaveLength(2);
    });

    test("stops at the event bound inside a page, marks the fetch incomplete and warns", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([
            guardDutyFinding("a"),
            guardDutyFinding("b"),
            guardDutyFinding("c"),
          ]);
        },
      ]);

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.events).toHaveLength(2);
      expect(result.fetchedCount).toBe(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        "Stopped after 2 findings (the per-run record limit)",
      );
      expect(result.warnings[0]).toContain("cursor is held");
      expect(harness.requests).toHaveLength(1);
    });

    test("does not request the next page once the event bound is reached exactly at a page end", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("a"), guardDutyFinding("b")], "tok-1");
        },
      ]);

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.events).toHaveLength(2);
      expect(result.warnings[0]).toContain("per-run record limit");
      expect(harness.requests).toHaveLength(1);
    });

    test("counts findings the normalizer does not recognize as rejected and ones that throw as failed", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([
            guardDutyFinding("good"),
            { Message: "not a finding", Code: "Whatever" },
            { Id: "id-without-any-required-attribute" },
            guardDutyFinding("boom"),
          ]);
        },
      ]);

      const original: typeof AwsSecurityHubNormalizer.normalize =
        AwsSecurityHubNormalizer.normalize.bind(AwsSecurityHubNormalizer);
      const spy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(AwsSecurityHubNormalizer, "normalize")
        .mockImplementation((raw: JSONObject) => {
          if (String(raw["Id"]).endsWith("/finding/boom")) {
            throw new Error("synthetic normalization failure");
          }

          return original(raw);
        });

      try {
        const result: ConnectorFetchResult =
          await harness.connector.fetchEvents(
            settings(),
            { startTime: START, endTime: END },
            fetchOptions(),
          );

        expect(result.complete).toBe(true);
        expect(result.fetchedCount).toBe(4);
        expect(result.rejectedCount).toBe(2);
        expect(result.failedCount).toBe(1);
        expect(result.events).toHaveLength(1);
        expect(result.samples).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    test("ignores the alertingOnly flag, which Security Hub has no notion of", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([guardDutyFinding("a")]);
        },
      ]);

      await harness.connector.fetchEvents(
        settings({ alertingOnly: true }),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(Object.keys(parsedBody(harness.requests[0]!)).sort()).toEqual([
        "Filters",
        "MaxResults",
        "SortCriteria",
      ]);
      expect(
        Object.keys(parsedBody(harness.requests[0]!)["Filters"] as JSONObject),
      ).toEqual(["CreatedAt"]);
    });

    test("normalizes the Region's case into the endpoint host and the credential scope", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return page([]);
        },
      ]);

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings({
          config: { region: "EU-West-2", accessKeyId: ` ${ACCESS_KEY_ID} ` },
        }),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.events).toEqual([]);
      expect(harness.requests[0]!.url).toBe(
        "https://securityhub.eu-west-2.amazonaws.com/findings",
      );
      expectSigned(harness.requests[0]!, { region: "eu-west-2" });
    });

    test("throws with the step prefix for 401, 403, 429 and 500 and never prints a credential", async () => {
      for (const code of [401, 403, 429, 500]) {
        const harness: Harness = buildHarness([
          (): DataSourceHttpResponse => {
            return status(
              code,
              JSON.stringify({
                __type: "SomeException",
                Message: `rejected ${SECRET_ACCESS_KEY} with token ${SESSION_TOKEN}`,
                SecretAccessKey: SECRET_ACCESS_KEY,
                SessionToken: SESSION_TOKEN,
              }),
            );
          },
        ]);

        const error: Error = await expectRejection(
          harness.connector.fetchEvents(
            temporarySettings(),
            { startTime: START, endTime: END },
            fetchOptions(),
          ),
        );

        expect(error).toBeInstanceOf(APIException);
        expect(error.message).toMatch(
          new RegExp(
            `^AWS Security Hub findings request failed \\(HTTP ${code}\\): `,
          ),
        );
        expect(error.message).not.toContain(SECRET_ACCESS_KEY);
        expect(error.message).not.toContain(SESSION_TOKEN);
        expect(harness.requests).toHaveLength(1);
      }
    });

    test("throws with the step prefix when a page is not JSON", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          return status(200, `<html>login ${SECRET_ACCESS_KEY}</html>`);
        },
      ]);

      const error: Error = await expectRejection(
        harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      );

      expect(error).toBeInstanceOf(APIException);
      expect(error.message).toMatch(
        /^AWS Security Hub findings request returned a non-JSON body: /,
      );
      expect(error.message).not.toContain(SECRET_ACCESS_KEY);
    });

    test("throws with the step prefix when the transport never settles within the request timeout", async () => {
      const harness: Harness = buildHarness([
        (): Promise<DataSourceHttpResponse> => {
          return new Promise<DataSourceHttpResponse>((): void => {
            // Never settles.
          });
        },
      ]);

      await expect(
        harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions({ requestTimeoutInMs: 50 }),
        ),
      ).rejects.toThrow(
        "AWS Security Hub findings request timed out after 1 seconds with no response.",
      );
    });

    test("throws with the step prefix when the production transport reports a timeout", async () => {
      const harness: Harness = buildHarness([
        (): DataSourceHttpResponse => {
          throw new BadDataException(
            `Could not reach data source: timeout of 1000ms exceeded (x-amz-security-token: ${SESSION_TOKEN})`,
          );
        },
      ]);

      const error: Error = await expectRejection(
        harness.connector.fetchEvents(
          temporarySettings(),
          { startTime: START, endTime: END },
          fetchOptions({ requestTimeoutInMs: 1000 }),
        ),
      );

      expect(error).toBeInstanceOf(APIException);
      expect(error.message).toMatch(
        /^AWS Security Hub findings request failed: Could not reach data source: timeout of 1000ms exceeded/,
      );
      expect(error.message).not.toContain(SESSION_TOKEN);
    });

    test("throws a BadDataException for invalid settings before any request", async () => {
      const harness: Harness = buildHarness();

      await expect(
        harness.connector.fetchEvents(
          settings({ secrets: {} }),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toBeInstanceOf(BadDataException);

      await expect(
        harness.connector.fetchEvents(
          settings({
            config: { region: REGION, accessKeyId: TEMPORARY_ACCESS_KEY_ID },
          }),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(/^Session token is required/);

      await expect(
        harness.connector.fetchEvents(
          settings({ provider: SecurityEventConnectorProvider.OktaSystemLog }),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(/^Settings are for provider/);

      expect(harness.requests).toHaveLength(0);
    });
  });
});
