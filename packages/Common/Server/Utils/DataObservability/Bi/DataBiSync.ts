import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import DataBiTool, {
  isDataBiTool,
} from "../../../../Types/DataObservability/DataBiTool";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataBiConnectionService from "../../../Services/DataBiConnectionService";
import DataDashboardService from "../../../Services/DataDashboardService";
import {
  getConnectionSecrets,
  sanitizeErrorMessage,
} from "../../DataSecurity/Content/DatabaseSampler";
import logger from "../../Logger";
import OpenLineageIngest, { ProjectCatalog } from "../OpenLineageIngest";
import { UsageAsset } from "../TableUsageMatching";
import {
  BiDashboardRead,
  MAX_BI_DASHBOARDS,
  readBiDashboards,
} from "./BiConnectors";
import { matchBiTables } from "./BiMatching";

/*
 * A BI TOOL'S DASHBOARDS, READ AND KEPT.
 *
 * Every hour, and when someone asks, each enabled BI tool's dashboards are
 * read with its own credentials (BiConnectors), the tables behind each are
 * matched to watched tables (BiMatching), and the tool's dashboards are
 * made to match what it says: new ones made, changed ones updated, gone
 * ones deleted. A read that fails keeps the dashboards of the last one and
 * says why on the tool.
 */

export interface DataBiSyncResult {
  dashboardCount: number;
  matchedTableCount: number;
  error: string | null;
}

const MAX_ERROR_LENGTH: number = 500;

export default class DataBiSync {
  // Every enabled tool, one after another: one that fails never stops the others.
  public static async syncAll(): Promise<void> {
    const connections: Array<DataBiConnection> =
      await DataBiConnectionService.findBy({
        query: { isEnabled: true },
        select: { _id: true },
        limit: 1_000,
        skip: 0,
        props: { isRoot: true },
      });

    for (const connection of connections) {
      try {
        await DataBiSync.syncConnection(connection.id!);
      } catch (error) {
        logger.error(
          `Data Observability: reading BI tool ${connection.id?.toString()} failed`,
        );
        logger.error(error);
      }
    }
  }

  public static async syncConnection(
    connectionId: ObjectID,
  ): Promise<DataBiSyncResult> {
    const connection: DataBiConnection | null =
      await DataBiConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          tool: true,
          baseUrl: true,
          credentials: true,
        },
        props: { isRoot: true },
      });

    if (!connection?.id || !connection.projectId) {
      return {
        dashboardCount: 0,
        matchedTableCount: 0,
        error: "No such BI tool.",
      };
    }

    const credentialsText: string = connection.credentials || "";

    try {
      const tool: unknown = connection.tool;

      if (!isDataBiTool(tool)) {
        throw new Error("This BI tool is not one OneUptime reads.");
      }

      let credentials: JSONObject = {};

      try {
        credentials = credentialsText
          ? (JSON.parse(credentialsText) as JSONObject)
          : {};
      } catch {
        throw new Error("The credentials are not JSON.");
      }

      const read: Array<BiDashboardRead> = await readBiDashboards(
        tool as DataBiTool,
        { baseUrl: connection.baseUrl || "", credentials },
      );
      const catalog: ProjectCatalog = await OpenLineageIngest.readCatalog(
        connection.projectId,
      );
      const result: DataBiSyncResult = await DataBiSync.keep({
        connection,
        tool: tool as DataBiTool,
        read: read.slice(0, MAX_BI_DASHBOARDS),
        catalog,
      });

      await DataBiConnectionService.updateOneById({
        id: connection.id,
        data: {
          lastSyncedAt: OneUptimeDate.getCurrentDate(),
          lastSyncError: "",
          dashboardCount: result.dashboardCount,
          matchedTableCount: result.matchedTableCount,
        },
        props: { isRoot: true },
      });

      return result;
    } catch (error) {
      const message: string = sanitizeErrorMessage(
        error,
        getConnectionSecrets(credentialsText || "{}"),
      ).slice(0, MAX_ERROR_LENGTH);

      await DataBiConnectionService.updateOneById({
        id: connection.id,
        data: {
          lastSyncedAt: OneUptimeDate.getCurrentDate(),
          lastSyncError: message,
        },
        props: { isRoot: true },
      });

      return { dashboardCount: 0, matchedTableCount: 0, error: message };
    }
  }

  // The tool's dashboards made to match what it says.
  public static async keep(data: {
    connection: DataBiConnection;
    tool: DataBiTool;
    read: Array<BiDashboardRead>;
    catalog: ProjectCatalog;
  }): Promise<DataBiSyncResult> {
    const existing: Array<DataDashboard> = await DataDashboardService.findBy({
      query: { dataBiConnectionId: data.connection.id! },
      select: { _id: true, externalId: true },
      limit: MAX_BI_DASHBOARDS + 500,
      skip: 0,
      props: { isRoot: true },
    });
    const byExternalId: Map<string, DataDashboard> = new Map(
      existing.map((dashboard: DataDashboard): [string, DataDashboard] => {
        return [dashboard.externalId || "", dashboard];
      }),
    );
    const seen: Set<string> = new Set();
    const matchedTables: Set<string> = new Set();

    for (const dashboard of data.read) {
      if (!dashboard.externalId || seen.has(dashboard.externalId)) {
        continue;
      }

      seen.add(dashboard.externalId);

      const tables: Array<UsageAsset> = matchBiTables(
        dashboard.tables,
        data.catalog,
      );
      const dataAssets: Array<DataAsset> = tables.map(
        (asset: UsageAsset): DataAsset => {
          matchedTables.add(asset.dataAssetId);

          const model: DataAsset = new DataAsset();

          model._id = asset.dataAssetId;

          return model;
        },
      );
      const fields: {
        name: string;
        url: string | undefined;
        folder: string | undefined;
        owner: string | undefined;
        changedAt: Date | undefined;
        tableCount: number;
      } = {
        name: dashboard.name,
        url: dashboard.url || undefined,
        folder: dashboard.folder || undefined,
        owner: dashboard.owner || undefined,
        changedAt: dashboard.changedAt || undefined,
        tableCount: dataAssets.length,
      };
      const known: DataDashboard | undefined = byExternalId.get(
        dashboard.externalId,
      );

      if (known?.id) {
        await DataDashboardService.updateOneById({
          id: known.id,
          data: { ...fields, dataAssets } as never,
          props: { isRoot: true },
        });
        continue;
      }

      const model: DataDashboard = new DataDashboard();

      model.projectId = data.connection.projectId!;
      model.dataBiConnectionId = data.connection.id!;
      model.tool = data.tool;
      model.externalId = dashboard.externalId;
      model.name = fields.name;
      if (fields.url) {
        model.url = fields.url;
      }

      if (fields.folder) {
        model.folder = fields.folder;
      }

      if (fields.owner) {
        model.owner = fields.owner;
      }

      if (fields.changedAt) {
        model.changedAt = fields.changedAt;
      }
      model.tableCount = fields.tableCount;
      model.dataAssets = dataAssets;

      await DataDashboardService.create({
        data: model,
        props: { isRoot: true },
      });
    }

    const gone: Array<ObjectID> = existing
      .filter((dashboard: DataDashboard): boolean => {
        return !seen.has(dashboard.externalId || "");
      })
      .map((dashboard: DataDashboard): ObjectID => {
        return dashboard.id!;
      });

    for (const id of gone) {
      await DataDashboardService.deleteOneById({
        id,
        props: { isRoot: true },
      });
    }

    return {
      dashboardCount: seen.size,
      matchedTableCount: matchedTables.size,
      error: null,
    };
  }
}
