import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  AWS_THROTTLING_ERROR_CODES,
  AWS_TRANSIENT_ERROR_CODES,
  AwsRequest,
  classifyAwsAnswer,
  getAwsRequestAction,
  isAwsRequestSafeToRepeat,
  sendAwsRequest,
  sendAwsRestRequest,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import AwsRetry, {
  AWS_DYNAMODB_RETRY_MAX_ATTEMPTS,
  AWS_NO_RETRY_INCREMENT,
  AWS_RETRY_MAX_ATTEMPTS,
  AWS_RETRY_MAX_BACKOFF_MS,
  AWS_RETRY_QUOTA_TOKENS,
  AWS_THROTTLING_RETRY_COST,
  AWS_TRANSIENT_RETRY_COST,
  AwsRetryQuota,
  getAwsBackoffMs,
  getAwsRetryQuota,
  getAwsRetryWaitMs,
  isAwsReadAction,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsRetry";
import {
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { HttpRetryReason } from "../../../../Server/Utils/DataSource/HttpRetry";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * Every AWS call of a cloud connection is asked again as the AWS SDKs'
 * standard retry mode asks ("Retry behavior", AWS SDKs and Tools Reference
 * Guide): after a throttle, and after a failure for now - a 500, 502, 503
 * or 504, an InternalError - when sending it again is safe; three tries
 * (four for DynamoDB), each wait with full jitter from a base of 1 s after
 * a throttle and 50 ms after a failure for now, at most 20 s, AWS's own
 * x-amz-retry-after taken as it says, within 5 s more; a retry quota per
 * read that stops asking again once most requests fail. Each try is a
 * request of the read's budget. A write that is not safe to send again is
 * asked again after a throttle only, and a request that got no answer is
 * never asked again.
 */

interface Answer {
  status: number;
  body?: string | undefined;
  headers?: Dictionary<string> | undefined;
}

function awsJsonError(status: number, code: string, message: string): Answer {
  return {
    status,
    body: JSON.stringify({ __type: `com.amazonaws.coral#${code}`, message }),
  };
}

function awsXmlError(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`,
  };
}

const OK: Answer = {
  status: 200,
  body: JSON.stringify({ MetricDataResults: [] }),
};

/*
 * AWS in a test, answering in turn (the last answer repeating). The real
 * transport answers every status when asked to (acceptAnyStatus), with its
 * headers; the throwing one throws a status outside 2xx as the production
 * transport does when not asked - as the cloud tests' fakes do - and both
 * must read alike.
 */
function fakeAws(
  answers: Array<Answer | Error>,
  options: { throwsForStatus?: boolean } = {},
): {
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
  requests: Array<DataSourceHttpRequest>;
} {
  const requests: Array<DataSourceHttpRequest> = [];
  let turn: number = 0;

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      const answer: Answer | Error =
        answers[Math.min(turn, answers.length - 1)]!;
      turn++;

      if (answer instanceof Error) {
        throw answer;
      }

      const bodyText: string = answer.body || "";

      if (
        (answer.status < 200 || answer.status >= 300) &&
        (options.throwsForStatus || !request.acceptAnyStatus)
      ) {
        throw new BadDataException(
          `Data source responded with HTTP ${answer.status}: ${bodyText.substring(0, 500)}`,
        );
      }

      let bodyJson: unknown = undefined;

      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }

      return {
        statusCode: answer.status,
        bodyText,
        bodyJson,
        headers: answer.headers || {},
      };
    },
  };
}

const CREDENTIALS: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

function metricRead(
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>,
  waits: Array<number>,
  extra: Partial<AwsRequest> = {},
): Promise<{ json: unknown; text: string }> {
  return sendAwsRequest({
    transport,
    credentials: CREDENTIALS,
    service: "monitoring",
    region: "us-east-1",
    target: "GraniteServiceVersion20100801.GetMetricData",
    body: { MetricDataQueries: [] },
    step: "CloudWatch metric read in us-east-1",
    providerTitle: "AWS",
    sleep: async (milliseconds: number): Promise<void> => {
      waits.push(milliseconds);
    },
    ...extra,
  });
}

function response(
  status: number,
  body: string = "",
  headers: Dictionary<string> = {},
): DataSourceHttpResponse {
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(body);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: status, bodyText: body, bodyJson, headers };
}

beforeEach(() => {
  // The jitter at its most: each wait is its whole backoff, so a test knows it.
  jest.spyOn(AwsRetry, "random").mockReturnValue(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what is asked again, as the AWS SDKs read an answer", () => {
  test("every throttling code the standard retry mode lists, whatever the status", () => {
    expect(AWS_THROTTLING_ERROR_CODES).toEqual([
      "Throttling",
      "ThrottlingException",
      "ThrottledException",
      "RequestThrottledException",
      "TooManyRequestsException",
      "ProvisionedThroughputExceededException",
      "TransactionInProgressException",
      "LimitExceededException",
      "PriorRequestNotComplete",
      "RequestThrottled",
      "EC2ThrottledException",
      "RequestLimitExceeded",
      "SlowDown",
      "BandwidthLimitExceeded",
    ]);

    for (const code of AWS_THROTTLING_ERROR_CODES) {
      for (const status of [400, 503]) {
        expect(
          classifyAwsAnswer(
            response(
              status,
              JSON.stringify({ __type: `com.amazonaws.coral#${code}` }),
            ),
          )?.reason,
        ).toBe(HttpRetryReason.Throttled);
      }
    }
  });

  test("a 503 with a throttling code is a throttle, as the SDKs match the code first", () => {
    expect(
      classifyAwsAnswer(
        response(
          503,
          "<Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>",
        ),
      ),
    ).toEqual({ reason: HttpRetryReason.Throttled });
  });

  test("a 429 is a throttle whatever it says", () => {
    expect(classifyAwsAnswer(response(429, "Too Many Requests"))?.reason).toBe(
      HttpRetryReason.Throttled,
    );
  });

  test("the transient codes, and any 500, 502, 503 or 504 without a code", () => {
    for (const code of AWS_TRANSIENT_ERROR_CODES) {
      expect(
        classifyAwsAnswer(
          response(400, JSON.stringify({ __type: code, message: "later" })),
        )?.reason,
      ).toBe(HttpRetryReason.Unavailable);
    }

    for (const status of [500, 502, 503, 504]) {
      expect(classifyAwsAnswer(response(status, ""))?.reason).toBe(
        HttpRetryReason.Unavailable,
      );
      expect(
        classifyAwsAnswer(response(status, "<html><title>Bad Gateway</title>"))
          ?.reason,
      ).toBe(HttpRetryReason.Unavailable);
    }

    // STS's identity provider, for a moment.
    expect(
      classifyAwsAnswer(
        response(
          400,
          "<ErrorResponse><Error><Code>IDPCommunicationError</Code></Error></ErrorResponse>",
        ),
      )?.reason,
    ).toBe(HttpRetryReason.Unavailable);
  });

  test("never a refusal, a request AWS will not take, a missing resource or a success", () => {
    for (const answer of [
      response(400, JSON.stringify({ __type: "ValidationException" })),
      response(400, JSON.stringify({ __type: "InvalidParameterValue" })),
      response(403, JSON.stringify({ __type: "AccessDeniedException" })),
      response(403, "<Error><Code>AccessDenied</Code></Error>"),
      response(404, "<Error><Code>NoSuchBucket</Code></Error>"),
      response(400, JSON.stringify({ __type: "ResourceNotFoundException" })),
      response(200, "{}"),
      response(204, ""),
    ]) {
      expect(classifyAwsAnswer(answer)).toBeNull();
    }
  });

  test("a REST-JSON API's code is read from its x-amzn-ErrorType header", () => {
    expect(
      classifyAwsAnswer(
        response(400, JSON.stringify({ message: "Rate exceeded" }), {
          "x-amzn-errortype":
            "ThrottlingException:http://internal.amazon.com/coral/com.amazonaws.lambda/",
        }),
      )?.reason,
    ).toBe(HttpRetryReason.Throttled);
  });

  test("a wait AWS names in x-amz-retry-after comes with the verdict", () => {
    expect(
      classifyAwsAnswer(response(503, "", { "x-amz-retry-after": "1500" })),
    ).toEqual({ reason: HttpRetryReason.Unavailable, waitInMs: 1500 });
  });
});

describe("how long it waits", () => {
  test("full jitter over the backoff: 1 s from a throttle, 50 ms from a failure for now, doubling", () => {
    expect(
      [0, 1, 2].map((retry: number): number => {
        return getAwsBackoffMs({ reason: HttpRetryReason.Throttled, retry });
      }),
    ).toEqual([1000, 2000, 4000]);
    expect(
      [0, 1, 2].map((retry: number): number => {
        return getAwsBackoffMs({ reason: HttpRetryReason.Unavailable, retry });
      }),
    ).toEqual([50, 100, 200]);
  });

  test("DynamoDB's failures for now from 25 ms; its throttles from 1 s as every service's", () => {
    expect(
      getAwsBackoffMs({
        reason: HttpRetryReason.Unavailable,
        retry: 0,
        isDynamoDb: true,
      }),
    ).toBe(25);
    expect(
      getAwsBackoffMs({
        reason: HttpRetryReason.Throttled,
        retry: 0,
        isDynamoDb: true,
      }),
    ).toBe(1000);
  });

  test("random(0, 1) of the backoff: never more, and never past 20 seconds", () => {
    expect(
      getAwsBackoffMs({
        reason: HttpRetryReason.Throttled,
        retry: 1,
        random: () => {
          return 0.25;
        },
      }),
    ).toBe(500);
    expect(
      getAwsBackoffMs({
        reason: HttpRetryReason.Throttled,
        retry: 0,
        random: () => {
          return 0;
        },
      }),
    ).toBe(0);
    // The SDKs' cap: the 10th retry of a failure for now, the 6th of a throttle.
    expect(
      getAwsBackoffMs({ reason: HttpRetryReason.Unavailable, retry: 10 }),
    ).toBe(AWS_RETRY_MAX_BACKOFF_MS);
    expect(
      getAwsBackoffMs({ reason: HttpRetryReason.Throttled, retry: 6 }),
    ).toBe(AWS_RETRY_MAX_BACKOFF_MS);
    // A random source out of bounds is held to them.
    expect(
      getAwsBackoffMs({
        reason: HttpRetryReason.Throttled,
        retry: 0,
        random: () => {
          return 7;
        },
      }),
    ).toBe(1000);
  });

  test("x-amz-retry-after is taken as AWS says, held between the backoff and 5 s more", () => {
    expect(
      getAwsRetryWaitMs({
        backoffMs: 100,
        headers: { "x-amz-retry-after": "3000" },
      }),
    ).toBe(3000);
    expect(
      getAwsRetryWaitMs({
        backoffMs: 1000,
        headers: { "X-Amz-Retry-After": "10" },
      }),
    ).toBe(1000);
    expect(
      getAwsRetryWaitMs({
        backoffMs: 100,
        headers: { "x-amz-retry-after": "60000" },
      }),
    ).toBe(5100);
  });

  test("a Retry-After within the longest wait is waited; a longer one is not waited out", () => {
    expect(
      getAwsRetryWaitMs({ backoffMs: 50, headers: { "retry-after": "2" } }),
    ).toBe(2000);
    expect(
      getAwsRetryWaitMs({ backoffMs: 2000, headers: { "retry-after": "1" } }),
    ).toBe(2000);
    expect(
      getAwsRetryWaitMs({ backoffMs: 50, headers: { "retry-after": "120" } }),
    ).toBeNull();
    expect(
      getAwsRetryWaitMs({
        backoffMs: 50,
        headers: { "retry-after": "Sun, 06 Nov 1994 08:49:40 GMT" },
        nowMs: Date.parse("Sun, 06 Nov 1994 08:49:37 GMT"),
      }),
    ).toBe(3000);
    // No hint: the backoff.
    expect(getAwsRetryWaitMs({ backoffMs: 50, headers: {} })).toBe(50);
    expect(
      getAwsRetryWaitMs({ backoffMs: 50, headers: { "retry-after": "soon" } }),
    ).toBe(50);
  });
});

describe("what is safe to send again", () => {
  test("a read, by its action's verb", () => {
    for (const action of [
      "DescribeInstances",
      "GraniteServiceVersion20100801.GetMetricData",
      "CloudApiService.ListResources",
      "LookupEvents",
      "Logs_20140328.FilterLogEvents",
      "BatchGetItem",
      "SearchResources",
    ]) {
      expect(isAwsReadAction(action)).toBe(true);
    }
  });

  test("never a write, nor a word that only starts like a read's verb", () => {
    for (const action of [
      "AssumeRole",
      "ModifyDBSnapshotAttribute",
      "DynamoDB_20120810.UpdateContinuousBackups",
      "PutBucketVersioning",
      "GenerateCredentialReport",
      "Getaway",
      "Listen",
      "Get",
      "",
    ]) {
      expect(isAwsReadAction(action)).toBe(false);
    }
  });

  test("a call's own word wins over its verb", () => {
    expect(
      getAwsRequestAction({
        target: "DynamoDB_20120810.DescribeTable",
        body: {},
      }),
    ).toBe("DescribeTable");
    expect(
      getAwsRequestAction({ body: { Action: "AssumeRole", Version: "x" } }),
    ).toBe("AssumeRole");
    expect(isAwsRequestSafeToRepeat({ body: { Action: "AssumeRole" } })).toBe(
      false,
    );
    expect(
      isAwsRequestSafeToRepeat({
        body: { Action: "AssumeRole" },
        isSafeToRepeat: true,
      }),
    ).toBe(true);
    expect(
      isAwsRequestSafeToRepeat({
        body: { Action: "DescribeInstances" },
        isSafeToRepeat: false,
      }),
    ).toBe(false);
  });
});

describe("the retry quota, one per read", () => {
  test("a read's calls share one quota; a call outside a read has a full one of its own", () => {
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 10,
      maxDurationMs: 60_000,
    });

    expect(getAwsRetryQuota(budget)).toBe(getAwsRetryQuota(budget));
    expect(
      getAwsRetryQuota(
        new CloudReadBudget({ maxRequests: 10, maxDurationMs: 60_000 }),
      ),
    ).not.toBe(getAwsRetryQuota(budget));
    expect(getAwsRetryQuota().available).toBe(AWS_RETRY_QUOTA_TOKENS);
  });

  test("a retry costs 14 tokens after a failure for now and 5 after a throttle; what works gives back", () => {
    const quota: AwsRetryQuota = new AwsRetryQuota();

    expect(quota.acquire(AWS_TRANSIENT_RETRY_COST)).toBe(true);
    expect(quota.acquire(AWS_THROTTLING_RETRY_COST)).toBe(true);
    expect(quota.available).toBe(481);
    quota.release(AWS_NO_RETRY_INCREMENT);
    expect(quota.available).toBe(482);
    // Never past the quota.
    quota.release(1000);
    expect(quota.available).toBe(AWS_RETRY_QUOTA_TOKENS);
  });

  test("a quota that cannot pay for a retry takes nothing", () => {
    const quota: AwsRetryQuota = new AwsRetryQuota();

    while (quota.acquire(AWS_TRANSIENT_RETRY_COST)) {
      // Spend it.
    }

    expect(quota.available).toBe(500 % 14);
    expect(quota.acquire(AWS_TRANSIENT_RETRY_COST)).toBe(false);
    expect(quota.available).toBe(500 % 14);
    expect(quota.acquire(AWS_THROTTLING_RETRY_COST)).toBe(true);
  });
});

describe("a JSON or Query call (sendAwsRequest)", () => {
  for (const throwsForStatus of [false, true]) {
    const transportKind: string = throwsForStatus
      ? "a transport that throws for a failed status"
      : "a transport that answers every status";

    test(`a 503 for a moment is asked again and the read goes on (${transportKind})`, async () => {
      const aws: ReturnType<typeof fakeAws> = fakeAws(
        [awsJsonError(503, "ServiceUnavailable", "Please try again"), OK],
        { throwsForStatus },
      );
      const waits: Array<number> = [];

      const answer: { json: unknown } = await metricRead(aws.transport, waits);

      expect(answer.json).toEqual({ MetricDataResults: [] });
      expect(aws.requests).toHaveLength(2);
      expect(waits).toEqual([50]);
    });

    test(`a failure for now that stays fails after three tries, saying so (${transportKind})`, async () => {
      const aws: ReturnType<typeof fakeAws> = fakeAws(
        [
          awsJsonError(
            500,
            "InternalFailure",
            "The request processing has failed",
          ),
        ],
        { throwsForStatus },
      );
      const waits: Array<number> = [];
      let failure: unknown = null;

      try {
        await metricRead(aws.transport, waits);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(LlmProviderError);
      expect((failure as LlmProviderError).kind).toBe(
        CloudConnectionFailureKind.Unavailable,
      );
      expect((failure as LlmProviderError).statusCode).toBe(500);
      expect((failure as LlmProviderError).message).toBe(
        'AWS CloudWatch metric read in us-east-1 failed with HTTP 500: {"__type":"com.amazonaws.coral#InternalFailure","message":"The request processing has failed"}. Tried 3 times.',
      );
      expect(aws.requests).toHaveLength(AWS_RETRY_MAX_ATTEMPTS);
      expect(waits).toEqual([50, 100]);
    });

    test(`a throttle is waited out from a second, three tries at most (${transportKind})`, async () => {
      const aws: ReturnType<typeof fakeAws> = fakeAws(
        [awsJsonError(400, "ThrottlingException", "Rate exceeded")],
        { throwsForStatus },
      );
      const waits: Array<number> = [];

      await expect(metricRead(aws.transport, waits)).rejects.toMatchObject({
        kind: CloudConnectionFailureKind.RateLimited,
      });
      expect(aws.requests).toHaveLength(3);
      expect(waits).toEqual([1000, 2000]);
    });
  }

  test("an answer asking again would repeat is not asked again, and reads as it did", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsJsonError(400, "ValidationException", "The parameter is invalid"),
    ]);
    const waits: Array<number> = [];

    await expect(metricRead(aws.transport, waits)).rejects.toThrow(
      'AWS CloudWatch metric read in us-east-1 failed with HTTP 400: {"__type":"com.amazonaws.coral#ValidationException","message":"The parameter is invalid"}',
    );
    expect(aws.requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test("a refusal is not asked again, and is still a refusal", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsJsonError(400, "AccessDeniedException", "not authorized"),
    ]);

    await expect(metricRead(aws.transport, [])).rejects.toMatchObject({
      kind: CloudConnectionFailureKind.Permission,
    });
    expect(aws.requests).toHaveLength(1);
  });

  test("a request that got no answer is never asked again", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      new BadDataException("Could not reach data source: socket hang up"),
    ]);

    await expect(metricRead(aws.transport, [])).rejects.toThrow(
      "AWS CloudWatch metric read in us-east-1 did not complete: Could not reach data source: socket hang up",
    );
    expect(aws.requests).toHaveLength(1);
  });

  test("each try is signed again and asks for every status, so a retry is never too old", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsJsonError(503, "ServiceUnavailable", "later"),
      OK,
    ]);

    // A minute passes between the tries.
    await metricRead(aws.transport, [], {
      now: () => {
        return new Date(
          Date.parse("2026-11-19T10:00:00Z") + aws.requests.length * 60_000,
        );
      },
    });

    expect(
      aws.requests.map((request: DataSourceHttpRequest) => {
        return request.headers?.["X-Amz-Date"];
      }),
    ).toEqual(["20261119T100000Z", "20261119T100100Z"]);
    expect(
      aws.requests.every((request: DataSourceHttpRequest): boolean => {
        return request.acceptAnyStatus === true;
      }),
    ).toBe(true);
  });

  test("each try is a request of the read's budget: a spent budget stops the tries", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsJsonError(503, "ServiceUnavailable", "later"),
    ]);
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 2,
      maxDurationMs: 60_000,
    });

    await expect(
      metricRead(aws.transport, [], { budget }),
    ).rejects.toBeInstanceOf(CloudReadBudgetSpent);
    expect(aws.requests).toHaveLength(2);
    expect(budget.getUsed()).toBe(2);
  });

  test("x-amz-retry-after is waited as AWS names it, within 5 s past the backoff", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      {
        ...awsJsonError(503, "ServiceUnavailable", "later"),
        headers: { "x-amz-retry-after": "1200" },
      },
      {
        ...awsJsonError(503, "ServiceUnavailable", "later"),
        headers: { "x-amz-retry-after": "90000" },
      },
      OK,
    ]);
    const waits: Array<number> = [];

    await metricRead(aws.transport, waits);

    expect(waits).toEqual([1200, 100 + 5000]);
  });

  test("a Retry-After longer than a retry waits is not waited out: the call fails now, saying when", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      {
        ...awsJsonError(429, "TooManyRequestsException", "slow down"),
        headers: { "retry-after": "120" },
      },
    ]);
    const waits: Array<number> = [];
    let failure: unknown = null;

    try {
      await metricRead(aws.transport, waits);
    } catch (error) {
      failure = error;
    }

    expect(aws.requests).toHaveLength(1);
    expect(waits).toEqual([]);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.RateLimited,
    );
    expect((failure as LlmProviderError).retryAfterSeconds).toBe(120);
  });

  test("a write that does not say it is safe is asked again after a throttle only", async () => {
    const failing: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(503, "ServiceUnavailable", "later"),
    ]);
    const write: (
      transport: (
        request: DataSourceHttpRequest,
      ) => Promise<DataSourceHttpResponse>,
      extra?: Partial<AwsRequest>,
    ) => Promise<unknown> = (
      transport: (
        request: DataSourceHttpRequest,
      ) => Promise<DataSourceHttpResponse>,
      extra: Partial<AwsRequest> = {},
    ): Promise<unknown> => {
      return sendAwsRequest({
        transport,
        credentials: CREDENTIALS,
        service: "rds",
        region: "us-east-1",
        body: {
          Action: "ModifyDBSnapshotAttribute",
          Version: "2014-10-31",
          DBSnapshotIdentifier: "nightly",
          AttributeName: "restore",
          "ValuesToRemove.AttributeValue.1": "all",
        },
        step: "snapshot share update",
        providerTitle: "AWS",
        sleep: async () => {},
        ...extra,
      });
    };

    await expect(write(failing.transport)).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(failing.requests).toHaveLength(1);

    // Throttled: the service turned it away before doing it.
    const throttled: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(400, "Throttling", "Rate exceeded"),
      { status: 200, body: "<ModifyDBSnapshotAttributeResponse/>" },
    ]);

    await write(throttled.transport);
    expect(throttled.requests).toHaveLength(2);

    // Its caller says sending it again changes nothing more.
    const declared: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(503, "ServiceUnavailable", "later"),
      { status: 200, body: "<ModifyDBSnapshotAttributeResponse/>" },
    ]);

    await write(declared.transport, { isSafeToRepeat: true });
    expect(declared.requests).toHaveLength(2);
  });

  test("a sign-in hands out a session and changes nothing: asked again after a failure for now", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(400, "IDPCommunicationError", "try again"),
      {
        status: 200,
        body: "<GetCallerIdentityResponse><GetCallerIdentityResult><Account>123456789012</Account></GetCallerIdentityResult></GetCallerIdentityResponse>",
      },
    ]);

    await sendAwsRequest({
      transport: aws.transport,
      credentials: CREDENTIALS,
      service: "sts",
      region: "us-east-1",
      body: { Action: "GetCallerIdentity", Version: "2011-06-15" },
      step: "sign-in check",
      providerTitle: "AWS",
      sleep: async () => {},
    });

    expect(aws.requests).toHaveLength(2);
  });

  test("DynamoDB is tried four times, from a 25 ms base", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsJsonError(500, "InternalServerError", "later"),
    ]);
    const waits: Array<number> = [];

    await expect(
      sendAwsRequest({
        transport: aws.transport,
        credentials: CREDENTIALS,
        service: "dynamodb",
        region: "us-east-1",
        target: "DynamoDB_20120810.DescribeTable",
        body: { TableName: "orders" },
        step: "table request",
        providerTitle: "AWS",
        sleep: async (milliseconds: number) => {
          waits.push(milliseconds);
        },
      }),
    ).rejects.toThrow("Tried 4 times.");
    expect(aws.requests).toHaveLength(AWS_DYNAMODB_RETRY_MAX_ATTEMPTS);
    expect(waits).toEqual([25, 50, 100]);
  });

  test("an outage spends the read's quota, and its calls then fail at once", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsJsonError(503, "ServiceUnavailable", "down"),
    ]);
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 1000,
      maxDurationMs: 600_000,
    });

    for (let call: number = 0; call < 20; call++) {
      await expect(
        metricRead(aws.transport, [], { budget }),
      ).rejects.toBeInstanceOf(LlmProviderError);
    }

    /*
     * Each call that fails all three tries spends 28 tokens: 17 of them do,
     * the 18th can pay for one retry, and the last two for none.
     */
    expect(aws.requests).toHaveLength(17 * 3 + 2 + 2);
    expect(getAwsRetryQuota(budget).available).toBe(500 - 17 * 28 - 14);
  });

  test("a retry that works gives its tokens back, and a call that works first time gives one", async () => {
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 100,
      maxDurationMs: 600_000,
    });
    const quota: AwsRetryQuota = getAwsRetryQuota(budget);

    quota.acquire(100);
    await metricRead(
      fakeAws([awsJsonError(503, "ServiceUnavailable", "later"), OK]).transport,
      [],
      { budget },
    );
    // The retry's 14, given back.
    expect(quota.available).toBe(400);

    await metricRead(fakeAws([OK]).transport, [], { budget });
    expect(quota.available).toBe(401);
  });

  test("the secret key never reaches the words a failure is said in", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsJsonError(
        500,
        "InternalFailure",
        `echoed ${CREDENTIALS.secretAccessKey}`,
      ),
    ]);

    let message: string = "";

    try {
      await metricRead(aws.transport, []);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Tried 3 times.");
    expect(message).not.toContain(CREDENTIALS.secretAccessKey);
  });
});

describe("a REST call (sendAwsRestRequest)", () => {
  function s3(
    transport: (
      request: DataSourceHttpRequest,
    ) => Promise<DataSourceHttpResponse>,
    waits: Array<number>,
    extra: Partial<Parameters<typeof sendAwsRestRequest>[0]> = {},
  ): ReturnType<typeof sendAwsRestRequest> {
    return sendAwsRestRequest({
      transport,
      credentials: CREDENTIALS,
      service: "s3",
      region: "us-east-1",
      path: "/orders-bucket",
      query: { versioning: "" },
      step: "bucket versioning request",
      providerTitle: "AWS S3",
      sleep: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
      ...extra,
    });
  }

  test("S3's SlowDown is a throttle, waited out", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(503, "SlowDown", "Please reduce your request rate."),
      { status: 200, body: "<VersioningConfiguration/>" },
    ]);
    const waits: Array<number> = [];

    const answer: { status: number } = await s3(aws.transport, waits);

    expect(answer.status).toBe(200);
    expect(waits).toEqual([1000]);
  });

  test("a GET is asked again after a failure for now", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws(
      [
        awsXmlError(500, "InternalError", "We encountered an internal error."),
        { status: 200, body: "<VersioningConfiguration/>" },
      ],
      { throwsForStatus: true },
    );
    const waits: Array<number> = [];

    await s3(aws.transport, waits);

    expect(aws.requests).toHaveLength(2);
    expect(waits).toEqual([50]);
  });

  test("a PUT is not, unless its caller says it sets a setting to one value", async () => {
    const failing: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(500, "InternalError", "We encountered an internal error."),
    ]);

    await expect(
      s3(failing.transport, [], {
        method: "PUT",
        body: "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>",
        step: "bucket versioning update",
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(failing.requests).toHaveLength(1);

    const declared: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(500, "InternalError", "We encountered an internal error."),
      { status: 200, body: "" },
    ]);

    await s3(declared.transport, [], {
      method: "PUT",
      body: "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>",
      step: "bucket versioning update",
      isSafeToRepeat: true,
    });
    expect(declared.requests).toHaveLength(2);
    expect(declared.requests[1]!.method).toBe("PUT");
  });

  test("a POST that only reads, said so, is asked again", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      { status: 502, body: "<html><title>502 Bad Gateway</title></html>" },
      { status: 200, body: JSON.stringify({ DomainStatusList: [] }) },
    ]);

    const answer: { json: unknown } = await sendAwsRestRequest({
      transport: aws.transport,
      credentials: CREDENTIALS,
      service: "es",
      region: "us-east-1",
      method: "POST",
      path: "/2021-01-01/opensearch/domain-info",
      body: JSON.stringify({ DomainNames: ["search"] }),
      step: "search domain request",
      providerTitle: "AWS",
      sleep: async () => {},
      isSafeToRepeat: true,
    });

    expect(answer.json).toEqual({ DomainStatusList: [] });
    expect(aws.requests).toHaveLength(2);
  });

  test("a refusal keeps its kind and its words", async () => {
    const aws: ReturnType<typeof fakeAws> = fakeAws([
      awsXmlError(403, "InvalidAccessKeyId", "The key is not known."),
    ]);

    await expect(s3(aws.transport, [])).rejects.toMatchObject({
      kind: CloudConnectionFailureKind.Authentication,
      statusCode: 403,
    });
    expect(aws.requests).toHaveLength(1);
  });
});
