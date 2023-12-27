import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ProjectSMTPConfig from '../../../Components/ProjectSMTPConfig/ProjectSMTPConfig';
import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';
import PlaceholderText from 'CommonUI/src/Components/Detail/PlaceholderText';
import { JSONObject } from 'Common/Types/JSON';
import ProjectCallSMSConfig from 'Model/Models/ProjectCallSMSConfig';
import ProjectCallSMSConfigElement from '../../../Components/ProjectCallSMSConfig/ProjectCallSMSConfig';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <ModelPage
            title="Status Page"
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
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Subscriber Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Subscriber"
                cardProps={{
                    title: 'Subscriber Settings',
                    description: 'Subscriber settings for this status page.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            enableEmailSubscribers: true,
                        },
                        title: 'Enable Email Subscribers',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                        placeholder:
                            'Can email subscribers subscribe to this status page?',
                    },
                    {
                        field: {
                            enableSmsSubscribers: true,
                        },
                        title: 'Enable SMS Subscribers',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                        placeholder:
                            'Can SMS subscribers subscribe to this status page?',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                enableEmailSubscribers: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Enable Email Subscribers',
                        },
                        {
                            field: {
                                enableSmsSubscribers: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Enable SMS Subscribers',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Subscriber > Advanced"
                cardProps={{
                    title: 'Advanced Subscriber Settings',
                    description:
                        'Advanced subscriber settings for this status page.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            allowSubscribersToChooseResources: true,
                        },
                        title: 'Allow Subscribers to Choose Resources',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                        placeholder:
                            'Can subscribers choose which resources they want to subscribe to?',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                allowSubscribersToChooseResources: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Allow Subscribers to Choose Resources',
                            description:
                                'Can subscribers choose which resources they want to subscribe to?',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Status Page > Email > Subscriber"
                cardProps={{
                    title: 'Custom SMTP',
                    description:
                        'Custom SMTP settings for this status page. This will be used to send emails to subscribers.',
                }}
                editButtonText={'Edit SMTP'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            smtpConfig: true,
                        },
                        title: 'Custom SMTP Config',
                        description:
                            'Select SMTP Config to use for this status page to send email to subscribers. You can add SMTP Config in Project Settings >  Notification Settings > Custom SMTP.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: ProjectSmtpConfig,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'SMTP Config',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                smtpConfig: {
                                    name: true,
                                },
                            },
                            title: 'Custom SMTP Config',
                            fieldType: FieldType.Element,
                            getElement: (item: JSONObject): ReactElement => {
                                if (item['smtpConfig']) {
                                    return (
                                        <ProjectSMTPConfig
                                            smtpConfig={
                                                item[
                                                    'smtpConfig'
                                                ] as ProjectSmtpConfig
                                            }
                                        />
                                    );
                                }
                                return (
                                    <PlaceholderText
                                        text="No Custom SMTP Config selected so far
                                    for this status page."
                                    />
                                );
                            },
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Status Page > Call and SMS > Subscriber"
                cardProps={{
                    title: 'Twilio Config',
                    description:
                        'Twilio Config settings for this status page. This will be used to send SMS to subscribers.',
                }}
                editButtonText={'Edit Twilio Config'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            callSmsConfig: true,
                        },
                        title: 'Twilio Config',
                        description:
                            'Select Twilio Config to use for this status page to send SMS to subscribers. You can add Twilio Config in Project Settings > Notification Settings > Twilio Config.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: ProjectCallSMSConfig,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Twilio Config',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-call-config',
                    fields: [
                        {
                            field: {
                                callSmsConfig: {
                                    name: true,
                                },
                            },
                            title: 'Twilio Config',
                            fieldType: FieldType.Element,
                            getElement: (item: JSONObject): ReactElement => {
                                if (item['callSmsConfig']) {
                                    return (
                                        <ProjectCallSMSConfigElement
                                            callSmsConfig={
                                                item[
                                                    'callSmsConfig'
                                                ] as ProjectCallSMSConfig
                                            }
                                        />
                                    );
                                }
                                return (
                                    <PlaceholderText text="No Twilio Config selected so far." />
                                );
                            },
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </ModelPage>
    );
};

export default StatusPageDelete;
