import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import MonitorStatusTimeline from "Model/Models/MonitorStatusTimeline"
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import MonitorStatus from 'Model/Models/MonitorStatus';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Statusbubble from 'CommonUI/src/Components/StatusBubble/StatusBubble';
import Color from 'Common/Types/Color';

const MonitorDelete: FunctionComponent<PageComponentProps> = (
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
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route, modelId)
                },
                {
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route, modelId),
                },
                {
                    title: 'View Monitor',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITOR_VIEW] as Route, modelId),
                },
                {
                    title: 'Status Timeline',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route, modelId),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            
            <ModelTable<MonitorStatusTimeline>
                modelType={MonitorStatusTimeline}
                id="table-monitor-status-timeline"
                isDeleteable={true}
                isCreateable={true}
                isViewable={false}
                query={{
                    monitorId: modelId,
                    projectId: props.currentProject?._id,
                }}
                onBeforeCreate={(
                    item: MonitorStatusTimeline
                ): Promise<MonitorStatusTimeline> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.monitorId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.List,
                    title: 'Status Timeline',
                    description:
                        'Here is the status timeline for this monitor',
                }}
                noItemsMessage={'No status timeline created for this monitor so far.'}
                formFields={[
                    {
                        field: {
                            monitorStatus: true,
                        },
                        title: 'Monitor Status',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Monitor Status',
                        dropdownModal: {
                            type: MonitorStatus,
                            labelField: 'name',
                            valueField: '_id',
                        },
                    }
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                currentPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            monitorStatus: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Monitor Status',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            if (!item['monitorStatus']) {
                                throw new BadDataException(
                                    'Monitor Status not found'
                                );
                            }

                            return (
                                <Statusbubble
                                    color={
                                        (
                                            item[
                                                'monitorStatus'
                                            ] as JSONObject
                                        )['color'] as Color
                                    }
                                    text={
                                        (
                                            item[
                                                'monitorStatus'
                                            ] as JSONObject
                                        )['name'] as string
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            createdAt: true
                        },
                        title: 'Starts at',
                        type: FieldType.Date,
                    },
                ]}
            />
           
        </Page>
    );
};

export default MonitorDelete;
