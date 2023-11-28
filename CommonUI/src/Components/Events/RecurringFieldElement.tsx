import Recurring from 'Common/Types/Events/Recurring';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Input, { InputType } from '../Input/Input';
import Typeof from 'Common/Types/Typeof';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Dropdown, { DropdownValue } from '../Dropdown/Dropdown';
import DropdownUtil from '../../Utils/Dropdown';
import EventInterval from 'Common/Types/Events/EventInterval';

export interface ComponentProps {
    error?: string | undefined;
    onChange?: ((value: Recurring) => void) | undefined;
    initialValue?: Recurring | undefined;
}

const RecurringFieldElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [recurring, setRecurring] = useState<Recurring | undefined>(
        props.initialValue ? Recurring.fromJSON(props.initialValue) : undefined
    );

    const updateRecurring: Function = (restrictionTimes: Recurring): void => {
        setRecurring(Recurring.fromJSON(restrictionTimes.toJSON()));
        if (props.onChange) {
            props.onChange(restrictionTimes);
        }
    };

    return (
        <div>
            <div className="flex space-x-3">
                <Input
                    value={recurring?.intervalCount.toString()}
                    type={InputType.NUMBER}
                    placeholder="1"
                    onChange={(value: any) => {
                        let valueNumber: number = value as number;

                        if (typeof valueNumber === Typeof.String) {
                            valueNumber = parseInt(valueNumber.toString());
                        }

                        let tempRecurring: Recurring | undefined = recurring;

                        if (!tempRecurring) {
                            tempRecurring = new Recurring();
                        }

                        tempRecurring.intervalCount = new PositiveNumber(
                            valueNumber
                        );

                        updateRecurring(tempRecurring);
                    }}
                />
                <Dropdown
                    value={DropdownUtil.getDropdownOptionFromEnumForValue(
                        EventInterval,
                        recurring?.intervalType || EventInterval.Day
                    )}
                    options={DropdownUtil.getDropdownOptionsFromEnum(
                        EventInterval
                    )}
                    onChange={(
                        value: DropdownValue | Array<DropdownValue> | null
                    ) => {
                        let tempRecurring: Recurring | undefined = recurring;

                        if (!tempRecurring) {
                            tempRecurring = new Recurring();
                        }

                        tempRecurring.intervalType = value as EventInterval;

                        updateRecurring(tempRecurring);
                    }}
                />
            </div>

            {props.error && (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            )}
        </div>
    );
};

export default RecurringFieldElement;
