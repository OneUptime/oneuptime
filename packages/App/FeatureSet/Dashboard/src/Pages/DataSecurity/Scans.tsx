import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import { getStoreViewRoute } from "../../Components/DataSecurity/IssueListRoute";
import IssueMoment from "../../Components/DataSecurity/IssueMoment";
import {
  SCAN_KINDS,
  SCAN_KIND_ICON,
  SCAN_STATUSES,
  SCAN_STATUS_COLOR,
  ScanDetails,
  ScanReadSummary,
  formatScanDuration,
} from "../../Components/DataSecurity/ScanDetail";
import DataSecurityScan from "Common/Models/DatabaseModels/DataSecurityScan";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

const kindOptions: Array<DropdownOption> = SCAN_KINDS.map(
  (kind: string): DropdownOption => {
    return { value: kind, label: kind };
  },
);

const statusOptions: Array<DropdownOption> = SCAN_STATUSES.map(
  (status: string): DropdownOption => {
    return { value: status, label: status };
  },
);

/*
 * Every scan Data Security ran in the project, the latest first: what it
 * read - a cloud connection's configuration, a store's content, a
 * service's telemetry - how it ended, when it started and how long it
 * took, how much it read and how many findings it made. Each scan's detail
 * is folded under it: why it failed, what it could not read, and the
 * names of what it read - never their contents.
 */
const DataSecurityScansPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <ModelTable<DataSecurityScan>
      modelType={DataSecurityScan}
      id="data-security-scans"
      name="Data Security > Scans"
      userPreferencesKey="data-security-scans"
      query={projectId ? { projectId: projectId } : {}}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      sortBy="startedAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: "Scans",
        description:
          "Every scan Data Security ran: what it read, how it ended and what it found. Open a scan's details to see what it read, by name.",
      }}
      noItemsMessage="No scans yet. Stores are scanned once a cloud is connected or a database added."
      showRefreshButton={true}
      selectMoreFields={{
        dataStoreId: true,
        cloudConnectionId: true,
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
          filterDropdownOptions: kindOptions,
        },
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Dropdown,
          filterDropdownOptions: statusOptions,
        },
        {
          field: { dataStoreId: true },
          title: "Data Store",
          type: FieldType.Entity,
          filterEntityType: DataStore,
          filterQuery: projectId ? { projectId: projectId } : {},
          filterDropdownField: { label: "name", value: "_id" },
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
          field: {
            dataStore: { name: true, kind: true },
            cloudConnection: { name: true },
          },
          title: "Store or Connection",
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-xs",
          contentClassName: "min-w-[8rem]",
          getExportValue: (scan: DataSecurityScan): string => {
            return scan.dataStore?.name || scan.cloudConnection?.name || "";
          },
          getElement: (scan: DataSecurityScan): ReactElement => {
            const storeId: string = scan.dataStoreId?.toString() || "";

            if (storeId) {
              return (
                <div className="min-w-0">
                  <AppLink
                    className="block min-w-0 text-sm font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
                    to={getStoreViewRoute(storeId)}
                  >
                    <IsolatedText text={scan.dataStore?.name || storeId} />
                  </AppLink>
                  {scan.dataStore?.kind ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateText(scan.dataStore.kind) ||
                        scan.dataStore.kind}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            }

            if (scan.cloudConnection?.name) {
              return (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-gray-900">
                  <Icon
                    icon={IconProp.Cloud}
                    className="h-4 w-4 shrink-0 text-gray-400"
                  />
                  <IsolatedText
                    text={scan.cloudConnection.name}
                    className="min-w-0 [overflow-wrap:anywhere]"
                  />
                </span>
              );
            }

            return <span className="text-sm text-gray-400">-</span>;
          },
        },
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          getElement: (scan: DataSecurityScan): ReactElement => {
            if (!scan.status) {
              return <span className="text-sm text-gray-400">-</span>;
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
              return <span className="text-sm text-gray-400">-</span>;
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
          isHiddenByDefault: true,
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
          // Show details takes 8rem: the table's 10rem floor ran it off the card.
          contentClassName: "min-w-[8rem]",
          getElement: (scan: DataSecurityScan): ReactElement => {
            return <ScanDetails scan={scan} />;
          },
        },
      ]}
    />
  );
};

export default DataSecurityScansPage;
