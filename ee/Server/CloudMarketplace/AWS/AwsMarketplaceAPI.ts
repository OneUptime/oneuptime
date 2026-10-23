import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import MarketplaceApiError from "../MarketplaceApiError";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";

/*
 * The AWS Marketplace APIs a SaaS product calls, signed with Signature
 * Version 4 by the signer the AWS Security Hub connector already uses (it is
 * checked against AWS's own test vectors), so no AWS SDK is needed:
 *
 *   - Metering Service: ResolveCustomer (the registration token a buyer
 *     arrives with -> their AWS account and license) and BatchMeterUsage;
 *   - Agreement Service: DescribeAgreement, to confirm an agreement is
 *     active before the buyer's project is billed through it.
 *
 * All three are JSON-RPC: one POST to the service's endpoint, the operation
 * in X-Amz-Target. They are global services, served from us-east-1, and
 * must be called by the seller account that publishes the product.
 *
 * https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_ResolveCustomer.html
 * https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_BatchMeterUsage.html
 * https://docs.aws.amazon.com/marketplace/latest/APIReference/API_marketplace-agreements_DescribeAgreement.html
 */

const REGION: string = "us-east-1";
const SIGNING_SERVICE: string = "aws-marketplace";

interface AwsJsonService {
  host: string;
  targetPrefix: string;
  contentType: string;
}

const METERING_SERVICE: AwsJsonService = {
  host: "metering.marketplace.us-east-1.amazonaws.com",
  targetPrefix: "AWSMPMeteringService",
  contentType: "application/x-amz-json-1.1",
};

const AGREEMENT_SERVICE: AwsJsonService = {
  host: "agreement-marketplace.us-east-1.amazonaws.com",
  targetPrefix: "AWSMPCommerceService_v20200301",
  contentType: "application/x-amz-json-1.0",
};

export interface AwsResolvedCustomer {
  customerAwsAccountId: string;
  licenseArn: string | null;
  productCode: string;
  agreementId: string | null;
}

export interface AwsAgreement {
  agreementId: string;
  status: string;
  acceptorAccountId: string | null;
  offerId: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface AwsUsageRecord {
  customerAwsAccountId: string;
  licenseArn: string;
  dimension: string;
  quantity: number;
  timestamp: Date;
}

export interface AwsUsageRecordResult {
  status: string;
  meteringRecordId: string | null;
}

export default class AwsMarketplaceAPI {
  private accessKeyId: string;
  private secretAccessKey: string;
  private httpClient: MarketplaceHttpClient;
  private now: () => Date;

  public constructor(options: {
    accessKeyId: string;
    secretAccessKey: string;
    httpClient?: MarketplaceHttpClient | undefined;
    now?: (() => Date) | undefined;
  }) {
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.httpClient = options.httpClient || defaultMarketplaceHttpClient;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
  }

  public async resolveCustomer(
    registrationToken: string,
  ): Promise<AwsResolvedCustomer> {
    const body: Record<string, unknown> = await this.call(
      METERING_SERVICE,
      "ResolveCustomer",
      { RegistrationToken: registrationToken },
    );

    const customerAwsAccountId: unknown = body["CustomerAWSAccountId"];
    const productCode: unknown = body["ProductCode"];
    const metadata: unknown = body["Metadata"];

    if (typeof customerAwsAccountId !== "string" || !customerAwsAccountId) {
      throw new MarketplaceApiError({
        message: "ResolveCustomer returned no customer AWS account ID.",
        status: 200,
        isRetryable: false,
      });
    }

    return {
      customerAwsAccountId: customerAwsAccountId,
      licenseArn:
        typeof body["LicenseArn"] === "string" && body["LicenseArn"]
          ? body["LicenseArn"]
          : null,
      productCode: typeof productCode === "string" ? productCode : "",
      agreementId:
        metadata &&
        typeof metadata === "object" &&
        typeof (metadata as Record<string, unknown>)["AgreementId"] === "string"
          ? ((metadata as Record<string, unknown>)["AgreementId"] as string)
          : null,
    };
  }

  public async describeAgreement(
    agreementId: string,
  ): Promise<AwsAgreement | null> {
    let body: Record<string, unknown>;

    try {
      body = await this.call(AGREEMENT_SERVICE, "DescribeAgreement", {
        agreementId: agreementId,
      });
    } catch (err) {
      if (
        err instanceof MarketplaceApiError &&
        (err.status === 404 || err.message.includes("ResourceNotFound"))
      ) {
        return null;
      }

      throw err;
    }

    const readNested: (key: string, field: string) => string | null = (
      key: string,
      field: string,
    ): string | null => {
      const value: unknown = body[key];

      if (!value || typeof value !== "object") {
        return null;
      }

      const nested: unknown = (value as Record<string, unknown>)[field];
      return typeof nested === "string" ? nested : null;
    };

    return {
      agreementId:
        typeof body["agreementId"] === "string"
          ? body["agreementId"]
          : agreementId,
      status: typeof body["status"] === "string" ? body["status"] : "",
      acceptorAccountId: readNested("acceptor", "accountId"),
      offerId: readNested("proposalSummary", "offerId"),
      startTime: AwsMarketplaceAPI.readTimestamp(body["startTime"]),
      endTime: AwsMarketplaceAPI.readTimestamp(body["endTime"]),
    };
  }

  /*
   * One BatchMeterUsage call (at most 25 records). New integrations name the
   * license and the buyer's account in each record and send no product code
   * - a record with both would bill twice. Records AWS could not process
   * come back as "Unprocessed" results, to be sent again.
   */
  public async batchMeterUsage(
    records: Array<AwsUsageRecord>,
  ): Promise<Array<AwsUsageRecordResult>> {
    const body: Record<string, unknown> = await this.call(
      METERING_SERVICE,
      "BatchMeterUsage",
      {
        UsageRecords: records.map((record: AwsUsageRecord) => {
          return {
            CustomerAWSAccountId: record.customerAwsAccountId,
            LicenseArn: record.licenseArn,
            Dimension: record.dimension,
            Quantity: record.quantity,
            Timestamp: Math.floor(record.timestamp.getTime() / 1000),
          };
        }),
      },
    );

    const results: Array<AwsUsageRecordResult> = [];
    const rawResults: unknown = body["Results"];

    if (Array.isArray(rawResults)) {
      for (const raw of rawResults) {
        if (raw && typeof raw === "object") {
          const result: Record<string, unknown> = raw as Record<
            string,
            unknown
          >;
          results.push({
            status:
              typeof result["Status"] === "string" ? result["Status"] : "",
            meteringRecordId:
              typeof result["MeteringRecordId"] === "string"
                ? result["MeteringRecordId"]
                : null,
          });
        }
      }
    }

    const unprocessed: unknown = body["UnprocessedRecords"];

    if (Array.isArray(unprocessed)) {
      for (let index: number = 0; index < unprocessed.length; index++) {
        results.push({ status: "Unprocessed", meteringRecordId: null });
      }
    }

    return results;
  }

  // An awsJson timestamp: seconds since the epoch, possibly fractional.
  private static readTimestamp(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value * 1000).toISOString();
    }

    if (typeof value === "string" && value) {
      return value;
    }

    return null;
  }

  // The exception name of an AWS JSON error ("...#ExpiredTokenException" -> "ExpiredTokenException").
  public static readErrorType(body: string): string {
    const parsed: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(body);
    const type: unknown = parsed?.["__type"] ?? parsed?.["code"];

    if (typeof type !== "string") {
      return "";
    }

    const hashIndex: number = type.lastIndexOf("#");
    return hashIndex === -1 ? type : type.substring(hashIndex + 1);
  }

  private async call(
    service: AwsJsonService,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const body: string = JSON.stringify(payload);

    const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "POST",
      host: service.host,
      path: "/",
      headers: {
        "Content-Type": service.contentType,
        "X-Amz-Target": `${service.targetPrefix}.${operation}`,
      },
      body: body,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: REGION,
      service: SIGNING_SERVICE,
      date: this.now(),
    });

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: `https://${service.host}/`,
        headers: signed.headers,
        body: body,
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `AWS Marketplace ${operation} request failed: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (!MarketplaceHttp.isSuccess(response.status)) {
      const errorType: string = AwsMarketplaceAPI.readErrorType(response.body);

      throw new MarketplaceApiError({
        message: `AWS Marketplace ${operation} failed (HTTP ${response.status}${errorType ? `, ${errorType}` : ""}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable:
          MarketplaceHttp.isRetryable(response.status) ||
          errorType === "ThrottlingException" ||
          errorType === "InternalServiceErrorException",
        body: response.body,
      });
    }

    return MarketplaceHttp.parseJsonObject(response.body) || {};
  }
}
