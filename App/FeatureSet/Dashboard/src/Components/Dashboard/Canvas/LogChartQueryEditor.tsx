import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import {
  LogFilter,
  queryStringToFilter,
} from "Common/Types/Log/LogQueryToFilter";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import DictionaryForm from "Common/UI/Components/Dictionary/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

export interface ComponentProps {
  component: DashboardBaseComponent;
  onChange: (component: DashboardBaseComponent) => void;
}

interface LogChartArguments {
  attributeFilters?: Record<string, string | number | boolean> | undefined;
  attributeFilterQuery?: string | undefined;
}

function toFilterDictionary(
  args: LogChartArguments,
): Dictionary<DictionaryEntryValue> {
  if (args.attributeFilters !== undefined) {
    const structuredFilters: Dictionary<DictionaryEntryValue> = {};

    for (const [key, value] of Object.entries(args.attributeFilters)) {
      if (value !== undefined && value !== null) {
        structuredFilters[key] = value;
      }
    }

    return structuredFilters;
  }

  if (!args.attributeFilterQuery?.trim()) {
    return {};
  }

  const parsedFilter: LogFilter = queryStringToFilter(
    args.attributeFilterQuery.trim(),
  );
  const legacyFilters: Dictionary<DictionaryEntryValue> = {};

  for (const [key, value] of Object.entries(parsedFilter.attributes || {})) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      legacyFilters[key] = value;
    }
  }

  return legacyFilters;
}

const LogChartQueryEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const args: LogChartArguments =
    (props.component.arguments as unknown as LogChartArguments) || {};

  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [attributeKeysLoading, setAttributeKeysLoading] =
    useState<boolean>(false);
  const [valueSuggestions, setValueSuggestions] = useState<
    Record<string, Array<string>>
  >({});
  const [loadingValueKeys, setLoadingValueKeys] = useState<Array<string>>([]);
  const attributeKeysRequestedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const valueRequestSequenceRef: React.MutableRefObject<
    Record<string, number>
  > = useRef<Record<string, number>>({});
  const valueSearchTimeoutsRef: React.MutableRefObject<
    Record<string, ReturnType<typeof setTimeout>>
  > = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const initialAttributeFilterKeysRef: React.MutableRefObject<Array<string>> =
    useRef<Array<string>>(Object.keys(toFilterDictionary(args)));

  useEffect(() => {
    if (attributeKeysRequestedRef.current) {
      return;
    }
    attributeKeysRequestedRef.current = true;

    const loadAttributeKeys: () => Promise<void> = async (): Promise<void> => {
      try {
        setAttributeKeysLoading(true);
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/get-attributes",
            ),
            data: {},
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setAttributeKeys((response.data["attributes"] || []) as Array<string>);
      } catch {
        // Suggestions are best-effort; users can always type a key manually.
        attributeKeysRequestedRef.current = false;
      } finally {
        setAttributeKeysLoading(false);
      }
    };

    void loadAttributeKeys();
  }, []);

  type LoadAttributeValuesFunction = (
    attributeKey: string,
    searchText?: string | undefined,
  ) => Promise<void>;

  const loadAttributeValues: LoadAttributeValuesFunction = useCallback(
    async (
      attributeKey: string,
      searchText?: string | undefined,
    ): Promise<void> => {
      if (!attributeKey) {
        return;
      }

      const requestSequence: number =
        (valueRequestSequenceRef.current[attributeKey] || 0) + 1;
      valueRequestSequenceRef.current[attributeKey] = requestSequence;

      setLoadingValueKeys((currentKeys: Array<string>): Array<string> => {
        return currentKeys.includes(attributeKey)
          ? currentKeys
          : [...currentKeys, attributeKey];
      });

      try {
        const trimmedSearchText: string = searchText?.trim() || "";
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/get-attribute-values",
            ),
            data: {
              attributeKey,
              ...(trimmedSearchText ? { searchText: trimmedSearchText } : {}),
            },
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (valueRequestSequenceRef.current[attributeKey] !== requestSequence) {
          return;
        }

        const values: Array<string> = (response.data["values"] ||
          []) as Array<string>;
        setValueSuggestions(
          (
            currentSuggestions: Record<string, Array<string>>,
          ): Record<string, Array<string>> => {
            return { ...currentSuggestions, [attributeKey]: values };
          },
        );
      } catch {
        // Suggestions are best-effort; users can always type a value manually.
      } finally {
        if (valueRequestSequenceRef.current[attributeKey] === requestSequence) {
          setLoadingValueKeys((currentKeys: Array<string>): Array<string> => {
            return currentKeys.filter((key: string): boolean => {
              return key !== attributeKey;
            });
          });
        }
      }
    },
    [],
  );

  useEffect(() => {
    for (const attributeKey of initialAttributeFilterKeysRef.current) {
      void loadAttributeValues(attributeKey);
    }
  }, [loadAttributeValues]);

  useEffect(() => {
    return (): void => {
      for (const timeout of Object.values(valueSearchTimeoutsRef.current)) {
        clearTimeout(timeout);
      }
    };
  }, []);

  const writeAttributeFilters: (
    value: Dictionary<DictionaryEntryValue>,
  ) => void = (value: Dictionary<DictionaryEntryValue>): void => {
    const nextArguments: JSONObject = {
      ...((props.component.arguments as JSONObject) || {}),
    };

    if (Object.keys(value).length > 0) {
      nextArguments["attributeFilters"] = value as unknown as JSONObject;
    } else {
      delete nextArguments["attributeFilters"];
    }

    // Once the structured editor changes, the legacy query must not win back.
    delete nextArguments["attributeFilterQuery"];

    props.onChange({
      ...props.component,
      arguments: nextArguments,
    } as DashboardBaseComponent);
  };

  return (
    <CollapsibleSection
      title="Attribute Filters"
      description="Only include logs where every selected attribute exactly matches its value. Leave empty to include all logs."
      variant="bordered"
      defaultCollapsed={false}
    >
      <DictionaryForm
        key={`${props.component.componentId.toString()}-log-chart-attribute-filters`}
        initialValue={toFilterDictionary(args)}
        keys={attributeKeys}
        isLoadingKeys={attributeKeysLoading}
        valueSuggestions={valueSuggestions}
        loadingValueKeys={loadingValueKeys}
        addButtonSuffix="Filter"
        keyPlaceholder="attribute (e.g. deployment.environment)"
        valuePlaceholder="value"
        onKeySelected={(attributeKey: string): void => {
          void loadAttributeValues(attributeKey);
        }}
        onValueSearch={(attributeKey: string, searchText: string): void => {
          const existingTimeout: ReturnType<typeof setTimeout> | undefined =
            valueSearchTimeoutsRef.current[attributeKey];
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          valueSearchTimeoutsRef.current[attributeKey] = setTimeout(() => {
            void loadAttributeValues(attributeKey, searchText);
          }, 300);
        }}
        onChange={writeAttributeFilters}
      />
    </CollapsibleSection>
  );
};

export default LogChartQueryEditor;
