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
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FilterConditionElement from "./FilterCondition";
import {
  FilterBuilderConfig,
  FilterConditionData,
  FilterFieldDefinition,
  LogicalConnector,
} from "./Types";

export interface ComponentProps {
  modelType: { new (): BaseModel };
  modelId: ObjectID;
  config: FilterBuilderConfig;
  title?: string | undefined;
  description?: string | undefined;
}

const operatorLabels: Record<string, string> = {
  "=": "equals",
  "!=": "does not equal",
  LIKE: "contains",
  IN: "is one of",
};

function getFieldLabel(fieldKey: string, config: FilterBuilderConfig): string {
  if (fieldKey.startsWith("attributes.")) {
    return fieldKey;
  }
  const field: FilterFieldDefinition | undefined = config.fields.find(
    (f: FilterFieldDefinition) => {
      return f.key === fieldKey;
    },
  );
  return field?.label || fieldKey;
}

function getValueLabel(
  fieldKey: string,
  value: string,
  config: FilterBuilderConfig,
): string {
  if (!value) {
    return "(empty)";
  }
  const field: FilterFieldDefinition | undefined = config.fields.find(
    (f: FilterFieldDefinition) => {
      return f.key === fieldKey;
    },
  );
  if (field?.valueOptions) {
    const opt: { value: string; label: string } | undefined =
      field.valueOptions.find(
        (o: { value: string; label: string }): boolean => {
          return o.value === value;
        },
      );
    if (opt) {
      return opt.label;
    }
  }
  return value;
}

function getOperatorLabel(operator: string): string {
  return operatorLabels[operator] || operator;
}

function parseFilterQuery(
  query: string,
  config: FilterBuilderConfig,
): {
  conditions: Array<FilterConditionData>;
  connector: LogicalConnector;
} {
  const defaultResult: {
    conditions: Array<FilterConditionData>;
    connector: LogicalConnector;
  } = {
    conditions: [{ ...config.defaultCondition }],
    connector: "AND",
  };

  if (!query || !query.trim()) {
    return defaultResult;
  }

  const connector: LogicalConnector = query.includes(" OR ") ? "OR" : "AND";
  const connectorRegex: RegExp = connector === "AND" ? / AND /i : / OR /i;
  const parts: Array<string> = query.split(connectorRegex);

  const conditions: Array<FilterConditionData> = [];

  for (const part of parts) {
    const trimmed: string = part.trim().replace(/^\(|\)$/g, "");

    const likeMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s+(LIKE)\s+'([^']*)'$/i,
    );
    const inMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s+(IN)\s+\(([^)]*)\)$/i,
    );
    const eqQuotedMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s*(=|!=)\s*'([^']*)'$/,
    );
    const eqUnquotedMatch: RegExpMatchArray | null = trimmed.match(
      /^(\S+)\s*(=|!=)\s*([^\s'"]+)$/,
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
    } else if (eqQuotedMatch) {
      conditions.push({
        field: eqQuotedMatch[1]!,
        operator: eqQuotedMatch[2]!,
        value: eqQuotedMatch[3]!,
      });
    } else if (eqUnquotedMatch) {
      conditions.push({
        field: eqUnquotedMatch[1]!,
        operator: eqUnquotedMatch[2]!,
        value: eqUnquotedMatch[3]!,
      });
    }
  }

  if (conditions.length === 0) {
    return defaultResult;
  }

  return { conditions, connector };
}

function formatValue(
  fieldKey: string,
  value: string,
  config: FilterBuilderConfig,
): string {
  if (fieldKey.startsWith("attributes.")) {
    return `'${value}'`;
  }
  const field: FilterFieldDefinition | undefined = config.fields.find(
    (f: FilterFieldDefinition) => {
      return f.key === fieldKey;
    },
  );
  if (field?.valueType === "number" || field?.valueType === "boolean") {
    return value;
  }
  return `'${value}'`;
}

function buildFilterQuery(
  conditions: Array<FilterConditionData>,
  connector: LogicalConnector,
  config: FilterBuilderConfig,
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
      return `${c.field} ${c.operator} ${formatValue(c.field, c.value, config)}`;
    });

  return parts.join(` ${connector} `);
}

const FilterQueryBuilder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { config } = props;

  const [conditions, setConditions] = useState<Array<FilterConditionData>>([
    { ...config.defaultCondition },
  ]);
  const [connector, setConnector] = useState<LogicalConnector>("AND");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [showModal, setShowModal] = useState<boolean>(false);

  const [modalConditions, setModalConditions] = useState<
    Array<FilterConditionData>
  >([]);
  const [modalConnector, setModalConnector] = useState<LogicalConnector>("AND");

  const loadModel: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsLoading(true);
      try {
        const item: BaseModel | null = await ModelAPI.getItem({
          modelType: props.modelType,
          id: props.modelId,
          select: { filterQuery: true } as any,
        });

        if (item && (item as any).filterQuery) {
          const parsed: {
            conditions: Array<FilterConditionData>;
            connector: LogicalConnector;
          } = parseFilterQuery((item as any).filterQuery as string, config);
          setConditions(parsed.conditions);
          setConnector(parsed.connector);
        }
      } catch {
        setError("Failed to load filter conditions.");
      } finally {
        setIsLoading(false);
      }
    }, [props.modelId, props.modelType, config]);

  useEffect(() => {
    loadModel().catch(() => {
      // error handled in loadModel
    });
  }, [loadModel]);

  const handleSave: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    const query: string = buildFilterQuery(
      modalConditions,
      modalConnector,
      config,
    );

    try {
      await ModelAPI.updateById({
        modelType: props.modelType,
        id: props.modelId,
        data: { filterQuery: query || "" },
      });
      setConditions(modalConditions);
      setConnector(modalConnector);
      setShowModal(false);
    } catch {
      setError("Failed to save filter conditions.");
    } finally {
      setIsSaving(false);
    }
  };

  const openModal: () => void = (): void => {
    setModalConditions(
      conditions.map((c: FilterConditionData) => {
        return { ...c };
      }),
    );
    setModalConnector(connector);
    setError("");
    setShowModal(true);
  };

  const closeModal: () => void = (): void => {
    setShowModal(false);
    setError("");
  };

  const cardTitle: string = props.title || "Filter Conditions";
  const cardDescription: string =
    props.description ||
    `Define which ${config.entityNamePlural} this rule applies to. Only ${config.entityNamePlural} that match these conditions will be affected. Leave empty to match all ${config.entityNamePlural}.`;

  const savedConditions: Array<FilterConditionData> = conditions.filter(
    (c: FilterConditionData) => {
      return c.field && c.operator && c.value;
    },
  );
  const hasConditions: boolean = savedConditions.length > 0;

  const connectorLineColor: string =
    connector === "AND" ? "bg-indigo-200" : "bg-amber-200";
  const connectorBadgeStyle: string =
    connector === "AND"
      ? "bg-indigo-50 text-indigo-600 ring-indigo-500/20"
      : "bg-amber-50 text-amber-600 ring-amber-500/20";

  const renderValuePill: (condition: FilterConditionData) => ReactElement = (
    condition: FilterConditionData,
  ): ReactElement => {
    const fieldDef: FilterFieldDefinition | undefined = config.fields.find(
      (f: FilterFieldDefinition) => {
        return f.key === condition.field;
      },
    );
    const displayValue: string = getValueLabel(
      condition.field,
      condition.value,
      config,
    );
    if (fieldDef?.getValuePillClass) {
      const pillClass: string = fieldDef.getValuePillClass(condition.value);
      return (
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${pillClass}`}
        >
          {displayValue}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 text-xs font-mono font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
        {displayValue}
      </span>
    );
  };

  if (isLoading) {
    return (
      <Card title={cardTitle} description={cardDescription}>
        <div className="p-10 flex items-center justify-center">
          <div className="flex items-center gap-3 text-gray-400">
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <span className="text-sm">Loading...</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title={cardTitle}
        description={cardDescription}
        buttons={[
          {
            title: "Edit",
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: openModal,
            icon: IconProp.Edit,
          },
        ]}
      >
        <div className="px-5 pt-4 pb-5">
          {hasConditions ? (
            <div>
              {/* Read-only conditions with vertical timeline */}
              <div className="relative">
                {savedConditions.map(
                  (condition: FilterConditionData, index: number) => {
                    const isFirst: boolean = index === 0;
                    const isLast: boolean =
                      index === savedConditions.length - 1;

                    return (
                      <div key={index} className="relative flex">
                        {/* Timeline column */}
                        <div className="flex-shrink-0 w-10 flex flex-col items-center">
                          {/* Top line */}
                          {!isFirst && (
                            <div className={`w-px h-2 ${connectorLineColor}`} />
                          )}
                          {isFirst && <div className="h-2" />}

                          {/* Node */}
                          {isFirst ? (
                            <div className="w-5 h-5 rounded-full bg-gray-100 border-2 border-gray-300 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                            </div>
                          ) : (
                            <div
                              className={`flex items-center justify-center rounded-full px-1 h-5 text-[9px] font-bold ring-1 ring-inset ${connectorBadgeStyle}`}
                            >
                              {connector}
                            </div>
                          )}

                          {/* Bottom line */}
                          {!isLast ? (
                            <div
                              className={`w-px flex-1 ${connectorLineColor}`}
                            />
                          ) : (
                            <div className="flex-1" />
                          )}
                        </div>

                        {/* Condition content */}
                        <div className="flex-1 pb-2 pt-0">
                          <div className="flex items-center gap-2 py-1 pl-2 rounded-md hover:bg-gray-50 transition-colors duration-100 cursor-default">
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-xs font-semibold text-gray-700 tracking-tight">
                              {getFieldLabel(condition.field, config)}
                            </span>
                            <span className="text-xs text-gray-400 italic">
                              {getOperatorLabel(condition.operator)}
                            </span>
                            {renderValuePill(condition)}
                          </div>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>

              {/* Summary footer */}
              {savedConditions.length > 1 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-400">
                    {savedConditions.length} conditions joined with{" "}
                    <span
                      className={`font-semibold ${connector === "AND" ? "text-indigo-500" : "text-amber-500"}`}
                    >
                      {connector}
                    </span>
                    {" \u2014 "}
                    {connector === "AND"
                      ? `${config.entityNameSingular} must match all`
                      : `${config.entityNameSingular} must match at least one`}
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="relative mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-100 border-2 border-white flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                </div>
              </div>
              <p className="text-sm font-medium text-gray-600">
                No filter conditions
              </p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">
                This rule matches all incoming {config.entityNamePlural}. Add
                conditions to target specific {config.entityNamePlural}.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Edit modal */}
      {showModal && (
        <Modal
          title="Edit Filter Conditions"
          description={`Build filter rules to target specific ${config.entityNamePlural}. Conditions are evaluated in order.`}
          onClose={closeModal}
          modalWidth={ModalWidth.Large}
          submitButtonText="Save Changes"
          onSubmit={() => {
            handleSave().catch(() => {
              // error handled inside handleSave
            });
          }}
          isLoading={isSaving}
          disableSubmitButton={isSaving}
        >
          <div>
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

            {/* Connector toggle */}
            {modalConditions.length > 1 && (
              <div className="mb-5 flex items-center gap-3">
                <span className="text-sm text-gray-500">
                  {config.entityNameSingular.charAt(0).toUpperCase() +
                    config.entityNameSingular.slice(1)}{" "}
                  must match
                </span>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                  <button
                    type="button"
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                      modalConnector === "AND"
                        ? "bg-white text-indigo-700 shadow-sm ring-1 ring-black/5"
                        : "text-gray-400 hover:text-gray-600"
                    }`}
                    onClick={() => {
                      setModalConnector("AND");
                    }}
                  >
                    All conditions
                  </button>
                  <button
                    type="button"
                    className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                      modalConnector === "OR"
                        ? "bg-white text-amber-700 shadow-sm ring-1 ring-black/5"
                        : "text-gray-400 hover:text-gray-600"
                    }`}
                    onClick={() => {
                      setModalConnector("OR");
                    }}
                  >
                    Any condition
                  </button>
                </div>
              </div>
            )}

            {/* Condition builder with timeline */}
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="px-4 pt-2">
                {modalConditions.map(
                  (condition: FilterConditionData, index: number) => {
                    return (
                      <FilterConditionElement
                        key={index}
                        condition={condition}
                        canDelete={modalConditions.length > 1}
                        index={index}
                        connector={modalConnector}
                        isLast={index === modalConditions.length - 1}
                        config={config}
                        onChange={(updated: FilterConditionData) => {
                          const newConditions: Array<FilterConditionData> = [
                            ...modalConditions,
                          ];
                          newConditions[index] = updated;
                          setModalConditions(newConditions);
                        }}
                        onDelete={() => {
                          const newConditions: Array<FilterConditionData> =
                            modalConditions.filter(
                              (_: FilterConditionData, i: number) => {
                                return i !== index;
                              },
                            );
                          setModalConditions(newConditions);
                        }}
                      />
                    );
                  },
                )}
              </div>

              {/* Add condition footer */}
              <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100">
                <div className="flex items-center gap-2">
                  <Button
                    title="Add condition"
                    icon={IconProp.Add}
                    buttonStyle={ButtonStyleType.OUTLINE}
                    buttonSize={ButtonSize.Small}
                    onClick={() => {
                      setModalConditions([
                        ...modalConditions,
                        { ...config.defaultCondition },
                      ]);
                    }}
                  />
                  {modalConditions.length > 1 && (
                    <Button
                      title="Clear all"
                      icon={IconProp.Close}
                      buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                      buttonSize={ButtonSize.Small}
                      onClick={() => {
                        setModalConditions([{ ...config.defaultCondition }]);
                        setModalConnector("AND");
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Query preview */}
            {buildFilterQuery(modalConditions, modalConnector, config) && (
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
                      {buildFilterQuery(
                        modalConditions,
                        modalConnector,
                        config,
                      )}
                    </code>
                  </div>
                </details>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default FilterQueryBuilder;
