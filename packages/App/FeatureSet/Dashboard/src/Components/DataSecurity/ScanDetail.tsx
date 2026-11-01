import DataSecurityScan from "Common/Models/DatabaseModels/DataSecurityScan";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * ONE DATA SECURITY SCAN, AS ITS HISTORY SHOWS IT.
 *
 * A scan reads a store's configuration (through its cloud connection), its
 * content (samples of objects or rows), or a service's telemetry; it ends
 * Succeeded, Partly succeeded, Failed or Skipped, having read so many
 * objects, rows and bytes and made so many findings. What it read is kept
 * by name - never the contents - with what it could not read and why:
 * folded under each scan until someone opens it.
 */

// What a scan read, and how it ended: the values the server writes.
export const SCAN_KINDS: ReadonlyArray<string> = [
  translationKey("Configuration"),
  translationKey("Content"),
  translationKey("Telemetry"),
];

export const SCAN_STATUSES: ReadonlyArray<string> = [
  translationKey("Running"),
  translationKey("Succeeded"),
  translationKey("Partly succeeded"),
  translationKey("Failed"),
  translationKey("Skipped"),
];

export const SCAN_STATUS_COLOR: Readonly<Record<string, Color>> = {
  Running: Blue500,
  Succeeded: Green500,
  "Partly succeeded": Yellow500,
  Failed: Red500,
  Skipped: Gray500,
};

export const SCAN_KIND_ICON: Readonly<Record<string, IconProp>> = {
  Configuration: IconProp.Settings,
  Content: IconProp.MagnifyingGlass,
  Telemetry: IconProp.Logs,
};

const BYTE_UNITS: ReadonlyArray<string> = [
  "byte",
  "kilobyte",
  "megabyte",
  "gigabyte",
  "terabyte",
  "petabyte",
];

// Bytes as the reader's language writes them: "4.2 MB", "4,2 MB".
export function formatScanBytes(bytes: number, language: string): string {
  let value: number = Math.max(0, bytes);
  let unit: number = 0;

  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value = value / 1000;
    unit++;
  }

  const options: Intl.NumberFormatOptions = {
    style: "unit",
    unit: BYTE_UNITS[unit] || "byte",
    unitDisplay: "short",
    maximumFractionDigits: unit > 0 && value < 10 ? 1 : 0,
  };

  try {
    return new Intl.NumberFormat(language, options).format(value);
  } catch {
    return new Intl.NumberFormat(undefined, options).format(value);
  }
}

// How long a scan took: "850 ms" under a second, "2m 5s" in English after.
export function formatScanDuration(
  durationInMs: number,
  language: string,
): string {
  if (durationInMs < 1000) {
    const options: Intl.NumberFormatOptions = {
      style: "unit",
      unit: "millisecond",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    };

    try {
      return new Intl.NumberFormat(language, options).format(durationInMs);
    } catch {
      return new Intl.NumberFormat(undefined, options).format(durationInMs);
    }
  }

  return formatDurationCompactInLanguage(
    Math.round(durationInMs / 1000),
    language,
  );
}

// A JSON list of names as stored; anything else read as none.
export function readScanStrings(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item: unknown): item is string => {
    return typeof item === "string" && item.length > 0;
  });
}

const OBJECTS_READ: PluralTemplate = {
  one: "{{count}} object",
  other: "{{count}} objects",
};

const ROWS_READ: PluralTemplate = {
  one: "{{count}} row",
  other: "{{count}} rows",
};

const STORES_READ: PluralTemplate = {
  one: "{{count}} store",
  other: "{{count}} stores",
};

const WARNINGS: PluralTemplate = {
  one: "{{count}} warning",
  other: "{{count}} warnings",
};

const ITEMS_READ: PluralTemplate = {
  one: "{{count}} item read",
  other: "{{count}} items read",
};

const MORE_READ: PluralTemplate = {
  one: "And {{count}} more.",
  other: "And {{count}} more.",
};

const SHOW_DETAILS: string = translationKey("Show details");
const HIDE_DETAILS: string = translationKey("Hide details");
const WARNINGS_LABEL: string = translationKey("What it could not read");
const READ_LABEL: string = translationKey("What was read");
const ERROR_LABEL: string = translationKey("Why it failed");

// The names a scan read that its detail lists before "And 40 more."
const READ_LOG_SHOWN: number = 200;

// What a scan read, a figure a line: "12 objects", "3,400 rows", "4.2 MB".
export const ScanReadSummary: FunctionComponent<{
  scan: DataSecurityScan;
}> = (props: { scan: DataSecurityScan }): ReactElement => {
  const translator: Translator = useTranslator();
  const parts: Array<string> = [];

  if (props.scan.storesRead) {
    parts.push(translator.translatePlural(STORES_READ, props.scan.storesRead));
  }

  if (props.scan.objectsRead) {
    parts.push(
      translator.translatePlural(OBJECTS_READ, props.scan.objectsRead),
    );
  }

  if (props.scan.rowsRead) {
    parts.push(translator.translatePlural(ROWS_READ, props.scan.rowsRead));
  }

  if (props.scan.bytesRead) {
    parts.push(formatScanBytes(props.scan.bytesRead, translator.language));
  }

  if (parts.length === 0) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  /*
   * One figure a line: in a column a few words wide, figures wrapped onto
   * one line started the second with its separator ("· 6.3 MB").
   */
  return (
    <span className="flex flex-col text-sm tabular-nums text-gray-700">
      {parts.map((part: string, index: number): ReactElement => {
        return (
          <span key={index} className="whitespace-nowrap">
            {part}
          </span>
        );
      })}
    </span>
  );
};

/*
 * A scan's detail, folded: how many warnings and items read, and - once
 * opened - why it failed, what it could not read, and the names of what it
 * read.
 */
export const ScanDetails: FunctionComponent<{
  scan: DataSecurityScan;
}> = (props: { scan: DataSecurityScan }): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const warnings: Array<string> = readScanStrings(props.scan.warnings);
  const readLog: Array<string> = readScanStrings(props.scan.readLog);
  const error: string = props.scan.errorMessage || "";

  if (warnings.length === 0 && readLog.length === 0 && !error) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  const summary: Array<string> = [];

  if (warnings.length > 0) {
    summary.push(translator.translatePlural(WARNINGS, warnings.length));
  }

  if (readLog.length > 0) {
    summary.push(translator.translatePlural(ITEMS_READ, readLog.length));
  }

  return (
    <div className="min-w-[8rem]" data-testid="data-security-scan-details">
      <button
        type="button"
        aria-expanded={isOpen}
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon
          icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="h-3.5 w-3.5"
        />
        <span>
          {translator.translateText(isOpen ? HIDE_DETAILS : SHOW_DETAILS)}
        </span>
      </button>
      {!isOpen && summary.length > 0 ? (
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-gray-500">
          {summary.map((part: string, index: number): ReactElement => {
            return <span key={index}>{part}</span>;
          })}
        </div>
      ) : (
        <></>
      )}
      {isOpen ? (
        <div className="mt-2 space-y-3">
          {error ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(ERROR_LABEL)}
              </div>
              <p className="mt-1 text-sm text-red-700 [overflow-wrap:anywhere]">
                <IsolatedText text={error} />
              </p>
            </div>
          ) : (
            <></>
          )}
          {warnings.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(WARNINGS_LABEL)}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 ps-4 text-sm text-gray-700">
                {warnings.map(
                  (warning: string, index: number): ReactElement => {
                    return (
                      <li key={index} className="[overflow-wrap:anywhere]">
                        <IsolatedText text={warning} />
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}
          {readLog.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(READ_LABEL)}
              </div>
              <ul className="mt-1 max-h-60 space-y-0.5 overflow-auto font-mono text-xs text-gray-700">
                {readLog
                  .slice(0, READ_LOG_SHOWN)
                  .map((name: string, index: number): ReactElement => {
                    return (
                      <li key={index} className="[overflow-wrap:anywhere]">
                        {name}
                      </li>
                    );
                  })}
              </ul>
              {readLog.length > READ_LOG_SHOWN ? (
                <p className="mt-1 text-xs text-gray-500">
                  {translator.translatePlural(
                    MORE_READ,
                    readLog.length - READ_LOG_SHOWN,
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};
