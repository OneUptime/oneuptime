import { Green } from 'Common/Types/BrandColors';
import MonitorUptimeGraph from 'CommonUI/src/Components/MonitorGraphs/Uptime';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type MonitorStatus from 'Model/Models/MonitorStatus';
import type MonitorStatusTimelne from 'Model/Models/MonitorStatusTimeline';
import Icon, { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Tooltip from 'CommonUI/src/Components/Tooltip/Toolip';

export interface ComponentProps {
    monitorName: string;
    description?: string | undefined;
    tooltip?: string | undefined;
    monitorStatus: MonitorStatus;
    monitorStatusTimeline: Array<MonitorStatusTimelne>;
    startDate: Date;
    endDate: Date;
    showHistoryChart?: boolean | undefined;
    showCurrentStatus?: boolean | undefined;
    uptimeGraphHeight?: number | undefined;
    className?: string | undefined;
}

const MonitorOverview: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className={props.className}>
            <div>
                <div
                    className="flex justify-between"
                    style={{ marginBottom: '3px' }}
                >
                    <div className="flex">
                        <div className="">{props.monitorName}</div>
                        {props.tooltip && (
                            <Tooltip
                                key={1}
                                text={props.tooltip || 'Not avaiulable'}
                            >
                                <div className="ml-1">
                                    <Icon
                                        className="cursor-pointer w-4 h-4 mt-1 text-gray-400"
                                        icon={IconProp.Help}
                                    />
                                </div>
                            </Tooltip>
                        )}
                    </div>
                    {props.showCurrentStatus && (
                        <div
                            className=""
                            style={{
                                color:
                                    props.monitorStatus?.color?.toString() ||
                                    Green.toString(),
                            }}
                        >
                            {props.monitorStatus?.name || 'Operational'}
                        </div>
                    )}
                </div>
                <div className="mb-2 text-gray-400 text-sm">
                    {props.description}
                </div>
            </div>
            {props.showHistoryChart && (
                <div>
                    <MonitorUptimeGraph
                        error={undefined}
                        items={props.monitorStatusTimeline || []}
                        startDate={props.startDate}
                        endDate={props.endDate}
                        isLoading={false}
                        height={props.uptimeGraphHeight}
                    />
                </div>
            )}
            {props.showHistoryChart && (
                <div className="text-sm text-gray-400 mt-1 flex justify-between">
                    <div>90 days ago</div>
                    <div>Today</div>
                </div>
            )}
        </div>
    );
};

export default MonitorOverview;
