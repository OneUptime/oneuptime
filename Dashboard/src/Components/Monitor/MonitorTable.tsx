import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Monitor from 'Model/Models/Monitor';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Label from 'Model/Models/Label';
import type { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../Components/Label/Labels';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import type Color from 'Common/Types/Color';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatus from 'Model/Models/MonitorStatus';
import type Query from 'CommonUI/src/Utils/ModelAPI/Query';
import type Route from 'Common/Types/API/Route';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import JSONFunctions from 'Common/Types/JSONFunctions';
import DashboardNavigation from '../../Utils/Navigation';

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
            isEditable={false}
            isCreateable={true}
            isViewable={true}
            query={props.query}
            onBeforeCreate={async (item: Monitor) => {
                item.monitorType = MonitorType.Manual;
                return item;
            }}
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
                    title: 'Description',
                    fieldType: FormFieldSchemaType.LongText,
                    required: true,
                    placeholder: 'Description',
                },
                // {
                //     field: {
                //         monitorType: true,
                //     },
                //     title: 'Monitor Type',
                //     fieldType: FormFieldSchemaType.Dropdown,
                //     required: true,
                //     placeholder: 'Select Monitor Type',
                //     dropdownOptions:
                //         MonitorTypeUtil.monitorTypesAsDropdownOptions(),
                // },
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
                        name: true,
                    },
                    title: 'Name',
                    type: FieldType.Text,
                    isFilterable: true,
                },
                // {
                //     field: {
                //         monitorType: true,
                //     },
                //     title: 'Monitor Type',
                //     type: FieldType.Text,
                //     isFilterable: true,
                // },
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
