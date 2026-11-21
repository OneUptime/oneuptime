import CloudConnectionService from "./CloudConnectionService";
import CloudResourceService from "./CloudResourceService";
import ProjectReferencesService from "./ProjectReferencesService";
import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import Model from "../../Models/DatabaseModels/SecurityBlockCloudWaf";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import SecurityBlocklistJobs from "../Utils/SecurityBlocklist/SecurityBlocklistJobs";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  AWS_WAF_WEB_ACL_RESOURCE_TYPE,
  buildAwsWafWebAclArn,
} from "../../Types/CloudConnection/AwsWafBlocklist";
import {
  WAF_BLOCKLIST_FIELD_KEY,
  isCloudConnectionWafBlocklistOn,
} from "../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockCloudWafStatus,
} from "../../Types/SecurityBlocklist/SecurityBlockCloudWaf";

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
  alreadyEnforcing: (data: { name: string }) => string;
  removeWithRemove: string;
} = {
  pickWebAcl: "Pick the web ACL to enforce your blocklist in.",
  notAWebAcl:
    "That resource is not an AWS WAF web ACL. Pick a web ACL from the list.",
  notListed: (data: { name: string }): string => {
    return `OneUptime has not listed web ACL ${data.name} yet. Run its connection's setup command again so its role may list web ACLs, and try again after the next read.`;
  },
  noConnection:
    "That web ACL's cloud connection is gone. Pick a web ACL of a connected account.",
  turnOnBlocking: (data: { connection: string }): string => {
    return `Turn on Block addresses in AWS WAF for the connection ${data.connection} first, and run its setup command again: it grants the IP sets this needs.`;
  },
  alreadyEnforcing: (data: { name: string }): string => {
    return `${data.name} already enforces your blocklist.`;
  },
  removeWithRemove:
    "Remove a web ACL with Remove: OneUptime takes its rule out of the web ACL first.",
};

// What a create resolved from the inventory, written once it is permitted.
interface ResolvedWebAcl {
  cloudConnectionId: ObjectID;
  wafId: string;
  name: string;
  region: string;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
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
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);
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

    return { createBy: onCreate.createBy, carryForward: resolved };
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
          cloudConnectionId: true,
          isArchived: true,
        },
        props: { isRoot: true },
      },
    );

    if (
      !resource?.id ||
      resource.isArchived ||
      resource.cloudProvider !== CloudProvider.AWS ||
      resource.cloudResourceType !== AWS_WAF_WEB_ACL_RESOURCE_TYPE
    ) {
      throw new BadDataException(SECURITY_BLOCK_CLOUD_WAF_MESSAGES.notAWebAcl);
    }

    const properties: JSONObject = resource.cloudProperties || {};
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

    const connection: CloudConnection | null = resource.cloudConnectionId
      ? await CloudConnectionService.findOneBy({
          query: { _id: resource.cloudConnectionId, projectId: data.projectId },
          select: { _id: true, name: true, provider: true, config: true },
          props: { isRoot: true },
        })
      : null;

    if (!connection?.id || connection.provider !== CloudProvider.AWS) {
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
        SECURITY_BLOCK_CLOUD_WAF_MESSAGES.turnOnBlocking({
          connection: connection.name || "",
        }),
      );
    }

    const existing: number = (
      await this.countBy({
        query: { projectId: data.projectId, wafId },
        props: { isRoot: true },
      })
    ).toNumber();

    if (existing > 0) {
      throw new BadDataException(
        SECURITY_BLOCK_CLOUD_WAF_MESSAGES.alreadyEnforcing({ name }),
      );
    }

    return {
      cloudConnectionId: connection.id,
      wafId,
      name: name.slice(0, 100),
      region: (resource.cloudRegion || "").trim().toLowerCase(),
    };
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
    record.cloudProvider = CloudProvider.AWS;
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
