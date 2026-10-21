import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudMonitoredResource } from "../../../Types/Cloud/CloudMonitoredResource";
import { CloudConnectionTestResult } from "../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

/*
 * THE CONTRACT EVERY CLOUD CONNECTION'S CONNECTOR KEEPS.
 *
 * A connector is stateless: every call receives the decrypted settings and
 * opens its own requests, so one instance serves every connection of every
 * project. The read loop, the "Test connection" route and the save-time
 * validation only ever talk to this interface; a cloud is a few clients, a
 * mapping into OneUptime's metrics and cloud resources, and one class.
 */

/*
 * Decrypted, server-only settings of one connection: `config` holds the
 * catalog's non-secret keys, `secrets` its secret keys. Never serialize
 * this into a response or a log line.
 */
export interface CloudConnectionSettings {
  provider: CloudProvider;
  /*
   * The project the connection belongs to: an AWS role is assumed with
   * this project's external id, never one a request names.
   */
  projectId: string;
  config: JSONObject;
  secrets: JSONObject;
}

/*
 * The HTTP transport every client sends through: the SSRF-guarded
 * DataSourceHttpFetch in production, a fake cloud API in tests.
 */
export type CloudConnectorTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface CloudConnectorCallOptions {
  transport: CloudConnectorTransport;
  // Test seam for "now"; Date.now() when absent.
  now?: (() => Date) | undefined;
  requestTimeoutInMs?: number | undefined;
  // Test seam for waiting before a retry; setTimeout when absent.
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

/*
 * Where the last read got to, kept on the connection between reads
 * (CloudConnection.pullState). Server only; holds no secret.
 */
export interface CloudConnectionPullState {
  /*
   * Per datapoint period, in seconds: where the last metric window ended
   * (exclusive), as an ISO time. The next read starts there, so no
   * datapoint is written twice.
   */
  cursors?: Record<string, string> | undefined;
  // When the resources were last listed (Azure) or swept for (AWS).
  inventoryAt?: string | undefined;
  // AWS: when every Region was last swept for resources.
  fullSweepAt?: string | undefined;
  // AWS: the "region|namespace" pairs that have resources.
  activePairs?: Array<string> | undefined;
  // AWS: Regions the credential cannot use (an opt-in Region not enabled).
  disabledRegions?: Array<string> | undefined;
  /*
   * Azure: each resource type's metrics as its definitions name them, and
   * when they were read.
   */
  azureMetricDefinitions?: JSONObject | undefined;
  // The accounts the last read reached.
  accounts?: Array<string> | undefined;
}

/*
 * A resource the connection already holds (a CloudResource row linked to
 * it): what a read between two listings reads the metrics of.
 */
export interface CloudKnownResource {
  providerResourceId: string;
  resourceType: string;
  name: string;
  region: string;
  accountId: string;
  resourceGroup: string;
}

export interface CloudReadOptions extends CloudConnectorCallOptions {
  state: CloudConnectionPullState;
  // The telemetry service the metrics are written under.
  serviceName: string;
  connectionId: string;
  // Bounds on one read; it stops (complete=false) when one is reached.
  maxRequests: number;
  maxDurationMs: number;
  // The resources the connection holds, for a read that lists none.
  knownResources?: Array<CloudKnownResource> | undefined;
}

// One resource a read saw, with a friendlier name when the cloud has one.
export interface CloudDiscoveredResource {
  resource: CloudMonitoredResource;
  /*
   * What the cloud calls it when that is not its identity: an EC2
   * instance's Name tag, a VM's name in Cloud Monitoring's metadata.
   */
  displayName?: string | undefined;
}

export interface CloudReadResult {
  // What the read reached: an AWS account, subscriptions, projects.
  accounts: Array<string>;
  // Every resource the read saw, listed or reporting metrics.
  resources: Array<CloudDiscoveredResource>;
  /*
   * The accounts whose resources were listed in full by this read (an
   * Azure subscription read to its last page). A resource of one of these
   * accounts that the connection held and that is not in `resources` is
   * gone from the cloud. Empty for a cloud whose resources are found from
   * their metrics (AWS, Google Cloud).
   */
  completelyListedAccounts: Array<string>;
  /*
   * OTLP/JSON metrics exports, each one request's body
   * ({ resourceMetrics: [...] }) in the shape the cloud's OpenTelemetry
   * Collector receiver sends (CloudMetricPayload).
   */
  payloads: Array<JSONObject>;
  pointsWritten: number;
  requestCount: number;
  // Things the person should know that did not stop the read.
  warnings: Array<string>;
  // False when a bound stopped the read before it was done.
  complete: boolean;
  nextState: CloudConnectionPullState;
}

export interface CloudConnector {
  provider: CloudProvider;
  /*
   * Shape checks the catalog's required flags cannot express (a GUID, a
   * Region, a role ARN, a service account key). Throws a
   * BadDataException the person filling the form can act on.
   */
  validateSettings(settings: CloudConnectionSettings): void;
  /*
   * A small real read: is the credential accepted, may it read what the
   * connection needs, and what would a read find. Never throws: failures
   * are a result with status "fail".
   */
  testConnection(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
  ): Promise<CloudConnectionTestResult>;
  // One read. Throws LlmProviderError when it cannot read at all.
  read(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
  ): Promise<CloudReadResult>;
}

// Every secret value of a connection, for redacting what a failure says.
export function getCloudSecretValues(
  settings: CloudConnectionSettings,
): Array<string> {
  const values: Array<string> = [];

  for (const key of Object.keys(settings.secrets || {})) {
    const value: unknown = settings.secrets[key];

    if (typeof value === "string" && value.length > 0) {
      values.push(value);
    }
  }

  return values;
}

// A trimmed string setting, "" when absent or not a string.
export function readCloudSetting(values: JSONObject, key: string): string {
  const value: unknown = values ? values[key] : undefined;

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

/*
 * A read's budget: how many requests and how long it may still take. Each
 * client asks before a request; once spent, the read stops where it is and
 * says so (complete=false), and the next read carries on.
 */
export class CloudReadBudget {
  private requestsLeft: number;
  private deadlineMs: number;
  private spent: boolean = false;
  private used: number = 0;

  public constructor(data: { maxRequests: number; maxDurationMs: number }) {
    this.requestsLeft = Math.max(0, data.maxRequests);
    this.deadlineMs = Date.now() + Math.max(0, data.maxDurationMs);
  }

  // Takes one request from the budget; false when none is left.
  public take(): boolean {
    if (this.requestsLeft <= 0 || Date.now() >= this.deadlineMs) {
      this.spent = true;
      return false;
    }

    this.requestsLeft--;
    this.used++;
    return true;
  }

  public isSpent(): boolean {
    return this.spent;
  }

  // Requests made so far: the calls a read cost the customer's cloud.
  public getUsed(): number {
    return this.used;
  }
}

// A read's budget ran out: the read stops where it is.
export class CloudReadBudgetSpent extends Error {
  public constructor() {
    super("The read reached its limit for this run.");
    this.name = "CloudReadBudgetSpent";
  }
}

export const CLOUD_DEFAULT_SLEEP: (milliseconds: number) => Promise<void> = (
  milliseconds: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
};
