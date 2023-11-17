import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import API from 'CommonUI/src/Utils/API/API';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import MonitorStatus from 'Model/Models/MonitorStatus';
import URL from 'Common/Types/API/URL';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';
import MonitorGroup from 'Model/Models/MonitorGroup';
import Loader from 'CommonUI/src/Components/Loader/Loader';

export interface ComponentProps {
    monitorGroupId: ObjectID;
}

const CurrentStatusElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    const [currentGroupStatus, setCurrentGroupStatus] =
        React.useState<MonitorStatus | null>(null);

    const [error, setError] = React.useState<string | undefined>(undefined);

    const loadCurrentStatus: Function = async (): Promise<void> => {
        setIsLoading(true);

        try {
            const currentStatus: MonitorStatus | null =
                await ModelAPI.post<MonitorStatus>(
                    MonitorStatus,
                    URL.fromString(DASHBOARD_API_URL.toString())
                        .addRoute(new MonitorGroup().getCrudApiPath()!)
                        .addRoute('/current-status/')
                        .addRoute(`/${props.monitorGroupId.toString()}`)
                );

            setCurrentGroupStatus(currentStatus);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    useEffect(() => {
        loadCurrentStatus().catch(() => {});
    }, []);

    if (isLoading) {
        return <Loader />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    if (!currentGroupStatus) {
        throw new BadDataException('Current Group Status not found');
    }

    return (
        <Statusbubble
            color={currentGroupStatus.color! as Color}
            text={currentGroupStatus.name! as string}
            shouldAnimate={true}
        />
    );
};

export default CurrentStatusElement;
