import PageComponentProps from "../../PageComponentProps";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import DataSecurityScan from "Common/Models/DatabaseModels/DataSecurityScan";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * EVERY SCAN THAT READ THIS STORE, the latest first: what it read (the
 * configuration, samples of the content, or the telemetry), how it ended,
 * how long it took, how much it sampled and what it found - and, unfolded
 * on its row, what it could not read and why. A scan names the objects and
 * tables it read, never what is in them.
 */

const SCAN_STATUS_COLOR: Readonly<Record<string, Color>> = {
  Running: Blue500,
  Succeeded: Green500,
  "Partly succeeded": Yellow500,
  Failed: Red500,
  Skipped: Gray500,
};

const SCAN_KIND_OPTIONS: Array<DropdownOption> = [
  { label: "Configuration", value: "Configuration" },
  { label: "Content", value: "Content" },
  { label: "Telemetry", value: "Telemetry" },
];

const SCAN_STATUS_OPTIONS: Array<DropdownOption> = [
  { label: "Running", value: "Running" },
  { label: "Succeeded", value: "Succeeded" },
  { label: "Partly succeeded", value: "Partly succeeded" },
  { label: "Failed", value: "Failed" },
  { label: "Skipped", value: "Skipped" },
];

const NOTHING_READ: string = translationKey("Nothing sampled");

// "1.2 s", "3 min 4 s": how long a scan took.
export function formatScanDuration(
  durationInMs: number | undefined,
  translator: Translator,
): string | undefined {
  if (typeof durationInMs !== "number" || durationInMs < 0) {
    return undefined;
  }

  if (durationInMs < 1000) {
    return translator.translateTemplate("{{count}} ms", {
      count: translator.formatNumber(Math.round(durationInMs)),
    });
  }

  const seconds: number = Math.round(durationInMs / 1000);

  if (seconds < 60) {
    return translator.translateTemplate("{{count}} s", {
      count: translator.formatNumber(seconds),
    });
  }

  return translator.translateTemplate("{{minutes}} min {{seconds}} s", {
    minutes: translator.formatNumber(Math.floor(seconds / 60)),
    seconds: translator.formatNumber(seconds % 60),
  });
}

// "4.2 MB": how much a scan read.
export function formatScanBytes(
  bytes: number | undefined,
  translator: Translator,
): string | undefined {
  if (typeof bytes !== "number" || bytes <= 0) {
    return undefined;
  }

  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let value: number = bytes;
  let unitIndex: number = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex++;
  }

  return translator.translateTemplate("{{value}} {{unit}}", {
    value: translator.formatNumber(Math.round(value * 10) / 10),
    unit: units[unitIndex] || "B",
  });
}

const ScanWarnings: FunctionComponent<{ scan: DataSecurityScan }> = (props: {
  scan: DataSecurityScan;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const warnings: Array<string> = props.scan.warnings || [];
  const errorMessage: string | undefined = props.scan.errorMessage;

  if (warnings.length === 0 && !errorMessage) {
    return <TableEmptyValue screenReaderText={translationKey("No warnings")} />;
  }

  return (
    <details className="max-w-md text-sm">
      <summary className="cursor-pointer font-medium text-amber-700 hover:text-amber-800">
        {errorMessage
          ? translator.translateText("Why it failed")
          : translator.translatePlural(
              { one: "{{count}} warning", other: "{{count}} warnings" },
              warnings.length,
            )}
      </summary>
      <div className="mt-2 space-y-1 text-gray-700">
        {errorMessage ? <p className="text-red-700">{errorMessage}</p> : <></>}
        {warnings.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((warning: string, index: number): ReactElement => {
              return <li key={`${index}-${warning}`}>{warning}</li>;
            })}
          </ul>
        ) : (
          <></>
        )}
      </div>
    </details>
  );
};

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
          "Every scan that read this store, the latest first: what it read, how it ended, how much it sampled and what it found. A scan names what it read, never what is in it.",
      }}
      noItemsMessage="No scans have read this store yet."
      selectMoreFields={{
        finishedAt: true,
        rowsRead: true,
        bytesRead: true,
        errorMessage: true,
      }}
      filters={[
        {
          field: { kind: true },
          title: "Kind",
          type: FieldType.Dropdown,
          filterDropdownOptions: SCAN_KIND_OPTIONS,
        },
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Dropdown,
          filterDropdownOptions: SCAN_STATUS_OPTIONS,
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
          getElement: (item: DataSecurityScan): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                {translator.translateText(item.kind) || "—"}
              </span>
            );
          },
        },
        {
          field: { status: true },
          title: "Status",
          type: FieldType.Element,
          getElement: (item: DataSecurityScan): ReactElement => {
            if (!item.status) {
              return <TableEmptyValue />;
            }

            return (
              <Pill
                text={item.status}
                color={SCAN_STATUS_COLOR[item.status] || Gray500}
              />
            );
          },
        },
        {
          field: { startedAt: true },
          title: "Started",
          type: FieldType.DateTime,
        },
        {
          field: { durationInMs: true },
          title: "Duration",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityScan): ReactElement => {
            const duration: string | undefined = formatScanDuration(
              item.durationInMs,
              translator,
            );

            return duration ? (
              <span className="text-sm text-gray-700">{duration}</span>
            ) : (
              <TableEmptyValue />
            );
          },
        },
        {
          field: { objectsRead: true },
          title: "Sampled",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityScan): ReactElement => {
            const lines: Array<string> = [];

            if (item.objectsRead) {
              lines.push(
                translator.translatePlural(
                  { one: "{{count}} object", other: "{{count}} objects" },
                  item.objectsRead,
                ),
              );
            }

            if (item.rowsRead) {
              lines.push(
                translator.translatePlural(
                  { one: "{{count}} row", other: "{{count}} rows" },
                  item.rowsRead,
                ),
              );
            }

            const bytes: string | undefined = formatScanBytes(
              item.bytesRead,
              translator,
            );

            if (bytes) {
              lines.push(bytes);
            }

            if (lines.length === 0) {
              return <TableEmptyValue screenReaderText={NOTHING_READ} />;
            }

            return (
              <div className="space-y-0.5 text-sm text-gray-700">
                {lines.map((line: string): ReactElement => {
                  return <div key={line}>{line}</div>;
                })}
              </div>
            );
          },
        },
        {
          field: { findingsFound: true },
          title: "Findings",
          type: FieldType.Number,
        },
        {
          field: { warnings: true },
          title: "Warnings",
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (item: DataSecurityScan): ReactElement => {
            return <ScanWarnings scan={item} />;
          },
        },
      ]}
    />
  );
};

export default DataStoreScans;
