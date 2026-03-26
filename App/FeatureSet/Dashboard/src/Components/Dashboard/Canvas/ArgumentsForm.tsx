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
} from "Common/Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentsUtil from "Common/Utils/Dashboard/Components/Index";
import ComponentInputTypeToFormFieldType from "./ComponentInputTypeToFormFieldType";
import BasicForm, { FormProps } from "Common/UI/Components/Forms/BasicForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import MetricQueryConfig from "../../Metrics/MetricQueryConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import CollapsibleSection from "Common/UI/Components/CollapsibleSection/CollapsibleSection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

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
    (
      ((props.component?.arguments as JSONObject)?.[
        "metricQueryConfigs"
      ] as unknown as Array<MetricQueryConfigData>) || []
    ),
  );

  useEffect(() => {
    if (props.onHasFormValidationErrors) {
      props.onHasFormValidationErrors(hasFormValidationErrors);
    }
  }, [hasFormValidationErrors]);

  useEffect(() => {
    props.onFormChange(component);
  }, [component]);

  useEffect(() => {
    setComponent(props.component);
  }, [props.component]);

  const componentType: DashboardComponentType = component.componentType;
  const componentArguments: Array<ComponentArgument<DashboardBaseComponent>> =
    DashboardComponentsUtil.getComponentSettingsArguments(componentType);

  // Group arguments by section
  const groupArgumentsBySections: () => Array<SectionGroup> = (): Array<SectionGroup> => {
    const sectionMap: Map<string, SectionGroup> = new Map();
    const unsectionedArgs: Array<ComponentArgument<DashboardBaseComponent>> =
      [];

    for (const arg of componentArguments) {
      // Skip MetricsQueryConfigs - we render it as a custom multi-query UI
      if (arg.type === ComponentInputType.MetricsQueryConfigs) {
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
    ).sort(
      (a: SectionGroup, b: SectionGroup) =>
        a.section.order - b.section.order,
    );
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
        <MetricQueryConfig
          {...componentProps}
          data={value[arg.id] as MetricQueryConfigData}
          metricTypes={props.metrics.metricTypes}
          telemetryAttributes={props.metrics.telemetryAttributes}
          hideCard={true}
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
    return undefined;
  };

  const renderSectionForm: (
    sectionGroup: SectionGroup,
  ) => ReactElement = (sectionGroup: SectionGroup): ReactElement => {
    const sectionKey: string = sectionGroup.section.name;

    return (
      <BasicForm
        hideSubmitButton={true}
        ref={(ref: FormProps<FormValues<JSONObject>> | null) => {
          formRefs.current[sectionKey] = ref;
        }}
        values={{
          ...(component?.arguments || {}),
        }}
        onChange={(values: FormValues<JSONObject>) => {
          setComponent({
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
    (arg: ComponentArgument<DashboardBaseComponent>) =>
      arg.type === ComponentInputType.MetricsQueryConfigs,
  );

  const multiQueryArg: ComponentArgument<DashboardBaseComponent> | undefined =
    componentArguments.find(
      (arg: ComponentArgument<DashboardBaseComponent>) =>
        arg.type === ComponentInputType.MetricsQueryConfigs,
    );

  const renderMultiQuerySection: () => ReactElement | null =
    (): ReactElement | null => {
      if (!hasMultiQueryArg || !multiQueryArg) {
        return null;
      }

      return (
        <div className="mt-3">
          <CollapsibleSection
            title="Additional Queries"
            description="Overlay more metric series on the same chart"
            variant="bordered"
            defaultCollapsed={multiQueryConfigs.length === 0}
          >
            <div>
              {multiQueryConfigs.length === 0 && (
                <p className="text-sm text-gray-400 mb-3">
                  No additional queries yet. Add one to overlay multiple metrics
                  on the same chart.
                </p>
              )}

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
                            setComponent({
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
                          setComponent({
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
                  const newQuery: MetricQueryConfigData = {
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
                  setComponent({
                    ...component,
                    arguments: {
                      ...((component.arguments as JSONObject) || {}),
                      metricQueryConfigs: updated as any,
                    },
                  });
                }}
              />
            </div>
          </CollapsibleSection>
        </div>
      );
    };

  const sectionGroups: Array<SectionGroup> = groupArgumentsBySections();

  return (
    <div className="mb-3 mt-1">
      {componentArguments && componentArguments.length === 0 && (
        <ErrorMessage
          message={"This component does not take any arguments."}
        />
      )}
      {sectionGroups.map(
        (sectionGroup: SectionGroup, index: number) => {
          const isFirstSection: boolean = index === 0;
          const shouldCollapse: boolean =
            !isFirstSection &&
            (sectionGroup.section.defaultCollapsed ?? false);

          return (
            <div key={sectionGroup.section.name} className="mt-3">
              <CollapsibleSection
                title={sectionGroup.section.name}
                description={sectionGroup.section.description}
                variant="bordered"
                defaultCollapsed={shouldCollapse}
              >
                <div>{renderSectionForm(sectionGroup)}</div>
              </CollapsibleSection>

              {/* Render multi-query section after the Data Source section */}
              {sectionGroup.section.name === "Data Source" &&
                renderMultiQuerySection()}
            </div>
          );
        },
      )}

      {/* If no Data Source section but has multi-query, render at end */}
      {!sectionGroups.some(
        (g: SectionGroup) => g.section.name === "Data Source",
      ) && renderMultiQuerySection()}
    </div>
  );
};

export default ArgumentsForm;
