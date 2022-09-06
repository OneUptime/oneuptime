import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Monitor from 'Model/Models/Monitor';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import MonitorTypeUtil from '../../Utils/MonitorType';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import LabelsElement from '../../Components/Label/Labels';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatus from 'Model/Models/MonitorStatus';

const MonitorPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Monitors'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Monitors',
                    to: RouteMap[PageMap.MONITORS] as Route,
                },
            ]}
        >
            <ModelTable<Monitor>
                modelType={Monitor}
                id="Monitors-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    icon: IconProp.Activity,
                    title: 'Monitors',
                    description: 'Here is a list of monitors for this project.',
                }}
                noItemsMessage={'No monitors found.'}
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
                    {
                        field: {
                            monitorType: true,
                        },
                        title: 'Monitor Type',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Select Monitor Type',
                        dropdownOptions:
                            MonitorTypeUtil.monitorTypesAsDropdownOptions(),
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels (Optional)',
                        description:
                            'Team members with access to these labels will only be able to access this monitor. This is optional and an advanced feature.',
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
                viewPageRoute={props.pageRoute}
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
                            projectId: props.currentProject?._id,
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
        </Page>
    );
};

export default MonitorPage;
