import { Green } from 'Common/Types/BrandColors';
import MonitorUptimeGraph from 'CommonUI/src/Components/MonitorGraphs/Uptime';
import React, { FunctionComponent, ReactElement } from 'react';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusTimelne from 'Model/Models/MonitorStatusTimeline'


export interface ComponentProps {
    monitorName: string;
    description?: string | undefined;
    tooltip?: string | undefined;
    monitorStatus: MonitorStatus;
    monitorStatusTimeline: Array<MonitorStatusTimelne>;
    startDate: Date, 
    endDate: Date
}

const MonitorOverview: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (<div style={{
        marginTop: "20px",
        marginBottom: "20px"
    }}>
        <div >
            <div className='justify-space-between' style={{ marginBottom: "3px" }}>
                <div><div className='bold font16'>{props.monitorName}</div></div>
                <div className='bold font16' style={{ color: props.monitorStatus?.color?.toString() || Green.toString() }}>{props.monitorStatus?.name || 'Operational'}</div>
            </div>
            <div style={{ marginBottom: "3px" }}>{props.description}</div>
        </div>
        <div>
            <MonitorUptimeGraph
                error={undefined}
                items={props.monitorStatusTimeline || []}
                startDate={props.startDate}
                endDate={props.endDate}
                isLoading={false}
                height={30}
            />
        </div>
    </div >)
};

export default MonitorOverview;
