import PageComponentProps from "../../PageComponentProps";
import { useTableViewContext } from "./TableViewContext";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../../Components/AppLink/AppLink";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import DataAssetLineage from "Common/Models/DatabaseModels/DataAssetLineage";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import {
  DataColumnMapping,
  readColumnMappings,
} from "Common/Types/DataObservability/DataColumnLineage";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  DataAssetColumn,
  readDataAssetColumns,
} from "Common/Types/DataObservability/DataAssetColumn";
import Card from "Common/UI/Components/Card/Card";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The table's columns as its last collection read them, in their order: each
 * one's name, type and whether it allows empty values. How they changed over
 * time is on the Timeline. Where the table's lineage names columns (Snowflake's
 * access history, OpenLineage's column lineage), each one says where it comes
 * from and what it feeds.
 */

// The most links one cell shows: the rest are counted.
const MAX_LINKS_PER_CELL: number = 3;

interface ColumnLink {
  dataAssetId: string;
  label: string;
}

interface ColumnLinks {
  comesFrom: Map<string, Array<ColumnLink>>;
  feeds: Map<string, Array<ColumnLink>>;
}

function addLink(
  links: Map<string, Array<ColumnLink>>,
  column: string,
  link: ColumnLink,
): void {
  links.set(column, [...(links.get(column) || []), link]);
}

function describeTable(asset: DataAsset | undefined): string {
  return asset?.schemaName
    ? `${asset.schemaName}.${asset.name || ""}`
    : asset?.name || "";
}

async function readColumnLinks(dataAssetId: ObjectID): Promise<ColumnLinks> {
  const links: ColumnLinks = { comesFrom: new Map(), feeds: new Map() };
  const select: {
    columnMappings: true;
    upstreamDataAsset: { _id: true; name: true; schemaName: true };
    downstreamDataAsset: { _id: true; name: true; schemaName: true };
  } = {
    columnMappings: true,
    upstreamDataAsset: { _id: true, name: true, schemaName: true },
    downstreamDataAsset: { _id: true, name: true, schemaName: true },
  };
  const [incoming, outgoing]: [
    ListResult<DataAssetLineage>,
    ListResult<DataAssetLineage>,
  ] = await Promise.all([
    ModelAPI.getList<DataAssetLineage>({
      modelType: DataAssetLineage,
      query: { downstreamDataAssetId: dataAssetId },
      limit: 200,
      skip: 0,
      select,
      sort: {},
    }),
    ModelAPI.getList<DataAssetLineage>({
      modelType: DataAssetLineage,
      query: { upstreamDataAssetId: dataAssetId },
      limit: 200,
      skip: 0,
      select,
      sort: {},
    }),
  ]);

  for (const edge of incoming.data) {
    for (const mapping of readColumnMappings(edge.columnMappings)) {
      addLink(links.comesFrom, mapping.downstreamColumn, {
        dataAssetId: edge.upstreamDataAsset?.id?.toString() || "",
        label: `${describeTable(edge.upstreamDataAsset)}.${mapping.upstreamColumn}`,
      });
    }
  }

  for (const edge of outgoing.data) {
    readColumnMappings(edge.columnMappings).forEach(
      (mapping: DataColumnMapping): void => {
        addLink(links.feeds, mapping.upstreamColumn, {
          dataAssetId: edge.downstreamDataAsset?.id?.toString() || "",
          label: `${describeTable(edge.downstreamDataAsset)}.${mapping.downstreamColumn}`,
        });
      },
    );
  }

  return links;
}

const ColumnLinksCell: FunctionComponent<{
  links: Array<ColumnLink> | undefined;
}> = (props: { links: Array<ColumnLink> | undefined }): ReactElement => {
  const links: Array<ColumnLink> = props.links || [];

  if (links.length === 0) {
    return <span className="text-gray-400">-</span>;
  }

  return (
    <div className="space-y-0.5">
      {links.slice(0, MAX_LINKS_PER_CELL).map((link: ColumnLink) => {
        return (
          <div key={`${link.dataAssetId}:${link.label}`}>
            <AppLink
              className="font-mono text-gray-700 hover:underline"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
                { modelId: new ObjectID(link.dataAssetId) },
              )}
            >
              {link.label}
            </AppLink>
          </div>
        );
      })}
      {links.length > MAX_LINKS_PER_CELL ? (
        <div className="text-xs text-gray-500">
          +{links.length - MAX_LINKS_PER_CELL}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const TableColumnsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataAsset, dataAssetId } = useTableViewContext();
  const columns: Array<DataAssetColumn> = readDataAssetColumns(
    dataAsset?.columns,
  );
  const [links, setLinks] = useState<ColumnLinks | null>(null);

  // Extra to the columns: a page that cannot read lineage still lists them.
  useEffect(() => {
    readColumnLinks(dataAssetId)
      .then(setLinks)
      .catch(() => {
        setLinks(null);
      });
  }, [dataAssetId?.toString()]);

  const hasColumnLineage: boolean =
    Boolean(links) && (links!.comesFrom.size > 0 || links!.feeds.size > 0);

  /*
   * The columns as wide as a person makes them (Common's
   * Table/ColumnResize): a long column name gives way, its type and whether
   * it allows empty values never. The position is a row number, with no
   * edge of its own.
   */
  const tableColumns: ResizableColumns = useResizableColumns({
    tableKey: "data-asset-columns-table",
    columns: [
      { id: "name", cellNumber: 2 },
      { id: "type", cellNumber: 3 },
      { id: "allowsEmpty", cellNumber: 4 },
      { id: "comesFrom", cellNumber: 5 },
      { id: "feeds", cellNumber: 6 },
    ],
  });

  return (
    <Card
      title="Columns"
      description="The table's columns at its last collection. Changes to them are on the Timeline and on Schema Changes."
    >
      <div className="overflow-x-auto px-6 pb-6">
        {columns.length === 0 ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "No columns read yet. They show after the next collection.",
            )}
          </p>
        ) : (
          <>
            {tableColumns.styles}
            <table
              className={`${tableColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200 text-sm`}
              {...tableColumns.tableAttributes}
            >
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">#</th>
                  <ResizableHeaderCell
                    className="py-2 pr-4"
                    resize={tableColumns.getResize(
                      "name",
                      translator.translateText("Name") || "Name",
                      ColumnWidthKind.Name,
                    )}
                  >
                    <span>{translator.translateText("Name")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="py-2 pr-4"
                    resize={tableColumns.getResize(
                      "type",
                      translator.translateText("Type") || "Type",
                      ColumnWidthKind.Text,
                    )}
                  >
                    <span>{translator.translateText("Type")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="py-2 pr-4"
                    resize={tableColumns.getResize(
                      "allowsEmpty",
                      translator.translateText("Allows Empty") ||
                        "Allows Empty",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Allows Empty")}</span>
                  </ResizableHeaderCell>
                  {hasColumnLineage ? (
                    <>
                      <ResizableHeaderCell
                        className="py-2 pr-4"
                        resize={tableColumns.getResize(
                          "comesFrom",
                          translator.translateText("Comes From") ||
                            "Comes From",
                          ColumnWidthKind.Name,
                        )}
                      >
                        <span>{translator.translateText("Comes From")}</span>
                      </ResizableHeaderCell>
                      <ResizableHeaderCell
                        className="py-2 pr-4"
                        resize={tableColumns.getResize(
                          "feeds",
                          translator.translateText("Feeds") || "Feeds",
                          ColumnWidthKind.Name,
                        )}
                      >
                        <span>{translator.translateText("Feeds")}</span>
                      </ResizableHeaderCell>
                    </>
                  ) : (
                    <></>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {columns.map((column: DataAssetColumn): ReactElement => {
                  return (
                    <tr key={column.name}>
                      <td className="py-2 pr-4 text-gray-400">
                        {column.position}
                      </td>
                      <td className="py-2 pr-4 font-mono text-gray-900">
                        {column.name}
                      </td>
                      <td className="py-2 pr-4 font-mono text-gray-700">
                        {column.dataType}
                      </td>
                      <td className="py-2 pr-4 text-gray-700">
                        {column.isNullable
                          ? translator.translateText("Yes")
                          : translator.translateText("No")}
                      </td>
                      {hasColumnLineage ? (
                        <>
                          <td className="py-2 pr-4">
                            <ColumnLinksCell
                              links={links!.comesFrom.get(column.name)}
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <ColumnLinksCell
                              links={links!.feeds.get(column.name)}
                            />
                          </td>
                        </>
                      ) : (
                        <></>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Card>
  );
};

export default TableColumnsPage;
