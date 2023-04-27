import React, { FunctionComponent, ReactElement } from 'react';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';

import CriteriaFilters from './CriteriaFilters';

import MonitorCriteriaIncidents from './MonitorCriteriaIncidents';

import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import Icon from 'CommonUI/src/Components/Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import MonitorStatus from 'Model/Models/MonitorStatus';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import { Black } from 'Common/Types/BrandColors';

export interface ComponentProps {
    monitorStatusOptions: Array<MonitorStatus>;
    incidentSeverityOptions: Array<IncidentSeverity>;
    isLastCriteria: boolean;
    monitorCriteriaInstance: MonitorCriteriaInstance;
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mb-4">
            {props.monitorCriteriaInstance.data?.description && (
                <p className="-mt-8">
                    {props.monitorCriteriaInstance.data?.description}
                </p>
            )}

            <div className="mt-4">

            <div className="flex">
                    <Icon
                        icon={IconProp.Filter}
                        className="h-5 w-5 text-gray-900"
                    />
                    <p className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                        <span className="font-medium text-gray-900">
                        Filters ({props.monitorCriteriaInstance.data?.filterCondition})
                        </span>{' '}
                        {props.monitorCriteriaInstance.data?.filterCondition} of these should match for this criteria to be met:
                        
                    </p>
                    
                </div>

                <CriteriaFilters
                    criteriaFilters={
                        props.monitorCriteriaInstance?.data?.filters || []
                    }
                />
            </div>

            <div className="mt-4">
                <div className="flex">
                    <Icon
                        icon={IconProp.AltGlobe}
                        className="h-5 w-5 text-gray-900"
                    />
                    <p className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                        <span className="font-medium text-gray-900">
                            Change Monitor Status
                        </span>{' '}
                        when this criteria is met. Change monitor status to:
                        <span className='ml-3'>
                        <Pill
                        color={
                            (props.monitorStatusOptions.find(
                                (option: IncidentSeverity) => {
                                    return (
                                        option.id?.toString() ===
                                        props.monitorCriteriaInstance.data?.monitorStatusId?.toString()
                                    );
                                }
                            )?.color as Color) || Black
                        }
                        text={
                            (props.monitorStatusOptions.find(
                                (option: IncidentSeverity) => {
                                    return (
                                        option.id?.toString() ===
                                        props.monitorCriteriaInstance.data?.monitorStatusId?.toString()
                                    );
                                }
                            )?.name as string) || ''
                        }
                    />
                    </span>
                    </p>
                    
                </div>
            </div>

            <div className="mt-4">
                <div className="flex">
                    <Icon
                        icon={IconProp.Alert}
                        className="h-5 w-5 text-gray-900"
                    />
                    <p className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                        <span className="font-medium text-gray-900">
                            Create incident
                        </span>{' '}
                        when this criteria is met. These are the incident
                        details:{' '}
                    </p>
                </div>
                <MonitorCriteriaIncidents
                    incidents={
                        props.monitorCriteriaInstance?.data?.incidents || []
                    }
                    incidentSeverityOptions={props.incidentSeverityOptions}
                />
            </div>

            {!props.isLastCriteria && <HorizontalRule />}
        </div>
    );
};

export default MonitorCriteriaInstanceElement;
