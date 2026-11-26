import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  DATA_STORE_CREATE_OPERATIONS,
  normalizeCreatorIdentity,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
} from "../../../Utils/Telemetry/ChangeEventFields";
import { Results } from "../../Services/AnalyticsDatabaseService";
import ChangeEventService from "../../Services/ChangeEventService";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { ResponseJSON } from "@clickhouse/client";

/*
 * WHO CREATED A STORE, WHERE THE CLOUD'S CHANGE LOG NAMES IT (#10370).
 *
 * A cloud's activity log reaches OneUptime as change events
 * (CloudConnection/CloudChangeRecorder): "the terraform-ci role ran
 * s3:CreateBucket on site-7-assets". Twelve buckets one person made in the
 * console, or forty one pipeline made, were made by one identity, and that
 * is a fact a group of their issues can rest on
 * (Types/DataSecurity/DataSecurityIssueGroup).
 *
 * One read per batch of stores: the earliest create the change log kept for
 * each, by the store's Cloud Resource (oneuptime.resource.id) or its id at
 * the provider, whole or by its last segment. A store made before the log
 * reached OneUptime, or longer ago than its retention, names no creator,
 * and neither does a read that fails: grouping goes on with the facts it
 * has. The actor is the cloud's own words - data, never instructions.
 */

// The most stores one read asks about.
export const MAX_STORES_PER_CREATOR_READ: number = 500;

// The longest one read runs.
const CREATOR_READ_TIMEOUT_IN_SECONDS: number = 20;

// A store, as the creator read finds it in the change log.
export interface StoreToFindCreatorOf {
  id: string;
  cloudResourceId?: string | undefined;
  providerResourceId?: string | undefined;
}

function lastSegment(id: string): string {
  return id.split(/[/:]/).pop()?.trim() || "";
}

function text(value: string): { type: TableColumnType; value: string } {
  return { type: TableColumnType.Text, value };
}

export default class DataSecurityStoreCreators {
  /*
   * The identity that created each store the change log names a creator
   * of, normalized (normalizeCreatorIdentity): by the store's id. Never
   * throws.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    stores: ReadonlyArray<StoreToFindCreatorOf>;
  }): Promise<Map<string, string>> {
    const creators: Map<string, string> = new Map();

    for (
      let start: number = 0;
      start < data.stores.length;
      start += MAX_STORES_PER_CREATOR_READ
    ) {
      const batch: ReadonlyArray<StoreToFindCreatorOf> = data.stores.slice(
        start,
        start + MAX_STORES_PER_CREATOR_READ,
      );

      try {
        const statement: Statement | null =
          DataSecurityStoreCreators.buildStatement({
            projectId: data.projectId,
            stores: batch,
          });

        if (!statement) {
          continue;
        }

        const result: Results =
          await ChangeEventService.executeQuery(statement);
        const response: ResponseJSON<JSONObject> =
          await result.json<JSONObject>();

        for (const [storeId, creator] of DataSecurityStoreCreators.matchRows({
          stores: batch,
          rows: (response.data || []) as Array<JSONObject>,
        })) {
          creators.set(storeId, creator);
        }
      } catch (error) {
        logger.debug(
          `DataSecurity grouping: could not read who created the stores of project ${data.projectId.toString()}: ${error}`,
        );
      }
    }

    return creators;
  }

  /*
   * Each store's creator from the rows the read answered: its Cloud
   * Resource's row first, else the row of its id at the provider, whole or
   * by its last segment - never a row two stores could both be.
   */
  public static matchRows(data: {
    stores: ReadonlyArray<StoreToFindCreatorOf>;
    rows: ReadonlyArray<JSONObject>;
  }): Map<string, string> {
    const byCloudResource: Map<string, string> = new Map();
    const byProviderId: Map<string, string> = new Map();

    for (const row of data.rows) {
      const creator: string | null = normalizeCreatorIdentity(
        typeof row["creator"] === "string" ? row["creator"] : "",
      );

      if (!creator) {
        continue;
      }

      const cloudResourceId: string =
        typeof row["cloudResourceId"] === "string"
          ? row["cloudResourceId"].trim().toLowerCase()
          : "";
      const providerResourceId: string =
        typeof row["providerResourceId"] === "string"
          ? row["providerResourceId"].trim()
          : "";

      if (cloudResourceId && !byCloudResource.has(cloudResourceId)) {
        byCloudResource.set(cloudResourceId, creator);
      }

      if (providerResourceId && !byProviderId.has(providerResourceId)) {
        byProviderId.set(providerResourceId, creator);
      }
    }

    // A last segment two stores share names neither of them.
    const segmentCounts: Map<string, number> = new Map();

    for (const store of data.stores) {
      const segment: string = lastSegment(store.providerResourceId || "");

      if (segment) {
        segmentCounts.set(segment, (segmentCounts.get(segment) || 0) + 1);
      }
    }

    const creators: Map<string, string> = new Map();

    for (const store of data.stores) {
      const cloudResourceId: string = (store.cloudResourceId || "")
        .trim()
        .toLowerCase();
      const providerResourceId: string = (
        store.providerResourceId || ""
      ).trim();
      const segment: string = lastSegment(providerResourceId);
      const creator: string | undefined =
        (cloudResourceId && byCloudResource.get(cloudResourceId)) ||
        (providerResourceId && byProviderId.get(providerResourceId)) ||
        (segment && segmentCounts.get(segment) === 1
          ? byProviderId.get(segment)
          : undefined);

      if (creator) {
        creators.set(store.id, creator);
      }
    }

    return creators;
  }

  // The change log read: every value a parameter, the attribute keys too.
  public static buildStatement(data: {
    projectId: ObjectID;
    stores: ReadonlyArray<StoreToFindCreatorOf>;
  }): Statement | null {
    const cloudResourceIds: Array<string> = [];
    const providerIds: Array<string> = [];

    for (const store of data.stores) {
      const cloudResourceId: string = (store.cloudResourceId || "").trim();
      const providerResourceId: string = (
        store.providerResourceId || ""
      ).trim();

      if (cloudResourceId) {
        cloudResourceIds.push(cloudResourceId);
      }

      if (providerResourceId) {
        providerIds.push(providerResourceId);

        const segment: string = lastSegment(providerResourceId);

        if (segment && segment !== providerResourceId) {
          providerIds.push(segment);
        }
      }
    }

    if (cloudResourceIds.length === 0 && providerIds.length === 0) {
      return null;
    }

    const statement: Statement = SQL`SELECT attributes[${text(
      ChangeEventAttribute.ResourceId,
    )}] AS cloudResourceId, attributes[${text(
      ChangeEventAttribute.CloudResourceId,
    )}] AS providerResourceId, argMin(attributes[${text(
      ChangeEventAttribute.CloudActor,
    )}], time) AS creator FROM `;

    statement.append(
      `${getClickhouseDatabaseName()}.${AnalyticsTableName.ChangeEvent}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND attributes[${text(ChangeEventAttribute.Source)}] = ${text(
        ChangeEventSource.Cloud,
      )} AND attributes[${text(ChangeEventAttribute.CloudOperation)}] IN ${{
        type: TableColumnType.ArrayText,
        value: [...DATA_STORE_CREATE_OPERATIONS],
      }} AND attributes[${text(ChangeEventAttribute.CloudActor)}] != '' AND (`,
    );

    if (cloudResourceIds.length > 0) {
      statement.append(
        SQL`attributes[${text(ChangeEventAttribute.ResourceId)}] IN ${{
          type: TableColumnType.ArrayText,
          value: cloudResourceIds,
        }}`,
      );
    }

    if (providerIds.length > 0) {
      if (cloudResourceIds.length > 0) {
        statement.append(SQL` OR `);
      }

      statement.append(
        SQL`attributes[${text(ChangeEventAttribute.CloudResourceId)}] IN ${{
          type: TableColumnType.ArrayText,
          value: providerIds,
        }}`,
      );
    }

    statement.append(
      SQL`) AND retentionDate >= now() GROUP BY cloudResourceId, providerResourceId LIMIT ${{
        type: TableColumnType.Number,
        value: (cloudResourceIds.length + providerIds.length) * 2,
      }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: CREATOR_READ_TIMEOUT_IN_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }
}
