import React, { FunctionComponent, ReactElement } from 'react';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import Detail from 'CommonUI/src/Components/Detail/Detail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Black } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import OnCallDutyPoliciesView from '../../OnCallPolicy/OnCallPolicies';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    incident: CriteriaIncident;
    incidentSeverityOptions: Array<IncidentSeverity>;
    onCallPolicyOptions: Array<OnCallDutyPolicy>;
}

const MonitorCriteriaIncidentForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4 bg-gray-50 rounded rounded-xl p-5">
            <Detail
                id={'monitor-criteria-instance'}
                item={props.incident}
                showDetailsInNumberOfColumns={1}
                fields={[
                    {
                        key: 'title',
                        title: 'Incident Title',
                        fieldType: FieldType.Text,
                        placeholder: 'No data entered',
                    },
                    {
                        key: 'description',
                        title: 'Incident Description',
                        fieldType: FieldType.LongText,
                        placeholder: 'No data entered',
                    },
                    {
                        key: 'incidentSeverityId',
                        title: 'Incident Severity',
                        fieldType: FieldType.Dropdown,
                        placeholder: 'No data entered',
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['incidentSeverityId']) {
                                return (
                                    <Pill
                                        isMinimal={true}
                                        color={
                                            (props.incidentSeverityOptions.find(
                                                (option: IncidentSeverity) => {
                                                    return (
                                                        option.id?.toString() ===
                                                        item[
                                                            'incidentSeverityId'
                                                        ]!.toString()
                                                    );
                                                }
                                            )?.color as Color) || Black
                                        }
                                        text={
                                            (props.incidentSeverityOptions.find(
                                                (option: IncidentSeverity) => {
                                                    return (
                                                        option.id?.toString() ===
                                                        item[
                                                            'incidentSeverityId'
                                                        ]!.toString()
                                                    );
                                                }
                                            )?.name as string) || ''
                                        }
                                    />
                                );
                            }

                            return <></>;
                        },
                    },
                    {
                        key: 'autoResolveIncident',
                        title: 'Auto Resolve Incident',
                        description:
                            'Automatically resolve this incident when this criteria is no longer met.',
                        fieldType: FieldType.Boolean,
                        placeholder: 'No',
                    },
                    {
                        key: 'onCallPolicyIds',
                        title: 'On Call Policies',
                        description:
                            'These are the on call policies that will be executed when this incident is created.',
                        fieldType: FieldType.Element,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <OnCallDutyPoliciesView
                                    onCallPolicies={props.onCallPolicyOptions.filter(
                                        (policy) => {
                                            return (
                                                (item[
                                                    'onCallPolicyIds'
                                                ] as Array<ObjectID>) || []
                                            )
                                                .map((id) => {
                                                    return id.toString();
                                                })
                                                .includes(
                                                    policy.id?.toString() || ''
                                                );
                                        }
                                    )}
                                />
                            );
                        },
                    },
                ]}
            />
        </div>
    );
};

export default MonitorCriteriaIncidentForm;
