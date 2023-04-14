import MonitorSteps from 'Common/Types/Monitor/MonitorSteps';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import MonitorStepElement from './MonitorStep';
import Button from 'CommonUI/src/Components/Button/Button';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';

export interface ComponentProps {
    initialValue: MonitorSteps | undefined;
    onChange?: undefined | ((value: MonitorSteps) => void);
    monitorStatusDropdownOptions: Array<DropdownOption>;
}

const MonitorStepsElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [monitorSteps, setMonitorSteps] = React.useState<MonitorSteps>(
        props.initialValue ||
            new MonitorSteps().fromJSON({
                _type: 'MonitorSteps',
                value: {
                    monitorStepsInstanceArray: [],
                },
            })
    );

    useEffect(() => {
        if (monitorSteps && props.onChange) {
            props.onChange(monitorSteps);
        }
    }, [monitorSteps]);

    return (
        <div>
            {monitorSteps.data?.monitorStepsInstanceArray.map(
                (i: MonitorStep, index: number) => {
                    return (
                        <MonitorStepElement
                            key={index}
                            monitorStatusDropdownOptions={
                                props.monitorStatusDropdownOptions
                            }
                            initialValue={i}
                            onDelete={() => {
                                // remove the criteria filter
                                const index: number =
                                    monitorSteps.data?.monitorStepsInstanceArray.indexOf(
                                        i
                                    ) || -1;
                                const newMonitorStepss: Array<MonitorStep> = [
                                    ...(monitorSteps.data
                                        ?.monitorStepsInstanceArray || []),
                                ];
                                newMonitorStepss.splice(index, 1);
                                setMonitorSteps(
                                    new MonitorSteps().fromJSON({
                                        _type: 'MonitorSteps',
                                        value: {
                                            monitorStepsInstanceArray:
                                                newMonitorStepss,
                                        },
                                    })
                                );
                            }}
                            onChange={(value: MonitorStep) => {
                                const index: number =
                                    monitorSteps.data?.monitorStepsInstanceArray.indexOf(
                                        i
                                    ) || -1;
                                const newMonitorStepss: Array<MonitorStep> = [
                                    ...(monitorSteps.data
                                        ?.monitorStepsInstanceArray || []),
                                ];
                                newMonitorStepss[index] = value;
                                setMonitorSteps(
                                    new MonitorSteps().fromJSON({
                                        _type: 'MonitorSteps',
                                        value: {
                                            monitorStepsInstanceArray:
                                                newMonitorStepss,
                                        },
                                    })
                                );
                            }}
                        />
                    );
                }
            )}

            <Button
                title="Add Step"
                onClick={() => {
                    const newMonitorStepss: Array<MonitorStep> = [
                        ...(monitorSteps.data?.monitorStepsInstanceArray || []),
                    ];
                    newMonitorStepss.push(
                        new MonitorStep().fromJSON({
                            _type: 'MonitorStep',
                            value: {
                                monitorStepsInstanceArray: [],
                            },
                        })
                    );
                    setMonitorSteps(
                        new MonitorSteps().fromJSON({
                            _type: 'MonitorSteps',
                            value: {
                                monitorStepsInstanceArray: newMonitorStepss,
                            },
                        })
                    );
                }}
            />
        </div>
    );
};

export default MonitorStepsElement;
