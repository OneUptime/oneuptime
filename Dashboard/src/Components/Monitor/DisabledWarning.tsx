import React, { FunctionComponent, ReactElement, useState } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import { useAsyncEffect } from 'use-async-effect';
import Monitor from 'Model/Models/Monitor';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';

export interface ComponentProps {
    monitorId: ObjectID | undefined;
    refreshToggle?: boolean | undefined;
}

const DisabledWarning: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isDisabled, setIsDisabled] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    useAsyncEffect(async () => {
        setIsLoading(true);
        const monitorCount: number = await ModelAPI.count(Monitor, {
            _id: props.monitorId,
            disableActiveMonitoring: true,
        });

        if (monitorCount > 0) {
            setIsDisabled(true);
        } else {
            setIsDisabled(false);
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
                title="We are not monitoring this monitor since it is disabled. To enable active monitoring, please go to Settings."
            />
        );
    }

    return <></>;
};

export default DisabledWarning;
