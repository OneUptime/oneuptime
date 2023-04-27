import MonitorSteps from 'Common/Types/Monitor/MonitorSteps';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import MonitorStepElement from './MonitorStep';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import API from 'CommonUI/src/Utils/API/API';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import { CustomElementProps } from 'CommonUI/src/Components/Forms/Types/Field';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';

export interface ComponentProps extends CustomElementProps {
    monitorSteps: MonitorSteps;
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
    const [error, setError] = React.useState<string>('');

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
                    },
                    {},
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
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };
    useEffect(() => {
        fetchDropdownOptions().catch();
    }, []);

    if (isLoading) {
        return <ComponentLoader></ComponentLoader>;
    }

    if (!props.monitorSteps) {
        return <div>Monitor Criteria not defined for this resource.</div>;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <div>
            {props.monitorSteps.data?.monitorStepsInstanceArray.map(
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
                            monitorStep={i}
                        />
                    );
                }
            )}
        </div>
    );
};

export default MonitorStepsElement;
