import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
  useCallback,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FilterConditionElement, { FilterConditionData } from "./FilterCondition";

export interface ComponentProps {
  pipelineId: ObjectID;
}

type LogicalConnector = "AND" | "OR";

// Parse a filterQuery string into structured conditions
function parseFilterQuery(query: string): {
  conditions: Array<FilterConditionData>;
  connector: LogicalConnector;
} {
  const defaultResult: {
    conditions: Array<FilterConditionData>;
    connector: LogicalConnector;
  } = {
    conditions: [{ field: "severityText", operator: "=", value: "" }],
    connector: "AND",
  };

  if (!query || !query.trim()) {
    return defaultResult;
  }

  // Detect connector
  const connector: LogicalConnector = query.includes(" OR ") ? "OR" : "AND";
  const connectorRegex: RegExp = connector === "AND" ? / AND /i : / OR /i;
  const parts: Array<string> = query.split(connectorRegex);

  const conditions: Array<FilterConditionData> = [];

  for (const part of parts) {
    const trimmed: string = part.trim().replace(/^\(|\)$/g, "");

    // Try to match: field OPERATOR 'value' or field OPERATOR value
    const likeMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s+(LIKE)\s+'([^']*)'$/i,
    );
    const inMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s+(IN)\s+\(([^)]*)\)$/i,
    );
    const eqMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s*(=|!=)\s*'([^']*)'$/,
    );

    if (likeMatch) {
      conditions.push({
        field: likeMatch[1]!,
        operator: "LIKE",
        value: likeMatch[3]!,
      });
    } else if (inMatch) {
      conditions.push({
        field: inMatch[1]!,
        operator: "IN",
        value: inMatch[3]!.replace(/'/g, "").trim(),
      });
    } else if (eqMatch) {
      conditions.push({
        field: eqMatch[1]!,
        operator: eqMatch[2]!,
        value: eqMatch[3]!,
      });
    }
  }

  if (conditions.length === 0) {
    return defaultResult;
  }

  return { conditions, connector };
}

// Build a filterQuery string from structured conditions
function buildFilterQuery(
  conditions: Array<FilterConditionData>,
  connector: LogicalConnector,
): string {
  const parts: Array<string> = conditions
    .filter((c: FilterConditionData) => {
      return c.field && c.operator && c.value;
    })
    .map((c: FilterConditionData) => {
      if (c.operator === "LIKE") {
        return `${c.field} LIKE '${c.value}'`;
      }
      if (c.operator === "IN") {
        const values: string = c.value
          .split(",")
          .map((v: string) => {
            return `'${v.trim()}'`;
          })
          .join(", ");
        return `${c.field} IN (${values})`;
      }
      return `${c.field} ${c.operator} '${c.value}'`;
    });

  return parts.join(` ${connector} `);
}

const connectorOptions: Array<DropdownOption> = [
  {
    value: "AND",
    label: "ALL conditions (AND)",
    description: "Log must match every condition",
  },
  {
    value: "OR",
    label: "ANY condition (OR)",
    description: "Log must match at least one condition",
  },
];

const FilterQueryBuilder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [conditions, setConditions] = useState<Array<FilterConditionData>>([
    { field: "severityText", operator: "=", value: "" },
  ]);
  const [connector, setConnector] = useState<LogicalConnector>("AND");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [originalQuery, setOriginalQuery] = useState<string>("");

  const loadPipeline: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoading(true);
      try {
        const pipeline: LogPipeline | null = await ModelAPI.getItem({
          modelType: LogPipeline,
          id: props.pipelineId,
          select: { filterQuery: true },
        });

        if (pipeline?.filterQuery) {
          const parsed: {
            conditions: Array<FilterConditionData>;
            connector: LogicalConnector;
          } = parseFilterQuery(pipeline.filterQuery);
          setConditions(parsed.conditions);
          setConnector(parsed.connector);
          setOriginalQuery(pipeline.filterQuery);
        }
      } catch (err) {
        setError("Failed to load filter conditions.");
      } finally {
        setIsLoading(false);
      }
    }, [props.pipelineId]);

  useEffect(() => {
    loadPipeline().catch(() => {
      // error handled in loadPipeline
    });
  }, [loadPipeline]);

  const handleSave: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");
    setSuccessMessage("");

    const query: string = buildFilterQuery(conditions, connector);

    try {
      await ModelAPI.updateById({
        modelType: LogPipeline,
        id: props.pipelineId,
        data: { filterQuery: query || "" },
      });
      setOriginalQuery(query);
      setSuccessMessage("Filter conditions saved successfully.");
      setTimeout(() => {
        setSuccessMessage("");
      }, 3000);
    } catch (err) {
      setError("Failed to save filter conditions.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear: () => void = (): void => {
    setConditions([{ field: "severityText", operator: "=", value: "" }]);
    setConnector("AND");
  };

  const currentQuery: string = buildFilterQuery(conditions, connector);
  const hasChanges: boolean = currentQuery !== originalQuery;

  if (isLoading) {
    return (
      <Card title="Filter Conditions" description="Loading...">
        <div className="p-4 text-gray-400 text-sm">
          Loading filter conditions...
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Filter Conditions"
      description="Define which logs this pipeline applies to. Only logs that match these conditions will be processed. Leave empty to process all logs."
      buttons={[
        {
          title: "Save",
          buttonStyle: ButtonStyleType.PRIMARY,
          onClick: handleSave,
          isLoading: isSaving,
          disabled: isSaving || !hasChanges,
          icon: IconProp.CheckCircle,
        },
      ]}
    >
      <div className="p-2">
        {error && (
          <div className="mb-4">
            <Alert
              type={AlertType.DANGER}
              title={error}
              onClose={() => {
                setError("");
              }}
            />
          </div>
        )}

        {successMessage && (
          <div className="mb-4">
            <Alert
              type={AlertType.SUCCESS}
              title={successMessage}
              onClose={() => {
                setSuccessMessage("");
              }}
            />
          </div>
        )}

        {/* Connector selector (only show if more than 1 condition) */}
        {conditions.length > 1 && (
          <div className="mb-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 font-medium">Match</span>
              <div className="w-64">
                <Dropdown
                  options={connectorOptions}
                  value={connectorOptions.find((opt: DropdownOption) => {
                    return opt.value === connector;
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    setConnector(
                      (value?.toString() as LogicalConnector) || "AND",
                    );
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Condition rows */}
        <div className="space-y-3">
          {conditions.map((condition: FilterConditionData, index: number) => {
            return (
              <div key={index}>
                {index > 0 && (
                  <div className="flex items-center justify-center my-2">
                    <div className="flex-1 border-t border-gray-200"></div>
                    <span
                      className={`mx-3 px-3 py-1 text-xs font-semibold rounded-full border ${
                        connector === "AND"
                          ? "bg-blue-100 text-blue-700 border-blue-200"
                          : "bg-amber-100 text-amber-700 border-amber-200"
                      }`}
                    >
                      {connector}
                    </span>
                    <div className="flex-1 border-t border-gray-200"></div>
                  </div>
                )}
                <FilterConditionElement
                  condition={condition}
                  canDelete={conditions.length > 1}
                  onChange={(updated: FilterConditionData) => {
                    const newConditions: Array<FilterConditionData> = [
                      ...conditions,
                    ];
                    newConditions[index] = updated;
                    setConditions(newConditions);
                  }}
                  onDelete={() => {
                    const newConditions: Array<FilterConditionData> =
                      conditions.filter((_: FilterConditionData, i: number) => {
                        return i !== index;
                      });
                    setConditions(newConditions);
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Add condition + Clear buttons */}
        <div className="mt-4 flex gap-2">
          <Button
            title="Add Condition"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              setConditions([
                ...conditions,
                { field: "severityText", operator: "=", value: "" },
              ]);
            }}
          />
          {conditions.length > 1 && (
            <Button
              title="Clear All"
              icon={IconProp.Close}
              buttonStyle={ButtonStyleType.DANGER_OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={handleClear}
            />
          )}
        </div>

        {/* Preview of generated query */}
        {currentQuery && (
          <div className="mt-4 p-3 bg-gray-100 rounded-md">
            <p className="text-xs text-gray-500 font-medium mb-1">
              Generated Filter Query
            </p>
            <code className="text-xs text-gray-700 break-all">
              {currentQuery}
            </code>
          </div>
        )}
      </div>
    </Card>
  );
};

export default FilterQueryBuilder;
