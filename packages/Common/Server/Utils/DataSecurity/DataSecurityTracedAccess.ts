import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreAccessService from "../../Services/DataStoreAccessService";
import logger from "../Logger";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  getDataStoreAccessKey,
} from "../../../Types/DataSecurity/DataStoreAccess";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE SERVICES SEEN USING A STORE, AS WHO CAN REACH IT.
 *
 * A cloud's access settings say who may reach a store; traces say who
 * does. Each service the service map shows calling a store
 * (DataSecurityFlows' Uses flows) is one access entry of that store: the
 * service, Read, "Seen in traces", last used when the service map last saw
 * the call. A service reads what it calls, in practice; which way the data
 * goes is not in the service map's edge.
 *
 * The entries are the traces' own: a cloud's read never removes one
 * (DataSecurityDiscovery keeps them), and this removes the ones whose
 * service no longer calls the store - only after a read of the service map
 * that worked, so a failed read takes nothing away.
 */

export const TRACED_ACCESS_VIA: string = "Seen in traces";

// The most traced entries one project keeps.
export const MAX_TRACED_ACCESS_ENTRIES: number = 10000;

export interface TracedUse {
  dataStoreId: ObjectID;
  serviceId?: ObjectID | undefined;
  serviceName: string;
  // When the service map last saw the service call the store.
  seenAt: Date;
}

/*
 * The service as an access entry: its id is its principal, so a renamed
 * service stays one identity; a service the map names but OneUptime holds
 * no record of goes by its name.
 */
export function tracedAccessEntry(use: TracedUse): DataStoreAccessEntry {
  const name: string = (use.serviceName || "").trim().slice(0, 500);

  return {
    principal: use.serviceId
      ? use.serviceId.toString()
      : `service:${name}`.slice(0, 500),
    principalName: name || undefined,
    principalType: DataStorePrincipalType.Service,
    accessLevel: DataStoreAccessLevel.Read,
    grantedVia: TRACED_ACCESS_VIA,
    isExternal: false,
    isPublic: false,
    isSeenInTraces: true,
    lastUsedAt: use.seenAt,
  };
}

export default class DataSecurityTracedAccess {
  public static async sync(data: {
    projectId: ObjectID;
    uses: ReadonlyArray<TracedUse>;
    now: Date;
  }): Promise<void> {
    const existing: Array<DataStoreAccess> =
      await DataStoreAccessService.findBy({
        query: { projectId: data.projectId, isSeenInTraces: true },
        select: { _id: true, dataStoreId: true, accessKey: true },
        skip: 0,
        limit: MAX_TRACED_ACCESS_ENTRIES,
        props: { isRoot: true },
      });
    const byKey: Map<string, DataStoreAccess> = new Map();

    for (const row of existing) {
      byKey.set(`${row.dataStoreId?.toString()}|${row.accessKey || ""}`, row);
    }

    const wanted: Set<string> = new Set();

    for (const use of data.uses.slice(0, MAX_TRACED_ACCESS_ENTRIES)) {
      const entry: DataStoreAccessEntry = tracedAccessEntry(use);
      const accessKey: string = getDataStoreAccessKey(entry);
      const key: string = `${use.dataStoreId.toString()}|${accessKey}`;

      if (wanted.has(key)) {
        continue;
      }

      wanted.add(key);

      const columns: JSONObject = {
        principal: entry.principal,
        principalType: entry.principalType,
        accessLevel: entry.accessLevel,
        grantedVia: entry.grantedVia,
        isExternal: false,
        isPublic: false,
        isSeenInTraces: true,
        lastUsedAt: use.seenAt,
        lastSeenAt: data.now,
      };

      if (entry.principalName) {
        columns["principalName"] = entry.principalName;
      }

      try {
        const row: DataStoreAccess | undefined = byKey.get(key);

        if (row?.id) {
          await DataStoreAccessService.updateColumnsByIdWithoutHooks({
            id: row.id,
            data: columns as never,
          });
          continue;
        }

        const access: DataStoreAccess = new DataStoreAccess();
        access.projectId = data.projectId;
        access.dataStoreId = use.dataStoreId;
        access.accessKey = accessKey;
        access.firstSeenAt = data.now;

        for (const [column, value] of Object.entries(columns)) {
          access.setColumnValue(column, value);
        }

        await DataStoreAccessService.create({
          data: access,
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `DataSecurity: could not record ${entry.principalName || entry.principal} using store ${use.dataStoreId.toString()}:`,
        );
        logger.error(error);
      }
    }

    for (const [key, row] of byKey) {
      if (row.id && !wanted.has(key)) {
        try {
          await DataStoreAccessService.deleteOneById({
            id: row.id,
            props: { isRoot: true },
          });
        } catch (error) {
          logger.error(
            `DataSecurity: could not remove a traced access entry of store ${row.dataStoreId?.toString()}:`,
          );
          logger.error(error);
        }
      }
    }
  }
}
