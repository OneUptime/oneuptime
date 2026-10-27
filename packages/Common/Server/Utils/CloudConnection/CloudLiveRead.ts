import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CloudConnectionAuthMethod } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../Types/CloudConnection/CloudConnectionTest";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  CLOUD_CATALOG_PROVIDER_NAMES,
  CLOUD_OPERATIONS,
  CLOUD_PROGRAM,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudOperationKindSpec,
  CloudOperationSpec,
  ParsedCloudCommand,
  ParsedCloudResource,
  getCloudCatalogProvider,
  isSameCloudResourceId,
  parseCloudCommand,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  ResourceTokenizeResult,
  renderResourceDisplayCommand,
  tokenizeResourceCommand,
} from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { redactResourceCommandOutputWithCount } from "../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudResourceService from "../../Services/CloudResourceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ToolResultSerializer from "../AI/Toolbox/Serializer";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";
import { AwsCredentials } from "./Aws/AwsApi";
import AwsCloudConnector from "./Aws/AwsCloudConnector";
import AzureCloudConnector from "./Azure/AzureCloudConnector";
import CloudConnectionPullRunner from "./CloudConnectionPullRunner";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
  getCloudSecretValues,
  readCloudSetting,
} from "./CloudConnectorTypes";
import GcpCloudConnector from "./Gcp/GcpCloudConnector";
import AwsLiveRead, { AWS_LIVE_READ_SETUP_HINT } from "./LiveRead/AwsLiveRead";
import AzureLiveRead, {
  AZURE_LIVE_READ_SETUP_HINT,
} from "./LiveRead/AzureLiveRead";
import {
  CloudLiveReadContext,
  CloudLiveReadError,
  CloudLiveReadInventoryRow,
  CloudLiveReadTarget,
} from "./LiveRead/CloudLiveReadTypes";
import CloudLiveReadRateLimit, {
  CLOUD_LIVE_READS_PER_MINUTE,
} from "./LiveRead/CloudLiveReadRateLimit";
import GcpLiveRead, { GCP_LIVE_READ_SETUP_HINT } from "./LiveRead/GcpLiveRead";
import { liveText, sliceWhole } from "./LiveRead/LiveReadFormat";

/*
 * LIVE READS OF A CLOUD ACCOUNT, ON THE SERVER.
 *
 * The cloud catalog's reads (describe, recent-events, target-health,
 * quota-usage, read-logs) run here, through the account's existing
 * read-only cloud connection and its signed clients, so an investigation
 * reads the cloud as it is now - not only OneUptime's copy from up to ten
 * minutes ago - without the Cloud AI agent.
 *
 * One read, in order:
 *
 *   1. The command is read with the account's cloud's catalog grammar
 *      (parseCloudCommand); anything that is not one of the reads that run
 *      here is refused, and the answer names the read by the catalog's
 *      canonical command.
 *   2. The account is loaded (pinned to the project and to the cloud its
 *      type is in). read-logs is refused unless someone let AI read the
 *      account's logs - log lines can hold customer data. An account no
 *      connection reads cannot be read live.
 *   3. The resource must be in the account: its id names the account, or
 *      the account's inventory lists it (an S3 bucket's ARN names none; a
 *      Google Cloud name may name the project by its number).
 *   4. The connection is loaded and must still read the account: for an
 *      AWS Organization, one of the accounts it lists, read through the
 *      role the StackSet put in that account; for Azure, a subscription it
 *      names (or any, when it names none); for Google Cloud, a project it
 *      reads.
 *   5. At most CLOUD_LIVE_READS_PER_MINUTE live reads a minute per account
 *      (CloudLiveReadRateLimit), and a budget of
 *      CLOUD_LIVE_READ_MAX_REQUESTS requests in
 *      CLOUD_LIVE_READ_MAX_DURATION_MS for the read itself.
 *   6. The cloud's reader (LiveRead/AwsLiveRead, AzureLiveRead,
 *      GcpLiveRead) reads, and its answer is cut to
 *      CLOUD_LIVE_READ_MAX_OUTPUT_CHARS at a line, the connection's
 *      secrets and the generic secret and personal-data rules redacted
 *      (as an agent's output is), and a closing tool_result tag defused.
 *
 * It never throws: every failure is an outcome with ok false and a reason
 * an operator can act on - a missing permission is named, with the setup
 * command that adds it - with the connection's secrets redacted.
 */

// What one live read returned.
export interface CloudLiveReadOutcome {
  ok: boolean;
  // The command as read (the catalog's canonical form).
  displayCommand: string;
  // The answer, for the model; "" when the read failed.
  output: string;
  // Why it failed, in words an operator can act on (a missing permission is named).
  errorMessage?: string | undefined;
  redactionCount: number;
  isTruncated: boolean;
}

// One read's budget: requests, and how long it may take.
export const CLOUD_LIVE_READ_MAX_REQUESTS: number = 20;
export const CLOUD_LIVE_READ_MAX_DURATION_MS: number = 25 * 1000;
// Each request's own deadline.
export const CLOUD_LIVE_READ_REQUEST_TIMEOUT_MS: number = 15 * 1000;
// The longest answer handed back; a longer one is cut at a line.
export const CLOUD_LIVE_READ_MAX_OUTPUT_CHARS: number = 64 * 1024;

export const CLOUD_LIVE_READ_LOGS_OFF_MESSAGE: string =
  "AI may not read this account's logs. Turn on Let AI read logs on the account's AI agent page.";

const TRUNCATION_NOTE: string = `… (cut at ${
  CLOUD_LIVE_READ_MAX_OUTPUT_CHARS / 1024
} KB: ask for less with --limit, --hours or --minutes to read the rest)`;
const REDACTED: string = "[REDACTED]";

// The test seams: a fake cloud, a clock, and a budget of another size.
export interface CloudLiveReadDependencies {
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  maxRequests?: number | undefined;
  maxDurationMs?: number | undefined;
}

// The catalog operations that run here, on the server.
export function getCloudServerReadNames(): Array<string> {
  return CLOUD_OPERATIONS.filter((operation: CloudOperationSpec): boolean => {
    return operation.runsOn === "server";
  }).map((operation: CloudOperationSpec): string => {
    return operation.name;
  });
}

// Whether a command for a cloud account is one of the reads that run here.
export function isCloudServerRead(data: {
  resourceType: AiResourceType;
  command: string;
}): boolean {
  const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
    data.resourceType,
  );
  const argv: Array<string> | undefined = tokenizeResourceCommand(
    data.command,
  ).argv;

  if (!provider || !argv) {
    return false;
  }

  const parse: CloudCommandParse = parseCloudCommand(provider, argv);

  return parse.ok && parse.command.operation.runsOn === "server";
}

/*
 * An answer cut to maxChars: at the last line break that fits, with a note
 * saying it was cut, so no line - and no secret on one - is cut in half.
 */
export function capCloudLiveReadOutput(
  text: string,
  maxChars: number = CLOUD_LIVE_READ_MAX_OUTPUT_CHARS,
): { text: string; isTruncated: boolean } {
  if (text.length <= maxChars) {
    return { text, isTruncated: false };
  }

  const room: number = Math.max(0, maxChars - TRUNCATION_NOTE.length - 1);
  const lineEnd: number = text.lastIndexOf("\n", room);
  const kept: string =
    lineEnd > 0 ? text.slice(0, lineEnd) : sliceWhole(text, room);

  return { text: `${kept}\n${TRUNCATION_NOTE}`, isTruncated: true };
}

/*
 * The answer with nothing left that closes the tool_result it is framed in
 * ("</tool_result" becomes "<\/tool_result"): a scan for "<" with indexOf,
 * the tag compared without regard to case.
 */
export function defuseToolResultClose(text: string): string {
  const tag: string = "</tool_result";
  let from: number = text.indexOf("<");

  if (from < 0) {
    return text;
  }

  const parts: Array<string> = [];
  let copied: number = 0;

  while (from >= 0) {
    if (text.slice(from, from + tag.length).toLowerCase() === tag) {
      parts.push(text.slice(copied, from), "<\\/");
      copied = from + 2;
    }

    from = text.indexOf("<", from + 1);
  }

  parts.push(text.slice(copied));

  return parts.join("");
}

const AWS_ACCOUNT_ID_REGEX: RegExp = /^[0-9]{12}$/;

// The 12-digit account a role ARN is in, or "".
function accountOfRoleArn(roleArn: string): string {
  const account: string = roleArn.split(":")[4] || "";
  return AWS_ACCOUNT_ID_REGEX.test(account) ? account : "";
}

export default class CloudLiveRead {
  /*
   * One live read of the account. Never throws: every failure is an
   * outcome with ok false and a reason.
   */
  public static async run(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    // The CloudAccount row's id.
    cloudAccountId: ObjectID;
    command: string;
  }): Promise<CloudLiveReadOutcome> {
    return await CloudLiveRead.runWith(data, {});
  }

  // run(), with the seams a test sets: the transport, the clock, the budget.
  public static async runWith(
    data: {
      projectId: ObjectID;
      resourceType: AiResourceType;
      cloudAccountId: ObjectID;
      command: string;
    },
    dependencies: CloudLiveReadDependencies,
  ): Promise<CloudLiveReadOutcome> {
    let displayCommand: string =
      typeof data.command === "string" ? data.command : "";
    let provider: CloudCatalogProvider | null = null;
    let kindSpec: CloudOperationKindSpec | null = null;
    const secrets: Array<string> = [];
    const maxRequests: number =
      dependencies.maxRequests ?? CLOUD_LIVE_READ_MAX_REQUESTS;
    const maxDurationMs: number =
      dependencies.maxDurationMs ?? CLOUD_LIVE_READ_MAX_DURATION_MS;

    try {
      provider = getCloudCatalogProvider(data.resourceType);

      if (!provider) {
        return CloudLiveRead.refusal(
          displayCommand,
          "This resource is not a cloud account, so it has no live cloud reads.",
        );
      }

      const tokens: ResourceTokenizeResult =
        tokenizeResourceCommand(displayCommand);

      if (!tokens.argv) {
        return CloudLiveRead.refusal(
          displayCommand,
          tokens.errorMessage || "The command could not be read.",
        );
      }

      const parse: CloudCommandParse = parseCloudCommand(provider, tokens.argv);

      if (!parse.ok) {
        return CloudLiveRead.refusal(
          displayCommand,
          `The command is not a cloud read: ${parse.errorMessage}.`,
        );
      }

      const command: ParsedCloudCommand = parse.command;
      displayCommand = renderResourceDisplayCommand([
        CLOUD_PROGRAM,
        ...command.canonicalArgs,
      ]);
      kindSpec = command.kindSpec;

      if (command.operation.runsOn !== "server" || !command.resource) {
        return CloudLiveRead.refusal(
          displayCommand,
          `cloud ${command.operation.name} is not a live read: the reads that run on OneUptime are ${getCloudServerReadNames().join(
            ", ",
          )}.`,
        );
      }

      const resource: ParsedCloudResource = command.resource;
      const account: CloudAccount | null = await CloudAccountService.findOneBy({
        query: {
          _id: data.cloudAccountId.toString(),
          projectId: data.projectId,
          provider: provider as never,
        },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          accountId: true,
          name: true,
          cloudConnectionId: true,
          isAiLogReadEnabled: true,
        },
        props: { isRoot: true },
      });

      if (!account || !account.accountId) {
        return CloudLiveRead.refusal(
          displayCommand,
          `This ${CLOUD_CATALOG_PROVIDER_NAMES[provider]} account was not found in the project.`,
        );
      }

      const accountLabel: string = `${
        account.name && account.name !== account.accountId
          ? `"${liveText(account.name, 100)}" (${account.accountId})`
          : account.accountId
      }`;

      if (
        command.operation.name === "read-logs" &&
        account.isAiLogReadEnabled !== true
      ) {
        return CloudLiveRead.refusal(
          displayCommand,
          CLOUD_LIVE_READ_LOGS_OFF_MESSAGE,
        );
      }

      if (!account.cloudConnectionId) {
        return CloudLiveRead.refusal(
          displayCommand,
          `No cloud connection reads ${accountLabel}, so it cannot be read live. Connect it under Cloud → Connect: live reads go through its read-only connection.`,
        );
      }

      const inventory: CloudLiveReadInventoryRow | null =
        await CloudLiveRead.findInventoryRow({
          projectId: data.projectId,
          provider,
          accountId: account.accountId,
          resourceId: resource.id,
        });

      if (
        !CloudLiveRead.isInAccount({
          provider,
          resource,
          accountId: account.accountId,
          isInInventory: inventory !== null,
        })
      ) {
        return CloudLiveRead.refusal(
          displayCommand,
          `${liveText(resource.id, 300)} is not in ${accountLabel}: its id names ${
            resource.accountId
              ? `another account (${resource.accountId})`
              : "no account"
          } and the account's inventory does not list it, so it is not read through this account's connection.`,
        );
      }

      const connection: CloudConnection | null =
        await CloudConnectionService.findOneBy({
          query: {
            _id: account.cloudConnectionId,
            projectId: data.projectId,
          },
          select: {
            _id: true,
            projectId: true,
            provider: true,
            config: true,
            secrets: true,
            isEnabled: true,
            pullState: true,
          },
          props: { isRoot: true },
        });

      if (!connection || (connection.provider as string) !== provider) {
        return CloudLiveRead.refusal(
          displayCommand,
          `The cloud connection that read ${accountLabel} no longer exists, so it cannot be read live. Connect it again under Cloud → Connect.`,
        );
      }

      if (!connection.isEnabled) {
        return CloudLiveRead.refusal(
          displayCommand,
          `The cloud connection that reads ${accountLabel} is turned off, so it cannot be read live. Turn the connection on to read it.`,
        );
      }

      const now: () => Date =
        dependencies.now ||
        ((): Date => {
          return new Date();
        });

      if (
        !(await CloudLiveReadRateLimit.take({
          cloudAccountId: data.cloudAccountId.toString(),
          now: now(),
        }))
      ) {
        return CloudLiveRead.refusal(
          displayCommand,
          `${accountLabel} has been read live ${CLOUD_LIVE_READS_PER_MINUTE} times in the last minute, the most OneUptime reads one account. Read it again in a minute, or continue with OneUptime's stored copy (query_cloud_resource).`,
        );
      }

      const settings: CloudConnectionSettings =
        await CloudConnectionService.getConnectorSettings(connection);

      secrets.push(...CloudLiveRead.secretValuesOf(settings));

      const context: CloudLiveReadContext = {
        transport:
          dependencies.transport ||
          DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
        now,
        sleep: dependencies.sleep,
        budget: new CloudReadBudget({ maxRequests, maxDurationMs }),
        requestTimeoutInMs: CLOUD_LIVE_READ_REQUEST_TIMEOUT_MS,
      };
      const target: CloudLiveReadTarget = {
        command,
        resource,
        accountId: account.accountId,
        inventory,
      };
      const text: string = await CloudLiveRead.readCloud({
        provider,
        settings,
        state: CloudConnectionPullRunner.readPullState(connection.pullState),
        connectionId: connection.id?.toString() || "",
        target,
        context,
        secrets,
      });

      return CloudLiveRead.answer({
        displayCommand,
        text,
        secrets,
        resourceType: data.resourceType,
      });
    } catch (error) {
      return {
        ok: false,
        displayCommand,
        output: "",
        errorMessage: CloudLiveRead.describeFailure({
          error,
          provider,
          kindSpec,
          secrets,
          maxRequests,
          maxDurationMs,
          resourceType: data.resourceType,
        }),
        redactionCount: 0,
        isTruncated: false,
      };
    }
  }

  private static refusal(
    displayCommand: string,
    errorMessage: string,
  ): CloudLiveReadOutcome {
    return {
      ok: false,
      displayCommand,
      output: "",
      errorMessage,
      redactionCount: 0,
      isTruncated: false,
    };
  }

  /*
   * The resource's row in the account's inventory - a live Cloud Resource of
   * the same project, cloud and account with this provider id (Azure's
   * compared case-insensitively) - or null when the inventory does not list
   * it.
   */
  private static async findInventoryRow(data: {
    projectId: ObjectID;
    provider: CloudCatalogProvider;
    accountId: string;
    resourceId: string;
  }): Promise<CloudLiveReadInventoryRow | null> {
    const row: CloudResource | null = await CloudResourceService.findOneBy({
      query: {
        projectId: data.projectId,
        cloudProvider: data.provider,
        cloudAccountId: data.accountId,
        providerResourceId:
          data.provider === "azure"
            ? QueryHelper.findWithSameText(data.resourceId)
            : data.resourceId,
        isArchived: false,
      },
      select: {
        _id: true,
        name: true,
        providerResourceId: true,
        cloudResourceType: true,
        cloudRegion: true,
        cloudProperties: true,
        cloudTags: true,
        inventoriedAt: true,
      },
      props: { isRoot: true },
    });

    if (
      !row ||
      (row.providerResourceId &&
        !isSameCloudResourceId(
          data.provider,
          row.providerResourceId,
          data.resourceId,
        ))
    ) {
      return null;
    }

    const properties: JSONObject =
      row.cloudProperties &&
      typeof row.cloudProperties === "object" &&
      !Array.isArray(row.cloudProperties)
        ? row.cloudProperties
        : {};
    const tags: Dictionary<string> =
      row.cloudTags && typeof row.cloudTags === "object" ? row.cloudTags : {};
    const listedAt: Date | null = row.inventoriedAt
      ? new Date(row.inventoriedAt)
      : null;

    return {
      name: row.name || "",
      resourceType: row.cloudResourceType || "",
      region: row.cloudRegion || "",
      properties,
      tags,
      inventoriedAt:
        listedAt && Number.isFinite(listedAt.getTime()) ? listedAt : null,
    };
  }

  /*
   * Whether a resource is in the account: its id names the account (an
   * Azure subscription id compared without regard to case), or the
   * account's inventory lists it.
   */
  private static isInAccount(data: {
    provider: CloudCatalogProvider;
    resource: ParsedCloudResource;
    accountId: string;
    isInInventory: boolean;
  }): boolean {
    if (data.isInInventory) {
      return true;
    }

    const named: string = data.resource.accountId.trim();

    if (!named) {
      return false;
    }

    return data.provider === "azure"
      ? named.toLowerCase() === data.accountId.trim().toLowerCase()
      : named === data.accountId.trim();
  }

  /*
   * Every secret value of the connection: its secret settings, and on their
   * own the private key and key id inside a Google service account key.
   */
  private static secretValuesOf(
    settings: CloudConnectionSettings,
  ): Array<string> {
    const values: Array<string> = getCloudSecretValues(settings);
    const key: string = readCloudSetting(
      settings.secrets,
      "serviceAccountJson",
    );

    if (key) {
      try {
        const parsed: unknown = JSON.parse(key);

        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const field of ["private_key", "private_key_id"]) {
            const value: unknown = (parsed as Record<string, unknown>)[field];

            if (typeof value === "string" && value.length >= 8) {
              values.push(value);
            }
          }
        }
      } catch {
        // A key that is not JSON is redacted whole, as it is.
      }
    }

    return values;
  }

  // The read, by the cloud's reader, once the connection is known to read the account.
  private static async readCloud(data: {
    provider: CloudCatalogProvider;
    settings: CloudConnectionSettings;
    state: CloudConnectionPullState;
    connectionId: string;
    target: CloudLiveReadTarget;
    context: CloudLiveReadContext;
    secrets: Array<string>;
  }): Promise<string> {
    switch (data.provider) {
      case "aws":
        return await CloudLiveRead.readAws(data);
      case "azure": {
        const named: Array<string> =
          new AzureCloudConnector().getSubscriptionIds(data.settings);

        if (
          named.length > 0 &&
          !named.some((subscriptionId: string): boolean => {
            return (
              subscriptionId.toLowerCase() ===
              data.target.accountId.toLowerCase()
            );
          })
        ) {
          throw CloudLiveRead.notReadByConnection(
            data.target.accountId,
            "subscription",
          );
        }

        return await AzureLiveRead.read({
          target: data.target,
          context: data.context,
          settings: data.settings,
        });
      }
      case "gcp": {
        const connector: GcpCloudConnector = new GcpCloudConnector();
        const projects: Array<string> = connector.isOrganization(data.settings)
          ? (data.state.organizationAccounts || []).map(
              (project: { id: string }): string => {
                return project.id;
              },
            )
          : connector.getProjects(data.settings);

        if (projects.length > 0 && !projects.includes(data.target.accountId)) {
          throw CloudLiveRead.notReadByConnection(
            data.target.accountId,
            "project",
          );
        }

        return await GcpLiveRead.read({
          target: data.target,
          context: data.context,
          serviceAccountJson: readCloudSetting(
            data.settings.secrets,
            "serviceAccountJson",
          ),
        });
      }
      default:
        throw new CloudLiveReadError({
          reason: "refused",
          message: "This cloud has no live reads.",
        });
    }
  }

  private static notReadByConnection(
    accountId: string,
    noun: string,
  ): CloudLiveReadError {
    return new CloudLiveReadError({
      reason: "refused",
      message: `The account's cloud connection does not read the ${noun} ${accountId} any more, so it is not read live through it. Connect the ${noun} again under Cloud → Connect.`,
    });
  }

  /*
   * AWS: the credentials of the role (or key) the connection reads this
   * account with - for an Organization, the role the StackSet put in this
   * account, and only when the account is one the connection lists.
   */
  private static async readAws(data: {
    settings: CloudConnectionSettings;
    state: CloudConnectionPullState;
    connectionId: string;
    target: CloudLiveReadTarget;
    context: CloudLiveReadContext;
    secrets: Array<string>;
  }): Promise<string> {
    const connector: AwsCloudConnector = new AwsCloudConnector();
    const accountId: string = data.target.accountId;
    const roleAccount: string = accountOfRoleArn(
      readCloudSetting(data.settings.config, "roleArn"),
    );
    const isOrganization: boolean = connector.isOrganization(data.settings);
    let settings: CloudConnectionSettings = data.settings;

    if (isOrganization) {
      const listed: boolean = (data.state.organizationAccounts || []).some(
        (member: { id: string }): boolean => {
          return member.id === accountId;
        },
      );

      if (!listed && roleAccount !== accountId) {
        throw new CloudLiveReadError({
          reason: "refused",
          message: `The account's cloud connection reads an AWS Organization, and ${accountId} is not one of the accounts it last listed, so it is not read through it.`,
        });
      }

      settings = connector.settingsForAccount(data.settings, accountId);
    } else {
      const reads: string =
        connector.getAuthMethod(data.settings) ===
        CloudConnectionAuthMethod.AwsRole
          ? roleAccount
          : data.state.accounts?.[0] || "";

      if (reads && reads !== accountId) {
        throw new CloudLiveReadError({
          reason: "refused",
          message: `The account's cloud connection reads AWS account ${reads}, not ${accountId}, so ${accountId} is not read live through it.`,
        });
      }
    }

    let credentials: AwsCredentials;

    try {
      credentials = await connector.getCredentials(settings, {
        transport: data.context.transport,
        now: data.context.now,
        sleep: data.context.sleep,
        requestTimeoutInMs: data.context.requestTimeoutInMs,
        connectionId: data.connectionId,
        budget: data.context.budget,
      });
    } catch (error) {
      if (error instanceof LlmProviderError) {
        throw new LlmProviderError({
          message: `OneUptime could not sign in to the connection's role${
            isOrganization ? ` in account ${accountId}` : ""
          }: ${error.message}`,
          kind: CloudConnectionFailureKind.Authentication,
          statusCode: error.statusCode,
        });
      }

      throw error;
    }

    data.secrets.push(credentials.secretAccessKey);

    if (credentials.sessionToken) {
      data.secrets.push(credentials.sessionToken);
    }

    return await AwsLiveRead.read({
      target: data.target,
      context: data.context,
      credentials,
    });
  }

  /*
   * The text with the connection's secrets and the generic secret and
   * personal-data rules redacted - the rules an agent's output goes
   * through (ResourceCommandJobRunner.redactText) - and the count of what
   * was.
   */
  private static redact(data: {
    text: string;
    secrets: Array<string>;
    resourceType: AiResourceType;
  }): { text: string; count: number } {
    let text: string = data.text;
    let count: number = 0;

    for (const secret of data.secrets) {
      if (typeof secret !== "string" || secret.length < 4) {
        continue;
      }

      // split/join: an exact, linear replacement of every occurrence.
      const parts: Array<string> = text.split(secret);

      if (parts.length > 1) {
        count += parts.length - 1;
        text = parts.join(REDACTED);
      }
    }

    const structured: { text: string; redactionCount: number } =
      redactResourceCommandOutputWithCount({
        resourceType: data.resourceType,
        program: CLOUD_PROGRAM,
        text,
      });
    const generic: { text: string; count: number } =
      ToolResultSerializer.redact(structured.text);

    return {
      text: generic.text,
      count: count + structured.redactionCount + generic.count,
    };
  }

  private static answer(data: {
    displayCommand: string;
    text: string;
    secrets: Array<string>;
    resourceType: AiResourceType;
  }): CloudLiveReadOutcome {
    // Cut first, at a line, so the redaction reads at most the cap.
    const capped: { text: string; isTruncated: boolean } =
      capCloudLiveReadOutput(data.text);
    const redacted: { text: string; count: number } = CloudLiveRead.redact({
      text: capped.text,
      secrets: data.secrets,
      resourceType: data.resourceType,
    });
    // A redaction can lengthen a line: cut again if it did.
    const recapped: { text: string; isTruncated: boolean } =
      capCloudLiveReadOutput(defuseToolResultClose(redacted.text));

    return {
      ok: true,
      displayCommand: data.displayCommand,
      output: recapped.text,
      redactionCount: redacted.count,
      isTruncated: capped.isTruncated || recapped.isTruncated,
    };
  }

  private static setupHint(provider: CloudCatalogProvider | null): string {
    switch (provider) {
      case "aws":
        return AWS_LIVE_READ_SETUP_HINT;
      case "azure":
        return AZURE_LIVE_READ_SETUP_HINT;
      case "gcp":
        return GCP_LIVE_READ_SETUP_HINT;
      default:
        return "Run the cloud connection's setup command again: it adds the read permissions live reads use.";
    }
  }

  // Why a read failed, in words an operator can act on, secrets redacted.
  private static describeFailure(data: {
    error: unknown;
    provider: CloudCatalogProvider | null;
    kindSpec: CloudOperationKindSpec | null;
    secrets: Array<string>;
    maxRequests: number;
    maxDurationMs: number;
    resourceType: AiResourceType;
  }): string {
    const cloud: string = data.provider
      ? CLOUD_CATALOG_PROVIDER_NAMES[data.provider]
      : "The cloud";
    const catalogPermissions: string =
      data.kindSpec && data.kindSpec.permissions.length > 0
        ? data.kindSpec.permissions.join(", ")
        : "the read permission this read needs";
    const error: unknown = data.error;
    const said: (message: string) => string = (message: string): string => {
      const shown: string = liveText(message, 400);
      return shown ? ` (${cloud} said: ${shown})` : "";
    };
    let message: string;

    if (error instanceof CloudLiveReadError) {
      message =
        error.reason === "permission"
          ? `${cloud} refused the read: the account's cloud connection may not call ${
              error.permission || catalogPermissions
            }, which this read needs. ${CloudLiveRead.setupHint(data.provider)}${said(
              error.message,
            )}`
          : error.message;
    } else if (error instanceof CloudReadBudgetSpent) {
      const seconds: number = Math.round(data.maxDurationMs / 1000);

      message = `The read stopped at its limit of ${data.maxRequests} request${
        data.maxRequests === 1 ? "" : "s"
      } in ${seconds} second${seconds === 1 ? "" : "s"} before it finished. Ask for less (a smaller --limit, --hours or --minutes), or continue with OneUptime's stored copy (query_cloud_resource).`;
    } else if (error instanceof LlmProviderError) {
      switch (error.kind) {
        case CloudConnectionFailureKind.Permission:
          message = `${cloud} refused the read: the account's cloud connection may not call ${catalogPermissions}, which this read needs. ${CloudLiveRead.setupHint(
            data.provider,
          )}${said(error.message)}`;
          break;
        // Never "credential: ..." - the output redaction reads that as a secret.
        case CloudConnectionFailureKind.Authentication:
          message = `${cloud} did not let the account's cloud connection sign in. ${error.message} Check the connection: run its setup command again and paste what it prints.`;
          break;
        case CloudConnectionFailureKind.RateLimited:
          message = `${cloud} asked OneUptime to slow down, so the read stopped: ${error.message} Read again in a minute.`;
          break;
        default:
          message = error.message;
      }
    } else if (error instanceof BadDataException) {
      message = `The account's cloud connection cannot be read: ${error.message}`;
    } else {
      logger.error(
        `A live read of a cloud account failed: ${LlmProviderError.redact(
          error instanceof Error ? error.message : String(error),
          data.secrets,
        )}`,
      );
      message = "The live read failed in OneUptime before the cloud answered.";
    }

    return CloudLiveRead.redact({
      text: LlmProviderError.redact(message, data.secrets),
      secrets: data.secrets,
      resourceType: data.resourceType,
    }).text;
  }
}
