import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import Button from 'CommonUI/src/Components/Button/Button';
import Dropdown, {
    DropdownOption,
    DropdownValue,
} from 'CommonUI/src/Components/Dropdown/Dropdown';
import Input from 'CommonUI/src/Components/Input/Input';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';

export interface ComponentProps {
    initialValue: CriteriaFilter | undefined;
    onChange?: undefined | ((value: CriteriaFilter) => void);
    onDelete?: undefined | (() => void);
}

const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [criteriaFilter, setCriteriaFilter] = React.useState<
        CriteriaFilter | undefined
    >(props.initialValue);

    const checkOnOptions: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(CheckOn);
    const filterTypeOptions: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(FilterType);

    useEffect(() => {
        if (props.onChange && criteriaFilter) {
            props.onChange(criteriaFilter);
        }
    }, [criteriaFilter]);

    return (
        <div className="flex">
            <div className="w-1/3">
                <Dropdown
                    initialValue={checkOnOptions.find((i: DropdownOption) => {
                        return i.value === criteriaFilter?.checkOn;
                    })}
                    options={checkOnOptions}
                    onChange={(
                        value: DropdownValue | Array<DropdownValue> | null
                    ) => {
                        setCriteriaFilter({
                            checkOn: value?.toString() as CheckOn,
                            filterType:
                                criteriaFilter?.filterType ||
                                FilterType.EqualTo,
                            value: criteriaFilter?.value || '',
                        });
                    }}
                />
            </div>
            <div className="w-1/3">
                <Dropdown
                    initialValue={filterTypeOptions.find(
                        (i: DropdownOption) => {
                            return i.value === criteriaFilter?.filterType;
                        }
                    )}
                    options={filterTypeOptions}
                    onChange={(
                        value: DropdownValue | Array<DropdownValue> | null
                    ) => {
                        setCriteriaFilter({
                            checkOn:
                                criteriaFilter?.checkOn || CheckOn.IsOnline,
                            filterType: value?.toString() as FilterType,
                            value: criteriaFilter?.value || '',
                        });
                    }}
                />
            </div>
            <div className="w-1/3">
                <Input
                    initialValue={criteriaFilter?.value.toString()}
                    onChange={(value: string) => {
                        setCriteriaFilter({
                            checkOn:
                                criteriaFilter?.checkOn || CheckOn.IsOnline,
                            filterType:
                                criteriaFilter?.filterType ||
                                FilterType.EqualTo,
                            value: value || '',
                        });
                    }}
                />
            </div>
            <div>
                <Button
                    onClick={() => {
                        props.onDelete?.();
                    }}
                    title="Delete"
                />
            </div>
        </div>
    );
};

export default CriteriaFilterElement;
