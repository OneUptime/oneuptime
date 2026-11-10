import IconProp from "Common/Types/Icon/IconProp";
import {
  MAX_NAMING_LOOKUP_ENTRIES,
  MAX_NAMING_LOOKUP_KEY_LENGTH,
  MAX_NAMING_LOOKUP_VALUE_LENGTH,
  NamingLookupEntry,
  NamingLookupKey,
  isNamingLookupKey,
} from "Common/Types/NetworkDevice/DeviceNaming";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  NAMING_LOOKUP_KEY_EXAMPLES,
  NAMING_LOOKUP_KEY_TITLES,
  NAMING_LOOKUP_VALUE_EXAMPLE,
  ParsedNamingLookupText,
  parseNamingLookupText,
  toNamingLookupCsv,
} from "Common/Utils/NetworkDevice/Naming/NamingLookup";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

/*
 * A NAMING RULE'S LOOKUP TABLE, AS IT IS EDITED (issue #6619).
 *
 * The reporter keeps their convention in a spreadsheet: for each position in
 * a unit's subnet, the code of the device there. So the table is typed row
 * by row, pasted straight from the spreadsheet (two columns copied arrive as
 * tab-separated lines), or read from a CSV file - and saved back as one, so
 * the rule and the sheet can be kept in step. A paste adds its rows to the
 * table; a file replaces it, as opening a file does.
 *
 * Long tables show their first rows and grow on request: a table of 5,000
 * MAC addresses is 10,000 inputs, which no form should draw at once.
 */

// Rows drawn at first, and added per "Show more".
export const LOOKUP_ROWS_PER_PAGE: number = 50;

// The file a table is saved as.
export const LOOKUP_CSV_FILE_NAME: string = "naming-rule-lookup-table.csv";

export interface NamingLookupTableEditorProps {
  kind: NamingLookupKey | undefined;
  entries: Array<NamingLookupEntry>;
  onChange: (entries: Array<NamingLookupEntry>) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

/*
 * The rows a paste adds to a table: the table's rows, then the pasted ones,
 * none past the limit. A pasted row whose key is already in the table
 * replaces that row's value - pasting the sheet again updates the table.
 */
export function mergePastedRows(
  current: ReadonlyArray<NamingLookupEntry>,
  pasted: ReadonlyArray<NamingLookupEntry>,
): Array<NamingLookupEntry> {
  const merged: Array<NamingLookupEntry> = current.map(
    (entry: NamingLookupEntry): NamingLookupEntry => {
      return { ...entry };
    },
  );
  const indexByKey: Map<string, number> = new Map<string, number>();

  merged.forEach((entry: NamingLookupEntry, index: number): void => {
    indexByKey.set(entry.key.trim().toLowerCase(), index);
  });

  for (const entry of pasted) {
    const key: string = entry.key.trim().toLowerCase();
    const index: number | undefined = indexByKey.get(key);

    if (index !== undefined) {
      merged[index] = { key: merged[index]!.key, value: entry.value };
      continue;
    }

    if (merged.length >= MAX_NAMING_LOOKUP_ENTRIES) {
      break;
    }

    indexByKey.set(key, merged.length);
    merged.push({ key: entry.key, value: entry.value });
  }

  return merged;
}

// The rows a table's form value holds, read defensively.
export function readLookupRows(value: unknown): Array<NamingLookupEntry> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: Array<NamingLookupEntry> = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;

    rows.push({
      key:
        typeof record["key"] === "string" || typeof record["key"] === "number"
          ? String(record["key"])
          : "",
      value: typeof record["value"] === "string" ? record["value"] : "",
    });
  }

  return rows;
}

// The table's first value: what the rule form's example device is named with.
export function getExampleLookupValue(values: unknown): string | undefined {
  const rows: Array<NamingLookupEntry> = readLookupRows(
    (values as Record<string, unknown> | undefined)?.["lookupEntries"],
  );

  return (
    rows.find((row: NamingLookupEntry): boolean => {
      return Boolean(row.value.trim());
    })?.value || undefined
  );
}

const NamingLookupTableEditor: FunctionComponent<
  NamingLookupTableEditorProps
> = (props: NamingLookupTableEditorProps): ReactElement => {
  const translator: Translator = useTranslator();
  const fileInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const [shownRows, setShownRows] = useState<number>(LOOKUP_ROWS_PER_PAGE);
  const [isPasting, setIsPasting] = useState<boolean>(false);
  const [pastedText, setPastedText] = useState<string>("");
  const [notice, setNotice] = useState<string>("");

  const kind: NamingLookupKey = isNamingLookupKey(props.kind)
    ? props.kind
    : NamingLookupKey.LastIpOctet;
  const entries: Array<NamingLookupEntry> = props.entries;
  const keyTitle: string =
    translator.translateText(NAMING_LOOKUP_KEY_TITLES[kind]) ||
    NAMING_LOOKUP_KEY_TITLES[kind];

  const setRow: (index: number, row: NamingLookupEntry) => void = (
    index: number,
    row: NamingLookupEntry,
  ): void => {
    const next: Array<NamingLookupEntry> = [...entries];
    next[index] = row;
    props.onChange(next);
  };

  const removeRow: (index: number) => void = (index: number): void => {
    props.onChange(
      entries.filter((_entry: NamingLookupEntry, at: number): boolean => {
        return at !== index;
      }),
    );
  };

  const addRow: () => void = (): void => {
    if (entries.length >= MAX_NAMING_LOOKUP_ENTRIES) {
      return;
    }

    props.onChange([...entries, { key: "", value: "" }]);
    setShownRows(Math.max(shownRows, entries.length + 1));
  };

  const describeRead: (
    read: ParsedNamingLookupText,
    count: number,
  ) => string = (read: ParsedNamingLookupText, count: number): string => {
    const added: string = translator.translatePlural(
      {
        one: "{{count}} row read.",
        other: "{{count}} rows read.",
      },
      count,
      { count: translator.formatNumber(count) },
    );

    if (read.incompleteLines.length === 0) {
      return added;
    }

    return `${added} ${translator.translatePlural(
      {
        one: "{{count}} line had no value and was skipped.",
        other: "{{count}} lines had no value and were skipped.",
      },
      read.incompleteLines.length,
      { count: translator.formatNumber(read.incompleteLines.length) },
    )}`;
  };

  const applyPaste: () => void = (): void => {
    const read: ParsedNamingLookupText = parseNamingLookupText(
      pastedText,
      kind,
    );
    const merged: Array<NamingLookupEntry> = mergePastedRows(
      entries.filter((entry: NamingLookupEntry): boolean => {
        return Boolean(entry.key.trim() || entry.value.trim());
      }),
      read.entries,
    );

    props.onChange(merged);
    setShownRows(Math.max(LOOKUP_ROWS_PER_PAGE, Math.min(merged.length, 200)));
    setNotice(describeRead(read, read.entries.length));
    setPastedText("");
    setIsPasting(false);
  };

  const importFile: (file: File) => void = (file: File): void => {
    const reader: FileReader = new FileReader();

    reader.onload = (): void => {
      const text: string =
        typeof reader.result === "string" ? reader.result : "";
      const read: ParsedNamingLookupText = parseNamingLookupText(text, kind);
      const rows: Array<NamingLookupEntry> = read.entries.slice(
        0,
        MAX_NAMING_LOOKUP_ENTRIES + 1,
      );

      props.onChange(rows);
      setShownRows(LOOKUP_ROWS_PER_PAGE);
      setNotice(describeRead(read, rows.length));
    };

    reader.readAsText(file);
  };

  const exportFile: () => void = (): void => {
    const csv: string = toNamingLookupCsv(
      kind,
      entries.filter((entry: NamingLookupEntry): boolean => {
        return Boolean(entry.key.trim() || entry.value.trim());
      }),
    );
    const url: string = window.URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link: HTMLAnchorElement = document.createElement("a");

    link.href = url;
    link.download = LOOKUP_CSV_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const visible: Array<NamingLookupEntry> = entries.slice(0, shownRows);

  return (
    <div className="space-y-3" data-testid="naming-lookup-table-editor">
      {entries.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table
            className="min-w-full divide-y divide-gray-200 text-sm"
            aria-labelledby={props.ariaLabelledby}
          >
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="w-2/5 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  {keyTitle}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  {translator.translateText("Value")}
                </th>
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">
                    {translator.translateText("Remove")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {visible.map(
                (entry: NamingLookupEntry, index: number): ReactElement => {
                  return (
                    <tr key={index} data-testid="naming-lookup-row">
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          dir="ltr"
                          value={entry.key}
                          maxLength={MAX_NAMING_LOOKUP_KEY_LENGTH}
                          placeholder={NAMING_LOOKUP_KEY_EXAMPLES[kind]}
                          aria-label={`${keyTitle} ${index + 1}`}
                          className="block w-full rounded-md border border-gray-200 px-2 py-1 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          onChange={(
                            event: React.ChangeEvent<HTMLInputElement>,
                          ): void => {
                            setRow(index, {
                              key: event.target.value,
                              value: entry.value,
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          dir="ltr"
                          value={entry.value}
                          maxLength={MAX_NAMING_LOOKUP_VALUE_LENGTH}
                          placeholder={NAMING_LOOKUP_VALUE_EXAMPLE}
                          aria-label={`${translator.translateText("Value")} ${index + 1}`}
                          className="block w-full rounded-md border border-gray-200 px-2 py-1 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          onChange={(
                            event: React.ChangeEvent<HTMLInputElement>,
                          ): void => {
                            setRow(index, {
                              key: entry.key,
                              value: event.target.value,
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                          aria-label={translator.translateTemplate(
                            "Remove row {{row}}",
                            { row: index + 1 },
                          )}
                          data-testid="naming-lookup-remove-row"
                          onClick={(): void => {
                            removeRow(index);
                          }}
                        >
                          <Icon icon={IconProp.Trash} className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
          {entries.length > shownRows && (
            <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-center">
              <button
                type="button"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                data-testid="naming-lookup-show-more"
                onClick={(): void => {
                  setShownRows(shownRows + LOOKUP_ROWS_PER_PAGE);
                }}
              >
                {translator.translateTemplate(
                  "Show more rows ({{shown}} of {{count}} shown)",
                  {
                    shown: translator.formatNumber(shownRows),
                    count: translator.formatNumber(entries.length),
                  },
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="rounded-lg border border-dashed border-gray-300 px-4 py-5 text-center text-sm text-gray-500"
          data-testid="naming-lookup-empty"
        >
          {translator.translateTemplate(
            "No rows yet. Add one, or paste two columns from a spreadsheet: the {{key}} and the value it stands for.",
            { key: keyTitle.toLowerCase() },
          )}
        </div>
      )}

      {isPasting && (
        <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
          <label
            className="block text-sm font-medium text-gray-700"
            htmlFor="naming-lookup-paste"
          >
            {translator.translateText(
              "Paste two columns from a spreadsheet, or CSV lines",
            )}
          </label>
          <textarea
            id="naming-lookup-paste"
            dir="ltr"
            rows={6}
            value={pastedText}
            placeholder={
              [
                NAMING_LOOKUP_KEY_EXAMPLES[kind],
                NAMING_LOOKUP_VALUE_EXAMPLE,
              ].join("\t") + "\n…"
            }
            className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="naming-lookup-paste-text"
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
              setPastedText(event.target.value);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              title="Add these rows"
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              disabled={!pastedText.trim()}
              dataTestId="naming-lookup-paste-apply"
              onClick={applyPaste}
            />
            <Button
              title="Cancel"
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              onClick={(): void => {
                setPastedText("");
                setIsPasting(false);
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          title="Add row"
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          disabled={entries.length >= MAX_NAMING_LOOKUP_ENTRIES}
          dataTestId="naming-lookup-add-row"
          onClick={addRow}
        />
        {!isPasting && (
          <Button
            title="Paste rows"
            icon={IconProp.Clipboard}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="naming-lookup-paste"
            onClick={(): void => {
              setNotice("");
              setIsPasting(true);
            }}
          />
        )}
        <Button
          title="Import CSV"
          icon={IconProp.Upload}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          dataTestId="naming-lookup-import"
          onClick={(): void => {
            fileInputRef.current?.click();
          }}
        />
        <Button
          title="Export CSV"
          icon={IconProp.Download}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          disabled={entries.length === 0}
          dataTestId="naming-lookup-export"
          onClick={exportFile}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          data-testid="naming-lookup-file"
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
            const file: File | undefined = event.target.files?.[0];

            if (file) {
              importFile(file);
            }

            // The same file can be read again after it is edited.
            event.target.value = "";
          }}
        />
        {entries.length > 0 && (
          <span className="ml-auto text-xs text-gray-500">
            {translator.translatePlural(
              { one: "{{count}} row", other: "{{count}} rows" },
              entries.length,
              { count: translator.formatNumber(entries.length) },
            )}
          </span>
        )}
      </div>

      {notice && (
        <p
          className="text-sm text-gray-600"
          role="status"
          data-testid="naming-lookup-notice"
        >
          {notice}
        </p>
      )}

      {props.error && (
        <p className="text-sm text-red-600" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default NamingLookupTableEditor;
