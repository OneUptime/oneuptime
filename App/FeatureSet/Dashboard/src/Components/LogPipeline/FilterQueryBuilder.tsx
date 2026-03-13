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
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import { Blue, Green } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FilterConditionElement, {
  FilterConditionData,
} from "./FilterCondition";

export interface ComponentProps {
  modelType: { new (): BaseModel };
  modelId: ObjectID;
  title?: string | undefined;
  description?: string | undefined;
}

type LogicalConnector = "AND" | "OR";

// Field label map for display
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
    return `attributes.${field.replace("attributes.", "")}`;
  }
  return fieldLabels[field] || field;
}

function getOperatorLabel(operator: string): string {
  return operatorLabels[operator] || operator;
}

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
  const [originalQuery, setOriginalQuery] = useState<string>("");
  const [showModal, setShowModal] = useState<boolean>(false);

  // Snapshot of conditions/connector when modal opens (for cancel/revert)
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
          setOriginalQuery((item as any).filterQuery as string);
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
      setOriginalQuery(query);
      setShowModal(false);
    } catch {
      setError("Failed to save filter conditions.");
    } finally {
      setIsSaving(false);
    }
  };

  const openModal: () => void = (): void => {
    setModalConditions(conditions.map((c: FilterConditionData) => ({ ...c })));
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

  // Check if there are valid saved conditions
  const savedConditions: Array<FilterConditionData> = conditions.filter(
    (c: FilterConditionData) => {
      return c.field && c.operator && c.value;
    },
  );
  const hasConditions: boolean = savedConditions.length > 0;

  if (isLoading) {
    return (
      <Card title={cardTitle} description="Loading...">
        <div className="p-4 text-gray-400 text-sm">
          Loading filter conditions...
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Read-only card view */}
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
        <div className="p-2">
          {hasConditions ? (
            <div>
              {/* Show connector label */}
              {savedConditions.length > 1 && (
                <div className="mb-3">
                  <span className="text-sm text-gray-500">
                    Match{" "}
                    <span className="font-medium text-gray-700">
                      {connector === "AND"
                        ? "all conditions"
                        : "any condition"}
                    </span>
                  </span>
                </div>
              )}

              {/* Read-only condition list */}
              <div className="space-y-2">
                {savedConditions.map(
                  (condition: FilterConditionData, index: number) => {
                    return (
                      <div key={index}>
                        {index > 0 && (
                          <div className="flex items-center justify-center my-1">
                            <span
                              className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                                connector === "AND"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {connector}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 rounded-md p-3 bg-gray-50 border border-gray-200">
                          <Pill
                            color={Blue}
                            text={getFieldLabel(condition.field)}
                          />
                          <span className="text-sm text-gray-500">
                            {getOperatorLabel(condition.operator)}
                          </span>
                          <Pill
                            color={Green}
                            text={condition.value || "(empty)"}
                          />
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 py-2">
              No filter conditions configured — matches all logs.
            </div>
          )}
        </div>
      </Card>

      {/* Edit modal */}
      {showModal && (
        <Modal
          title="Edit Filter Conditions"
          description="Define which logs this rule applies to. Add conditions to filter by severity, log body, service, or custom attributes."
          onClose={closeModal}
          modalWidth={ModalWidth.Large}
          submitButtonText="Save"
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

            {/* Connector selector */}
            {modalConditions.length > 1 && (
              <div className="mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 font-medium">
                    Match
                  </span>
                  <div className="w-64">
                    <Dropdown
                      options={connectorOptions}
                      value={connectorOptions.find((opt: DropdownOption) => {
                        return opt.value === modalConnector;
                      })}
                      onChange={(
                        value: DropdownValue | Array<DropdownValue> | null,
                      ) => {
                        setModalConnector(
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
              {modalConditions.map(
                (condition: FilterConditionData, index: number) => {
                  return (
                    <div key={index}>
                      {index > 0 && (
                        <div className="flex items-center justify-center my-2">
                          <div className="flex-1 border-t border-gray-200"></div>
                          <span
                            className={`mx-3 px-3 py-1 text-xs font-semibold rounded-full border ${
                              modalConnector === "AND"
                                ? "bg-blue-100 text-blue-700 border-blue-200"
                                : "bg-amber-100 text-amber-700 border-amber-200"
                            }`}
                          >
                            {modalConnector}
                          </span>
                          <div className="flex-1 border-t border-gray-200"></div>
                        </div>
                      )}
                      <FilterConditionElement
                        condition={condition}
                        canDelete={modalConditions.length > 1}
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
            </div>

            {/* Add condition + Clear buttons */}
            <div className="mt-4 flex gap-2">
              <Button
                title="Add Condition"
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
                  title="Clear All"
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

            {/* Preview of generated query */}
            {buildFilterQuery(modalConditions, modalConnector) && (
              <div className="mt-4 p-3 bg-gray-100 rounded-md">
                <p className="text-xs text-gray-500 font-medium mb-1">
                  Generated Filter Query
                </p>
                <code className="text-xs text-gray-700 break-all">
                  {buildFilterQuery(modalConditions, modalConnector)}
                </code>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default FilterQueryBuilder;
