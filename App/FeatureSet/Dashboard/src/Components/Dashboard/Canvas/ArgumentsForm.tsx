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
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import EntityFilterDropdown from "./EntityFilterDropdown";

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
          arg.type === ComponentInputType.MetricsFormulaConfigs
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
      return (
        <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
          <div className="mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Query 1
            </span>
          </div>
          <MetricQueryConfig
            {...componentProps}
            data={value[arg.id] as MetricQueryConfigData}
            metricTypes={props.metrics.metricTypes}
            telemetryAttributes={props.metrics.telemetryAttributes}
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
          commitComponent({
            ...component,
            arguments: {
              ...((component.arguments as JSONObject) || {}),
              ...((values as JSONObject) || {}),
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
                    telemetryAttributes={props.metrics.telemetryAttributes}
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

  return (
    <div className="mb-3 mt-1">
      {componentArguments && componentArguments.length === 0 && (
        <ErrorMessage message={"This component does not take any arguments."} />
      )}
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
