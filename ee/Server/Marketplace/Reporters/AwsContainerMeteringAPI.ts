import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import AwsMarketplaceAPI from "../../CloudMarketplace/AWS/AwsMarketplaceAPI";
import MarketplaceApiError from "../../CloudMarketplace/MarketplaceApiError";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import AwsWorkloadCredentialsProvider, {
  AwsWorkloadCredentials,
} from "./AwsWorkloadCredentials";

/*
 * The AWS Marketplace Metering Service as the self-hosted container product
 * calls it: MeterUsage, from the buyer's Amazon EKS cluster, signed with the
 * credentials of the IAM role on OneUptime's Kubernetes service account
 * (IAM roles for service accounts - AWS refuses EKS Pod Identity, the node
 * role and long-term keys for this call), at the Metering Service endpoint
 * of the Region the pod runs in (any other Region answers
 * InvalidEndpointRegionException).
 *
 * AWS takes one record per dimension, hour and pod, rounding the timestamp
 * down to the hour, and nothing older than six hours. Sending the same
 * record again from the same pod returns the record AWS kept; a record for
 * the same hour from another pod is a second record, which is why each
 * record carries a ClientToken the caller derives from the installation and
 * the hour - a retry from any pod is then the same request.
 *
 * https://docs.aws.amazon.com/marketplace/latest/APIReference/API_marketplace-metering_MeterUsage.html
 * https://docs.aws.amazon.com/marketplace/latest/userguide/container-metering-meterusage.html
 */

const SIGNING_SERVICE: string = "aws-marketplace";
const TARGET_PREFIX: string = "AWSMPMeteringService";
const CONTENT_TYPE: string = "application/x-amz-json-1.1";

// The longest ClientToken AWS takes.
export const AWS_METER_USAGE_CLIENT_TOKEN_MAX_LENGTH: number = 64;

// The product codes AWS issues (MeterUsage's ProductCode pattern, never empty).
const AWS_PRODUCT_CODE_PATTERN: RegExp = /^[-a-zA-Z0-9/=:_.@]{1,255}$/;

// The largest UsageQuantity AWS takes.
export const AWS_METER_USAGE_MAX_QUANTITY: number = 2147483647;

export interface AwsMeterUsageRecord {
  productCode: string;
  dimension: string;
  // A whole number, 0 or more.
  quantity: number;
  // The hour the usage is for; AWS rounds it down to the hour.
  timestamp: Date;
  // The same token for every attempt at the same record.
  clientToken: string;
}

/*
 * Errors that mean the buyer's account may not use the product (or never
 * subscribed): the marketplace's "no", as opposed to a setup mistake or an
 * outage.
 */
export const AWS_NOT_ENTITLED_ERROR_CODES: ReadonlyArray<string> = [
  "CustomerNotEntitledException",
  "CustomerNotSubscribedException",
];

/*
 * Errors that mean the installation is set up wrong - the wrong Region, no
 * permission, a product code or dimension AWS does not know - which an
 * operator must fix. Not a "no" from the marketplace about the buyer.
 */
export const AWS_SETUP_ERROR_CODES: ReadonlyArray<string> = [
  "InvalidEndpointRegionException",
  "InvalidProductCodeException",
  "InvalidUsageDimensionException",
  "PlatformNotSupportedException",
  "UnauthorizedException",
  "AccessDeniedException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "ExpiredTokenException",
];

export default class AwsContainerMeteringAPI {
  private credentials: AwsWorkloadCredentialsProvider;
  private region: string;
  private httpClient: MarketplaceHttpClient;
  private now: () => Date;

  public constructor(options: {
    credentials: AwsWorkloadCredentialsProvider;
    region: string;
    httpClient?: MarketplaceHttpClient | undefined;
    now?: (() => Date) | undefined;
  }) {
    AwsSecurityHubClient.validateRegion(options.region);

    this.credentials = options.credentials;
    this.region = options.region.trim();
    this.httpClient = options.httpClient || defaultMarketplaceHttpClient;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
  }

  // The Metering Service endpoint of `region`.
  public static getEndpointHost(region: string): string {
    const trimmed: string = region.trim();
    const suffix: string = trimmed.startsWith("cn-")
      ? "amazonaws.com.cn"
      : "amazonaws.com";

    return `metering.marketplace.${trimmed}.${suffix}`;
  }

  public getEndpointHost(): string {
    return AwsContainerMeteringAPI.getEndpointHost(this.region);
  }

  /*
   * Sends one record and returns the metering record ID AWS gave it. Throws
   * MarketplaceApiError with AWS's error name in `code`.
   */
  public async meterUsage(record: AwsMeterUsageRecord): Promise<string> {
    AwsContainerMeteringAPI.validateRecord(record);

    const body: Record<string, unknown> = await this.call("MeterUsage", {
      ProductCode: record.productCode,
      Timestamp: Math.floor(record.timestamp.getTime() / 1000),
      UsageDimension: record.dimension,
      UsageQuantity: record.quantity,
      ClientToken: record.clientToken,
    });

    const meteringRecordId: unknown = body["MeteringRecordId"];

    if (typeof meteringRecordId !== "string" || !meteringRecordId) {
      throw new MarketplaceApiError({
        message: "AWS MeterUsage answered without a metering record ID.",
        status: 200,
        isRetryable: true,
      });
    }

    return meteringRecordId;
  }

  /*
   * Whether this pod may meter the product: a DryRun MeterUsage, which AWS
   * answers DryRunOperation when it would have taken the record. Throws the
   * error AWS gave otherwise.
   */
  public async checkPermission(data: {
    productCode: string;
    dimension: string;
  }): Promise<void> {
    try {
      await this.call("MeterUsage", {
        ProductCode: data.productCode,
        Timestamp: Math.floor(this.now().getTime() / 1000),
        UsageDimension: data.dimension,
        UsageQuantity: 0,
        DryRun: true,
      });
    } catch (err) {
      if (
        err instanceof MarketplaceApiError &&
        err.code === "DryRunOperation"
      ) {
        return;
      }

      throw err;
    }
  }

  public static isNotEntitledError(err: unknown): boolean {
    return (
      err instanceof MarketplaceApiError &&
      AWS_NOT_ENTITLED_ERROR_CODES.includes(err.code)
    );
  }

  public static isSetupError(err: unknown): boolean {
    return (
      err instanceof MarketplaceApiError &&
      AWS_SETUP_ERROR_CODES.includes(err.code)
    );
  }

  public static validateRecord(record: AwsMeterUsageRecord): void {
    const problems: Array<string> = [];

    if (!AWS_PRODUCT_CODE_PATTERN.test(record.productCode || "")) {
      problems.push("the product code is not one AWS could have issued");
    }

    if (!record.dimension || record.dimension.length > 255) {
      problems.push("the dimension must be 1-255 characters");
    }

    if (
      !Number.isInteger(record.quantity) ||
      record.quantity < 0 ||
      record.quantity > AWS_METER_USAGE_MAX_QUANTITY
    ) {
      problems.push(
        `the quantity must be a whole number from 0 to ${AWS_METER_USAGE_MAX_QUANTITY}`,
      );
    }

    if (
      !(record.timestamp instanceof Date) ||
      Number.isNaN(record.timestamp.getTime())
    ) {
      problems.push("the timestamp is not a date");
    }

    if (
      !record.clientToken ||
      record.clientToken.length > AWS_METER_USAGE_CLIENT_TOKEN_MAX_LENGTH
    ) {
      problems.push(
        `the client token must be 1-${AWS_METER_USAGE_CLIENT_TOKEN_MAX_LENGTH} characters`,
      );
    }

    if (problems.length > 0) {
      throw new MarketplaceApiError({
        message: `Refusing to send an AWS MeterUsage record: ${problems.join("; ")}.`,
        status: null,
        isRetryable: false,
      });
    }
  }

  private async call(
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const credentials: AwsWorkloadCredentials =
      await this.credentials.getCredentials();
    const host: string = this.getEndpointHost();
    const body: string = JSON.stringify(payload);

    const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "POST",
      host: host,
      path: "/",
      headers: {
        "Content-Type": CONTENT_TYPE,
        "X-Amz-Target": `${TARGET_PREFIX}.${operation}`,
      },
      body: body,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken || undefined,
      region: this.region,
      service: SIGNING_SERVICE,
      date: this.now(),
    });

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: `https://${host}/`,
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

      if (
        errorType === "ExpiredTokenException" ||
        errorType === "UnrecognizedClientException"
      ) {
        // The cached session is no good any more; the next attempt gets a new one.
        this.credentials.invalidate();
      }

      throw new MarketplaceApiError({
        message: `AWS Marketplace ${operation} failed (HTTP ${response.status}${errorType ? `, ${errorType}` : ""}): ${MarketplaceHttp.summarize(response.body)}`,
        status: response.status,
        isRetryable:
          MarketplaceHttp.isRetryable(response.status) ||
          errorType === "ThrottlingException" ||
          errorType === "InternalServiceErrorException" ||
          errorType === "ExpiredTokenException",
        body: response.body,
        code: errorType,
      });
    }

    return MarketplaceHttp.parseJsonObject(response.body) || {};
  }
}
