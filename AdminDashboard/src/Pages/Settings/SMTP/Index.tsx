import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import DashboardSideMenu from '../SideMenu';
import GlobalConfig, { EmailServerType } from 'Model/Models/GlobalConfig';
import ObjectID from 'Common/Types/ObjectID';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import { JSONObject } from 'Common/Types/JSON';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Red } from 'Common/Types/BrandColors';

const Settings: FunctionComponent = (): ReactElement => {
    const [emailServerType, setemailServerType] =
        React.useState<EmailServerType>(EmailServerType.Internal);

    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    const [error, setError] = React.useState<string>('');

    const fetchItem: Function = async (): Promise<void> => {
        setIsLoading(true);

        const globalConfig: GlobalConfig | null =
            await ModelAPI.getItem<GlobalConfig>(
                GlobalConfig,
                ObjectID.getZeroObjectID(),
                {
                    _id: true,
                    emailServerType: true,
                }
            );

        if (globalConfig) {
            setemailServerType(
                globalConfig.emailServerType || EmailServerType.Internal
            );
        }

        setIsLoading(false);
    };

    useEffect(() => {
        fetchItem().catch((err: Error) => {
            setError(err.message);
        });
    }, []);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

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
                    title: 'Email Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_SMTP] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}

            <CardModelDetail
                name="Internal SMTP Settings"
                cardProps={{
                    title: 'Email Server Settings',
                    description:
                        'Pick which email server you would like to use to send emails.',
                }}
                isEditable={true}
                editButtonText="Edit Server"
                onSaveSuccess={() => {
                    window.location.reload();
                }}
                formFields={[
                    {
                        field: {
                            emailServerType: true,
                        },
                        title: 'Email Server Type',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownOptions:
                            DropdownUtil.getDropdownOptionsFromEnum(
                                EmailServerType
                            ),
                        required: true,
                    },
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-global-config',
                    fields: [
                        {
                            field: {
                                emailServerType: true,
                            },
                            title: 'Email Server Type',
                            fieldType: FieldType.Text,
                        },
                    ],
                    modelId: ObjectID.getZeroObjectID(),
                }}
            />

            {emailServerType === EmailServerType.CustomSMTP ? (
                <CardModelDetail
                    name="Host Settings"
                    cardProps={{
                        title: 'Custom Email and SMTP Settings',
                        description:
                            'If you have not enabled Internal SMTP server to send emails. Please configure your SMTP server here.',
                    }}
                    isEditable={true}
                    editButtonText="Edit SMTP Config"
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
                                placeholder: 'None',
                            },
                            {
                                field: {
                                    smtpPort: true,
                                },
                                title: 'SMTP Port',
                                placeholder: 'None',
                            },
                            {
                                field: {
                                    smtpUsername: true,
                                },
                                title: 'SMTP Username',
                                placeholder: 'None',
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
                                placeholder: 'None',
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
            ) : (
                <></>
            )}

            {emailServerType === EmailServerType.Sendgrid ? (
                <CardModelDetail
                    name="Sendgrid Settings"
                    cardProps={{
                        title: 'Sendgrid Settings',
                        description:
                            'Enter your Sendgrid API key to send emails through Sendgrid.',
                    }}
                    isEditable={true}
                    editButtonText="Edit API Key"
                    formFields={[
                        {
                            field: {
                                sendgridApiKey: true,
                            },
                            title: 'Sendgrid API Key',
                            fieldType: FormFieldSchemaType.Text,
                            required: true,
                            placeholder: 'Sendgrid API Key',
                        },
                        {
                            field: {
                                sendgridFromEmail: true,
                            },
                            title: 'From Email',
                            fieldType: FormFieldSchemaType.Email,
                            required: true,
                            placeholder: 'email@yourcompany.com',
                        },
                        {
                            field: {
                                sendgridFromName: true,
                            },
                            title: 'From Name',
                            fieldType: FormFieldSchemaType.Text,
                            required: true,
                            placeholder: 'Acme, Inc.',
                        },
                    ]}
                    modelDetailProps={{
                        modelType: GlobalConfig,
                        id: 'model-detail-global-config',
                        selectMoreFields: {
                            sendgridFromEmail: true,
                            sendgridFromName: true,
                        },
                        fields: [
                            {
                                field: {
                                    sendgridApiKey: true,
                                },
                                title: '',
                                placeholder: 'None',
                                getElement: (item: JSONObject) => {
                                    if (
                                        item['sendgridApiKey'] &&
                                        item['sendgridFromEmail'] &&
                                        item['sendgridFromName']
                                    ) {
                                        return (
                                            <Pill
                                                text="Enabled"
                                                color={Green}
                                            />
                                        );
                                    } else if (!item['sendgridApiKey']) {
                                        return (
                                            <Pill
                                                text="Not Enabled. Please add the API key."
                                                color={Red}
                                            />
                                        );
                                    } else if (!item['sendgridFromEmail']) {
                                        return (
                                            <Pill
                                                text="Not Enabled. Please add the From Email."
                                                color={Red}
                                            />
                                        );
                                    } else if (!item['sendgridFromName']) {
                                        return (
                                            <Pill
                                                text="Not Enabled. Please add the From Name."
                                                color={Red}
                                            />
                                        );
                                    }

                                    return <></>;
                                },
                            },
                        ],
                        modelId: ObjectID.getZeroObjectID(),
                    }}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Settings;
