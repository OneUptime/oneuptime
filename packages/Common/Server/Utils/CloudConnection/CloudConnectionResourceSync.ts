import { createHash } from "crypto";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { readCloudTags } from "../../../Types/Cloud/CloudInventory";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "../../../Types/Cloud/CloudMonitoredResource";
import {
  CloudConnectionRegionCount,
  CloudConnectionTypeCount,
  countCloudConnectionValues,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import CloudResourceService, {
  CloudMonitoredResourceFindOrCreateResult,
  CloudResourceInventoryColumns,
} from "../../Services/CloudResourceService";
import CloudResourceLabelRuleEngineService from "../../Services/CloudResourceLabelRuleEngineService";
import CloudResourceOwnerRuleEngineService from "../../Services/CloudResourceOwnerRuleEngineService";
import logger from "../Logger";
import {
  CloudCompleteListing,
  CloudDiscoveredResource,
  CloudInventoryItem,
  CloudKnownResource,
} from "./CloudConnectorTypes";

/*
 * THE RESOURCES A CONNECTION HOLDS, KEPT IN STEP WITH WHAT ITS READS FIND.
 *
 * Every resource a read sees becomes a Cloud Resource - the same row the
 * metrics ingest files that resource's metrics under, found or created by
 * CloudResourceService.findOrCreateMonitoredResource with the identity the
 * ingest's resolver gives it - and is linked to the connection
 * (CloudResource.cloudConnectionId):
 *
 *   - a new one is created before its metrics are written, under the name
 *     the cloud gives it (an EC2 instance's Name tag) rather than its id;
 *     a row that exists keeps its name, which a person may have changed;
 *   - a row is linked only while it is linked to no other connection: two
 *     connections reading one account do not take its rows from each other;
 *   - a resource an account listed in full no longer has (an Azure
 *     subscription read to its last page) is gone from the cloud and is
 *     archived the way the silence sweep archives one - it comes back by
 *     itself if it reports again;
 *   - a resource an account listed is seen: listed is alive, so a resource
 *     with no metrics OneUptime reads does not go "not reporting".
 *
 * Resources found only from their metrics (AWS, Google Cloud) are never
 * archived here: a quiet resource is not a deleted one, and the silence
 * sweep archives those after a week.
 */

// New rows created in one read at most; the rest are created by the next.
export const MAX_NEW_RESOURCES_PER_READ: number = 500;

export interface CloudConnectionSyncResult {
  // Live resources the connection holds after the read.
  resourceCount: number;
  resourceTypes: Array<CloudConnectionTypeCount>;
  regions: Array<CloudConnectionRegionCount>;
  newResources: number;
  archivedResources: number;
  // More were found than one read creates: the next read creates the rest.
  hasMore: boolean;
}

interface LinkedRow {
  id: ObjectID;
  resourceIdentifier: string;
  providerResourceId: string;
  cloudResourceType: string;
  name: string;
  cloudRegion: string;
  cloudAccountId: string;
  cloudResourceGroup: string;
  isArchived: boolean;
  // The tags the row holds, for telling whether a listing changed them.
  cloudTags: Record<string, string>;
  // What the last listing said of it, hashed (getInventoryFingerprint).
  cloudInventoryFingerprint: string;
}

// Sorted keys, all the way down: two objects that say the same hash the same.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  return value;
}

/*
 * What a listing says of a resource, as one hash: its identity's columns
 * and the four the inventory keeps. Lists are hashed in a fixed order - a
 * cloud may list the same tags or endpoints in another order next time -
 * so only a real change changes it.
 */
export function getInventoryFingerprint(item: CloudInventoryItem): string {
  const sortedTexts: (values: Array<string>) => Array<string> = (
    values: Array<string>,
  ): Array<string> => {
    return [...values].sort();
  };

  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          provider: item.resource.provider,
          resourceType: item.resource.resourceType,
          providerResourceId: item.resource.providerResourceId,
          accountId: item.resource.accountId,
          region: item.resource.region,
          resourceGroup: item.resource.resourceGroup,
          tags: item.tags,
          properties: item.properties,
          relationships: sortedTexts(
            item.relationships.map(
              (relationship: CloudInventoryItem["relationships"][number]) => {
                return `${relationship.kind}|${relationship.target}|${relationship.targetType || ""}`;
              },
            ),
          ),
          endpoints: sortedTexts(item.endpoints),
        }),
      ),
      "utf8",
    )
    .digest("hex")
    .slice(0, 64);
}

/*
 * Whether a held row is gone, by what the listing read in full: a row of
 * one of an account's types listed to the last page - in the Region it is
 * in, when the listing names Regions - that the listing does not have.
 */
export function isGoneFromListing(data: {
  row: {
    cloudAccountId: string;
    cloudResourceType: string;
    cloudRegion: string;
  };
  completelyListed: Array<CloudCompleteListing>;
}): boolean {
  const account: string = data.row.cloudAccountId.toLowerCase();
  const type: string = data.row.cloudResourceType.toLowerCase();
  const region: string = data.row.cloudRegion.toLowerCase();

  return data.completelyListed.some((entry: CloudCompleteListing): boolean => {
    return (
      entry.accountId.toLowerCase() === account &&
      entry.resourceTypes.some((listed: string): boolean => {
        return listed.toLowerCase() === type;
      }) &&
      (!entry.regions ||
        entry.regions.some((listed: string): boolean => {
          return listed.toLowerCase() === region;
        }))
    );
  });
}

function countReturnedRows(rows: unknown): number {
  if (!Array.isArray(rows)) {
    return 0;
  }

  // UPDATE ... RETURNING answers [rows, count] through TypeORM's query().
  if (
    rows.length === 2 &&
    Array.isArray(rows[0]) &&
    typeof rows[1] === "number"
  ) {
    return rows[1];
  }

  return rows.length;
}

export default class CloudConnectionResourceSync {
  // Every live resource row linked to the connection.
  public static async loadLinked(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
  }): Promise<Array<LinkedRow>> {
    const rows: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        cloudConnectionId: data.connectionId,
        cloudResourceKind: CloudResourceKind.Resource,
      },
      select: {
        _id: true,
        resourceIdentifier: true,
        providerResourceId: true,
        cloudResourceType: true,
        name: true,
        cloudRegion: true,
        cloudAccountId: true,
        cloudResourceGroup: true,
        isArchived: true,
        cloudTags: true,
        cloudInventoryFingerprint: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    return rows
      .filter((row: CloudResource): boolean => {
        return Boolean(row.id);
      })
      .map((row: CloudResource): LinkedRow => {
        return {
          id: row.id!,
          resourceIdentifier: row.resourceIdentifier || "",
          providerResourceId: row.providerResourceId || "",
          cloudResourceType: row.cloudResourceType || "",
          name: row.name || "",
          cloudRegion: row.cloudRegion || "",
          cloudAccountId: row.cloudAccountId || "",
          cloudResourceGroup: row.cloudResourceGroup || "",
          isArchived: Boolean(row.isArchived),
          cloudTags: readCloudTags(row.cloudTags),
          cloudInventoryFingerprint: row.cloudInventoryFingerprint || "",
        };
      });
  }

  // The live rows as the connector reads them between two listings.
  public static toKnownResources(
    rows: Array<LinkedRow>,
  ): Array<CloudKnownResource> {
    return rows
      .filter((row: LinkedRow): boolean => {
        return !row.isArchived && Boolean(row.providerResourceId);
      })
      .map((row: LinkedRow): CloudKnownResource => {
        return {
          providerResourceId: row.providerResourceId,
          resourceType: row.cloudResourceType,
          name: row.name,
          region: row.cloudRegion,
          accountId: row.cloudAccountId,
          resourceGroup: row.cloudResourceGroup,
        };
      });
  }

  public static async sync(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    linked: Array<LinkedRow>;
    discovered: Array<CloudDiscoveredResource>;
    completelyListedAccounts: Array<string>;
  }): Promise<CloudConnectionSyncResult> {
    const linkedByIdentifier: Map<string, LinkedRow> = new Map();

    for (const row of data.linked) {
      linkedByIdentifier.set(row.resourceIdentifier.toLowerCase(), row);
    }

    const discoveredIdentifiers: Set<string> = new Set<string>();
    const toCreate: Array<CloudDiscoveredResource> = [];

    for (const entry of data.discovered) {
      const identifier: string = buildCloudMonitoredResourceIdentifier(
        entry.resource,
      ).toLowerCase();

      if (discoveredIdentifiers.has(identifier)) {
        continue;
      }

      discoveredIdentifiers.add(identifier);

      if (!linkedByIdentifier.has(identifier)) {
        toCreate.push(entry);
      }
    }

    // 1. New resources: found or created, then linked.
    const newIds: Array<ObjectID> = [];
    let newResources: number = 0;

    for (const entry of toCreate.slice(0, MAX_NEW_RESOURCES_PER_READ)) {
      const resource: CloudMonitoredResource = entry.displayName
        ? { ...entry.resource, name: entry.displayName }
        : entry.resource;

      try {
        const result: CloudMonitoredResourceFindOrCreateResult =
          await CloudResourceService.findOrCreateMonitoredResource({
            projectId: data.projectId,
            resource,
          });

        if (result.cloudResource?.id) {
          newIds.push(result.cloudResource.id);
        }
      } catch (error) {
        logger.error(
          `Cloud connection ${data.connectionId.toString()}: a resource could not be saved: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (newIds.length > 0) {
      const rows: unknown =
        await CloudResourceService.getRepository().manager.query(
          `UPDATE "CloudResource"
          SET "cloudConnectionId" = $1
          WHERE "projectId" = $2
            AND "_id" = ANY($3::uuid[])
            AND "cloudConnectionId" IS NULL
            AND "deletedAt" IS NULL
          RETURNING "_id"`,
          [
            data.connectionId.toString(),
            data.projectId.toString(),
            newIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ],
        );

      newResources = countReturnedRows(rows);
    }

    // 2. A listed resource is alive.
    if (data.completelyListedAccounts.length > 0) {
      const listedAccounts: Set<string> = new Set(
        data.completelyListedAccounts.map((account: string): string => {
          return account.toLowerCase();
        }),
      );

      for (const entry of data.discovered) {
        const row: LinkedRow | undefined = linkedByIdentifier.get(
          buildCloudMonitoredResourceIdentifier(entry.resource).toLowerCase(),
        );

        if (row && listedAccounts.has(entry.resource.accountId.toLowerCase())) {
          await CloudResourceService.recordMonitoredResourceSighting({
            cloudResourceId: row.id,
            resource: entry.resource,
          }).catch((error: unknown) => {
            logger.error(
              `Cloud connection ${data.connectionId.toString()}: a resource's sighting could not be recorded: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
        }
      }
    }

    // 3. A resource gone from an account listed in full is archived.
    let archivedResources: number = 0;
    const gone: Array<LinkedRow> = data.linked.filter(
      (row: LinkedRow): boolean => {
        return (
          !row.isArchived &&
          data.completelyListedAccounts.some((account: string): boolean => {
            return account.toLowerCase() === row.cloudAccountId.toLowerCase();
          }) &&
          !discoveredIdentifiers.has(row.resourceIdentifier.toLowerCase())
        );
      },
    );

    if (gone.length > 0) {
      const rows: unknown =
        await CloudResourceService.getRepository().manager.query(
          `UPDATE "CloudResource"
          SET "isArchived" = true,
            "archivedAt" = $3,
            "autoArchivedAt" = $3,
            "archivedByUserId" = NULL,
            "otelCollectorStatus" = 'disconnected',
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "projectId" = $1
            AND "_id" = ANY($2::uuid[])
            AND "isArchived" = false
            AND "deletedAt" IS NULL
          RETURNING "_id"`,
          [
            data.projectId.toString(),
            gone.map((row: LinkedRow): string => {
              return row.id.toString();
            }),
            new Date(),
          ],
        );

      archivedResources = countReturnedRows(rows);
    }

    // 4. What the connection holds now, read back: exact, whoever linked what.
    const counted: Array<LinkedRow> = (
      await CloudConnectionResourceSync.loadLinked({
        projectId: data.projectId,
        connectionId: data.connectionId,
      })
    ).filter((row: LinkedRow): boolean => {
      return !row.isArchived;
    });

    return CloudConnectionResourceSync.summarize({
      counted,
      newResources,
      archivedResources,
      hasMore: toCreate.length > MAX_NEW_RESOURCES_PER_READ,
    });
  }

  /*
   * What an inventory listed (CloudInventory), kept on the connection's
   * resources:
   *
   *   - a listed resource the connection holds gets what the inventory
   *     knows of it, and is alive (CloudResourceService.recordInventoryListing)
   *     - or, when the listing says what the last one said
   *     (getInventoryFingerprint), is only marked listed, together with
   *     every other such row, in one statement per thousand rows;
   *   - a listed resource it does not hold is found or created - with its
   *     tags already on it, so label and owner rules can match them - and
   *     linked, as a read's resources are;
   *   - a resource of a type the inventory listed in full for its account
   *     and Region (isGoneFromListing), which the listing no longer has, is
   *     gone from the cloud and is archived, the way a read archives an
   *     Azure resource. A type listed only in part, or a Region the listing
   *     did not read, says nothing about what is missing from it.
   */
  public static async syncInventory(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    items: Array<CloudInventoryItem>;
    completelyListed: Array<CloudCompleteListing>;
    listedAt: Date;
  }): Promise<CloudConnectionSyncResult> {
    const linked: Array<LinkedRow> =
      await CloudConnectionResourceSync.loadLinked({
        projectId: data.projectId,
        connectionId: data.connectionId,
      });
    const linkedByIdentifier: Map<string, LinkedRow> = new Map();

    for (const row of linked) {
      linkedByIdentifier.set(row.resourceIdentifier.toLowerCase(), row);
    }

    const listedIdentifiers: Set<string> = new Set<string>();
    const toCreate: Array<CloudInventoryItem> = [];
    const unchanged: Array<ObjectID> = [];

    for (const item of data.items) {
      const identifier: string = buildCloudMonitoredResourceIdentifier(
        item.resource,
      ).toLowerCase();

      if (listedIdentifiers.has(identifier)) {
        continue;
      }

      listedIdentifiers.add(identifier);

      const row: LinkedRow | undefined = linkedByIdentifier.get(identifier);

      if (!row) {
        toCreate.push(item);
        continue;
      }

      const inventory: CloudResourceInventoryColumns =
        CloudConnectionResourceSync.inventoryColumnsOf(item);

      // Said the same as last time: marked listed below, with the others.
      if (
        row.cloudInventoryFingerprint &&
        row.cloudInventoryFingerprint === inventory.cloudInventoryFingerprint
      ) {
        unchanged.push(row.id);
        continue;
      }

      try {
        await CloudResourceService.recordInventoryListing({
          cloudResourceId: row.id,
          resource: item.resource,
          inventory,
          listedAt: data.listedAt,
        });

        /*
         * A listing writes no feed and runs no hooks, so a resource whose
         * tags changed - or that a read found before the inventory gave it
         * any - has the label and owner rules run on it here: a rule on a
         * tag sees the tag.
         */
        if (
          Object.keys(item.tags).length > 0 &&
          !CloudConnectionResourceSync.sameTags(row.cloudTags, item.tags)
        ) {
          await CloudConnectionResourceSync.applyRules({
            projectId: data.projectId,
            cloudResourceId: row.id,
          });
        }
      } catch (error) {
        logger.error(
          `Cloud connection ${data.connectionId.toString()}: a resource's listing could not be recorded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (unchanged.length > 0) {
      await CloudResourceService.markListedUnchanged({
        projectId: data.projectId,
        cloudResourceIds: unchanged,
        listedAt: data.listedAt,
      }).catch((error: unknown) => {
        logger.error(
          `Cloud connection ${data.connectionId.toString()}: its listed resources could not be marked listed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }

    // 1. Listed resources the connection does not hold: found or created, then linked.
    const newIds: Array<ObjectID> = [];

    for (const item of toCreate.slice(0, MAX_NEW_RESOURCES_PER_READ)) {
      const resource: CloudMonitoredResource = item.displayName
        ? { ...item.resource, name: item.displayName }
        : item.resource;

      try {
        const result: CloudMonitoredResourceFindOrCreateResult =
          await CloudResourceService.findOrCreateMonitoredResource({
            projectId: data.projectId,
            resource,
            inventory: CloudConnectionResourceSync.inventoryColumnsOf(item),
          });

        if (result.cloudResource?.id) {
          newIds.push(result.cloudResource.id);

          // A row that was there already (another connection's, or ingest's) gets the listing too.
          if (!result.created) {
            await CloudResourceService.recordInventoryListing({
              cloudResourceId: result.cloudResource.id,
              resource: item.resource,
              inventory: CloudConnectionResourceSync.inventoryColumnsOf(item),
              listedAt: data.listedAt,
            });
          }
        }
      } catch (error) {
        logger.error(
          `Cloud connection ${data.connectionId.toString()}: a listed resource could not be saved: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const newResources: number = await CloudConnectionResourceSync.link({
      projectId: data.projectId,
      connectionId: data.connectionId,
      ids: newIds,
    });

    // 2. Gone: of a type listed in full for its account and Region, and not listed.
    const gone: Array<LinkedRow> = linked.filter((row: LinkedRow): boolean => {
      return (
        !row.isArchived &&
        !listedIdentifiers.has(row.resourceIdentifier.toLowerCase()) &&
        isGoneFromListing({ row, completelyListed: data.completelyListed })
      );
    });

    const archivedResources: number = await CloudConnectionResourceSync.archive(
      {
        projectId: data.projectId,
        ids: gone.map((row: LinkedRow): ObjectID => {
          return row.id;
        }),
      },
    );

    const counted: Array<LinkedRow> = (
      await CloudConnectionResourceSync.loadLinked({
        projectId: data.projectId,
        connectionId: data.connectionId,
      })
    ).filter((row: LinkedRow): boolean => {
      return !row.isArchived;
    });

    return CloudConnectionResourceSync.summarize({
      counted,
      newResources,
      archivedResources,
      hasMore: toCreate.length > MAX_NEW_RESOURCES_PER_READ,
    });
  }

  // Whether two tag maps say the same, whatever order their keys are in.
  public static sameTags(
    one: Record<string, string>,
    other: Record<string, string>,
  ): boolean {
    const oneKeys: Array<string> = Object.keys(one).sort();
    const otherKeys: Array<string> = Object.keys(other).sort();

    return (
      oneKeys.length === otherKeys.length &&
      oneKeys.every((key: string, index: number): boolean => {
        return key === otherKeys[index] && one[key] === other[key];
      })
    );
  }

  // The label rules, then the owner rules, as a create runs them.
  private static async applyRules(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
  }): Promise<void> {
    const resource: CloudResource = new CloudResource();
    resource.id = data.cloudResourceId;
    resource.projectId = data.projectId;

    await CloudResourceLabelRuleEngineService.applyRulesToCloudResource(
      resource,
    );
    await CloudResourceOwnerRuleEngineService.applyRulesToCloudResource(
      resource,
    );
  }

  public static inventoryColumnsOf(
    item: CloudInventoryItem,
  ): CloudResourceInventoryColumns {
    return {
      cloudTags: item.tags,
      cloudProperties: item.properties,
      cloudRelationships: item.relationships,
      cloudEndpoints: item.endpoints,
      cloudInventoryFingerprint: getInventoryFingerprint(item),
    };
  }

  // Links rows no connection holds to this one; how many it took.
  private static async link(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    ids: Array<ObjectID>;
  }): Promise<number> {
    if (data.ids.length === 0) {
      return 0;
    }

    const rows: unknown =
      await CloudResourceService.getRepository().manager.query(
        `UPDATE "CloudResource"
          SET "cloudConnectionId" = $1
          WHERE "projectId" = $2
            AND "_id" = ANY($3::uuid[])
            AND "cloudConnectionId" IS NULL
            AND "deletedAt" IS NULL
          RETURNING "_id"`,
        [
          data.connectionId.toString(),
          data.projectId.toString(),
          data.ids.map((id: ObjectID): string => {
            return id.toString();
          }),
        ],
      );

    return countReturnedRows(rows);
  }

  // Archives rows gone from the cloud, the way the silence sweep does; how many.
  private static async archive(data: {
    projectId: ObjectID;
    ids: Array<ObjectID>;
  }): Promise<number> {
    if (data.ids.length === 0) {
      return 0;
    }

    const rows: unknown =
      await CloudResourceService.getRepository().manager.query(
        `UPDATE "CloudResource"
          SET "isArchived" = true,
            "archivedAt" = $3,
            "autoArchivedAt" = $3,
            "archivedByUserId" = NULL,
            "otelCollectorStatus" = 'disconnected',
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "projectId" = $1
            AND "_id" = ANY($2::uuid[])
            AND "isArchived" = false
            AND "deletedAt" IS NULL
          RETURNING "_id"`,
        [
          data.projectId.toString(),
          data.ids.map((id: ObjectID): string => {
            return id.toString();
          }),
          new Date(),
        ],
      );

    return countReturnedRows(rows);
  }

  private static summarize(data: {
    counted: Array<LinkedRow>;
    newResources: number;
    archivedResources: number;
    hasMore: boolean;
  }): CloudConnectionSyncResult {
    const counted: Array<LinkedRow> = data.counted;

    return {
      resourceCount: counted.length,
      resourceTypes: countCloudConnectionValues(
        counted.map((row: LinkedRow): string => {
          return row.cloudResourceType;
        }),
      ).map((entry: { value: string; count: number }) => {
        return { type: entry.value, count: entry.count };
      }),
      regions: countCloudConnectionValues(
        counted.map((row: LinkedRow): string => {
          return row.cloudRegion;
        }),
      ).map((entry: { value: string; count: number }) => {
        return { region: entry.value, count: entry.count };
      }),
      newResources: data.newResources,
      archivedResources: data.archivedResources,
      hasMore: data.hasMore,
    };
  }
}
