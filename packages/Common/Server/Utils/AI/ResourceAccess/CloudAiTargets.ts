import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  CLOUD_CATALOG_PROVIDER_NAMES,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudUndoResult,
  getCloudCatalogProvider,
  getCloudUndoCommand,
  parseCloudCommand,
  readCloudReplacedValue,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  getCloudDryRunCommandText,
  readCloudDryRunChange,
} from "../../../../Utils/AiRemediation/CloudChangeDryRunPlan";

// Where a fix's dry runs read a plan (pure, shared with the Dashboard).
export { getCloudDryRunCommandText, readCloudDryRunChange };
import {
  renderResourceDisplayCommand,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import CloudAccountService from "../../../Services/CloudAccountService";
import CloudResourceService from "../../../Services/CloudResourceService";
import QueryHelper from "../../../Types/Database/QueryHelper";

/*
 * WHAT A CLOUD AI AGENT'S CHANGE MAY NAME.
 *
 * A change names one resource by its provider id. Before it is composed,
 * run, approved or rolled back, that resource must be in the account's
 * inventory - a live Cloud Resource of the same cloud and account id, as
 * the account's connection listed it - so OneUptime AI only ever changes
 * what OneUptime knows is there, in the account it means. The agent checks
 * that the id is in its own account; this is the server's half.
 *
 * A resource can also be declared as code: a CloudFormation stack (and so
 * the CDK) tags what it creates, Google's Terraform provider labels it, and
 * teams tag Terraform, OpenTofu, Pulumi and Bicep resources themselves. A
 * fix there is undone by the next apply, so OneUptime AI only proposes it:
 * a person approves it, in every mode, and the plan says which code owns
 * the resource.
 */

export interface CloudChangeTarget {
  cloudResourceId: ObjectID;
  name: string;
  providerResourceId: string;
  cloudTags: Dictionary<string>;
  // "CloudFormation stack \"web\"", "Terraform", ...; null when no code owns it.
  managedAsCode: string | null;
}

export interface CloudChangeTargetCheck {
  // Why the change may not run; null when its target is in the inventory.
  refusal: string | null;
  target: CloudChangeTarget | null;
}

// Tag keys that name the tool which manages a resource, compared lowercased.
const MANAGED_BY_TAG_KEYS: ReadonlyArray<string> = [
  "managed-by",
  "managed_by",
  "managedby",
  "provisioned-by",
  "provisioned_by",
  "provisionedby",
  "provisioner",
  "iac",
  "deployed-by",
  "deployedby",
];

// What such a tag's value may name, and how the plan names the tool.
const IAC_TOOLS: ReadonlyArray<{ word: string; name: string }> = [
  { word: "terraform", name: "Terraform" },
  { word: "opentofu", name: "OpenTofu" },
  { word: "pulumi", name: "Pulumi" },
  { word: "cloudformation", name: "CloudFormation" },
  { word: "cdk", name: "the AWS CDK" },
  { word: "bicep", name: "Bicep" },
  { word: "crossplane", name: "Crossplane" },
];

const MAX_SHOWN_NAME_LENGTH: number = 128;

/*
 * The command that undoes a cloud change that ran, from the catalog's
 * inverse and the value its output's first line reports it replaced; null
 * when it has nothing to undo or the value is unknown.
 */
export function getCloudUndoCommandText(data: {
  resourceType: unknown;
  command: string;
  output: string | null | undefined;
}): string | null {
  const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
    data.resourceType,
  );
  const argv: Array<string> | undefined = tokenizeResourceCommand(
    data.command,
  ).argv;

  if (!provider || !argv) {
    return null;
  }

  const parse: CloudCommandParse = parseCloudCommand(provider, argv);

  if (!parse.ok) {
    return null;
  }

  const undo: CloudUndoResult = getCloudUndoCommand({
    command: parse.command,
    replaced: readCloudReplacedValue(data.output || ""),
  });

  return undo.kind === "command"
    ? renderResourceDisplayCommand(undo.argv)
    : null;
}

export default class CloudAiTargets {
  /*
   * Which code declares a resource, from its tags (labels on Google
   * Cloud), or null when none does.
   */
  public static getManagedAsCode(
    tags: Dictionary<string> | null | undefined,
  ): string | null {
    if (!tags || typeof tags !== "object") {
      return null;
    }

    let found: string | null = null;

    for (const key of Object.keys(tags)) {
      const rawValue: unknown = tags[key];
      const value: string = typeof rawValue === "string" ? rawValue : "";
      const folded: string = key.trim().toLowerCase();

      if (folded === "aws:cloudformation:stack-name") {
        return `CloudFormation stack "${value.slice(0, MAX_SHOWN_NAME_LENGTH)}"`;
      }

      if (found) {
        continue;
      }

      if (
        folded === "goog-terraform-provisioned" ||
        folded === "terraform" ||
        folded.startsWith("terraform:") ||
        folded.startsWith("tf:")
      ) {
        if (value.trim().toLowerCase() !== "false") {
          found = "Terraform";
        }
        continue;
      }

      if (folded.startsWith("pulumi:")) {
        found = "Pulumi";
        continue;
      }

      if (MANAGED_BY_TAG_KEYS.includes(folded)) {
        const lowered: string = value.toLowerCase();
        const tool: { word: string; name: string } | undefined = IAC_TOOLS.find(
          (candidate: { word: string }): boolean => {
            return lowered.includes(candidate.word);
          },
        );

        if (tool) {
          found = tool.name;
        }
      }
    }

    return found;
  }

  // The resource id a cloud command names (its canonical second word), or null.
  public static readCommandResourceId(data: {
    resourceType: AiResourceType;
    command: string;
  }): string | null {
    const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
      data.resourceType,
    );
    const argv: Array<string> | undefined = tokenizeResourceCommand(
      data.command,
    ).argv;

    if (!provider || !argv) {
      return null;
    }

    const parse: CloudCommandParse = parseCloudCommand(provider, argv);

    return parse.ok && parse.command.resource
      ? parse.command.resource.id
      : null;
  }

  /*
   * The inventory row a change names in this account, or null when the
   * account's inventory does not list it (live, unarchived). Azure ids are
   * compared case-insensitively, the others exactly.
   */
  public static async findChangeTarget(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    // The CloudAccount row's id.
    cloudAccountId: ObjectID;
    // The provider's id of the resource.
    providerResourceId: string;
  }): Promise<CloudChangeTarget | null> {
    const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
      data.resourceType,
    );

    if (!provider || !data.providerResourceId) {
      return null;
    }

    const account: CloudAccount | null = await CloudAccountService.findOneBy({
      query: {
        _id: data.cloudAccountId.toString(),
        projectId: data.projectId,
        provider: provider as never,
      },
      select: { _id: true, accountId: true },
      props: { isRoot: true },
    });

    if (!account || !account.accountId) {
      return null;
    }

    const resource: CloudResource | null = await CloudResourceService.findOneBy(
      {
        query: {
          projectId: data.projectId,
          cloudProvider: provider,
          // Compared without case, as the account's own counts are.
          cloudAccountId: QueryHelper.findWithSameText(account.accountId),
          providerResourceId:
            provider === "azure"
              ? QueryHelper.findWithSameText(data.providerResourceId)
              : data.providerResourceId,
          isArchived: false,
        },
        select: {
          _id: true,
          name: true,
          providerResourceId: true,
          cloudTags: true,
        },
        props: { isRoot: true },
      },
    );

    if (!resource || !resource.id) {
      return null;
    }

    const tags: Dictionary<string> =
      resource.cloudTags && typeof resource.cloudTags === "object"
        ? resource.cloudTags
        : {};

    return {
      cloudResourceId: resource.id,
      name: resource.name || data.providerResourceId,
      providerResourceId:
        resource.providerResourceId || data.providerResourceId,
      cloudTags: tags,
      managedAsCode: CloudAiTargets.getManagedAsCode(tags),
    };
  }

  /*
   * Whether a cloud change may name its resource: a read never needs to
   * (and whoami names none); a change's resource must be in the account's
   * inventory, and so must the resource of the change a dry run checks - a
   * dry run of a change OneUptime would never send would say nothing true.
   * Lookup failures propagate: every caller fails closed.
   */
  public static async checkChange(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    cloudAccountId: ObjectID;
    tier: ResourceCommandTier;
    command: string;
  }): Promise<CloudChangeTargetCheck> {
    if (data.tier === ResourceCommandTier.Read) {
      const dryRunChange: {
        command: string;
        tier: ResourceCommandTier;
      } | null = readCloudDryRunChange({
        resourceType: data.resourceType,
        command: data.command,
      });

      if (!dryRunChange || dryRunChange.tier === ResourceCommandTier.Read) {
        return { refusal: null, target: null };
      }

      return CloudAiTargets.checkChange({
        ...data,
        tier: dryRunChange.tier,
        command: dryRunChange.command,
      });
    }

    const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
      data.resourceType,
    );
    const resourceId: string | null = CloudAiTargets.readCommandResourceId({
      resourceType: data.resourceType,
      command: data.command,
    });

    if (!provider || !resourceId) {
      return {
        refusal:
          "The change names no resource of this account, so it cannot run.",
        target: null,
      };
    }

    const target: CloudChangeTarget | null =
      await CloudAiTargets.findChangeTarget({
        projectId: data.projectId,
        resourceType: data.resourceType,
        cloudAccountId: data.cloudAccountId,
        providerResourceId: resourceId,
      });

    if (!target) {
      return {
        refusal: `${resourceId.slice(0, 256)} is not in this ${CLOUD_CATALOG_PROVIDER_NAMES[provider]} account's inventory, so OneUptime AI may not change it. Name the resource by its id exactly as query_cloud_resource lists it; a resource created since the last listing is listed within 30 minutes.`,
        target: null,
      };
    }

    return { refusal: null, target };
  }
}
