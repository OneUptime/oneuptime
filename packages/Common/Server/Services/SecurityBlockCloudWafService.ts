import CloudConnectionService from "./CloudConnectionService";
import CloudResourceService from "./CloudResourceService";
import ProjectReferencesService from "./ProjectReferencesService";
import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import Model from "../../Models/DatabaseModels/SecurityBlockCloudWaf";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import SecurityBlockCloudWafs, {
  SecurityBlockCloudWafAccess,
} from "../Utils/SecurityBlocklist/SecurityBlockCloudWafs";
import SecurityBlocklistJobs from "../Utils/SecurityBlocklist/SecurityBlocklistJobs";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  AWS_WAF_WEB_ACL_RESOURCE_TYPE,
  buildAwsWafWebAclArn,
} from "../../Types/CloudConnection/AwsWafBlocklist";
import {
  AzureWafPolicyKind,
  AzureWafPolicyRef,
  getAzureWafPolicyKind,
  parseAzureWafPolicyId,
} from "../../Types/CloudConnection/AzureWafBlocklist";
import {
  CLOUD_ARMOR_POLICY_ASSET_TYPE,
  CloudArmorPolicyRef,
  CloudArmorPolicyType,
  isCloudArmorPolicyTypeSupported,
  parseCloudArmorPolicyId,
  readCloudArmorRuleDetails,
} from "../../Types/CloudConnection/CloudArmorBlocklist";
import {
  CloudConnectionField,
  WAF_BLOCKLIST_FIELD_KEY,
  getCloudConnectionDefinition,
  isCloudConnectionWafBlocklistOn,
} from "../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockCloudWafStatus,
} from "../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import {
  SecurityBlockCloudWafKind,
  canSecurityBlockCloudWafReadClientAddress,
  getSecurityBlockCloudWafKind,
} from "../../Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import {
  CLOUD_WAF_REASONS,
  cloudWafReason,
} from "../../Types/SecurityBlocklist/CloudWafReasons";
import {
  SecurityBlockReason,
  fillSecurityBlockReason,
} from "../../Types/SecurityBlocklist/SecurityBlockReason";

/*
 * THE CLOUD WAFS THAT ENFORCE A PROJECT'S BLOCKLIST (#10344): a web ACL
 * picked from its cloud connection's inventory, kept by the reconciler as a
 * destination of the blocklist (AwsWafBlockDestinationSource).
 *
 *   - Picked by its inventory row (cloudResourceId), the project's own: an
 *     AWS WAF web ACL OneUptime has listed, of a connection whose "Block
 *     addresses in AWS WAF" is on. Everything else - the connection, the
 *     web ACL's ARN, name and Region - OneUptime writes from the inventory
 *     once the create is permitted, so a caller can never point one at a
 *     web ACL of another account.
 *   - One row a web ACL.
 *   - Where it reads the client's address may change; the reconciler then
 *     writes OneUptime's rule again.
 *   - Removed with Remove (SecurityBlockCloudWafs.remove), which takes
 *     OneUptime's rule out of the web ACL first: a plain delete is refused,
 *     so no web ACL keeps blocking the project's addresses after OneUptime
 *     stopped keeping them true.
 *
 * Every change to one queues a reconcile of the project's blocklist.
 */

// Why a create is refused, in the words a person reads.
export const SECURITY_BLOCK_CLOUD_WAF_MESSAGES: {
  pickWebAcl: string;
  notAWebAcl: string;
  notListed: (data: { name: string }) => string;
  noConnection: string;
  turnOnBlocking: (data: { connection: string }) => string;
  turnOnPolicyBlocking: (data: {
    connection: string;
    setting: string;
  }) => string;
  alreadyEnforcing: (data: { name: string }) => string;
  removeWithRemove: string;
  networkPolicy: (data: { name: string }) => string;
  clientAddress: (data: { name: string }) => string;
  noAccess: (data: { name: string; permission: string }) => string;
} = {
  pickWebAcl: "Pick the web ACL to enforce your blocklist in.",
  notAWebAcl:
    "That resource is not a WAF OneUptime enforces your blocklist in. Pick an AWS WAF web ACL, an Azure WAF policy or a Cloud Armor security policy from the list.",
  notListed: (data: { name: string }): string => {
    return `OneUptime has not listed web ACL ${data.name} yet. Run its connection's setup command again so its role may list web ACLs, and try again after the next read.`;
  },
  noConnection:
    "That WAF's cloud connection is gone. Pick a WAF of a connected account.",
  turnOnBlocking: (data: { connection: string }): string => {
    return `Turn on Block addresses in AWS WAF for the connection ${data.connection} first, and run its setup command again: it grants the IP sets this needs.`;
  },
  turnOnPolicyBlocking: (data: {
    connection: string;
    setting: string;
  }): string => {
    return `Turn on ${data.setting} for the connection ${data.connection} first: a Project Owner or Project Admin can, under More fields when they edit it.`;
  },
  alreadyEnforcing: (data: { name: string }): string => {
    return `${data.name} already enforces your blocklist.`;
  },
  removeWithRemove:
    "Remove a WAF with Remove: OneUptime takes its rules out of it first.",
  networkPolicy: (data: { name: string }): string => {
    return fillSecurityBlockReason(getNetworkPolicyReason(data.name));
  },
  clientAddress: (data: { name: string }): string => {
    return `${data.name} cannot read the client's address there. Pick one of the addresses the list offers for it.`;
  },
  noAccess: (data: { name: string; permission: string }): string => {
    return `The connection may not write ${data.name} yet: it has no ${data.permission} there. Run the lines the Add WAF dialog shows for it in your cloud's shell, then add it again.`;
  },
};

// Why a network edge security policy is not offered, worded where it is drawn (#10629).
export function getNetworkPolicyReason(name: string): SecurityBlockReason {
  return cloudWafReason(CLOUD_WAF_REASONS.networkPolicy, { policy: name });
}

/*
 * A WAF the inventory holds that OneUptime cannot keep the blocklist in,
 * with why as a reason the Dashboard words in the reader's language.
 */
export class SecurityBlockCloudWafRefusal extends BadDataException {
  public readonly reason: SecurityBlockReason;

  public constructor(reason: SecurityBlockReason) {
    super(fillSecurityBlockReason(reason));
    this.reason = reason;
  }
}

// What a create resolved from the inventory, written once it is permitted.
export interface ResolvedWebAcl {
  cloudConnectionId: ObjectID;
  cloudProvider: CloudProvider;
  wafId: string;
  name: string;
  region: string;
  kind: SecurityBlockCloudWafKind;
  // A Cloud Armor policy's type: an edge policy reads no user IP.
  cloudArmorPolicyType?: string | undefined;
}

// The connection's setting that lets it block addresses, as its cloud's form names it.
export function getWafBlocklistSettingTitle(provider: CloudProvider): string {
  return (
    getCloudConnectionDefinition(provider)?.configFields.find(
      (field: CloudConnectionField): boolean => {
        return field.key === WAF_BLOCKLIST_FIELD_KEY;
      },
    )?.title || "Block addresses"
  );
}

/*
 * A row of the inventory as the WAF it is, as a row of this table would
 * name it - or why it is not one OneUptime enforces the blocklist in: an
 * AWS WAF web ACL (its ARN built from what the inventory listed), an
 * Application Gateway or Front Door WAF policy (its resource id), a Cloud
 * Armor backend or edge security policy (its project, place and name).
 */
export function readInventoryWaf(
  resource: CloudResource,
): Omit<ResolvedWebAcl, "cloudConnectionId"> {
  const properties: JSONObject = resource.cloudProperties || {};

  if (
    resource.cloudProvider === CloudProvider.AWS &&
    resource.cloudResourceType === AWS_WAF_WEB_ACL_RESOURCE_TYPE
  ) {
    const name: string =
      (typeof properties["Name"] === "string"
        ? (properties["Name"] as string)
        : resource.name || ""
      ).trim() || "";
    const wafId: string | null = buildAwsWafWebAclArn({
      region: resource.cloudRegion,
      accountId: resource.cloudAccountId,
      scope: properties["Scope"],
      name,
      id: properties["Id"],
    });

    if (!wafId) {
      throw new BadDataException(
        SECURITY_BLOCK_CLOUD_WAF_MESSAGES.notListed({
          name: name || resource.name || "",
        }),
      );
    }

    return {
      cloudProvider: CloudProvider.AWS,
      wafId,
      name: name.slice(0, 100),
      region: (resource.cloudRegion || "").trim().toLowerCase(),
      kind: SecurityBlockCloudWafKind.AwsWebAcl,
    };
  }

  if (
    resource.cloudProvider === CloudProvider.Azure &&
    getAzureWafPolicyKind(resource.cloudResourceType)
  ) {
    const policy: AzureWafPolicyRef | null = parseAzureWafPolicyId(
      resource.providerResourceId,
    );

    if (!policy) {
      throw new BadDataException(SECURITY_BLOCK_CLOUD_WAF_MESSAGES.notAWebAcl);
    }

    return {
      cloudProvider: CloudProvider.Azure,
      wafId: policy.id,
      name: (resource.name || policy.name).slice(0, 100),
      region: (resource.cloudRegion || "").trim().toLowerCase(),
      kind:
        policy.kind === AzureWafPolicyKind.ApplicationGateway
          ? SecurityBlockCloudWafKind.AzureApplicationGateway
          : SecurityBlockCloudWafKind.AzureFrontDoor,
    };
  }

  if (
    resource.cloudProvider === CloudProvider.GCP &&
    (resource.cloudResourceType || "").toLowerCase() ===
      CLOUD_ARMOR_POLICY_ASSET_TYPE.toLowerCase()
  ) {
    const policy: CloudArmorPolicyRef | null = parseCloudArmorPolicyId(
      resource.providerResourceId,
    );
    const type: string =
      typeof properties["type"] === "string"
        ? (properties["type"] as string)
        : CloudArmorPolicyType.Backend;

    if (!policy) {
      throw new BadDataException(SECURITY_BLOCK_CLOUD_WAF_MESSAGES.notAWebAcl);
    }

    if (!isCloudArmorPolicyTypeSupported(type)) {
      throw new SecurityBlockCloudWafRefusal(
        getNetworkPolicyReason(resource.name || policy.name),
      );
    }

    return {
      cloudProvider: CloudProvider.GCP,
      wafId: policy.id,
      name: (resource.name || policy.name).slice(0, 100),
      region: policy.region || "global",
      kind: SecurityBlockCloudWafKind.CloudArmor,
      cloudArmorPolicyType: type,
    };
  }

  throw new BadDataException(SECURITY_BLOCK_CLOUD_WAF_MESSAGES.notAWebAcl);
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The web ACL's connection is required of every row, and never the
   * caller's to give: onCreatePermitted writes it - after the required
   * check, so it is not held against the caller's column permissions -
   * from the inventory row onBeforeCreate resolved, and a create whose web
   * ACL has no connection was refused there.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (column === "cloudConnectionId") {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
  }

  /*
   * The web ACL a create picks, read from the project's inventory as
   * OneUptime: one it listed, of a connection that may block addresses in
   * AWS WAF, not picked yet. The reference check (super) has already held
   * the row to the caller's project.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;
    const cloudResourceId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ["cloudResourceId", "cloudResource"],
      "Cloud Resource",
    );

    if (!projectId || !cloudResourceId) {
      throw new BadDataException(SECURITY_BLOCK_CLOUD_WAF_MESSAGES.pickWebAcl);
    }

    const resolved: ResolvedWebAcl = await this.resolveWebAcl({
      projectId,
      cloudResourceId,
    });

    if (!createBy.data.clientAddress) {
      createBy.data.clientAddress = SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS;
    }

    if (
      !canSecurityBlockCloudWafReadClientAddress({
        kind: resolved.kind,
        cloudArmorPolicyType: resolved.cloudArmorPolicyType,
        clientAddress: createBy.data.clientAddress,
      })
    ) {
      throw new BadDataException(
        SECURITY_BLOCK_CLOUD_WAF_MESSAGES.clientAddress({
          name: resolved.name,
        }),
      );
    }

    /*
     * An Azure WAF or Cloud Armor policy is added only once the connection
     * may write it (#10348, #10349): asked of the cloud, writing nothing. A
     * check that cannot tell turns nothing on either (checkAccess throws).
     */
    if (resolved.cloudProvider !== CloudProvider.AWS) {
      const access: SecurityBlockCloudWafAccess =
        await SecurityBlockCloudWafs.checkAccess({
          projectId,
          cloudResourceId,
        });
      const missing: { permission: string } | undefined = access.checks.find(
        (check: { permission: string; isGranted: boolean }): boolean => {
          return !check.isGranted;
        },
      );

      if (missing) {
        throw new BadDataException(
          SECURITY_BLOCK_CLOUD_WAF_MESSAGES.noAccess({
            name: resolved.name,
            permission: missing.permission,
          }),
        );
      }
    }

    return { createBy, carryForward: resolved };
  }

  /*
   * Where a WAF reads the client's address may change, to one its kind can
   * read: refused for a WAF that cannot read it there.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const clientAddress: unknown = (
      updateBy.data as unknown as Record<string, unknown>
    )["clientAddress"];

    if (clientAddress === undefined) {
      return { updateBy, carryForward: null };
    }

    // The rows the update writes, read as OneUptime, and the update held to them.
    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        name: true,
        cloudProvider: true,
        wafId: true,
        ruleDetails: true,
      },
    );

    for (const row of rows) {
      if (
        !canSecurityBlockCloudWafReadClientAddress({
          kind: getSecurityBlockCloudWafKind({
            cloudProvider: row.cloudProvider,
            wafId: row.wafId,
          }),
          cloudArmorPolicyType: readCloudArmorRuleDetails(row.ruleDetails)
            ?.policyType,
          clientAddress: String(clientAddress),
        })
      ) {
        throw new BadDataException(
          SECURITY_BLOCK_CLOUD_WAF_MESSAGES.clientAddress({
            name: row.name || "This WAF",
          }),
        );
      }
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A web ACL of the project's inventory, as a row of this table would name
   * it - or why it cannot be picked. Public for the route that lists what
   * can be picked, which asks the same questions.
   */
  public async resolveWebAcl(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
  }): Promise<ResolvedWebAcl> {
    const resource: CloudResource | null = await CloudResourceService.findOneBy(
      {
        query: { _id: data.cloudResourceId, projectId: data.projectId },
        select: {
          _id: true,
          name: true,
          cloudProvider: true,
          cloudResourceType: true,
          cloudRegion: true,
          cloudAccountId: true,
          cloudProperties: true,
          providerResourceId: true,
          cloudConnectionId: true,
          isArchived: true,
        },
        props: { isRoot: true },
      },
    );

    if (!resource?.id || resource.isArchived) {
      throw new BadDataException(SECURITY_BLOCK_CLOUD_WAF_MESSAGES.notAWebAcl);
    }

    const waf: Omit<ResolvedWebAcl, "cloudConnectionId"> =
      readInventoryWaf(resource);

    const connection: CloudConnection | null = resource.cloudConnectionId
      ? await CloudConnectionService.findOneBy({
          query: { _id: resource.cloudConnectionId, projectId: data.projectId },
          select: { _id: true, name: true, provider: true, config: true },
          props: { isRoot: true },
        })
      : null;

    if (!connection?.id || connection.provider !== waf.cloudProvider) {
      throw new BadDataException(
        SECURITY_BLOCK_CLOUD_WAF_MESSAGES.noConnection,
      );
    }

    if (
      !isCloudConnectionWafBlocklistOn(
        (connection.config || {})[WAF_BLOCKLIST_FIELD_KEY],
      )
    ) {
      throw new BadDataException(
        waf.cloudProvider === CloudProvider.AWS
          ? SECURITY_BLOCK_CLOUD_WAF_MESSAGES.turnOnBlocking({
              connection: connection.name || "",
            })
          : SECURITY_BLOCK_CLOUD_WAF_MESSAGES.turnOnPolicyBlocking({
              connection: connection.name || "",
              setting: getWafBlocklistSettingTitle(waf.cloudProvider),
            }),
      );
    }

    // One row a WAF: an id Azure lowers in one listing and not another is the same policy.
    const isPicked: boolean = (await this.findForProject(data.projectId)).some(
      (row: Model): boolean => {
        return (row.wafId || "").toLowerCase() === waf.wafId.toLowerCase();
      },
    );

    if (isPicked) {
      throw new BadDataException(
        SECURITY_BLOCK_CLOUD_WAF_MESSAGES.alreadyEnforcing({ name: waf.name }),
      );
    }

    return { ...waf, cloudConnectionId: connection.id };
  }

  /*
   * What OneUptime writes of the web ACL from the inventory, once the
   * caller's create has passed every check: never held against their
   * column permissions, never theirs to name.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const resolved: ResolvedWebAcl = onCreate.carryForward as ResolvedWebAcl;
    const record: Model = onCreate.createBy.data;

    record.cloudConnectionId = resolved.cloudConnectionId;
    record.cloudProvider = resolved.cloudProvider;
    record.wafId = resolved.wafId;
    record.name = resolved.name;
    record.region = resolved.region;
    record.status = SecurityBlockCloudWafStatus.Checking;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const projectId: ObjectID | undefined =
      createdItem.projectId || onCreate.createBy.data.projectId;

    if (projectId) {
      await SecurityBlocklistJobs.queueReconcile(projectId);
    }

    return createdItem;
  }

  // Where it reads the client's address changed: OneUptime's rule is written again.
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (updatedItemIds.length > 0) {
      const rows: Array<Model> = await this.findBy({
        query: { _id: updatedItemIds[0]! },
        select: { _id: true, projectId: true },
        skip: 0,
        limit: 1,
        props: { isRoot: true },
      });

      if (rows[0]?.projectId) {
        await SecurityBlocklistJobs.queueReconcile(rows[0].projectId);
      }
    }

    return onUpdate;
  }

  /*
   * Removed with Remove alone, which takes OneUptime's rule out of the web
   * ACL first (SecurityBlockCloudWafs): deleted as it is, the web ACL would
   * keep blocking what its sets held, and lifting a block would no longer
   * reach it. A project's or a connection's deletion removes them with it,
   * in the database.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.props.isRoot) {
      throw new BadDataException(
        SECURITY_BLOCK_CLOUD_WAF_MESSAGES.removeWithRemove,
      );
    }

    return { deleteBy, carryForward: null };
  }

  // The project's cloud WAFs, as the reconciler and the routes read them.
  @CaptureSpan()
  public async findForProject(projectId: ObjectID): Promise<Array<Model>> {
    return await this.findBy({
      query: { projectId },
      select: {
        _id: true,
        projectId: true,
        cloudConnectionId: true,
        cloudResourceId: true,
        cloudProvider: true,
        wafId: true,
        name: true,
        region: true,
        clientAddress: true,
        status: true,
        statusMessage: true,
        statusReason: true,
        ruleDetails: true,
        checkedAt: true,
      },
      skip: 0,
      limit: 500,
      props: { isRoot: true },
    });
  }

  // Whether the connection enforces the blocklist anywhere: it may not stop while it does.
  @CaptureSpan()
  public async countForConnection(data: {
    projectId: ObjectID;
    cloudConnectionId: ObjectID;
  }): Promise<number> {
    return (
      await this.countBy({
        query: {
          projectId: data.projectId,
          cloudConnectionId: data.cloudConnectionId,
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }
}

export default new Service();
