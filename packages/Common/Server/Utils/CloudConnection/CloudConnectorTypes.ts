import { CloudResourceRelationship } from "../../../Types/Cloud/CloudInventory";
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
  // When the inventory last listed every resource (CloudInventory).
  inventoryListedAt?: string | undefined;
  /*
   * Per account and place ("123456789012|us-east-1"), the newest change
   * the last read of the cloud's activity log brought in, as an ISO time.
   */
  changeCursors?: Record<string, string> | undefined;
  // When the provider's health events were last read.
  healthReadAt?: string | undefined;
  // When the accounts' billing was last read.
  costReadAt?: string | undefined;
  /*
   * A connection that reads a whole organization: its accounts as last
   * listed (id and name), when they were listed, and each account's own
   * read state - its Regions, its cursors - by account id.
   */
  organizationAccounts?: Array<{ id: string; name: string }> | undefined;
  organizationListedAt?: string | undefined;
  accountStates?: Record<string, CloudConnectionPullState> | undefined;
  /*
   * Per place, the changes the next read may bring in again, each id with
   * its time (epoch ms): the activity logs deliver late, so each read looks
   * back over what the last one saw, and these keep a change from being
   * written twice.
   */
  recentChanges?: Record<string, Record<string, number>> | undefined;
  // Until when the provider's health events are not read again (no access).
  healthPausedUntil?: string | undefined;
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

/*
 * One resource an inventory listed (CloudInventory): who it is - the same
 * identity its metrics give it, so both are one row - and what the cloud's
 * own index says of it.
 */
export interface CloudInventoryItem {
  resource: CloudMonitoredResource;
  // Its name in the cloud when that is not its identity: a Name tag.
  displayName?: string | undefined;
  tags: Record<string, string>;
  properties: JSONObject;
  relationships: Array<CloudResourceRelationship>;
  endpoints: Array<string>;
}

// An account an inventory reached, with the name its cloud gives it.
export interface CloudInventoryAccount {
  accountId: string;
  // An AWS account alias, an Azure subscription's or a project's name.
  name?: string | undefined;
}

export interface CloudInventoryOptions extends CloudConnectorCallOptions {
  state: CloudConnectionPullState;
  connectionId: string;
  budget: CloudReadBudget;
}

export interface CloudInventoryResult {
  accounts: Array<CloudInventoryAccount>;
  items: Array<CloudInventoryItem>;
  /*
   * Per account, the types listed to their last page in every place they
   * live. A resource of one of them the connection holds and the listing
   * does not have is gone from the cloud.
   */
  completelyListed: Array<{ accountId: string; resourceTypes: Array<string> }>;
  warnings: Array<string>;
  // False when the budget stopped the listing part way.
  complete: boolean;
}

/*
 * One change a cloud account's activity log recorded - AWS CloudTrail, the
 * Azure Activity Log, Google Cloud's Admin Activity audit log - or one
 * health event its provider published (CloudChangeRecorder).
 */
export interface CloudChange {
  kind: "change" | "health";
  provider: CloudProvider;
  accountId: string;
  // The Region it happened in; "" for a global service.
  region: string;
  time: Date;
  /*
   * The provider's id for the event: CloudTrail's EventId, Azure's
   * eventDataId, Google Cloud's insertId, a health event's id with its
   * status. A change event is written once per id.
   */
  eventId: string;
  /*
   * What was done, as the cloud names it: "ec2:AuthorizeSecurityGroupIngress",
   * "Microsoft.Network/networkSecurityGroups/write",
   * "v1.compute.instances.stop" - or a health event's type.
   */
  operation: string;
  // Who did it: an IAM user or role, an Azure caller, a Google principal.
  actor: string;
  /*
   * What it changed, as the cloud names it: an ARN, an ARM id, a full
   * resource name, or a plain id with its type ("sg-0abc", AWS::EC2::SecurityGroup).
   */
  resources: Array<{ id: string; type?: string | undefined }>;
  failed: boolean;
  // A health event's own title and description, as the provider wrote them.
  title?: string | undefined;
  description?: string | undefined;
}

export interface CloudChangesOptions extends CloudConnectorCallOptions {
  /*
   * Moved on as the connector reads: changeCursors, recentChanges and
   * healthReadAt.
   */
  state: CloudConnectionPullState;
  connectionId: string;
  budget: CloudReadBudget;
  /*
   * Read from this time, not from the cursors, and move no cursor: an
   * investigation's look back over the accounts it names in `only`.
   */
  since?: Date | undefined;
  only?:
    | Array<{ accountId: string; regions?: Array<string> | undefined }>
    | undefined;
}

export interface CloudChangesResult {
  changes: Array<CloudChange>;
  warnings: Array<string>;
  complete: boolean;
}

export interface CloudConnector {
  provider: CloudProvider;
  /*
   * What changed in the connection's accounts since the last read, and the
   * provider's health events about them. Optional, like the inventory.
   */
  readChanges?(
    settings: CloudConnectionSettings,
    options: CloudChangesOptions,
  ): Promise<CloudChangesResult>;
  /*
   * Lists every resource of the connection's accounts from the cloud's own
   * index, with tags, properties, relationships and endpoints. Optional: a
   * connector without it is read from its metrics alone.
   */
  readInventory?(
    settings: CloudConnectionSettings,
    options: CloudInventoryOptions,
  ): Promise<CloudInventoryResult>;
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
