import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { useTableViewContext } from "./TableViewContext";
import DataAssetUsage from "Common/Models/DatabaseModels/DataAssetUsage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Blue500, Purple500 } from "Common/Types/BrandColors";
import {
  DATA_ASSET_ACCESS_KINDS,
  DataAssetAccessKind,
} from "Common/Types/DataObservability/DataAssetUsage";
import OneUptimeDate from "Common/Types/Date";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

const ACCESS_OPTIONS: Array<DropdownOption> = DATA_ASSET_ACCESS_KINDS.map(
  (kind: DataAssetAccessKind): DropdownOption => {
    return {
      value: kind,
      label: kind === DataAssetAccessKind.Write ? "Writes" : "Reads",
    };
  },
);

/*
 * The services seen writing and reading the table, from their database
 * spans (TableUsageDiscovery): which statements each ran, how many calls
 * and failures in the last hour, and when it was last seen. When a table
 * stops changing, its writers are where to look first.
 */
const TableServicesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataAssetId } = useTableViewContext();

  return (
    <ModelTable<DataAssetUsage>
      modelType={DataAssetUsage}
      id="data-observability-table-services"
      name="Data Observability > Table > Services"
      userPreferencesKey="data-observability-table-services"
      query={{ dataAssetId: dataAssetId }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy="lastSeenAt"
      sortOrder={SortOrder.Descending}
      showRefreshButton={true}
      searchableFields={["serviceName"]}
      cardProps={{
        title: "Services",
        description:
          "The services seen writing and reading this table, from their database spans. Updated every 15 minutes.",
      }}
      noItemsMessage="No service has been seen using this table yet. A service sending OpenTelemetry traces shows here once its database spans name this table."
      selectMoreFields={{ serviceId: true }}
      filters={[
        {
          field: { accessKind: true },
          title: "Access",
          type: FieldType.Dropdown,
          filterDropdownOptions: ACCESS_OPTIONS,
        },
        {
          field: { serviceName: true },
          title: "Service",
          type: FieldType.Text,
        },
      ]}
      columns={[
        {
          field: { serviceName: true },
          title: "Service",
          type: FieldType.Element,
          getExportValue: (usage: DataAssetUsage): string => {
            return usage.serviceName || "";
          },
          getElement: (usage: DataAssetUsage): ReactElement => {
            if (!usage.serviceId) {
              return <span>{usage.serviceName || "-"}</span>;
            }

            return (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW] as Route,
                  { modelId: usage.serviceId },
                )}
                className="font-medium text-gray-900 hover:underline"
              >
                <span>{usage.serviceName || "-"}</span>
              </AppLink>
            );
          },
        },
        {
          field: { accessKind: true },
          title: "Access",
          type: FieldType.Element,
          getExportValue: (usage: DataAssetUsage): string => {
            return usage.accessKind || "";
          },
          getElement: (usage: DataAssetUsage): ReactElement => {
            return usage.accessKind === DataAssetAccessKind.Write ? (
              <Pill text="Writes" color={Purple500} />
            ) : (
              <Pill text="Reads" color={Blue500} />
            );
          },
        },
        {
          field: { operations: true },
          title: "Statements",
          type: FieldType.Element,
          disableSort: true,
          getExportValue: (usage: DataAssetUsage): string => {
            return (usage.operations || []).join(", ");
          },
          getElement: (usage: DataAssetUsage): ReactElement => {
            return (
              <span className="font-mono text-xs text-gray-700">
                {(usage.operations || []).join(", ") || "-"}
              </span>
            );
          },
        },
        {
          field: { callCount: true },
          title: "Calls (last hour)",
          type: FieldType.Element,
          getExportValue: (usage: DataAssetUsage): string => {
            return String(usage.callCount ?? "");
          },
          getElement: (usage: DataAssetUsage): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {translator.formatNumber(usage.callCount || 0)}
              </span>
            );
          },
        },
        {
          field: { errorCount: true },
          title: "Failed",
          type: FieldType.Element,
          getExportValue: (usage: DataAssetUsage): string => {
            return String(usage.errorCount ?? "");
          },
          getElement: (usage: DataAssetUsage): ReactElement => {
            const failed: number = usage.errorCount || 0;

            return (
              <span
                className={`whitespace-nowrap text-sm ${
                  failed > 0 ? "font-medium text-red-600" : "text-gray-700"
                }`}
              >
                {translator.formatNumber(failed)}
              </span>
            );
          },
        },
        {
          field: { lastSeenAt: true },
          title: "Last Seen",
          type: FieldType.Element,
          getExportValue: (usage: DataAssetUsage): string => {
            return usage.lastSeenAt
              ? OneUptimeDate.fromString(usage.lastSeenAt).toISOString()
              : "";
          },
          getElement: (usage: DataAssetUsage): ReactElement => {
            return (
              <span className="whitespace-nowrap text-sm text-gray-700">
                {usage.lastSeenAt
                  ? OneUptimeDate.fromNow(
                      OneUptimeDate.fromString(usage.lastSeenAt),
                    )
                  : "-"}
              </span>
            );
          },
        },
      ]}
    />
  );
};

export default TableServicesPage;
