import React, { FunctionComponent, ReactElement } from 'react';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import Detail from 'CommonUI/src/Components/Detail/Detail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import { JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Black } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';

export interface ComponentProps {
    incident: CriteriaIncident;
    incidentSeverityOptions: Array<IncidentSeverity>;
}

const MonitorCriteriaIncidentForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4 bg-gray-50 rounded rounded-xl p-10">
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
                ]}
            />
        </div>
    );
};

export default MonitorCriteriaIncidentForm;
