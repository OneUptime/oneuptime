import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/CloudAccount";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  CloudAccountResourceCount,
  CloudAccountResourceSummary,
  summarizeCloudAccountResourceCounts,
} from "../../Types/Cloud/CloudAccountSummary";
import ColumnLength from "../../Types/Database/ColumnLength";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CloudResourceService from "./CloudResourceService";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import ResourceAiAccessSettings, {
  RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS,
  RESOURCE_AI_ACCESS_SETTING_KEYS,
} from "../Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiDeleteCleanup, {
  ResourceAiDeleteCarryForward,
} from "../Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import AiResourceType, {
  CLOUD_AI_RESOURCE_TYPES,
} from "../../Types/ResourceAiAgent/AiResourceType";
import { getCloudCatalogProvider } from "../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import BadDataException from "../../Types/Exception/BadDataException";
import FeedMarkdown, { MarkdownText } from "../../Utils/Markdown/FeedMarkdown";

// The cloud account's AI resource type, by its cloud.
export function getCloudAccountAiResourceType(
  provider: unknown,
): AiResourceType | null {
  return (
    CLOUD_AI_RESOURCE_TYPES.find((type: AiResourceType): boolean => {
      return getCloudCatalogProvider(type) === provider;
    }) || null
  );
}

// What a cloud account delete carries to its success hook: one per cloud.
interface CloudAccountDeleteCarryForward {
  cloudAiCleanups: Array<ResourceAiDeleteCarryForward>;
}

/*
 * CLOUD ACCOUNTS: kept by the reads, named by people.
 *
 * Every account a cloud connection reaches gets one row
 * (recordAccountsSeen), named the first time after what its cloud calls it
 * - the AWS account alias, the subscription's or the project's name - or
 * its id. A name a person gives it later is theirs: reads only keep the
 * cloud's own name (providerAccountName) up to date.
 *
 * Its counts (refreshSummary) are the live Cloud Resources of the same
 * cloud and account id, whoever found them: the connection's inventory,
 * its metrics, or an OpenTelemetry collector's.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * What OneUptime AI may do in an account (its Cloud AI agent's settings)
   * is held to the rules every resource an AI agent serves shares
   * (ResourceAiAccessSettings): an unusable mode or allowlist is refused
   * for everyone, the server-only aiAccess* columns for everyone but root,
   * and making AI do more for anyone who may not author a FullAuto rule.
   * The cloud decides which AI resource type an account is.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const resourceType: AiResourceType | null = getCloudAccountAiResourceType(
      (createBy.data as Model | undefined)?.provider,
    );

    if (resourceType) {
      ResourceAiAccessSettings.checkCreate({ resourceType, createBy });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const resourceType: AiResourceType | null =
      await this.getAiResourceTypeOfUpdate(updateBy);

    return {
      updateBy,
      carryForward: resourceType
        ? await ResourceAiAccessSettings.checkUpdate({
            resourceType,
            service: this,
            updateBy,
          })
        : null,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    // A cloud account has no feed: the write marks it AI-configured.
    await ResourceAiAccessSettings.afterUpdate({
      service: this,
      onUpdate,
      updatedItemIds,
      getResourceMarkdownLink: async (): Promise<MarkdownText> => {
        return FeedMarkdown.join([]);
      },
      createFeedItem: async (): Promise<void> => {
        return;
      },
    });

    return onUpdate;
  }

  /*
   * Deleting an account settles its in-flight AI remediation rounds and
   * removes its Cloud AI agent, as for every resource an AI agent serves
   * (ResourceAiDeleteCleanup) — once per cloud, as each cloud is its own
   * AI resource type.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const cloudAiCleanups: Array<ResourceAiDeleteCarryForward> = [];

    for (const resourceType of CLOUD_AI_RESOURCE_TYPES) {
      cloudAiCleanups.push(
        await ResourceAiDeleteCleanup.beforeDelete({
          resourceType,
          service: this,
          deleteBy,
        }),
      );
    }

    const carryForward: CloudAccountDeleteCarryForward = { cloudAiCleanups };

    return { deleteBy, carryForward };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carryForward: CloudAccountDeleteCarryForward | null =
      onDelete.carryForward && "cloudAiCleanups" in onDelete.carryForward
        ? (onDelete.carryForward as CloudAccountDeleteCarryForward)
        : null;

    for (const cleanup of carryForward?.cloudAiCleanups || []) {
      await ResourceAiDeleteCleanup.afterDelete({
        resourceType: cleanup.resourceType,
        onDelete: { ...onDelete, carryForward: cleanup },
        deletedItemIds,
      });
    }

    return onDelete;
  }

  /*
   * The AI resource type an update's rows are, when it writes an AI access
   * setting or a server-only column (null otherwise: nothing to check). An
   * update reaching accounts of two clouds with such a write is refused:
   * each cloud's settings are judged by its own catalog.
   */
  private async getAiResourceTypeOfUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<AiResourceType | null> {
    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;
    const writesAiAccess: boolean = [
      ...RESOURCE_AI_ACCESS_SETTING_KEYS,
      ...RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS,
      "isAiLogReadEnabled",
    ].some((key: string): boolean => {
      return Object.prototype.hasOwnProperty.call(data, key);
    });

    if (!writesAiAccess) {
      return null;
    }

    const rows: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: { _id: true, provider: true },
      limit: updateBy.limit || 100,
      skip: 0,
      props: { isRoot: true },
    });

    const types: Set<AiResourceType> = new Set<AiResourceType>();

    for (const row of rows) {
      const type: AiResourceType | null = getCloudAccountAiResourceType(
        row.provider,
      );

      if (type) {
        types.add(type);
      }
    }

    if (types.size > 1) {
      throw new BadDataException(
        "Change what OneUptime AI may do on the accounts of one cloud at a time.",
      );
    }

    return Array.from(types)[0] || null;
  }

  public async findAccount(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    accountId: string;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        provider: data.provider,
        accountId: QueryHelper.findWithSameText(data.accountId.trim()),
      },
      select: {
        _id: true,
        projectId: true,
        provider: true,
        accountId: true,
        name: true,
        providerAccountName: true,
        cloudConnectionId: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * The accounts one read of a connection reached: each found or created,
   * linked to the connection when no other connection reads it, and marked
   * seen. Returns the rows, in the order given. One account's failure is
   * logged and never stops the others.
   */
  @CaptureSpan()
  public async recordAccountsSeen(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    provider: CloudProvider;
    accounts: Array<{
      accountId: string;
      name?: string | undefined;
      // When the inventory listed this account to its last page, if it did now.
      listedInFullAt?: Date | undefined;
    }>;
  }): Promise<Array<Model>> {
    const rows: Array<Model> = [];
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const account of data.accounts) {
      const accountId: string = account.accountId.trim();

      if (!accountId) {
        continue;
      }

      try {
        const providerName: string = (account.name || "").trim();
        let row: Model | null = await this.findAccount({
          projectId: data.projectId,
          provider: data.provider,
          accountId,
        });

        if (!row) {
          const created: Model = new Model();
          created.projectId = data.projectId;
          created.provider = data.provider;
          created.accountId = accountId;
          created.name = (providerName || accountId).slice(
            0,
            ColumnLength.ShortText,
          );
          created.cloudConnectionId = data.connectionId;

          if (providerName) {
            created.providerAccountName = providerName.slice(
              0,
              ColumnLength.ShortText,
            );
          }
          created.lastSeenAt = now;

          if (account.listedInFullAt) {
            created.inventoryListedAt = account.listedInFullAt;
          }

          try {
            row = await this.create({
              data: created,
              props: { isRoot: true },
            });
          } catch (error) {
            // Two reads at once: the unique index lets one insert win.
            row = await this.findAccount({
              projectId: data.projectId,
              provider: data.provider,
              accountId,
            });

            if (!row) {
              throw error;
            }
          }
        }

        const update: JSONObject = { lastSeenAt: now };

        if (providerName && providerName !== row.providerAccountName) {
          update["providerAccountName"] = providerName.slice(
            0,
            ColumnLength.ShortText,
          );
        }

        // A connection takes an account only no other connection reads.
        if (!row.cloudConnectionId) {
          update["cloudConnectionId"] = data.connectionId.toString();
        }

        if (account.listedInFullAt) {
          update["inventoryListedAt"] = account.listedInFullAt;
        }

        await this.updateOneById({
          id: row.id!,
          data: update as never,
          props: { isRoot: true, ignoreHooks: true },
        });

        rows.push(row);
      } catch (error) {
        logger.error(
          `Cloud connection ${data.connectionId.toString()}: account ${accountId} could not be recorded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return rows;
  }

  /*
   * The account's live resources counted by type and region, written on
   * the account row. Counted by the database - one row per type and Region,
   * however many resources there are - over the resources of the same
   * cloud and account id, pinned to the account's project.
   */
  @CaptureSpan()
  public async refreshSummary(account: {
    id: ObjectID;
    projectId: ObjectID;
    provider: CloudProvider;
    accountId: string;
  }): Promise<CloudAccountResourceSummary> {
    const rows: unknown =
      await CloudResourceService.getRepository().manager.query(
        `SELECT COALESCE("cloudResourceType", '') AS "type",
            COALESCE("cloudRegion", '') AS "region",
            COUNT(*)::int AS "count"
          FROM "CloudResource"
          WHERE "projectId" = $1
            AND "cloudProvider" = $2
            AND LOWER("cloudAccountId") = LOWER($3)
            AND "isArchived" = false
            AND "deletedAt" IS NULL
          GROUP BY 1, 2`,
        [account.projectId.toString(), account.provider, account.accountId],
      );

    const summary: CloudAccountResourceSummary =
      summarizeCloudAccountResourceCounts(
        (Array.isArray(rows) ? rows : []).map(
          (row: unknown): CloudAccountResourceCount => {
            const record: Record<string, unknown> =
              row && typeof row === "object"
                ? (row as Record<string, unknown>)
                : {};

            return {
              type: String(record["type"] || ""),
              region: String(record["region"] || ""),
              count: Number(record["count"]) || 0,
            };
          },
        ),
      );

    await this.updateOneById({
      id: account.id,
      data: {
        resourceCount: summary.resourceCount,
        regionCount: summary.regions.length,
        resourceSummary: summary as unknown as JSONObject,
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    return summary;
  }
}

export default new Service();
