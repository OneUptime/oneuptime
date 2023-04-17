import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import MonitorCriteriaInstanceElement from './MonitorCriteriaInstance';
import Button from 'CommonUI/src/Components/Button/Button';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';

export interface ComponentProps {
    initialValue: MonitorCriteria | undefined;
    onChange?: undefined | ((value: MonitorCriteria) => void);
    monitorStatusDropdownOptions: Array<DropdownOption>;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [monitorCriteria, setMonitorCriteria] =
        React.useState<MonitorCriteria>(
            props.initialValue || new MonitorCriteria()
        );

    useEffect(() => {
        if (monitorCriteria && props.onChange) {
            props.onChange(monitorCriteria);
        }
    }, [monitorCriteria]);

    return (
        <div className='mt-4'>
            {monitorCriteria.data?.monitorCriteriaInstanceArray.map(
                (i: MonitorCriteriaInstance, index: number) => {
                    return (
                        <MonitorCriteriaInstanceElement
                            key={index}
                            monitorStatusDropdownOptions={
                                props.monitorStatusDropdownOptions
                            }
                            initialValue={i}
                            onDelete={() => {
                                // remove the criteria filter
                                const index: number =
                                    monitorCriteria.data?.monitorCriteriaInstanceArray.indexOf(
                                        i
                                    ) || -1;
                                const newMonitorCriterias: Array<MonitorCriteriaInstance> =
                                    [
                                        ...(monitorCriteria.data
                                            ?.monitorCriteriaInstanceArray ||
                                            []),
                                    ];
                                newMonitorCriterias.splice(index, 1);
                                setMonitorCriteria(
                                    new MonitorCriteria().fromJSON({
                                        _type: 'MonitorCriteria',
                                        value: {
                                            monitorCriteriaInstanceArray:
                                                newMonitorCriterias,
                                        },
                                    })
                                );
                            }}
                            onChange={(value: MonitorCriteriaInstance) => {
                                const index: number =
                                    monitorCriteria.data?.monitorCriteriaInstanceArray.indexOf(
                                        i
                                    ) || -1;
                                const newMonitorCriterias: Array<MonitorCriteriaInstance> =
                                    [
                                        ...(monitorCriteria.data
                                            ?.monitorCriteriaInstanceArray ||
                                            []),
                                    ];
                                newMonitorCriterias[index] = value;
                                setMonitorCriteria(
                                    new MonitorCriteria().fromJSON({
                                        _type: 'MonitorCriteria',
                                        value: {
                                            monitorCriteriaInstanceArray:
                                                newMonitorCriterias,
                                        },
                                    })
                                );
                            }}
                        />
                    );
                }
            )}
            <div className='mt-4'>
                <Button
                    title="Add Criteria"
                    onClick={() => {
                        const newMonitorCriterias: Array<MonitorCriteriaInstance> =
                            [
                                ...(monitorCriteria.data
                                    ?.monitorCriteriaInstanceArray || []),
                            ];
                        newMonitorCriterias.push(new MonitorCriteriaInstance());
                        setMonitorCriteria(
                            new MonitorCriteria().fromJSON({
                                _type: 'MonitorCriteria',
                                value: {
                                    monitorCriteriaInstanceArray:
                                        newMonitorCriterias,
                                },
                            })
                        );
                    }}
                />
            </div>
        </div>
    );
};

export default MonitorCriteriaElement;
