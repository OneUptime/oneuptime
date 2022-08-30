import ObjectID from 'Common/Types/ObjectID';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import ModelAPI, { ListResult } from '../../Utils/ModelAPI/ModelAPI';
import MonitorStatus from "Model/Models/MonitorStatus";



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
        const monitorStatus: ListResult<MonitorStatus> = await ModelAPI.getList(MonitorStatus, {

        })
    };

    useEffect(() => {
        fetchItem();
    }, []);
   
};

export default MonitorUptimeGraph;
