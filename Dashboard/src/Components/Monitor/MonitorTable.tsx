import React, { FunctionComponent, ReactElement } from 'react';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Monitor from 'Model/Models/Monitor';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../Components/Label/Labels';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatus from 'Model/Models/MonitorStatus';
import Query from 'CommonUI/src/Utils/ModelAPI/Query';
import Route from 'Common/Types/API/Route';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import JSONFunctions from 'Common/Types/JSONFunctions';
import DashboardNavigation from '../../Utils/Navigation';
import MonitorTypeUtil from '../../Utils/MonitorType';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import MonitorSteps from '../Form/Monitor/MonitorSteps';
import {
    CustomElementProps,
    FormFieldStyleType,
} from 'CommonUI/src/Components/Forms/Types/Field';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import MonitoringIntrerval from '../../Utils/MonitorIntervalDropdownOptions';
import MonitorStepsType from 'Common/Types/Monitor/MonitorSteps';
import Team from 'Model/Models/Team';
import ProjectUser from '../../Utils/ProjectUser';

export interface ComponentProps {
    query?: Query<Monitor> | undefined;
    viewPageRoute?: Route;
    noItemsMessage?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
}

const MonitorsTable: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <ModelTable<Monitor>
            modelType={Monitor}
            name="Monitors"
            id="Monitors-table"
            isDeleteable={false}
            showViewIdButton={true}
            isEditable={false}
            isCreateable={true}
            isViewable={true}
            query={props.query}
            createEditModalWidth={ModalWidth.Large}
            formSteps={[
                {
                    title: 'Monitor Info',
                    id: 'monitor-info',
                },
                {
                    title: 'Criteria',
                    id: 'criteria',
                    showIf: (values: FormValues<Monitor>) => {
                        return values.monitorType !== MonitorType.Manual;
                    },
                },
                {
                    title: 'Interval',
                    id: 'monitoring-interval',
                    showIf: (values: FormValues<Monitor>) => {
                        return values.monitorType !== MonitorType.Manual && values.monitorType !== MonitorType.IncomingRequest; 
                    },
                },
                {
                    title: 'Owners',
                    id: 'owners',
                },
                {
                    title: 'Labels',
                    id: 'labels',
                },
            ]}
            cardProps={{
                icon: IconProp.AltGlobe,
                title: props.title || 'Monitors',
                description:
                    props.description ||
                    'Here is a list of monitors for this project.',
            }}
            noItemsMessage={props.noItemsMessage || 'No monitors found.'}
            formFields={[
                {
                    field: {
                        name: true,
                    },
                    title: 'Name',
                    stepId: 'monitor-info',
                    fieldType: FormFieldSchemaType.Text,
                    required: true,
                    placeholder: 'Monitor Name',
                    validation: {
                        minLength: 2,
                    },
                },
                {
                    field: {
                        description: true,
                    },
                    stepId: 'monitor-info',
                    title: 'Description',
                    fieldType: FormFieldSchemaType.LongText,
                    required: true,
                    placeholder: 'Description',
                },
                {
                    field: {
                        monitorType: true,
                    },
                    title: 'Monitor Type',
                    stepId: 'monitor-info',
                    fieldType: FormFieldSchemaType.Dropdown,
                    required: true,
                    placeholder: 'Select Monitor Type',
                    dropdownOptions:
                        MonitorTypeUtil.monitorTypesAsDropdownOptions(),
                },
                {
                    field: {
                        monitorSteps: true,
                    },
                    stepId: 'criteria',
                    styleType: FormFieldStyleType.Heading,
                    title: 'Monitor Details',
                    fieldType: FormFieldSchemaType.CustomComponent,
                    required: true,
                    customValidation: (values: FormValues<Monitor>) => {
                        const error: string | null =
                            MonitorStepsType.getValidationError(
                                values.monitorSteps as MonitorStepsType,
                                values.monitorType as MonitorType
                            );

                        return error;
                    },
                    getCustomElement: (
                        value: FormValues<Monitor>,
                        props: CustomElementProps
                    ) => {
                        return (
                            <MonitorSteps
                                {...props}
                                monitorType={
                                    value.monitorType || MonitorType.Manual
                                }
                                error={''}
                            />
                        );
                    },
                },
                {
                    field: {
                        monitoringInterval: true,
                    },
                    stepId: 'monitoring-interval',
                    title: 'Monitoring Interval',
                    fieldType: FormFieldSchemaType.Dropdown,
                    required: true,
                    dropdownOptions: MonitoringIntrerval,
                    placeholder: 'Select Monitoring Interval',
                },
                {
                    field: {
                        ownerTeams: true,
                    },
                    forceShow: true,
                    title: 'Owner - Teams',
                    stepId: 'owners',
                    description:
                        'Select which teams own this monitor. They will be notified when monitor status changes.',
                    fieldType: FormFieldSchemaType.MultiSelectDropdown,
                    dropdownModal: {
                        type: Team,
                        labelField: 'name',
                        valueField: '_id',
                    },
                    required: false,
                    placeholder: 'Select Teams',
                    overideFieldKey: 'ownerTeams',
                },
                {
                    field: {
                        ownerUsers: true,
                    },
                    forceShow: true,
                    title: 'Owner - Users',
                    stepId: 'owners',
                    description:
                        'Select which users own this incident. They will be notified when monitor status changes.',
                    fieldType: FormFieldSchemaType.MultiSelectDropdown,
                    fetchDropdownOptions: async () => {
                        return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                            DashboardNavigation.getProjectId()!
                        );
                    },
                    required: false,
                    placeholder: 'Select Users',
                    overideFieldKey: 'ownerUsers',
                },
                {
                    field: {
                        labels: true,
                    },
                    title: 'Labels ',
                    stepId: 'labels',
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
                        name: true,
                    },
                    title: 'Name',
                    type: FieldType.Text,
                    isFilterable: true,
                },
                {
                    field: {
                        monitorType: true,
                    },
                    title: 'Monitor Type',
                    type: FieldType.Text,
                    isFilterable: true,
                    filterDropdownField:
                        MonitorTypeUtil.monitorTypesAsDropdownOptions(),
                },
                {
                    field: {
                        currentMonitorStatus: {
                            color: true,
                            name: true,
                        },
                    },
                    isFilterable: true,
                    filterEntityType: MonitorStatus,
                    filterQuery: {
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    },
                    filterDropdownField: {
                        label: 'name',
                        value: '_id',
                    },
                    title: 'Monitor Status',
                    type: FieldType.Entity,
                    getElement: (item: JSONObject): ReactElement => {
                        if (!item['currentMonitorStatus']) {
                            throw new BadDataException(
                                'Monitor Status not found'
                            );
                        }

                        return (
                            <Statusbubble
                                color={
                                    (
                                        item[
                                            'currentMonitorStatus'
                                        ] as JSONObject
                                    )['color'] as Color
                                }
                                text={
                                    (
                                        item[
                                            'currentMonitorStatus'
                                        ] as JSONObject
                                    )['name'] as string
                                }
                            />
                        );
                    },
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
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    },
                    filterDropdownField: {
                        label: 'name',
                        value: '_id',
                    },
                    getElement: (item: JSONObject): ReactElement => {
                        return (
                            <LabelsElement
                                labels={
                                    JSONFunctions.fromJSON(
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

export default MonitorsTable;
