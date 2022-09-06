import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import Monitor from 'Model/Models/Monitor';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import MonitorsElement from '../../../Components/Monitor/Monitors';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Color from 'Common/Types/Color';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Incident from 'Model/Models/Incident';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';

const MonitorIncidents: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Monitors'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_VIEW_INCIDENTS] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<Incident>
                modelType={Incident}
                id="incidents-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={true}
                ini
                isViewable={true}
                cardProps={{
                    icon: IconProp.Alert,
                    title: 'Incidents',
                    description:
                        'Here is a list of incidents for this monitor.',
                }}
                createInitialValues={{
                    monitors: [modelId.toString()],
                }}
                onViewPage={(item: Incident) => {
                    return new Route(
                        `/dashboard/${
                            props.currentProject?._id || ''
                        }/incidents/${item._id}`
                    );
                }}
                noItemsMessage={'No incidents created for this monitor so far.'}
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
                viewPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            _id: true,
                        },
                        title: 'Incident ID',
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
                            currentIncidentState: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Current State',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['currentIncidentState']) {
                                return (
                                    <Pill
                                        color={
                                            (
                                                item[
                                                    'currentIncidentState'
                                                ] as JSONObject
                                            )['color'] as Color
                                        }
                                        text={
                                            (
                                                item[
                                                    'currentIncidentState'
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
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                    },
                ]}
            />
        </Page>
    );
};

export default MonitorIncidents;
