import crypto from "crypto";
import { USER_AGENT_PREFIX } from "../IngestClient";
import PrepareGuard, {
  DEFAULT_GUARD_POLICY,
  GuardPolicy,
  GuardResult,
  mergeTargets,
  refusalPrefix,
} from "./PrepareGuard";
import {
  ExecResult,
  ExecutorOptions,
  PrepareResult,
  ResourceCommandRequest,
  ResourceExecutor,
  ResourcePostureProbe,
} from "./ResourceExecutor";
import { redactOutput, replaceNulCharacters } from "./SpawnSandbox";
import AwsCloud, { AwsProbe } from "./Cloud/AwsOperations";
import AzureCloud, { AzureProbe } from "./Cloud/AzureOperations";
import GcpCloud, { GcpProbe } from "./Cloud/GcpOperations";
import {
  CloudHttpRequest,
  CloudHttpResponse,
  CloudSender,
  CloudTransport,
  MAX_CLOUD_RESPONSE_BYTES,
  cloudTransport,
  describeCloudError,
} from "./Cloud/CloudHttp";
import {
  CloudChangeError,
  CloudChangeOutcome,
  CloudCommandRun,
  CloudDryRunStop,
  CloudNotRunError,
  CloudRuntime,
  showCloudId,
} from "./Cloud/CloudChange";
import {
  CloudAgentSettings,
  formatRequiredTag,
  parseCloudAgentSettings,
} from "./Cloud/CloudSettings";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  CloudAiAgentProvider,
  getCloudAiAgentOwnTargets,
} from "../Common/Types/ResourceAiAgent/CloudAiAgentNames";
import {
  MAX_POSTURE_STRING_LENGTH,
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_CLOUD_OPERATIONS_ENV,
  RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  CLOUD_CATALOG_PROVIDER_NAMES,
  CLOUD_PROGRAM,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudUndoResult,
  ParsedCloudCommand,
  formatCloudDryRunVerdict,
  formatCloudReplacedValue,
  getCloudCatalogProvider,
  getCloudUndoCommand,
  isCloudChangeOperation,
  isCloudDryRun,
  parseCloudCommand,
} from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  ResourceCommandPolicyResult,
  renderResourceDisplayCommand,
} from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The executor for cloud accounts: an AWS account, an Azure subscription
 * or a Google Cloud project, served by a Cloud AI agent that runs in the
 * customer's own cloud. There is no `cloud` binary: a command OneUptime AI
 * composed from the closed catalog —
 *
 *   cloud whoami
 *   cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/web --count 4
 *   cloud roll-back-service //run.googleapis.com/projects/p/locations/us-central1/services/web
 *
 * — is read by the policy copy's parseCloudCommand (the SAME parse that
 * tiered it) into one catalog operation, which this executor carries out
 * as the ONE API call it maps to (Cloud/AwsOperations, AzureOperations,
 * GcpOperations), with the credentials of where it runs. See
 * ResourceExecutor for the contract every executor keeps; what this one
 * adds:
 *
 *   - prepare() runs PrepareGuard first (with the agent's own stack,
 *     service, roles and identity as protected targets — CloudAiAgentNames —
 *     plus its own service as it finds it), then refuses: an operation that
 *     runs on OneUptime (the reads), a change ONEUPTIME_AI_CLOUD_OPERATIONS
 *     does not enable, a resource outside the agent's own account
 *     (subscription, project), and settings it cannot read
 *     (ONEUPTIME_AI_CLOUD_REQUIRED_TAG, ONEUPTIME_AI_AWS_WRITE_ROLE_ARN).
 *     Nothing is sent before run().
 *   - run() reads what the change replaces, checks its bounds and the
 *     required tag, makes the ONE call, and reports. A change's output
 *     starts with formatCloudReplacedValue(...) — the line the server
 *     reads back to build the change's exact undo — then says what changed,
 *     the call it made, and how to undo it.
 *   - A dry run (`cloud dry-run <change> ...`, a Read) checks the change
 *     the way prepare() and run() would - the write switch and scope, the
 *     enabled changes, the account, the required tag, the resource's state
 *     and the bounds - and makes the reads before it, then stops at the
 *     change call (CloudCommandRun's dryRun). Its output starts with the
 *     verdict (formatCloudDryRunVerdict): would-run, followed by the value
 *     the change would replace, or would-be-refused, followed by why. On
 *     AWS its session of the write role only reads.
 *   - Output is redacted with the policy copy's redactor and capped at
 *     MAX_RESOURCE_AGENT_OUTPUT_BYTES.
 *
 * How a failure reads on the server: everything before the change call (a
 * refusal, a credential, a read) has no exit code and no output — "never
 * ran". An error answer to the change call has exit code 1; no answer to
 * it in time is "Killed (timeout …)"; both have output, and so read as
 * "ran": a change that may have landed is never forgotten or repeated.
 */

// Each posture call gives up after this long (the posture's budget is 15 s).
export const CLOUD_PROBE_CALL_TIMEOUT_MS: number = 5_000;

// What toolVersion says, per cloud.
export const CLOUD_TOOL_VERSIONS: Readonly<
  Record<CloudCatalogProvider, string>
> = {
  aws: "AWS",
  azure: "Azure Resource Manager",
  gcp: "Google Cloud",
};

const TIER_RANK: Readonly<Record<string, number>> = {
  [ResourceCommandTier.Read]: 0,
  [ResourceCommandTier.SafeWrite]: 1,
  [ResourceCommandTier.RiskyWrite]: 2,
};

const AWS_ACCOUNT_PATTERN: RegExp = /^[0-9]{12}$/;
const PROJECT_NUMBER_PATTERN: RegExp = /^[0-9]{1,20}$/;
// A message that already ends a sentence.
const SENTENCE_END_PATTERN: RegExp = /[.!?)]$/;
// A Container App's name (CONTAINER_APP_NAME), as Azure allows it.
const CONTAINER_APP_NAME_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,31}$/;

/*
 * Test seams, never set by the agent (ExecutorFactory constructs every
 * executor with its options alone).
 */
export interface CloudExecutorInternals {
  transport?: CloudTransport | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  // A fresh 8-hex-digit id for each AWS write session's name.
  randomId?: (() => string) | undefined;
  // Reads AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE.
  readFile?: ((path: string) => string) | undefined;
}

// A command every check allowed, with what run() needs.
interface CloudCall {
  resourceType: AiResourceType;
  displayCommand: string;
  tier: ResourceCommandTier;
  command: ParsedCloudCommand;
  settings: CloudAgentSettings;
  accountId: string;
  timeoutInMs: number;
  // The guard's policy result, to check a second target a change must touch.
  policy: ResourceCommandPolicyResult;
}

function realSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function sentence(text: string): string {
  const trimmed: string = text.trim();
  return SENTENCE_END_PATTERN.test(trimmed) ? trimmed : `${trimmed}.`;
}

/*
 * The undo line: the catalog's inverse with the value the change replaced,
 * or why there is none.
 */
export function describeCloudUndo(
  command: ParsedCloudCommand,
  replaced: Record<string, string>,
): string {
  const undo: CloudUndoResult = getCloudUndoCommand({ command, replaced });

  if (undo.kind === "command") {
    const argv: Array<string> = undo.argv.slice();

    // An Azure id lowercased, so the redactor leaves it readable (showCloudId).
    if (argv[2]) {
      argv[2] = showCloudId(command.provider, argv[2]);
    }

    return `To undo it: ${renderResourceDisplayCommand(argv)}`;
  }

  if (undo.kind === "unknown") {
    return `It cannot be undone exactly: ${sentence(undo.reason)}`;
  }

  // "cloud restart-service: nothing to undo: the same version runs again".
  let reason: string = undo.reason;
  const prefix: string = `${CLOUD_PROGRAM} ${command.operation.name}: `;

  if (reason.startsWith(prefix)) {
    reason = reason.slice(prefix.length);
  }

  if (reason.startsWith("nothing to undo")) {
    reason = reason.slice("nothing to undo".length).replace(/^[:\s]+/, "");
  }

  return reason ? `Nothing to undo: ${sentence(reason)}` : "Nothing to undo.";
}

/*
 * A refusal says ", so nothing was changed" when it stops a change; a dry
 * run's answer says that once, up front, so its reason drops the phrase.
 */
const NOTHING_CHANGED_PHRASE: string = ", so nothing was changed";

export function withoutNothingChanged(reason: string): string {
  return reason.split(NOTHING_CHANGED_PHRASE).join("");
}

// How each key of a replaced value reads in a sentence.
const REPLACED_VALUE_WORDS: Readonly<Record<string, string>> = {
  count: "count",
  version: "version",
  value: "limit",
  state: "state",
  primary: "primary",
};

/*
 * ", replacing count 2 and version web:41" for a dry run's sentence, or ""
 * when the change replaces nothing it reports (a restart, a reboot).
 */
export function describeReplacedValue(
  replaced: Record<string, string>,
): string {
  const parts: Array<string> = Object.keys(replaced)
    .sort()
    .filter((key: string): boolean => {
      return typeof replaced[key] === "string" && replaced[key] !== "";
    })
    .map((key: string): string => {
      return `${REPLACED_VALUE_WORDS[key] || key} ${replaced[key]}`;
    });

  if (parts.length === 0) {
    return "";
  }

  return `, replacing ${parts.join(" and ")}`;
}

export default class CloudExecutor implements ResourceExecutor {
  private readonly provider: CloudCatalogProvider | null;
  private readonly runtime: CloudRuntime;
  private readonly aws: AwsCloud | null = null;
  private readonly azure: AzureCloud | null = null;
  private readonly gcp: GcpCloud | null = null;

  public constructor(
    private readonly options: ExecutorOptions,
    internals: CloudExecutorInternals = {},
  ) {
    this.provider = getCloudCatalogProvider(options.config.resourceType);
    this.runtime = {
      transport: internals.transport || cloudTransport,
      nowMs: (): number => {
        return options.now ? options.now().getTime() : Date.now();
      },
      sleep: internals.sleep || realSleep,
      logger: options.logger,
      userAgent: `${USER_AGENT_PREFIX}${options.config.agentVersion || "dev"}`,
    };

    const randomId: () => string =
      internals.randomId ||
      ((): string => {
        return crypto.randomBytes(4).toString("hex");
      });

    if (this.provider === "aws") {
      this.aws = new AwsCloud({
        env: options.env,
        runtime: this.runtime,
        randomId,
        readFile: internals.readFile,
      });
    } else if (this.provider === "azure") {
      this.azure = new AzureCloud({ env: options.env, runtime: this.runtime });
    } else if (this.provider === "gcp") {
      this.gcp = new GcpCloud({ env: options.env, runtime: this.runtime });
    }
  }

  // The account the agent serves: its identity (Azure lowercased).
  private accountId(): string {
    const identity: string = (
      this.options.config.resourceIdentifier || ""
    ).trim();
    return this.provider === "azure" ? identity.toLowerCase() : identity;
  }

  private settings(): CloudAgentSettings | null {
    return this.provider
      ? parseCloudAgentSettings(this.options.env, this.provider)
      : null;
  }

  /*
   * What the agent never changes: everything its setup command created
   * (CloudAiAgentNames), under every name the account goes by, and its own
   * service as it found it where it runs.
   */
  public getProtectedTargets(): Array<string> {
    if (!this.provider) {
      return [];
    }

    const provider: CloudAiAgentProvider = this.provider;
    const accounts: Array<string> = [this.accountId()];

    if (this.gcp) {
      accounts.push(
        this.gcp.metadata.getKnownProjectId() || "",
        this.gcp.metadata.getKnownProjectNumber() || "",
      );
    }

    const own: Array<Array<string>> = accounts
      .filter((account: string, index: number, all: Array<string>): boolean => {
        return Boolean(account) && all.indexOf(account) === index;
      })
      .map((accountId: string): Array<string> => {
        return getCloudAiAgentOwnTargets({ provider, accountId });
      });

    if (own.length === 0) {
      own.push(getCloudAiAgentOwnTargets({ provider, accountId: "" }));
    }

    return mergeTargets(...own, this.detectedTargets());
  }

  private detectedTargets(): Array<string> {
    if (this.aws) {
      return this.aws.getDetectedTargets();
    }

    if (this.gcp) {
      return this.gcp.getDetectedTargets();
    }

    const app: string = (this.options.env["CONTAINER_APP_NAME"] || "")
      .trim()
      .toLowerCase();
    const subscription: string = this.accountId();

    return this.azure && subscription && CONTAINER_APP_NAME_PATTERN.test(app)
      ? [
          `/subscriptions/${subscription}/resourcegroups/*/providers/microsoft.app/containerapps/${app}`,
        ]
      : [];
  }

  // ---- prepare ---------------------------------------------------------------------------

  public prepare(request: ResourceCommandRequest): PrepareResult {
    const guarded: GuardResult = PrepareGuard.check({
      config: this.options.config,
      request,
      protectedTargets: this.getProtectedTargets(),
      policy: this.options.guardPolicy,
    });

    if (guarded.refusal !== null) {
      return { refusal: guarded.refusal };
    }

    const refused: string = refusalPrefix(guarded.resourceType);
    const provider: CloudCatalogProvider | null = this.provider;
    const settings: CloudAgentSettings | null = this.settings();

    if (!provider || !settings) {
      return {
        refusal: `${refused}: this agent does not serve a cloud account, so it runs no cloud command.`,
      };
    }

    /*
     * The operation, from the same parse that tiered the command: the guard
     * already asked the policy, so a refusal here means the two disagree
     * (which only an injected test policy can make happen).
     */
    const parse: CloudCommandParse = parseCloudCommand(
      provider,
      guarded.argv.slice(),
    );

    if (!parse.ok) {
      return {
        refusal: `${refused}: its cloud catalog refuses "${guarded.displayCommand}": ${sentence(parse.errorMessage)}`,
      };
    }

    const command: ParsedCloudCommand = parse.command;
    const name: string = command.operation.name;

    if (command.operation.runsOn === "server") {
      return {
        refusal: `${refused}: cloud ${name} runs on OneUptime through the account's read-only connection, not on the agent.`,
      };
    }

    if (
      (TIER_RANK[command.kindSpec.tier] ?? Number.MAX_SAFE_INTEGER) >
      (TIER_RANK[guarded.tier] ?? -1)
    ) {
      return {
        refusal: `${refused}: its command policy reads "${guarded.displayCommand}" as ${guarded.tier}, but cloud ${name} is ${command.kindSpec.tier} in its catalog, so it does not run. Run the agent image version that matches your OneUptime server.`,
      };
    }

    const accountId: string = this.accountId();

    if (isCloudChangeOperation(command.operation)) {
      const problem: string | null = this.describeChangeProblem({
        command,
        settings,
        accountId,
      });

      if (problem) {
        return { refusal: `${refused}: ${problem}` };
      }
    }

    const call: CloudCall = {
      resourceType: guarded.resourceType,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      command,
      settings,
      accountId,
      timeoutInMs: guarded.timeoutInMs,
      policy: guarded.policy,
    };

    return {
      refusal: null,
      displayCommand: guarded.displayCommand,
      tier: guarded.tier,
      run: (): Promise<ExecResult> => {
        return this.run(call);
      },
    };
  }

  // Why the agent's own settings refuse this change, or null.
  private describeChangeProblem(data: {
    command: ParsedCloudCommand;
    settings: CloudAgentSettings;
    accountId: string;
  }): string | null {
    const { command, settings, accountId } = data;
    const name: string = command.operation.name;
    const cloud: string = CLOUD_CATALOG_PROVIDER_NAMES[command.provider];

    if (!settings.enabledOperations.includes(name)) {
      return `cloud ${name} is not one of the changes this agent may make (${RESOURCE_AI_CLOUD_OPERATIONS_ENV}=${
        settings.enabledOperations.join(",") || "nothing it knows"
      }). Add it to ${RESOURCE_AI_CLOUD_OPERATIONS_ENV} on the agent (and its permissions to the agent's role) to let OneUptime AI make it.`;
    }

    if (settings.requiredTagProblem) {
      return settings.requiredTagProblem;
    }

    if (settings.awsWriteRoleProblem) {
      return settings.awsWriteRoleProblem;
    }

    const resource: ParsedCloudCommand["resource"] = command.resource;

    if (!resource) {
      return `cloud ${name} names no resource, so it does not run.`;
    }

    if (command.provider === "aws") {
      if (!AWS_ACCOUNT_PATTERN.test(accountId)) {
        return `it does not know which AWS account it serves, so it changes nothing.`;
      }

      if (resource.accountId !== accountId) {
        return `${resource.id} is in AWS account ${resource.accountId || "(none)"}, and this agent acts in account ${accountId} only.`;
      }

      const roleAccount: string = settings.awsWriteRoleArn
        ? settings.awsWriteRoleArn.split(":")[4] || ""
        : "";

      if (settings.awsWriteRoleArn && roleAccount !== accountId) {
        return `${RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV} names a role of account ${roleAccount}, but the agent serves account ${accountId}, so it changes nothing. Set it to a role of account ${accountId}.`;
      }

      return null;
    }

    if (command.provider === "azure") {
      if (resource.accountId.toLowerCase() !== accountId.toLowerCase()) {
        return `${showCloudId("azure", resource.id)} is in subscription ${resource.accountId}, and this agent acts in subscription ${accountId || "(unknown)"} only.`;
      }

      return null;
    }

    /*
     * Google Cloud names a project by its id or its number. The metadata
     * server knows both of the project the agent runs in, which counts
     * only when that is the project it serves.
     */
    const metadataId: string | null = this.gcp
      ? this.gcp.metadata.getKnownProjectId()
      : null;
    const metadataNumber: string | null = this.gcp
      ? this.gcp.metadata.getKnownProjectNumber()
      : null;
    const names: Array<string> = [accountId];

    if (metadataId === accountId || metadataNumber === accountId) {
      names.push(metadataId || "", metadataNumber || "");
    }

    if (accountId && names.includes(resource.accountId)) {
      return null;
    }

    // The other form of the identity, before the metadata server was read: run() checks it.
    if (
      accountId &&
      PROJECT_NUMBER_PATTERN.test(resource.accountId) !==
        PROJECT_NUMBER_PATTERN.test(accountId) &&
      (metadataId === null || metadataNumber === null)
    ) {
      return null;
    }

    return `${resource.id} is in ${cloud} project ${resource.accountId}, and this agent acts in project ${accountId || "(unknown)"} only.`;
  }

  // ---- run -------------------------------------------------------------------------------

  private async run(call: CloudCall): Promise<ExecResult> {
    if (isCloudDryRun(call.command)) {
      return this.dryRun(call);
    }

    const run: CloudCommandRun = new CloudCommandRun(
      this.runtime,
      call.command,
      call.settings,
      call.timeoutInMs,
    );

    try {
      if (!isCloudChangeOperation(call.command.operation)) {
        return this.finish(call, {
          success: true,
          exitCode: 0,
          lines: await this.whoami(run, call),
        });
      }

      await this.verifyGcpProject(run, call);

      const outcome: CloudChangeOutcome = await this.change(run, call);
      const replaced: Record<string, string> = run.replaced || {};

      return this.finish(call, {
        success: true,
        exitCode: 0,
        lines: [
          formatCloudReplacedValue(replaced),
          ...outcome.lines,
          describeCloudUndo(call.command, replaced),
        ],
      });
    } catch (err: unknown) {
      return this.describeFailure(call, run, err);
    }
  }

  // ---- Dry run --------------------------------------------------------------------------

  /*
   * A dry run of one change: every check the change would meet here, and
   * the reads it makes first, but never the call that makes it. A verdict
   * either way is a dry run that worked (exit code 0); a read it could not
   * make is a dry run that could not answer (no exit code, no output).
   */
  private async dryRun(call: CloudCall): Promise<ExecResult> {
    const change: ParsedCloudCommand | undefined = call.command.dryRunOf;

    if (!change || !change.resource) {
      return {
        success: false,
        output: "",
        errorMessage: this.redact(
          call,
          `${refusalPrefix(call.resourceType)}: the dry run names no change to check.`,
        ),
      };
    }

    const changeCommand: string = renderResourceDisplayCommand([
      CLOUD_PROGRAM,
      ...change.canonicalArgs.map((word: string, index: number): string => {
        return index === 1 ? showCloudId(change.provider, word) : word;
      }),
    ]);
    const refused: (reason: string) => ExecResult = (
      reason: string,
    ): ExecResult => {
      return this.finish(call, {
        success: true,
        exitCode: 0,
        lines: [
          formatCloudDryRunVerdict("would-be-refused"),
          `Dry run: nothing was changed. ${changeCommand} would be refused: ${sentence(
            withoutNothingChanged(reason),
          )}`,
        ],
      });
    };

    // 1. The write switch and the write scope, as the guard reads them for the change.
    const scopeRefusal: string | null = this.describeDryRunWriteRefusal(
      call,
      change,
    );

    if (scopeRefusal) {
      return refused(scopeRefusal);
    }

    // 2. The agent's own settings for the change: enabled, the tag, the role, the account.
    const problem: string | null = this.describeChangeProblem({
      command: change,
      settings: call.settings,
      accountId: call.accountId,
    });

    if (problem) {
      return refused(problem);
    }

    // 3. The reads before the change, stopping at its call.
    const run: CloudCommandRun = new CloudCommandRun(
      this.runtime,
      change,
      call.settings,
      call.timeoutInMs,
      { dryRun: true },
    );
    const changeCall: CloudCall = { ...call, command: change };

    try {
      await this.verifyGcpProject(run, changeCall);
      await this.change(run, changeCall);
    } catch (err: unknown) {
      if (err instanceof CloudDryRunStop) {
        return this.finish(call, {
          success: true,
          exitCode: 0,
          lines: [
            formatCloudDryRunVerdict("would-run"),
            formatCloudReplacedValue(err.replaced),
            `Dry run: nothing was changed. ${changeCommand} would run${describeReplacedValue(
              err.replaced,
            )}.`,
            `It would make ${change.kindSpec.apiCall}, and nothing else.`,
            describeCloudUndo(change, err.replaced),
          ],
        });
      }

      if (err instanceof CloudNotRunError && err.isRefusal) {
        return refused(err.message);
      }

      const message: string =
        err instanceof Error ? err.message : describeCloudError(err);

      return {
        success: false,
        output: "",
        errorMessage: this.redact(
          call,
          `The dry run of ${changeCommand} could not be finished, and nothing was changed: ${sentence(message)}`,
        ),
      };
    }

    // A change that returned without reaching its call: never claim it would run.
    return {
      success: false,
      output: "",
      errorMessage: this.redact(
        call,
        `The dry run of ${changeCommand} did not reach the change's call, so it cannot say whether the change would run. Nothing was changed.`,
      ),
    };
  }

  /*
   * Why the write switch or the write scope would refuse the change a dry
   * run checks, or null: the same rule the guard applies to the change
   * itself (PrepareGuard.describeWriteRefusal), on the change's own policy
   * reading.
   */
  private describeDryRunWriteRefusal(
    call: CloudCall,
    change: ParsedCloudCommand,
  ): string | null {
    const policy: GuardPolicy =
      this.options.guardPolicy || DEFAULT_GUARD_POLICY;

    try {
      const result: ResourceCommandPolicyResult = policy.evaluateArgv({
        resourceType: call.resourceType,
        argv: [CLOUD_PROGRAM, ...change.canonicalArgs],
      });

      if (result.tier === ResourceCommandTier.Denied) {
        return result.reason || "its command policy denies the change";
      }

      if (result.tier === ResourceCommandTier.Read) {
        return "its command policy reads the change as changing nothing, so there is nothing to dry-run";
      }

      return PrepareGuard.describeWriteRefusal({
        config: this.options.config,
        result,
        protectedTargets: mergeTargets(
          this.options.config.protectedTargets,
          this.getProtectedTargets(),
        ),
        policy,
        resourceType: call.resourceType,
      });
    } catch {
      return "its write scope could not be checked for the change";
    }
  }

  // A resource named by a project number the agent could not place in prepare().
  private async verifyGcpProject(
    run: CloudCommandRun,
    call: CloudCall,
  ): Promise<void> {
    const resource: ParsedCloudCommand["resource"] = call.command.resource;

    if (!this.gcp || !resource || resource.accountId === call.accountId) {
      return;
    }

    const send: CloudSender = run.send.bind(run);
    const known: { id: string; number: string } = await run.read(
      "which project it runs in (the metadata server)",
      async (): Promise<{ id: string; number: string }> => {
        return {
          id: await this.gcp!.metadata.getProjectId(send),
          number: await this.gcp!.metadata.getProjectNumber(send),
        };
      },
    );
    const sameProject: boolean =
      (known.id === call.accountId || known.number === call.accountId) &&
      (known.id === resource.accountId || known.number === resource.accountId);

    if (!sameProject) {
      run.refuse(
        `${resource.id} is in Google Cloud project ${resource.accountId}, and this agent acts in project ${call.accountId} only`,
      );
    }
  }

  private whoami(
    run: CloudCommandRun,
    call: CloudCall,
  ): Promise<Array<string>> {
    const settings: CloudAgentSettings = call.settings;
    const config: ExecutorOptions["config"] = this.options.config;
    const common: Array<string> = [
      `Changes: ${
        config.allowWrites
          ? `allowed (${RESOURCE_AI_ALLOW_WRITES_ENV}=true)`
          : `not allowed: the agent is read-only (${
              config.allowWritesSetting === null
                ? `${RESOURCE_AI_ALLOW_WRITES_ENV} is not set`
                : `${RESOURCE_AI_ALLOW_WRITES_ENV}="${config.allowWritesSetting}"`
            }${config.writesOffByFixes ? ", and AI fixes are off" : ""})`
      }`,
      `Enabled changes: ${settings.enabledOperations.join(", ") || "none"} (${
        settings.operationsLimited
          ? RESOURCE_AI_CLOUD_OPERATIONS_ENV
          : `every change of the catalog: ${RESOURCE_AI_CLOUD_OPERATIONS_ENV} is not set`
      })`,
      `Required tag: ${
        settings.requiredTagProblem
          ? settings.requiredTagProblem
          : settings.requiredTag
            ? `${formatRequiredTag(settings.requiredTag)} (only resources that carry it are changed)`
            : `none (${RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV} is not set)`
      }`,
    ];
    const head: string = `Cloud: ${CLOUD_CATALOG_PROVIDER_NAMES[call.command.provider]}`;

    const withCommon: (lines: Array<string>) => Array<string> = (
      lines: Array<string>,
    ): Array<string> => {
      return [head, ...lines, ...common];
    };

    if (this.aws) {
      return this.aws
        .whoami({ run, accountId: call.accountId })
        .then(withCommon);
    }

    if (this.azure) {
      return this.azure
        .whoami({ run, subscriptionId: call.accountId })
        .then(withCommon);
    }

    if (this.gcp) {
      return this.gcp
        .whoami({ run, projectId: call.accountId })
        .then(withCommon);
    }

    return run.refuse("this agent does not serve a cloud account");
  }

  private change(
    run: CloudCommandRun,
    call: CloudCall,
  ): Promise<CloudChangeOutcome> {
    if (this.aws) {
      return this.aws.change({ run, accountId: call.accountId });
    }

    if (this.azure) {
      return this.azure.change({
        run,
        subscriptionId: call.accountId,
        checkTarget: (target: string): string | null => {
          return this.checkSecondTarget(call, target);
        },
      });
    }

    if (this.gcp) {
      return this.gcp.change({ run, projectId: call.accountId });
    }

    return run.refuse("this agent does not serve a cloud account");
  }

  /*
   * The write scope of a second target a change must touch (an Azure SQL
   * failover group's other side): the same rule the guard applied to the
   * one the command names.
   */
  private checkSecondTarget(call: CloudCall, target: string): string | null {
    const policy: GuardPolicy =
      this.options.guardPolicy || DEFAULT_GUARD_POLICY;

    try {
      const refusal: string | null = policy.getWriteScopeRefusal({
        result: { ...call.policy, targets: [target] },
        allowWrites: this.options.config.allowWrites,
        writeTargets: this.options.config.writeTargets,
        protectedTargets: mergeTargets(
          this.options.config.protectedTargets,
          this.getProtectedTargets(),
        ),
        resourceType: call.resourceType,
      });

      return refusal ? sentence(refusal) : null;
    } catch {
      return "the write scope could not be checked for the failover group's other side, so nothing was changed.";
    }
  }

  // ---- Results -----------------------------------------------------------------------------

  private describeFailure(
    call: CloudCall,
    run: CloudCommandRun,
    err: unknown,
  ): ExecResult {
    const refused: string = refusalPrefix(call.resourceType);

    if (err instanceof CloudNotRunError) {
      const message: string = err.isRefusal
        ? `${refused}: ${sentence(err.message)}`
        : sentence(err.message);

      return {
        success: false,
        output: "",
        errorMessage: this.redact(call, message),
      };
    }

    const replacedLine: Array<string> = run.changeStarted
      ? [formatCloudReplacedValue(run.replaced || {})]
      : [];

    if (err instanceof CloudChangeError) {
      const message: string = sentence(err.message);

      if (err.answered) {
        return this.finish(call, {
          success: false,
          exitCode: 1,
          lines: [...replacedLine, message],
          errorMessage: `Exit code 1: ${message}`,
        });
      }

      return this.finish(call, {
        success: false,
        exitCode: null,
        lines: [...replacedLine, message],
        errorMessage: err.timedOut
          ? `Killed (timeout ${call.timeoutInMs}ms): ${message}`
          : message,
      });
    }

    // Not expected: every step catches its own failures.
    const message: string = `The ${refused.replace(/^Refused by the /, "")} failed while running "${call.displayCommand}": ${describeCloudError(err)}`;

    if (!run.changeStarted) {
      return {
        success: false,
        output: "",
        errorMessage: this.redact(call, sentence(message)),
      };
    }

    return this.finish(call, {
      success: false,
      exitCode: null,
      lines: [
        ...replacedLine,
        sentence(message),
        "The change may have been carried out: read the resource's state before trying again.",
      ],
      errorMessage: sentence(message),
    });
  }

  /*
   * The job result: the lines redacted and capped at
   * MAX_RESOURCE_AGENT_OUTPUT_BYTES (at a line boundary), the error
   * message redacted too.
   */
  private finish(
    call: CloudCall,
    data: {
      success: boolean;
      exitCode: number | null;
      lines: Array<string>;
      errorMessage?: string | undefined;
    },
  ): ExecResult {
    let output: string = this.redact(call, data.lines.join("\n"));

    if (Buffer.byteLength(output, "utf8") > MAX_RESOURCE_AGENT_OUTPUT_BYTES) {
      const marker: string = "\n... [output truncated]";
      const head: string = Buffer.from(output, "utf8")
        .subarray(0, MAX_RESOURCE_AGENT_OUTPUT_BYTES - marker.length)
        .toString("utf8");
      const newline: number = head.lastIndexOf("\n");

      output = `${newline > 0 ? head.slice(0, newline) : head}${marker}`;
    }

    const result: ExecResult = { success: data.success, output };

    if (data.exitCode !== null) {
      result.exitCode = data.exitCode;
    }

    if (data.errorMessage) {
      result.errorMessage = this.redact(call, data.errorMessage);
    }

    return result;
  }

  private redact(call: { resourceType: AiResourceType }, text: string): string {
    return redactOutput({
      resourceType: call.resourceType,
      program: CLOUD_PROGRAM,
      text: replaceNulCharacters(text),
    });
  }

  // ---- Posture and identity -------------------------------------------------------------------

  // A sender for posture and start-up calls: each with its own short budget.
  private probeSender(): CloudSender {
    return (
      request: Omit<CloudHttpRequest, "timeoutInMs" | "maxResponseBytes">,
    ): Promise<CloudHttpResponse> => {
      return this.runtime.transport({
        ...request,
        timeoutInMs: CLOUD_PROBE_CALL_TIMEOUT_MS,
        maxResponseBytes: MAX_CLOUD_RESPONSE_BYTES,
      });
    };
  }

  /*
   * The account the agent's cloud says it is in, when no variable names
   * it: STS GetCallerIdentity's account, the one subscription the managed
   * identity may read (lowercased), the metadata server's project id.
   */
  public async resolveResourceIdentifier(): Promise<string | null> {
    const send: CloudSender = this.probeSender();

    try {
      if (this.aws) {
        return await this.aws.resolveAccount(send);
      }

      if (this.azure) {
        return await this.azure.resolveSubscription(send);
      }

      if (this.gcp) {
        return await this.gcp.resolveProject(send);
      }
    } catch (err: unknown) {
      this.options.logger.warn(
        `Could not ask ${
          this.provider
            ? CLOUD_CATALOG_PROVIDER_NAMES[this.provider]
            : "the cloud"
        } which account the agent is in`,
        { error: describeCloudError(err) },
      );
    }

    return null;
  }

  public async probePosture(): Promise<ResourcePostureProbe> {
    try {
      return await this.probe();
    } catch (err: unknown) {
      return {
        toolVersion: this.provider ? CLOUD_TOOL_VERSIONS[this.provider] : null,
        reachable: false,
        reachError: `The Cloud AI agent could not check its cloud: ${describeCloudError(err)}`,
        details: {},
        protectedTargets: this.getProtectedTargets(),
      };
    }
  }

  private async probe(): Promise<ResourcePostureProbe> {
    const provider: CloudCatalogProvider | null = this.provider;
    const settings: CloudAgentSettings | null = this.settings();

    if (!provider || !settings) {
      return {
        toolVersion: null,
        reachable: false,
        reachError: "This agent does not serve a cloud account.",
        details: {},
        protectedTargets: [],
      };
    }

    const accountId: string = this.accountId();
    const send: CloudSender = this.probeSender();
    const details: Record<string, string | number | boolean | null> = {
      cloudProvider: provider,
      cloudAccountId: accountId || null,
      enabledOperations: this.joinWithin(settings.enabledOperations),
      requiredTag: settings.requiredTag
        ? formatRequiredTag(settings.requiredTag)
        : null,
    };
    let reachable: boolean = false;
    let reachError: string | null = null;

    if (this.aws) {
      if (settings.awsWriteRoleArn) {
        details["awsWriteRoleArn"] = settings.awsWriteRoleArn;
      }

      const probe: AwsProbe = await this.aws.probe({
        send,
        accountId: accountId || null,
        settings,
      });

      details["awsPrincipalArn"] = probe.principalArn;
      details["awsRegion"] = probe.region;
      reachable = probe.reachable;
      reachError = probe.reachError;
    } else if (this.azure) {
      const probe: AzureProbe = await this.azure.probe({
        send,
        subscriptionId: accountId || null,
      });

      details["azureSubscriptionName"] = probe.subscriptionName;
      details["azureSubscriptionState"] = probe.subscriptionState;
      details["azureIdentity"] = this.azure.describeIdentity();
      reachable = probe.reachable;
      reachError = probe.reachError;
    } else if (this.gcp) {
      const probe: GcpProbe = await this.gcp.probe({
        send,
        projectId: accountId || null,
      });

      details["gcpProjectNumber"] = probe.projectNumber;
      details["gcpServiceAccount"] = probe.serviceAccount;
      reachable = probe.reachable;
      reachError = probe.reachError;
    }

    const problem: string | null =
      settings.requiredTagProblem || settings.awsWriteRoleProblem;

    if (reachable && problem) {
      details["settingsProblem"] = problem.slice(0, MAX_POSTURE_STRING_LENGTH);
    }

    return {
      toolVersion: CLOUD_TOOL_VERSIONS[provider],
      reachable,
      reachError: reachable ? null : reachError,
      details,
      protectedTargets: this.getProtectedTargets(),
    };
  }

  // "a,b,c" within the posture's string limit, cut at a comma.
  private joinWithin(names: Array<string>): string {
    let joined: string = "";

    for (const name of names) {
      const next: string = joined ? `${joined},${name}` : name;

      if (next.length > MAX_POSTURE_STRING_LENGTH) {
        break;
      }

      joined = next;
    }

    return joined;
  }

  // Nothing is written to disk: there are no job directories to remove.
  public sweepOrphanedJobDirs(): Promise<void> {
    return Promise.resolve();
  }

  public removeAllJobDirs(): Promise<void> {
    return Promise.resolve();
  }
}
