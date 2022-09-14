import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageResource from 'Model/Models/StatusPageResource';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import SortOrder from 'Common/Types/Database/SortOrder';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Monitor from 'Model/Models/Monitor';
import { JSONObject } from 'Common/Types/JSON';
import MonitorElement from '../../../Components/Monitor/Monitor'; 

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Status Page'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Delete Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            


            <ModelTable<StatusPageResource>
                modelType={StatusPageResource}
                id="status-page-group"
                isDeleteable={true}
                sortBy="order"
                sortOrder={SortOrder.Ascending}
                isCreateable={true}
                isViewable={false}
                query={{
                    statusPageId: modelId,
                    projectId: props.currentProject?._id,
                }}
                enableDragAndDrop={true}
                dragDropIndexField="order"
                onBeforeCreate={(
                    item: StatusPageResource
                ): Promise<StatusPageResource> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.statusPageId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.Activity,
                    title: 'Status Page Resources',
                    description:
                        'Resources that will be shown on the page',
                }}
                noItemsMessage={
                    'No status page reosurces created for this status page.'
                }
                formFields={[
                    {
                        field: {
                            monitor: true,
                        },
                        title: 'Monitor',
                        description:
                            'Select monitor that will be shown on the status page.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: Monitor,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Select Monitor',
                    },
                    {
                        field: {
                            displayName: true,
                        },
                        title: 'Display Name',
                        description:
                            'This will be the name that will be shown on the status page.',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Display Name',
                    },
                    {
                        field: {
                            displayDescription: true,
                        },
                        title: 'Group Description (Optional)',
                        fieldType: FormFieldSchemaType.LongText,
                        required: false,
                        description: 'This will be visible on the status page.',
                        placeholder: 'Display Description.',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={props.pageRoute}
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
                            projectId: props.currentProject?._id,
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <MonitorElement
                                    monitor={
                                        Monitor.fromJSON(
                                            (item['monitor'] as JSONObject) ||
                                                [],
                                            Monitor
                                        ) as Monitor
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            displayName: true,
                        },
                        title: 'Display Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            displayDescription: true,
                        },
                        title: 'Display Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />
            

        </Page>
    );
};

export default StatusPageDelete;
