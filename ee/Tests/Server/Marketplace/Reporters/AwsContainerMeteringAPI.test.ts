import AwsContainerMeteringAPI, {
  AWS_METER_USAGE_MAX_QUANTITY,
  AwsMeterUsageRecord,
} from "../../../../Server/Marketplace/Reporters/AwsContainerMeteringAPI";
import AwsWorkloadCredentialsProvider from "../../../../Server/Marketplace/Reporters/AwsWorkloadCredentials";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { MarketplaceHttpRequest } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import AwsSecurityHubClient from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import {
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * MeterUsage from the buyer's EKS cluster: signed with the IRSA session of
 * OneUptime's service account, sent to the Metering Service of the pod's own
 * Region, one record per hour with a ClientToken that makes a retry from any
 * pod the same request.
 */

const NOW: Date = new Date("2026-10-17T10:05:00.000Z");
const PRODUCT_CODE: string = "6w0yyl6ppdh2o9sbu4i1zuqvk";

// A credentials provider whose session is fixed (keys from the environment).
const createCredentials: (
  sessionToken?: string,
) => AwsWorkloadCredentialsProvider = (
  sessionToken?: string,
): AwsWorkloadCredentialsProvider => {
  return new AwsWorkloadCredentialsProvider({
    env: {
      AWS_ACCESS_KEY_ID: "ASIAEXAMPLESESSION",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      AWS_SESSION_TOKEN: sessionToken ?? "irsa-session-token",
    },
  });
};

const createApi: (
  http: FakeHttpClient,
  credentials?: AwsWorkloadCredentialsProvider,
) => AwsContainerMeteringAPI = (
  http: FakeHttpClient,
  credentials?: AwsWorkloadCredentialsProvider,
): AwsContainerMeteringAPI => {
  return new AwsContainerMeteringAPI({
    credentials: credentials || createCredentials(),
    region: "eu-west-1",
    httpClient: http.client,
    now: (): Date => {
      return NOW;
    },
  });
};

const record: (
  overrides?: Partial<AwsMeterUsageRecord>,
) => AwsMeterUsageRecord = (
  overrides?: Partial<AwsMeterUsageRecord>,
): AwsMeterUsageRecord => {
  return {
    productCode: PRODUCT_CODE,
    dimension: "users",
    quantity: 42,
    timestamp: new Date("2026-10-17T09:00:00.000Z"),
    clientToken: "oneuptime-0f6c0e1c-2026101709",
    ...overrides,
  };
};

const awsError: (type: string, message: string) => Record<string, unknown> = (
  type: string,
  message: string,
): Record<string, unknown> => {
  return { __type: `com.amazonaws.awsmpmeteringservice#${type}`, message };
};

const expectMarketplaceError: (
  promise: Promise<unknown>,
) => Promise<MarketplaceApiError> = async (
  promise: Promise<unknown>,
): Promise<MarketplaceApiError> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(MarketplaceApiError);
    return err as MarketplaceApiError;
  }

  throw new Error("Expected a MarketplaceApiError, but nothing was thrown.");
};

describe("AwsContainerMeteringAPI.meterUsage", () => {
  it("sends one signed record to the Metering Service of the pod's Region", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: { MeteringRecordId: "record-1234" } },
    ]);

    const meteringRecordId: string = await createApi(http).meterUsage(record());

    expect(meteringRecordId).toBe("record-1234");
    expect(http.requests).toHaveLength(1);

    const request: MarketplaceHttpRequest = http.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://metering.marketplace.eu-west-1.amazonaws.com/",
    );
    expect(JSON.parse(request.body!)).toEqual({
      ProductCode: PRODUCT_CODE,
      Timestamp: Math.floor(
        new Date("2026-10-17T09:00:00.000Z").getTime() / 1000,
      ),
      UsageDimension: "users",
      UsageQuantity: 42,
      ClientToken: "oneuptime-0f6c0e1c-2026101709",
    });
    expect(request.headers).toMatchObject({
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSMPMeteringService.MeterUsage",
      "X-Amz-Security-Token": "irsa-session-token",
    });

    // Signed for aws-marketplace in the pod's Region, over exactly what was sent.
    const expected: string = AwsSecurityHubClient.signRequest({
      method: "POST",
      host: "metering.marketplace.eu-west-1.amazonaws.com",
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSMPMeteringService.MeterUsage",
      },
      body: request.body!,
      accessKeyId: "ASIAEXAMPLESESSION",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      sessionToken: "irsa-session-token",
      region: "eu-west-1",
      service: "aws-marketplace",
      date: NOW,
    }).headers["Authorization"]!;

    expect(request.headers!["Authorization"]).toBe(expected);
    expect(expected).toContain("/eu-west-1/aws-marketplace/aws4_request");
  });

  it("refuses to send a record AWS would refuse anyway", async () => {
    const bad: Array<Partial<AwsMeterUsageRecord>> = [
      { quantity: 1.5 },
      { quantity: -1 },
      { quantity: AWS_METER_USAGE_MAX_QUANTITY + 1 },
      { productCode: "" },
      { productCode: "has spaces" },
      { dimension: "" },
      { clientToken: "" },
      { clientToken: "x".repeat(65) },
      { timestamp: new Date("not a date") },
    ];

    for (const overrides of bad) {
      const http: FakeHttpClient = createFakeHttpClient([]);

      const error: MarketplaceApiError = await expectMarketplaceError(
        createApi(http).meterUsage(record(overrides)),
      );

      expect(error.isRetryable).toBe(false);
      expect(http.requests).toHaveLength(0);
    }
  });

  it("takes 0 and the largest quantity AWS allows", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: { MeteringRecordId: "zero" } },
      { status: 200, body: { MeteringRecordId: "max" } },
    ]);

    await expect(
      createApi(http).meterUsage(record({ quantity: 0 })),
    ).resolves.toBe("zero");
    await expect(
      createApi(http).meterUsage(
        record({ quantity: AWS_METER_USAGE_MAX_QUANTITY }),
      ),
    ).resolves.toBe("max");
  });

  it("names the buyer who is not entitled, for good", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 400,
        body: awsError(
          "CustomerNotEntitledException",
          "The customer does not have a valid subscription for the product.",
        ),
      },
    ]);

    const error: MarketplaceApiError = await expectMarketplaceError(
      createApi(http).meterUsage(record()),
    );

    expect(error.code).toBe("CustomerNotEntitledException");
    expect(error.isRetryable).toBe(false);
    expect(AwsContainerMeteringAPI.isNotEntitledError(error)).toBe(true);
    expect(AwsContainerMeteringAPI.isSetupError(error)).toBe(false);
  });

  it("tells a setup mistake apart from a refusal", async () => {
    for (const type of [
      "InvalidEndpointRegionException",
      "InvalidProductCodeException",
      "InvalidUsageDimensionException",
      "AccessDeniedException",
    ]) {
      const error: MarketplaceApiError = await expectMarketplaceError(
        createApi(
          createFakeHttpClient([{ status: 400, body: awsError(type, "no") }]),
        ).meterUsage(record()),
      );

      expect(error.code).toBe(type);
      expect(AwsContainerMeteringAPI.isSetupError(error)).toBe(true);
      expect(AwsContainerMeteringAPI.isNotEntitledError(error)).toBe(false);
    }
  });

  it("asks again later on throttling, AWS's own failures and no answer", async () => {
    const answers: Array<
      { status: number; body: string | Record<string, unknown> } | Error
    > = [
      { status: 400, body: awsError("ThrottlingException", "Rate exceeded") },
      {
        status: 500,
        body: awsError("InternalServiceErrorException", "Try again"),
      },
      { status: 503, body: "Service Unavailable" },
      new Error("connect ETIMEDOUT"),
    ];

    for (const answer of answers) {
      const error: MarketplaceApiError = await expectMarketplaceError(
        createApi(createFakeHttpClient([answer])).meterUsage(record()),
      );

      expect(error.isRetryable).toBe(true);
    }
  });

  it("reports a record too old to take, and a different record already sent this hour", async () => {
    for (const type of [
      "TimestampOutOfBoundsException",
      "DuplicateRequestException",
    ]) {
      const error: MarketplaceApiError = await expectMarketplaceError(
        createApi(
          createFakeHttpClient([{ status: 400, body: awsError(type, "no") }]),
        ).meterUsage(record()),
      );

      expect(error.code).toBe(type);
      expect(error.isRetryable).toBe(false);
    }
  });

  it("drops an expired session so the next attempt gets a new one", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 400,
        body: awsError(
          "ExpiredTokenException",
          "The security token included in the request is expired",
        ),
      },
    ]);
    const credentials: AwsWorkloadCredentialsProvider = createCredentials();
    let invalidated: number = 0;
    const originalInvalidate: () => void =
      credentials.invalidate.bind(credentials);
    credentials.invalidate = (): void => {
      invalidated++;
      originalInvalidate();
    };

    const error: MarketplaceApiError = await expectMarketplaceError(
      createApi(http, credentials).meterUsage(record()),
    );

    expect(error.isRetryable).toBe(true);
    expect(invalidated).toBe(1);
  });

  it("does not take a success without a metering record ID", async () => {
    const error: MarketplaceApiError = await expectMarketplaceError(
      createApi(createFakeHttpClient([{ status: 200, body: {} }])).meterUsage(
        record(),
      ),
    );

    expect(error.isRetryable).toBe(true);
  });
});

describe("AwsContainerMeteringAPI.checkPermission", () => {
  it("sends a DryRun and takes DryRunOperation as yes", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 412,
        body: awsError("DryRunOperation", "Request would have succeeded."),
      },
    ]);

    await createApi(http).checkPermission({
      productCode: PRODUCT_CODE,
      dimension: "users",
    });

    expect(JSON.parse(http.requests[0]!.body!)).toEqual({
      ProductCode: PRODUCT_CODE,
      Timestamp: Math.floor(NOW.getTime() / 1000),
      UsageDimension: "users",
      UsageQuantity: 0,
      DryRun: true,
    });
  });

  it("passes on any other answer", async () => {
    const error: MarketplaceApiError = await expectMarketplaceError(
      createApi(
        createFakeHttpClient([
          {
            status: 400,
            body: awsError("UnauthorizedException", "Not authorized"),
          },
        ]),
      ).checkPermission({ productCode: PRODUCT_CODE, dimension: "users" }),
    );

    expect(error.code).toBe("UnauthorizedException");
    expect(AwsContainerMeteringAPI.isSetupError(error)).toBe(true);
  });
});

describe("AwsContainerMeteringAPI construction", () => {
  it("needs a Region code, and builds the regional endpoint", () => {
    expect(() => {
      return new AwsContainerMeteringAPI({
        credentials: createCredentials(),
        region: "us_east_1",
      });
    }).toThrow();

    expect(() => {
      return new AwsContainerMeteringAPI({
        credentials: createCredentials(),
        region: "https://metering.example.com",
      });
    }).toThrow();

    expect(AwsContainerMeteringAPI.getEndpointHost("us-east-1")).toBe(
      "metering.marketplace.us-east-1.amazonaws.com",
    );
    expect(AwsContainerMeteringAPI.getEndpointHost(" ap-south-1 ")).toBe(
      "metering.marketplace.ap-south-1.amazonaws.com",
    );
  });
});
