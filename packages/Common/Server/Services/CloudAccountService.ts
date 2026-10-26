import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  CloudAccountResourceSummary,
  summarizeCloudAccountResources,
} from "../../Types/Cloud/CloudAccountSummary";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CloudResourceService from "./CloudResourceService";

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
    accounts: Array<{ accountId: string; name?: string | undefined }>;
    inventoryListedAt?: Date | undefined;
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
            ColumnLength.Name,
          );
          created.cloudConnectionId = data.connectionId;

          if (providerName) {
            created.providerAccountName = providerName.slice(
              0,
              ColumnLength.ShortText,
            );
          }
          created.lastSeenAt = now;

          if (data.inventoryListedAt) {
            created.inventoryListedAt = data.inventoryListedAt;
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

        if (data.inventoryListedAt) {
          update["inventoryListedAt"] = data.inventoryListedAt;
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
   * the account row. The resources are read by cloud and account id.
   */
  @CaptureSpan()
  public async refreshSummary(account: {
    id: ObjectID;
    projectId: ObjectID;
    provider: CloudProvider;
    accountId: string;
  }): Promise<CloudAccountResourceSummary> {
    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: account.projectId,
        cloudProvider: account.provider,
        cloudAccountId: QueryHelper.findWithSameText(account.accountId),
        isArchived: false,
      },
      select: {
        _id: true,
        cloudResourceType: true,
        cloudRegion: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    const summary: CloudAccountResourceSummary =
      summarizeCloudAccountResources(
        resources.map((resource: CloudResource) => {
          return {
            type: resource.cloudResourceType || "",
            region: resource.cloudRegion || "",
          };
        }),
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
