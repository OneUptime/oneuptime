import ObjectID from 'Common/Types/ObjectID';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import ModelAPI, { ListResult } from '../../Utils/ModelAPI/ModelAPI';
import MonitorStatus from "Model/Models/MonitorStatus";
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import OneUptimeDate from 'Common/Types/Date';

export interface ComponentProps {
    monitorId: ObjectID, 
    startDate: Date, 
    endDate: Date
}

const MonitorUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const fetchItem = async () => {
        setIsLoading(true);

        const startDate = OneUptimeDate.getSomeDaysAgoFromDate(props.startDate, 10);
        const endDate = props.endDate;

        const monitorStatus: ListResult<MonitorStatus> = await ModelAPI.getList(MonitorStatus, {
            createdAt
        })

        setIsLoading(false);
    };

    useEffect(() => {
        fetchItem();
    }, []);

    if (isLoading) {
        return (
            <ComponentLoader />
        );
    }
   
};

export default MonitorUptimeGraph;
