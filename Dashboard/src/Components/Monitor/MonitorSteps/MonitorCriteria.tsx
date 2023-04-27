import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import React, { FunctionComponent, ReactElement } from 'react';
import MonitorCriteriaInstanceElement from './MonitorCriteriaInstance';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import Text from 'Common/Types/Text';
import MonitorStatus from 'Model/Models/MonitorStatus';
import IncidentSeverity from 'Model/Models/IncidentSeverity';

export interface ComponentProps {
    monitorCriteria: MonitorCriteria;
    monitorStatusOptions: Array<MonitorStatus>;
    incidentSeverityOptions: Array<IncidentSeverity>;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4">
            <ul role="list" className="space-y-6">
                {props.monitorCriteria.data?.monitorCriteriaInstanceArray.map(
                    (i: MonitorCriteriaInstance, index: number) => {
                        return (
                            <li className="relative flex gap-x-4" key={index}>
                                <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                                    <div className="w-px bg-slate-200"></div>
                                </div>
                                <div className="relative flex h-6 w-6 flex-none items-center justify-center bg-white">
                                    <div className="h-1.5 w-1.5 rounded-full bg-slate-100 ring-1 ring-slate-300"></div>
                                </div>

                                <p className="flex-auto py-0.5 text-sm leading-5 text-gray-500">
                                    <span className="font-medium text-gray-900">
                                        {i.data?.name || 'Criteria'}
                                    </span>{' '}
                                    This criteria will be checked{' '}
                                    {Text.convertNumberToWords(index + 1)}.
                                    <div className="mt-10 mb-10" key={index}>
                                        <MonitorCriteriaInstanceElement
                                            monitorStatusOptions={
                                                props.monitorStatusOptions
                                            }
                                            incidentSeverityOptions={
                                                props.incidentSeverityOptions
                                            }
                                            monitorCriteriaInstance={i}
                                            isLastCriteria={
                                                index ===
                                                (props.monitorCriteria.data
                                                    ?.monitorCriteriaInstanceArray
                                                    .length || 1) -
                                                    1
                                            }
                                        />
                                    </div>
                                </p>
                            </li>
                        );
                    }
                )}
            </ul>
        </div>
    );
};

export default MonitorCriteriaElement;
