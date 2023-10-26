import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import MonitorGroupResource from 'Model/Models/MonitorGroupResource';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Monitor from 'Model/Models/Monitor';
import { JSONObject } from 'Common/Types/JSON';
import MonitorElement from '../../../Components/Monitor/Monitor';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Navigation from 'CommonUI/src/Utils/Navigation';
import StatusPage from 'Model/Models/StatusPage';

const MonitorGroupResources: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Monitor Group"
            modelType={StatusPage}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Monitor Groups',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUPS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Monitor Group',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITOR_GROUP_VIEW_MONITORS] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <>
                <ModelTable<MonitorGroupResource>
                    modelType={MonitorGroupResource}
                    id={`monitor-group-resources`}
                    isDeleteable={true}
                    name="Monitor Group > Resources"
                    showViewIdButton={true}
                    isCreateable={true}
                    isViewable={false}
                    isEditable={true}
                    query={{
                        monitorGroupId: modelId,
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    onBeforeCreate={(
                        item: MonitorGroupResource
                    ): Promise<MonitorGroupResource> => {
                        if (
                            !props.currentProject ||
                            !props.currentProject._id
                        ) {
                            throw new BadDataException(
                                'Project ID cannot be null'
                            );
                        }
                        item.monitorGroupId = modelId;
                        item.projectId = new ObjectID(props.currentProject._id);

                        return Promise.resolve(item);
                    }}
                    cardProps={{
                        title: `Monitor Group Resources`,
                        description:
                            'Resources that belong to this monitor group.',
                    }}
                    noItemsMessage={
                        'No resources have been added to this monitor group.'
                    }
                    formFields={[
                        {
                            field: {
                                monitor: true,
                            },
                            title: 'Monitor',
                            description:
                                'Select monitor that will be added to this group.',
                            fieldType: FormFieldSchemaType.Dropdown,
                            dropdownModal: {
                                type: Monitor,
                                labelField: 'name',
                                valueField: '_id',
                            },
                            required: true,
                            placeholder: 'Select Monitor',
                        },
                    ]}
                    showRefreshButton={true}
                    showFilterButton={true}
                    viewPageRoute={Navigation.getCurrentRoute()}
                    columns={[
                        {
                            field: {
                                monitor: {
                                    name: true,
                                    _id: true,
                                    projectId: true,
                                },
                            },
                            title: 'Monitor',
                            type: FieldType.Entity,
                            isFilterable: true,
                            filterEntityType: Monitor,
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
                                    <MonitorElement
                                        monitor={
                                            JSONFunctions.fromJSON(
                                                (item[
                                                    'monitor'
                                                ] as JSONObject) || [],
                                                Monitor
                                            ) as Monitor
                                        }
                                    />
                                );
                            },
                        },
                    ]}
                />
            </>
        </ModelPage>
    );
};

export default MonitorGroupResources;
