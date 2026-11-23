import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
  useCallback,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FilterQueryBuilderField from "./FilterQueryBuilderField";
import {
  FilterBuilderConfig,
  FilterConditionData,
  FilterFieldDefinition,
  LogicalConnector,
} from "./Types";
import {
  buildFilterQuery,
  parseFilterQuery,
  splitListValue,
} from "./FilterQueryParser";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  modelType: { new (): BaseModel };
  modelId: ObjectID;
  config: FilterBuilderConfig;
  title?: string | undefined;
  description?: string | undefined;
  /*
   * Drawn under the conditions while they are edited, from the query as
   * it is now: what a drop filter's query would take (#10436).
   */
  renderPreview?: ((query: string) => ReactElement | undefined) | undefined;
  /*
   * Asked before the query is saved; false keeps the dialog open, as it
   * was. A drop filter asks to confirm when something reads what it takes.
   */
  onBeforeSave?: ((query: string) => Promise<boolean>) | undefined;
  // Told once the query is saved.
  onSaved?: ((query: string) => void) | undefined;
}

const operatorLabels: Record<string, string> = {
  "=": translationKey("equals"),
  "!=": translationKey("does not equal"),
  LIKE: translationKey("contains"),
  IN: translationKey("is one of"),
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

// The value as the pill shows it: an option's label, or the value as typed.
function getValueLabel(
  fieldKey: string,
  value: string,
  config: FilterBuilderConfig,
  translator: Translator,
): string {
  if (!value) {
    return translator.translateText("(empty)") as string;
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
      return translator.translateText(opt.label) as string;
    }
  }
  return value;
}

function getOperatorLabel(operator: string): string {
  return operatorLabels[operator] || operator;
}

const FilterQueryBuilder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { config } = props;

  const [conditions, setConditions] = useState<Array<FilterConditionData>>([
    { ...config.defaultCondition },
  ]);
  const [connector, setConnector] = useState<LogicalConnector>("AND");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalQuery, setModalQuery] = useState<string>("");

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

    try {
      if (props.onBeforeSave && !(await props.onBeforeSave(modalQuery || ""))) {
        // Asked, and told no: the dialog stays as it was.
        return;
      }

      await ModelAPI.updateById({
        modelType: props.modelType,
        id: props.modelId,
        data: { filterQuery: modalQuery || "" },
      });
      const parsed: {
        conditions: Array<FilterConditionData>;
        connector: LogicalConnector;
      } = parseFilterQuery(modalQuery, config);
      setConditions(parsed.conditions);
      setConnector(parsed.connector);
      setShowModal(false);
      props.onSaved?.(modalQuery || "");
    } catch {
      setError("Failed to save filter conditions.");
    } finally {
      setIsSaving(false);
    }
  };

  const openModal: () => void = (): void => {
    setModalQuery(buildFilterQuery(conditions, connector, config));
    setError("");
    setShowModal(true);
  };

  const closeModal: () => void = (): void => {
    setShowModal(false);
    setError("");
  };

  const entities: TranslatableTerm = translatableTerm(config.entityNamePlural, {
    inSentence: true,
  });
  const entity: TranslatableTerm = translatableTerm(config.entityNameSingular, {
    inSentence: true,
  });

  const cardTitle: string = props.title || translationKey("Filter Conditions");
  const cardDescription: string =
    props.description ||
    translator.translateTemplate(
      "Define which {{entities}} this rule applies to. Only {{entities}} that match these conditions will be affected. Leave empty to match all {{entities}}.",
      { entities },
    );

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

    /*
     * "Is one of" on a dropdown field reads as its labels, one pill each
     * (Unset, Error), never as the stored "0, 2" (#9214).
     */
    if (condition.operator === "IN" && fieldDef?.valueOptions) {
      const values: Array<string> = splitListValue(condition.value);

      return (
        <span
          data-testid="filter-value-list"
          className="inline-flex flex-wrap items-center gap-1"
        >
          {values.map((value: string, index: number): ReactElement => {
            return (
              <React.Fragment key={`${value}-${index}`}>
                {renderOneValuePill(fieldDef, condition.field, value)}
              </React.Fragment>
            );
          })}
        </span>
      );
    }

    return renderOneValuePill(fieldDef, condition.field, condition.value);
  };

  const renderOneValuePill: (
    fieldDef: FilterFieldDefinition | undefined,
    fieldKey: string,
    value: string,
  ) => ReactElement = (
    fieldDef: FilterFieldDefinition | undefined,
    fieldKey: string,
    value: string,
  ): ReactElement => {
    const displayValue: string = getValueLabel(
      fieldKey,
      value,
      config,
      translator,
    );
    if (fieldDef?.getValuePillClass) {
      const pillClass: string = fieldDef.getValuePillClass(value);
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
        <div className="py-10 flex items-center justify-center">
          <div className="flex items-center gap-3 text-gray-500">
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
            <span className="text-sm">
              {translator.translateText("Loading...")}
            </span>
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
        <div>
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
                              className={`flex items-center justify-center rounded-full px-1 h-5 text-xs font-bold ring-1 ring-inset ${connectorBadgeStyle}`}
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
                              {translator.translateText(
                                getFieldLabel(condition.field, config),
                              )}
                            </span>
                            <span className="text-xs text-gray-500 italic">
                              {translator.translateText(
                                getOperatorLabel(condition.operator),
                              )}
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
                    <TranslatedSentence
                      template={
                        connector === "AND"
                          ? {
                              one: "{{count}} condition joined with {{connector}} \u2014 {{entity}} must match all",
                              other:
                                "{{count}} conditions joined with {{connector}} \u2014 {{entity}} must match all",
                            }
                          : {
                              one: "{{count}} condition joined with {{connector}} \u2014 {{entity}} must match at least one",
                              other:
                                "{{count}} conditions joined with {{connector}} \u2014 {{entity}} must match at least one",
                            }
                      }
                      count={savedConditions.length}
                      slots={{
                        connector: (
                          <span
                            className={`font-semibold ${connector === "AND" ? "text-indigo-500" : "text-amber-500"}`}
                          >
                            {connector}
                          </span>
                        ),
                      }}
                      values={{ entity }}
                    />
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
                {translator.translateText("No filter conditions")}
              </p>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">
                {translator.translateTemplate(
                  "This rule matches all incoming {{entities}}. Add conditions to target specific {{entities}}.",
                  { entities },
                )}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Edit modal */}
      {showModal && (
        <Modal
          title="Edit Filter Conditions"
          description={translator.translateTemplate(
            "Build filter rules to target specific {{entities}}. Conditions are evaluated in order.",
            { entities },
          )}
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

            <FilterQueryBuilderField
              value={modalQuery}
              onChange={setModalQuery}
              config={config}
            />
            {props.renderPreview ? props.renderPreview(modalQuery) : <></>}
          </div>
        </Modal>
      )}
    </>
  );
};

export default FilterQueryBuilder;
