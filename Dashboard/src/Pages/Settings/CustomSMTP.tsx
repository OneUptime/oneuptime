import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { JSONObject } from 'Common/Types/JSON';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import API from 'CommonUI/src/Utils/API/API';
import { NOTIFICATION_URL } from 'CommonUI/src/Config';
import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import EmptyResponseData from 'Common/Types/API/EmptyResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';

const CustomSMTP: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [showSMTPTestModal, setShowSMTPTestModal] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [currentSMTPTestConfig, setCurrentSMTPTestConfig] =
        useState<JSONObject | null>(null);
    const [isSMTPTestLoading, setIsSMTPTestLoading] = useState<boolean>(false);

    const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);

    useEffect(() => {
        setError('');
    }, [showSMTPTestModal]);

    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
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
                    title: 'Custom SMTP',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_CUSTOM_SMTP] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<ProjectSmtpConfig>
                modelType={ProjectSmtpConfig}
                id="smtp-table"
                actionButtons={[
                    {
                        title: 'Send Test Email',
                        buttonStyleType: ButtonStyleType.OUTLINE,
                        icon: IconProp.Play,
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function,
                            onError: (err: Error) => void
                        ) => {
                            try {
                                setCurrentSMTPTestConfig(item);
                                setShowSMTPTestModal(true);

                                onCompleteAction();
                            } catch (err) {
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                ]}
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Email,
                    title: 'Custom SMTP Configs',
                    description:
                        'If you need OneUptime to send emails through your SMTP Server, please enter the server details here.',
                }}
                formSteps={[
                    {
                        title: 'Basic',
                        id: 'basic-info',
                    },
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
                name="Settings > Custom SMTP Config"
                noItemsMessage={'No SMTP Server Configs found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        description:
                            'Friendly name for this config so you remember what this is about.',
                        placeholder: 'Company SMTP Server',
                        stepId: 'basic-info',
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
                        stepId: 'basic-info',
                        description:
                            'Friendly description for this config so you remember what this is about.',
                        placeholder: 'Company SMTP server hosted on AWS',
                    },
                    {
                        field: {
                            hostname: true,
                        },
                        title: 'Hostname',
                        stepId: 'server-info',
                        fieldType: FormFieldSchemaType.Hostname,
                        required: true,
                        placeholder: 'smtp.server.com',
                    },
                    {
                        field: {
                            port: true,
                        },
                        title: 'Port',
                        stepId: 'server-info',
                        fieldType: FormFieldSchemaType.Port,
                        required: true,
                        placeholder: '587',
                    },
                    {
                        field: {
                            secure: true,
                        },
                        title: 'Use SSL / TLS',
                        stepId: 'server-info',
                        fieldType: FormFieldSchemaType.Toggle,
                        description: 'Make email communication secure?',
                    },
                    {
                        field: {
                            username: true,
                        },
                        title: 'Username',
                        stepId: 'authentication',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'emailuser',
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Password',
                        stepId: 'authentication',
                        fieldType: FormFieldSchemaType.EncryptedText,
                        required: true,
                        placeholder: 'Password',
                    },
                    {
                        field: {
                            fromEmail: true,
                        },
                        title: 'Email From',
                        stepId: 'email-info',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        description:
                            'This is the display email your team and customers see, when they recieve emails from OneUptime.',
                        placeholder: 'email@company.com',
                    },
                    {
                        field: {
                            fromName: true,
                        },
                        title: 'From Name',
                        stepId: 'email-info',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        description:
                            'This is the display name your team and customers see, when they recieve emails from OneUptime.',
                        placeholder: 'Company, Inc.',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            hostname: true,
                        },
                        title: 'Server Host',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                ]}
            />

            {showSMTPTestModal && currentSMTPTestConfig ? (
                <BasicFormModal
                    title={`Send Test Email`}
                    description={`Send a test email to verify your SMTP config.`}
                    error={error}
                    formProps={{
                        fields: [
                            {
                                field: {
                                    toEmail: true,
                                },
                                title: 'Email',
                                description:
                                    'Email address to send test email to.',
                                fieldType: FormFieldSchemaType.Email,
                                required: true,
                                placeholder: 'test@company.com',
                            },
                        ],
                    }}
                    submitButtonText={'Send Test Email'}
                    onClose={() => {
                        setShowSMTPTestModal(false);
                        setError('');
                    }}
                    isLoading={isSMTPTestLoading}
                    onSubmit={async (values: JSONObject) => {
                        try {
                            setIsSMTPTestLoading(true);
                            setError('');

                            // test SMTP config
                            const response:
                                | HTTPResponse<EmptyResponseData>
                                | HTTPErrorResponse = await API.post(
                                URL.fromString(
                                    NOTIFICATION_URL.toString()
                                ).addRoute(`/smtp-config/test`),

                                {
                                    toEmail: values['toEmail'],
                                    smtpConfigId: new ObjectID(
                                        currentSMTPTestConfig['_id']
                                            ? currentSMTPTestConfig[
                                                  '_id'
                                              ].toString()
                                            : ''
                                    ).toString(),
                                }
                            );
                            if (response.isSuccess()) {
                                setIsSMTPTestLoading(false);
                                setShowSMTPTestModal(false);
                                setShowSuccessModal(true);
                            }

                            if (response instanceof HTTPErrorResponse) {
                                throw response;
                            }
                        } catch (err) {
                            setError(API.getFriendlyMessage(err));
                            setIsSMTPTestLoading(false);
                        }
                    }}
                />
            ) : (
                <></>
            )}

            {showSuccessModal ? (
                <ConfirmModal
                    title={`Email Sent`}
                    error={error}
                    description={`Email sent successfully. It should take couple of minutes to arrive, please don't forget to check spam.`}
                    submitButtonType={ButtonStyleType.NORMAL}
                    submitButtonText={'Close'}
                    onSubmit={async () => {
                        setShowSuccessModal(false);
                        setError('');
                    }}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default CustomSMTP;
