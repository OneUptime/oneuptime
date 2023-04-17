import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import CriteriaFilterElement from './CriteriaFilter';
import Button, { ButtonSize } from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    initialValue: Array<CriteriaFilter> | undefined;
    onChange?: undefined | ((value: Array<CriteriaFilter>) => void);
}

const CriteriaFilters: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [criteriaFilters, setCriteriaFilters] = React.useState<
        Array<CriteriaFilter>
    >(props.initialValue || []);

    useEffect(() => {
        if (criteriaFilters && props.onChange) {
            props.onChange(criteriaFilters);
        }
    }, [criteriaFilters]);

    return (
        <div>
            {criteriaFilters.map((i: CriteriaFilter, index: number) => {
                return (
                    <CriteriaFilterElement
                        key={index}
                        initialValue={i}
                        onDelete={() => {
                            // remove the criteria filter
                            const index: number = criteriaFilters.indexOf(i);
                            const newCriteriaFilters: Array<CriteriaFilter> = [
                                ...criteriaFilters,
                            ];
                            newCriteriaFilters.splice(index, 1);
                            setCriteriaFilters(newCriteriaFilters);
                        }}
                        onChange={(value: CriteriaFilter) => {
                            const index: number = criteriaFilters.indexOf(i);
                            const newCriteriaFilters: Array<CriteriaFilter> = [
                                ...criteriaFilters,
                            ];
                            newCriteriaFilters[index] = value;
                            setCriteriaFilters(newCriteriaFilters);
                        }}
                    />
                );
            })}
            <div className='mt-3 -ml-3'>
            <Button
                title="Add Filter"
                buttonSize={ButtonSize.Small}
                icon={IconProp.Add}
                onClick={() => {
                    const newCriteriaFilters: Array<CriteriaFilter> = [
                        ...criteriaFilters,
                    ];
                    newCriteriaFilters.push({
                        checkOn: CheckOn.IsOnline,
                        filterType: FilterType.EqualTo,
                        value: '',
                    });

                    setCriteriaFilters(newCriteriaFilters);
                }}
            />
            </div>
        </div>
    );
};

export default CriteriaFilters;
