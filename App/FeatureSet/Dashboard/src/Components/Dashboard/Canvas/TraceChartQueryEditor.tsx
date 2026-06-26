import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import DictionaryForm from "Common/UI/Components/Dictionary/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

export interface ComponentProps {
  component: DashboardBaseComponent;
  onChange: (component: DashboardBaseComponent) => void;
  /*
   * "chart" (default) splits spans into series; "table" breaks them into
   * rows. The query inputs are identical — only the group-by/limit wording
   * changes — so the trace chart and trace table widgets share this editor.
   */
  mode?: "chart" | "table" | undefined;
}

interface TraceChartArguments {
  spanNameContains?: string | undefined;
  attributeFilters?:
    | string
    | Record<string, string | number | boolean>
    | undefined;
  groupByAttribute?: string | undefined;
  topLimit?: number | undefined;
  includeChildSpans?: boolean | undefined;
}

/*
 * Built-in split dimensions the trace analytics endpoint understands as
 * top-level columns (everything else is treated as a span attribute key).
 * primaryEntityId is intentionally omitted from the picker — it's an opaque
 * internal id; widgets saved with it keep working via the "current value is
 * always an option" logic below.
 */
const SPECIAL_SPLIT_OPTIONS: Array<DropdownOption> = [
  { label: "Span Name", value: "name" },
  { label: "Status Code", value: "statusCode" },
  { label: "Span Kind", value: "kind" },
];

const SPECIAL_SPLIT_VALUES: Array<string> = SPECIAL_SPLIT_OPTIONS.map(
  (option: DropdownOption): string => {
    return String(option.value);
  },
);

// "key=value; key2=value2" (legacy storage) → key/value record.
function legacyStringToRecord(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(";")) {
    const eqIndex: number = pair.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key: string = pair.substring(0, eqIndex).trim();
    const value: string = pair.substring(eqIndex + 1).trim();
    if (key && value) {
      out[key] = value;
    }
  }
  return out;
}

/*
 * Seed the DictionaryForm from whatever shape the widget was saved with:
 * a legacy "k=v; k2=v2" string or the structured record we now write.
 */
function toFilterDictionary(
  raw: TraceChartArguments["attributeFilters"],
): Dictionary<DictionaryEntryValue> {
  if (!raw) {
    return {};
  }
  if (typeof raw === "string") {
    return legacyStringToRecord(raw) as Dictionary<DictionaryEntryValue>;
  }
  const out: Dictionary<DictionaryEntryValue> = {};
  for (const key of Object.keys(raw)) {
    const value: string | number | boolean = raw[key]!;
    if (value === undefined || value === null) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

interface FieldProps {
  title: string;
  description: string;
  children: ReactElement;
}

/*
 * Label + help text wrapper. Defined at module scope (not inside the editor)
 * so its identity is stable across re-renders — a nested component would
 * remount its children on every keystroke and drop input focus.
 */
const Field: FunctionComponent<FieldProps> = (
  props: FieldProps,
): ReactElement => {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">
        {props.title}
      </label>
      <p className="mt-1 text-xs text-gray-500">{props.description}</p>
      <div className="mt-2">{props.children}</div>
    </div>
  );
};

const TraceChartQueryEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const args: TraceChartArguments =
    (props.component.arguments as unknown as TraceChartArguments) || {};

  const isTable: boolean = props.mode === "table";

  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [attributeKeysLoading, setAttributeKeysLoading] =
    useState<boolean>(false);
  const [valueSuggestions, setValueSuggestions] = useState<
    Record<string, Array<string>>
  >({});
  const [loadingValueKeys, setLoadingValueKeys] = useState<Array<string>>([]);
  const attributeKeysRequestedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  // Span attribute keys are project-global, so load them once on mount.
  useEffect(() => {
    if (attributeKeysRequestedRef.current) {
      return;
    }
    attributeKeysRequestedRef.current = true;

    const loadKeys: () => Promise<void> = async (): Promise<void> => {
      try {
        setAttributeKeysLoading(true);
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/traces/get-attributes",
            ),
            data: {},
            headers: { ...ModelAPI.getCommonHeaders() },
          });
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        setAttributeKeys((response.data["attributes"] || []) as Array<string>);
      } catch {
        // Autocomplete is best-effort — allow a manual retry on remount.
        attributeKeysRequestedRef.current = false;
      } finally {
        setAttributeKeysLoading(false);
      }
    };

    void loadKeys();
  }, []);

  type LoadValuesFunction = (attributeKey: string) => Promise<void>;

  const loadAttributeValues: LoadValuesFunction = async (
    attributeKey: string,
  ): Promise<void> => {
    if (
      !attributeKey ||
      valueSuggestions[attributeKey] ||
      loadingValueKeys.includes(attributeKey)
    ) {
      return;
    }

    setLoadingValueKeys((prev: Array<string>): Array<string> => {
      return [...prev, attributeKey];
    });

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/traces/get-attribute-values",
          ),
          data: { attributeKey },
          headers: { ...ModelAPI.getCommonHeaders() },
        });
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
      const values: Array<string> = (response.data["values"] ||
        []) as Array<string>;
      setValueSuggestions(
        (
          prev: Record<string, Array<string>>,
        ): Record<string, Array<string>> => {
          return { ...prev, [attributeKey]: values };
        },
      );
    } catch {
      // best-effort
    } finally {
      setLoadingValueKeys((prev: Array<string>): Array<string> => {
        return prev.filter((key: string): boolean => {
          return key !== attributeKey;
        });
      });
    }
  };

  type WriteArgsFunction = (patch: Partial<TraceChartArguments>) => void;

  const writeArgs: WriteArgsFunction = (
    patch: Partial<TraceChartArguments>,
  ): void => {
    const currentArgs: JSONObject =
      (props.component.arguments as JSONObject) || {};
    const nextArgs: JSONObject = {
      ...currentArgs,
      ...(patch as unknown as JSONObject),
    };
    // Drop keys explicitly cleared so the saved widget stays tidy.
    for (const key of Object.keys(patch)) {
      if ((patch as JSONObject)[key] === undefined) {
        delete nextArgs[key];
      }
    }
    props.onChange({
      ...props.component,
      arguments: nextArgs,
    } as DashboardBaseComponent);
  };

  const currentGroupBy: string = (args.groupByAttribute || "").trim();

  const splitOptions: Array<DropdownOption> = [
    ...SPECIAL_SPLIT_OPTIONS,
    ...attributeKeys
      .filter((key: string): boolean => {
        return !SPECIAL_SPLIT_VALUES.includes(key);
      })
      .map((key: string): DropdownOption => {
        return { label: key, value: key };
      }),
  ];

  /*
   * Keep a previously-saved split value selectable even if the attribute
   * list hasn't loaded yet (or no longer reports that key).
   */
  if (
    currentGroupBy &&
    !splitOptions.some((option: DropdownOption): boolean => {
      return String(option.value) === currentGroupBy;
    })
  ) {
    splitOptions.push({ label: currentGroupBy, value: currentGroupBy });
  }

  const selectedSplitOption: DropdownOption | undefined = splitOptions.find(
    (option: DropdownOption): boolean => {
      return String(option.value) === currentGroupBy;
    },
  );

  return (
    <CollapsibleSection
      title="Query"
      description={
        isTable
          ? "Choose which spans to tabulate and which dimension to break them into rows by."
          : "Choose which spans to chart and how to split them into series."
      }
      variant="bordered"
      defaultCollapsed={false}
    >
      <div className="space-y-5">
        <Field
          title="Span name contains"
          description="Optional. Only include spans whose name contains this text."
        >
          <Input
            value={args.spanNameContains || ""}
            placeholder="/Shipment/ShipShipment"
            onChange={(value: string): void => {
              writeArgs({ spanNameContains: value.trim() ? value : undefined });
            }}
          />
        </Field>

        <Field
          title="Filter to spans"
          description="Optional. Only include spans where every attribute matches. Leave empty to include all spans."
        >
          <DictionaryForm
            key={`${props.component.componentId.toString()}-trace-filters`}
            initialValue={toFilterDictionary(args.attributeFilters)}
            keys={attributeKeys}
            isLoadingKeys={attributeKeysLoading}
            valueSuggestions={valueSuggestions}
            loadingValueKeys={loadingValueKeys}
            addButtonSuffix="Filter"
            keyPlaceholder="attribute (e.g. url.host)"
            valuePlaceholder="value"
            onKeySelected={(attributeKey: string): void => {
              void loadAttributeValues(attributeKey);
            }}
            onChange={(value: Dictionary<DictionaryEntryValue>): void => {
              const hasEntries: boolean =
                Boolean(value) && Object.keys(value).length > 0;
              writeArgs({
                attributeFilters: hasEntries
                  ? (value as unknown as Record<
                      string,
                      string | number | boolean
                    >)
                  : undefined,
              });
            }}
          />
        </Field>

        <Field
          title={isTable ? "Group rows by" : "Split into series by"}
          description={
            isTable
              ? "Required. One row per value of this dimension (e.g. span name, status, or an attribute)."
              : "Optional. Draw one line or bar per value of this dimension. Leave empty for a single series."
          }
        >
          <Dropdown
            options={splitOptions}
            isMultiSelect={false}
            value={selectedSplitOption}
            placeholder="Search attributes…"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              const next: string =
                value === null || value === undefined ? "" : String(value);
              writeArgs({ groupByAttribute: next ? next : undefined });
            }}
          />
        </Field>

        {currentGroupBy ? (
          <Field
            title={isTable ? "Max rows" : "Max series"}
            description={
              isTable
                ? "Cap on how many rows to show. Defaults to 10."
                : "Cap on how many series to show when split. Defaults to 10."
            }
          >
            <Input
              type={InputType.NUMBER}
              value={args.topLimit === undefined ? "10" : String(args.topLimit)}
              placeholder="10"
              onChange={(value: string): void => {
                const parsed: number = parseInt(value, 10);
                writeArgs({
                  topLimit:
                    value.trim() === "" || isNaN(parsed) ? undefined : parsed,
                });
              }}
            />
          </Field>
        ) : (
          <></>
        )}

        <Field
          title="Include child spans"
          description="Off by default, so counts match the traces explorer (root spans only). Turn on to count every span."
        >
          <Toggle
            value={Boolean(args.includeChildSpans)}
            onChange={(checked: boolean): void => {
              writeArgs({ includeChildSpans: checked });
            }}
          />
        </Field>
      </div>
    </CollapsibleSection>
  );
};

export default TraceChartQueryEditor;
