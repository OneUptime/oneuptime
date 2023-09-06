import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import DashboardSideMenu from '../SideMenu';
import GlobalConfig from 'Model/Models/GlobalConfig';
import ObjectID from 'Common/Types/ObjectID';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

const Settings: FunctionComponent = (
    
): ReactElement => {
    return (
        <Page
            title={'Admin Settings'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS] as Route
                    ),
                },
                {
                    title: 'Host',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_HOST] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}
            <CardModelDetail
                name="Host Settings"
                cardProps={{
                    title: 'Email and SMTP Settings',
                    description: 'Email and SMTP Settings. We will use this SMTP server to send all the emails.',
                }}
                isEditable={true}
                editButtonText='Edit SMTP Config'
                formSteps={[
                    {
                        title: 'SMTP Server',
                        id: 'server-info',
                    },
                    {
                        title: 'Authentication',
                        id: 'authentication',
                    },
                    {
                        title: 'Email',
                        id: 'email-info',
                    },
                ]}
                formFields={[
                    {
                        field: {
                            smtpHost: true,
                        },
                        title: 'Hostname',
                        stepId: 'server-info',
                        fieldType: FormFieldSchemaType.Hostname,
                        required: true,
                        placeholder: 'smtp.server.com',
                    },
                    {
                        field: {
                            smtpPort: true,
                        },
                        title: 'Port',
                        stepId: 'server-info',
                        fieldType: FormFieldSchemaType.Port,
                        required: true,
                        placeholder: '587',
                    },
                    {
                        field: {
                            isSMTPSecure: true,
                        },
                        title: 'Use SSL / TLS',
                        stepId: 'server-info',
                        fieldType: FormFieldSchemaType.Toggle,
                        description: 'Make email communication secure?',
                    },
                    {
                        field: {
                            smtpUsername: true,
                        },
                        title: 'Username',
                        stepId: 'authentication',
                        fieldType: FormFieldSchemaType.Text,
                        required: false,
                        placeholder: 'emailuser',
                    },
                    {
                        field: {
                            smtpPassword: true,
                        },
                        title: 'Password',
                        stepId: 'authentication',
                        fieldType: FormFieldSchemaType.EncryptedText,
                        required: false,
                        placeholder: 'Password',
                    },
                    {
                        field: {
                            smtpFromEmail: true,
                        },
                        title: 'Email From',
                        stepId: 'email-info',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        description:
                            'This is the display email your team and customers see, when they receive emails from OneUptime.',
                        placeholder: 'email@company.com',
                    },
                    {
                        field: {
                            smtpFromName: true,
                        },
                        title: 'From Name',
                        stepId: 'email-info',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        description:
                            'This is the display name your team and customers see, when they receive emails from OneUptime.',
                        placeholder: 'Company, Inc.',
                    },
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-global-config',
                    fields: [
                        {
                            field: {
                                smtpHost: true,
                            },
                            title: 'SMTP Host',
                            placeholder: 'None'
                        },
                        {
                            field: {
                                smtpPort: true,
                            },
                            title: 'SMTP Port',
                            placeholder: 'None'
                        },
                        {
                            field: {
                                smtpUsername: true,
                            },
                            title: 'SMTP Username',
                            placeholder: 'None'
                        },
                        {
                            field: {
                                smtpFromEmail: true,
                            },
                            title: 'SMTP Email',
                            placeholder: 'None',
                            fieldType: FieldType.Email,
                        },
                        {
                            field: {
                                smtpFromName: true,
                            },
                            title: 'SMTP From Name',
                            placeholder: 'None'
                        },

                        {
                            field: {
                                isSMTPSecure: true,
                            },
                            title: 'Use SSL/TLS',
                            placeholder: 'No',
                            fieldType: FieldType.Boolean,
                        },

                    ],
                    modelId: ObjectID.getZeroObjectID(),
                }}
            />
        </Page>
    );
};

export default Settings;
