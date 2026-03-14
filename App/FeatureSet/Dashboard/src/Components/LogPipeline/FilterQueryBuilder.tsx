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
import FilterConditionElement, { FilterConditionData } from "./FilterCondition";

export interface ComponentProps {
  modelType: { new (): BaseModel };
  modelId: ObjectID;
  title?: string | undefined;
  description?: string | undefined;
}

type LogicalConnector = "AND" | "OR";

const fieldLabels: Record<string, string> = {
  severityText: "Severity",
  body: "Log Body",
  serviceId: "Service ID",
};

const operatorLabels: Record<string, string> = {
  "=": "equals",
  "!=": "does not equal",
  LIKE: "contains",
  IN: "is one of",
};

function getFieldLabel(field: string): string {
  if (field.startsWith("attributes.")) {
    return field;
  }
  return fieldLabels[field] || field;
}

function getOperatorLabel(operator: string): string {
  return operatorLabels[operator] || operator;
}

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

function getSeverityColor(value: string): string {
  const v: string = value.toUpperCase();
  if (v === "FATAL" || v === "ERROR") {
    return "bg-red-50 text-red-700 ring-red-600/10";
  }
  if (v === "WARNING") {
    return "bg-amber-50 text-amber-700 ring-amber-600/10";
  }
  if (v === "INFO") {
    return "bg-blue-50 text-blue-700 ring-blue-600/10";
  }
  if (v === "DEBUG" || v === "TRACE") {
    return "bg-gray-50 text-gray-600 ring-gray-500/10";
  }
  return "bg-gray-50 text-gray-600 ring-gray-500/10";
}

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
          } = parseFilterQuery((item as any).filterQuery as string);
          setConditions(parsed.conditions);
          setConnector(parsed.connector);
        }
      } catch {
        setError("Failed to load filter conditions.");
      } finally {
        setIsLoading(false);
      }
    }, [props.modelId, props.modelType]);

  useEffect(() => {
    loadModel().catch(() => {
      // error handled in loadModel
    });
  }, [loadModel]);

  const handleSave: () => Promise<void> = async (): Promise<void> => {
    setIsSaving(true);
    setError("");

    const query: string = buildFilterQuery(modalConditions, modalConnector);

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
    "Define which logs this rule applies to. Only logs that match these conditions will be affected. Leave empty to match all logs.";

  const savedConditions: Array<FilterConditionData> = conditions.filter(
    (c: FilterConditionData) => {
      return c.field && c.operator && c.value;
    },
  );
  const hasConditions: boolean = savedConditions.length > 0;

  if (isLoading) {
    return (
      <Card title={cardTitle} description={cardDescription}>
        <div className="p-8 flex items-center justify-center">
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
        <div className="p-5">
          {hasConditions ? (
            <div>
              {/* Read-only condition list as natural-language sentences */}
              <div className="space-y-0">
                {savedConditions.map(
                  (condition: FilterConditionData, index: number) => {
                    const isSeverity: boolean =
                      condition.field === "severityText";
                    const isFirst: boolean = index === 0;

                    return (
                      <div key={index} className="flex items-center gap-0">
                        {/* Left prefix column */}
                        <div className="flex-shrink-0 w-16 py-2.5 flex items-center">
                          {isFirst ? (
                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                              Where
                            </span>
                          ) : (
                            <span
                              className={`text-xs font-semibold uppercase tracking-wide ${
                                connector === "AND"
                                  ? "text-indigo-500"
                                  : "text-amber-500"
                              }`}
                            >
                              {connector}
                            </span>
                          )}
                        </div>

                        {/* Condition sentence */}
                        <div className="flex-1 flex items-center gap-2 py-2.5 border-b border-gray-100 last:border-b-0">
                          {/* Field */}
                          <span className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 text-sm font-medium text-gray-700">
                            {getFieldLabel(condition.field)}
                          </span>

                          {/* Operator */}
                          <span className="text-sm text-gray-400">
                            {getOperatorLabel(condition.operator)}
                          </span>

                          {/* Value */}
                          {isSeverity ? (
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${getSeverityColor(condition.value)}`}
                            >
                              {condition.value || "(empty)"}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-1 rounded-md bg-indigo-50 text-sm font-mono text-indigo-700 ring-1 ring-inset ring-indigo-600/10">
                              {condition.value || "(empty)"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 mb-3">
                <svg
                  className="w-5 h-5 text-gray-300"
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
              <p className="text-sm text-gray-500">No filter conditions</p>
              <p className="text-xs text-gray-400 mt-1">
                Matches all logs. Click <span className="font-medium">Edit</span> to add
                conditions.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Edit modal */}
      {showModal && (
        <Modal
          title="Edit Filter Conditions"
          description="Add conditions to filter logs by severity, body, service, or custom attributes."
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

            {/* Connector toggle - only show when 2+ conditions */}
            {modalConditions.length > 1 && (
              <div className="mb-4 flex items-center gap-3">
                <span className="text-sm text-gray-500">
                  Log must match
                </span>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                      modalConnector === "AND"
                        ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                    onClick={() => {
                      setModalConnector("AND");
                    }}
                  >
                    All conditions
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                      modalConnector === "OR"
                        ? "bg-white text-amber-700 shadow-sm ring-1 ring-gray-200"
                        : "text-gray-500 hover:text-gray-700"
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

            {/* Condition rows */}
            <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
              {modalConditions.map(
                (condition: FilterConditionData, index: number) => {
                  return (
                    <div key={index} className="px-4">
                      <FilterConditionElement
                        condition={condition}
                        canDelete={modalConditions.length > 1}
                        index={index}
                        connector={modalConnector}
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
                    </div>
                  );
                },
              )}

              {/* Add condition row */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-14">
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        modalConnector === "AND"
                          ? "text-indigo-400"
                          : "text-amber-400"
                      }`}
                    >
                      {modalConnector}
                    </span>
                  </div>
                  <Button
                    title="Add condition"
                    icon={IconProp.Add}
                    buttonStyle={ButtonStyleType.OUTLINE}
                    buttonSize={ButtonSize.Small}
                    onClick={() => {
                      setModalConditions([
                        ...modalConditions,
                        { field: "severityText", operator: "=", value: "" },
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
                        setModalConditions([
                          { field: "severityText", operator: "=", value: "" },
                        ]);
                        setModalConnector("AND");
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Query preview - collapsible feel */}
            {buildFilterQuery(modalConditions, modalConnector) && (
              <div className="mt-4">
                <details className="group">
                  <summary className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 hover:text-gray-600 transition-colors select-none">
                    <svg
                      className="w-3.5 h-3.5 transition-transform group-open:rotate-90"
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
                    <span className="font-medium uppercase tracking-wide">
                      Preview query
                    </span>
                  </summary>
                  <div className="mt-2 rounded-lg bg-gray-900 p-3 overflow-x-auto">
                    <code className="text-xs text-emerald-400 font-mono break-all leading-relaxed whitespace-pre-wrap">
                      {buildFilterQuery(modalConditions, modalConnector)}
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
