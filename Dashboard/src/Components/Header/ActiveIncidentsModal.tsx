import React, { FunctionComponent, ReactElement } from 'react';
import FullPageModal from 'CommonUI/src/Components/FullPageModal/FullPageModal';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Incident from 'Model/Models/Incident';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import MonitorsElement from '../Monitor/Monitors';
import Monitor from 'Model/Models/Monitor';
import Color from 'Common/Types/Color';
import Route from 'Common/Types/API/Route';
import ProjectElement from '../Project/Project';
import Project from 'Model/Models/Project';

export interface ComponentProps {
    onClose: () => void;
}

const ActiveIncidentsModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            <FullPageModal
                onClose={() => {
                    props.onClose && props.onClose();
                }}
            >
                <ModelTable<Incident>
                    modelType={Incident}
                    id="incident-table"
                    isDeleteable={false}
                    query={{
                        currentIncidentState: {
                            order: 1,
                        },
                    }}
                    fetchRequestOptions={{
                        isMultiTenantRequest: true,
                    }}
                    selectMoreFields={{
                        projectId: true,
                    }}
                    isEditable={false}
                    showRefreshButton={true}
                    isCreateable={false}
                    isViewable={true}
                    onViewComplete={() => {
                        props.onClose && props.onClose();
                    }}
                    cardProps={{
                        icon: IconProp.Alert,
                        title: 'Active Incidents',
                        description:
                            'Here is a list of active incidents that belogns to all the projects you ara a part of.',
                    }}
                    noItemsMessage={'No incident found.'}
                    singularName="Active Incident"
                    pluralName="Active Incidents"
                    onViewPage={(item: Incident) => {
                        return new Route(
                            `/dashboard/${
                                item.projectId || item.project?._id || ''
                            }/incidents/${item._id}`
                        );
                    }}
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
                            isFilterable: true,
                            selectedProperty: 'name',
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <ProjectElement
                                        project={
                                            Project.fromJSON(
                                                (item[
                                                    'project'
                                                ] as JSONObject) || [],
                                                Project
                                            ) as Project
                                        }
                                        onNavigateComplete={() => {
                                            props.onClose();
                                        }}
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
                                                (item[
                                                    'monitors'
                                                ] as JSONArray) || [],
                                                Monitor
                                            ) as Array<Monitor>
                                        }
                                        onNavigateComplete={() => {
                                            props.onClose();
                                        }}
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
            </FullPageModal>
        </>
    );
};

export default ActiveIncidentsModal;
