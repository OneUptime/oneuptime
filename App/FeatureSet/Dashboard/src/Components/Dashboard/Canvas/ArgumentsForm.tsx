import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentsUtil from "Common/Utils/Dashboard/Components/Index";
import ComponentInputTypeToFormFieldType from "./ComponentInputTypeToFormFieldType";
import BasicForm, { FormProps } from "Common/UI/Components/Forms/BasicForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import MetricQueryConfig from "../../Metrics/MetricQueryConfig";
import MetricFormulaConfig from "../../Metrics/MetricFormulaConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import TableColumnsEditor from "./TableColumnsEditor";
import {
  TableColumn,
  TableColumnKind,
  TableGroupByAttribute,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DictionaryForm from "Common/UI/Components/Dictionary/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import EntityFilterDropdown from "./EntityFilterDropdown";
import TraceChartQueryEditor from "./TraceChartQueryEditor";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";

export interface ComponentProps {
  // eslint-disable-next-line react/no-unused-prop-types
  metrics: {
    metricTypes: Array<MetricType>;
    telemetryAttributes: string[];
  };
  component: DashboardBaseComponent;
  onHasFormValidationErrors?:
    | ((values: Dictionary<boolean>) => void)
    | undefined;
  onFormChange: (component: DashboardBaseComponent) => void;
}

interface SectionGroup {
  section: ComponentArgumentSection;
  args: Array<ComponentArgument<DashboardBaseComponent>>;
}

const ArgumentsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const formRefs: React.MutableRefObject<
    Record<string, FormProps<FormValues<JSONObject>> | null>
  > = useRef({});
  const [component, setComponent] = useState<DashboardBaseComponent>(
    props.component,
  );
  const [hasFormValidationErrors, setHasFormValidationErrors] = useState<
    Dictionary<boolean>
  >({});
  const [multiQueryConfigs, setMultiQueryConfigs] = useState<
    Array<MetricQueryConfigData>
  >(
    ((props.component?.arguments as JSONObject)?.[
      "metricQueryConfigs"
    ] as unknown as Array<MetricQueryConfigData>) || [],
  );
  const [multiFormulaConfigs, setMultiFormulaConfigs] = useState<
    Array<MetricFormulaConfigData>
  >(
    ((props.component?.arguments as JSONObject)?.[
      "metricFormulaConfigs"
    ] as unknown as Array<MetricFormulaConfigData>) || [],
  );

  /*
   * Per-metric attribute caches. The dashboard widget editor needs the same
   * "select a metric → its attribute keys/values autocomplete" behavior as
   * the Metrics Explorer (MetricView). The global telemetryAttributes list
   * provided by the parent is not metric-scoped, so it can't supply value
   * suggestions and shows attributes that don't belong to the chosen metric.
   */
  const [telemetryAttributesByMetric, setTelemetryAttributesByMetric] =
    useState<Record<string, Array<string>>>({});
  const [loadedMetricAttributes, setLoadedMetricAttributes] = useState<
    Set<string>
  >(new Set());
  const [loadingMetricAttributes, setLoadingMetricAttributes] = useState<
    Set<string>
  >(new Set());
  const [telemetryAttributesError, setTelemetryAttributesError] =
    useState<string>("");

  const [attributeValueSuggestions, setAttributeValueSuggestions] = useState<
    Record<string, Record<string, Array<string>>>
  >({});
  const loadedAttributeValuesRef: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set());
  const [loadingAttributeValues, setLoadingAttributeValues] = useState<
    Record<string, Set<string>>
  >({});

  type LoadMetricAttributesFunction = (metricName: string) => Promise<void>;

  const loadTelemetryAttributesForMetric: LoadMetricAttributesFunction = async (
    metricName: string,
  ): Promise<void> => {
    if (!metricName) {
      return;
    }

    if (
      loadingMetricAttributes.has(metricName) ||
      loadedMetricAttributes.has(metricName)
    ) {
      return;
    }

    try {
      setLoadingMetricAttributes((prev: Set<string>) => {
        const next: Set<string> = new Set(prev);
        next.add(metricName);
        return next;
      });
      setTelemetryAttributesError("");

      const attributes: Array<string> = await MetricUtil.getTelemetryAttributes(
        { metricName },
      );

      setTelemetryAttributesByMetric((prev: Record<string, Array<string>>) => {
        return { ...prev, [metricName]: attributes };
      });
      setLoadedMetricAttributes((prev: Set<string>) => {
        const next: Set<string> = new Set(prev);
        next.add(metricName);
        return next;
      });
    } catch (err) {
      setTelemetryAttributesError(
        `We couldn't load metric attributes. ${API.getFriendlyErrorMessage(err as Error)}`,
      );
    } finally {
      setLoadingMetricAttributes((prev: Set<string>) => {
        const next: Set<string> = new Set(prev);
        next.delete(metricName);
        return next;
      });
    }
  };

  type LoadAttributeValuesFunction = (
    metricName: string,
    attributeKey: string,
  ) => Promise<void>;

  const loadAttributeValues: LoadAttributeValuesFunction = async (
    metricName: string,
    attributeKey: string,
  ): Promise<void> => {
    if (!metricName || !attributeKey) {
      return;
    }

    const cacheKey: string = `${metricName}:${attributeKey}`;

    if (loadedAttributeValuesRef.current.has(cacheKey)) {
      return;
    }

    loadedAttributeValuesRef.current.add(cacheKey);

    setLoadingAttributeValues(
      (prev: Record<string, Set<string>>): Record<string, Set<string>> => {
        const next: Set<string> = new Set(prev[metricName] || []);
        next.add(attributeKey);
        return { ...prev, [metricName]: next };
      },
    );

    try {
      const values: Array<string> =
        await MetricUtil.getTelemetryAttributeValues({
          attributeKey,
          metricName,
        });

      setAttributeValueSuggestions(
        (prev: Record<string, Record<string, Array<string>>>) => {
          return {
            ...prev,
            [metricName]: {
              ...(prev[metricName] || {}),
              [attributeKey]: values,
            },
          };
        },
      );
    } catch {
      // Value suggestions are best-effort; allow a retry on next select.
      loadedAttributeValuesRef.current.delete(cacheKey);
    } finally {
      setLoadingAttributeValues(
        (prev: Record<string, Set<string>>): Record<string, Set<string>> => {
          const next: Set<string> = new Set(prev[metricName] || []);
          next.delete(attributeKey);
          return { ...prev, [metricName]: next };
        },
      );
    }
  };

  type RetryMetricAttributesFunction = (metricName: string) => void;

  const retryLoadTelemetryAttributes: RetryMetricAttributesFunction = (
    metricName: string,
  ): void => {
    if (!metricName) {
      return;
    }
    setLoadedMetricAttributes((prev: Set<string>) => {
      const next: Set<string> = new Set(prev);
      next.delete(metricName);
      return next;
    });
    void loadTelemetryAttributesForMetric(metricName);
  };

  useEffect(() => {
    if (props.onHasFormValidationErrors) {
      props.onHasFormValidationErrors(hasFormValidationErrors);
    }
  }, [hasFormValidationErrors]);

  /*
   * Sync local state when the parent swaps the component being edited
   * (e.g. user picks a different widget). We intentionally do NOT propagate
   * local changes back up via a useEffect — that would create a feedback
   * loop with the parent re-rendering and handing us a fresh component
   * reference on every keystroke, which causes the form input to flicker.
   * User-initiated edits call props.onFormChange directly below.
   */
  useEffect(() => {
    setComponent(props.component);
  }, [props.component]);

  type CommitComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ) => void;

  const commitComponent: CommitComponentFunction = (
    updatedComponent: DashboardBaseComponent,
  ): void => {
    setComponent(updatedComponent);
    props.onFormChange(updatedComponent);
  };

  const componentType: DashboardComponentType = component.componentType;
  const componentArguments: Array<ComponentArgument<DashboardBaseComponent>> =
    DashboardComponentsUtil.getComponentSettingsArguments(componentType);

  // Group arguments by section
  const groupArgumentsBySections: () => Array<SectionGroup> =
    (): Array<SectionGroup> => {
      const sectionMap: Map<string, SectionGroup> = new Map();
      const unsectionedArgs: Array<ComponentArgument<DashboardBaseComponent>> =
        [];

      for (const arg of componentArguments) {
        // Skip MetricsQueryConfigs and MetricsFormulaConfigs - rendered as custom multi UI below
        if (
          arg.type === ComponentInputType.MetricsQueryConfigs ||
          arg.type === ComponentInputType.MetricsFormulaConfigs ||
          arg.type === ComponentInputType.TableColumns ||
          arg.type === ComponentInputType.TableGroupBy
        ) {
          continue;
        }

        if (arg.section) {
          const key: string = arg.section.name;
          if (!sectionMap.has(key)) {
            sectionMap.set(key, {
              section: arg.section,
              args: [],
            });
          }
          sectionMap.get(key)!.args.push(arg);
        } else {
          unsectionedArgs.push(arg);
        }
      }

      const groups: Array<SectionGroup> = [];

      // Add unsectioned args as a "General" section if they exist
      if (unsectionedArgs.length > 0) {
        groups.push({
          section: {
            name: "General",
            order: 0,
          },
          args: unsectionedArgs,
        });
      }

      // Sort sections by order
      const sortedSections: Array<SectionGroup> = Array.from(
        sectionMap.values(),
      ).sort((a: SectionGroup, b: SectionGroup) => {
        return a.section.order - b.section.order;
      });
      groups.push(...sortedSections);

      return groups;
    };

  type GetMetricsQueryConfigFormFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ) => (
    value: FormValues<JSONObject>,
    componentProps: CustomElementProps,
  ) => ReactElement;

  const getMetricsQueryConfigForm: GetMetricsQueryConfigFormFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ): ((
    value: FormValues<JSONObject>,
    componentProps: CustomElementProps,
  ) => ReactElement) => {
    // eslint-disable-next-line react/display-name
    return (
      value: FormValues<JSONObject>,
      componentProps: CustomElementProps,
    ) => {
      const queryData: MetricQueryConfigData = value[
        arg.id
      ] as MetricQueryConfigData;
      const metricName: string =
        queryData?.metricQueryData?.filterData?.metricName?.toString() || "";

      return (
        <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
          <div className="mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Query 1
            </span>
          </div>
          <MetricQueryConfig
            {...componentProps}
            data={queryData}
            metricTypes={props.metrics.metricTypes}
            telemetryAttributes={telemetryAttributesByMetric[metricName] || []}
            attributesLoading={loadingMetricAttributes.has(metricName)}
            attributesError={telemetryAttributesError}
            telemetryAttributeValueSuggestions={
              attributeValueSuggestions[metricName] || {}
            }
            loadingAttributeValueKeys={Array.from(
              loadingAttributeValues[metricName] || [],
            )}
            onMetricNameChanged={(nextMetricName: string) => {
              void loadTelemetryAttributesForMetric(nextMetricName);
            }}
            onAttributeKeySelected={(attributeKey: string) => {
              if (metricName && attributeKey) {
                void loadAttributeValues(metricName, attributeKey);
              }
            }}
            onAdvancedFiltersToggle={(show: boolean) => {
              if (show && metricName) {
                void loadTelemetryAttributesForMetric(metricName);
              }
            }}
            onAttributesRetry={() => {
              retryLoadTelemetryAttributes(metricName);
            }}
            hideCard={true}
          />
        </div>
      );
    };
  };

  type GetEntityDropdownFormFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
    isMultiSelect: boolean,
  ) => (
    value: FormValues<JSONObject>,
    componentProps: CustomElementProps,
  ) => ReactElement;

  const getEntityDropdownForm: GetEntityDropdownFormFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
    isMultiSelect: boolean,
  ): ((
    value: FormValues<JSONObject>,
    componentProps: CustomElementProps,
  ) => ReactElement) => {
    // eslint-disable-next-line react/display-name
    return (
      value: FormValues<JSONObject>,
      componentProps: CustomElementProps,
    ) => {
      const entityFilterModelType: EntityFilterModelType | undefined =
        arg.entityFilterModelType;

      if (!entityFilterModelType) {
        return (
          <ErrorMessage
            message={`No entity filter model type configured for "${arg.name}".`}
          />
        );
      }

      const currentValue: string | Array<string> | undefined = value[
        arg.id as string
      ] as string | Array<string> | undefined;

      return (
        <EntityFilterDropdown
          entityFilterModelType={entityFilterModelType}
          isMultiSelect={isMultiSelect}
          value={currentValue}
          placeholder={arg.placeholder}
          onChange={(newValue: string | Array<string> | null) => {
            if (componentProps.onChange) {
              componentProps.onChange(newValue);
            }
          }}
        />
      );
    };
  };

  type GetCustomElementFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ) =>
    | ((
        value: FormValues<JSONObject>,
        componentProps: CustomElementProps,
      ) => ReactElement)
    | undefined;

  const getCustomElement: GetCustomElementFunction = (
    arg: ComponentArgument<DashboardBaseComponent>,
  ):
    | ((
        value: FormValues<JSONObject>,
        componentProps: CustomElementProps,
      ) => ReactElement)
    | undefined => {
    if (arg.type === ComponentInputType.MetricsQueryConfig) {
      return getMetricsQueryConfigForm(arg);
    }
    if (arg.type === ComponentInputType.EntityDropdown) {
      return getEntityDropdownForm(arg, false);
    }
    if (arg.type === ComponentInputType.EntityMultiSelectDropdown) {
      return getEntityDropdownForm(arg, true);
    }
    return undefined;
  };

  const renderSectionForm: (sectionGroup: SectionGroup) => ReactElement = (
    sectionGroup: SectionGroup,
  ): ReactElement => {
    const sectionKey: string = sectionGroup.section.name;

    return (
      <BasicForm
        /*
         * Remount the form when the user picks a different widget so
         * initialValues seed the form state again. BasicForm only reads
         * initialValues at mount, so without this key its internal state
         * would stick to whichever widget was selected first and the new
         * widget's defaults (e.g. Text widget's "Hello, World!") would
         * never appear in the inputs.
         */
        key={`${component.componentId.toString()}-${sectionKey}`}
        hideSubmitButton={true}
        ref={(ref: FormProps<FormValues<JSONObject>> | null) => {
          formRefs.current[sectionKey] = ref;
        }}
        initialValues={{
          ...(component?.arguments || {}),
        }}
        onChange={(values: FormValues<JSONObject>) => {
          /*
           * Only write back the field IDs that THIS section's BasicForm
           * actually renders. Without this filter, BasicForm re-emits its
           * full initialValues snapshot on every change, which clobbers
           * args managed by custom editors outside the form (the
           * Columns repeater and the Group By editor write `columns` and
           * `groupByAttributes` directly via commitComponent — those would
           * revert to the snapshot BasicForm captured at mount).
           */
          const sectionFieldKeys: Set<string> = new Set(
            sectionGroup.args.map(
              (arg: ComponentArgument<DashboardBaseComponent>): string => {
                return String(arg.id);
              },
            ),
          );
          const filtered: JSONObject = {};
          const all: JSONObject = (values as JSONObject) || {};
          for (const key of Object.keys(all)) {
            if (sectionFieldKeys.has(key)) {
              filtered[key] = all[key];
            }
          }
          commitComponent({
            ...component,
            arguments: {
              ...((component.arguments as JSONObject) || {}),
              ...filtered,
            },
          });
        }}
        onFormValidationErrorChanged={(hasError: boolean) => {
          if (hasFormValidationErrors[sectionKey] !== hasError) {
            setHasFormValidationErrors({
              ...hasFormValidationErrors,
              [sectionKey]: hasError,
            });
          }
        }}
        fields={sectionGroup.args.map(
          (arg: ComponentArgument<DashboardBaseComponent>) => {
            return {
              title: arg.name,
              description: arg.description,
              field: {
                [arg.id]: true,
              },
              required: arg.required,
              placeholder: arg.placeholder,
              ...ComponentInputTypeToFormFieldType.getFormFieldTypeByComponentInputType(
                arg.type,
                arg.dropdownOptions,
              ),
              getCustomElement: getCustomElement(arg),
            };
          },
        )}
      />
    );
  };

  // Check if this component has a MetricsQueryConfigs argument
  const hasMultiQueryArg: boolean = componentArguments.some(
    (arg: ComponentArgument<DashboardBaseComponent>) => {
      return arg.type === ComponentInputType.MetricsQueryConfigs;
    },
  );

  const multiQueryArg: ComponentArgument<DashboardBaseComponent> | undefined =
    componentArguments.find(
      (arg: ComponentArgument<DashboardBaseComponent>) => {
        return arg.type === ComponentInputType.MetricsQueryConfigs;
      },
    );

  const hasMultiFormulaArg: boolean = componentArguments.some(
    (arg: ComponentArgument<DashboardBaseComponent>) => {
      return arg.type === ComponentInputType.MetricsFormulaConfigs;
    },
  );

  /*
   * The chart widget has a single primary query stored under "metricQueryConfig"
   * (variable "a"), then any number of additional queries under "metricQueryConfigs"
   * (b, c, …). Formula variables must not collide with any of those.
   */
  const primaryQueryConfig: MetricQueryConfigData | undefined = (
    component?.arguments as JSONObject
  )?.["metricQueryConfig"] as unknown as MetricQueryConfigData | undefined;

  const getAllUsedVariables: () => Set<string> = (): Set<string> => {
    const taken: Set<string> = new Set<string>();
    const pushVar: (v: string | undefined) => void = (
      v: string | undefined,
    ): void => {
      if (v) {
        taken.add(v.toLowerCase());
      }
    };
    pushVar(primaryQueryConfig?.metricAliasData?.metricVariable);
    multiQueryConfigs.forEach((q: MetricQueryConfigData) => {
      pushVar(q.metricAliasData?.metricVariable);
    });
    multiFormulaConfigs.forEach((f: MetricFormulaConfigData) => {
      pushVar(f.metricAliasData?.metricVariable);
    });
    return taken;
  };

  const getNextUnusedVariableLetter: () => string = (): string => {
    const taken: Set<string> = getAllUsedVariables();
    for (let i: number = 0; i < 26; i++) {
      const candidate: string = String.fromCharCode(97 + i);
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    // Unlikely fallback when all 26 letters are taken
    return `f${multiFormulaConfigs.length + 1}`;
  };

  const renderMultiQuerySection: () => ReactElement | null =
    (): ReactElement | null => {
      if (!hasMultiQueryArg || !multiQueryArg) {
        return null;
      }

      return (
        <div className="mt-4">
          {multiQueryConfigs.map(
            (queryConfig: MetricQueryConfigData, index: number) => {
              const metricName: string =
                queryConfig.metricQueryData?.filterData?.metricName?.toString() ||
                "";

              return (
                <div
                  key={index}
                  className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Query {index + 2}
                    </span>
                    <Button
                      title="Remove"
                      buttonSize={ButtonSize.Small}
                      buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                      icon={IconProp.Trash}
                      onClick={() => {
                        const updated: Array<MetricQueryConfigData> = [
                          ...multiQueryConfigs,
                        ];
                        updated.splice(index, 1);
                        setMultiQueryConfigs(updated);
                        commitComponent({
                          ...component,
                          arguments: {
                            ...((component.arguments as JSONObject) || {}),
                            metricQueryConfigs: updated as any,
                          },
                        });
                      }}
                    />
                  </div>
                  <MetricQueryConfig
                    data={queryConfig}
                    metricTypes={props.metrics.metricTypes}
                    telemetryAttributes={
                      telemetryAttributesByMetric[metricName] || []
                    }
                    attributesLoading={loadingMetricAttributes.has(metricName)}
                    attributesError={telemetryAttributesError}
                    telemetryAttributeValueSuggestions={
                      attributeValueSuggestions[metricName] || {}
                    }
                    loadingAttributeValueKeys={Array.from(
                      loadingAttributeValues[metricName] || [],
                    )}
                    onMetricNameChanged={(nextMetricName: string) => {
                      void loadTelemetryAttributesForMetric(nextMetricName);
                    }}
                    onAttributeKeySelected={(attributeKey: string) => {
                      if (metricName && attributeKey) {
                        void loadAttributeValues(metricName, attributeKey);
                      }
                    }}
                    onAdvancedFiltersToggle={(show: boolean) => {
                      if (show && metricName) {
                        void loadTelemetryAttributesForMetric(metricName);
                      }
                    }}
                    onAttributesRetry={() => {
                      retryLoadTelemetryAttributes(metricName);
                    }}
                    hideCard={true}
                    onChange={(data: MetricQueryConfigData) => {
                      const updated: Array<MetricQueryConfigData> = [
                        ...multiQueryConfigs,
                      ];
                      updated[index] = data;
                      setMultiQueryConfigs(updated);
                      commitComponent({
                        ...component,
                        arguments: {
                          ...((component.arguments as JSONObject) || {}),
                          metricQueryConfigs: updated as any,
                        },
                      });
                    }}
                  />
                </div>
              );
            },
          )}

          <Button
            title="Add Query"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            icon={IconProp.Add}
            onClick={() => {
              const variableIndex: number = multiQueryConfigs.length + 1; // +1 because primary query is "a"
              const variableLetter: string = String.fromCharCode(
                97 + variableIndex,
              ); // b, c, d, ...
              const newQuery: MetricQueryConfigData = {
                metricAliasData: {
                  metricVariable: variableLetter,
                  title: undefined,
                  description: undefined,
                  legend: undefined,
                  legendUnit: undefined,
                },
                metricQueryData: {
                  filterData: {},
                  groupBy: undefined,
                },
              };
              const updated: Array<MetricQueryConfigData> = [
                ...multiQueryConfigs,
                newQuery,
              ];
              setMultiQueryConfigs(updated);
              commitComponent({
                ...component,
                arguments: {
                  ...((component.arguments as JSONObject) || {}),
                  metricQueryConfigs: updated as any,
                },
              });
            }}
          />
        </div>
      );
    };

  const renderMultiFormulaSection: () => ReactElement | null =
    (): ReactElement | null => {
      if (!hasMultiFormulaArg) {
        return null;
      }

      const queryVariables: Array<string> = [
        primaryQueryConfig?.metricAliasData?.metricVariable,
        ...multiQueryConfigs.map((q: MetricQueryConfigData) => {
          return q.metricAliasData?.metricVariable;
        }),
      ].filter((v: string | undefined): v is string => {
        return Boolean(v);
      });

      return (
        <div className="mt-4">
          {multiFormulaConfigs.map(
            (formulaConfig: MetricFormulaConfigData, index: number) => {
              /*
               * Formulas may reference any query variable plus any
               * earlier formula variable; referencing a later formula
               * would be a forward dependency the evaluator can't resolve.
               */
              const availableVariables: Array<string> = [
                ...queryVariables,
                ...multiFormulaConfigs
                  .slice(0, index)
                  .map((f: MetricFormulaConfigData) => {
                    return f.metricAliasData?.metricVariable || "";
                  })
                  .filter((v: string) => {
                    return v !== "";
                  }),
              ];

              return (
                <div
                  key={index}
                  className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Formula{" "}
                      {formulaConfig.metricAliasData?.metricVariable
                        ? `(${formulaConfig.metricAliasData.metricVariable})`
                        : index + 1}
                    </span>
                  </div>
                  <MetricFormulaConfig
                    data={formulaConfig}
                    availableVariables={availableVariables}
                    hideCard={true}
                    onDataChanged={(data: MetricFormulaConfigData) => {
                      const updated: Array<MetricFormulaConfigData> = [
                        ...multiFormulaConfigs,
                      ];
                      updated[index] = data;
                      setMultiFormulaConfigs(updated);
                      commitComponent({
                        ...component,
                        arguments: {
                          ...((component.arguments as JSONObject) || {}),
                          metricFormulaConfigs: updated as any,
                        },
                      });
                    }}
                    onRemove={() => {
                      const updated: Array<MetricFormulaConfigData> = [
                        ...multiFormulaConfigs,
                      ];
                      updated.splice(index, 1);
                      setMultiFormulaConfigs(updated);
                      commitComponent({
                        ...component,
                        arguments: {
                          ...((component.arguments as JSONObject) || {}),
                          metricFormulaConfigs: updated as any,
                        },
                      });
                    }}
                  />
                </div>
              );
            },
          )}

          <Button
            title="Add Formula"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            icon={IconProp.Calculator}
            onClick={() => {
              const newFormula: MetricFormulaConfigData = {
                metricAliasData: {
                  metricVariable: getNextUnusedVariableLetter(),
                  title: undefined,
                  description: undefined,
                  legend: undefined,
                  legendUnit: undefined,
                },
                metricFormulaData: {
                  metricFormula: "",
                },
              };
              const updated: Array<MetricFormulaConfigData> = [
                ...multiFormulaConfigs,
                newFormula,
              ];
              setMultiFormulaConfigs(updated);
              commitComponent({
                ...component,
                arguments: {
                  ...((component.arguments as JSONObject) || {}),
                  metricFormulaConfigs: updated as any,
                },
              });
            }}
          />
        </div>
      );
    };

  const sectionGroups: Array<SectionGroup> = groupArgumentsBySections();

  const hasTableColumnsArg: boolean = componentArguments.some(
    (arg: ComponentArgument<DashboardBaseComponent>): boolean => {
      return arg.type === ComponentInputType.TableColumns;
    },
  );

  const hasTableGroupByArg: boolean = componentArguments.some(
    (arg: ComponentArgument<DashboardBaseComponent>): boolean => {
      return arg.type === ComponentInputType.TableGroupBy;
    },
  );

  const tableColumnsArg: ComponentArgument<DashboardBaseComponent> | undefined =
    componentArguments.find(
      (arg: ComponentArgument<DashboardBaseComponent>): boolean => {
        return arg.type === ComponentInputType.TableColumns;
      },
    );

  const tableGroupByArg: ComponentArgument<DashboardBaseComponent> | undefined =
    componentArguments.find(
      (arg: ComponentArgument<DashboardBaseComponent>): boolean => {
        return arg.type === ComponentInputType.TableGroupBy;
      },
    );

  const renderTableDataSection: () => ReactElement | null =
    (): ReactElement | null => {
      if (!hasTableColumnsArg && !hasTableGroupByArg) {
        return null;
      }

      const args: JSONObject = (component.arguments as JSONObject) || {};
      const columns: Array<TableColumn> =
        (args["columns"] as unknown as Array<TableColumn> | undefined) || [];

      /*
       * Widget-level attribute filter (applied to every metric column).
       * Distinct metric names referenced by the table's columns; used to
       * load value suggestions for the filter's attribute keys. Suggestions
       * are unioned across those metrics so the autocomplete works no matter
       * which column the value came from.
       */
      const attributeFilters: Dictionary<DictionaryEntryValue> =
        (args["attributeFilters"] as
          | Dictionary<DictionaryEntryValue>
          | undefined) || {};

      const tableMetricNames: Array<string> = Array.from(
        new Set(
          columns
            .filter((c: TableColumn): boolean => {
              return c.kind === TableColumnKind.Metric && Boolean(c.metricName);
            })
            .map((c: TableColumn): string => {
              return c.metricName as string;
            }),
        ),
      );

      const mergedAttributeValueSuggestions: Record<string, Array<string>> = {};
      for (const metricName of tableMetricNames) {
        const perMetric: Record<
          string,
          Array<string>
        > = attributeValueSuggestions[metricName] || {};
        for (const attributeKey of Object.keys(perMetric)) {
          const merged: Set<string> = new Set<string>(
            mergedAttributeValueSuggestions[attributeKey] || [],
          );
          for (const value of perMetric[attributeKey] || []) {
            merged.add(value);
          }
          mergedAttributeValueSuggestions[attributeKey] = Array.from(merged);
        }
      }

      const writeAttributeFilters: (
        next: Dictionary<DictionaryEntryValue>,
      ) => void = (next: Dictionary<DictionaryEntryValue>): void => {
        commitComponent({
          ...component,
          arguments: {
            ...((component.arguments as JSONObject) || {}),
            attributeFilters: (next && Object.keys(next).length > 0
              ? next
              : undefined) as any,
          },
        });
      };

      /*
       * Read the new groupByAttributes shape; fall back to legacy
       * groupByAttributeKeys for widgets saved before per-attribute
       * headers existed. Both are converted into the same in-memory
       * shape and written back as groupByAttributes on any edit.
       */
      const storedGroupByAttributes: Array<TableGroupByAttribute> | undefined =
        args["groupByAttributes"] as Array<TableGroupByAttribute> | undefined;
      const legacyGroupByKeys: Array<string> =
        (args["groupByAttributeKeys"] as Array<string> | undefined) || [];
      const groupByAttributes: Array<TableGroupByAttribute> =
        storedGroupByAttributes && storedGroupByAttributes.length > 0
          ? storedGroupByAttributes
          : legacyGroupByKeys.map((key: string): TableGroupByAttribute => {
              return { key };
            });

      const attributeOptions: Array<DropdownOption> = (
        props.metrics.telemetryAttributes || []
      ).map((attr: string): DropdownOption => {
        return { value: attr, label: attr };
      });

      const selectedAttributeOptions: Array<DropdownOption> =
        attributeOptions.filter((option: DropdownOption): boolean => {
          return groupByAttributes.some((g: TableGroupByAttribute): boolean => {
            return g.key === String(option.value);
          });
        });

      const writeGroupByAttributes: (
        next: Array<TableGroupByAttribute>,
      ) => void = (next: Array<TableGroupByAttribute>): void => {
        const existingArgs: JSONObject =
          (component.arguments as JSONObject) || {};
        const cleaned: JSONObject = { ...existingArgs };
        // Drop the legacy key so the new shape is the only source of truth.
        delete cleaned["groupByAttributeKeys"];
        commitComponent({
          ...component,
          arguments: {
            ...cleaned,
            groupByAttributes: next as any,
          },
        });
      };

      const sectionName: string =
        tableColumnsArg?.section?.name ||
        tableGroupByArg?.section?.name ||
        "Data";
      const sectionDescription: string | undefined =
        tableColumnsArg?.section?.description ||
        tableGroupByArg?.section?.description;

      return (
        <div className="mt-3">
          <CollapsibleSection
            title={sectionName}
            description={sectionDescription}
            variant="bordered"
            defaultCollapsed={false}
          >
            <div>
              {hasTableGroupByArg && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700">
                    {tableGroupByArg?.name || "Group By Attributes"}
                  </label>
                  {tableGroupByArg?.description && (
                    <p className="mt-1 text-xs text-gray-500">
                      {tableGroupByArg.description}
                    </p>
                  )}
                  <div className="mt-2">
                    <Dropdown
                      options={attributeOptions}
                      isMultiSelect={true}
                      value={selectedAttributeOptions}
                      placeholder="Select attributes to group by"
                      onChange={(
                        value: DropdownValue | Array<DropdownValue> | null,
                      ): void => {
                        const keys: Array<string> = Array.isArray(value)
                          ? value.map((v: DropdownValue): string => {
                              return String(v);
                            })
                          : value
                            ? [String(value)]
                            : [];
                        /*
                         * Preserve existing custom headers for keys
                         * that survived the selection change; new keys
                         * start with the attribute key as the header.
                         */
                        const next: Array<TableGroupByAttribute> = keys.map(
                          (key: string): TableGroupByAttribute => {
                            const existing: TableGroupByAttribute | undefined =
                              groupByAttributes.find(
                                (g: TableGroupByAttribute): boolean => {
                                  return g.key === key;
                                },
                              );
                            return existing || { key };
                          },
                        );
                        writeGroupByAttributes(next);
                      }}
                    />
                  </div>

                  {groupByAttributes.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-gray-600">
                        Column headers
                      </p>
                      {groupByAttributes.map(
                        (
                          attr: TableGroupByAttribute,
                          index: number,
                        ): ReactElement => {
                          return (
                            <div
                              key={attr.key}
                              className="flex items-center gap-2"
                            >
                              <span className="text-xs text-gray-500 font-mono whitespace-nowrap min-w-[10rem]">
                                {attr.key}
                              </span>
                              <div className="flex-1">
                                <Input
                                  type={InputType.TEXT}
                                  value={attr.header || ""}
                                  placeholder={attr.key}
                                  onChange={(value: string): void => {
                                    const next: Array<TableGroupByAttribute> = [
                                      ...groupByAttributes,
                                    ];
                                    next[index] = {
                                      ...attr,
                                      header: value || undefined,
                                    };
                                    writeGroupByAttributes(next);
                                  }}
                                />
                              </div>
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              )}

              {hasTableColumnsArg && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700">
                    Filter by Attributes
                  </label>
                  <p className="mt-1 text-xs text-gray-500">
                    Optional. Only include data where these attributes match —
                    applied to every metric column. For example, filter
                    oneuptime.host.environment = production to show this table
                    for one environment/product only. Leave empty to include
                    everything.
                  </p>
                  <div className="mt-2">
                    <DictionaryForm
                      key={`${component.componentId.toString()}-attribute-filters`}
                      initialValue={attributeFilters}
                      keys={props.metrics.telemetryAttributes || []}
                      valueSuggestions={mergedAttributeValueSuggestions}
                      loadingValueKeys={Array.from(
                        new Set(
                          tableMetricNames.flatMap(
                            (metricName: string): Array<string> => {
                              return Array.from(
                                loadingAttributeValues[metricName] || [],
                              );
                            },
                          ),
                        ),
                      )}
                      addButtonSuffix="Filter"
                      keyPlaceholder="attribute (e.g. host.name)"
                      valuePlaceholder="value"
                      enableOperators={true}
                      onKeySelected={(attributeKey: string): void => {
                        for (const metricName of tableMetricNames) {
                          void loadAttributeValues(metricName, attributeKey);
                        }
                      }}
                      onChange={(
                        value: Dictionary<DictionaryEntryValue>,
                      ): void => {
                        writeAttributeFilters(value);
                      }}
                    />
                  </div>
                </div>
              )}

              {hasTableColumnsArg && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    {tableColumnsArg?.name || "Columns"}
                  </label>
                  {tableColumnsArg?.description && (
                    <p className="mt-1 text-xs text-gray-500">
                      {tableColumnsArg.description}
                    </p>
                  )}
                  <TableColumnsEditor
                    columns={columns}
                    metricTypes={props.metrics.metricTypes}
                    onChange={(next: Array<TableColumn>): void => {
                      commitComponent({
                        ...component,
                        arguments: {
                          ...((component.arguments as JSONObject) || {}),
                          columns: next as any,
                        },
                      });
                    }}
                  />
                </div>
              )}
            </div>
          </CollapsibleSection>
        </div>
      );
    };

  return (
    <div className="mb-3 mt-1">
      {componentArguments && componentArguments.length === 0 && (
        <ErrorMessage message={"This component does not take any arguments."} />
      )}
      {renderTableDataSection()}
      {sectionGroups.map((sectionGroup: SectionGroup, index: number) => {
        const isFirstSection: boolean = index === 0;
        const shouldCollapse: boolean =
          !isFirstSection && (sectionGroup.section.defaultCollapsed ?? false);

        return (
          <div key={sectionGroup.section.name} className="mt-3">
            <CollapsibleSection
              title={sectionGroup.section.name}
              description={sectionGroup.section.description}
              variant="bordered"
              defaultCollapsed={shouldCollapse}
            >
              <div>
                {renderSectionForm(sectionGroup)}
                {/* Render multi-query and multi-formula UI inside Data Source */}
                {sectionGroup.section.name === "Data Source" && (
                  <>
                    {renderMultiQuerySection()}
                    {renderMultiFormulaSection()}
                  </>
                )}
              </div>
            </CollapsibleSection>
          </div>
        );
      })}

      {/*
       * Trace charts render a bespoke, structured Query section (key/value
       * attribute filters, a searchable split-by picker, conditional max
       * series) instead of the declarative free-text fields.
       */}
      {componentType === DashboardComponentType.TraceChart && (
        <div className="mt-3">
          <TraceChartQueryEditor
            component={component}
            onChange={commitComponent}
          />
        </div>
      )}

      {/* If no Data Source section exists, render multi-query/formula at end */}
      {!sectionGroups.some((g: SectionGroup) => {
        return g.section.name === "Data Source";
      }) && (
        <>
          {renderMultiQuerySection()}
          {renderMultiFormulaSection()}
        </>
      )}
    </div>
  );
};

export default ArgumentsForm;
