import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
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
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import Label from 'Model/Models/Label';
import LabelsElement from '../../../Components/Label/Labels';
import JSONFunctions from 'Common/Types/JSONFunctions';
import GlobalEvent from 'CommonUI/src/Utils/GlobalEvents';
import EventName from '../../../Utils/EventName';
import OnCallDutyPoliciesView from '../../../Components/OnCallPolicy/OnCallPolicies';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';

const IncidentView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return (
        <ModelPage
            title="Incident"
            modelType={Incident}
            modelId={modelId}
            modelNameField="title"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Incident',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            {/* Incident View  */}
            <CardModelDetail
                name="Incident Details"
                cardProps={{
                    title: 'Incident Details',
                    description: "Here are more details for this incident.",
                    icon: IconProp.AltGlobe,
                }}
                isEditable={true}
                formSteps={[
                    {
                        title: 'Incident Details',
                        id: 'incident-details',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Incident Title',
                        stepId: 'incident-details',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Incident Title',
                        validation: {
                            minLength: 2,
                        },
                    },

                    {
                        field: {
                            incidentSeverity: true,
                        },
                        title: 'Incident Severity',
                        description: 'What type of incident is this?',
                        fieldType: FormFieldSchemaType.Dropdown,
                        stepId: 'incident-details',
                        dropdownModal: {
                            type: IncidentSeverity,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Incident Severity',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels ',
                        stepId: 'labels',
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
                                    createdByUser: {
                                        name: true,
                                        email: true,
                                        profilePictureId: true,
                                    },
                                    incidentState: {
                                        name: true,
                                        isResolvedState: true,
                                        isAcknowledgedState: true,
                                    },
                                },
                                {}
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
                                currentIncidentState: {
                                    color: true,
                                    name: true,
                                },
                            },
                            title: 'Current State',
                            fieldType: FieldType.Entity,
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
                                incidentSeverity: {
                                    color: true,
                                    name: true,
                                },
                            },
                            title: 'Incident Severity',
                            fieldType: FieldType.Entity,
                            getElement: (item: JSONObject): ReactElement => {
                                if (!item['incidentSeverity']) {
                                    throw new BadDataException(
                                        'Incident Severity not found'
                                    );
                                }

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
                            fieldType: FieldType.Element,
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
                                onCallDutyPolicies: {
                                    name: true,
                                    _id: true,
                                },
                            },
                            title: 'On-Call Duty Policies',
                            fieldType: FieldType.Element,
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <OnCallDutyPoliciesView
                                        onCallPolicies={
                                            JSONFunctions.fromJSON(
                                                (item[
                                                    'onCallDutyPolicies'
                                                ] as JSONArray) || [],
                                                OnCallDutyPolicy
                                            ) as Array<OnCallDutyPolicy>
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
                            title: 'Acknowledge Incident',
                            fieldType: FieldType.Element,
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
                            fieldType: FieldType.Element,
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
                                            GlobalEvent.dispatchEvent(
                                                EventName.ACTIVE_INCIDENTS_COUNT_REFRESH
                                            );
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

            <CardModelDetail
                name="Incident Description"
                cardProps={{
                    title: 'Incident Description',
                    description:
                        'Description of this incident. This is visible on Status Page and is in markdown format.',
                    icon: IconProp.AltGlobe,
                }}
                editButtonText="Edit Incident Description"
                isEditable={true}
                formFields={[
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',

                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        placeholder: 'Description',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: Incident,
                    id: 'model-detail-incident-description',
                    fields: [
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                            fieldType: FieldType.Markdown,
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail
                name="Root Cause"
                cardProps={{
                    title: 'Root Cause',
                    description:
                        'Why did this incident happen? Here is the root cause of this incident.',
                    icon: IconProp.TransparentCube,
                }}
                isEditable={false}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: Incident,
                    id: 'model-detail-incident-root-cause',
                    fields: [
                        {
                            field: {
                                rootCause: true,
                            },
                            title: 'Root Cause',
                            placeholder:
                                'No root cause identified for this incident.',
                            fieldType: FieldType.LongText,
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </ModelPage>
    );
};

export default IncidentView;
