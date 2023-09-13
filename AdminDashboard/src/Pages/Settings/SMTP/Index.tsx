import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import DashboardSideMenu from '../SideMenu';
import GlobalConfig from 'Model/Models/GlobalConfig';
import ObjectID from 'Common/Types/ObjectID';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';


const Settings: FunctionComponent = (): ReactElement => {

    const [isInternalSMTPServer, setIsInternalSMTPServer] = React.useState<boolean>(false); 

    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    const [error, setError] = React.useState<string>('');

    const fetchItem = async () => {
        setIsLoading(true);

        const globalConfig: GlobalConfig | null = await ModelAPI.getItem<GlobalConfig>(GlobalConfig, ObjectID.getZeroObjectID(), {
            _id: true,
            useInternalSMTPServer: true 
        });

        if(globalConfig){
            setIsInternalSMTPServer(globalConfig.useInternalSMTPServer || false);
        }

        setIsLoading(false);
    }


    useEffect(()=>{
        fetchItem().catch((err: Error)=>{
            setError(err.message);
        })
    }, []);


    if(isLoading){
        return <PageLoader isVisible={true} />
    }

    if(error){
        return <ErrorMessage error={error} />
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
                    title: 'Internal SMTP Server',
                    description:
                        'If you would like to use Internal SMTP server to send emails, please enable it here. ',
                }}
                isEditable={true}
                editButtonText="Edit Settings"
                onSaveSuccess={()=>{
                    window.location.reload();
                }}
                formFields={[
                    {
                        field: {
                            useInternalSMTPServer: true,
                        },
                        title: 'Use Internal SMTP Server',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    }
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-global-config',
                    fields: [
                        {
                            field: {
                                useInternalSMTPServer: true,
                            },
                            title: 'Use Internal SMTP Server',
                            placeholder: 'No',
                            fieldType: FieldType.Boolean,
                        },
                    ],
                    modelId: ObjectID.getZeroObjectID(),
                }}
            />

            {!isInternalSMTPServer ?  <CardModelDetail
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
            /> : <></>}
        </Page>
    );
};

export default Settings;
