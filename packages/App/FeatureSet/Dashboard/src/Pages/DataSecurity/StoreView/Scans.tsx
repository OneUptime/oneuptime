import PageComponentProps from "../../PageComponentProps";
import IssueMoment from "../../../Components/DataSecurity/IssueMoment";
import {
  SCAN_KINDS,
  SCAN_KIND_ICON,
  SCAN_STATUSES,
  SCAN_STATUS_COLOR,
  ScanDetails,
  ScanReadSummary,
  formatScanDuration,
} from "../../../Components/DataSecurity/ScanDetail";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import DataSecurityScan from "Common/Models/DatabaseModels/DataSecurityScan";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * EVERY SCAN THAT READ THIS STORE, the latest first: what it read (the
 * configuration, samples of the content, or the telemetry), how it ended,
 * when it started, how much it read and what it found - and, folded under
 * its row, why it failed, what it could not read and the names of what it
 * read, never what is in them.
 *
 * The same columns, words and figures as Data Security's own Scans page
 * (Pages/DataSecurity/Scans, Components/DataSecurity/ScanDetail), without
 * the store, which is this one: the two lists wrote one scan two ways -
 * "1m" and "1 min 0 s", "2 hours ago" and the full date.
 */

const KIND_OPTIONS: Array<DropdownOption> = SCAN_KINDS.map(
  (kind: string): DropdownOption => {
    return { value: kind, label: kind };
  },
);

const STATUS_OPTIONS: Array<DropdownOption> = SCAN_STATUSES.map(
  (status: string): DropdownOption => {
    return { value: status, label: status };
  },
);

const DataStoreScans: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId } = useDataStoreViewContext();

  return (
    <ModelTable<DataSecurityScan>
      modelType={DataSecurityScan}
      id="data-store-scans-table"
      userPreferencesKey="data-store-scans-table"
      name="Scans"
      query={{ dataStoreId: dataStoreId }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      sortBy="startedAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: "Scans",
        description:
          "Every scan that read this store, the latest first: what it read, how it ended and what it found. Open a scan's details to see what it read, by name.",
      }}
      noItemsMessage="No scans have read this store yet."
      selectMoreFields={{
        errorMessage: true,
        warnings: true,
        storesRead: true,
        objectsRead: true,
        rowsRead: true,
        bytesRead: true,
      }}
      filters={[
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Dropdown,
          filterDropdownOptions: KIND_OPTIONS,
        },
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Dropdown,
          filterDropdownOptions: STATUS_OPTIONS,
        },
        {
          field: { startedAt: true },
          title: "Started",
          type: FieldType.Date,
        },
      ]}
      columns={[
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Element,
          disableSort: true,
          getElement: (scan: DataSecurityScan): ReactElement => {
            const kind: string = scan.kind || "";

            return (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-700">
                <Icon
                  icon={SCAN_KIND_ICON[kind] || IconProp.MagnifyingGlass}
                  className="h-4 w-4 text-gray-400"
                />
                <span>
                  {kind ? translator.translateText(kind) || kind : "-"}
                </span>
              </span>
            );
          },
        },
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          getElement: (scan: DataSecurityScan): ReactElement => {
            if (!scan.status) {
              return <TableEmptyValue />;
            }

            return (
              <Pill
                text={scan.status}
                color={SCAN_STATUS_COLOR[scan.status] || Gray500}
                isPulsing={scan.status === "Running"}
              />
            );
          },
        },
        {
          field: { startedAt: true },
          title: "Started",
          type: FieldType.Element,
          getElement: (scan: DataSecurityScan): ReactElement => {
            return <IssueMoment value={scan.startedAt} />;
          },
        },
        {
          field: { durationInMs: true },
          title: "Duration",
          type: FieldType.Element,
          hideOnMobile: true,
          isHiddenByDefault: true,
          getElement: (scan: DataSecurityScan): ReactElement => {
            if (scan.durationInMs === undefined || scan.durationInMs === null) {
              return <TableEmptyValue />;
            }

            return (
              <span className="whitespace-nowrap text-sm tabular-nums text-gray-700">
                {formatScanDuration(scan.durationInMs, translator.language)}
              </span>
            );
          },
        },
        {
          field: { objectsRead: true },
          title: "Read",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (scan: DataSecurityScan): ReactElement => {
            return <ScanReadSummary scan={scan} />;
          },
        },
        {
          field: { findingsFound: true },
          title: "Findings",
          type: FieldType.Element,
          getElement: (scan: DataSecurityScan): ReactElement => {
            return (
              <span className="text-sm tabular-nums text-gray-700">
                {translator.formatNumber(scan.findingsFound || 0)}
              </span>
            );
          },
        },
        {
          field: { readLog: true },
          title: "Details",
          type: FieldType.Element,
          disableSort: true,
          disableCsvExport: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-md",
          contentClassName: "min-w-[8rem]",
          getElement: (scan: DataSecurityScan): ReactElement => {
            return <ScanDetails scan={scan} />;
          },
        },
      ]}
    />
  );
};

export default DataStoreScans;
