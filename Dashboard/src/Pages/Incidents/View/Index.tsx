import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Incident from 'Model/Models/Incident';
import Color from 'Common/Types/Color';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import MonitorsElement from '../../../Components/Monitor/Monitors';
import Monitor from 'Model/Models/Monitor';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ChangeIncidentState, {
    IncidentType,
} from '../../../Components/Incident/ChangeState';
import BaseModel from 'Common/Models/BaseModel';

const IncidentView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam()?.toString().substring(1) || ''
    );

    return (
        <Page
            title={'Incidents'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Incident',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {/* Incident View  */}
            <CardModelDetail
                cardProps={{
                    title: 'Incident Details',
                    description: "Here's more details for this monitor.",
                    icon: IconProp.Activity,
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Incident Title',
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
                ]}
                modelDetailProps={{
                    onBeforeFetch: async (): Promise<JSONObject> => {
                        // get ack incident.

                        const incidentTimelines: ListResult<IncidentStateTimeline> =
                            await ModelAPI.getList(
                                IncidentStateTimeline,
                                {
                                    incidentId: modelId,
                                },
                                99,
                                0,
                                {
                                    _id: true,

                                    createdAt: true,
                                },
                                {},
                                {
                                    createdByUser: {
                                        name: true,
                                        email: true,
                                    },
                                    incidentState: {
                                        name: true,
                                        isResolvedState: true,
                                        isAcknowledgedState: true,
                                    },
                                }
                            );

                        return incidentTimelines;
                    },
                    showDetailsInNumberOfColumns: 2,
                    modelType: Incident,
                    id: 'model-detail-incidents',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Incident ID',
                            fieldType: FieldType.ObjectID,
                        },
                        {
                            field: {
                                title: true,
                            },
                            title: 'Incident Title',
                            fieldType: FieldType.Text,
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                            fieldType: FieldType.LongText,
                        },
                        {
                            field: {
                                currentIncidentState: {
                                    color: true,
                                    name: true,
                                },
                            },
                            title: 'Current State',
                            fieldType: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
                                if (!item['currentIncidentState']) {
                                    throw new BadDataException(
                                        'Incident Status not found'
                                    );
                                }

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
                            fieldType: FieldType.Text,
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
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                createdAt: true,
                            },
                            title: 'Created At',
                            fieldType: FieldType.DateTime,
                        },
                        {
                            title: 'Acknowledge Incident',
                            fieldType: FieldType.Text,
                            getElement: (
                                _item: JSONObject,
                                onBeforeFetchData: JSONObject,
                                fetchItems: Function
                            ): ReactElement => {
                                return (
                                    <ChangeIncidentState
                                        incidentId={modelId}
                                        incidentTimeline={
                                            onBeforeFetchData[
                                                'data'
                                            ] as Array<BaseModel>
                                        }
                                        incidentType={IncidentType.Ack}
                                        onActionComplete={() => {
                                            fetchItems();
                                        }}
                                    />
                                );
                            },
                        },
                        {
                            title: 'Resolve Incident',
                            fieldType: FieldType.Text,
                            getElement: (
                                _item: JSONObject,
                                onBeforeFetchData: JSONObject,
                                fetchItems: Function
                            ): ReactElement => {
                                return (
                                    <ChangeIncidentState
                                        incidentId={modelId}
                                        incidentTimeline={
                                            onBeforeFetchData[
                                                'data'
                                            ] as Array<BaseModel>
                                        }
                                        incidentType={IncidentType.Resolve}
                                        onActionComplete={() => {
                                            fetchItems();
                                        }}
                                    />
                                );
                            },
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Page>
    );
};

export default IncidentView;
