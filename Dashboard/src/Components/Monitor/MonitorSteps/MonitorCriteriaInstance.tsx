import React, { FunctionComponent, ReactElement } from 'react';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';

import CriteriaFilters from './CriteriaFilters';

import MonitorCriteriaIncidents from './MonitorCriteriaIncidents';

import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import Icon from 'CommonUI/src/Components/Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import MonitorStatus from 'Model/Models/MonitorStatus';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import Color from 'Common/Types/Color';
import { Black } from 'Common/Types/BrandColors';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import { FilterCondition } from 'Common/Types/Monitor/CriteriaFilter';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';

export interface ComponentProps {
    monitorStatusOptions: Array<MonitorStatus>;
    incidentSeverityOptions: Array<IncidentSeverity>;
    isLastCriteria: boolean;
    monitorCriteriaInstance: MonitorCriteriaInstance;
    onCallPolicyOptions: Array<OnCallDutyPolicy>;
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mb-4">
            {props.monitorCriteriaInstance.data?.description && (
                <div className="-mt-8">
                    {props.monitorCriteriaInstance.data?.description}
                </div>
            )}

            <div className="mt-4">
                <div className="flex">
                    <Icon
                        icon={IconProp.Filter}
                        className="h-5 w-5 text-gray-900"
                    />
                    <div className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                        <span className="font-medium text-gray-900">
                            Filters (
                            {
                                props.monitorCriteriaInstance.data
                                    ?.filterCondition
                            }
                            )
                        </span>{' '}
                        {props.monitorCriteriaInstance.data?.filterCondition} of
                        these can match for this criteria to be met:
                    </div>
                </div>

                <CriteriaFilters
                    criteriaFilters={
                        props.monitorCriteriaInstance?.data?.filters || []
                    }
                    filterCondition={
                        props.monitorCriteriaInstance?.data?.filterCondition ||
                        FilterCondition.Any
                    }
                />
            </div>

            {props.monitorCriteriaInstance.data?.monitorStatusId && (
                <div className="mt-4">
                    <div className="flex">
                        <Icon
                            icon={IconProp.AltGlobe}
                            className="h-5 w-5 text-gray-900"
                        />
                        <div className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                            <span className="font-medium text-gray-900">
                                Change Monitor Status
                            </span>{' '}
                            when this criteria is met. Change monitor status to:
                            <div className="mt-3">
                                <Statusbubble
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
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {(props.monitorCriteriaInstance?.data?.incidents?.length || 0) >
                0 && (
                <div className="mt-4">
                    <div className="flex">
                        <Icon
                            icon={IconProp.Alert}
                            className="h-5 w-5 text-gray-900"
                        />
                        <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                            <span className="font-medium text-gray-900">
                                Create incident
                            </span>{' '}
                            when this criteria is met. These are the incident
                            details:{' '}
                        </div>
                    </div>
                    <MonitorCriteriaIncidents
                        incidents={
                            props.monitorCriteriaInstance?.data?.incidents || []
                        }
                        onCallPolicyOptions={props.onCallPolicyOptions}
                        incidentSeverityOptions={props.incidentSeverityOptions}
                    />
                </div>
            )}

            <div className="mt-10">
                {!props.isLastCriteria && <HorizontalRule />}
            </div>
        </div>
    );
};

export default MonitorCriteriaInstanceElement;
