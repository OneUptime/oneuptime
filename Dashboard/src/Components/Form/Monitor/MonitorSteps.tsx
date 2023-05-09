import MonitorSteps from 'Common/Types/Monitor/MonitorSteps';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import MonitorStepElement from './MonitorStep';
import Dropdown, {
    DropdownOption,
    DropdownValue,
} from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import API from 'CommonUI/src/Utils/API/API';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import { CustomElementProps } from 'CommonUI/src/Components/Forms/Types/Field';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/Database/SortOrder';

export interface ComponentProps extends CustomElementProps {
    error?: string | undefined;
    onChange?: ((value: MonitorSteps) => void) | undefined;
    onBlur?: () => void;
    initialValue?: MonitorSteps;
    monitorType: MonitorType;
}

const MonitorStepsElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [monitorStatusDropdownOptions, setMonitorStatusDropdownOptions] =
        React.useState<Array<DropdownOption>>([]);

    const [
        incidentSeverityDropdownOptions,
        setIncidentSeverityDropdownOptions,
    ] = React.useState<Array<DropdownOption>>([]);

    const [isLoading, setIsLoading] = React.useState<boolean>(false);
    const [error, setError] = React.useState<string>();

    useEffect(() => {
        setError(props.error);
    }, [props.error]);

    const fetchDropdownOptions: Function = async (): Promise<void> => {
        setIsLoading(true);

        try {
            const monitorStatusList: ListResult<MonitorStatus> =
                await ModelAPI.getList(
                    MonitorStatus,
                    {},
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        name: true,
                        isOperationalState: true,
                        isOfflineState: true,
                    },
                    {},
                    {}
                );

            if (monitorStatusList.data) {
                setMonitorStatusDropdownOptions(
                    monitorStatusList.data.map((i: MonitorStatus) => {
                        return {
                            value: i._id!,
                            label: i.name!,
                        };
                    })
                );
            }

            const incidentSeverityList: ListResult<IncidentSeverity> =
                await ModelAPI.getList(
                    IncidentSeverity,
                    {},
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        name: true,
                        order: true,
                    },
                    {
                        order: SortOrder.Ascending,
                    },
                    {}
                );

            if (incidentSeverityList.data) {
                setIncidentSeverityDropdownOptions(
                    incidentSeverityList.data.map((i: IncidentSeverity) => {
                        return {
                            value: i._id!,
                            label: i.name!,
                        };
                    })
                );
            }

            // if there is no initial value then....

            if (!monitorSteps) {
                setMonitorSteps(
                    MonitorSteps.getDefaultMonitorSteps({
                        monitorType: props.monitorType,
                        defaultMonitorStatusId: monitorStatusList.data.find(
                            (i: MonitorStatus) => {
                                return i.isOperationalState;
                            }
                        )!.id!,
                        onlineMonitorStatusId: monitorStatusList.data.find(
                            (i: MonitorStatus) => {
                                return i.isOperationalState;
                            }
                        )!.id!,
                        offlineMonitorStatusId: monitorStatusList.data.find(
                            (i: MonitorStatus) => {
                                return i.isOfflineState;
                            }
                        )!.id!,
                        defaultIncidentSeverityId:
                            incidentSeverityList.data[0]!.id!,
                    })
                );
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };
    useEffect(() => {
        fetchDropdownOptions().catch();
    }, []);

    const [monitorSteps, setMonitorSteps] = React.useState<
        MonitorSteps | undefined
    >(props.initialValue);

    useEffect(() => {
        if (monitorSteps && props.onChange) {
            props.onChange(monitorSteps);
        }

        if (props.onBlur) {
            props.onBlur();
        }
    }, [monitorSteps]);

    if (isLoading) {
        return <ComponentLoader></ComponentLoader>;
    }

    return (
        <div>
            {error ? (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            ) : (
                <></>
            )}
            {monitorSteps?.data?.monitorStepsInstanceArray.map(
                (i: MonitorStep, index: number) => {
                    return (
                        <MonitorStepElement
                            monitorType={props.monitorType}
                            key={index}
                            monitorStatusDropdownOptions={
                                monitorStatusDropdownOptions
                            }
                            incidentSeverityDropdownOptions={
                                incidentSeverityDropdownOptions
                            }
                            initialValue={i}
                            // onDelete={() => {
                            //     // remove the criteria filter
                            // const index: number | undefined =
                            // monitorSteps.data?.monitorStepsInstanceArray.findIndex((item: MonitorStep) => {
                            //     return item.data?.id === value.data?.id;
                            // })

                            // if (index === undefined) {
                            //     return;
                            // }
                            //     const newMonitorStepss: Array<MonitorStep> = [
                            //         ...(monitorSteps.data
                            //             ?.monitorStepsInstanceArray || []),
                            //     ];
                            //     newMonitorStepss.splice(index, 1);
                            //     setMonitorSteps(
                            //         new MonitorSteps().fromJSON({
                            //             _type: 'MonitorSteps',
                            //             value: {
                            //                 monitorStepsInstanceArray:
                            //                     newMonitorStepss,
                            //             },
                            //         })
                            //     );
                            // }}
                            onChange={(value: MonitorStep) => {
                                const index: number | undefined =
                                    monitorSteps.data?.monitorStepsInstanceArray.findIndex(
                                        (item: MonitorStep) => {
                                            return (
                                                item.data?.id === value.data?.id
                                            );
                                        }
                                    );

                                if (index === undefined) {
                                    return;
                                }

                                const newMonitorStepss: Array<MonitorStep> = [
                                    ...(monitorSteps.data
                                        ?.monitorStepsInstanceArray || []),
                                ];
                                newMonitorStepss[index] = value;
                                monitorSteps.setMonitorStepsInstanceArray(
                                    newMonitorStepss
                                );
                                setMonitorSteps(
                                    MonitorSteps.clone(monitorSteps)
                                );
                            }}
                        />
                    );
                }
            )}

            {/* <Button
                title="Add Step"
                onClick={() => {
                    const newMonitorSteps: Array<MonitorStep> = [
                        ...(monitorSteps.data?.monitorStepsInstanceArray || []),
                    ];
                    newMonitorSteps.push(new MonitorStep());

                    monitorSteps.data = {
                        monitorStepsInstanceArray: newMonitorSteps,
                    };

                    setMonitorSteps(
                        new MonitorSteps().fromJSON(monitorSteps.toJSON())
                    );
                }}
            /> */}

            <HorizontalRule />

            <div className="mt-4">
                <FieldLabelElement
                    title="Default Monitor Status"
                    description="What would like the monitor status to be when none of the above criteria is met?"
                    required={true}
                />

                <Dropdown
                    value={monitorStatusDropdownOptions.find(
                        (i: DropdownOption) => {
                            return (
                                i.value ===
                                    monitorSteps?.data?.defaultMonitorStatusId?.toString() ||
                                undefined
                            );
                        }
                    )}
                    options={monitorStatusDropdownOptions}
                    onChange={(
                        value: DropdownValue | Array<DropdownValue> | null
                    ) => {
                        monitorSteps?.setDefaultMonitorStatusId(
                            value ? new ObjectID(value.toString()) : undefined
                        );
                        setMonitorSteps(
                            MonitorSteps.clone(
                                monitorSteps || new MonitorSteps()
                            )
                        );
                    }}
                />
            </div>
        </div>
    );
};

export default MonitorStepsElement;
