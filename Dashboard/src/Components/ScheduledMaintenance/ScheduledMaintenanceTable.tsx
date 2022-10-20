import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import React, { FunctionComponent, ReactElement } from 'react';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import Monitor from 'Model/Models/Monitor';
import MonitorsElement from '../Monitor/Monitors';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import Label from 'Model/Models/Label';
import LabelsElement from '../Label/Labels';
import Query from 'CommonUI/src/Utils/ModelAPI/Query';
import Route from 'Common/Types/API/Route';
import Project from 'Model/Models/Project';
import StatusPage from 'Model/Models/StatusPage';
import StatusPagesElement from '../StatusPage/StatusPagesLabel';
import MonitorStatus from 'Model/Models/MonitorStatus';

export interface ComponentProps {
    query?: Query<ScheduledMaintenance> | undefined;
    viewPageRoute?: Route;
    currentProject?: Project | undefined;
    noItemsMessage?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
}

const ScheduledMaintenancesTable: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <ModelTable<ScheduledMaintenance>
            modelType={ScheduledMaintenance}
            id="scheduledMaintenances-table"
            isDeleteable={false}
            query={props.query}
            isEditable={false}
            isCreateable={true}
            isViewable={true}
            cardProps={{
                icon: IconProp.Clock,
                title: props.title || 'Scheduled Maintenance Events',
                description:
                    props.description ||
                    'Here is a list of scheduled maintenance events for this project.',
            }}
            noItemsMessage={
                props.noItemsMessage || 'No scheduled Maintenance Event found.'
            }
            formFields={[
                {
                    field: {
                        title: true,
                    },
                    title: 'Title',
                    fieldType: FormFieldSchemaType.Text,
                    required: true,
                    placeholder: 'Event Title',
                    validation: {
                        minLength: 2,
                    },
                },
                {
                    field: {
                        description: true,
                    },
                    title: 'Description',
                    fieldType: FormFieldSchemaType.LongText,
                    required: true,
                    placeholder: 'Description',
                },
                {
                    field: {
                        startsAt: true,
                    },
                    title: 'Event Starts At',
                    description: 'This is in your local timezone',
                    fieldType: FormFieldSchemaType.DateTime,
                    required: true,
                    placeholder: 'Pick Date and Time',
                },
                {
                    field: {
                        endsAt: true,
                    },
                    title: 'Ends At',
                    description: 'This is in your local timezone',
                    fieldType: FormFieldSchemaType.DateTime,
                    required: true,
                    placeholder: 'Pick Date and Time',
                },
                {
                    field: {
                        monitors: true,
                    },
                    title: 'Monitors affected (Optional)',
                    description:
                        'Select monitors affected by this scheduled maintenance.',
                    fieldType: FormFieldSchemaType.MultiSelectDropdown,
                    dropdownModal: {
                        type: Monitor,
                        labelField: 'name',
                        valueField: '_id',
                    },
                    required: true,
                    placeholder: 'Monitors affected',
                },
                {
                    field: {
                        changeMonitorStatusTo: true,
                    },
                    title: 'Change Monitor Status to (optional)',
                    description:
                        'This will change the status of all the monitors attached when the event starts.',
                    fieldType: FormFieldSchemaType.Dropdown,
                    dropdownModal: {
                        type: MonitorStatus,
                        labelField: 'name',
                        valueField: '_id',
                    },
                    required: false,
                    placeholder: 'Monitor Status',
                },
                {
                    field: {
                        statusPages: true,
                    },
                    title: 'Show event on these status pages (Optional)',
                    description: 'Select status pages to show this event on',
                    fieldType: FormFieldSchemaType.MultiSelectDropdown,
                    dropdownModal: {
                        type: StatusPage,
                        labelField: 'name',
                        valueField: '_id',
                    },
                    required: true,
                    placeholder: 'Select Status Pages',
                },
                {
                    field: {
                        labels: true,
                    },
                    title: 'Labels (Optional)',
                    description:
                        'Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.',
                    fieldType: FormFieldSchemaType.MultiSelectDropdown,
                    dropdownModal: {
                        type: Label,
                        labelField: 'name',
                        valueField: '_id',
                    },
                    required: false,
                    placeholder: 'Labels',
                },
            ]}
            showRefreshButton={true}
            showFilterButton={true}
            viewPageRoute={props.viewPageRoute}
            columns={[
                {
                    field: {
                        _id: true,
                    },
                    title: 'Scheduled Maintenance ID',
                    type: FieldType.Text,
                    isFilterable: true,
                },
                {
                    field: {
                        title: true,
                    },
                    title: 'Title',
                    type: FieldType.Text,
                    isFilterable: true,
                },
                {
                    field: {
                        currentScheduledMaintenanceState: {
                            name: true,
                            color: true,
                        },
                    },
                    title: 'Current State',
                    type: FieldType.Entity,
                    isFilterable: true,
                    filterEntityType: ScheduledMaintenanceState,
                    filterQuery: {
                        projectId: props.currentProject?._id,
                    },
                    filterDropdownField: {
                        label: 'name',
                        value: '_id',
                    },
                    getElement: (item: JSONObject): ReactElement => {
                        if (item['currentScheduledMaintenanceState']) {
                            return (
                                <Pill
                                    color={
                                        (
                                            item[
                                                'currentScheduledMaintenanceState'
                                            ] as JSONObject
                                        )['color'] as Color
                                    }
                                    text={
                                        (
                                            item[
                                                'currentScheduledMaintenanceState'
                                            ] as JSONObject
                                        )['name'] as string
                                    }
                                />
                            );
                        }

                        return <></>;
                    },
                },

                {
                    field: {
                        monitors: {
                            name: true,
                            _id: true,
                            projectId: true,
                        },
                    },
                    title: 'Monitors Affected',
                    type: FieldType.EntityArray,
                    isFilterable: true,
                    filterEntityType: Monitor,
                    filterQuery: {
                        projectId: props.currentProject?._id,
                    },
                    filterDropdownField: {
                        label: 'name',
                        value: '_id',
                    },
                    getElement: (item: JSONObject): ReactElement => {
                        return (
                            <MonitorsElement
                                monitors={
                                    Monitor.fromJSON(
                                        (item['monitors'] as JSONArray) || [],
                                        Monitor
                                    ) as Array<Monitor>
                                }
                            />
                        );
                    },
                },
                {
                    field: {
                        statusPages: {
                            name: true,
                            _id: true,
                            projectId: true,
                        },
                    },
                    title: 'Shown on Status Page',
                    type: FieldType.EntityArray,
                    isFilterable: true,
                    filterEntityType: StatusPage,
                    filterQuery: {
                        projectId: props.currentProject?._id,
                    },
                    filterDropdownField: {
                        label: 'name',
                        value: '_id',
                    },
                    getElement: (item: JSONObject): ReactElement => {
                        return (
                            <StatusPagesElement
                                statusPages={
                                    StatusPage.fromJSON(
                                        (item['statusPages'] as JSONArray) ||
                                            [],
                                        StatusPage
                                    ) as Array<StatusPage>
                                }
                            />
                        );
                    },
                },
                {
                    field: {
                        startsAt: true,
                    },
                    title: 'Starts At',
                    type: FieldType.DateTime,
                    isFilterable: true,
                },
                {
                    field: {
                        endsAt: true,
                    },
                    title: 'Ends At',
                    type: FieldType.DateTime,
                    isFilterable: true,
                },
                {
                    field: {
                        labels: {
                            name: true,
                            color: true,
                        },
                    },
                    title: 'Labels',
                    type: FieldType.EntityArray,
                    isFilterable: true,
                    filterEntityType: Label,
                    filterQuery: {
                        projectId: props.currentProject?._id,
                    },
                    filterDropdownField: {
                        label: 'name',
                        value: '_id',
                    },
                    getElement: (item: JSONObject): ReactElement => {
                        return (
                            <LabelsElement
                                labels={
                                    Label.fromJSON(
                                        (item['labels'] as JSONArray) || [],
                                        Label
                                    ) as Array<Label>
                                }
                            />
                        );
                    },
                },
            ]}
        />
    );
};

export default ScheduledMaintenancesTable;
