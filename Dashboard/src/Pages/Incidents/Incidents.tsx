import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Page from 'CommonUI/src/Components/Page/Page';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import React, { FunctionComponent, ReactElement } from 'react';
import Incident from 'Model/Models/Incident';
import PageComponentProps from '../PageComponentProps';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import Monitor from 'Model/Models/Monitor';
import MonitorsElement from '../../Components/Monitor/Monitors';

const IncidentsPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Incidents'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Incidents',
                    to: RouteMap[PageMap.INCIDENTS] as Route,
                },
            ]}
        >
            <ModelTable<Incident>
                modelType={Incident}
                id="incidents-table"
                isDeleteable={false}
                isEditable={true}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    icon: IconProp.Alert,
                    title: 'Incidents',
                    description:
                        'Here is a list of incidents for this project.',
                }}
                noItemsMessage={'No incidents created for this project so far.'}
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Incident Title',
                        validation: {
                            noSpaces: true,
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
                            monitors: true,
                        },
                        title: 'Monitors affected',
                        description:
                            'Select monitors affected by this incident.',
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
                        title: 'Change Monitor Status to',
                        description:
                            'This will change the status of all the monitors attached to this incident.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: MonitorStatus,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Monitor Status',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                currentPageRoute={props.pageRoute}
                columns={[
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
                            currentIncidentState: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Incident State',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['currentIncidentState']) {
                                return (
                                    <Pill
                                        color={item['color'] as Color}
                                        text={item['name'] as string}
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
                            },
                        },
                        title: 'Monitors Affected',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <MonitorsElement
                                    monitors={
                                        Monitor.fromJSON(
                                            (item['monitors'] as JSONArray) ||
                                                [],
                                            Monitor
                                        ) as Array<Monitor>
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

export default IncidentsPage;
