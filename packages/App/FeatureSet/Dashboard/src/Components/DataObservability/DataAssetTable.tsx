import { formatRowCount, formatSize } from "./DataObservabilityFormat";
import FreshnessPill from "./FreshnessPill";
import OwnersCell from "../ResourceOwners/OwnersCell";
import useResourceOwners from "../ResourceOwners/useResourceOwners";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import DataAssetOwnerTeam from "Common/Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "Common/Models/DatabaseModels/DataAssetOwnerUser";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DataAssetKind, {
  DATA_ASSET_KINDS,
} from "Common/Types/DataObservability/DataAssetKind";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The dropped tables, kept with their history; or the tables still there.
  isDropped: boolean;
  // One database's tables only, on that database's own page.
  dataStoreId?: ObjectID | undefined;
}

/*
 * Each kind in words, keys of the Dashboard's locales: the Kind filter's
 * menu, its chip and the line under a table's name read them alike, in the
 * reader's language.
 */
const KIND_LABELS: Record<DataAssetKind, string> = {
  [DataAssetKind.Table]: translationKey("Table"),
  [DataAssetKind.View]: translationKey("View"),
  [DataAssetKind.MaterializedView]: translationKey("Materialized View"),
  [DataAssetKind.PartitionedTable]: translationKey("Partitioned Table"),
  [DataAssetKind.ForeignTable]: translationKey("Foreign Table"),
  [DataAssetKind.StoragePath]: translationKey("Storage Path"),
};

const KIND_OPTIONS: Array<DropdownOption> = DATA_ASSET_KINDS.map(
  (kind: DataAssetKind): DropdownOption => {
    return { value: kind, label: KIND_LABELS[kind] };
  },
);

// In the reader's language; a kind a newer server added, as it is stored.
const getKindText: (kind: DataAssetKind, translator: Translator) => string = (
  kind: DataAssetKind,
  translator: Translator,
): string => {
  const label: string = KIND_LABELS[kind] || kind;

  return translator.translateText(label) || label;
};

/*
 * The catalog: every table and view of the connected databases, with the
 * numbers people scan for - how many rows, how big, when it last changed and
 * whether that is late for it - and each name opening the table's own page.
 */
const DataAssetTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const listKey: string = props.isDropped
    ? "data-observability-dropped"
    : props.dataStoreId
      ? "data-observability-store-tables"
      : "data-observability-tables";
  const {
    onResourcesFetched,
    getOwnersForResource,
    isLoadingOwners,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<DataAsset>({
    persistKey: listKey,
    ownerUserModelType: DataAssetOwnerUser,
    ownerTeamModelType: DataAssetOwnerTeam,
    resourceIdField: "dataAssetId",
    showLabelsFacet: true,
  });

  return (
    <ModelTable<DataAsset>
      modelType={DataAsset}
      id={listKey}
      name={
        props.isDropped
          ? "Data Observability > Dropped Tables"
          : "Data Observability > Tables"
      }
      userPreferencesKey={
        props.isDropped
          ? "data-observability-dropped-tables"
          : props.dataStoreId
            ? "data-observability-store-tables"
            : "data-observability-tables"
      }
      topContent={filterBar}
      emptyState={facetEmptyState}
      currentFacetState={facetSaveState}
      onFacetStateRestored={restoreFacetState}
      query={mergeFiltersIntoQuery({
        ...(projectId ? { projectId: projectId } : {}),
        ...(props.dataStoreId ? { dataStoreId: props.dataStoreId } : {}),
        isDropped: props.isDropped,
      })}
      onFetchSuccess={(data: Array<DataAsset>) => {
        onResourcesFetched(data);
      }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      viewButtonText="View"
      onViewPage={(item: DataAsset): Promise<Route> => {
        return Promise.resolve(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.DATA_OBSERVABILITY_TABLE_VIEW] as Route,
            { modelId: item.id! },
          ),
        );
      }}
      sortBy={props.isDropped ? "droppedAt" : "assetKey"}
      sortOrder={props.isDropped ? SortOrder.Descending : SortOrder.Ascending}
      showRefreshButton={true}
      searchableFields={["assetKey", "dataStoreName"]}
      cardProps={{
        title: props.isDropped ? "Dropped Tables" : "Tables",
        description: props.isDropped
          ? "Tables that are gone from their databases. Each is kept with its history, and comes back by itself if the table does."
          : "Every table and view in your connected databases: how many rows it holds, how big it is, when it last changed, and whether that is late for it.",
      }}
      noItemsMessage={
        props.isDropped
          ? "No table has been dropped."
          : "No tables yet. Connect a database, and its tables show here within a few minutes."
      }
      selectMoreFields={{
        updateIntervalInSeconds: true,
        assetKind: true,
        dataStoreName: true,
      }}
      filters={[
        {
          field: { dataStoreName: true },
          title: "Database",
          type: FieldType.Text,
        },
        {
          field: { assetKind: true },
          title: "Kind",
          type: FieldType.Dropdown,
          filterDropdownOptions: KIND_OPTIONS,
        },
        {
          field: { lastChangedAt: true },
          title: "Last Changed",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: { assetKey: true },
          title: "Table",
          type: FieldType.Element,
          wrapContent: true,
          getExportValue: (asset: DataAsset): string => {
            return asset.assetKey || "";
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <div className="min-w-0">
                <span className="block truncate font-medium text-gray-900">
                  {asset.assetKey}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {asset.dataStoreName}
                  {asset.assetKind && asset.assetKind !== DataAssetKind.Table
                    ? ` · ${getKindText(asset.assetKind, translator)}`
                    : ""}
                </span>
              </div>
            );
          },
        },
        {
          field: { rowCount: true },
          title: "Rows",
          type: FieldType.Element,
          getExportValue: (asset: DataAsset): string => {
            return asset.rowCount === undefined || asset.rowCount === null
              ? ""
              : String(asset.rowCount);
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {formatRowCount(translator, asset.rowCount)}
              </span>
            );
          },
        },
        {
          field: { sizeInBytes: true },
          title: "Size",
          type: FieldType.Element,
          getExportValue: (asset: DataAsset): string => {
            return asset.sizeInBytes === undefined || asset.sizeInBytes === null
              ? ""
              : String(asset.sizeInBytes);
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {formatSize(asset.sizeInBytes)}
              </span>
            );
          },
        },
        {
          field: { lastChangedAt: true },
          title: "Last Changed",
          type: FieldType.Element,
          getExportValue: (asset: DataAsset): string => {
            return asset.lastChangedAt
              ? OneUptimeDate.fromString(asset.lastChangedAt).toISOString()
              : "";
          },
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {asset.lastChangedAt
                  ? OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(asset.lastChangedAt),
                    )
                  : "-"}
              </span>
            );
          },
        },
        {
          field: { assetKind: true },
          title: "Freshness",
          type: FieldType.Element,
          disableSort: true,
          getElement: (asset: DataAsset): ReactElement => {
            return (
              <FreshnessPill
                kind={asset.assetKind}
                lastChangedAt={asset.lastChangedAt}
                updateIntervalInSeconds={asset.updateIntervalInSeconds}
              />
            );
          },
        },
        {
          field: { _id: true },
          title: "Owners",
          type: FieldType.Element,
          hideOnMobile: true,
          isHiddenByDefault: true,
          getElement: (item: DataAsset): ReactElement => {
            return (
              <OwnersCell
                owners={getOwnersForResource(item)}
                isLoading={isLoadingOwners}
              />
            );
          },
        },
      ]}
    />
  );
};

export default DataAssetTable;
