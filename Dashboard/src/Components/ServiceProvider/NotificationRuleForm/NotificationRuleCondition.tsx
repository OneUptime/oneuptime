import ServiceProviderNotificationRule from "Common/Models/DatabaseModels/ServiceProviderNotificationRule";
import NotificationRuleConditionUiUtil from "../../../Utils/Form/Monitor/NotificationRuleCondition";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ServiceProviderType from "Common/Types/ServiceProvider/ServiceProviderType";
import Button, {
    ButtonSize,
    ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import Dropdown, {
    DropdownOption,
    DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import BaseNotificationRule from "Common/Types/ServiceProvider/NotificationRules/BaseNotificationRule";
import NotificationRuleCondition from "Common/Types/ServiceProvider/NotificationRules/NotificationRuleCondition"
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";

export interface ComponentProps {
    initialValue: NotificationRuleCondition | undefined;
    onChange?: undefined | ((value: NotificationRuleCondition) => void);
    onDelete?: undefined | (() => void);
    serviceProviderType: ServiceProviderType;
    eventType: NotificationRuleEventType;
    notificationRule: BaseNotificationRule;
    monitors: Array<Monitor>;
    labels: Array<Label>;
    alertStates: Array<AlertState>;
    incidentStates: Array<IncidentState>;
    scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
    monitorStatus: Array<MonitorStatus>;
}

const NotificationRuleConditionFormElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {


    const [notificationRuleCondition, setNotificationRuleCondition] = React.useState<
        NotificationRuleCondition | undefined
    >(props.initialValue);

    const [valuePlaceholder, setValuePlaceholder] = React.useState<string>("");

    const [checkOnOptions, setCheckOnOptions] = React.useState<
        Array<DropdownOption>
    >([]);

    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    useEffect(() => {
        setCheckOnOptions(
            NotificationRuleConditionUiUtil.getCheckOnOptionsByMonitorType(props.monitorType),
        );
        setIsLoading(false);
    }, [props.monitorType]);

    const [filterTypeOptions, setFilterTypeOptions] = React.useState<
        Array<DropdownOption>
    >([]);

    useEffect(() => {
        setFilterTypeOptions(
            notificationRuleCondition?.checkOn
                ? NotificationRuleConditionUiUtil.getFilterTypeOptionsByCheckOn(
                    notificationRuleCondition?.checkOn,
                )
                : [],
        );
        setValuePlaceholder(
            notificationRuleCondition?.checkOn
                ? NotificationRuleConditionUiUtil.getFilterTypePlaceholderValueByCheckOn({
                    monitorType: props.monitorType,
                    checkOn: notificationRuleCondition?.checkOn,
                })
                : "",
        );
    }, [notificationRuleCondition]);

    useEffect(() => {
        if (props.onChange && notificationRuleCondition) {
            props.onChange(notificationRuleCondition);
        }
    }, [notificationRuleCondition]);

    if (isLoading) {
        return <></>;
    }

    const filterConditionValue: DropdownOption | undefined =
        filterTypeOptions.find((i: DropdownOption) => {
            return i.value === notificationRuleCondition?.filterType;
        });

    const evaluateOverTimeMinutesValue: DropdownOption | undefined =
        NotificationRuleConditionUiUtil.getEvaluateOverTimeMinutesOptions().find(
            (item: DropdownOption) => {
                return (
                    item.value ===
                    notificationRuleCondition?.evaluateOverTimeOptions?.timeValueInMinutes
                );
            },
        );

    const evalOverTimeDropdownOptions: Array<DropdownOption> =
        NotificationRuleConditionUtil.getEvaluateOverTimeTypeByNotificationRuleCondition(
            notificationRuleCondition,
        ).map((item: EvaluateOverTimeType) => {
            return {
                value: item,
                label: item,
            };
        });

    const evaluateOverTimeTypeValue: DropdownOption | undefined =
        evalOverTimeDropdownOptions.find((item: DropdownOption) => {
            return (
                item.value ===
                notificationRuleCondition?.evaluateOverTimeOptions?.evaluateOverTimeType
            );
        });

    const metricAggregationOptions: Array<DropdownOption> = [
        ...evalOverTimeDropdownOptions,
    ]; // evalOverTimeDropdownOptions and metricAggregationOptions are same

    const metricAggregationValue: DropdownOption | undefined =
        metricAggregationOptions.find((i: DropdownOption) => {
            return (
                i.value === notificationRuleCondition?.metricMonitorOptions?.metricAggregationType
            );
        });

    let metricVariables: Array<string> =
        props.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs?.map(
            (queryConfig: MetricQueryConfigData) => {
                return queryConfig.metricAliasData?.metricVariable || "";
            },
        ) || [];

    // push formula variables as well.
    props.monitorStep.data?.metricMonitor?.metricViewConfig?.formulaConfigs?.forEach(
        (formulaConfig: MetricFormulaConfigData) => {
            metricVariables.push(formulaConfig.metricAliasData.metricVariable || "");
        },
    );

    // remove duplicates and empty strings

    metricVariables = metricVariables.filter((item: string, index: number) => {
        return metricVariables.indexOf(item) === index && item !== "";
    });

    // now make this into dropdown options.
    const metricVariableOptions: Array<DropdownOption> = metricVariables.map(
        (item: string) => {
            return {
                value: item,
                label: item,
            };
        },
    );

    let selectedMetricVariableOption: DropdownOption | undefined =
        metricVariableOptions.find((i: DropdownOption) => {
            return i.value === notificationRuleCondition?.metricMonitorOptions?.metricAlias;
        });

    if (!selectedMetricVariableOption) {
        // select first varoable.
        selectedMetricVariableOption = metricVariableOptions[0];
    }

    return (
        <div>
            <div className="rounded-md p-2 bg-gray-50 my-5 border-gray-200 border-solid border-2">
                <div className="">
                    <FieldLabelElement title="Filter Type" />
                    <Dropdown
                        value={checkOnOptions.find((i: DropdownOption) => {
                            return i.value === notificationRuleCondition?.checkOn;
                        })}
                        options={checkOnOptions}
                        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
                            setNotificationRuleCondition({
                                checkOn: value?.toString() as CheckOn,
                                filterType: undefined,
                                value: undefined,
                                eveluateOverTime: false,
                                evaluateOverTimeOptions: undefined,
                            });
                        }}
                    />
                </div>

                {notificationRuleCondition?.checkOn &&
                    notificationRuleCondition?.checkOn === CheckOn.DiskUsagePercent && (
                        <div className="mt-1">
                            <FieldLabelElement title="Disk Path" />

                            <Input
                                placeholder={"C:\\ or /mnt/data or /dev/sda1"}
                                value={notificationRuleCondition?.serverMonitorOptions?.diskPath?.toString()}
                                onChange={(value: string) => {
                                    setNotificationRuleCondition({
                                        ...notificationRuleCondition,
                                        serverMonitorOptions: {
                                            diskPath: value,
                                        },
                                    });
                                }}
                            />
                        </div>
                    )}

                {notificationRuleCondition?.checkOn &&
                    notificationRuleCondition?.checkOn === CheckOn.MetricValue && (
                        <div className="mt-1">
                            <FieldLabelElement title="Select Metric Variable" />
                            <Dropdown
                                value={selectedMetricVariableOption}
                                options={metricVariableOptions}
                                onChange={(
                                    value: DropdownValue | Array<DropdownValue> | null,
                                ) => {
                                    setNotificationRuleCondition({
                                        ...notificationRuleCondition,
                                        metricMonitorOptions: {
                                            ...notificationRuleCondition?.metricMonitorOptions,
                                            metricAlias: value?.toString(),
                                        },
                                    });
                                }}
                            />
                        </div>
                    )}

                {notificationRuleCondition?.checkOn &&
                    notificationRuleCondition?.checkOn === CheckOn.MetricValue && (
                        <div className="mt-1">
                            <FieldLabelElement title="Select Aggregation" />
                            <Dropdown
                                value={metricAggregationValue}
                                options={metricAggregationOptions}
                                onChange={(
                                    value: DropdownValue | Array<DropdownValue> | null,
                                ) => {
                                    setNotificationRuleCondition({
                                        ...notificationRuleCondition,
                                        metricMonitorOptions: {
                                            ...notificationRuleCondition?.metricMonitorOptions,
                                            metricAggregationType:
                                                value?.toString() as EvaluateOverTimeType,
                                        },
                                    });
                                }}
                            />
                        </div>
                    )}

                {/** checkbox for evaluateOverTime */}

                {notificationRuleCondition?.checkOn &&
                    NotificationRuleConditionUtil.isEvaluateOverTimeFilter(
                        notificationRuleCondition?.checkOn,
                    ) && (
                        <div className="mt-3">
                            <CheckboxElement
                                value={notificationRuleCondition?.eveluateOverTime}
                                title={"Evaluate this criteria over a period of time"}
                                onChange={(value: boolean) => {
                                    setNotificationRuleCondition({
                                        ...notificationRuleCondition,
                                        eveluateOverTime: value,
                                    });
                                }}
                            />
                        </div>
                    )}

                {notificationRuleCondition?.checkOn &&
                    notificationRuleCondition?.checkOn &&
                    NotificationRuleConditionUtil.isEvaluateOverTimeFilter(notificationRuleCondition?.checkOn) &&
                    notificationRuleCondition.eveluateOverTime ? (
                    <div className="mt-1">
                        <FieldLabelElement title="Evaluate" />
                        <Dropdown
                            value={evaluateOverTimeTypeValue}
                            options={evalOverTimeDropdownOptions}
                            onChange={(
                                value: DropdownValue | Array<DropdownValue> | null,
                            ) => {
                                const evaluateOverTimeOption: EvaluateOverTimeOptions =
                                    notificationRuleCondition?.evaluateOverTimeOptions
                                        ? {
                                            ...notificationRuleCondition?.evaluateOverTimeOptions,
                                        }
                                        : {
                                            timeValueInMinutes: 5,
                                            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                                        };

                                setNotificationRuleCondition({
                                    ...notificationRuleCondition,
                                    eveluateOverTime: true,
                                    evaluateOverTimeOptions: {
                                        ...evaluateOverTimeOption,
                                        evaluateOverTimeType:
                                            value?.toString() as EvaluateOverTimeType,
                                    },
                                });
                            }}
                        />
                    </div>
                ) : (
                    <></>
                )}

                {notificationRuleCondition?.checkOn &&
                    notificationRuleCondition?.checkOn &&
                    NotificationRuleConditionUtil.isEvaluateOverTimeFilter(notificationRuleCondition?.checkOn) &&
                    notificationRuleCondition.eveluateOverTime ? (
                    <div className="mt-1">
                        <FieldLabelElement title="For the last (in minutes)" />
                        <Dropdown
                            value={evaluateOverTimeMinutesValue}
                            options={NotificationRuleConditionUiUtil.getEvaluateOverTimeMinutesOptions()}
                            onChange={(
                                value: DropdownValue | Array<DropdownValue> | null,
                            ) => {
                                const evaluateOverTimeOption: EvaluateOverTimeOptions =
                                    notificationRuleCondition?.evaluateOverTimeOptions
                                        ? {
                                            ...notificationRuleCondition?.evaluateOverTimeOptions,
                                        }
                                        : {
                                            timeValueInMinutes: 5,
                                            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
                                        };

                                setNotificationRuleCondition({
                                    ...notificationRuleCondition,
                                    eveluateOverTime: true,
                                    evaluateOverTimeOptions: {
                                        ...evaluateOverTimeOption,
                                        timeValueInMinutes: value as number,
                                    },
                                });
                            }}
                        />
                    </div>
                ) : (
                    <></>
                )}

                {!notificationRuleCondition?.checkOn ||
                    (notificationRuleCondition?.checkOn && (
                        <div className="mt-1">
                            <FieldLabelElement title="Filter Condition" />
                            <Dropdown
                                value={filterConditionValue}
                                options={filterTypeOptions}
                                onChange={(
                                    value: DropdownValue | Array<DropdownValue> | null,
                                ) => {
                                    setNotificationRuleCondition({
                                        ...notificationRuleCondition,
                                        filterType: value?.toString() as FilterType,
                                        value: undefined,
                                    });
                                }}
                            />
                        </div>
                    ))}

                {!notificationRuleCondition?.checkOn ||
                    (notificationRuleCondition?.checkOn &&
                        NotificationRuleConditionUiUtil.hasValueField({
                            checkOn: notificationRuleCondition?.checkOn,
                            filterType: notificationRuleCondition?.filterType,
                        }) &&
                        !NotificationRuleConditionUiUtil.isDropdownValueField({
                            checkOn: notificationRuleCondition?.checkOn,
                        }) && (
                            <div className="mt-1">
                                <FieldLabelElement title="Value" />
                                <Input
                                    placeholder={valuePlaceholder}
                                    value={notificationRuleCondition?.value?.toString()}
                                    onChange={(value: string) => {
                                        setNotificationRuleCondition({
                                            ...notificationRuleCondition,
                                            value: value || "",
                                        });
                                    }}
                                />
                            </div>
                        ))}

                {!notificationRuleCondition?.checkOn ||
                    (notificationRuleCondition?.checkOn &&
                        NotificationRuleConditionUiUtil.hasValueField({
                            checkOn: notificationRuleCondition?.checkOn,
                            filterType: notificationRuleCondition?.filterType,
                        }) &&
                        NotificationRuleConditionUiUtil.isDropdownValueField({
                            checkOn: notificationRuleCondition?.checkOn,
                        }) && (
                            <div className="mt-1">
                                <FieldLabelElement title="Value" />
                                <Dropdown
                                    options={NotificationRuleConditionUiUtil.getDropdownOptionsByCheckOn({
                                        checkOn: notificationRuleCondition?.checkOn,
                                    })}
                                    value={NotificationRuleConditionUiUtil.getDropdownOptionsByCheckOn({
                                        checkOn: notificationRuleCondition?.checkOn,
                                    }).find((i: DropdownOption) => {
                                        return i.value === notificationRuleCondition?.value;
                                    })}
                                    onChange={(
                                        value: DropdownValue | Array<DropdownValue> | null,
                                    ) => {
                                        setNotificationRuleCondition({
                                            ...notificationRuleCondition,
                                            value: value?.toString(),
                                        });
                                    }}
                                />
                            </div>
                        ))}

                <div className="mt-3 -mr-2 w-full flex justify-end">
                    <Button
                        title="Delete Filter"
                        buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                        icon={IconProp.Trash}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                            props.onDelete?.();
                        }}
                    />
                </div>
            </div>
            {notificationRuleCondition?.checkOn === CheckOn.JavaScriptExpression ? (
                <div className="mt-1 text-sm text-gray-500 underline">
                    <Link
                        to={Route.fromString("/docs/monitor/javascript-expression")}
                        openInNewTab={true}
                    >
                        <p> Read documentation for using JavaScript expressions here. </p>
                    </Link>{" "}
                </div>
            ) : (
                <></>
            )}
        </div>
    );
};

export default NotificationRuleConditionFormElement;
