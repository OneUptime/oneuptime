import Button, { ButtonSize, ButtonStyleType } from '../Button/Button';
import Input, { InputType } from '../Input/Input';
import FieldType from '../Types/FieldType';
import Filter from './Types/Filter';
import FilterData from './Types/FilterData';
import InBetween from 'Common/Types/BaseDatabase/InBetween';
import OneUptimeDate from 'Common/Types/Date';
import GenericObject from 'Common/Types/GenericObject';
import React, { ReactElement, useEffect } from 'react';

export interface ComponentProps<T extends GenericObject> {
    filter: Filter<T>;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    filterData: FilterData<T>;
}

type DateFilterFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const DateFilter: DateFilterFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    const filter: Filter<T> = props.filter;
    const filterData: FilterData<T> = { ...props.filterData };

    const [startDateTime, setStartDateTime] = React.useState<Date | null>(null);
    const [endDateTime, setEndDateTime] = React.useState<Date | null>(null);

    const [startDateError, setStartDateError] = React.useState<string>('');
    const [endDateError, setEndDateError] = React.useState<string>('');

    let inputType: InputType = InputType.TEXT;

    if (filter.type === FieldType.Date) {
        inputType = InputType.DATE;
    } else if (filter.type === FieldType.DateTime) {
        inputType = InputType.DATETIME_LOCAL;
    }

    useEffect(() => {
        // prefill the date filter if it is already set

        if (
            filterData[filter.key] &&
            filterData[filter.key] instanceof InBetween
        ) {
            const inBetween: InBetween = filterData[filter.key] as InBetween;

            if (inBetween.startValue) {
                setStartDateTime(
                    OneUptimeDate.fromString(inBetween.startValue as string)
                );
            }

            if (inBetween.endValue) {
                setEndDateTime(
                    OneUptimeDate.fromString(inBetween.endValue as string)
                );
            }
        }
    }, []);

    useEffect(() => {
        if (startDateTime && endDateTime) {
            // check if start date is after end date

            if (!OneUptimeDate.isAfter(endDateTime, startDateTime)) {
                setStartDateError('Start date should be before end date');
                setEndDateError('End date should be after start date');
                delete filterData[filter.key];

                props.onFilterChanged && props.onFilterChanged(filterData);

                return;
            }

            filterData[filter.key] = new InBetween(startDateTime, endDateTime);
        }

        if (!startDateTime || !endDateTime) {
            delete filterData[filter.key];
        }

        if (startDateTime && !endDateTime) {
            setStartDateError('');
            setEndDateError('End date is required');
        } else if (!startDateTime && endDateTime) {
            setEndDateError('');
            setStartDateError('Start date is required');
        } else {
            setStartDateError('');
            setEndDateError('');
        }

        props.onFilterChanged && props.onFilterChanged(filterData);
    }, [startDateTime, endDateTime]);

    if (
        !filter.filterDropdownOptions &&
        (filter.type === FieldType.Date || filter.type === FieldType.DateTime)
    ) {
        return (
            <div>
                <div className="flex space-x-3 mt-1">
                    <div className="w-1/2">
                        <div className="text-xs text-gray-500">From:</div>
                        <div>
                            <Input
                                error={startDateError}
                                onChange={(changedValue: string | Date) => {
                                    if (filter.key) {
                                        if (!changedValue) {
                                            setStartDateTime(null);
                                        }

                                        if (
                                            changedValue &&
                                            (filter.type === FieldType.Date ||
                                                filter.type ===
                                                    FieldType.DateTime)
                                        ) {
                                            setStartDateTime(
                                                OneUptimeDate.fromString(
                                                    changedValue as string
                                                )
                                            );
                                        }
                                    }
                                }}
                                value={startDateTime || ''}
                                placeholder={`Filter by ${filter.title}`}
                                type={inputType}
                            />
                        </div>
                    </div>
                    <div className="w-1/2">
                        <div className="text-xs text-gray-500">To:</div>
                        <div>
                            <Input
                                error={endDateError}
                                onChange={(changedValue: string | Date) => {
                                    if (filter.key) {
                                        if (!changedValue) {
                                            setEndDateTime(null);
                                        }

                                        if (
                                            changedValue &&
                                            (filter.type === FieldType.Date ||
                                                filter.type ===
                                                    FieldType.DateTime)
                                        ) {
                                            setEndDateTime(
                                                OneUptimeDate.fromString(
                                                    changedValue as string
                                                )
                                            );
                                        }
                                    }
                                }}
                                value={endDateTime || ''}
                                placeholder={`Filter by ${filter.title}`}
                                type={inputType}
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-1 flex space-x-2 -ml-3">
                    {filter.type === FieldType.DateTime && (
                        <Button
                            buttonStyle={ButtonStyleType.NORMAL}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                                // set it to past 1 hour
                                const endDate: Date =
                                    OneUptimeDate.getCurrentDate();
                                const startDate: Date =
                                    OneUptimeDate.addRemoveHours(endDate, -1);

                                setStartDateTime(startDate);
                                setEndDateTime(endDate);
                            }}
                            title="1 hour"
                        />
                    )}

                    {filter.type === FieldType.DateTime && (
                        <Button
                            buttonStyle={ButtonStyleType.NORMAL}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                                // set it to past 3 hour
                                const endDate: Date =
                                    OneUptimeDate.getCurrentDate();
                                const startDate: Date =
                                    OneUptimeDate.addRemoveHours(endDate, -3);

                                setStartDateTime(startDate);
                                setEndDateTime(endDate);
                            }}
                            title="3 hours"
                        />
                    )}

                    <Button
                        buttonStyle={ButtonStyleType.NORMAL}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                            // set it to past 1 day
                            const endDate: Date =
                                OneUptimeDate.getCurrentDate();
                            const startDate: Date = OneUptimeDate.addRemoveDays(
                                endDate,
                                -1
                            );

                            setStartDateTime(startDate);
                            setEndDateTime(endDate);
                        }}
                        title="1 days"
                    />

                    <Button
                        buttonStyle={ButtonStyleType.NORMAL}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                            // set it to past 1 week
                            const endDate: Date =
                                OneUptimeDate.getCurrentDate();
                            const startDate: Date = OneUptimeDate.addRemoveDays(
                                endDate,
                                -7
                            );

                            setStartDateTime(startDate);
                            setEndDateTime(endDate);
                        }}
                        title="1 week"
                    />

                    {filter.type === FieldType.Date && (
                        <Button
                            buttonStyle={ButtonStyleType.NORMAL}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                                // set it to past 1 week
                                const endDate: Date =
                                    OneUptimeDate.getCurrentDate();
                                const startDate: Date =
                                    OneUptimeDate.addRemoveDays(endDate, -14);

                                setStartDateTime(startDate);
                                setEndDateTime(endDate);
                            }}
                            title="2 weeks"
                        />
                    )}

                    {filter.type === FieldType.Date && (
                        <Button
                            buttonStyle={ButtonStyleType.NORMAL}
                            buttonSize={ButtonSize.Small}
                            onClick={() => {
                                // set it to past 1 week
                                const endDate: Date =
                                    OneUptimeDate.getCurrentDate();
                                const startDate: Date =
                                    OneUptimeDate.addRemoveDays(endDate, -21);

                                setStartDateTime(startDate);
                                setEndDateTime(endDate);
                            }}
                            title="3 weeks"
                        />
                    )}

                    <Button
                        buttonStyle={ButtonStyleType.NORMAL}
                        buttonSize={ButtonSize.Small}
                        onClick={() => {
                            // set it to past 1 month
                            const endDate: Date =
                                OneUptimeDate.getCurrentDate();
                            const startDate: Date =
                                OneUptimeDate.addRemoveMonths(endDate, -1);

                            setStartDateTime(startDate);
                            setEndDateTime(endDate);
                        }}
                        title="1 month"
                    />
                </div>
            </div>
        );
    }

    return <></>;
};

export default DateFilter;
