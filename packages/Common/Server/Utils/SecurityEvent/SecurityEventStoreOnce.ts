import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
import { ENTRA_ID_PRODUCT_NAME } from "../../../Utils/SecurityEvent/Connectors/EntraIdNormalizer";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import logger from "../Logger";
import SecurityEventDedupe from "./SecurityEventDedupe";

/*
 * RECORDS MORE THAN ONE WAY BRINGS IN, STORED ONCE.
 *
 * Some records reach OneUptime two ways, and each way gives a record the
 * same event id (its id at the source):
 *
 *   - a Microsoft Entra ID sign-in, directory change or risk detection,
 *     read by the Microsoft Entra ID connection from Microsoft Graph, and
 *     by "Your logs" from what an Azure diagnostic setting exported
 *     (EntraIdNormalizer reads both);
 *   - an AWS CloudTrail, Google Cloud or Azure Activity Log audit record,
 *     read by "Your logs" from the logs, and by Cloud audit logs from the
 *     cloud account connected under Cloud (CloudAudit/CloudAuditSecurityEvents).
 *
 * Whichever way stores a record second looks its id up first and skips it,
 * under a lock of the record's product that every way takes around its
 * look-up and its insert, and inserts synchronously, so the two cannot both
 * miss each other. A way that cannot take the lock (no Valkey, a holder
 * that stalled) still looks up before it inserts: only two stores of the
 * same record in the same second would slip past then.
 */

// The products whose records more than one way stores, by the name they carry.
export const SHARED_RECORD_PRODUCT_NAMES: ReadonlyArray<string> = [
  ENTRA_ID_PRODUCT_NAME,
  ...[
    SecurityLogFormat.AwsCloudTrail,
    SecurityLogFormat.GoogleCloudAudit,
    SecurityLogFormat.AzureActivity,
  ].map((format: SecurityLogFormat): string => {
    return getSecurityLogFormatDefinition(format)?.productName || "";
  }),
].filter((name: string): boolean => {
  return name.length > 0;
});

export const SECURITY_EVENT_PRODUCT_LOCK_NAMESPACE: string =
  "SecurityEventProductStore";

// Long enough for one look-up and one insert, which is all a holder does.
const PRODUCT_LOCK_TIMEOUT_MS: number = 30 * 1000;
const PRODUCT_LOCK_ACQUIRE_TIMEOUT_MS: number = 15 * 1000;

// An event id that is the record's own, not one made up from the log line.
function hasRecordId(event: NormalizedSecurityEvent): boolean {
  return Boolean(event.eventUid) && !event.eventUid.startsWith("log:");
}

export interface SharedRecordGroup {
  vendorName: string;
  productName: string;
  events: Array<NormalizedSecurityEvent>;
}

export default class SecurityEventStoreOnce {
  // Whether more than one way stores this product's records.
  public static isSharedProduct(productName: string): boolean {
    return SHARED_RECORD_PRODUCT_NAMES.includes(productName);
  }

  // Whether more than one way can bring in this event's record.
  public static isSharedRecord(event: NormalizedSecurityEvent): boolean {
    return (
      SecurityEventStoreOnce.isSharedProduct(event.productName) &&
      hasRecordId(event)
    );
  }

  /*
   * A batch split into the records more than one way can bring in - by
   * vendor and product, the dedupe's scope - and the rest, in their order.
   */
  public static split(events: Array<NormalizedSecurityEvent>): {
    shared: Array<SharedRecordGroup>;
    rest: Array<NormalizedSecurityEvent>;
  } {
    const groups: Map<string, SharedRecordGroup> = new Map();
    const rest: Array<NormalizedSecurityEvent> = [];

    for (const event of events) {
      if (!SecurityEventStoreOnce.isSharedRecord(event)) {
        rest.push(event);
        continue;
      }

      const key: string = JSON.stringify([event.vendorName, event.productName]);
      const group: SharedRecordGroup = groups.get(key) || {
        vendorName: event.vendorName,
        productName: event.productName,
        events: [],
      };

      group.events.push(event);
      groups.set(key, group);
    }

    return { shared: Array.from(groups.values()), rest };
  }

  /*
   * The lock a product's records are looked up and inserted under, the
   * same whichever way stores them. A product a connection imports keeps
   * its connection's provider in the key.
   */
  public static lockKey(projectId: ObjectID, productName: string): string {
    const connector: SecurityEventConnectorDefinition | undefined =
      SecurityEventConnectorCatalog.find(
        (definition: SecurityEventConnectorDefinition): boolean => {
          return definition.productName === productName;
        },
      );

    return `${projectId.toString()}:${connector ? connector.provider : `product:${productName}`}`;
  }

  // Runs `work` holding the product's lock - or without it, when it cannot be had.
  public static async withProductLock<T>(data: {
    projectId: ObjectID;
    productName: string;
    work: () => Promise<T>;
  }): Promise<T> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        namespace: SECURITY_EVENT_PRODUCT_LOCK_NAMESPACE,
        key: SecurityEventStoreOnce.lockKey(data.projectId, data.productName),
        lockTimeout: PRODUCT_LOCK_TIMEOUT_MS,
        acquireTimeout: PRODUCT_LOCK_ACQUIRE_TIMEOUT_MS,
        retryInterval: 100,
        refreshInterval: 0,
      });
    } catch (error) {
      logger.warn(
        `SecurityEventStoreOnce: storing ${data.productName} records of project ${data.projectId.toString()} without the product lock: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      return await data.work();
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (error) {
          logger.error(
            `SecurityEventStoreOnce: could not release the product lock: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /*
   * A group's records the project does not hold yet - one of each id, none
   * it stored before - handed to `insert` under the product's lock, and
   * returned. `insert` must write synchronously, so the next way to look
   * finds them.
   */
  public static async storeNew(data: {
    projectId: ObjectID;
    group: SharedRecordGroup;
    insert: (events: Array<NormalizedSecurityEvent>) => Promise<void>;
  }): Promise<Array<NormalizedSecurityEvent>> {
    const seen: Set<string> = new Set();
    const unique: Array<NormalizedSecurityEvent> = data.group.events.filter(
      (event: NormalizedSecurityEvent): boolean => {
        if (seen.has(event.eventUid)) {
          return false;
        }

        seen.add(event.eventUid);
        return true;
      },
    );

    if (unique.length === 0) {
      return [];
    }

    return SecurityEventStoreOnce.withProductLock({
      projectId: data.projectId,
      productName: data.group.productName,
      work: async (): Promise<Array<NormalizedSecurityEvent>> => {
        const existing: Set<string> =
          await SecurityEventDedupe.findExistingEventUids({
            projectId: data.projectId,
            vendorName: data.group.vendorName,
            productName: data.group.productName,
            ids: unique.map((event: NormalizedSecurityEvent): string => {
              return event.eventUid;
            }),
          });
        const fresh: Array<NormalizedSecurityEvent> = unique.filter(
          (event: NormalizedSecurityEvent): boolean => {
            return !existing.has(event.eventUid);
          },
        );

        if (fresh.length > 0) {
          await data.insert(fresh);
        }

        return fresh;
      },
    });
  }
}
