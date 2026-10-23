import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceApiError from "../../CloudMarketplace/MarketplaceApiError";
import GoogleCloudMarketplaceAPI, {
  GoogleCloudServiceControlError,
  GoogleCloudUsageOperation,
} from "../../CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAPI";
import AwsContainerMeteringAPI from "./AwsContainerMeteringAPI";
import AzureKubernetesAppMeteringAPI, {
  AzureUsageEventResult,
} from "./AzureKubernetesAppMeteringAPI";

/*
 * One way to bill a self-hosted OneUptime Enterprise installation through the
 * marketplace it was bought on, by the user-hour: AWS Marketplace (MeterUsage
 * from EKS), Microsoft Marketplace (a custom meter of the AKS Kubernetes
 * application) and Google Cloud Marketplace (Service Control, with the
 * Kubernetes app's reporting secret).
 *
 * Each turns the marketplace's own answer into one of a few outcomes the
 * Enterprise Edition's usage job acts on, so the job never needs to know a
 * marketplace's error names:
 *
 *   accepted      the marketplace took the report and will bill it. It is
 *                 also the marketplace's word that the buyer is subscribed.
 *   not-entitled  the marketplace says the buyer may not use, or can no
 *                 longer be billed for, the product. Not billed.
 *   too-old       the report is older than the marketplace takes. Not
 *                 billed; its usage can ride in a later report.
 *   conflict      the marketplace already holds a different record for the
 *                 same hour. This one is not billed.
 *   setup         the installation is set up wrong (Region, permissions,
 *                 identity, plan, dimension) - an operator must fix it; the
 *                 report is tried again.
 *   retry         no answer about the report (an outage, throttling); tried
 *                 again.
 */

// The one metered dimension (AWS) / custom meter (Azure) / metric (Google).
export const SELF_HOSTED_USAGE_DIMENSION: string = "users";

export interface SelfHostedUsageReport {
  // The start of the hour the usage is for, on the hour.
  hourStart: Date;
  // User-hours: the users in that hour, plus any carried from older hours.
  quantity: number;
  // The same for every attempt at this report, so a retry is the same report.
  idempotencyKey: string;
}

export type SelfHostedUsageOutcome =
  | { kind: "accepted"; reportId: string }
  | { kind: "not-entitled"; detail: string }
  | { kind: "too-old"; detail: string }
  | { kind: "conflict"; detail: string }
  | { kind: "setup"; detail: string }
  | { kind: "retry"; detail: string };

export interface SelfHostedMarketplaceReporter {
  marketplace: CloudMarketplace;
  /*
   * How old a report may be and still be sent on its own, with room to
   * spare: AWS takes six hours, Microsoft 24.
   */
  maxReportAgeInMs: number;
  // Whether a report with quantity 0 may be sent (Microsoft refuses them).
  acceptsZeroQuantity: boolean;
  report(report: SelfHostedUsageReport): Promise<SelfHostedUsageOutcome>;
}

const HOUR_IN_MS: number = 60 * 60 * 1000;

const describeError: (err: unknown) => string = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

export class AwsSelfHostedReporter implements SelfHostedMarketplaceReporter {
  public readonly marketplace: CloudMarketplace = CloudMarketplace.AWS;
  public readonly maxReportAgeInMs: number = 5 * HOUR_IN_MS;
  public readonly acceptsZeroQuantity: boolean = true;

  private api: AwsContainerMeteringAPI;
  private productCode: string;
  private dimension: string;

  public constructor(options: {
    api: AwsContainerMeteringAPI;
    productCode: string;
    dimension?: string | undefined;
  }) {
    this.api = options.api;
    this.productCode = options.productCode;
    this.dimension = options.dimension || SELF_HOSTED_USAGE_DIMENSION;
  }

  public async report(
    report: SelfHostedUsageReport,
  ): Promise<SelfHostedUsageOutcome> {
    try {
      const meteringRecordId: string = await this.api.meterUsage({
        productCode: this.productCode,
        dimension: this.dimension,
        quantity: report.quantity,
        timestamp: report.hourStart,
        clientToken: report.idempotencyKey,
      });

      return { kind: "accepted", reportId: meteringRecordId };
    } catch (err) {
      return AwsSelfHostedReporter.toOutcome(err);
    }
  }

  public static toOutcome(err: unknown): SelfHostedUsageOutcome {
    if (!(err instanceof MarketplaceApiError)) {
      return { kind: "retry", detail: describeError(err) };
    }

    if (AwsContainerMeteringAPI.isNotEntitledError(err)) {
      return { kind: "not-entitled", detail: err.message };
    }

    if (err.code === "TimestampOutOfBoundsException") {
      return { kind: "too-old", detail: err.message };
    }

    if (
      err.code === "DuplicateRequestException" ||
      err.code === "IdempotencyConflictException"
    ) {
      return { kind: "conflict", detail: err.message };
    }

    if (AwsContainerMeteringAPI.isSetupError(err)) {
      return { kind: "setup", detail: err.message };
    }

    return err.isRetryable
      ? { kind: "retry", detail: err.message }
      : { kind: "setup", detail: err.message };
  }
}

export class AzureSelfHostedReporter implements SelfHostedMarketplaceReporter {
  public readonly marketplace: CloudMarketplace = CloudMarketplace.Azure;
  public readonly maxReportAgeInMs: number = 23 * HOUR_IN_MS;
  public readonly acceptsZeroQuantity: boolean = false;

  private api: AzureKubernetesAppMeteringAPI;
  private resourceUri: string;
  private planId: string;
  private dimension: string;

  public constructor(options: {
    api: AzureKubernetesAppMeteringAPI;
    resourceUri: string;
    planId: string;
    dimension?: string | undefined;
  }) {
    this.api = options.api;
    this.resourceUri = options.resourceUri;
    this.planId = options.planId;
    this.dimension = options.dimension || SELF_HOSTED_USAGE_DIMENSION;
  }

  public async report(
    report: SelfHostedUsageReport,
  ): Promise<SelfHostedUsageOutcome> {
    let result: AzureUsageEventResult;

    try {
      result = await this.api.emitUsageEvent({
        resourceUri: this.resourceUri,
        planId: this.planId,
        dimension: this.dimension,
        quantity: report.quantity,
        effectiveStartTime: report.hourStart,
      });
    } catch (err) {
      if (err instanceof MarketplaceApiError && !err.isRetryable) {
        return { kind: "setup", detail: err.message };
      }

      return { kind: "retry", detail: describeError(err) };
    }

    return AzureSelfHostedReporter.toOutcome(result, report.quantity);
  }

  public static toOutcome(
    result: AzureUsageEventResult,
    quantity: number,
  ): SelfHostedUsageOutcome {
    const detail: string = result.message
      ? `${result.status}: ${result.message}`
      : result.status;

    if (result.status === "Accepted") {
      return { kind: "accepted", reportId: result.usageEventId || "accepted" };
    }

    if (result.status === "Duplicate") {
      /*
       * Microsoft keeps the first event of an hour. The same quantity means
       * an earlier attempt at this very report landed; another quantity means
       * the hour was already billed differently.
       */
      if (result.keptQuantity !== null && result.keptQuantity === quantity) {
        return {
          kind: "accepted",
          reportId: result.usageEventId || "duplicate",
        };
      }

      return {
        kind: "conflict",
        detail: `${detail} (Microsoft kept ${result.keptQuantity ?? "another quantity"} for this hour, this report has ${quantity})`,
      };
    }

    if (result.status === "Expired") {
      return { kind: "too-old", detail: detail };
    }

    if (AzureKubernetesAppMeteringAPI.isNotEntitledStatus(result.status)) {
      return { kind: "not-entitled", detail: detail };
    }

    if (AzureKubernetesAppMeteringAPI.isSetupStatus(result.status)) {
      return { kind: "setup", detail: detail };
    }

    return { kind: "retry", detail: detail };
  }
}

/*
 * Service Control's refusals that mean the consumer can no longer be billed:
 * the plan was cancelled, billing turned off or the project deleted.
 */
export const GOOGLE_CLOUD_NOT_ENTITLED_CODES: ReadonlyArray<string> = [
  "SERVICE_NOT_ACTIVATED",
  "BILLING_DISABLED",
  "PROJECT_DELETED",
  "PROJECT_INVALID",
  "CONSUMER_INVALID",
];

/*
 * Service Control report error statuses (gRPC codes) worth sending the same
 * report again for: UNKNOWN, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED, ABORTED,
 * INTERNAL, UNAVAILABLE.
 */
const GOOGLE_CLOUD_RETRYABLE_STATUS_CODES: ReadonlyArray<string> = [
  "2",
  "4",
  "8",
  "10",
  "13",
  "14",
  "UNKNOWN",
  "DEADLINE_EXCEEDED",
  "RESOURCE_EXHAUSTED",
  "ABORTED",
  "INTERNAL",
  "UNAVAILABLE",
];

export class GoogleCloudSelfHostedReporter
  implements SelfHostedMarketplaceReporter
{
  public readonly marketplace: CloudMarketplace = CloudMarketplace.GoogleCloud;
  public readonly maxReportAgeInMs: number = 23 * HOUR_IN_MS;
  public readonly acceptsZeroQuantity: boolean = true;

  private api: GoogleCloudMarketplaceAPI;
  private consumerId: string;
  private metricName: string;

  public constructor(options: {
    api: GoogleCloudMarketplaceAPI;
    // From the reporting secret, passed to Service Control as it is.
    consumerId: string;
    // The metric's full name: <service name>/users.
    metricName: string;
  }) {
    this.api = options.api;
    this.consumerId = options.consumerId;
    this.metricName = options.metricName;
  }

  public async report(
    report: SelfHostedUsageReport,
  ): Promise<SelfHostedUsageOutcome> {
    const operation: GoogleCloudUsageOperation = {
      // The report's own ID: the same on every retry, so Service Control counts it once.
      operationId: report.idempotencyKey,
      operationName: "OneUptime Enterprise usage",
      consumerId: this.consumerId,
      startTime: report.hourStart.toISOString(),
      endTime: new Date(report.hourStart.getTime() + HOUR_IN_MS).toISOString(),
      metricName: this.metricName,
      quantity: report.quantity,
    };

    try {
      const checkErrors: Array<GoogleCloudServiceControlError> =
        await this.api.checkUsage(operation);

      if (checkErrors.length > 0) {
        return GoogleCloudSelfHostedReporter.checkErrorsToOutcome(checkErrors);
      }

      const reportErrors: Array<GoogleCloudServiceControlError> =
        await this.api.reportUsage(operation);

      if (reportErrors.length > 0) {
        return GoogleCloudSelfHostedReporter.reportErrorsToOutcome(
          reportErrors,
        );
      }

      return { kind: "accepted", reportId: report.idempotencyKey };
    } catch (err) {
      if (err instanceof MarketplaceApiError && !err.isRetryable) {
        return { kind: "setup", detail: err.message };
      }

      return { kind: "retry", detail: describeError(err) };
    }
  }

  public static checkErrorsToOutcome(
    errors: Array<GoogleCloudServiceControlError>,
  ): SelfHostedUsageOutcome {
    const detail: string = GoogleCloudSelfHostedReporter.describe(errors);

    if (
      errors.some((error: GoogleCloudServiceControlError): boolean => {
        return GOOGLE_CLOUD_NOT_ENTITLED_CODES.includes(error.code);
      })
    ) {
      return { kind: "not-entitled", detail: detail };
    }

    return { kind: "setup", detail: detail };
  }

  public static reportErrorsToOutcome(
    errors: Array<GoogleCloudServiceControlError>,
  ): SelfHostedUsageOutcome {
    const detail: string = GoogleCloudSelfHostedReporter.describe(errors);

    if (
      errors.every((error: GoogleCloudServiceControlError): boolean => {
        return GOOGLE_CLOUD_RETRYABLE_STATUS_CODES.includes(error.code);
      })
    ) {
      return { kind: "retry", detail: detail };
    }

    return { kind: "setup", detail: detail };
  }

  private static describe(
    errors: Array<GoogleCloudServiceControlError>,
  ): string {
    return errors
      .map((error: GoogleCloudServiceControlError): string => {
        return error.detail ? `${error.code}: ${error.detail}` : error.code;
      })
      .join("; ");
  }
}
