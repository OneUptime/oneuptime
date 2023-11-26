import RestrictionTimes, { WeeklyResctriction } from 'Common/Types/OnCallDutyPolicy/RestrictionTimes';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import BasicRadioButtons from 'CommonUI/src/Components/RadioButtons/BasicRadioButtons';
import { RestrictionType } from 'Common/Types/OnCallDutyPolicy/RestrictionTimes';
import FieldLabelElement from 'CommonUI/src/Components/Detail/FieldLabel';
import Input, { InputType } from 'CommonUI/src/Components/Input/Input';
import OneUptimeDate from 'Common/Types/Date';
import Typeof from 'Common/Types/Typeof';
import Dropdown from 'CommonUI/src/Components/Dropdown/Dropdown';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import DayOfWeek from 'Common/Types/Day/DayOfWeek';
import Button from 'CommonUI/src/Components/Button/Button';

export interface ComponentProps {
    error?: string | undefined;
    onChange?: ((value: RestrictionTimes) => void) | undefined;
    onBlur?: () => void;
    initialValue?: RestrictionTimes | undefined;
}

const RestrictionTimesFieldElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const [restrictionTimes, setRestrictionTimes] = useState<RestrictionTimes | undefined>(props.initialValue);


    const getDailyRestriction = (

    ): ReactElement => {

        // show start time to end time input fields 

        return (<div className='flex'>
            <div>
                <FieldLabelElement
                    title="From:"
                />
                <Input type={InputType.TIME} initialValue={
                    restrictionTimes?.dayRestrictionTimes?.startTime.toString()
                } onChange={(value: any) => {

                    let date = OneUptimeDate.getCurrentDate();

                    if (value instanceof Date) {
                        date = value;
                    }

                    if (typeof value === Typeof.String) {
                        date = OneUptimeDate.fromString(value);
                    }

                    let tempRestrictionTimes = restrictionTimes;

                    if (!tempRestrictionTimes) {
                        tempRestrictionTimes = new RestrictionTimes();
                    }

                    if (!tempRestrictionTimes.dayRestrictionTimes) {
                        tempRestrictionTimes.dayRestrictionTimes = {
                            startTime: date,
                            endTime: date,
                        }
                    }

                    tempRestrictionTimes.dayRestrictionTimes.startTime = date;

                    updateRestrictionTimes(tempRestrictionTimes);

                }} />
            </div>
            <div>
                <FieldLabelElement
                    title="To:"
                />
                <Input type={InputType.TIME} initialValue={
                    restrictionTimes?.dayRestrictionTimes?.endTime.toString()
                } onChange={(value: any) => {

                    let date = OneUptimeDate.getCurrentDate();

                    if (value instanceof Date) {
                        date = value;
                    }

                    if (typeof value === Typeof.String) {
                        date = OneUptimeDate.fromString(value);
                    }

                    let tempRestrictionTimes = restrictionTimes;

                    if (!tempRestrictionTimes) {
                        tempRestrictionTimes = new RestrictionTimes();
                    }

                    if (!tempRestrictionTimes.dayRestrictionTimes) {
                        tempRestrictionTimes.dayRestrictionTimes = {
                            startTime: date,
                            endTime: date,
                        }
                    }

                    tempRestrictionTimes.dayRestrictionTimes.endTime = date;

                    updateRestrictionTimes(tempRestrictionTimes);

                }} />
            </div>
        </div>)
    }

    const getWeeklyTimeRestrictions = (

    ): ReactElement => {



        return (<div>

            <div>
                {/** LIST */}

                {restrictionTimes?.weeklyRestrictionTimes?.map((weeklyRestriction: WeeklyResctriction, i: number) => {

                    return (<div key={i} className='flex'>
                        <div>
                            {getWeeklyTimeRestriction({ weeklyRestriction, onChange: (value: WeeklyResctriction) => {

                                let tempRestrictionTimes = restrictionTimes;

                                if (!tempRestrictionTimes) {
                                    tempRestrictionTimes = new RestrictionTimes();
                                }

                                if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                                    tempRestrictionTimes.weeklyRestrictionTimes = [];
                                }

                                tempRestrictionTimes.weeklyRestrictionTimes[i] = value;

                                updateRestrictionTimes(tempRestrictionTimes);

                            }, onDelete: () => {

                                let tempRestrictionTimes = restrictionTimes;

                                if (!tempRestrictionTimes) {
                                    tempRestrictionTimes = new RestrictionTimes();
                                }

                                if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                                    tempRestrictionTimes.weeklyRestrictionTimes = [];
                                }

                                tempRestrictionTimes.weeklyRestrictionTimes.splice(i, 1);

                                updateRestrictionTimes(tempRestrictionTimes);

                            }})}
                        </div>
                        <div>
                            {/** show delete button */}
                            <Button title='Delete' onClick={() => {

                                let tempRestrictionTimes = restrictionTimes;

                                if (!tempRestrictionTimes) {
                                    tempRestrictionTimes = new RestrictionTimes();
                                }

                                if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                                    tempRestrictionTimes.weeklyRestrictionTimes = [];
                                }

                                tempRestrictionTimes.weeklyRestrictionTimes.splice(i, 1);

                                updateRestrictionTimes(tempRestrictionTimes);

                            }} />
                        </div>
                    </div>)
                })}
            </div>

            <div>
                {/** show add button */}
                <Button title='Add' onClick={() => {

                    let tempRestrictionTimes = restrictionTimes;

                    if (!tempRestrictionTimes) {
                        tempRestrictionTimes = new RestrictionTimes();
                    }

                    if (!tempRestrictionTimes.weeklyRestrictionTimes) {
                        tempRestrictionTimes.weeklyRestrictionTimes = [];
                    }

                    tempRestrictionTimes.weeklyRestrictionTimes.push(RestrictionTimes.getDefaultWeeklyRestrictionTIme());

                    updateRestrictionTimes(tempRestrictionTimes);
                }} />
            </div>
        </div>)
    }


    const getWeeklyTimeRestriction = (
        props: {
            weeklyRestriction: WeeklyResctriction,
            onChange: (value: WeeklyResctriction) => void,
            onDelete: () => void,
        }
    ): ReactElement => {

        // show start time to end time input fields 

        return (<div className='flex'>
            <div>
                <FieldLabelElement
                    title="From:"
                />
                <Dropdown options={DropdownUtil.getDropdownOptionsFromEnum(DayOfWeek)} initialValue={DropdownUtil.getDropdownOptionFromEnumForValue(DayOfWeek, props.weeklyRestriction.startDay)} onChange={(value: any) => {
                    props.weeklyRestriction.startDay = value;
                    props.onChange(props.weeklyRestriction);
                }} />
                <Input type={InputType.TIME} initialValue={
                    props.weeklyRestriction?.startTime.toString()
                } onChange={(value: any) => {

                    let date = OneUptimeDate.getCurrentDate();

                    if (value instanceof Date) {
                        date = value;
                    }

                    if (typeof value === Typeof.String) {
                        date = OneUptimeDate.fromString(value);
                    }

                    props.weeklyRestriction.startTime = date;

                    props.onChange(props.weeklyRestriction);

                }} />
            </div>
            <div>
                <FieldLabelElement
                    title="To:"
                />
                <Dropdown options={DropdownUtil.getDropdownOptionsFromEnum(DayOfWeek)} initialValue={DropdownUtil.getDropdownOptionFromEnumForValue(DayOfWeek, props.weeklyRestriction.endDay)} onChange={(value: any) => {
                    props.weeklyRestriction.endDay = value;
                    props.onChange(props.weeklyRestriction);
                }} />
                <Input type={InputType.TIME} initialValue={
                    props.weeklyRestriction?.endTime.toString()
                } onChange={(value: any) => {

                    let date = OneUptimeDate.getCurrentDate();

                    if (value instanceof Date) {
                        date = value;
                    }

                    if (typeof value === Typeof.String) {
                        date = OneUptimeDate.fromString(value);
                    }

                    props.weeklyRestriction.endTime = date;

                    props.onChange(props.weeklyRestriction);

                }} />
            </div>
            <div>
                {/* Dellete Button */}
                <Button title='Delete' onClick={() => {
                    props.onDelete();
                }} />
            </div>
        </div>)
    }

    const updateRestrictionTimes = (restrictionTimes: RestrictionTimes): void => {
        setRestrictionTimes(RestrictionTimes.fromJSON(restrictionTimes.toJSON()));
        if (props.onChange) {
            props.onChange(restrictionTimes);
        }
    }

    return (
        <div>
            <BasicRadioButtons
                onChange={(value: RestrictionType) => {

                    let tempRestrictionTimes = restrictionTimes;

                    if (!tempRestrictionTimes) {
                        tempRestrictionTimes = new RestrictionTimes();
                    }

                    if (value === RestrictionType.None) {
                        // remove all restrictions
                        tempRestrictionTimes.removeAllRestrictions();
                        updateRestrictionTimes(tempRestrictionTimes);
                    } else if (value === RestrictionType.Daily) {
                        // remove all restrictions
                        tempRestrictionTimes.removeAllRestrictions();
                        // add daily restriction
                        tempRestrictionTimes.addDefaultDailyRestriction();
                        updateRestrictionTimes(tempRestrictionTimes);
                    } else if (value === RestrictionType.Weekly) {
                        // remove all restrictions
                        tempRestrictionTimes.removeAllRestrictions();
                        // add weekly restriction
                        tempRestrictionTimes.addDefaultWeeklyRestriction();
                        updateRestrictionTimes(tempRestrictionTimes);
                    }
                }}
                initialValue={restrictionTimes?.restictionType}
                options={[
                    {
                        title: 'No Restrictions',
                        value: RestrictionType.None,
                    },
                    {
                        title: 'Specific Times of the Day',
                        value: RestrictionType.Daily,
                        children: getDailyRestriction(),
                    },
                    {
                        title: 'Specific Times of the Week',
                        value: RestrictionType.Weekly,
                        children: getWeeklyTimeRestrictions(),
                    },
                ]} />
        </div>
    );
};

export default RestrictionTimesFieldElement;

