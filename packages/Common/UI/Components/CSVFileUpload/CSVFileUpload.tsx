import Button, { ButtonStyleType } from "../Button/Button";
import Color from "../../../Types/Color";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import { translationKey } from "../../../Types/Translator";
import useTranslator from "../../Utils/UseTranslator";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";

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
type ReadFileFunction = (file: File) => void;
type DragHandlerFunction = (event: React.DragEvent<HTMLLabelElement>) => void;

export const CSV_FILE_UPLOAD_AREA_TEST_ID: string = "csv-file-upload-area";
export const CSV_FILE_UPLOAD_ERROR_TEST_ID: string = "csv-file-upload-error";

// What the area says while a file is dragged over it.
export const CSV_DROP_HERE_TEXT: string = translationKey(
  "Drop the CSV file to upload it",
);
export const CSV_NOT_A_CSV_TEMPLATE: string = translationKey(
  "{{fileName}} is not a CSV file. Choose or drop a file that ends in .csv.",
);
export const CSV_ONE_FILE_AT_A_TIME_TEXT: string = translationKey(
  "Drop one CSV file at a time.",
);

// A file the area takes: what its own chooser offers (accept=".csv").
export const isCsvFile: (file: File) => boolean = (file: File): boolean => {
  return file.name.toLowerCase().endsWith(".csv");
};

// A drag that carries files, not text or a link dragged off the page.
const isDraggingFiles: (event: React.DragEvent<HTMLElement>) => boolean = (
  event: React.DragEvent<HTMLElement>,
): boolean => {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
};

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
  const translator: Translator = useTranslator();
  const [error, setError] = useState<string>("");
  const [parsedRows, setParsedRows] = useState<Array<CSVRow>>([]);
  const [fileName, setFileName] = useState<string>("");
  /*
   * A drag over the area lights it. dragenter and dragleave also fire for
   * every element inside it, so it counts how deep the drag is and goes
   * dark only once the drag has left the area itself.
   */
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragDepthRef: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * The element type goes in T on its own: RefObject<T> already declares
   * `current` as `T | null`, and RefObject<HTMLInputElement | null> is a
   * structurally identical but non-assignable type, rejected on the `ref`
   * prop below because RefObject is covariant in T. That mismatch is what
   * used to need a cast there.
   */
  const fileInputRef: React.RefObject<HTMLInputElement> =
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

  /*
   * One file, chosen in the file chooser or dropped on the area (#9224):
   * the same checks, the same reading, the same preview.
   */
  const readFile: ReadFileFunction = (file: File): void => {
    setError("");
    setParsedRows([]);
    setFileName("");

    if (!isCsvFile(file)) {
      setError(
        translator.translateTemplate(CSV_NOT_A_CSV_TEMPLATE, {
          fileName: file.name,
        }),
      );
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
            translator.translateTemplate(
              'Required column "{{column}}" not found in CSV headers. Found: {{found}}',
              { column: col.title, found: headerRow.join(", ") },
            ),
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
            errors.push(
              translator.translateTemplate(
                'Row {{row}}: missing required field "{{column}}"',
                { row: i, column: col.title },
              ),
            );
          }
        }

        if (hasRequiredFields) {
          dataRows.push(rowData);
        }
      }

      if (dataRows.length === 0) {
        const firstErrors: string = errors.slice(0, 3).join(". ");

        setError(
          errors.length > 3
            ? translator.translatePlural(
                {
                  one: "No valid rows found. {{errors}} and {{count}} more error.",
                  other:
                    "No valid rows found. {{errors}} and {{count}} more errors.",
                },
                errors.length - 3,
                { errors: firstErrors },
              )
            : errors.length > 0
              ? translator.translateTemplate(
                  "No valid rows found. {{errors}}",
                  {
                    errors: firstErrors,
                  },
                )
              : translator.translateText(
                  "No valid data rows found in the CSV file.",
                ) || "",
        );
        return;
      }

      if (errors.length > 0 && dataRows.length > 0) {
        // Some rows were skipped but we have valid data
        setError(
          `${translator.translatePlural(
            {
              one: "{{count}} row skipped due to missing required fields.",
              other: "{{count}} rows skipped due to missing required fields.",
            },
            errors.length,
          )} ${translator.translatePlural(
            {
              one: "{{count}} valid row found.",
              other: "{{count}} valid rows found.",
            },
            dataRows.length,
          )}`,
        );
      }

      setParsedRows(dataRows);
      props.onDataChanged(dataRows);
    };

    reader.onerror = (): void => {
      setError("Failed to read the CSV file. Please try again.");
    };

    reader.readAsText(file);
  };

  const handleFileChange: HandleFileChangeFunction = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file: File | undefined = event.target.files?.[0];

    if (file) {
      readFile(file);
    }

    // Reset the input so the same file can be re-uploaded
    event.target.value = "";
  };

  const onDragEnter: DragHandlerFunction = (
    event: React.DragEvent<HTMLLabelElement>,
  ): void => {
    if (!isDraggingFiles(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  // Without this the browser takes the drop and opens the file itself.
  const onDragOver: DragHandlerFunction = (
    event: React.DragEvent<HTMLLabelElement>,
  ): void => {
    if (!isDraggingFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave: DragHandlerFunction = (
    event: React.DragEvent<HTMLLabelElement>,
  ): void => {
    if (!isDraggingFiles(event)) {
      return;
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const onDrop: DragHandlerFunction = (
    event: React.DragEvent<HTMLLabelElement>,
  ): void => {
    if (!isDraggingFiles(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);

    const files: Array<File> = Array.from(event.dataTransfer.files || []);

    if (files.length > 1) {
      setParsedRows([]);
      setFileName("");
      setError(translator.translateText(CSV_ONE_FILE_AT_A_TIME_TEXT) || "");
      return;
    }

    if (files[0]) {
      readFile(files[0]);
    }
  };

  return (
    <div className="space-y-4 w-full">
      {props.description && (
        <p className="text-sm text-gray-500">
          {translator.translateText(props.description)}
        </p>
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
          {translator.translateText("Expected columns:")}
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
                title={translator.translateText(col.description)}
              >
                {translator.translateText(col.title)}
                {col.required && <span className="ml-1 text-red-500">*</span>}
              </span>
            );
          })}
        </div>
      </div>

      {/*
       * File upload area: a label around the file input, so a click anywhere
       * on it opens the file chooser with no code of its own, and Tab reaches
       * the input inside, whose focus rings the whole area. It was a div that
       * only a mouse could press (#9136). A file dropped on it is read as a
       * chosen one is; while one is dragged over it, it lights up and says
       * to drop it. It said "drag and drop" and took no drop at all, so the
       * browser opened the file instead (#9224).
       */}
      <label
        data-testid={CSV_FILE_UPLOAD_AREA_TEST_ID}
        data-dragging={isDragging ? "true" : undefined}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex w-full justify-center rounded-md border-2 border-dashed px-6 py-8 cursor-pointer transition focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500 ${
          isDragging
            ? "border-indigo-500 bg-indigo-50"
            : "border-gray-300 bg-white hover:border-indigo-400"
        }`}
      >
        <div className="pointer-events-none flex flex-col items-center space-y-2 text-center">
          <Icon
            icon={IconProp.File}
            className={`h-10 w-10 ${isDragging ? "text-indigo-500" : "text-gray-400"}`}
          />
          <div className="text-sm text-gray-600">
            {isDragging ? (
              <span className="font-medium text-indigo-700">
                {translator.translateText(CSV_DROP_HERE_TEXT)}
              </span>
            ) : (
              <TranslatedSentence
                template="{{upload}} or drag and drop"
                slots={{
                  upload: (
                    <span className="font-medium text-indigo-600">
                      {translator.translateText("Click to upload CSV")}
                    </span>
                  ),
                }}
              />
            )}
          </div>
          <p className="text-xs text-gray-500">
            {translator.translateText("CSV files only")}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>
      </label>

      {/* File name */}
      {fileName && !error && (
        <div className="flex items-center rounded-lg bg-green-50 p-3">
          <Icon
            className="h-5 w-5 flex-shrink-0"
            icon={IconProp.CheckCircle}
            color={new Color("#16a34a")}
          />
          <div className="ml-2 text-sm font-medium text-green-800">
            {translator.translatePlural(
              {
                one: "{{fileName}} - {{count}} row ready to import",
                other: "{{fileName}} - {{count}} rows ready to import",
              },
              parsedRows.length,
              { fileName: fileName },
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {/* Said out loud as it shows: a refused drop has no other sign. */}
      {error && (
        <div
          role="alert"
          data-testid={CSV_FILE_UPLOAD_ERROR_TEST_ID}
          className="rounded-lg bg-red-50 p-3"
        >
          <p className="text-sm text-red-700">
            {translator.translateText(error)}
          </p>
        </div>
      )}

      {/* Preview table */}
      {parsedRows.length > 0 && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-700">
            {translator.translatePlural(
              {
                one: "Preview (first {{shown}} of {{count}} row)",
                other: "Preview (first {{shown}} of {{count}} rows)",
              },
              parsedRows.length,
              { shown: Math.min(parsedRows.length, 5) },
            )}
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
                        {translator.translateText(col.title)}
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
