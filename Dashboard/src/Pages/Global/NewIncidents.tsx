import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Incident from 'Model/Models/Incident';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import MonitorsElement from '../../Components/Monitor/Monitors';
import Monitor from 'Model/Models/Monitor';
import Color from 'Common/Types/Color';
import ProjectElement from '../../Components/Project/Project';
import Project from 'Model/Models/Project';
import BaseModel from 'Common/Models/BaseModel';
import { RequestOptions } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';

const Home: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'New Incidents'}
            breadcrumbLinks={[
                {
                    title: 'Home',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'New Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.NEW_INCIDENTS] as Route
                    ),
                },
            ]}
        >
            <ModelTable<Incident>
                modelType={Incident}
                name="New Incidents"
                id="incident-table"
                isDeleteable={false}
                query={{
                    currentIncidentState: {
                        order: 1,
                    },
                }}
                fetchRequestOptions={
                    {
                        isMultiTenantRequest: true,
                    } as RequestOptions
                }
                selectMoreFields={{
                    projectId: true,
                }}
                isEditable={false}
                showRefreshButton={true}
                isCreateable={false}
                isViewable={true}
                cardProps={{
                    title: 'New Incidents',
                    description:
                        'Here is a list of new incidents for all of the projects you are a part of.',
                }}
                noItemsMessage={'No incident found.'}
                singularName="New Incident"
                pluralName="New Incidents"
                onViewPage={(item: Incident): Promise<Route> => {
                    return Promise.resolve(
                        new Route(
                            `/dashboard/${item.projectId || item.project?._id || ''
                            }/incidents/${item._id}`
                        )
                    );
                }}
                filters={[

                    {
                        field: {
                            project: {
                                name: true,
                                _id: true,
                            },

                        },
                        type: FieldType.Text,
                        title: 'Project',
                    },
                    {
                        field: {
                            _id: true,
                        },
                        type: FieldType.Text,
                        title: 'Incident ID',
                    },
                    {
                        field: {
                            title: true,
                        },
                        type: FieldType.Text,
                        title: 'Title',
                    },
                    {
                        field: {
                            currentIncidentState: {
                                name: true,
                                color: true,
                            },
                        },
                        type: FieldType.Entity,
                        title: 'Current State',
                    },
                    {
                        field: {
                            incidentSeverity: {
                                name: true,
                                color: true,
                            },
                        },
                        type: FieldType.Entity,
                        title: 'Incident Severity',
                    },
                    {
                        field: {
                            monitors: {
                                name: true,
                                _id: true,
                                projectId: true,
                            },
                        },
                        type: FieldType.Text,
                        title: 'Monitors Affected',
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        type: FieldType.DateTime,
                        title: 'Created At',
                    },
                ]}
                columns={[
                    {
                        field: {
                            project: {
                                name: true,
                                _id: true,
                            },
                        },
                        title: 'Project',
                        type: FieldType.Text,
                       
                        selectedProperty: 'name',
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <ProjectElement
                                    project={
                                        BaseModel.fromJSON(
                                            (item['project'] as JSONObject) ||
                                            [],
                                            Project
                                        ) as Project
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            _id: true,
                        },
                        title: 'Incident ID',
                        type: FieldType.Text,
                       
                    },
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        type: FieldType.Text,
                       
                    },
                    {
                        field: {
                            currentIncidentState: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Current State',
                        type: FieldType.Entity,
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
                            incidentSeverity: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Incident Severity',
                        type: FieldType.Entity,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['incidentSeverity']) {
                                return (
                                    <Pill
                                        color={
                                            (
                                                item[
                                                'incidentSeverity'
                                                ] as JSONObject
                                            )['color'] as Color
                                        }
                                        text={
                                            (
                                                item[
                                                'incidentSeverity'
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
                                        BaseModel.fromJSON(
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

export default Home;
