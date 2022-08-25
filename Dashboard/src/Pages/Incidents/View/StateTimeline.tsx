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
import IncidentStateTimeline from "Model/Models/IncidentStateTimeline"
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IncidentState from 'Model/Models/IncidentState';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import Color from 'Common/Types/Color';
import Pill from 'CommonUI/src/Components/Pill/Pill';

const IncidentDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam(1)?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Incidents'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route, modelId)
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENTS] as Route, modelId),
                },
                {
                    title: 'View Incident',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW] as Route, modelId),
                },
                {
                    title: 'Status Timeline',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW_STATE_TIMELINE] as Route, modelId),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            
            <ModelTable<IncidentStateTimeline>
                modelType={IncidentStateTimeline}
                id="table-incident-status-timeline"
                isDeleteable={true}
                isCreateable={true}
                isViewable={false}
                query={{
                    incidentId: modelId,
                    projectId: props.currentProject?._id,
                }}
                onBeforeCreate={(
                    item: IncidentStateTimeline
                ): Promise<IncidentStateTimeline> => {
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.incidentId = modelId;
                    item.projectId = props.currentProject.id;
                    return Promise.resolve(item);
                }}
                cardProps={{
                    icon: IconProp.List,
                    title: 'Status Timeline',
                    description:
                        'Here is the status timeline for this incident',
                }}
                noItemsMessage={'No status timeline created for this incident so far.'}
                formFields={[
                    {
                        field: {
                            incidentState: true,
                        },
                        title: 'Incident Status',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Incident Status',
                        dropdownModal: {
                            type: IncidentState,
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
                            incidentState: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Incident Status',
                        type: FieldType.Text,
                        isFilterable: true,
                        getElement: (item: JSONObject): ReactElement => {
                            if (!item['incidentState']) {
                                throw new BadDataException(
                                    'Incident Status not found'
                                );
                            }

                            return (
                                <Pill
                                    color={
                                        (
                                            item[
                                                'incidentState'
                                            ] as JSONObject
                                        )['color'] as Color
                                    }
                                    text={
                                        (
                                            item[
                                                'incidentState'
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
                        title: 'Reported At',
                        type: FieldType.Date,
                    },
                ]}
            />
           
        </Page>
    );
};

export default IncidentDelete;
