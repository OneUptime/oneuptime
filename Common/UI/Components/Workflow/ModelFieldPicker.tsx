import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import API from "../../Utils/API/API";
import { WORKFLOW_URL } from "../../Config";
import URL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import CheckboxElement from "../Checkbox/Checkbox";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import AlertBanner, { AlertBannerType } from "../AlertBanner/AlertBanner";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import CodeEditor from "../CodeEditor/CodeEditor";
import CodeType from "../../../Types/Code/CodeType";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A column descriptor mirrors the shape returned by the workflow
 * /model-schema/:tableName endpoint. Kept loose (the `type` field is just a
 * string for the wire format) so this UI doesn't have to import server-side
 * enums.
 */
export interface PickerColumn {
  id: string;
  title: string;
  description?: string;
  type: string;
  isRelation: boolean;
  relatedTableName?: string | undefined;
  relatedColumns?: Array<PickerColumn> | undefined;
}

interface SchemaResponse {
  tableName: string;
  columns: Array<PickerColumn>;
}

export interface ComponentProps {
  tableName: string;
  initialValue?: string | JSONObject | null | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  placeholder?: string | undefined;
  tabIndex?: number | undefined;
}

type ViewMode = "picker" | "json";

interface CompatibilityResult {
  compatible: boolean;
  reasons: Array<string>;
  parsed?: JSONObject | null;
}

/*
 * normalizeInitialValue turns the raw stored value (which may be a JSON
 * string, an already-parsed object, null, or empty) into a `{ text, parsed }`
 * pair. `parsed` is null when the text doesn't parse as a JSON object.
 */
const normalizeInitialValue: (
  value: string | JSONObject | null | undefined,
) => { text: string; parsed: JSONObject | null } = (
  value: string | JSONObject | null | undefined,
): { text: string; parsed: JSONObject | null } => {
  if (value === null || value === undefined || value === "") {
    return { text: "", parsed: null };
  }

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { text: value, parsed: parsed as JSONObject };
      }
      return { text: value, parsed: null };
    } catch {
      return { text: value, parsed: null };
    }
  }

  // Already an object.
  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      text: JSON.stringify(value, null, 2),
      parsed: value as JSONObject,
    };
  }

  return { text: String(value), parsed: null };
};

/*
 * Decide whether an existing select value can be represented by the picker.
 * Returns a list of human-readable reasons when not — we surface those in a
 * banner so the user understands why we're keeping their JSON as-is.
 */
const classifyCompatibility: (
  text: string,
  parsed: JSONObject | null,
  columns: Array<PickerColumn>,
) => CompatibilityResult = (
  text: string,
  parsed: JSONObject | null,
  columns: Array<PickerColumn>,
): CompatibilityResult => {
  // Empty value: picker can represent it (as nothing selected).
  if (text.trim() === "" || parsed === null) {
    if (text.trim() === "") {
      return { compatible: true, reasons: [], parsed: {} };
    }
    return {
      compatible: false,
      reasons: ["The current value isn't valid JSON."],
      parsed: null,
    };
  }

  const reasons: Array<string> = [];
  const columnsById: { [key: string]: PickerColumn } = {};
  for (const c of columns) {
    columnsById[c.id] = c;
  }

  for (const key of Object.keys(parsed)) {
    const column: PickerColumn | undefined = columnsById[key];

    if (!column) {
      reasons.push(`"${key}" isn't a readable field on this model.`);
      continue;
    }

    const value: unknown = parsed[key];

    if (column.isRelation) {
      if (value === true) {
        /*
         * The picker requires at least one sub-field for a relation. Hidden in
         * the picker UI on purpose.
         */
        reasons.push(
          `"${key}" selects the whole relation. The picker requires you to pick specific sub-fields.`,
        );
        continue;
      }

      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        reasons.push(`"${key}" has an unexpected value.`);
        continue;
      }

      const subColumnsById: { [k: string]: PickerColumn } = {};
      for (const sub of column.relatedColumns || []) {
        subColumnsById[sub.id] = sub;
      }

      for (const subKey of Object.keys(value as JSONObject)) {
        const subValue: unknown = (value as JSONObject)[subKey];
        const subColumn: PickerColumn | undefined = subColumnsById[subKey];

        if (!subColumn) {
          reasons.push(
            `"${key}.${subKey}" isn't a readable field on the related model.`,
          );
          continue;
        }

        if (subColumn.isRelation) {
          reasons.push(
            `"${key}.${subKey}" is nested more than one level deep.`,
          );
          continue;
        }

        if (typeof subValue !== "boolean") {
          if (typeof subValue === "object" && subValue !== null) {
            reasons.push(
              `"${key}.${subKey}" is nested more than one level deep.`,
            );
          } else {
            reasons.push(`"${key}.${subKey}" has an unexpected value.`);
          }
        }
      }
      continue;
    }

    // Scalar column.
    if (typeof value !== "boolean") {
      reasons.push(`"${key}" has an unexpected value.`);
    }
  }

  return {
    compatible: reasons.length === 0,
    reasons,
    parsed,
  };
};

/*
 * Convert the picker's checkbox state into the JSON object that goes back
 * into the workflow argument. Empty selections collapse to an empty string
 * (rather than "{}") so existing "required" validation continues to work.
 */
const buildSelectJson: (
  scalarChecks: Set<string>,
  relationChecks: { [relation: string]: Set<string> },
) => string = (
  scalarChecks: Set<string>,
  relationChecks: { [relation: string]: Set<string> },
): string => {
  const out: JSONObject = {};

  for (const id of scalarChecks) {
    out[id] = true;
  }

  for (const relation of Object.keys(relationChecks)) {
    const set: Set<string> | undefined = relationChecks[relation];
    if (!set || set.size === 0) {
      continue;
    }
    const subObj: JSONObject = {};
    for (const subId of set) {
      subObj[subId] = true;
    }
    out[relation] = subObj;
  }

  if (Object.keys(out).length === 0) {
    return "";
  }

  return JSON.stringify(out);
};

const ModelFieldPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [columns, setColumns] = useState<Array<PickerColumn> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const initial: { text: string; parsed: JSONObject | null } = useMemo(() => {
    return normalizeInitialValue(props.initialValue);
  }, []);

  const [jsonText, setJsonText] = useState<string>(initial.text);
  const [viewMode, setViewMode] = useState<ViewMode>("picker");
  const [incompatibilityReasons, setIncompatibilityReasons] = useState<
    Array<string>
  >([]);
  const [isLockedToJson, setIsLockedToJson] = useState<boolean>(false);

  // Checkbox state for picker mode.
  const [scalarChecks, setScalarChecks] = useState<Set<string>>(new Set());
  const [relationChecks, setRelationChecks] = useState<{
    [relation: string]: Set<string>;
  }>({});
  const [expandedRelations, setExpandedRelations] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Avoid re-emitting onChange for the initial value (preserves byte-for-byte).
  const hasInitializedFromColumns: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    let cancelled: boolean = false;

    const loadSchema: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const url: URL = URL.fromString(WORKFLOW_URL.toString()).addRoute(
          `/model-schema/${encodeURIComponent(props.tableName)}`,
        );
        const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({ url });

        if (cancelled) {
          return;
        }

        if (result instanceof HTTPErrorResponse) {
          throw result;
        }

        const data: SchemaResponse = result.data as unknown as SchemaResponse;
        setColumns(data.columns || []);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setLoadError(API.getFriendlyMessage(err));
        setColumns([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSchema();

    return () => {
      cancelled = true;
    };
  }, [props.tableName]);

  /*
   * Apply a classification result to picker state: either seed the checkboxes
   * (compatible) or lock the editor to JSON mode with reasons (incompatible).
   */
  const applyClassification: (
    result: CompatibilityResult,
    cols: Array<PickerColumn>,
  ) => void = (
    result: CompatibilityResult,
    cols: Array<PickerColumn>,
  ): void => {
    if (!result.compatible) {
      setIncompatibilityReasons(result.reasons);
      setIsLockedToJson(true);
      setViewMode("json");
      return;
    }

    const parsed: JSONObject = (result.parsed as JSONObject) || {};
    const nextScalars: Set<string> = new Set();
    const nextRelations: { [relation: string]: Set<string> } = {};
    const nextExpanded: Set<string> = new Set();

    const columnsById: { [k: string]: PickerColumn } = {};
    for (const c of cols) {
      columnsById[c.id] = c;
    }

    for (const key of Object.keys(parsed)) {
      const column: PickerColumn | undefined = columnsById[key];
      if (!column) {
        continue;
      }
      if (column.isRelation) {
        const sub: JSONObject = (parsed[key] as JSONObject) || {};
        const set: Set<string> = new Set();
        for (const subKey of Object.keys(sub)) {
          if (sub[subKey] === true) {
            set.add(subKey);
          }
        }
        if (set.size > 0) {
          nextRelations[key] = set;
          nextExpanded.add(key);
        }
      } else if (parsed[key] === true) {
        nextScalars.add(key);
      }
    }

    setScalarChecks(nextScalars);
    setRelationChecks(nextRelations);
    setExpandedRelations(nextExpanded);
    setIncompatibilityReasons([]);
    setIsLockedToJson(false);
    setViewMode("picker");
  };

  // Once we have columns, classify the initial value and seed picker state.
  useEffect(() => {
    if (columns === null) {
      return;
    }
    if (hasInitializedFromColumns.current) {
      return;
    }
    hasInitializedFromColumns.current = true;

    const result: CompatibilityResult = classifyCompatibility(
      initial.text,
      initial.parsed,
      columns,
    );

    applyClassification(result, columns);
  }, [columns, initial.text, initial.parsed]);

  // When the picker emits, push JSON upward.
  const emitFromPicker: (
    scalars: Set<string>,
    relations: { [k: string]: Set<string> },
  ) => void = (
    scalars: Set<string>,
    relations: { [k: string]: Set<string> },
  ): void => {
    const next: string = buildSelectJson(scalars, relations);
    setJsonText(next);
    props.onChange(next);
  };

  const toggleScalar: (id: string) => void = (id: string): void => {
    const next: Set<string> = new Set(scalarChecks);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setScalarChecks(next);
    emitFromPicker(next, relationChecks);
  };

  const toggleRelationField: (relation: string, sub: string) => void = (
    relation: string,
    sub: string,
  ): void => {
    const existing: Set<string> = new Set(relationChecks[relation] || []);
    if (existing.has(sub)) {
      existing.delete(sub);
    } else {
      existing.add(sub);
    }
    const next: { [k: string]: Set<string> } = { ...relationChecks };
    if (existing.size === 0) {
      delete next[relation];
    } else {
      next[relation] = existing;
    }
    setRelationChecks(next);
    emitFromPicker(scalarChecks, next);
  };

  const toggleExpand: (relation: string) => void = (relation: string): void => {
    const next: Set<string> = new Set(expandedRelations);
    if (next.has(relation)) {
      next.delete(relation);
    } else {
      next.add(relation);
    }
    setExpandedRelations(next);
  };

  /*
   * Select-all / clear helpers operate on whatever's currently visible so
   * the actions feel scoped to what the user can see.
   */
  const setScalarSelection: (ids: Array<string>) => void = (
    ids: Array<string>,
  ): void => {
    const next: Set<string> = new Set(ids);
    setScalarChecks(next);
    emitFromPicker(next, relationChecks);
  };

  const setRelationSelection: (relation: string, ids: Array<string>) => void = (
    relation: string,
    ids: Array<string>,
  ): void => {
    const next: { [k: string]: Set<string> } = { ...relationChecks };
    if (ids.length === 0) {
      delete next[relation];
    } else {
      next[relation] = new Set(ids);
    }
    setRelationChecks(next);
    emitFromPicker(scalarChecks, next);
  };

  const expandRelation: (relation: string) => void = (
    relation: string,
  ): void => {
    if (expandedRelations.has(relation)) {
      return;
    }
    const next: Set<string> = new Set(expandedRelations);
    next.add(relation);
    setExpandedRelations(next);
  };

  const onSearchChange: (value: string) => void = (value: string): void => {
    setSearchQuery(value);
  };

  /*
   * Friendly type-pill label. Returns null for plain text-like columns so the
   * common case stays uncluttered.
   */
  const getTypeLabel: (type: string) => string | null = (
    type: string,
  ): string | null => {
    const map: { [k: string]: string } = {
      Date: "Date",
      Boolean: "Yes / No",
      Number: "Number",
      "Big Number": "Number",
      "Small Number": "Number",
      "Positive Number": "Number",
      "Small Positive Number": "Number",
      "Big Positive Number": "Number",
      "Object ID": "ID",
      Slug: "Slug",
      URL: "URL",
      Email: "Email",
      Phone: "Phone",
      IP: "IP",
      Port: "Port",
      Color: "Color",
      JSON: "JSON",
      Markdown: "Markdown",
      HTML: "HTML",
      "Entity Array": "List",
    };
    return map[type] || null;
  };

  const matchesQuery: (column: PickerColumn, query: string) => boolean = (
    column: PickerColumn,
    query: string,
  ): boolean => {
    if (!query) {
      return true;
    }
    return (
      column.title.toLowerCase().includes(query) ||
      column.id.toLowerCase().includes(query) ||
      (column.description || "").toLowerCase().includes(query)
    );
  };

  const onJsonChange: (next: string) => void = (next: string): void => {
    setJsonText(next);
    props.onChange(next);
  };

  const resetToPicker: () => void = (): void => {
    setIncompatibilityReasons([]);
    setIsLockedToJson(false);
    setScalarChecks(new Set());
    setRelationChecks({});
    setExpandedRelations(new Set());
    setJsonText("");
    props.onChange("");
    setViewMode("picker");
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <ComponentLoader />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-2">
        <AlertBanner
          title="Could not load fields"
          type={AlertBannerType.Danger}
        >
          <p className="text-sm text-gray-700">{loadError}</p>
        </AlertBanner>
        <CodeEditor
          type={CodeType.JSON}
          value={jsonText}
          onChange={onJsonChange}
          placeholder={props.placeholder}
          error={props.error}
        />
      </div>
    );
  }

  const scalarColumns: Array<PickerColumn> = (columns || []).filter(
    (c: PickerColumn) => {
      return !c.isRelation;
    },
  );
  const relationColumns: Array<PickerColumn> = (columns || []).filter(
    (c: PickerColumn) => {
      return c.isRelation;
    },
  );

  const totalSelected: number =
    scalarChecks.size +
    Object.values(relationChecks).reduce((acc: number, s: Set<string>) => {
      return acc + s.size;
    }, 0);

  const totalAvailable: number =
    scalarColumns.length +
    relationColumns.reduce((acc: number, r: PickerColumn) => {
      return acc + (r.relatedColumns?.length || 0);
    }, 0);

  const onUsePickerClicked: () => void = (): void => {
    if (!columns) {
      return;
    }
    // Re-classify the current JSON text — the user may have edited it.
    const norm: { text: string; parsed: JSONObject | null } =
      normalizeInitialValue(jsonText);
    const result: CompatibilityResult = classifyCompatibility(
      norm.text,
      norm.parsed,
      columns,
    );
    applyClassification(result, columns);
  };

  /*
   * Apply search filter. For relations, the relation passes if its own title
   * matches OR any sub-field matches; in the latter case we auto-expand it so
   * the matching child is visible.
   */
  const query: string = searchQuery.trim().toLowerCase();
  const visibleScalars: Array<PickerColumn> = scalarColumns.filter(
    (c: PickerColumn) => {
      return matchesQuery(c, query);
    },
  );

  const visibleRelations: Array<{
    column: PickerColumn;
    visibleSubs: Array<PickerColumn>;
    matchedByChild: boolean;
  }> = relationColumns
    .map((column: PickerColumn) => {
      const subMatches: Array<PickerColumn> = (
        column.relatedColumns || []
      ).filter((sub: PickerColumn) => {
        return matchesQuery(sub, query);
      });
      const matchesSelf: boolean = matchesQuery(column, query);
      if (query && !matchesSelf && subMatches.length === 0) {
        return null;
      }
      return {
        column,
        visibleSubs:
          query && !matchesSelf ? subMatches : column.relatedColumns || [],
        matchedByChild:
          query.length > 0 && !matchesSelf && subMatches.length > 0,
      };
    })
    .filter(
      (
        x: {
          column: PickerColumn;
          visibleSubs: Array<PickerColumn>;
          matchedByChild: boolean;
        } | null,
      ): x is {
        column: PickerColumn;
        visibleSubs: Array<PickerColumn>;
        matchedByChild: boolean;
      } => {
        return x !== null;
      },
    );

  const hasNoVisibleResults: boolean =
    visibleScalars.length === 0 && visibleRelations.length === 0;

  const viewToggleButton: ReactElement | null = !isLockedToJson ? (
    <Button
      title={viewMode === "picker" ? "Edit as JSON" : "Use picker"}
      buttonStyle={ButtonStyleType.OUTLINE}
      buttonSize={ButtonSize.Small}
      icon={viewMode === "picker" ? IconProp.Code : IconProp.ListBullet}
      onClick={() => {
        if (viewMode === "picker") {
          setViewMode("json");
        } else {
          onUsePickerClicked();
        }
      }}
    />
  ) : (
    <Button
      title="Reset to picker"
      buttonStyle={ButtonStyleType.OUTLINE}
      buttonSize={ButtonSize.Small}
      onClick={resetToPicker}
    />
  );

  const selectAllScalars: () => void = (): void => {
    const ids: Array<string> = visibleScalars.map((c: PickerColumn) => {
      return c.id;
    });
    // Merge with existing so out-of-view (filtered) selections aren't lost.
    const merged: Set<string> = new Set(scalarChecks);
    for (const id of ids) {
      merged.add(id);
    }
    setScalarSelection(Array.from(merged));
  };

  const clearAllScalars: () => void = (): void => {
    // Only clear what's visible — preserves selections hidden by search.
    const next: Set<string> = new Set(scalarChecks);
    for (const c of visibleScalars) {
      next.delete(c.id);
    }
    setScalarSelection(Array.from(next));
  };

  return (
    <div className="space-y-3">
      {/* Header: count + search + view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
              totalSelected > 0
                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                : "bg-gray-50 border-gray-200 text-gray-600"
            }`}
          >
            <span className="font-semibold">{totalSelected}</span>
            <span className="text-current opacity-75">
              of {totalAvailable} selected
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === "picker" && !isLockedToJson && totalAvailable > 0 && (
            <div className="relative flex-1 sm:flex-none">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                <Icon
                  icon={IconProp.Search}
                  className="h-4 w-4 text-gray-400"
                />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  return onSearchChange(e.target.value);
                }}
                placeholder="Search fields"
                className="block w-full sm:w-56 rounded-md border border-gray-300 bg-white pl-8 pr-7 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    return setSearchQuery("");
                  }}
                  className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {viewToggleButton}
        </div>
      </div>

      {/* Incompatibility banner */}
      {isLockedToJson && (
        <AlertBanner
          title="Keeping your existing selection as JSON"
          type={AlertBannerType.Warning}
        >
          <div className="space-y-1 text-sm text-gray-700">
            <p>
              We could not show this in the picker for the following reason
              {incompatibilityReasons.length === 1 ? "" : "s"}:
            </p>
            <ul className="list-disc pl-5">
              {incompatibilityReasons.map((reason: string, i: number) => {
                return <li key={i}>{reason}</li>;
              })}
            </ul>
            <p className="pt-1 text-gray-500">
              Your workflow will keep running as-is. Edit the JSON below, or use{" "}
              <strong>Reset to picker</strong> to start fresh.
            </p>
          </div>
        </AlertBanner>
      )}

      {/* JSON editor */}
      {viewMode === "json" && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <CodeEditor
            type={CodeType.JSON}
            value={jsonText}
            onChange={onJsonChange}
            placeholder={
              props.placeholder || 'Example: {"columnName": true, ...}'
            }
            error={props.error}
            tabIndex={props.tabIndex}
          />
        </div>
      )}

      {/* Picker */}
      {viewMode === "picker" && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm">
          {totalAvailable === 0 && (
            <div className="p-6 text-center text-sm text-gray-500">
              No readable fields are available for this model.
            </div>
          )}

          {totalAvailable > 0 && hasNoVisibleResults && (
            <div className="p-6 text-center">
              <p className="text-sm text-gray-600">
                No fields match{" "}
                <span className="font-medium text-gray-900">
                  &ldquo;{searchQuery}&rdquo;
                </span>
              </p>
              <button
                type="button"
                onClick={() => {
                  return setSearchQuery("");
                }}
                className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                Clear search
              </button>
            </div>
          )}

          {visibleScalars.length > 0 && (
            <section className="px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Fields
                </h3>
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={selectAllScalars}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Select all
                  </button>
                  <span className="text-gray-300">·</span>
                  <button
                    type="button"
                    onClick={clearAllScalars}
                    className="font-medium text-gray-500 hover:text-gray-700"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-6">
                {visibleScalars.map((column: PickerColumn) => {
                  const checked: boolean = scalarChecks.has(column.id);
                  const typeLabel: string | null = getTypeLabel(column.type);
                  return (
                    <label
                      key={column.id}
                      className={`group flex items-start gap-2.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                        checked ? "bg-indigo-50/50" : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          return toggleScalar(column.id);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-sm font-medium ${
                              checked ? "text-indigo-900" : "text-gray-900"
                            }`}
                          >
                            {column.title}
                          </span>
                          {typeLabel && (
                            <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 leading-none">
                              {typeLabel}
                            </span>
                          )}
                        </span>
                        {column.description && (
                          <span className="block text-xs text-gray-500 line-clamp-2">
                            {column.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {visibleScalars.length > 0 && visibleRelations.length > 0 && (
            <div className="border-t border-gray-100" />
          )}

          {visibleRelations.length > 0 && (
            <section className="px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Related records
                </h3>
                <span className="text-[10px] text-gray-400">1 level deep</span>
              </div>
              <div className="space-y-2">
                {visibleRelations.map(
                  (entry: {
                    column: PickerColumn;
                    visibleSubs: Array<PickerColumn>;
                    matchedByChild: boolean;
                  }) => {
                    const column: PickerColumn = entry.column;
                    const visibleSubs: Array<PickerColumn> = entry.visibleSubs;
                    const totalSubs: number = (column.relatedColumns || [])
                      .length;
                    const selectedSubs: Set<string> =
                      relationChecks[column.id] || new Set();
                    const isExpanded: boolean =
                      expandedRelations.has(column.id) || entry.matchedByChild;
                    const allChecked: boolean =
                      totalSubs > 0 && selectedSubs.size === totalSubs;
                    const someChecked: boolean =
                      selectedSubs.size > 0 && !allChecked;

                    const toggleAllSubs: () => void = (): void => {
                      if (allChecked) {
                        setRelationSelection(column.id, []);
                      } else {
                        const ids: Array<string> = (
                          column.relatedColumns || []
                        ).map((s: PickerColumn) => {
                          return s.id;
                        });
                        setRelationSelection(column.id, ids);
                        expandRelation(column.id);
                      }
                    };

                    return (
                      <div
                        key={column.id}
                        className={`rounded-lg border transition-shadow ${
                          isExpanded
                            ? "border-gray-300 shadow-sm"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div
                          className={`flex items-center gap-3 px-3 py-2.5 ${
                            isExpanded
                              ? "border-b border-gray-200 bg-gray-50"
                              : ""
                          }`}
                        >
                          <CheckboxElement
                            value={allChecked}
                            isIndeterminate={someChecked}
                            onChange={toggleAllSubs}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              return toggleExpand(column.id);
                            }}
                            className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
                          >
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-gray-900 truncate">
                                {column.title}
                              </span>
                              {column.description && (
                                <span className="block text-xs text-gray-500 truncate">
                                  {column.description}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-2 flex-shrink-0">
                              {selectedSubs.size > 0 ? (
                                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 border border-indigo-100">
                                  {selectedSubs.size} of {totalSubs}
                                </span>
                              ) : (
                                <span className="text-[11px] text-gray-400">
                                  {totalSubs} field{totalSubs === 1 ? "" : "s"}
                                </span>
                              )}
                              <Icon
                                icon={
                                  isExpanded
                                    ? IconProp.ChevronDown
                                    : IconProp.ChevronRight
                                }
                                className="h-4 w-4 text-gray-400"
                              />
                            </span>
                          </button>
                        </div>
                        {isExpanded && (
                          <div className="px-3 py-3">
                            <div className="flex items-center justify-between mb-2 text-xs">
                              <span className="text-gray-400">
                                {column.relatedTableName
                                  ? `From ${column.relatedTableName}`
                                  : "Sub-fields"}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const ids: Array<string> = visibleSubs.map(
                                      (s: PickerColumn) => {
                                        return s.id;
                                      },
                                    );
                                    const merged: Set<string> = new Set(
                                      selectedSubs,
                                    );
                                    for (const id of ids) {
                                      merged.add(id);
                                    }
                                    setRelationSelection(
                                      column.id,
                                      Array.from(merged),
                                    );
                                  }}
                                  className="font-medium text-indigo-600 hover:text-indigo-800"
                                >
                                  Select all
                                </button>
                                <span className="text-gray-300">·</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next: Set<string> = new Set(
                                      selectedSubs,
                                    );
                                    for (const s of visibleSubs) {
                                      next.delete(s.id);
                                    }
                                    setRelationSelection(
                                      column.id,
                                      Array.from(next),
                                    );
                                  }}
                                  className="font-medium text-gray-500 hover:text-gray-700"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                              {visibleSubs.map((sub: PickerColumn) => {
                                const subChecked: boolean = selectedSubs.has(
                                  sub.id,
                                );
                                const subTypeLabel: string | null =
                                  getTypeLabel(sub.type);
                                return (
                                  <label
                                    key={sub.id}
                                    className={`group flex items-start gap-2.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                                      subChecked
                                        ? "bg-indigo-50/50"
                                        : "hover:bg-gray-50"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={subChecked}
                                      onChange={() => {
                                        return toggleRelationField(
                                          column.id,
                                          sub.id,
                                        );
                                      }}
                                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="flex-1 min-w-0">
                                      <span className="flex items-center gap-1.5 flex-wrap">
                                        <span
                                          className={`text-sm font-medium ${
                                            subChecked
                                              ? "text-indigo-900"
                                              : "text-gray-900"
                                          }`}
                                        >
                                          {sub.title}
                                        </span>
                                        {subTypeLabel && (
                                          <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 leading-none">
                                            {subTypeLabel}
                                          </span>
                                        )}
                                      </span>
                                      {sub.description && (
                                        <span className="block text-xs text-gray-500 line-clamp-2">
                                          {sub.description}
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {props.error && (
        <p className="text-sm text-red-500" data-testid="error-message">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default ModelFieldPicker;
