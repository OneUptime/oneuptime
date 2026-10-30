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
  ResourceAiAccessFeedItem,
  ResourceAiAccessWriteCarryForward,
} from "../Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import UserService from "./UserService";
import { Blue500, Gray500, Yellow500 } from "../../Types/BrandColors";
import ResourceAiDeleteCleanup, {
  ResourceAiDeleteCarryForward,
} from "../Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  CLOUD_AI_RESOURCE_TYPES,
} from "../../Types/ResourceAiAgent/AiResourceType";
import { getCloudCatalogProvider } from "../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import BadDataException from "../../Types/Exception/BadDataException";
import { mdText, MarkdownText } from "../../Utils/Markdown/FeedMarkdown";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import CloudAccountFeedService from "./CloudAccountFeedService";
import { CloudAccountFeedEventType } from "../../Models/DatabaseModels/CloudAccountFeed";
import CloudConnectionService from "./CloudConnectionService";
import CloudConnection from "../../Models/DatabaseModels/CloudConnection";

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

// The switch that lets an investigation read an account's log lines.
export const CLOUD_ACCOUNT_LOG_READ_COLUMN: string = "isAiLogReadEnabled";

/*
 * What an update of an account's AI access carries to its success hook:
 * the shared rules' carry-forward (ResourceAiAccessSettings.checkUpdate),
 * and, when a person wrote the log switch, whether each account's logs
 * were read before - so the feed says what turned, and only when it did.
 */
interface CloudAccountUpdateCarryForward {
  isCloudAccountUpdate: true;
  aiAccess: ResourceAiAccessWriteCarryForward | null;
  logReadsBefore: Record<string, { projectId: ObjectID; isOn: boolean }> | null;
}

function readUpdateCarryForward(
  carryForward: unknown,
): CloudAccountUpdateCarryForward | null {
  return carryForward &&
    typeof carryForward === "object" &&
    "isCloudAccountUpdate" in carryForward
    ? (carryForward as CloudAccountUpdateCarryForward)
    : null;
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

  // An account's feed starts with how it came to OneUptime.
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    await this.writeCreatedFeed({
      createdItem,
      userId:
        createdItem.createdByUserId || onCreate.createBy.props.userId || null,
    });

    return createdItem;
  }

  /*
   * "OneUptime found [AWS account prod] when the cloud connection prod-read
   * first read it." - or who added it, when a person did. Never throws: the
   * account is created.
   */
  private async writeCreatedFeed(data: {
    createdItem: Model;
    userId: ObjectID | null;
  }): Promise<void> {
    const projectId: ObjectID | undefined = data.createdItem.projectId;
    const cloudAccountId: ObjectID | null = data.createdItem.id;

    if (!projectId || !cloudAccountId) {
      return;
    }

    try {
      const link: MarkdownText = await this.getCloudAccountMarkdownLink(
        projectId,
        cloudAccountId,
      );
      let feedInfoInMarkdown: MarkdownText;

      if (data.userId) {
        const userLink: MarkdownText = await UserService.getUserMarkdownString({
          userId: data.userId,
          projectId,
        });

        feedInfoInMarkdown = mdText`☁️ **${
          userLink.isEmpty() ? mdText`A user` : userLink
        }** added ${link}.`;
      } else if (data.createdItem.cloudConnectionId) {
        const connection: CloudConnection | null =
          await CloudConnectionService.findOneById({
            id: data.createdItem.cloudConnectionId,
            select: { name: true },
            props: { isRoot: true },
          });
        const connectionName: string = connection?.name?.trim() || "";

        feedInfoInMarkdown = connectionName
          ? mdText`☁️ OneUptime found ${link} when the cloud connection **${connectionName}** first read it.`
          : mdText`☁️ OneUptime found ${link} when a cloud connection first read it.`;
      } else {
        feedInfoInMarkdown = mdText`☁️ ${link} was added.`;
      }

      await CloudAccountFeedService.createCloudAccountFeedItem({
        cloudAccountId,
        projectId,
        cloudAccountFeedEventType:
          CloudAccountFeedEventType.CloudAccountCreated,
        displayColor: Blue500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
        ...(data.userId ? { userId: data.userId } : {}),
      });
    } catch (error) {
      logger.error(
        `CloudAccountService: could not record how cloud account ${cloudAccountId.toString()} was added: ${error}`,
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const rows: Array<Model> | null = await this.getRowsOfAiUpdate(updateBy);

    if (!rows) {
      return { updateBy, carryForward: null };
    }

    const resourceType: AiResourceType | null =
      this.getAiResourceTypeOfRows(rows);

    const aiAccess: ResourceAiAccessWriteCarryForward | null = resourceType
      ? await ResourceAiAccessSettings.checkUpdate({
          resourceType,
          service: this,
          updateBy,
        })
      : null;

    /*
     * A person turning log reads on or off (the server never writes the
     * switch): each account's value before the write.
     */
    const writesLogReads: boolean =
      !updateBy.props.isRoot &&
      typeof (updateBy.data as unknown as JSONObject)[
        CLOUD_ACCOUNT_LOG_READ_COLUMN
      ] === "boolean";
    let logReadsBefore: Record<
      string,
      { projectId: ObjectID; isOn: boolean }
    > | null = null;

    if (writesLogReads) {
      logReadsBefore = {};

      for (const row of rows) {
        if (row.id && row.projectId) {
          logReadsBefore[row.id.toString()] = {
            projectId: row.projectId,
            isOn: row.isAiLogReadEnabled === true,
          };
        }
      }
    }

    if (!aiAccess && !logReadsBefore) {
      return { updateBy, carryForward: null };
    }

    const carryForward: CloudAccountUpdateCarryForward = {
      isCloudAccountUpdate: true,
      aiAccess,
      logReadsBefore,
    };

    return { updateBy, carryForward };
  }

  /*
   * A person's AI access write: recorded on the account's feed, who made it
   * and what changed (yellow when it lets AI do more), and the account
   * marked AI-configured - as on every resource an AI agent serves.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: CloudAccountUpdateCarryForward | null =
      readUpdateCarryForward(onUpdate.carryForward);

    await ResourceAiAccessSettings.afterUpdate({
      service: this,
      onUpdate: { ...onUpdate, carryForward: carryForward?.aiAccess || null },
      updatedItemIds,
      getResourceMarkdownLink: (
        projectId: ObjectID,
        cloudAccountId: ObjectID,
      ): Promise<MarkdownText> => {
        return this.getCloudAccountMarkdownLink(projectId, cloudAccountId);
      },
      createFeedItem: async (item: ResourceAiAccessFeedItem): Promise<void> => {
        await CloudAccountFeedService.createCloudAccountFeedItem({
          cloudAccountId: item.resourceId,
          projectId: item.projectId,
          cloudAccountFeedEventType:
            CloudAccountFeedEventType.CloudAccountUpdated,
          displayColor: item.displayColor,
          feedInfoInMarkdown: item.feedInfoInMarkdown,
          moreInformationInMarkdown: item.moreInformationInMarkdown,
          userId: item.userId,
        });
      },
    });

    if (carryForward?.logReadsBefore) {
      await this.writeLogReadsFeed({
        logReadsBefore: carryForward.logReadsBefore,
        isOn:
          (onUpdate.updateBy.data as unknown as JSONObject)[
            CLOUD_ACCOUNT_LOG_READ_COLUMN
          ] === true,
        updatedByUserId: onUpdate.updateBy.props.userId || undefined,
        updatedItemIds,
      });
    }

    return onUpdate;
  }

  /*
   * Who let OneUptime AI read an account's log lines, or stopped it - log
   * lines can hold customer data, so the switch never turns unrecorded.
   * One entry per account whose switch really turned, yellow when it lets
   * AI read more. Never throws: the write it describes has committed.
   */
  private async writeLogReadsFeed(data: {
    logReadsBefore: Record<string, { projectId: ObjectID; isOn: boolean }>;
    isOn: boolean;
    updatedByUserId: ObjectID | undefined;
    updatedItemIds: Array<ObjectID>;
  }): Promise<void> {
    for (const cloudAccountId of data.updatedItemIds) {
      const before: { projectId: ObjectID; isOn: boolean } | undefined =
        data.logReadsBefore[cloudAccountId.toString()];

      if (!before || before.isOn === data.isOn) {
        continue;
      }

      try {
        const userLink: MarkdownText | null = data.updatedByUserId
          ? await UserService.getUserMarkdownString({
              userId: data.updatedByUserId,
              projectId: before.projectId,
            })
          : null;
        const actor: MarkdownText = userLink
          ? mdText`**${userLink.isEmpty() ? mdText`A user` : userLink}**`
          : mdText`An API key`;

        await CloudAccountFeedService.createCloudAccountFeedItem({
          cloudAccountId,
          projectId: before.projectId,
          cloudAccountFeedEventType:
            CloudAccountFeedEventType.CloudAccountUpdated,
          displayColor: data.isOn ? Yellow500 : Gray500,
          feedInfoInMarkdown:
            mdText`🤖 ${actor} changed what OneUptime AI may do on ${await this.getCloudAccountMarkdownLink(
              before.projectId,
              cloudAccountId,
            )}:\n\n- Reading the account's log lines during investigations turned **${
              data.isOn ? "on" : "off"
            }**`.toString(),
          moreInformationInMarkdown: (data.isOn
            ? mdText`Investigations may now read this account's recent log lines (CloudWatch Logs, Log Analytics or Cloud Logging) through its read-only connection. Log lines can hold customer data.`
            : mdText`Investigations no longer read this account's log lines.`
          ).toString(),
          ...(data.updatedByUserId ? { userId: data.updatedByUserId } : {}),
        });
      } catch (error) {
        logger.error(
          `CloudAccountService: could not record the log read switch of cloud account ${cloudAccountId.toString()}: ${error}`,
        );
      }
    }
  }

  // The account's Overview in the Dashboard.
  public async getCloudAccountLinkInDashboard(
    projectId: ObjectID,
    cloudAccountId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/cloud/accounts/${cloudAccountId.toString()}`,
    );
  }

  /*
   * "[AWS account prod](https://...)" - how a feed entry names the account
   * it is about: its cloud's noun and its name (its id when it has none).
   */
  @CaptureSpan()
  public async getCloudAccountMarkdownLink(
    projectId: ObjectID,
    cloudAccountId: ObjectID,
  ): Promise<MarkdownText> {
    const account: Model | null = await this.findOneById({
      id: cloudAccountId,
      select: { name: true, accountId: true, provider: true },
      props: { isRoot: true },
    });
    const type: AiResourceType | null = getCloudAccountAiResourceType(
      account?.provider,
    );
    const noun: string = type
      ? AI_RESOURCE_TYPE_INFO[type].displayName
      : "Cloud account";
    const name: string =
      account?.name?.trim() || account?.accountId?.trim() || "";
    const link: URL = await this.getCloudAccountLinkInDashboard(
      projectId,
      cloudAccountId,
    );

    return name
      ? mdText`[${noun} ${name}](${link.toString()})`
      : mdText`[${noun}](${link.toString()})`;
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
   * The rows an update writes, when it writes an AI access setting, the log
   * switch or a server-only column (null otherwise: nothing to check),
   * read the one way every hook reads them and the update held to exactly
   * these: the clouds judged are the clouds written, and the log switch's
   * value before is that of the rows it turns.
   */
  private async getRowsOfAiUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<Model> | null> {
    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;
    const writesAiAccess: boolean = [
      ...RESOURCE_AI_ACCESS_SETTING_KEYS,
      ...RESOURCE_AI_ACCESS_SERVER_ONLY_KEYS,
      CLOUD_ACCOUNT_LOG_READ_COLUMN,
    ].some((key: string): boolean => {
      return Object.prototype.hasOwnProperty.call(data, key);
    });

    if (!writesAiAccess) {
      return null;
    }

    return await this.findRowsAndHoldUpdateToThem(updateBy, {
      _id: true,
      projectId: true,
      provider: true,
      isAiLogReadEnabled: true,
    });
  }

  /*
   * The AI resource type of an update's rows (null when none is a cloud
   * this build knows). An update reaching accounts of two clouds with an
   * AI write is refused: each cloud's settings are judged by its own
   * catalog.
   */
  private getAiResourceTypeOfRows(rows: Array<Model>): AiResourceType | null {
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
