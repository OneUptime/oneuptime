import AwsMarketplaceAPI, {
  AwsAgreement,
  AwsResolvedCustomer,
  AwsUsageRecordResult,
} from "../../../../Server/CloudMarketplace/AWS/AwsMarketplaceAPI";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { MarketplaceHttpRequest } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import AwsSecurityHubClient from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import {
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * The AWS Marketplace APIs OneUptime calls - ResolveCustomer and
 * BatchMeterUsage on the Metering Service, DescribeAgreement on the
 * Agreement Service - are JSON-RPC POSTs signed with Signature Version 4.
 */

// AWS's documentation example credentials - not a real key.
const ACCESS_KEY_ID: string = "AKIDEXAMPLE";
const SECRET_ACCESS_KEY: string = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const NOW: Date = new Date("2026-10-16T09:30:00.000Z");

const LICENSE_ARN: string =
  "arn:aws:license-manager::123456789012:license:l-0123456789abcdef0123456789abcdef";

const createApi: (http: FakeHttpClient) => AwsMarketplaceAPI = (
  http: FakeHttpClient,
): AwsMarketplaceAPI => {
  return new AwsMarketplaceAPI({
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    httpClient: http.client,
    now: (): Date => {
      return NOW;
    },
  });
};

describe("AwsMarketplaceAPI", () => {
  it("resolves a registration token with a signed ResolveCustomer call", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          CustomerAWSAccountId: "123456789012",
          CustomerIdentifier: "",
          LicenseArn: LICENSE_ARN,
          ProductCode: "prod-oneuptime",
          Metadata: { AgreementId: "agmt-0123456789" },
        },
      },
    ]);

    const customer: AwsResolvedCustomer =
      await createApi(http).resolveCustomer("registration-token");

    expect(customer).toEqual({
      customerAwsAccountId: "123456789012",
      licenseArn: LICENSE_ARN,
      productCode: "prod-oneuptime",
      agreementId: "agmt-0123456789",
    });

    const request: MarketplaceHttpRequest = http.requests[0]!;

    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://metering.marketplace.us-east-1.amazonaws.com/",
    );
    expect(JSON.parse(request.body!)).toEqual({
      RegistrationToken: "registration-token",
    });
    expect(request.headers).toMatchObject({
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSMPMeteringService.ResolveCustomer",
      "X-Amz-Date": "20261016T093000Z",
    });

    // Signed for the aws-marketplace service in us-east-1, over exactly what was sent.
    const expected: string = AwsSecurityHubClient.signRequest({
      method: "POST",
      host: "metering.marketplace.us-east-1.amazonaws.com",
      path: "/",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSMPMeteringService.ResolveCustomer",
      },
      body: request.body!,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      region: "us-east-1",
      service: "aws-marketplace",
      date: NOW,
    }).headers["Authorization"]!;

    expect(request.headers!["Authorization"]).toBe(expected);
    expect(expected).toContain(
      `Credential=${ACCESS_KEY_ID}/20261016/us-east-1/aws-marketplace/aws4_request`,
    );
    // The secret itself never leaves the process.
    expect(JSON.stringify(request)).not.toContain(SECRET_ACCESS_KEY);
  });

  it("reads a customer without a license or agreement as such, and refuses one without an account", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: { CustomerAWSAccountId: "123456789012", ProductCode: "prod-x" },
      },
      { status: 200, body: { CustomerIdentifier: "legacy-id" } },
    ]);
    const api: AwsMarketplaceAPI = createApi(http);

    await expect(api.resolveCustomer("t1")).resolves.toEqual({
      customerAwsAccountId: "123456789012",
      licenseArn: null,
      productCode: "prod-x",
      agreementId: null,
    });

    const error: unknown = await api
      .resolveCustomer("t2")
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(MarketplaceApiError);
    expect((error as MarketplaceApiError).isRetryable).toBe(false);
  });

  it("names AWS's exception, and retries only throttling and AWS's own failures", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 400,
        body: {
          __type: "com.amazonaws.marketplace.metering#InvalidTokenException",
          message: "Registration token is invalid",
        },
      },
      {
        status: 400,
        body: { __type: "ThrottlingException", message: "Rate exceeded" },
      },
      {
        status: 500,
        body: { __type: "InternalServiceErrorException" },
      },
      new Error("ETIMEDOUT"),
    ]);
    const api: AwsMarketplaceAPI = createApi(http);

    const errors: Array<MarketplaceApiError> = [];

    for (let index: number = 0; index < 4; index++) {
      errors.push(
        (await api.resolveCustomer("t").catch((err: unknown) => {
          return err;
        })) as MarketplaceApiError,
      );
    }

    expect(errors[0]!.message).toContain("InvalidTokenException");
    expect(errors[0]!.isRetryable).toBe(false);
    expect(errors[0]!.status).toBe(400);

    expect(errors[1]!.isRetryable).toBe(true);
    expect(errors[2]!.isRetryable).toBe(true);
    expect(errors[3]!.isRetryable).toBe(true);
    expect(errors[3]!.status).toBeNull();
  });

  it("describes an agreement through the Agreement Service", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          agreementId: "agmt-0123456789",
          status: "ACTIVE",
          acceptor: { accountId: "123456789012" },
          proposer: { accountId: "999999999999" },
          proposalSummary: { offerId: "offer-abc", resources: [] },
          startTime: 1760000000,
          endTime: "2027-10-16T00:00:00Z",
        },
      },
    ]);

    const agreement: AwsAgreement | null =
      await createApi(http).describeAgreement("agmt-0123456789");

    expect(agreement).toEqual({
      agreementId: "agmt-0123456789",
      status: "ACTIVE",
      acceptorAccountId: "123456789012",
      offerId: "offer-abc",
      startTime: new Date(1760000000 * 1000).toISOString(),
      endTime: "2027-10-16T00:00:00Z",
    });

    expect(http.requests[0]!.url).toBe(
      "https://agreement-marketplace.us-east-1.amazonaws.com/",
    );
    expect(http.requests[0]!.headers).toMatchObject({
      "Content-Type": "application/x-amz-json-1.0",
      "X-Amz-Target": "AWSMPCommerceService_v20200301.DescribeAgreement",
    });
    expect(JSON.parse(http.requests[0]!.body!)).toEqual({
      agreementId: "agmt-0123456789",
    });
  });

  it("answers null for an agreement AWS does not have", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 400,
        body: { __type: "ResourceNotFoundException", message: "not found" },
      },
      { status: 404, body: "" },
      { status: 403, body: { __type: "AccessDeniedException" } },
    ]);
    const api: AwsMarketplaceAPI = createApi(http);

    await expect(api.describeAgreement("agmt-1")).resolves.toBeNull();
    await expect(api.describeAgreement("agmt-2")).resolves.toBeNull();
    await expect(api.describeAgreement("agmt-3")).rejects.toThrow(
      /AccessDeniedException/,
    );
  });

  it("meters usage by license and account, with no product code", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          Results: [
            {
              Status: "Success",
              MeteringRecordId: "mr-1",
              UsageRecord: { Dimension: "usage_units", Quantity: 2200 },
            },
          ],
          UnprocessedRecords: [{ Dimension: "usage_units", Quantity: 5 }],
        },
      },
    ]);

    const results: Array<AwsUsageRecordResult> = await createApi(
      http,
    ).batchMeterUsage([
      {
        customerAwsAccountId: "123456789012",
        licenseArn: LICENSE_ARN,
        dimension: "usage_units",
        quantity: 2200,
        timestamp: new Date("2026-10-16T09:00:00.000Z"),
      },
      {
        customerAwsAccountId: "123456789012",
        licenseArn: LICENSE_ARN,
        dimension: "usage_units",
        quantity: 5,
        timestamp: new Date("2026-10-16T10:00:00.000Z"),
      },
    ]);

    expect(results).toEqual([
      { status: "Success", meteringRecordId: "mr-1" },
      { status: "Unprocessed", meteringRecordId: null },
    ]);

    expect(http.requests[0]!.headers!["X-Amz-Target"]).toBe(
      "AWSMPMeteringService.BatchMeterUsage",
    );

    const sent: Record<string, unknown> = JSON.parse(http.requests[0]!.body!);

    expect(sent).toEqual({
      UsageRecords: [
        {
          CustomerAWSAccountId: "123456789012",
          LicenseArn: LICENSE_ARN,
          Dimension: "usage_units",
          Quantity: 2200,
          Timestamp: Date.UTC(2026, 9, 16, 9) / 1000,
        },
        {
          CustomerAWSAccountId: "123456789012",
          LicenseArn: LICENSE_ARN,
          Dimension: "usage_units",
          Quantity: 5,
          Timestamp: Date.UTC(2026, 9, 16, 10) / 1000,
        },
      ],
    });
    expect(sent).not.toHaveProperty("ProductCode");
  });

  it("reads the exception name out of an AWS JSON error", () => {
    expect(
      AwsMarketplaceAPI.readErrorType(
        JSON.stringify({ __type: "com.amazon#CustomerNotEntitledException" }),
      ),
    ).toBe("CustomerNotEntitledException");
    expect(
      AwsMarketplaceAPI.readErrorType(JSON.stringify({ code: "Throttling" })),
    ).toBe("Throttling");
    expect(AwsMarketplaceAPI.readErrorType("<html>Bad Gateway</html>")).toBe(
      "",
    );
    expect(AwsMarketplaceAPI.readErrorType("")).toBe("");
  });
});
