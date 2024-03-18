import IconProp from 'Common/Types/Icon/IconProp';
import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from 'CommonUI/src/Components/Button/Button';
import Dropdown, {
    DropdownOption,
    DropdownValue,
} from 'CommonUI/src/Components/Dropdown/Dropdown';
import Input from 'CommonUI/src/Components/Input/Input';
import Link from 'CommonUI/src/Components/Link/Link';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import FieldLabelElement from 'CommonUI/src/Components/Detail/FieldLabel';
import Route from 'Common/Types/API/Route';

export interface ComponentProps {
    initialValue: CriteriaFilter | undefined;
    onChange?: undefined | ((value: CriteriaFilter) => void);
    onDelete?: undefined | (() => void);
    monitorType: MonitorType;
}

const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [criteriaFilter, setCriteriaFilter] = React.useState<
        CriteriaFilter | undefined
    >(props.initialValue);

    const [valuePlaceholder, setValuePlaceholder] = React.useState<string>('');

    const [checkOnOptions, setCheckOnOptions] = React.useState<
        Array<DropdownOption>
    >([]);

    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    useEffect(() => {
        let options: Array<DropdownOption> =
            DropdownUtil.getDropdownOptionsFromEnum(CheckOn);

        if (
            props.monitorType === MonitorType.Ping ||
            props.monitorType === MonitorType.IP ||
            props.monitorType === MonitorType.Port
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IsOnline ||
                    i.value === CheckOn.ResponseTime
                );
            });
        }

        if (props.monitorType === MonitorType.Server) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IsOnline ||
                    i.value === CheckOn.DiskUsagePercent ||
                    i.value === CheckOn.CPUUsagePercent ||
                    i.value === CheckOn.MemoryUsagePercent
                );
            });
        }

        if (props.monitorType === MonitorType.IncomingRequest) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IncomingRequest ||
                    i.value === CheckOn.RequestBody ||
                    i.value === CheckOn.RequestHeader ||
                    i.value === CheckOn.RequestHeaderValue ||
                    i.value === CheckOn.JavaScriptExpression
                );
            });
        }

        if (
            props.monitorType === MonitorType.Website ||
            props.monitorType === MonitorType.API
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IsOnline ||
                    i.value === CheckOn.ResponseTime ||
                    i.value === CheckOn.ResponseBody ||
                    i.value === CheckOn.ResponseHeader ||
                    i.value === CheckOn.ResponseHeaderValue ||
                    i.value === CheckOn.ResponseStatusCode ||
                    i.value === CheckOn.JavaScriptExpression
                );
            });
        }

        setCheckOnOptions(options);
        setIsLoading(false);
    }, [props.monitorType]);

    const [filterTypeOptions, setFilterTypeOptions] = React.useState<
        Array<DropdownOption>
    >([]);

    useEffect(() => {
        let options: Array<DropdownOption> =
            DropdownUtil.getDropdownOptionsFromEnum(FilterType);

        if (!criteriaFilter?.checkOn) {
            setFilterTypeOptions([]);
        }

        if (criteriaFilter?.checkOn === CheckOn.ResponseTime) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.GreaterThan ||
                    i.value === FilterType.LessThan ||
                    i.value === FilterType.LessThanOrEqualTo ||
                    i.value === FilterType.GreaterThanOrEqualTo
                );
            });

            setValuePlaceholder('5000');
        }

        if (
            criteriaFilter?.checkOn === CheckOn.CPUUsagePercent ||
            criteriaFilter?.checkOn === CheckOn.DiskUsagePercent ||
            criteriaFilter?.checkOn === CheckOn.MemoryUsagePercent
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.GreaterThan ||
                    i.value === FilterType.LessThan ||
                    i.value === FilterType.LessThanOrEqualTo ||
                    i.value === FilterType.GreaterThanOrEqualTo
                );
            });

            setValuePlaceholder('65');
        }

        if (criteriaFilter?.checkOn === CheckOn.IncomingRequest) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.NotRecievedInMinutes ||
                    i.value === FilterType.RecievedInMinutes
                );
            });
        }

        if (criteriaFilter?.checkOn === CheckOn.IsOnline) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.True || i.value === FilterType.False
                );
            });
        }

        if (
            criteriaFilter?.checkOn === CheckOn.ResponseBody ||
            criteriaFilter?.checkOn === CheckOn.ResponseHeader ||
            criteriaFilter?.checkOn === CheckOn.ResponseHeaderValue ||
            criteriaFilter?.checkOn === CheckOn.RequestBody ||
            criteriaFilter?.checkOn === CheckOn.RequestHeader ||
            criteriaFilter?.checkOn === CheckOn.RequestHeaderValue
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.Contains ||
                    i.value === FilterType.NotContains
                );
            });

            setValuePlaceholder('Some Text');
        }

        if (criteriaFilter?.checkOn === CheckOn.JavaScriptExpression) {
            options = options.filter((i: DropdownOption) => {
                return i.value === FilterType.EvaluatesToTrue;
            });

            if (props.monitorType === MonitorType.IncomingRequest) {
                setValuePlaceholder('{{requestBody.result}} === true');
            } else {
                setValuePlaceholder('{{responseBody.result}} === true');
            }
        }

        if (criteriaFilter?.checkOn === CheckOn.ResponseStatusCode) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.GreaterThan ||
                    i.value === FilterType.LessThan ||
                    i.value === FilterType.LessThanOrEqualTo ||
                    i.value === FilterType.GreaterThanOrEqualTo ||
                    i.value === FilterType.EqualTo ||
                    i.value === FilterType.NotEqualTo
                );
            });

            setValuePlaceholder('200');
        }

        setFilterTypeOptions(options);
    }, [criteriaFilter]);

    useEffect(() => {
        if (props.onChange && criteriaFilter) {
            props.onChange(criteriaFilter);
        }
    }, [criteriaFilter]);

    if (isLoading) {
        return <></>;
    }

    return (
        <div>
            <div className="rounded-md p-2 bg-gray-50 my-5 border-gray-200 border-solid border-2">
                <div className="">
                    <FieldLabelElement title="Filter Type" />
                    <Dropdown
                        initialValue={checkOnOptions.find(
                            (i: DropdownOption) => {
                                return i.value === criteriaFilter?.checkOn;
                            }
                        )}
                        options={checkOnOptions}
                        onChange={(
                            value: DropdownValue | Array<DropdownValue> | null
                        ) => {
                            setCriteriaFilter({
                                checkOn: value?.toString() as CheckOn,
                                filterType: undefined,
                                value: undefined,
                            });
                        }}
                    />
                </div>

                {criteriaFilter?.checkOn &&
                    criteriaFilter?.checkOn === CheckOn.DiskUsagePercent && (
                        <div className="mt-1">
                            <FieldLabelElement title="Disk Path" />

                            <Input
                                placeholder={'C:\\ or /mnt/data or /dev/sda1'}
                                initialValue={criteriaFilter?.serverMonitorOptions?.diskPath?.toString()}
                                onChange={(value: string) => {
                                    setCriteriaFilter({
                                        ...criteriaFilter,
                                        serverMonitorOptions: {
                                            diskPath: value,
                                        },
                                    });
                                }}
                            />
                        </div>
                    )}

                {!criteriaFilter?.checkOn ||
                    (criteriaFilter?.checkOn && (
                        <div className="mt-1">
                            <FieldLabelElement title="Filter Condition" />
                            <Dropdown
                                initialValue={filterTypeOptions.find(
                                    (i: DropdownOption) => {
                                        return (
                                            i.value ===
                                            criteriaFilter?.filterType
                                        );
                                    }
                                )}
                                options={filterTypeOptions}
                                onChange={(
                                    value:
                                        | DropdownValue
                                        | Array<DropdownValue>
                                        | null
                                ) => {
                                    setCriteriaFilter({
                                        checkOn:
                                            criteriaFilter?.checkOn ||
                                            CheckOn.IsOnline,
                                        filterType:
                                            value?.toString() as FilterType,
                                        value: criteriaFilter?.value || '',
                                    });
                                }}
                            />
                        </div>
                    ))}

                {!criteriaFilter?.checkOn ||
                    (criteriaFilter?.checkOn &&
                        criteriaFilter?.checkOn !== CheckOn.IsOnline && (
                            <div className="mt-1">
                                <FieldLabelElement title="Value" />
                                <Input
                                    placeholder={valuePlaceholder}
                                    initialValue={criteriaFilter?.value?.toString()}
                                    onChange={(value: string) => {
                                        setCriteriaFilter({
                                            checkOn:
                                                criteriaFilter?.checkOn ||
                                                CheckOn.IsOnline,
                                            filterType:
                                                criteriaFilter?.filterType ||
                                                FilterType.EqualTo,
                                            value: value || '',
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
            {criteriaFilter?.checkOn === CheckOn.JavaScriptExpression ? (
                <div className="mt-1 text-sm text-gray-500 underline">
                    <Link
                        to={Route.fromString(
                            '/docs/monitor/javascript-expression'
                        )}
                        openInNewTab={true}
                    >
                        <p>
                            {' '}
                            Read documentation for using JavaScript expressions
                            here.{' '}
                        </p>
                    </Link>{' '}
                </div>
            ) : (
                <></>
            )}
        </div>
    );
};

export default CriteriaFilterElement;
