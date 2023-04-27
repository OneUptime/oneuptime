import MonitorSteps from 'Common/Types/Monitor/MonitorSteps';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import MonitorStepElement from './MonitorStep';
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
    const [monitorStatusOptions, setMonitorStatusOptions] = React.useState<
        Array<MonitorStatus>
    >([]);

    const [incidentSeverityOptions, setIncidentSeverityOptions] =
        React.useState<Array<IncidentSeverity>>([]);

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
                        color: true,
                    },
                    {},
                    {}
                );

            if (monitorStatusList.data) {
                setMonitorStatusOptions(monitorStatusList.data);
            }

            const incidentSeverityList: ListResult<IncidentSeverity> =
                await ModelAPI.getList(
                    IncidentSeverity,
                    {},
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        name: true,
                        color: true,
                    },
                    {},
                    {}
                );

            if (incidentSeverityList.data) {
                setIncidentSeverityOptions(
                    incidentSeverityList.data as Array<IncidentSeverity>
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
                            monitorStatusOptions={monitorStatusOptions}
                            incidentSeverityOptions={incidentSeverityOptions}
                            monitorStep={i}
                        />
                    );
                }
            )}
        </div>
    );
};

export default MonitorStepsElement;
