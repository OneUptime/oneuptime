import ObjectID from "../../Types/ObjectID";
import { describeCloudChange, CloudChangeWords } from "./CloudChangeWords";
import {
  CloudCatalogProvider,
  CloudCommandParse,
  ParsedCloudCommand,
  getCloudCatalogProvider,
  parseCloudCommand,
} from "./Resource/CloudOperationCatalog";
import {
  ResourceTokenizeResult,
  tokenizeResourceCommand,
} from "./Resource/ResourceCommandPolicyCore";

/*
 * A FIX THAT LASTS: THE SAME CHANGE, IN THE CODE THAT DECLARES THE RESOURCE.
 *
 * A cloud resource declared as code - by a CloudFormation stack (or the AWS
 * CDK), Terraform or OpenTofu, Bicep, Pulumi or Crossplane - takes its
 * values from that code: a change OneUptime AI makes to it live is put
 * back by the next apply. So such a change is only ever proposed
 * (CloudAiTargets), and OneUptime can also open a pull request to the code
 * with the same change, beside or instead of the live one:
 *
 *   - only for a change that sets a value the code declares - a scale, a
 *     concurrency, a roll back to a version (the catalog's changes whose
 *     undo writes a value back). A restart, a reboot, a start or a fail
 *     over leaves nothing for the next apply to undo;
 *   - in a repository connected to Code, which DeclaredCodeOwner finds
 *     from the resource's tags and the repositories' files, and a person
 *     confirms - nothing is opened without someone asking;
 *   - as a Code task (CodeTaskRuns), whose request is written here: the
 *     resource, the change and the value, and where each kind of code keeps
 *     that value.
 *
 * Shared by the server and the dashboard: React-free and Node-free.
 */

// ---- The routes -------------------------------------------------------------

export const DECLARED_CODE_OWNER_PATH: string =
  "/auto-remediation/declared-code-owner";
export const DECLARED_CODE_CHANGE_PATH: string =
  "/auto-remediation/declared-code-change";
export const DECLARED_CODE_CHANGES_PATH: string =
  "/auto-remediation/declared-code-changes";

// ---- The kinds of code ------------------------------------------------------

export enum DeclaredCodeKind {
  // Terraform and OpenTofu: HCL.
  Terraform = "terraform",
  // CloudFormation templates, and the AWS CDK, which writes them.
  CloudFormation = "cloudformation",
  Bicep = "bicep",
  Pulumi = "pulumi",
  Crossplane = "crossplane",
}

export const DECLARED_CODE_KINDS: ReadonlyArray<DeclaredCodeKind> = [
  DeclaredCodeKind.Terraform,
  DeclaredCodeKind.CloudFormation,
  DeclaredCodeKind.Bicep,
  DeclaredCodeKind.Pulumi,
  DeclaredCodeKind.Crossplane,
];

export const DECLARED_CODE_KIND_NAMES: Readonly<
  Record<DeclaredCodeKind, string>
> = {
  [DeclaredCodeKind.Terraform]: "Terraform",
  [DeclaredCodeKind.CloudFormation]: "CloudFormation",
  [DeclaredCodeKind.Bicep]: "Bicep",
  [DeclaredCodeKind.Pulumi]: "Pulumi",
  [DeclaredCodeKind.Crossplane]: "Crossplane",
};

export interface DeclaredCode {
  kind: DeclaredCodeKind;
  // How the resource's tags named it: "Terraform", "OpenTofu", "the AWS CDK".
  name: string;
  // The CloudFormation stack that made the resource, when its tags say.
  stackName: string | null;
}

const CLOUDFORMATION_STACK_PREFIX: string = 'CloudFormation stack "';

/*
 * The code a resource is declared by, from what CloudAiTargets read of its
 * tags ('CloudFormation stack "web"', "Terraform", "the AWS CDK", ...), or
 * null for anything else.
 */
export function readDeclaredCode(
  managedAsCode: string | null | undefined,
): DeclaredCode | null {
  const text: string =
    typeof managedAsCode === "string" ? managedAsCode.trim() : "";

  if (!text) {
    return null;
  }

  if (text.startsWith(CLOUDFORMATION_STACK_PREFIX) && text.endsWith('"')) {
    return {
      kind: DeclaredCodeKind.CloudFormation,
      name: "CloudFormation",
      stackName:
        text.slice(CLOUDFORMATION_STACK_PREFIX.length, -1).trim() || null,
    };
  }

  const lowered: string = text.toLowerCase();
  const byWord: ReadonlyArray<{ word: string; kind: DeclaredCodeKind }> = [
    { word: "opentofu", kind: DeclaredCodeKind.Terraform },
    { word: "terraform", kind: DeclaredCodeKind.Terraform },
    { word: "cloudformation", kind: DeclaredCodeKind.CloudFormation },
    { word: "aws cdk", kind: DeclaredCodeKind.CloudFormation },
    { word: "bicep", kind: DeclaredCodeKind.Bicep },
    { word: "pulumi", kind: DeclaredCodeKind.Pulumi },
    { word: "crossplane", kind: DeclaredCodeKind.Crossplane },
  ];

  for (const entry of byWord) {
    if (lowered.includes(entry.word)) {
      return { kind: entry.kind, name: text, stackName: null };
    }
  }

  return null;
}

// ---- Which changes last -----------------------------------------------------

/*
 * A change that sets a value the code declares: what the request is
 * written from. The value is the one the change sets (a count, a
 * concurrency, a version).
 */
export interface LastingCloudChange {
  provider: CloudCatalogProvider;
  // The catalog's operation and kind: "scale-out", "ecs-service".
  operation: string;
  kind: string;
  // The resource's id, as the command names it, and its short name.
  resourceId: string;
  resourceName: string;
  // What the change sets: "4", "v41".
  value: string;
  // The change in plain words, in English: "Scale ECS service web to 4 tasks".
  sentence: string;
  kindName: string;
}

function parse(data: {
  resourceType: unknown;
  command: string;
}): ParsedCloudCommand | null {
  const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
    data.resourceType,
  );

  if (!provider || typeof data.command !== "string") {
    return null;
  }

  const tokens: ResourceTokenizeResult = tokenizeResourceCommand(data.command);

  if (!tokens.argv) {
    return null;
  }

  const parsed: CloudCommandParse = parseCloudCommand(provider, tokens.argv);

  return parsed.ok ? parsed.command : null;
}

/*
 * The change a command makes, when it is one whose value the code declares
 * - its undo writes a value back (CloudOperationSpec.undo.valueFlag) - and
 * names the value it sets; null for any other command (a read, a restart,
 * a reboot, a start or a stop, a fail over, a dry run).
 */
export function getLastingCloudChange(data: {
  resourceType: unknown;
  command: string;
}): LastingCloudChange | null {
  const command: ParsedCloudCommand | null = parse(data);

  if (!command || command.dryRunOf || !command.resource) {
    return null;
  }

  const valueFlag: string | null | undefined =
    command.operation.undo?.valueFlag;

  if (!valueFlag) {
    return null;
  }

  const rawValue: unknown = command.flags[valueFlag];
  const value: string =
    typeof rawValue === "number" || typeof rawValue === "string"
      ? String(rawValue)
      : "";

  if (!value) {
    return null;
  }

  const words: CloudChangeWords | null = describeCloudChange(data);

  return {
    provider: command.provider,
    operation: command.operation.name,
    kind: command.kindSpec.kind,
    resourceId: command.resource.id,
    resourceName: words?.resourceName || command.resource.id,
    value,
    sentence: words?.sentence || data.command,
    kindName: words?.kindName || command.kindSpec.kind,
  };
}

// ---- Where each kind of code keeps the value ---------------------------------

// What declares a kind of resource, and the attribute that holds the value.
export interface DeclaredCodeTarget {
  // "aws_ecs_service", "AWS::ECS::Service", "Microsoft.Web/serverfarms".
  resourceType: string;
  // "desired_count", "DesiredCount", "sku.capacity".
  attribute: string;
}

type CodeTargets = Partial<Record<DeclaredCodeKind, DeclaredCodeTarget>>;

function target(resourceType: string, attribute: string): DeclaredCodeTarget {
  return { resourceType, attribute };
}

/*
 * The value of a scale, by kind of resource and kind of code: the count a
 * service, group, plan or set is declared with.
 */
const SCALE_TARGETS: Readonly<Record<string, CodeTargets>> = {
  "aws:ecs-service": {
    terraform: target("aws_ecs_service", "desired_count"),
    cloudformation: target("AWS::ECS::Service", "DesiredCount"),
    pulumi: target("aws.ecs.Service", "desiredCount"),
  },
  "aws:autoscaling-group": {
    terraform: target("aws_autoscaling_group", "desired_capacity"),
    cloudformation: target(
      "AWS::AutoScaling::AutoScalingGroup",
      "DesiredCapacity",
    ),
    pulumi: target("aws.autoscaling.Group", "desiredCapacity"),
  },
  "azure:app-service-plan": {
    terraform: target("azurerm_service_plan", "worker_count"),
    bicep: target("Microsoft.Web/serverfarms", "sku.capacity"),
    pulumi: target("azure-native.web.AppServicePlan", "sku.capacity"),
  },
  "azure:vm-scale-set": {
    terraform: target(
      "azurerm_linux_virtual_machine_scale_set (or azurerm_windows_virtual_machine_scale_set)",
      "instances",
    ),
    bicep: target("Microsoft.Compute/virtualMachineScaleSets", "sku.capacity"),
    pulumi: target(
      "azure-native.compute.VirtualMachineScaleSet",
      "sku.capacity",
    ),
  },
  "gcp:cloud-run-service": {
    terraform: target(
      "google_cloud_run_v2_service",
      "template.scaling.min_instance_count",
    ),
    pulumi: target(
      "gcp.cloudrunv2.Service",
      "template.scaling.minInstanceCount",
    ),
  },
  "gcp:managed-instance-group": {
    terraform: target(
      "google_compute_instance_group_manager (or google_compute_region_instance_group_manager)",
      "target_size",
    ),
    pulumi: target("gcp.compute.InstanceGroupManager", "targetSize"),
  },
  "gcp:app-engine-service": {
    terraform: target(
      "google_app_engine_standard_app_version",
      "manual_scaling.instances",
    ),
    pulumi: target(
      "gcp.appengine.StandardAppVersion",
      "manualScaling.instances",
    ),
  },
};

// The value of a concurrency: what a function or service is declared to take at once.
const CONCURRENCY_TARGETS: Readonly<Record<string, CodeTargets>> = {
  "aws:lambda-function": {
    terraform: target("aws_lambda_function", "reserved_concurrent_executions"),
    cloudformation: target(
      "AWS::Lambda::Function",
      "ReservedConcurrentExecutions",
    ),
    pulumi: target("aws.lambda.Function", "reservedConcurrentExecutions"),
  },
  "gcp:cloud-run-service": {
    terraform: target(
      "google_cloud_run_v2_service",
      "template.max_instance_request_concurrency",
    ),
    pulumi: target(
      "gcp.cloudrunv2.Service",
      "template.maxInstanceRequestConcurrency",
    ),
  },
};

// The value of a roll back: the version, image or revision a service is declared to run.
const VERSION_TARGETS: Readonly<Record<string, CodeTargets>> = {
  "aws:ecs-service": {
    terraform: target(
      "aws_ecs_service (and its aws_ecs_task_definition)",
      "task_definition",
    ),
    cloudformation: target("AWS::ECS::Service", "TaskDefinition"),
    pulumi: target("aws.ecs.Service", "taskDefinition"),
  },
  "aws:lambda-alias": {
    terraform: target("aws_lambda_alias", "function_version"),
    cloudformation: target("AWS::Lambda::Alias", "FunctionVersion"),
    pulumi: target("aws.lambda.Alias", "functionVersion"),
  },
  "azure:app-service": {
    terraform: target(
      "azurerm_linux_web_app (or azurerm_windows_web_app)",
      "site_config.application_stack",
    ),
    bicep: target("Microsoft.Web/sites", "siteConfig.linuxFxVersion"),
  },
  "azure:container-app": {
    terraform: target("azurerm_container_app", "template.container.image"),
    bicep: target("Microsoft.App/containerApps", "template.containers.image"),
  },
  "gcp:cloud-run-service": {
    terraform: target(
      "google_cloud_run_v2_service",
      "template.containers.image",
    ),
    pulumi: target("gcp.cloudrunv2.Service", "template.containers.image"),
  },
  "gcp:app-engine-service": {
    terraform: target(
      "google_app_engine_standard_app_version (and google_app_engine_service_split_traffic)",
      "version_id",
    ),
  },
};

function targetsOf(operation: string): Readonly<Record<string, CodeTargets>> {
  switch (operation) {
    case "scale-out":
    case "scale-in":
      return SCALE_TARGETS;
    case "set-concurrency":
      return CONCURRENCY_TARGETS;
    case "roll-back-service":
      return VERSION_TARGETS;
    default:
      return {};
  }
}

/*
 * Where a kind of code keeps the value a change sets on a kind of
 * resource, or null when this guide does not know it (the code task then
 * looks for the value itself).
 */
export function getDeclaredCodeTarget(data: {
  provider: CloudCatalogProvider;
  operation: string;
  kind: string;
  codeKind: DeclaredCodeKind;
}): DeclaredCodeTarget | null {
  return (
    targetsOf(data.operation)[`${data.provider}:${data.kind}`]?.[
      data.codeKind
    ] || null
  );
}

// ---- The files of each kind of code -------------------------------------------

function endsWithAny(path: string, endings: ReadonlyArray<string>): boolean {
  return endings.some((ending: string): boolean => {
    return path.endsWith(ending);
  });
}

function baseName(path: string): string {
  const at: number = path.lastIndexOf("/");

  return at >= 0 ? path.slice(at + 1) : path;
}

// The folders a CloudFormation template is kept in, by name.
const CLOUDFORMATION_FOLDERS: ReadonlyArray<string> = [
  "cloudformation",
  "cfn",
  "templates",
  "stacks",
];

/*
 * Whether a file of a repository is code of this kind, by its path alone
 * (repositories are read by their trees, not their files' contents).
 */
export function isDeclaredCodePath(
  rawPath: string,
  codeKind: DeclaredCodeKind,
): boolean {
  const path: string = rawPath.toLowerCase();
  const name: string = baseName(path);

  switch (codeKind) {
    case DeclaredCodeKind.Terraform:
      return (
        endsWithAny(path, [".tf", ".tf.json", ".tofu", ".tofu.json"]) ||
        name === "terragrunt.hcl"
      );
    case DeclaredCodeKind.CloudFormation: {
      if (name === "cdk.json") {
        return true;
      }

      if (!endsWithAny(path, [".yaml", ".yml", ".json", ".template"])) {
        return false;
      }

      const folders: Array<string> = path.split("/").slice(0, -1);

      return (
        name.startsWith("template.") ||
        name.includes(".template.") ||
        name.endsWith(".template") ||
        name.includes("cloudformation") ||
        name.includes("-stack.") ||
        folders.some((folder: string): boolean => {
          return CLOUDFORMATION_FOLDERS.includes(folder);
        })
      );
    }
    case DeclaredCodeKind.Bicep:
      return endsWithAny(path, [".bicep", ".bicepparam"]);
    case DeclaredCodeKind.Pulumi:
      return (
        name === "pulumi.yaml" ||
        name === "pulumi.yml" ||
        (name.startsWith("pulumi.") && endsWithAny(name, [".yaml", ".yml"]))
      );
    case DeclaredCodeKind.Crossplane:
      return (
        path.includes("crossplane") && endsWithAny(path, [".yaml", ".yml"])
      );
    default:
      return false;
  }
}

/*
 * Whether a path names this resource or stack: a folder or a file named
 * after it ("services/web/main.tf", "stacks/web.yaml", "web-service.tf").
 */
export function isPathNamedAfter(rawPath: string, rawName: string): boolean {
  const name: string = rawName.trim().toLowerCase();

  if (name.length < 3) {
    return false;
  }

  return rawPath
    .toLowerCase()
    .split("/")
    .some((part: string): boolean => {
      if (part === name) {
        return true;
      }

      if (!part.startsWith(name)) {
        return false;
      }

      const next: string = part.charAt(name.length);

      return next === "." || next === "-" || next === "_";
    });
}

// ---- The repositories a resource's code may be in -----------------------------

// Why a repository is offered for a resource's code, strongest first.
export enum DeclaredCodeOwnerReason {
  // A tag of the resource names the repository.
  NamedByTag = "named-by-tag",
  // A file or folder of its code of the right kind is named after the resource or its stack.
  HasNamedFile = "has-named-file",
  // It holds code of the kind that declares the resource.
  HasCodeOfKind = "has-code-of-kind",
  // It is the project's only repository AI can work in.
  OnlyRepository = "only-repository",
  // Nothing says it is: a person may still choose it.
  NoEvidence = "no-evidence",
}

export interface DeclaredCodeOwnerCandidateJSON {
  repositoryId: string;
  name: string;
  // "acme/infra", for a repository that names its organization.
  fullName: string;
  reason: DeclaredCodeOwnerReason;
  // Paths that named the resource or stack, at most a few.
  matchedPaths: Array<string>;
  isBest: boolean;
  // Whether the reader may ask AI to work in it (Code's permission).
  canAsk: boolean;
}

// What the dialog that asks before opening the pull request is made from.
export interface DeclaredCodeOwnerJSON {
  sequence: number;
  // The code, as the resource's tags named it, and its kind.
  managedAsCode: string;
  codeKind: DeclaredCodeKind;
  // The change, in English plain words ("Scale ECS service web to 4 tasks").
  sentence: string;
  // Where the code keeps the value, when the guide knows: "aws_ecs_service.desired_count".
  target: DeclaredCodeTarget | null;
  candidates: Array<DeclaredCodeOwnerCandidateJSON>;
}

// ---- What a requested code change is now ---------------------------------------

export enum DeclaredCodeChangeState {
  // The Code task is queued or running.
  Writing = "writing",
  // It opened a pull request.
  Opened = "opened",
  // It ended without one: nothing to change, or it needs a person's answer.
  Ended = "ended",
  // It failed or was stopped.
  Failed = "failed",
}

export interface DeclaredCodeChangeJSON {
  sequence: number;
  taskId: string;
  repositoryName: string;
  state: DeclaredCodeChangeState;
  // The pull request, for a reader who may read the repository.
  pullRequestUrl?: string | undefined;
  pullRequestNumber?: number | undefined;
}

/*
 * The link a Code task keeps to the fix it was asked from
 * (AIRun.taskContext.declaredCodeChange): the suggestion, the step and the
 * change, as they were when it was asked.
 */
export interface DeclaredCodeChangeTaskContext {
  suggestionId: string;
  sequence: number;
  resourceType: string;
  resourceId: string;
  command: string;
  managedAsCode: string;
}

export function readDeclaredCodeChangeTaskContext(
  value: unknown,
): DeclaredCodeChangeTaskContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const object: Record<string, unknown> = value as Record<string, unknown>;
  const suggestionId: unknown = object["suggestionId"];
  const sequence: unknown = object["sequence"];

  if (
    typeof suggestionId !== "string" ||
    !ObjectID.isValidUUID(suggestionId) ||
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    return null;
  }

  const text: (key: string) => string = (key: string): string => {
    return typeof object[key] === "string" ? (object[key] as string) : "";
  };

  return {
    suggestionId,
    sequence,
    resourceType: text("resourceType"),
    resourceId: text("resourceId"),
    command: text("command"),
    managedAsCode: text("managedAsCode"),
  };
}

// ---- The request the Code task is given ---------------------------------------

// What a change's request says of the resource.
export interface DeclaredResourceFacts {
  providerResourceId: string;
  name: string;
  // Its tags (labels on Google Cloud), as the inventory read them.
  tags: Record<string, string>;
}

// The most tags a request names.
const MAX_REQUEST_TAGS: number = 30;
const MAX_TAG_TEXT_LENGTH: number = 200;

function capped(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/*
 * The request a Code task is started with: the resource, the change and
 * the value it sets, where this kind of code keeps that value, and what to
 * do when the value is not the code's (it comes from autoscaling, an
 * environment's override, or the code ignores changes to it). In English:
 * it is the AI's request, and the pull request it writes says why.
 */
export function getDeclaredCodeChangeRequest(data: {
  change: LastingCloudChange;
  declaredCode: DeclaredCode;
  resource: DeclaredResourceFacts;
  // The live change exactly as OneUptime AI wrote it.
  command: string;
  // The value the live change replaced, when it ran and said.
  replacedValue?: string | null | undefined;
  // Whether the live change ran, or only waits for approval.
  hasLiveChangeRun: boolean;
}): string {
  const codeTarget: DeclaredCodeTarget | null = getDeclaredCodeTarget({
    provider: data.change.provider,
    operation: data.change.operation,
    kind: data.change.kind,
    codeKind: data.declaredCode.kind,
  });
  const tags: Array<string> = Object.keys(data.resource.tags)
    .slice(0, MAX_REQUEST_TAGS)
    .map((key: string): string => {
      return `${capped(key, MAX_TAG_TEXT_LENGTH)}=${capped(
        String(data.resource.tags[key] ?? ""),
        MAX_TAG_TEXT_LENGTH,
      )}`;
    });
  // What "in the ... code" names: the stack, or the tool ("the AWS CDK" without its "the").
  const owner: string = data.declaredCode.stackName
    ? `CloudFormation stack "${data.declaredCode.stackName}"`
    : data.declaredCode.name.startsWith("the ")
      ? data.declaredCode.name.slice(4)
      : data.declaredCode.name;
  const lines: Array<string> = [
    `${data.change.sentence}, in the ${owner} code that declares it, and open a pull request with that change.`,
    "",
    `OneUptime AI ${
      data.hasLiveChangeRun ? "made" : "proposed"
    } this change on the live resource as \`${data.command}\`${
      data.replacedValue
        ? `, replacing ${capped(data.replacedValue, MAX_TAG_TEXT_LENGTH)}`
        : ""
    }. The resource is declared as code, so the next apply puts back whatever the code says: the code must say the same.`,
    "",
    "The resource:",
    `- id: ${data.resource.providerResourceId}`,
    `- name: ${data.resource.name || data.change.resourceName}`,
  ];

  if (data.declaredCode.stackName) {
    lines.push(`- CloudFormation stack: ${data.declaredCode.stackName}`);
  }

  if (tags.length > 0) {
    lines.push(`- tags: ${tags.join(", ")}`);
  }

  lines.push("");

  if (codeTarget) {
    lines.push(
      `In ${data.declaredCode.kind === DeclaredCodeKind.Terraform ? "Terraform or OpenTofu" : DECLARED_CODE_KIND_NAMES[data.declaredCode.kind]}, the value is most likely the \`${codeTarget.attribute}\` of the \`${codeTarget.resourceType}\` that declares this resource: set it to ${data.change.value}.`,
    );
  } else {
    lines.push(
      `Find the value this change sets in the ${DECLARED_CODE_KIND_NAMES[data.declaredCode.kind]} code, and set it to ${data.change.value}.`,
    );
  }

  lines.push(
    "Find the resource by its name, id or tags. Change that one value and nothing else. If the code takes the value from a variable, change the value for this resource's environment only. If the value is not the code's to set - it comes from autoscaling, the code ignores changes to it, or another resource sets it - change nothing, and say where it comes from instead.",
  );

  return lines.join("\n");
}
