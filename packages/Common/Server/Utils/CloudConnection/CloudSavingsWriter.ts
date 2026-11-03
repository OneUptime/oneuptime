import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import { CloudSavingKind } from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import ColumnLength from "../../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import CloudCostRecommendationService from "../../Services/CloudCostRecommendationService";
import CloudResourceService from "../../Services/CloudResourceService";
import logger from "../Logger";
import { CloudSavingRecord } from "./CloudConnectorTypes";

/*
 * KEEPS AN ACCOUNT'S WAYS TO SPEND LESS IN STEP WITH ITS CLOUD'S RECOMMENDER.
 *
 * A read of savings returns everything the cloud's recommender says of the
 * accounts it read. Each recommendation is one CloudCostRecommendation row,
 * found by the recommender's own id: a new one is created, one read again
 * is brought up to date, and one the recommender no longer makes - done,
 * dismissed in the cloud's console, or no longer true - is removed. Only
 * the accounts read are kept so: one that could not be read keeps what it
 * has. Each row is linked to the resource it is about when OneUptime holds
 * it, by the resource's id in its cloud.
 */

// At most this many recommendations are kept per account.
export const CLOUD_SAVINGS_MAX_PER_ACCOUNT: number = 500;

export interface CloudSavingsWriteResult {
  created: number;
  updated: number;
  removed: number;
  /*
   * What each account read now has (its id in its cloud, lower case): the
   * recommendations kept, for its summary.
   */
  savingsByAccount: Map<
    string,
    Array<{ monthlySavings: number; currency: string; kind: CloudSavingKind }>
  >;
}

function clamp(value: string, length: number): string {
  const trimmed: string = (value || "").trim();
  return trimmed.length > length ? trimmed.slice(0, length) : trimmed;
}

/*
 * How a recommendation's resource is matched to a Cloud Resource: its id in
 * its cloud, in lower case (an Azure ARM id is not case sensitive, and the
 * recommenders do not all write it the same way).
 */
export function getSavingResourceKey(resourceId: string): string {
  return (resourceId || "").trim().toLowerCase();
}

export default class CloudSavingsWriter {
  public static async write(data: {
    projectId: ObjectID;
    provider: CloudProvider;
    // An account's id in its cloud (lower case) -> its CloudAccount row id.
    accountRows: Map<string, ObjectID>;
    // The accounts read (lower case): only theirs are kept in step.
    accountsRead: Set<string>;
    recommendations: Array<CloudSavingRecord>;
    now: Date;
  }): Promise<CloudSavingsWriteResult> {
    const result: CloudSavingsWriteResult = {
      created: 0,
      updated: 0,
      removed: 0,
      savingsByAccount: new Map(),
    };

    const cloudAccountIds: Array<ObjectID> = Array.from(data.accountsRead)
      .map((accountId: string): ObjectID | undefined => {
        return data.accountRows.get(accountId);
      })
      .filter((id: ObjectID | undefined): boolean => {
        return Boolean(id);
      }) as Array<ObjectID>;

    if (cloudAccountIds.length === 0) {
      return result;
    }

    // The resources the recommendations may be about, by their key.
    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        cloudProvider: data.provider,
        isArchived: false,
      },
      select: { _id: true, providerResourceId: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
    const resourceIds: Map<string, ObjectID> = new Map();

    for (const resource of resources) {
      if (resource.id && resource.providerResourceId) {
        resourceIds.set(
          getSavingResourceKey(resource.providerResourceId),
          resource.id,
        );
      }
    }

    const existing: Array<CloudCostRecommendation> =
      await CloudCostRecommendationService.findBy({
        query: {
          projectId: data.projectId,
          cloudAccountId: new Includes(cloudAccountIds),
        },
        select: { _id: true, recommendationId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    const existingByRecommendation: Map<string, ObjectID> = new Map();

    for (const row of existing) {
      if (row.id && row.recommendationId) {
        existingByRecommendation.set(row.recommendationId, row.id);
      }
    }

    // Per account, the largest savings first, at most the cap.
    const kept: Array<CloudSavingRecord> = [];
    const perAccount: Map<string, number> = new Map();

    for (const record of [...data.recommendations].sort(
      (a: CloudSavingRecord, b: CloudSavingRecord): number => {
        return b.monthlySavings - a.monthlySavings;
      },
    )) {
      const accountKey: string = record.accountId.trim().toLowerCase();

      if (
        !data.accountsRead.has(accountKey) ||
        !data.accountRows.get(accountKey) ||
        !record.recommendationId
      ) {
        continue;
      }

      const count: number = perAccount.get(accountKey) || 0;

      if (count >= CLOUD_SAVINGS_MAX_PER_ACCOUNT) {
        continue;
      }

      perAccount.set(accountKey, count + 1);
      kept.push(record);
    }

    for (const record of kept) {
      const recommendationId: string = clamp(
        record.recommendationId,
        ColumnLength.LongText,
      );
      const cloudResourceId: ObjectID | undefined = record.resourceId
        ? resourceIds.get(getSavingResourceKey(record.resourceId))
        : undefined;
      const fields: Partial<CloudCostRecommendation> = {
        cloudAccountId: data.accountRows.get(
          record.accountId.trim().toLowerCase(),
        )!,
        region: clamp(record.region, ColumnLength.ShortText),
        resourceId: clamp(record.resourceId, ColumnLength.LongText),
        resourceType: clamp(record.resourceType, ColumnLength.ShortText),
        resourceName: clamp(record.resourceName, ColumnLength.ShortText),
        kind: record.kind,
        action: clamp(record.action, ColumnLength.LongText) || "Review",
        currentConfiguration: clamp(
          record.currentConfiguration,
          ColumnLength.LongText,
        ),
        recommendedConfiguration: clamp(
          record.recommendedConfiguration,
          ColumnLength.LongText,
        ),
        monthlySavings: Math.max(
          0,
          Math.round(record.monthlySavings * 100) / 100,
        ),
        currency: clamp(record.currency || "USD", ColumnLength.ShortText),
        effort: clamp(record.effort, ColumnLength.ShortText),
        source: clamp(record.source, ColumnLength.ShortText),
        lastSeenAt: data.now,
      };

      if (record.monthlyCost !== null && Number.isFinite(record.monthlyCost)) {
        fields.monthlyCost = Math.round(record.monthlyCost * 100) / 100;
      }

      if (cloudResourceId) {
        fields.cloudResourceId = cloudResourceId;
      }

      try {
        const existingId: ObjectID | undefined =
          existingByRecommendation.get(recommendationId);

        if (existingId) {
          await CloudCostRecommendationService.updateOneById({
            id: existingId,
            data: fields as never,
            props: { isRoot: true, ignoreHooks: true },
          });
          result.updated++;
        } else {
          const row: CloudCostRecommendation = new CloudCostRecommendation();
          row.projectId = data.projectId;
          row.provider = data.provider;
          row.recommendationId = recommendationId;
          Object.assign(row, fields);

          await CloudCostRecommendationService.create({
            data: row,
            props: { isRoot: true, ignoreHooks: true },
          });
          result.created++;
        }

        const accountKey: string = record.accountId.trim().toLowerCase();
        const kept: Array<{
          monthlySavings: number;
          currency: string;
          kind: CloudSavingKind;
        }> = result.savingsByAccount.get(accountKey) || [];
        kept.push({
          monthlySavings: fields.monthlySavings || 0,
          currency: fields.currency || "USD",
          kind: record.kind,
        });
        result.savingsByAccount.set(accountKey, kept);
      } catch (error) {
        logger.error(
          `Cloud savings: a recommendation could not be kept: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    /*
     * What the recommender no longer says - every row of an account read
     * that this read did not see - removed for good: a recommendation has
     * no history worth keeping.
     */
    result.removed = await CloudCostRecommendationService.hardDeleteBy({
      query: {
        projectId: data.projectId,
        cloudAccountId: new Includes(cloudAccountIds),
        lastSeenAt: new LessThan<Date>(data.now),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    return result;
  }
}
