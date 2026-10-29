import {
  CloudHttpResponse,
  CloudSender,
  isPlainObject,
  parseJsonBody,
  readArray,
  readInteger,
  readObject,
  readString,
} from "./CloudHttp";
import {
  AUTOSCALING_API_VERSION,
  AWS_ACCOUNT_PATTERN,
  AwsClient,
  EC2_API_VERSION,
  RDS_API_VERSION,
  awsDnsSuffix,
  partitionOfArn,
  readAwsTagList,
  readAwsXmlTags,
} from "./AwsApi";
import {
  AwsAssumedRole,
  AwsCallerIdentity,
  AwsCredentialProvider,
  AwsCredentials,
  assumeAwsWriteRole,
  buildAwsSessionPolicy,
  buildRoleSessionName,
  getAwsCallerIdentity,
  readAwsRegion,
} from "./AwsCredentials";
import {
  CloudChangeOutcome,
  CloudCommandRun,
  CloudRuntime,
  arrow,
  boundsOf,
  withArticle,
} from "./CloudChange";
import { CloudAgentSettings } from "./CloudSettings";
import {
  XmlElement,
  xmlChild,
  xmlChildren,
  xmlFind,
  xmlText,
} from "./CloudXml";
import {
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_CLOUD_OPERATIONS_ENV,
} from "../../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  CloudParamValue,
  ParsedCloudCommand,
} from "../../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The AWS Cloud AI agent: each catalog change on each kind of AWS
 * resource, as the ONE API call it maps to, after the reads that decide
 * whether it may run and what it replaces. See CloudExecutor for the
 * contract; what AWS adds:
 *
 *   - Every call of a change is signed with the change's own credentials:
 *     with ONEUPTIME_AI_AWS_WRITE_ROLE_ARN, a session of the write role
 *     assumed for this change alone, whose session policy allows only the
 *     catalog's permissions for it (its changes on its one resource, its
 *     reads on "*"); without it, the agent's base credentials, which
 *     whoami and the posture say.
 *   - The principal a change acts as must be in the account the agent
 *     serves: the assumed role's account, or the base credentials' when
 *     there is no write role.
 *   - The Region is the ARN's.
 *
 * Where a change reads tags that the catalog's permissions do not cover
 * (Lambda's ListTags, SQS's ListQueueTags), the session policy adds that
 * read only while ONEUPTIME_AI_CLOUD_REQUIRED_TAG is set.
 */

export const ECS_TARGET_PREFIX: string = "AmazonEC2ContainerServiceV20141113";
export const APPLICATION_AUTOSCALING_TARGET_PREFIX: string =
  "AnyScaleFrontendService";
export const SQS_TARGET_PREFIX: string = "AmazonSQS";

// Pages of a list read before the agent gives up looking.
export const MAX_AWS_LIST_PAGES: number = 20;
export const LAMBDA_VERSIONS_PAGE_SIZE: number = 50;
// A dead-letter queue redriven to more source queues than this is left to a person.
export const MAX_REDRIVE_SOURCE_QUEUES: number = 10;

// Probe calls give up after this long (inside the posture's 15-second budget).
export const AWS_PROBE_CALL_TIMEOUT_MS: number = 5_000;

const WHOLE_NUMBER_PATTERN: RegExp = /^[0-9]{1,9}$/;
// An ECS cluster, service or task definition family name.
const ECS_NAME_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,255}$/;
const SQS_QUEUE_NAME_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,80}(?:\.fifo)?$/;
const HTTP_URL_PATTERN: RegExp = /^https?:\/\//;

// The ECS task metadata endpoint (protected targets, the agent's Region).
export const ECS_CONTAINER_METADATA_URI_V4_ENV: string =
  "ECS_CONTAINER_METADATA_URI_V4";

export interface AwsCloudOptions {
  env: NodeJS.ProcessEnv;
  runtime: CloudRuntime;
  // A fresh 8-hex-digit id for each write session's name.
  randomId: () => string;
  readFile?: ((path: string) => string) | undefined;
}

export interface AwsProbe {
  reachable: boolean;
  reachError: string | null;
  account: string | null;
  principalArn: string | null;
  region: string | null;
  // Targets found where the agent runs (its own ECS service).
  detectedTargets: Array<string>;
}

interface EcsService {
  arn: string;
  name: string;
  cluster: string;
  status: string;
  desiredCount: number;
  runningCount: number;
  taskDefinition: string;
  tags: Record<string, string>;
}

interface Ec2Instance {
  state: string;
  tags: Record<string, string>;
}

interface RdsInstance {
  status: string;
  multiAz: boolean;
  availabilityZone: string;
  secondaryAvailabilityZone: string;
  clusterIdentifier: string;
  tags: Record<string, string>;
}

function integerText(value: string | null): number | null {
  return value !== null && WHOLE_NUMBER_PATTERN.test(value)
    ? parseInt(value, 10)
    : null;
}

// "arn:aws:ecs:us-east-1:1:task-definition/web:41" -> {family: "web", revision: 41}.
export function parseTaskDefinitionArn(
  value: string,
): { family: string; revision: number } | null {
  const slash: number = value.lastIndexOf("/");
  const tail: string = slash >= 0 ? value.slice(slash + 1) : value;
  const colon: number = tail.lastIndexOf(":");

  if (colon <= 0) {
    return null;
  }

  const revision: number | null = integerText(tail.slice(colon + 1));
  const family: string = tail.slice(0, colon);

  return revision !== null && ECS_NAME_PATTERN.test(family)
    ? { family, revision }
    : null;
}

// arn:aws:sqs:us-east-1:123456789012:jobs-dlq -> its queue URL.
export function sqsQueueUrl(data: {
  region: string;
  account: string;
  name: string;
}): string {
  return `https://sqs.${data.region}.${awsDnsSuffix(data.region)}/${data.account}/${data.name}`;
}

// A queue URL -> {account, name}, or null.
export function parseSqsQueueUrl(
  url: string,
): { host: string; account: string; name: string } | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const parts: Array<string> = parsed.pathname.split("/").filter(Boolean);

  if (
    parsed.protocol !== "https:" ||
    parts.length !== 2 ||
    !AWS_ACCOUNT_PATTERN.test(parts[0] || "") ||
    !SQS_QUEUE_NAME_PATTERN.test(parts[1] || "")
  ) {
    return null;
  }

  return {
    host: parsed.hostname,
    account: parts[0] || "",
    name: parts[1] || "",
  };
}

export default class AwsCloud {
  private readonly credentials: AwsCredentialProvider;
  private caller: { accessKeyId: string; identity: AwsCallerIdentity } | null =
    null;
  private detectedTargets: Array<string> | null = null;
  private metadataRegion: string | null = null;

  public constructor(private readonly options: AwsCloudOptions) {
    this.credentials = new AwsCredentialProvider(
      options.env,
      options.runtime.nowMs,
      options.readFile,
    );
  }

  // The agent's own Region: AWS_REGION / AWS_DEFAULT_REGION, else its task's.
  public region(): string | null {
    return readAwsRegion(this.options.env) || this.metadataRegion;
  }

  public describeCredentialSource(): string {
    return this.credentials.describeSource();
  }

  // Targets found where the agent runs (its own ECS service), once known.
  public getDetectedTargets(): Array<string> {
    return this.detectedTargets ? this.detectedTargets.slice() : [];
  }

  // The base credentials' account (STS GetCallerIdentity).
  public async resolveAccount(send: CloudSender): Promise<string> {
    return (await this.callerIdentity(send)).account;
  }

  // The base credentials' identity, asked once per set of credentials.
  public async callerIdentity(send: CloudSender): Promise<AwsCallerIdentity> {
    const base: AwsCredentials = await this.credentials.get(send);

    if (this.caller && this.caller.accessKeyId === base.accessKeyId) {
      return this.caller.identity;
    }

    const identity: AwsCallerIdentity = await getAwsCallerIdentity({
      send,
      credentials: base,
      region: this.region(),
      nowMs: this.options.runtime.nowMs,
      userAgent: this.options.runtime.userAgent,
    });

    this.caller = { accessKeyId: base.accessKeyId, identity };
    return identity;
  }

  // ---- Posture --------------------------------------------------------------------

  public async probe(data: {
    send: CloudSender;
    accountId: string | null;
    settings: CloudAgentSettings;
  }): Promise<AwsProbe> {
    await this.detectEcsTask(data.send);

    const probe: AwsProbe = {
      reachable: false,
      reachError: null,
      account: null,
      principalArn: null,
      region: this.region(),
      detectedTargets: this.getDetectedTargets(),
    };

    try {
      const identity: AwsCallerIdentity = await this.callerIdentity(data.send);

      probe.account = identity.account;
      probe.principalArn = identity.arn;
    } catch (err: unknown) {
      probe.reachError = `The AWS Cloud AI agent could not ask AWS who it is (STS GetCallerIdentity with ${this.credentials.describeSource()}): ${
        err instanceof Error ? err.message : String(err)
      }`;
      return probe;
    }

    if (
      data.accountId &&
      probe.account !== data.accountId &&
      !data.settings.awsWriteRoleArn
    ) {
      probe.reachError = `The agent's AWS credentials are for account ${probe.account}, but it serves account ${data.accountId}: it can change nothing there. Run it in account ${data.accountId}, or set ${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV} to a role of that account.`;
      return probe;
    }

    probe.reachable = true;
    return probe;
  }

  /*
   * Where the agent runs, from the ECS task metadata endpoint (once): its
   * own service (or, when the task does not say which, every service of
   * its cluster) is protected, and its Region is the task's.
   */
  private async detectEcsTask(send: CloudSender): Promise<void> {
    if (this.detectedTargets !== null) {
      return;
    }

    const base: string = (
      this.options.env[ECS_CONTAINER_METADATA_URI_V4_ENV] || ""
    ).trim();

    if (!base) {
      this.detectedTargets = [];
      return;
    }

    if (!HTTP_URL_PATTERN.test(base)) {
      this.detectedTargets = [];
      return;
    }

    let response: CloudHttpResponse;

    try {
      response = await send({
        method: "GET",
        url: `${base.replace(/\/+$/, "")}/task`,
        headers: { Accept: "application/json" },
        body: null,
      });
    } catch {
      // Asked again at the next probe.
      return;
    }

    const task: unknown = parseJsonBody(response);

    if (response.status !== 200 || !isPlainObject(task)) {
      return;
    }

    const taskArn: string = readString(task, "TaskARN") || "";
    const clusterField: string = readString(task, "Cluster") || "";
    const serviceName: string = readString(task, "ServiceName") || "";
    const taskFields: Array<string> = taskArn.split(":");
    const region: string = taskFields[3] || "";
    const account: string = taskFields[4] || "";
    const partition: string = taskFields[1] || "aws";
    const clusterName: string = clusterField.startsWith("arn:")
      ? clusterField.slice(clusterField.lastIndexOf("/") + 1)
      : clusterField;
    const targets: Array<string> = [];

    if (region && AWS_ACCOUNT_PATTERN.test(account) && clusterName) {
      targets.push(
        `arn:${partition}:ecs:${region}:${account}:service/${clusterName}/${
          ECS_NAME_PATTERN.test(serviceName) ? serviceName : "*"
        }`,
      );
    }

    if (region && !this.metadataRegion) {
      this.metadataRegion = region;
    }

    this.detectedTargets = targets;
  }

  // ---- whoami -------------------------------------------------------------------------

  public async whoami(data: {
    run: CloudCommandRun;
    accountId: string;
  }): Promise<Array<string>> {
    const run: CloudCommandRun = data.run;
    const send: CloudSender = run.send.bind(run);
    const identity: AwsCallerIdentity = await run.read(
      "who the agent is (STS GetCallerIdentity)",
      (): Promise<AwsCallerIdentity> => {
        return this.callerIdentity(send);
      },
    );
    const settings: CloudAgentSettings = run.settings;
    const lines: Array<string> = [
      `Account: ${data.accountId}`,
      `Signed in as: ${identity.arn} (${this.credentials.describeSource()})`,
      `Region: ${this.region() || "not set (AWS_REGION); STS is called on its global endpoint, and each change in its resource's Region"}`,
    ];

    if (identity.account !== data.accountId && !settings.awsWriteRoleArn) {
      lines.push(
        `Warning: these credentials are for account ${identity.account}, not ${data.accountId}, so every change is refused.`,
      );
    }

    if (settings.awsWriteRoleProblem) {
      lines.push(`Write role: ${settings.awsWriteRoleProblem}`);
    } else if (settings.awsWriteRoleArn) {
      lines.push(
        `Write role: ${settings.awsWriteRoleArn}, assumed for each change with a session policy that allows that change alone (${await this.checkWriteRole(
          run,
          settings.awsWriteRoleArn,
        )})`,
      );
    } else {
      lines.push(
        `Write role: none (${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV} is not set): changes use the agent's own credentials, with whatever they allow`,
      );
    }

    return lines;
  }

  // Whether the agent can assume the write role: with a session policy that allows nothing.
  private async checkWriteRole(
    run: CloudCommandRun,
    roleArn: string,
  ): Promise<string> {
    try {
      const base: AwsCredentials = await this.credentials.get(
        run.send.bind(run),
      );
      const assumed: AwsAssumedRole = await assumeAwsWriteRole({
        send: run.send.bind(run),
        base,
        roleArn,
        sessionName: buildRoleSessionName("whoami", this.options.randomId()),
        policy: buildAwsSessionPolicy({ permissions: [], writeResources: [] }),
        region: this.region(),
        nowMs: this.options.runtime.nowMs,
        userAgent: this.options.runtime.userAgent,
      });

      return `the agent can assume it, as ${assumed.assumedRoleArn}`;
    } catch (err: unknown) {
      return `the agent could NOT assume it, so every change fails: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  // ---- Changes ------------------------------------------------------------------------

  public async change(data: {
    run: CloudCommandRun;
    accountId: string;
  }): Promise<CloudChangeOutcome> {
    const change: AwsChange = new AwsChange(this, data.run, data.accountId);
    const kind: string = data.run.command.resource?.kind || "";

    switch (`${data.run.command.operation.name}/${kind}`) {
      case "restart-service/ecs-service":
        return change.restartEcsService();
      case "scale-out/ecs-service":
      case "scale-in/ecs-service":
        return change.scaleEcsService();
      case "roll-back-service/ecs-service":
        return change.rollBackEcsService();
      case "scale-out/autoscaling-group":
      case "scale-in/autoscaling-group":
        return change.scaleAutoScalingGroup();
      case "start-instance/ec2-instance":
      case "stop-instance/ec2-instance":
      case "reboot-instance/ec2-instance":
        return change.changeEc2Instance();
      case "start-instance/rds-instance":
      case "reboot-instance/rds-instance":
      case "fail-over-database/rds-instance":
        return change.changeRdsInstance();
      case "fail-over-database/rds-cluster":
        return change.failOverRdsCluster();
      case "set-concurrency/lambda-function":
        return change.setLambdaConcurrency();
      case "roll-back-service/lambda-alias":
        return change.rollBackLambdaAlias();
      case "redrive-queue/sqs-queue":
        return change.redriveQueue();
      default:
        return data.run.refuse(
          `the AWS Cloud AI agent has no implementation of cloud ${data.run.command.operation.name} for ${withArticle(data.run.kindName)}`,
        );
    }
  }

  // ---- For AwsChange ------------------------------------------------------------------

  public getBaseCredentials(send: CloudSender): Promise<AwsCredentials> {
    return this.credentials.get(send);
  }

  public getOptions(): AwsCloudOptions {
    return this.options;
  }
}

// One change: its credentials, its calls and its checks.
class AwsChange {
  private readonly command: ParsedCloudCommand;
  private readonly region: string;
  private readonly send: CloudSender;
  private readonly clients: Map<string, AwsClient> = new Map<
    string,
    AwsClient
  >();
  // Who the change acts as, for the output.
  private actingAs: string = "";

  public constructor(
    private readonly cloud: AwsCloud,
    private readonly run: CloudCommandRun,
    private readonly accountId: string,
  ) {
    this.command = run.command;
    this.region = run.command.resource?.region || "";
    this.send = run.send.bind(run);

    if (!this.region) {
      run.refuse(`${run.resourceId} names no AWS Region`);
    }
  }

  private get settings(): CloudAgentSettings {
    return this.run.settings;
  }

  private get partition(): string {
    return partitionOfArn(this.run.resourceId);
  }

  // The IAM actions this change's session may use.
  private permissions(): Array<string> {
    const permissions: Array<string> = [...this.command.kindSpec.permissions];
    const kind: string = this.command.resource?.kind || "";

    if (this.settings.requiredTag) {
      if (kind === "lambda-function" || kind === "lambda-alias") {
        permissions.push("lambda:ListTags");
      }

      if (kind === "sqs-queue") {
        permissions.push("sqs:ListQueueTags");
      }
    }

    return permissions;
  }

  /*
   * The client this change signs with: the write role assumed for it, with
   * a session policy allowing its changes on writeResources only (none:
   * its reads alone), or the base credentials. A dry run's session allows
   * the reads alone, whatever the change would write: it cannot write even
   * by mistake.
   */
  private async client(requested: Array<string>): Promise<AwsClient> {
    const writeResources: Array<string> = this.run.dryRun ? [] : requested;
    const key: string = writeResources.join(" ");
    const known: AwsClient | undefined = this.clients.get(key);

    if (known) {
      return known;
    }

    const options: AwsCloudOptions = this.cloud.getOptions();
    const base: AwsCredentials = await this.run.read(
      "for the agent's credentials",
      (): Promise<AwsCredentials> => {
        return this.cloud.getBaseCredentials(this.send);
      },
    );
    const roleArn: string | null = this.settings.awsWriteRoleArn;
    let credentials: AwsCredentials = base;
    let identityName: string;

    if (roleArn) {
      const policy: string = buildAwsSessionPolicy({
        permissions: this.permissions(),
        writeResources,
      });
      const assumed: AwsAssumedRole = await this.run.read(
        `for a session of the write role ${roleArn} (STS AssumeRole)`,
        (): Promise<AwsAssumedRole> => {
          return assumeAwsWriteRole({
            send: this.send,
            base,
            roleArn,
            sessionName: buildRoleSessionName(
              this.run.dryRun
                ? `dry-run-${this.command.operation.name}`
                : this.command.operation.name,
              options.randomId(),
            ),
            policy,
            region: this.cloud.region() || this.region,
            nowMs: options.runtime.nowMs,
            userAgent: options.runtime.userAgent,
          });
        },
      );

      if (assumed.account !== this.accountId) {
        this.run.refuse(
          `the write role ${roleArn} acts in account ${assumed.account}, but the agent serves account ${this.accountId}, so nothing was changed. Set ${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV} to a role of account ${this.accountId}.`,
        );
      }

      credentials = assumed.credentials;
      identityName = `the write role session ${assumed.assumedRoleArn}`;
      this.actingAs = this.run.dryRun
        ? `${assumed.assumedRoleArn} (the write role, with a session policy that only reads: a dry run)`
        : `${assumed.assumedRoleArn} (the write role, with a session policy for this change alone)`;
    } else {
      const identity: AwsCallerIdentity = await this.run.read(
        "who the agent is (STS GetCallerIdentity)",
        (): Promise<AwsCallerIdentity> => {
          return this.cloud.callerIdentity(this.send);
        },
      );

      if (identity.account !== this.accountId) {
        this.run.refuse(
          `the agent's AWS credentials are for account ${identity.account}, but it serves account ${this.accountId}, so nothing was changed`,
        );
      }

      identityName = `${identity.arn} (${base.source})`;
      this.actingAs = `${identity.arn} (the agent's own credentials, as ${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV} is not set)`;
    }

    const operation: string = this.command.operation.name;
    const kindName: string = this.run.kindName;
    const allPermissions: string = this.permissions().join(", ");
    const who: string = roleArn
      ? `The write role ${roleArn}`
      : `The agent's identity (${base.source})`;
    const client: AwsClient = new AwsClient({
      send: this.send,
      credentials,
      nowMs: options.runtime.nowMs,
      userAgent: options.runtime.userAgent,
      identityName,
      describeMissingPermission: (permission: string): string => {
        return `${who} lacks ${permission}${
          writeResources.length > 0 ? ` on ${writeResources.join(", ")}` : ""
        }: the setup command grants it when ${operation} is in ${RESOURCE_AI_CLOUD_OPERATIONS_ENV} (cloud ${operation} on ${withArticle(kindName)} needs ${allPermissions}).`;
      },
    });

    this.clients.set(key, client);
    return client;
  }

  private apiCall(detail: string): string {
    return `API call: ${this.command.kindSpec.apiCall}${detail ? ` (${detail})` : ""}, in ${this.region}, as ${this.actingAs}.`;
  }

  // ---- ECS ---------------------------------------------------------------------------

  private async describeEcsService(client: AwsClient): Promise<EcsService> {
    const cluster: string = this.run.part("cluster");
    const name: string = this.run.part("name");
    const answer: Record<string, unknown> = await this.run.read(
      `about the ECS service ${name} (ecs:DescribeServices)`,
      (): Promise<Record<string, unknown>> => {
        return client.json({
          endpointPrefix: "ecs",
          signingName: "ecs",
          region: this.region,
          target: `${ECS_TARGET_PREFIX}.DescribeServices`,
          jsonVersion: "1.1",
          body: { cluster, services: [name], include: ["TAGS"] },
          permission: "ecs:DescribeServices",
        });
      },
    );
    const service: Record<string, unknown> | undefined = readArray(
      answer,
      "services",
    )
      .filter(isPlainObject)
      .find((entry: Record<string, unknown>): boolean => {
        return readString(entry, "serviceName") === name;
      });

    if (!service) {
      const failure: Record<string, unknown> | undefined = readArray(
        answer,
        "failures",
      ).filter(isPlainObject)[0];

      return this.run.refuse(
        `ECS has no service ${name} in cluster ${cluster}${
          failure && readString(failure, "reason")
            ? ` (${readString(failure, "reason")})`
            : ""
        }, so nothing was changed`,
      );
    }

    const status: string = readString(service, "status") || "";

    if (status !== "ACTIVE") {
      this.run.refuse(
        `the ECS service ${name} is ${status || "not active"}, so nothing was changed`,
      );
    }

    return {
      arn: readString(service, "serviceArn") || this.run.resourceId,
      name,
      cluster,
      status,
      desiredCount: readInteger(service, "desiredCount") ?? 0,
      runningCount: readInteger(service, "runningCount") ?? 0,
      taskDefinition: readString(service, "taskDefinition") || "",
      tags: readAwsTagList(service["tags"]),
    };
  }

  private updateEcsService(
    client: AwsClient,
    replaced: Record<string, string>,
    change: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.run.change(replaced, (): Promise<Record<string, unknown>> => {
      return client.json({
        endpointPrefix: "ecs",
        signingName: "ecs",
        region: this.region,
        target: `${ECS_TARGET_PREFIX}.UpdateService`,
        jsonVersion: "1.1",
        body: {
          cluster: this.run.part("cluster"),
          service: this.run.part("name"),
          ...change,
        },
        permission: "ecs:UpdateService",
      });
    });
  }

  // The id of the deployment an UpdateService answer started, or "".
  private static primaryDeployment(answer: Record<string, unknown>): string {
    const deployments: Array<unknown> = readArray(
      readObject(answer, "service"),
      "deployments",
    );
    const primary: unknown = deployments.find((entry: unknown): boolean => {
      return isPlainObject(entry) && readString(entry, "status") === "PRIMARY";
    });

    return isPlainObject(primary) ? readString(primary, "id") || "" : "";
  }

  public async restartEcsService(): Promise<CloudChangeOutcome> {
    const client: AwsClient = await this.client([this.run.resourceId]);
    const service: EcsService = await this.describeEcsService(client);

    this.run.checkRequiredTag(service.tags);

    const answer: Record<string, unknown> = await this.updateEcsService(
      client,
      {},
      { forceNewDeployment: true },
    );
    const deployment: string = AwsChange.primaryDeployment(answer);
    const revision: { family: string; revision: number } | null =
      parseTaskDefinitionArn(service.taskDefinition);

    return {
      lines: [
        `Started a new deployment of the ECS service ${service.name} in cluster ${service.cluster}: its tasks (desired count ${service.desiredCount}) are replaced, on the task definition it runs now${
          revision ? `, ${revision.family}:${revision.revision}` : ""
        }.`,
        this.apiCall("forceNewDeployment=true"),
        ...(deployment ? [`Deployment: ${deployment}.`] : []),
      ],
    };
  }

  public async scaleEcsService(): Promise<CloudChangeOutcome> {
    const client: AwsClient = await this.client([this.run.resourceId]);
    const service: EcsService = await this.describeEcsService(client);

    this.run.checkRequiredTag(service.tags);

    const resourceId: string = `service/${service.cluster}/${service.name}`;
    const targets: Record<string, unknown> = await this.run.read(
      `for the ECS service's scaling limits (application-autoscaling:DescribeScalableTargets)`,
      (): Promise<Record<string, unknown>> => {
        return client.json({
          endpointPrefix: "application-autoscaling",
          signingName: "application-autoscaling",
          region: this.region,
          target: `${APPLICATION_AUTOSCALING_TARGET_PREFIX}.DescribeScalableTargets`,
          jsonVersion: "1.1",
          body: {
            ServiceNamespace: "ecs",
            ResourceIds: [resourceId],
            ScalableDimension: "ecs:service:DesiredCount",
          },
          permission: "application-autoscaling:DescribeScalableTargets",
        });
      },
    );
    const target: Record<string, unknown> | undefined = readArray(
      targets,
      "ScalableTargets",
    )
      .filter(isPlainObject)
      .find((entry: Record<string, unknown>): boolean => {
        return readString(entry, "ResourceId") === resourceId;
      });
    const count: number = this.run.checkCount(
      target
        ? boundsOf({
            current: service.desiredCount,
            unit: "desired count",
            minimum: readInteger(target, "MinCapacity"),
            minimumSource:
              "the minimum of its scalable target in Application Auto Scaling",
            maximum: readInteger(target, "MaxCapacity"),
            maximumSource:
              "the maximum of its scalable target in Application Auto Scaling",
          })
        : boundsOf({ current: service.desiredCount, unit: "desired count" }),
    );

    await this.updateEcsService(
      client,
      { count: String(service.desiredCount) },
      { desiredCount: count },
    );

    return {
      lines: [
        `ECS service ${service.name} in cluster ${service.cluster}: desired count ${arrow(service.desiredCount, count)} (it runs ${service.runningCount} now).`,
        this.apiCall(`desiredCount=${count}`),
        ...(target
          ? [
              `Application Auto Scaling scales it within ${readInteger(target, "MinCapacity") ?? "?"}-${readInteger(target, "MaxCapacity") ?? "?"} and may change the count again.`,
            ]
          : []),
      ],
    };
  }

  // The service's family's ACTIVE revisions, newest first.
  private async listTaskDefinitionRevisions(
    client: AwsClient,
    family: string,
  ): Promise<Array<number>> {
    const revisions: Array<number> = [];
    let nextToken: string | null = null;

    for (let page: number = 0; page < MAX_AWS_LIST_PAGES; page++) {
      const body: Record<string, unknown> = {
        familyPrefix: family,
        status: "ACTIVE",
        sort: "DESC",
        maxResults: 100,
      };

      if (nextToken) {
        body["nextToken"] = nextToken;
      }

      const answer: Record<string, unknown> = await this.run.read(
        `for the revisions of task definition family ${family} (ecs:ListTaskDefinitions)`,
        (): Promise<Record<string, unknown>> => {
          return client.json({
            endpointPrefix: "ecs",
            signingName: "ecs",
            region: this.region,
            target: `${ECS_TARGET_PREFIX}.ListTaskDefinitions`,
            jsonVersion: "1.1",
            body,
            permission: "ecs:ListTaskDefinitions",
          });
        },
      );

      for (const arn of readArray(answer, "taskDefinitionArns")) {
        const parsed: { family: string; revision: number } | null =
          typeof arn === "string" ? parseTaskDefinitionArn(arn) : null;

        // familyPrefix also matches web-worker for web.
        if (parsed && parsed.family === family) {
          revisions.push(parsed.revision);
        }
      }

      nextToken = readString(answer, "nextToken");

      if (!nextToken) {
        break;
      }
    }

    return revisions.sort((left: number, right: number): number => {
      return right - left;
    });
  }

  public async rollBackEcsService(): Promise<CloudChangeOutcome> {
    const client: AwsClient = await this.client([this.run.resourceId]);
    const service: EcsService = await this.describeEcsService(client);

    this.run.checkRequiredTag(service.tags);

    const current: { family: string; revision: number } | null =
      parseTaskDefinitionArn(service.taskDefinition);

    if (!current) {
      return this.run.refuse(
        `the ECS service ${service.name} runs a task definition the agent cannot read (${service.taskDefinition || "none"}), so nothing was changed`,
      );
    }

    const revisions: Array<number> = await this.listTaskDefinitionRevisions(
      client,
      current.family,
    );
    const to: CloudParamValue | undefined = this.command.flags["to"];
    let target: number;

    if (to !== undefined) {
      const word: string = String(to);
      const colon: number = word.lastIndexOf(":");
      const family: string = colon >= 0 ? word.slice(0, colon) : current.family;
      const revision: number | null = integerText(
        colon >= 0 ? word.slice(colon + 1) : word,
      );

      if (family !== current.family || revision === null) {
        return this.run.refuse(
          `--to ${word} is not a revision of the service's own task definition family, ${current.family} (write it as ${current.family}:REVISION), so nothing was changed`,
        );
      }

      if (revision === current.revision) {
        return this.run.refuse(
          `the ECS service ${service.name} already runs ${current.family}:${revision}, so nothing was changed`,
        );
      }

      if (!revisions.includes(revision)) {
        return this.run.refuse(
          `${current.family}:${revision} is not an ACTIVE revision of the family (it was deregistered, or never existed), so nothing was changed`,
        );
      }

      target = revision;
    } else {
      const earlier: number | undefined = revisions.find(
        (revision: number): boolean => {
          return revision < current.revision;
        },
      );

      if (earlier === undefined) {
        return this.run.refuse(
          `the task definition family ${current.family} has no ACTIVE revision before ${current.family}:${current.revision}, the one the service runs, so there is nothing to roll back to`,
        );
      }

      target = earlier;
    }

    const answer: Record<string, unknown> = await this.updateEcsService(
      client,
      { version: `${current.family}:${current.revision}` },
      { taskDefinition: `${current.family}:${target}` },
    );
    const deployment: string = AwsChange.primaryDeployment(answer);

    return {
      lines: [
        `ECS service ${service.name} in cluster ${service.cluster}: task definition ${arrow(
          `${current.family}:${current.revision}`,
          `${current.family}:${target}`,
        )}; its tasks are replaced one by one.`,
        this.apiCall(`taskDefinition=${current.family}:${target}`),
        ...(deployment ? [`Deployment: ${deployment}.`] : []),
      ],
    };
  }

  // ---- Auto Scaling -----------------------------------------------------------------------

  public async scaleAutoScalingGroup(): Promise<CloudChangeOutcome> {
    const client: AwsClient = await this.client([this.run.resourceId]);
    const name: string = this.run.part("name");
    const root: XmlElement = await this.run.read(
      `about the Auto Scaling group ${name} (autoscaling:DescribeAutoScalingGroups)`,
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "autoscaling",
          signingName: "autoscaling",
          region: this.region,
          action: "DescribeAutoScalingGroups",
          version: AUTOSCALING_API_VERSION,
          params: [["AutoScalingGroupNames.member.1", name]],
          permission: "autoscaling:DescribeAutoScalingGroups",
        });
      },
    );
    const group: XmlElement | undefined = xmlChildren(
      xmlFind(root, "AutoScalingGroups"),
      "member",
    ).find((member: XmlElement): boolean => {
      return xmlText(member, "AutoScalingGroupName") === name;
    });

    if (!group) {
      return this.run.refuse(
        `there is no Auto Scaling group ${name} in ${this.region}, so nothing was changed`,
      );
    }

    if (xmlText(group, "AutoScalingGroupARN") !== this.run.resourceId) {
      return this.run.refuse(
        `the Auto Scaling group named ${name} is not the one ${this.run.resourceId} names (it was deleted and created again), so nothing was changed`,
      );
    }

    if (xmlText(group, "Status")) {
      this.run.refuse(
        `the Auto Scaling group ${name} is ${xmlText(group, "Status")}, so nothing was changed`,
      );
    }

    this.run.checkRequiredTag(readAwsXmlTags(xmlChild(group, "Tags")));

    const desired: number | null = integerText(
      xmlText(group, "DesiredCapacity"),
    );
    const minimum: number | null = integerText(xmlText(group, "MinSize"));
    const maximum: number | null = integerText(xmlText(group, "MaxSize"));

    if (desired === null || minimum === null || maximum === null) {
      return this.run.refuse(
        `AWS described the Auto Scaling group ${name} without its sizes, so nothing was changed`,
      );
    }

    const count: number = this.run.checkCount({
      current: desired,
      unit: "desired capacity",
      minimum,
      minimumSource: "its MinSize",
      maximum,
      maximumSource: "its MaxSize",
      maximumIsPlatformLimit: true,
    });

    await this.run.change(
      { count: String(desired) },
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "autoscaling",
          signingName: "autoscaling",
          region: this.region,
          action: "SetDesiredCapacity",
          version: AUTOSCALING_API_VERSION,
          params: [
            ["AutoScalingGroupName", name],
            ["DesiredCapacity", String(count)],
            ["HonorCooldown", "false"],
          ],
          permission: "autoscaling:SetDesiredCapacity",
        });
      },
    );

    return {
      lines: [
        `Auto Scaling group ${name}: desired capacity ${arrow(desired, count)} (MinSize ${minimum}, MaxSize ${maximum}).`,
        this.apiCall(`DesiredCapacity=${count}, HonorCooldown=false`),
        "Its scaling policies may change the capacity again within MinSize and MaxSize.",
      ],
    };
  }

  // ---- EC2 ---------------------------------------------------------------------------

  private async describeEc2Instance(
    client: AwsClient,
    instanceId: string,
  ): Promise<Ec2Instance> {
    const root: XmlElement = await this.run.read(
      `about the EC2 instance ${instanceId} (ec2:DescribeInstances)`,
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "ec2",
          signingName: "ec2",
          region: this.region,
          action: "DescribeInstances",
          version: EC2_API_VERSION,
          params: [["InstanceId.1", instanceId]],
          permission: "ec2:DescribeInstances",
        });
      },
    );

    for (const reservation of xmlChildren(
      xmlChild(root, "reservationSet"),
      "item",
    )) {
      for (const instance of xmlChildren(
        xmlChild(reservation, "instancesSet"),
        "item",
      )) {
        if (xmlText(instance, "instanceId") === instanceId) {
          return {
            state: xmlText(instance, "instanceState", "name") || "",
            tags: readAwsXmlTags(xmlChild(instance, "tagSet")),
          };
        }
      }
    }

    return this.run.refuse(
      `there is no EC2 instance ${instanceId} in ${this.region}, so nothing was changed`,
    );
  }

  public async changeEc2Instance(): Promise<CloudChangeOutcome> {
    const operation: string = this.command.operation.name;
    const instanceId: string = this.run.part("instanceId");
    const client: AwsClient = await this.client([this.run.resourceId]);
    const instance: Ec2Instance = await this.describeEc2Instance(
      client,
      instanceId,
    );

    this.run.checkRequiredTag(instance.tags);

    const needs: string =
      operation === "start-instance" ? "stopped" : "running";

    if (instance.state !== needs) {
      return this.run.refuse(
        `the EC2 instance ${instanceId} is ${instance.state || "in an unknown state"}, and cloud ${operation} needs it ${needs}, so nothing was changed`,
      );
    }

    const action: string =
      operation === "start-instance"
        ? "StartInstances"
        : operation === "stop-instance"
          ? "StopInstances"
          : "RebootInstances";
    const answer: XmlElement = await this.run.change(
      operation === "reboot-instance" ? {} : { state: instance.state },
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "ec2",
          signingName: "ec2",
          region: this.region,
          action,
          version: EC2_API_VERSION,
          params: [["InstanceId.1", instanceId]],
          permission: `ec2:${action}`,
        });
      },
    );
    const now: string | null = xmlText(xmlFind(answer, "currentState"), "name");

    return {
      lines: [
        operation === "reboot-instance"
          ? `EC2 instance ${instanceId}: rebooting (it stays on the same host and keeps its addresses).`
          : `EC2 instance ${instanceId}: ${arrow(instance.state, now || (operation === "start-instance" ? "pending" : "stopping"))}.`,
        this.apiCall(`InstanceId=${instanceId}`),
      ],
    };
  }

  // ---- RDS ---------------------------------------------------------------------------

  private async describeRdsInstance(client: AwsClient): Promise<RdsInstance> {
    const name: string = this.run.part("name");
    const root: XmlElement = await this.run.read(
      `about the RDS instance ${name} (rds:DescribeDBInstances)`,
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "rds",
          signingName: "rds",
          region: this.region,
          action: "DescribeDBInstances",
          version: RDS_API_VERSION,
          params: [["DBInstanceIdentifier", name]],
          permission: "rds:DescribeDBInstances",
        });
      },
    );
    const instance: XmlElement | undefined = xmlChildren(
      xmlFind(root, "DBInstances"),
      "DBInstance",
    ).find((entry: XmlElement): boolean => {
      return (
        (xmlText(entry, "DBInstanceIdentifier") || "").toLowerCase() ===
        name.toLowerCase()
      );
    });

    if (!instance) {
      return this.run.refuse(
        `there is no RDS instance ${name} in ${this.region}, so nothing was changed`,
      );
    }

    return {
      status: xmlText(instance, "DBInstanceStatus") || "",
      multiAz: xmlText(instance, "MultiAZ") === "true",
      availabilityZone: xmlText(instance, "AvailabilityZone") || "",
      secondaryAvailabilityZone:
        xmlText(instance, "SecondaryAvailabilityZone") || "",
      clusterIdentifier: xmlText(instance, "DBClusterIdentifier") || "",
      tags: readAwsXmlTags(xmlChild(instance, "TagList")),
    };
  }

  public async changeRdsInstance(): Promise<CloudChangeOutcome> {
    const operation: string = this.command.operation.name;
    const name: string = this.run.part("name");
    const client: AwsClient = await this.client([this.run.resourceId]);
    const instance: RdsInstance = await this.describeRdsInstance(client);

    this.run.checkRequiredTag(instance.tags);

    if (instance.clusterIdentifier) {
      this.run.refuse(
        `the RDS instance ${name} belongs to the cluster ${instance.clusterIdentifier}: ${
          operation === "fail-over-database"
            ? "fail the cluster over instead (cloud fail-over-database on the cluster's ARN)"
            : operation === "start-instance"
              ? "start the cluster instead"
              : "it is restarted as part of its cluster"
        }, so nothing was changed`,
      );
    }

    if (operation === "start-instance") {
      if (instance.status !== "stopped") {
        this.run.refuse(
          `the RDS instance ${name} is ${instance.status || "in an unknown state"}, and cloud start-instance needs it stopped, so nothing was changed`,
        );
      }

      await this.run.change(
        { state: instance.status },
        (): Promise<XmlElement> => {
          return client.query({
            endpointPrefix: "rds",
            signingName: "rds",
            region: this.region,
            action: "StartDBInstance",
            version: RDS_API_VERSION,
            params: [["DBInstanceIdentifier", name]],
            permission: "rds:StartDBInstance",
          });
        },
      );

      return {
        lines: [
          `RDS instance ${name}: ${arrow("stopped", "starting")}.`,
          this.apiCall(`DBInstanceIdentifier=${name}`),
        ],
      };
    }

    if (instance.status !== "available") {
      this.run.refuse(
        `the RDS instance ${name} is ${instance.status || "in an unknown state"}, and cloud ${operation} needs it available, so nothing was changed`,
      );
    }

    const failover: boolean = operation === "fail-over-database";

    if (failover && !instance.multiAz) {
      this.run.refuse(
        `the RDS instance ${name} is not Multi-AZ, so it has no standby to fail over to, and nothing was changed`,
      );
    }

    await this.run.change(
      failover && instance.availabilityZone
        ? { primary: instance.availabilityZone }
        : {},
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "rds",
          signingName: "rds",
          region: this.region,
          action: "RebootDBInstance",
          version: RDS_API_VERSION,
          params: [
            ["DBInstanceIdentifier", name],
            ["ForceFailover", failover ? "true" : "false"],
          ],
          permission: "rds:RebootDBInstance",
        });
      },
    );

    return {
      lines: [
        failover
          ? `RDS instance ${name}: failing over from its primary in ${instance.availabilityZone || "its Availability Zone"} to its standby${
              instance.secondaryAvailabilityZone
                ? ` in ${instance.secondaryAvailabilityZone}`
                : ""
            } (a reboot with failover).`
          : `RDS instance ${name}: rebooting in place, without failover.`,
        this.apiCall(
          `DBInstanceIdentifier=${name}, ForceFailover=${failover ? "true" : "false"}`,
        ),
      ],
    };
  }

  public async failOverRdsCluster(): Promise<CloudChangeOutcome> {
    const name: string = this.run.part("name");
    const client: AwsClient = await this.client([this.run.resourceId]);
    const root: XmlElement = await this.run.read(
      `about the cluster ${name} (rds:DescribeDBClusters)`,
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "rds",
          signingName: "rds",
          region: this.region,
          action: "DescribeDBClusters",
          version: RDS_API_VERSION,
          params: [["DBClusterIdentifier", name]],
          permission: "rds:DescribeDBClusters",
        });
      },
    );
    const cluster: XmlElement | undefined = xmlChildren(
      xmlFind(root, "DBClusters"),
      "DBCluster",
    ).find((entry: XmlElement): boolean => {
      return (
        (xmlText(entry, "DBClusterIdentifier") || "").toLowerCase() ===
        name.toLowerCase()
      );
    });

    if (!cluster) {
      return this.run.refuse(
        `there is no RDS cluster ${name} in ${this.region}, so nothing was changed`,
      );
    }

    this.run.checkRequiredTag(readAwsXmlTags(xmlChild(cluster, "TagList")));

    const status: string = xmlText(cluster, "Status") || "";

    if (status !== "available") {
      this.run.refuse(
        `the cluster ${name} is ${status || "in an unknown state"}, and a failover needs it available, so nothing was changed`,
      );
    }

    const members: Array<XmlElement> = xmlChildren(
      xmlChild(cluster, "DBClusterMembers"),
      "DBClusterMember",
    );
    const writer: string =
      xmlText(
        members.find((member: XmlElement): boolean => {
          return xmlText(member, "IsClusterWriter") === "true";
        }) || null,
        "DBInstanceIdentifier",
      ) || "";
    const readers: Array<string> = members
      .filter((member: XmlElement): boolean => {
        return xmlText(member, "IsClusterWriter") !== "true";
      })
      .map((member: XmlElement): string => {
        return xmlText(member, "DBInstanceIdentifier") || "";
      })
      .filter(Boolean);

    if (readers.length === 0) {
      this.run.refuse(
        `the cluster ${name} has no reader instance to fail over to, so nothing was changed`,
      );
    }

    await this.run.change(
      writer ? { primary: writer } : {},
      (): Promise<XmlElement> => {
        return client.query({
          endpointPrefix: "rds",
          signingName: "rds",
          region: this.region,
          action: "FailoverDBCluster",
          version: RDS_API_VERSION,
          params: [["DBClusterIdentifier", name]],
          permission: "rds:FailoverDBCluster",
        });
      },
    );

    return {
      lines: [
        `Cluster ${name}: failing over — its writer${writer ? `, ${writer},` : ""} hands over to one of its readers (${readers.join(", ")}).`,
        this.apiCall(`DBClusterIdentifier=${name}`),
      ],
    };
  }

  // ---- Lambda --------------------------------------------------------------------------

  private functionArn(): string {
    const resource: ParsedCloudCommand["resource"] = this.command.resource;
    const account: string = resource ? resource.accountId : this.accountId;

    return `arn:${this.partition}:lambda:${this.region}:${account}:function:${this.run.part("functionName")}`;
  }

  // The function's tags, when a tag is required (lambda:ListTags).
  private async checkLambdaTag(client: AwsClient): Promise<void> {
    if (!this.settings.requiredTag) {
      this.run.checkRequiredTag({});
      return;
    }

    const functionArn: string = this.functionArn();
    const answer: Record<string, unknown> = await this.run.read(
      `for the tags of the Lambda function (lambda:ListTags)`,
      (): Promise<Record<string, unknown>> => {
        return client.rest({
          endpointPrefix: "lambda",
          signingName: "lambda",
          region: this.region,
          method: "GET",
          segments: ["2017-03-31", "tags", functionArn],
          permission: "lambda:ListTags",
        });
      },
    );
    const tags: Record<string, string> = {};
    const raw: Record<string, unknown> | null = readObject(answer, "Tags");

    for (const [key, value] of Object.entries(raw || {})) {
      if (typeof value === "string") {
        tags[key] = value;
      }
    }

    this.run.checkRequiredTag(tags);
  }

  public async setLambdaConcurrency(): Promise<CloudChangeOutcome> {
    const name: string = this.run.part("functionName");
    const client: AwsClient = await this.client([this.run.resourceId]);

    await this.checkLambdaTag(client);

    const answer: Record<string, unknown> = await this.run.read(
      `for the Lambda function's reserved concurrency (lambda:GetFunctionConcurrency)`,
      (): Promise<Record<string, unknown>> => {
        return client.rest({
          endpointPrefix: "lambda",
          signingName: "lambda",
          region: this.region,
          method: "GET",
          segments: ["2019-09-30", "functions", name, "concurrency"],
          permission: "lambda:GetFunctionConcurrency",
        });
      },
    );
    const current: number | null = readInteger(
      answer,
      "ReservedConcurrentExecutions",
    );
    const value: CloudParamValue | undefined = this.command.flags["value"];
    const shownCurrent: string = current === null ? "none" : String(current);

    if (current === 0) {
      this.run.refuse(
        `the Lambda function ${name} has a reserved concurrency of 0, which stops it on purpose: lifting that is left to a person, so nothing was changed`,
      );
    }

    if (value === undefined || String(value) === shownCurrent) {
      this.run.refuse(
        `the Lambda function ${name}'s reserved concurrency is already ${shownCurrent}, so nothing was changed`,
      );
    }

    if (value === "none") {
      await this.run.change(
        { value: shownCurrent },
        (): Promise<Record<string, unknown>> => {
          return client.rest({
            endpointPrefix: "lambda",
            signingName: "lambda",
            region: this.region,
            method: "DELETE",
            segments: ["2017-03-31", "functions", name, "concurrency"],
            permission: "lambda:DeleteFunctionConcurrency",
          });
        },
      );

      return {
        lines: [
          `Lambda function ${name}: reserved concurrency ${arrow(shownCurrent, "none")} (it now draws on the account's unreserved concurrency).`,
          this.apiCall("DeleteFunctionConcurrency"),
        ],
      };
    }

    await this.run.change(
      { value: shownCurrent },
      (): Promise<Record<string, unknown>> => {
        return client.rest({
          endpointPrefix: "lambda",
          signingName: "lambda",
          region: this.region,
          method: "PUT",
          segments: ["2017-03-31", "functions", name, "concurrency"],
          body: { ReservedConcurrentExecutions: value },
          permission: "lambda:PutFunctionConcurrency",
        });
      },
    );

    return {
      lines: [
        `Lambda function ${name}: reserved concurrency ${arrow(shownCurrent, String(value))}.`,
        this.apiCall(`ReservedConcurrentExecutions=${String(value)}`),
      ],
    };
  }

  // The function's published version numbers (never $LATEST), ascending.
  private async listLambdaVersions(client: AwsClient): Promise<{
    versions: Array<number>;
    complete: boolean;
  }> {
    const name: string = this.run.part("functionName");
    const versions: Array<number> = [];
    let marker: string | null = null;

    for (let page: number = 0; page < MAX_AWS_LIST_PAGES; page++) {
      const query: Record<string, string> = {
        MaxItems: String(LAMBDA_VERSIONS_PAGE_SIZE),
      };

      if (marker) {
        query["Marker"] = marker;
      }

      const answer: Record<string, unknown> = await this.run.read(
        `for the versions of the Lambda function ${name} (lambda:ListVersionsByFunction)`,
        (): Promise<Record<string, unknown>> => {
          return client.rest({
            endpointPrefix: "lambda",
            signingName: "lambda",
            region: this.region,
            method: "GET",
            segments: ["2015-03-31", "functions", name, "versions"],
            query,
            permission: "lambda:ListVersionsByFunction",
          });
        },
      );

      for (const entry of readArray(answer, "Versions")) {
        const version: number | null = isPlainObject(entry)
          ? integerText(readString(entry, "Version"))
          : null;

        if (version !== null) {
          versions.push(version);
        }
      }

      marker = readString(answer, "NextMarker");

      if (!marker) {
        return {
          versions: versions.sort((left: number, right: number): number => {
            return left - right;
          }),
          complete: true,
        };
      }
    }

    return {
      versions: versions.sort((left: number, right: number): number => {
        return left - right;
      }),
      complete: false,
    };
  }

  public async rollBackLambdaAlias(): Promise<CloudChangeOutcome> {
    const name: string = this.run.part("functionName");
    const aliasName: string = this.run.part("alias");
    const client: AwsClient = await this.client([
      this.run.resourceId,
      this.functionArn(),
    ]);

    await this.checkLambdaTag(client);

    const alias: Record<string, unknown> = await this.run.read(
      `about the Lambda alias ${aliasName} (lambda:GetAlias)`,
      (): Promise<Record<string, unknown>> => {
        return client.rest({
          endpointPrefix: "lambda",
          signingName: "lambda",
          region: this.region,
          method: "GET",
          segments: ["2015-03-31", "functions", name, "aliases", aliasName],
          permission: "lambda:GetAlias",
        });
      },
    );
    const current: string = readString(alias, "FunctionVersion") || "";
    const weights: Record<string, unknown> | null = readObject(
      readObject(alias, "RoutingConfig"),
      "AdditionalVersionWeights",
    );
    const listed: { versions: Array<number>; complete: boolean } =
      await this.listLambdaVersions(client);
    const to: CloudParamValue | undefined = this.command.flags["to"];
    let target: number;

    if (to !== undefined) {
      const word: string = String(to);
      const colon: number = word.lastIndexOf(":");
      const owner: string = colon >= 0 ? word.slice(0, colon) : name;
      const version: number | null = integerText(
        colon >= 0 ? word.slice(colon + 1) : word,
      );

      if (owner !== name || version === null) {
        return this.run.refuse(
          `--to ${word} is not a published version of the alias's own function, ${name} (write the version number, such as --to 6), so nothing was changed`,
        );
      }

      if (String(version) === current) {
        return this.run.refuse(
          `the Lambda alias ${aliasName} already points at version ${version}, so nothing was changed`,
        );
      }

      if (!listed.versions.includes(version)) {
        return this.run.refuse(
          `the Lambda function ${name} has no version ${version}${
            listed.complete ? "" : " among the versions the agent read"
          }, so nothing was changed`,
        );
      }

      target = version;
    } else {
      const currentNumber: number | null = integerText(current);

      if (currentNumber === null) {
        return this.run.refuse(
          `the Lambda alias ${aliasName} points at ${current || "no version"}, which has no version before it: name the version to move to with --to, so nothing was changed`,
        );
      }

      if (
        !listed.complete &&
        !listed.versions.some((version: number): boolean => {
          return version >= currentNumber;
        })
      ) {
        return this.run.refuse(
          `the Lambda function ${name} has more versions than the agent reads, so it cannot tell which one came before ${currentNumber}: name it with --to, so nothing was changed`,
        );
      }

      const earlier: Array<number> = listed.versions.filter(
        (version: number): boolean => {
          return version < currentNumber;
        },
      );
      const previous: number | undefined = earlier[earlier.length - 1];

      if (previous === undefined) {
        return this.run.refuse(
          `the Lambda function ${name} has no published version before ${currentNumber}, so there is nothing to roll back to`,
        );
      }

      target = previous;
    }

    const body: Record<string, unknown> = {
      FunctionVersion: String(target),
      RoutingConfig: { AdditionalVersionWeights: {} },
    };
    const revisionId: string | null = readString(alias, "RevisionId");

    if (revisionId) {
      body["RevisionId"] = revisionId;
    }

    await this.run.change(
      current ? { version: current } : {},
      (): Promise<Record<string, unknown>> => {
        return client.rest({
          endpointPrefix: "lambda",
          signingName: "lambda",
          region: this.region,
          method: "PUT",
          segments: ["2015-03-31", "functions", name, "aliases", aliasName],
          body,
          permission: "lambda:UpdateAlias",
        });
      },
    );

    const split: Array<string> = Object.entries(weights || {}).map(
      ([version, weight]: [string, unknown]): string => {
        return `${version} at ${typeof weight === "number" ? Math.round(weight * 100) : "?"}%`;
      },
    );

    return {
      lines: [
        `Lambda alias ${aliasName} of function ${name}: version ${arrow(current, target)}, for all of its traffic.`,
        this.apiCall(`FunctionVersion=${target}`),
        ...(split.length > 0
          ? [
              `It also sent traffic to ${split.join(", ")}; that routing was cleared, and undoing this change does not bring it back.`,
            ]
          : []),
      ],
    };
  }

  // ---- SQS -----------------------------------------------------------------------------

  private sqs(
    client: AwsClient,
    action: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return client.json({
      endpointPrefix: "sqs",
      signingName: "sqs",
      region: this.region,
      target: `${SQS_TARGET_PREFIX}.${action}`,
      jsonVersion: "1.0",
      body,
      permission: `sqs:${action}`,
    });
  }

  public async redriveQueue(): Promise<CloudChangeOutcome> {
    const name: string = this.run.part("queueName");
    const resource: ParsedCloudCommand["resource"] = this.command.resource;
    const account: string = resource ? resource.accountId : "";
    const queueUrl: string = sqsQueueUrl({
      region: this.region,
      account,
      name,
    });
    // Reads first, with a session that may change nothing.
    const reader: AwsClient = await this.client([]);

    if (this.settings.requiredTag) {
      const tagged: Record<string, unknown> = await this.run.read(
        `for the tags of the queue ${name} (sqs:ListQueueTags)`,
        (): Promise<Record<string, unknown>> => {
          return this.sqs(reader, "ListQueueTags", { QueueUrl: queueUrl });
        },
      );
      const tags: Record<string, string> = {};

      for (const [key, value] of Object.entries(
        readObject(tagged, "Tags") || {},
      )) {
        if (typeof value === "string") {
          tags[key] = value;
        }
      }

      this.run.checkRequiredTag(tags);
    } else {
      this.run.checkRequiredTag({});
    }

    const attributes: Record<string, unknown> = await this.run.read(
      `about the queue ${name} (sqs:GetQueueAttributes)`,
      (): Promise<Record<string, unknown>> => {
        return this.sqs(reader, "GetQueueAttributes", {
          QueueUrl: queueUrl,
          AttributeNames: ["ApproximateNumberOfMessages", "QueueArn"],
        });
      },
    );
    const messages: number | null = readInteger(
      readObject(attributes, "Attributes"),
      "ApproximateNumberOfMessages",
    );

    if (messages === 0) {
      this.run.refuse(
        `the queue ${name} holds no messages, so there is nothing to redrive`,
      );
    }

    const sources: Array<string> = [];
    let nextToken: string | null = null;

    for (let page: number = 0; page < MAX_AWS_LIST_PAGES; page++) {
      const body: Record<string, unknown> = {
        QueueUrl: queueUrl,
        MaxResults: 100,
      };

      if (nextToken) {
        body["NextToken"] = nextToken;
      }

      const answer: Record<string, unknown> = await this.run.read(
        `which queues send their failed messages to ${name} (sqs:ListDeadLetterSourceQueues)`,
        (): Promise<Record<string, unknown>> => {
          return this.sqs(reader, "ListDeadLetterSourceQueues", body);
        },
      );
      const urls: Array<unknown> = [
        ...readArray(answer, "queueUrls"),
        ...readArray(answer, "QueueUrls"),
      ];

      for (const url of urls) {
        if (typeof url === "string" && !sources.includes(url)) {
          sources.push(url);
        }
      }

      nextToken = readString(answer, "NextToken");

      if (!nextToken || sources.length > MAX_REDRIVE_SOURCE_QUEUES) {
        break;
      }
    }

    if (sources.length === 0) {
      return this.run.refuse(
        `the queue ${name} is no queue's dead-letter queue, so it has nowhere to send its messages back to, and nothing was changed`,
      );
    }

    if (sources.length > MAX_REDRIVE_SOURCE_QUEUES) {
      return this.run.refuse(
        `the queue ${name} is the dead-letter queue of more than ${MAX_REDRIVE_SOURCE_QUEUES} queues: redriving it is left to a person, so nothing was changed`,
      );
    }

    const sourceArns: Array<string> = [];

    for (const url of sources) {
      const parsed: { host: string; account: string; name: string } | null =
        parseSqsQueueUrl(url);

      if (!parsed || parsed.account !== this.accountId) {
        return this.run.refuse(
          `a queue that sends its failed messages to ${name} is not one of this account's (${url.slice(0, 200)}), so nothing was changed`,
        );
      }

      sourceArns.push(
        `arn:${this.partition}:sqs:${this.region}:${parsed.account}:${parsed.name}`,
      );
    }

    // Then the change, with a session that may change these queues only.
    const writer: AwsClient = await this.client([
      this.run.resourceId,
      ...sourceArns,
    ]);
    const move: Record<string, unknown> = { SourceArn: this.run.resourceId };

    if (sourceArns.length === 1) {
      move["DestinationArn"] = sourceArns[0];
    }

    const answer: Record<string, unknown> = await this.run.change(
      {},
      (): Promise<Record<string, unknown>> => {
        return this.sqs(writer, "StartMessageMoveTask", move);
      },
    );
    const handle: string | null = readString(answer, "TaskHandle");

    return {
      lines: [
        `Queue ${name}: started moving its${
          messages !== null ? ` ~${messages}` : ""
        } messages back to ${
          sourceArns.length === 1
            ? sourceArns[0]
            : `the queues they came from (${sourceArns.join(", ")})`
        }; SQS moves them in the background.`,
        this.apiCall(
          sourceArns.length === 1
            ? `SourceArn=${this.run.resourceId}, DestinationArn=${sourceArns[0]}`
            : `SourceArn=${this.run.resourceId}`,
        ),
        ...(handle ? [`Move task: ${handle}`] : []),
      ],
    };
  }
}
