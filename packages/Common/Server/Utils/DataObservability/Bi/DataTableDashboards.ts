import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Includes from "../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../Types/ObjectID";
import DataAssetLineageService from "../../../Services/DataAssetLineageService";
import DataDashboardService from "../../../Services/DataDashboardService";
import QueryHelper from "../../../Types/Database/QueryHelper";

/*
 * THE DASHBOARDS BUILT ON A TABLE.
 *
 * The real impact of bad data is the dashboard someone opens. A table's
 * dashboards are those whose charts query it, and those built on the
 * tables built from it, two steps down its lineage: a late source table's
 * alert lists the revenue dashboard that reads a model built from it.
 */

export interface TableDashboard {
  dataDashboardId: string;
  name: string;
  url: string | null;
  tool: string;
  folder: string | null;
  owner: string | null;
  // The table built from this one that the dashboard reads; null when it reads this one.
  via: { dataAssetId: string; table: string } | null;
}

// How far down a table's lineage its dashboards are looked for.
const LINEAGE_DEPTH: number = 2;
const MAX_DOWNSTREAM_TABLES: number = 100;
export const MAX_TABLE_DASHBOARDS: number = 50;

export default class DataTableDashboards {
  public static async find(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
  }): Promise<Array<TableDashboard>> {
    // Each table down the lineage, with the nearest name it was reached by.
    const via: Map<string, { dataAssetId: string; table: string } | null> =
      new Map([[data.dataAssetId.toString(), null]]);
    let frontier: Array<string> = [data.dataAssetId.toString()];

    for (
      let depth: number = 0;
      depth < LINEAGE_DEPTH && frontier.length > 0;
      depth++
    ) {
      const edges: Array<DataAssetLineage> =
        await DataAssetLineageService.findBy({
          query: {
            projectId: data.projectId,
            upstreamDataAssetId: new Includes(
              frontier.map((id: string): ObjectID => {
                return new ObjectID(id);
              }),
            ),
            downstreamDataAssetId: QueryHelper.notNull(),
          },
          select: {
            downstreamDataAssetId: true,
            downstreamDataAsset: { assetKey: true, name: true },
          },
          limit: MAX_DOWNSTREAM_TABLES,
          skip: 0,
          props: { isRoot: true },
        });
      const next: Array<string> = [];

      for (const edge of edges) {
        const id: string = edge.downstreamDataAssetId?.toString() || "";

        if (!id || via.has(id) || via.size >= MAX_DOWNSTREAM_TABLES) {
          continue;
        }

        via.set(id, {
          dataAssetId: id,
          table:
            edge.downstreamDataAsset?.assetKey ||
            edge.downstreamDataAsset?.name ||
            id,
        });
        next.push(id);
      }

      frontier = next;
    }

    const dashboards: Array<DataDashboard> = await DataDashboardService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.anyOfEntitiesInManyToMany({
          values: Array.from(via.keys()).map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          joinTableName: "DataDashboardDataAsset",
          ownerColumnName: "dataDashboardId",
          relationColumnName: "dataAssetId",
        }),
      },
      select: {
        _id: true,
        name: true,
        url: true,
        tool: true,
        folder: true,
        owner: true,
        dataAssets: { _id: true },
      },
      sort: { name: SortOrder.Ascending },
      limit: MAX_TABLE_DASHBOARDS,
      skip: 0,
      props: { isRoot: true },
    });

    return dashboards.map((dashboard: DataDashboard): TableDashboard => {
      const reads: Array<string> = (dashboard.dataAssets || []).map(
        (asset: { _id?: string | undefined }): string => {
          return asset._id?.toString() || "";
        },
      );
      // Reading the table itself wins over reading one built from it.
      const nearest: { dataAssetId: string; table: string } | null =
        reads.includes(data.dataAssetId.toString())
          ? null
          : reads
              .map((id: string) => {
                return via.get(id);
              })
              .find(
                (
                  value:
                    | { dataAssetId: string; table: string }
                    | null
                    | undefined,
                ): value is { dataAssetId: string; table: string } => {
                  return Boolean(value);
                },
              ) || null;

      return {
        dataDashboardId: dashboard.id!.toString(),
        name: dashboard.name || "",
        url: dashboard.url || null,
        tool: dashboard.tool || "",
        folder: dashboard.folder || null,
        owner: dashboard.owner || null,
        via: nearest,
      };
    });
  }
}
