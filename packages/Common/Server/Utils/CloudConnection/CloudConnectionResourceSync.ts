import CloudResource from "../../../Models/DatabaseModels/CloudResource";
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
} from "../../Services/CloudResourceService";
import logger from "../Logger";
import {
  CloudDiscoveredResource,
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
      newResources,
      archivedResources,
      hasMore: toCreate.length > MAX_NEW_RESOURCES_PER_READ,
    };
  }
}
