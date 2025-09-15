import React, { FunctionComponent, ReactElement, useMemo } from "react";
import CopyableButton from "../CopyableButton/CopyableButton";
import JSONFunctions from "../../../Types/JSONFunctions";

export interface JSONTableProps {
  json: { [key: string]: any } | null | undefined;
  title?: string | undefined;
  className?: string | undefined;
  // Always flattened (dot notation) for consistency.
}

interface FlatItem { key: string; value: string }

const normalizeValue = (value: any): string => {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return "[Object]"; }
  }
  if (typeof value === "boolean") { return value ? "true" : "false"; }
  return value.toString();
};

const JSONTable: FunctionComponent<JSONTableProps> = (props: JSONTableProps): ReactElement => {
  const { json } = props;

  const flatItems: Array<FlatItem> = useMemo(() => {
    if (!json) { return []; }

    const working: { [key: string]: any } = JSONFunctions.flattenObject(
      JSONFunctions.nestJson(json),
    ) as { [key: string]: any };

    // Post-process flattened keys to group primitive arrays: prefix.0, prefix.1 => prefix: [v0, v1]
    // We ONLY group if all matching keys are simple (no deeper nesting like prefix.0.field)
    type GroupMap = { [prefix: string]: Array<{ index: number; value: any }> };
    const groupMap: GroupMap = {};
    const keys: Array<string> = Object.keys(working);

    // Track keys that should be removed after grouping
    const keysToRemove: Set<string> = new Set();

    // Helper to detect if a key has nested descendants
    const hasNestedDescendant = (k: string): boolean => {
      const descendantPrefix: string = k + "."; // e.g. arr.0.
      return keys.some((other: string) => other.startsWith(descendantPrefix));
    };

    for (const key of keys) {
      const match: RegExpMatchArray | null = key.match(/^(.*)\.(\d+)$/);
      if (!match || match.length < 3) { continue; }
      const prefix: string = match[1] as string;
      const indexStr: string = match[2] as string;
      const index: number = parseInt(indexStr, 10);

      // Skip if this index key has further nesting (e.g., arr.0.field)
      if (hasNestedDescendant(key)) { continue; }

      if (!groupMap[prefix]) {
        groupMap[prefix] = [];
      }
      groupMap[prefix].push({ index, value: working[key] });
      keysToRemove.add(key);
    }

    // Apply grouping where it makes sense (only if at least 2 items or at least 1 and prefix not already defined)
    for (const prefix in groupMap) {
      const arr: Array<{ index: number; value: any }> = groupMap[prefix] || [];
      if (arr.length === 0) { continue; }
      // Sort by numeric index
      arr.sort((a, b) => a.index - b.index);
      // Always override / set grouped array representation.
      working[prefix] = arr.map(i => i.value);
    }

    // Remove grouped index keys
    for (const k of keysToRemove) {
      delete working[k];
    }

    return Object.keys(working)
      .sort()
      .map((key: string) => ({ key, value: normalizeValue(working[key]) }));
  }, [json]);

  if (!flatItems.length) {
    return (
      <div className="border border-dashed border-gray-300 rounded-md p-4 text-sm text-gray-500 bg-gray-50">
        No attributes.
      </div>
    );
  }

  return (
    <div className={props.className}>
      {props.title && <div className="text-sm font-semibold text-gray-700 mb-2">{props.title}</div>}
      <div className="overflow-hidden border border-gray-200 rounded-md">
        <table className="min-w-full table-fixed">
          <thead>
            <tr className="bg-gray-50 text-xs uppercase tracking-wider text-left text-gray-500">
              <th className="px-3 py-2 w-1/3">Key</th>
              <th className="px-3 py-2">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {flatItems.map((item: FlatItem) => (
              <tr key={item.key} className="group hover:bg-gray-50 text-sm">
                <td className="font-mono px-3 py-2 align-top text-gray-700 break-all whitespace-pre-wrap">{item.key}</td>
                <td className="px-3 py-2 align-top break-all whitespace-pre-wrap font-mono text-gray-800">
                  <div className="flex items-start">
                    <div className="flex-1 pr-2">
                      {item.value.length > 500 ? (
                        <details>
                          <summary className="cursor-pointer select-none text-gray-600">Show value ({item.value.length} chars)</summary>
                          <pre className="mt-1 text-xs overflow-auto max-h-64">{item.value}</pre>
                        </details>
                      ) : (
                        <span>{item.value}</span>
                      )}
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <CopyableButton textToBeCopied={item.value} />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default JSONTable;
