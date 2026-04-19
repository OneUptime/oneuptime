import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import FilterConditionElement from "./FilterCondition";
import {
  FilterBuilderConfig,
  FilterConditionData,
  LogicalConnector,
} from "./Types";
import {
  buildFilterQuery,
  parseFilterQuery,
} from "./FilterQueryParser";

export interface ComponentProps {
  value?: string | undefined;
  initialValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  error?: string | undefined;
  config: FilterBuilderConfig;
}

const FilterQueryBuilderField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { config } = props;

  const initial: string = props.value ?? props.initialValue ?? "";
  const initialParsed: {
    conditions: Array<FilterConditionData>;
    connector: LogicalConnector;
  } = parseFilterQuery(initial, config);

  const [conditions, setConditions] = useState<Array<FilterConditionData>>(
    initialParsed.conditions,
  );
  const [connector, setConnector] = useState<LogicalConnector>(
    initialParsed.connector,
  );

  const lastEmitted: React.MutableRefObject<string> = useRef<string>(initial);

  useEffect(() => {
    if (props.value === undefined) {
      return;
    }
    if (props.value === lastEmitted.current) {
      return;
    }
    const reparsed: {
      conditions: Array<FilterConditionData>;
      connector: LogicalConnector;
    } = parseFilterQuery(props.value, config);
    setConditions(reparsed.conditions);
    setConnector(reparsed.connector);
    lastEmitted.current = props.value;
  }, [props.value, config]);

  const emit: (
    nextConditions: Array<FilterConditionData>,
    nextConnector: LogicalConnector,
  ) => void = (
    nextConditions: Array<FilterConditionData>,
    nextConnector: LogicalConnector,
  ): void => {
    const query: string = buildFilterQuery(
      nextConditions,
      nextConnector,
      config,
    );
    lastEmitted.current = query;
    if (props.onChange) {
      props.onChange(query);
    }
  };

  const handleConditionsChange: (
    next: Array<FilterConditionData>,
  ) => void = (next: Array<FilterConditionData>): void => {
    setConditions(next);
    emit(next, connector);
  };

  const handleConnectorChange: (next: LogicalConnector) => void = (
    next: LogicalConnector,
  ): void => {
    setConnector(next);
    emit(conditions, next);
  };

  const previewQuery: string = buildFilterQuery(conditions, connector, config);

  return (
    <div>
      {/* Connector toggle */}
      {conditions.length > 1 && (
        <div className="mb-3 flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {config.entityNameSingular.charAt(0).toUpperCase() +
              config.entityNameSingular.slice(1)}{" "}
            must match
          </span>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            <button
              type="button"
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                connector === "AND"
                  ? "bg-white text-indigo-700 shadow-sm ring-1 ring-black/5"
                  : "text-gray-400 hover:text-gray-600"
              }`}
              onClick={() => {
                handleConnectorChange("AND");
              }}
            >
              All conditions
            </button>
            <button
              type="button"
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                connector === "OR"
                  ? "bg-white text-amber-700 shadow-sm ring-1 ring-black/5"
                  : "text-gray-400 hover:text-gray-600"
              }`}
              onClick={() => {
                handleConnectorChange("OR");
              }}
            >
              Any condition
            </button>
          </div>
        </div>
      )}

      {/* Conditions with timeline */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 pt-2">
          {conditions.map(
            (condition: FilterConditionData, index: number): ReactElement => {
              return (
                <FilterConditionElement
                  key={index}
                  condition={condition}
                  canDelete={conditions.length > 1}
                  index={index}
                  connector={connector}
                  isLast={index === conditions.length - 1}
                  config={config}
                  onChange={(updated: FilterConditionData) => {
                    const next: Array<FilterConditionData> = [...conditions];
                    next[index] = updated;
                    handleConditionsChange(next);
                  }}
                  onDelete={() => {
                    const next: Array<FilterConditionData> = conditions.filter(
                      (_: FilterConditionData, i: number): boolean => {
                        return i !== index;
                      },
                    );
                    handleConditionsChange(next);
                  }}
                />
              );
            },
          )}
        </div>

        {/* Add / clear footer */}
        <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Button
              title="Add condition"
              icon={IconProp.Add}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                handleConditionsChange([
                  ...conditions,
                  { ...config.defaultCondition },
                ]);
              }}
            />
            {conditions.length > 1 && (
              <Button
                title="Clear all"
                icon={IconProp.Close}
                buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                buttonSize={ButtonSize.Small}
                onClick={() => {
                  const next: Array<FilterConditionData> = [
                    { ...config.defaultCondition },
                  ];
                  setConditions(next);
                  setConnector("AND");
                  emit(next, "AND");
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Query preview */}
      {previewQuery && (
        <div className="mt-4">
          <details className="group">
            <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 hover:text-gray-500 transition-colors select-none list-none">
              <svg
                className="w-3 h-3 transition-transform duration-150 group-open:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="font-medium">Preview query</span>
            </summary>
            <div className="mt-2 rounded-lg bg-gray-900 p-3.5 overflow-x-auto">
              <code className="text-[13px] text-emerald-400 font-mono break-all leading-relaxed whitespace-pre-wrap">
                {previewQuery}
              </code>
            </div>
          </details>
        </div>
      )}

      {props.error && (
        <p className="mt-2 text-sm text-red-600">{props.error}</p>
      )}
    </div>
  );
};

export default FilterQueryBuilderField;
