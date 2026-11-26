import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import { addUtcDays } from "../../../Types/Cloud/CloudCost";
import {
  CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY,
  CloudCostAllocationWindow,
  getCloudCostWindowDays,
} from "../../../Types/Cloud/CloudCostAllocation";
import {
  CloudCostFocusRow,
  getCloudCostFocusBillingAccountId,
  getCloudCostFocusCsvHeader,
  toCloudCostFocusCsvLine,
  toCloudCostFocusRows,
} from "../../../Types/Cloud/CloudCostFocus";
import { GCP_BILLING_EXPORT_TABLE_FIELD_KEY } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudCostService from "../../Services/CloudCostService";
import Query from "../../Types/AnalyticsDatabase/Query";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { readCloudCostAccounts } from "./CloudCostServerReader";

/*
 * EVERY COST OF A PERIOD AS A FOCUS 1.2 FILE (#11009).
 *
 *   POST /cloud-cost/export  { startDate, endDate | period, cloudAccountIds? }
 *
 * Each cost row the caller may read (CloudCost, through the same read
 * permission as every read of the table: a grant limited by labels reads
 * the accounts it reaches), written as FOCUS rows (Types/Cloud/
 * CloudCostFocus) while ClickHouse streams them, so the file is never held
 * whole. In every currency the accounts are billed in: each row says its
 * own.
 *
 * At most a quarter at a time (93 days): a month is the period finance
 * pulls, and a quarter of costs per resource is the most a file holds
 * without filling a laptop's spreadsheet.
 *
 * The billing account each row names comes from its account's connection
 * (an AWS role's account, a Google Cloud billing export's billing account):
 * read as OneUptime, for the accounts the caller may read, and only the IDs
 * they name are written - never a connection's settings.
 */

export const CLOUD_COST_FOCUS_MAX_DAYS: number =
  CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY;

interface FocusAccount {
  accountId: string;
  accountName: string;
  billingAccountId: string;
  billingAccountName: string | null;
}

export class CloudCostFocusExport {
  /*
   * The accounts the caller may read, each with the billing account its
   * connection reads the bill from, by their OneUptime IDs.
   */
  @CaptureSpan()
  public static async loadAccounts(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, FocusAccount>> {
    const accounts: Array<CloudAccount> = await readCloudCostAccounts(data);
    const connectionIds: Array<ObjectID> = [];

    for (const account of accounts) {
      if (
        account.cloudConnectionId &&
        !connectionIds.some((id: ObjectID): boolean => {
          return id.toString() === account.cloudConnectionId!.toString();
        })
      ) {
        connectionIds.push(account.cloudConnectionId);
      }
    }

    // Only the IDs a connection's settings name are read out of them.
    const connections: Array<CloudConnection> =
      connectionIds.length > 0
        ? await CloudConnectionService.findBy({
            query: {
              projectId: data.projectId,
              _id: new Includes(connectionIds),
            },
            select: { _id: true, name: true, provider: true, config: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          })
        : [];
    const configOf: Map<string, JSONObject> = new Map();
    const connectionNameOf: Map<string, string> = new Map();

    for (const connection of connections) {
      if (connection.id) {
        configOf.set(connection.id.toString(), connection.config || {});
        connectionNameOf.set(connection.id.toString(), connection.name || "");
      }
    }

    // An account's name, by its id in its cloud: a billing account's name.
    const nameByCloudId: Map<string, string> = new Map();

    for (const account of accounts) {
      if (account.accountId) {
        nameByCloudId.set(
          account.accountId,
          account.providerAccountName || account.name || account.accountId,
        );
      }
    }

    const found: Map<string, FocusAccount> = new Map();

    for (const account of accounts) {
      if (!account.id || !account.accountId) {
        continue;
      }

      const connectionId: string = account.cloudConnectionId?.toString() || "";
      const config: JSONObject = configOf.get(connectionId) || {};
      const billingAccountId: string = getCloudCostFocusBillingAccountId({
        provider: String(account.provider || ""),
        accountId: account.accountId,
        roleArn:
          typeof config["roleArn"] === "string"
            ? (config["roleArn"] as string)
            : undefined,
        billingExportTable:
          typeof config[GCP_BILLING_EXPORT_TABLE_FIELD_KEY] === "string"
            ? (config[GCP_BILLING_EXPORT_TABLE_FIELD_KEY] as string)
            : undefined,
      });

      found.set(account.id.toString(), {
        accountId: account.accountId,
        accountName:
          account.providerAccountName || account.name || account.accountId,
        billingAccountId,
        billingAccountName:
          nameByCloudId.get(billingAccountId) ||
          connectionNameOf.get(connectionId) ||
          null,
      });
    }

    return found;
  }

  /*
   * The period's costs as a FOCUS file, handed to `write` a chunk at a
   * time as ClickHouse streams them. Resolves with how many FOCUS rows
   * were written.
   */
  @CaptureSpan()
  public static async write(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    window: CloudCostAllocationWindow;
    cloudAccountIds?: Array<ObjectID> | undefined;
    write: (chunk: string) => void;
  }): Promise<{ rows: number }> {
    if (getCloudCostWindowDays(data.window) > CLOUD_COST_FOCUS_MAX_DAYS) {
      throw new BadDataException(
        `A FOCUS export covers at most ${CLOUD_COST_FOCUS_MAX_DAYS} days. Export a month or a quarter at a time.`,
      );
    }

    const accounts: Map<string, FocusAccount> = await this.loadAccounts({
      projectId: data.projectId,
      props: data.props,
    });

    const query: Query<CloudCost> = {
      projectId: data.projectId,
      day: new InBetween<Date>(
        data.window.start,
        new Date(addUtcDays(data.window.lastDay, 1).getTime() - 1),
      ),
    } as Query<CloudCost>;

    if (data.cloudAccountIds && data.cloudAccountIds.length > 0) {
      (query as Record<string, unknown>)["cloudAccountId"] =
        data.cloudAccountIds.length === 1
          ? data.cloudAccountIds[0]
          : new Includes(data.cloudAccountIds);
    }

    // Read as the caller may read the costs.
    const where: Statement = await CloudCostService.getScopedWhere({
      query,
      props: data.props,
    });
    const table: { databaseName: string; tableName: string } =
      CloudCostService.getTableReference();

    const statement: Statement = SQL`SELECT `
      .append(
        /*
         * Each figure as text, at the precision it is kept; aliases of
         * their own, so the filter below reads the table's columns.
         */
        `toString(toDate(day)) AS focus_day, provider AS focus_provider, accountId AS focus_account_id, toString(cloudAccountId) AS focus_cloud_account_id, service AS focus_service, region AS focus_region, resourceId AS focus_resource_id, toString(cost) AS focus_cost, toString(amortizedCost) AS focus_amortized_cost, toString(netCost) AS focus_net_cost, currency AS focus_currency, tags AS focus_tags`,
      )
      .append(` FROM ${table.databaseName}.${table.tableName} WHERE TRUE `)
      .append(where)
      .append(
        SQL` ORDER BY focus_day, focus_cloud_account_id, focus_service, focus_region, focus_resource_id`,
      )
      .append(
        getQuerySettings({
          maxExecutionTimeInSeconds: 300,
          additionalSettings: { max_threads: 4 },
        }),
      );

    data.write(getCloudCostFocusCsvHeader());

    let written: number = 0;
    let buffer: Array<string> = [];

    await CloudCostService.readRowsAsTheyArrive({
      statement,
      onRow: (row: JSONObject): void => {
        const account: FocusAccount | undefined = accounts.get(
          String(row["focus_cloud_account_id"] || ""),
        );
        const accountId: string = String(row["focus_account_id"] || "");
        const tags: Record<string, string> = {};
        const rowTags: unknown = row["focus_tags"];

        if (rowTags && typeof rowTags === "object" && !Array.isArray(rowTags)) {
          for (const [key, value] of Object.entries(
            rowTags as Record<string, unknown>,
          )) {
            tags[key] = String(value ?? "");
          }
        }

        const focusRows: Array<CloudCostFocusRow> = toCloudCostFocusRows({
          day: String(row["focus_day"] || ""),
          provider: String(row["focus_provider"] || ""),
          accountId: account?.accountId || accountId,
          accountName: account?.accountName || accountId,
          billingAccountId: account?.billingAccountId || accountId,
          billingAccountName: account?.billingAccountName,
          service: String(row["focus_service"] || ""),
          region: String(row["focus_region"] || ""),
          resourceId: String(row["focus_resource_id"] || ""),
          currency: String(row["focus_currency"] || ""),
          cost: Number(row["focus_cost"]) || 0,
          amortizedCost: Number(row["focus_amortized_cost"]) || 0,
          netCost: Number(row["focus_net_cost"]) || 0,
          tags,
        });

        for (const focusRow of focusRows) {
          buffer.push(toCloudCostFocusCsvLine(focusRow));
          written++;
        }

        if (buffer.length >= 500) {
          data.write(buffer.join(""));
          buffer = [];
        }
      },
    });

    if (buffer.length > 0) {
      data.write(buffer.join(""));
    }

    return { rows: written };
  }
}

export default CloudCostFocusExport;
