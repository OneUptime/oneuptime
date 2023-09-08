import React, { FunctionComponent, ReactElement, useState } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import { useAsyncEffect } from 'use-async-effect';
import Monitor from 'Model/Models/Monitor';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import MonitorType from 'Common/Types/Monitor/MonitorType';

export interface ComponentProps {
    monitorId: ObjectID;
    refreshToggle?: boolean | undefined;
}

const DisabledWarning: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isDisabled, setIsDisabled] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [message, setMessage] = useState<string>('');

    useAsyncEffect(async () => {
        setIsLoading(true);

        const monitor: Monitor | null = await ModelAPI.getItem(
            Monitor,
            props.monitorId,
            {
                disableActiveMonitoring: true,
                disableActiveMonitoringBecauseOfManualIncident: true,
                disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
                monitorType: true,
            }
        );

        if (monitor?.monitorType === MonitorType.Manual) {
            setIsLoading(false);
            return;
        }

        if (monitor?.disableActiveMonitoring) {
            setIsDisabled(true);
            setMessage(
                'We are not monitoring this monitor since it is disabled. To enable active monitoring, please go to Settings.'
            );
        } else if (monitor?.disableActiveMonitoringBecauseOfManualIncident) {
            setIsDisabled(true);
            setMessage(
                'We are not monitoring this monitor since it is disabled because of an active incident. To enable active monitoring, please resolve the incident.'
            );
        } else if (
            monitor?.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
        ) {
            setIsDisabled(true);
            setMessage(
                'We are not monitoring this monitor since it is disabled because of an ongoing scheduled maintenance event. To enable active monitoring, please resolve the scheduled maintenance event.'
            );
        }

        setIsLoading(false);
    }, [props.refreshToggle]);

    if (isLoading) {
        return <></>;
    }

    if (isDisabled) {
        return (
            <Alert
                type={AlertType.DANGER}
                strongTitle="This monitor is disabled"
                title={message}
            />
        );
    }

    return <></>;
};

export default DisabledWarning;
