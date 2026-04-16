import Button, { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

export interface CSVColumn {
  key: string;
  title: string;
  required: boolean;
  description?: string | undefined;
}

export type CSVRow = Record<string, string>;

export interface ComponentProps {
  columns: Array<CSVColumn>;
  onDataChanged: (data: Array<CSVRow>) => void;
  templateFileName?: string | undefined;
  description?: string | undefined;
}

type ParseCSVFunction = (text: string) => Array<Array<string>>;
type DownloadTemplateFunction = () => void;
type HandleFileChangeFunction = (
  event: React.ChangeEvent<HTMLInputElement>,
) => void;

const parseCSV: ParseCSVFunction = (text: string): Array<Array<string>> => {
  const rows: Array<Array<string>> = [];
  let current: string = "";
  let inQuotes: boolean = false;
  let row: Array<string> = [];

  for (let i: number = 0; i < text.length; i++) {
    const char: string = text[i]!;
    const nextChar: string | undefined = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(current.trim());
      current = "";
    } else if (char === "\n" || (char === "\r" && nextChar === "\n")) {
      row.push(current.trim());
      current = "";
      if (
        row.some((cell: string) => {
          return cell.length > 0;
        })
      ) {
        rows.push(row);
      }
      row = [];
      if (char === "\r") {
        i++;
      }
    } else {
      current += char;
    }
  }

  // Push the last row
  row.push(current.trim());
  if (
    row.some((cell: string) => {
      return cell.length > 0;
    })
  ) {
    rows.push(row);
  }

  return rows;
};

const CSVFileUpload: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [parsedRows, setParsedRows] = useState<Array<CSVRow>>([]);
  const [fileName, setFileName] = useState<string>("");
  const fileInputRef: React.RefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement>(null);

  const downloadTemplate: DownloadTemplateFunction = (): void => {
    const headerRow: string = props.columns
      .map((col: CSVColumn) => {
        return col.title;
      })
      .join(",");
    const csvContent: string = headerRow + "\n";
    const blob: Blob = new Blob([csvContent], { type: "text/csv" });
    const url: string = window.URL.createObjectURL(blob);
    const a: HTMLAnchorElement = document.createElement("a");
    a.href = url;
    a.download = props.templateFileName || "template.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileChange: HandleFileChangeFunction = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    setError("");
    setParsedRows([]);
    setFileName("");

    const file: File | undefined = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file.");
      return;
    }

    setFileName(file.name);

    const reader: FileReader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>): void => {
      const text: string = (e.target?.result as string) || "";
      const rows: Array<Array<string>> = parseCSV(text);

      if (rows.length < 2) {
        setError("CSV file must have a header row and at least one data row.");
        return;
      }

      const headerRow: Array<string> = rows[0]!;

      // Map header titles to column keys
      const columnMap: Map<number, CSVColumn> = new Map();
      for (const col of props.columns) {
        const index: number = headerRow.findIndex((h: string) => {
          return h.toLowerCase() === col.title.toLowerCase();
        });
        if (index !== -1) {
          columnMap.set(index, col);
        } else if (col.required) {
          setError(
            `Required column "${col.title}" not found in CSV headers. Found: ${headerRow.join(", ")}`,
          );
          return;
        }
      }

      const dataRows: Array<CSVRow> = [];
      const errors: Array<string> = [];

      for (let i: number = 1; i < rows.length; i++) {
        const row: Array<string> = rows[i]!;
        const rowData: CSVRow = {};
        let hasRequiredFields: boolean = true;

        for (const [colIndex, col] of columnMap.entries()) {
          const value: string = row[colIndex]?.trim() || "";
          rowData[col.key] = value;

          if (col.required && !value) {
            hasRequiredFields = false;
            errors.push(`Row ${i}: missing required field "${col.title}"`);
          }
        }

        if (hasRequiredFields) {
          dataRows.push(rowData);
        }
      }

      if (dataRows.length === 0) {
        setError(
          errors.length > 0
            ? `No valid rows found. ${errors.slice(0, 3).join(". ")}${errors.length > 3 ? ` and ${errors.length - 3} more errors.` : ""}`
            : "No valid data rows found in the CSV file.",
        );
        return;
      }

      if (errors.length > 0 && dataRows.length > 0) {
        // Some rows were skipped but we have valid data
        setError(
          `${errors.length} row(s) skipped due to missing required fields. ${dataRows.length} valid row(s) found.`,
        );
      }

      setParsedRows(dataRows);
      props.onDataChanged(dataRows);
    };

    reader.onerror = (): void => {
      setError("Failed to read the CSV file. Please try again.");
    };

    reader.readAsText(file);

    // Reset the input so the same file can be re-uploaded
    event.target.value = "";
  };

  return (
    <div className="space-y-4 w-full">
      {props.description && (
        <p className="text-sm text-gray-500">{props.description}</p>
      )}

      {/* Template download */}
      <div className="flex items-center space-x-3">
        <Button
          title="Download CSV Template"
          icon={IconProp.Download}
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={downloadTemplate}
        />
      </div>

      {/* Column info */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-medium text-gray-700 mb-2">
          Expected columns:
        </p>
        <div className="flex flex-wrap gap-2">
          {props.columns.map((col: CSVColumn) => {
            return (
              <span
                key={col.key}
                className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${
                  col.required
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-gray-200 text-gray-600"
                }`}
                title={col.description}
              >
                {col.title}
                {col.required && <span className="ml-1 text-red-500">*</span>}
              </span>
            );
          })}
        </div>
      </div>

      {/* File upload area */}
      <div
        className="flex w-full justify-center rounded-md border-2 border-dashed border-gray-300 bg-white px-6 py-8 cursor-pointer hover:border-indigo-400 transition"
        onClick={() => {
          return fileInputRef.current?.click();
        }}
      >
        <div className="flex flex-col items-center space-y-2 text-center">
          <Icon icon={IconProp.File} className="h-10 w-10 text-gray-400" />
          <div className="text-sm text-gray-600">
            <span className="font-medium text-indigo-600">
              Click to upload CSV
            </span>{" "}
            or drag and drop
          </div>
          <p className="text-xs text-gray-500">CSV files only</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* File name */}
      {fileName && !error && (
        <div className="flex items-center rounded-lg bg-green-50 p-3">
          <Icon
            className="h-5 w-5 flex-shrink-0"
            icon={IconProp.CheckCircle}
            color="#16a34a"
          />
          <div className="ml-2 text-sm font-medium text-green-800">
            {fileName} - {parsedRows.length} row(s) ready to import
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Preview table */}
      {parsedRows.length > 0 && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-700">
            Preview (first {Math.min(parsedRows.length, 5)} of{" "}
            {parsedRows.length} rows)
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {props.columns.map((col: CSVColumn) => {
                    return (
                      <th
                        key={col.key}
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                      >
                        {col.title}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {parsedRows.slice(0, 5).map((row: CSVRow, i: number) => {
                  return (
                    <tr key={i}>
                      {props.columns.map((col: CSVColumn) => {
                        return (
                          <td
                            key={col.key}
                            className="px-4 py-2 text-sm text-gray-900 truncate max-w-xs"
                          >
                            {row[col.key] || ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CSVFileUpload;
