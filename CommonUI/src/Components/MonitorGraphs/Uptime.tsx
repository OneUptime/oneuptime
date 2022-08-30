import { Green } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import ObjectID from 'Common/Types/ObjectID';
import { Dictionary } from 'lodash';
import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Tooltip from '../Tooltip/Toolip';



export interface ComponentProps {
    monitorId: ObjectID, 
    startDate: Date, 
    endDate: Date
}

const MonitorUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    useEffect(() => {
       const incidentState 
    });
   
};

export default MonitorUptimeGraph;
