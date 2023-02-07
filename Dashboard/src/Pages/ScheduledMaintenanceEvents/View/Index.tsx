import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import Color from 'Common/Types/Color';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import MonitorsElement from '../../../Components/Monitor/Monitors';
import Monitor from 'Model/Models/Monitor';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ChangeScheduledMaintenanceState, {
    StateType,
} from '../../../Components/ScheduledMaintenance/ChangeState';
import BaseModel from 'Common/Models/BaseModel';
import Label from 'Model/Models/Label';
import LabelsElement from '../../../Components/Label/Labels';
import StatusPage from 'Model/Models/StatusPage';
import StatusPagesElement from '../../../Components/StatusPage/StatusPagesLabel';
import JSONFunctions from 'Common/Types/JSONFunctions';
import OneUptimeDate from 'Common/Types/Date';

const ScheduledMaintenanceView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return (
        <Page
            title={'Scheduled Maintenance Event'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        modelId
                    ),
                },
                {
                    title: 'Scheduled Maintenance Events',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Scheduled Maintenance Event',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {/* ScheduledMaintenance View  */}
            <CardModelDetail
                name="Scheduled Maintenance Details"
                cardProps={{
                    title: 'Scheduled Maintenance Details',
                    description: "Here's more details for this event.",
                    icon: IconProp.Clock,
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Scheduled Maintenance Title',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Scheduled Maintenance Title',
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
                            startsAt: true,
                        },
                        title: 'Event Starts At',
                        description:
                            'This is in your local timezone - ' +
                            OneUptimeDate.getCurrentTimezoneString(),
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        placeholder: 'Pick Date and Time',
                    },
                    {
                        field: {
                            endsAt: true,
                        },
                        title: 'Ends At',
                        description:
                            'This is in your local timezone - ' +
                            OneUptimeDate.getCurrentTimezoneString(),
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        placeholder: 'Pick Date and Time',
                    },
                    {
                        field: {
                            monitors: true,
                        },
                        title: 'Monitors affected (Optional)',
                        description:
                            'Select monitors affected by this scheduled maintenance.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Monitor,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Monitors affected',
                    },
                    {
                        field: {
                            statusPages: true,
                        },
                        title: 'Show event on these status pages (Optional)',
                        description:
                            'Select status pages to show this event on',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: StatusPage,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Select Status Pages',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels (Optional)',
                        description:
                            'Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.',
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
                modelDetailProps={{
                    onBeforeFetch: async (): Promise<JSONObject> => {
                        // get ack scheduledMaintenance.

                        const scheduledMaintenanceTimelines: ListResult<ScheduledMaintenanceStateTimeline> =
                            await ModelAPI.getList(
                                ScheduledMaintenanceStateTimeline,
                                {
                                    scheduledMaintenanceId: modelId,
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
                                        profilePictureId: true,
                                    },
                                    scheduledMaintenanceState: {
                                        name: true,
                                        isResolvedState: true,
                                        isOngoingState: true,
                                        isScheduledState: true,
                                    },
                                }
                            );

                        return scheduledMaintenanceTimelines;
                    },
                    showDetailsInNumberOfColumns: 2,
                    modelType: ScheduledMaintenance,
                    id: 'model-detail-scheduledMaintenances',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Scheduled Maintenance ID',
                            fieldType: FieldType.ObjectID,
                        },
                        {
                            field: {
                                title: true,
                            },
                            title: 'Scheduled Maintenance Title',
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
                                currentScheduledMaintenanceState: {
                                    color: true,
                                    name: true,
                                },
                            },
                            title: 'Current State',
                            fieldType: FieldType.Entity,
                            getElement: (item: JSONObject): ReactElement => {
                                if (!item['currentScheduledMaintenanceState']) {
                                    throw new BadDataException(
                                        'Scheduled Maintenance Status not found'
                                    );
                                }

                                return (
                                    <Pill
                                        color={
                                            (
                                                item[
                                                    'currentScheduledMaintenanceState'
                                                ] as JSONObject
                                            )['color'] as Color
                                        }
                                        text={
                                            (
                                                item[
                                                    'currentScheduledMaintenanceState'
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
                                            JSONFunctions.fromJSON(
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
                                statusPages: {
                                    name: true,
                                    _id: true,
                                },
                            },
                            title: 'Shown on Status Pages',
                            fieldType: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <StatusPagesElement
                                        statusPages={
                                            JSONFunctions.fromJSON(
                                                (item[
                                                    'statusPages'
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
                                startsAt: true,
                            },
                            title: 'Starts At',
                            fieldType: FieldType.DateTime,
                        },
                        {
                            field: {
                                endsAt: true,
                            },
                            title: 'Ends At',
                            fieldType: FieldType.DateTime,
                        },
                        {
                            field: {
                                createdAt: true,
                            },
                            title: 'Created At',
                            fieldType: FieldType.DateTime,
                        },
                        {
                            field: {
                                labels: {
                                    name: true,
                                    color: true,
                                },
                            },
                            title: 'Labels',
                            type: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <LabelsElement
                                        labels={
                                            JSONFunctions.fromJSON(
                                                (item['labels'] as JSONArray) ||
                                                    [],
                                                Label
                                            ) as Array<Label>
                                        }
                                    />
                                );
                            },
                        },
                        {
                            title: 'Change State to Ongoing',
                            fieldType: FieldType.Text,
                            getElement: (
                                _item: JSONObject,
                                onBeforeFetchData: JSONObject,
                                fetchItems: Function
                            ): ReactElement => {
                                return (
                                    <ChangeScheduledMaintenanceState
                                        scheduledMaintenanceId={modelId}
                                        scheduledMaintenanceTimeline={
                                            onBeforeFetchData[
                                                'data'
                                            ] as Array<BaseModel>
                                        }
                                        stateType={StateType.Ongoing}
                                        onActionComplete={() => {
                                            fetchItems();
                                        }}
                                    />
                                );
                            },
                        },
                        {
                            title: 'Change State to Completed',
                            fieldType: FieldType.Text,
                            getElement: (
                                _item: JSONObject,
                                onBeforeFetchData: JSONObject,
                                fetchItems: Function
                            ): ReactElement => {
                                return (
                                    <ChangeScheduledMaintenanceState
                                        scheduledMaintenanceId={modelId}
                                        scheduledMaintenanceTimeline={
                                            onBeforeFetchData[
                                                'data'
                                            ] as Array<BaseModel>
                                        }
                                        stateType={StateType.Completed}
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

export default ScheduledMaintenanceView;
