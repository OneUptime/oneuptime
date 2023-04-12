import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import DashboardNavigation from '../../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import StatusPageSSO from 'Model/Models/StatusPageSso';
import SignatureMethod from 'Common/Types/SSO/SignatureMethod';
import DigestMethod from 'Common/Types/SSO/DigestMethod';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import { JSONObject } from 'Common/Types/JSON';
import Card from 'CommonUI/src/Components/Card/Card';
import Link from 'CommonUI/src/Components/Link/Link';
import URL from 'Common/Types/API/URL';
import { IDENTITY_URL, STATUS_PAGE_URL } from 'CommonUI/src/Config';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Banner from 'CommonUI/src/Components/Banner/Banner';

const SSOPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [showSingleSignOnUrlId, setShowSingleSignOnUrlId] =
        useState<string>('');
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
                        modelId
                    ),
                },
                {
                    title: 'Status Pages',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGES] as Route,
                        modelId
                    ),
                },
                {
                    title: 'View Status Page',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
                        modelId
                    ),
                },
                {
                    title: 'SSO',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route,
                        modelId
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <>
                <Banner
                    openInNewTab={true}
                    title="Need help with configuring SSO?"
                    description="Watch this 10 minute video which will help you get set up"
                    link={URL.fromString('https://youtu.be/F_h74p38SU0')}
                />

                <ModelTable<StatusPageSSO>
                    modelType={StatusPageSSO}
                    query={{
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    onBeforeCreate={(
                        item: StatusPageSSO
                    ): Promise<StatusPageSSO> => {
                        if (
                            !props.currentProject ||
                            !props.currentProject._id
                        ) {
                            throw new BadDataException(
                                'Project ID cannot be null'
                            );
                        }

                        item.statusPageId = modelId;
                        item.projectId = new ObjectID(props.currentProject._id);

                        return Promise.resolve(item);
                    }}
                    id="sso-table"
                    name="Status Pages > Staus Page View > Project SSO"
                    isDeleteable={true}
                    isEditable={true}
                    isCreateable={true}
                    cardProps={{
                        icon: IconProp.Lock,
                        title: 'Single Sign On (SSO)',
                        description:
                            'Single sign-on is an authentication scheme that allows a user to log in with a single ID to any of several related, yet independent, software systems.',
                    }}
                    noItemsMessage={'No SSO configuration found.'}
                    viewPageRoute={Navigation.getCurrentRoute()}
                    formFields={[
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                            fieldType: FormFieldSchemaType.Text,
                            required: true,
                            description: 'Friendly name to help you remember.',
                            placeholder: 'Okta',
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
                            description:
                                'Friendly description to help you remember.',
                            placeholder: 'Sign in with Okta',
                            validation: {
                                minLength: 2,
                            },
                        },
                        {
                            field: {
                                signOnURL: true,
                            },
                            title: 'Sign On URL',
                            fieldType: FormFieldSchemaType.URL,
                            required: true,
                            description:
                                'Members will be forwarded here when signing in to your organization',
                            placeholder:
                                'https://yourapp.example.com/apps/appId',
                        },
                        {
                            field: {
                                issuerURL: true,
                            },
                            title: 'Issuer',
                            description:
                                'Typically a unique URL generated by your SAML identity provider',
                            fieldType: FormFieldSchemaType.URL,
                            required: true,
                            placeholder: 'https://example.com',
                        },
                        {
                            field: {
                                publicCertificate: true,
                            },
                            title: 'Public Certificate',
                            description: 'Paste in your x509 certificate here.',
                            fieldType: FormFieldSchemaType.LongText,
                            required: true,
                            placeholder: 'Paste in your x509 certificate here.',
                        },
                        {
                            field: {
                                signatureMethod: true,
                            },
                            title: 'Signature Method',
                            description:
                                'If you do not know what this is, please leave this to RSA-SHA256',
                            fieldType: FormFieldSchemaType.Dropdown,
                            dropdownOptions:
                                DropdownUtil.getDropdownOptionsFromEnum(
                                    SignatureMethod
                                ),
                            required: true,
                            placeholder: 'RSA-SHA256',
                        },
                        {
                            field: {
                                digestMethod: true,
                            },
                            title: 'Digest Method',
                            description:
                                'If you do not know what this is, please leave this to SHA256',
                            fieldType: FormFieldSchemaType.Dropdown,
                            dropdownOptions:
                                DropdownUtil.getDropdownOptionsFromEnum(
                                    DigestMethod
                                ),
                            required: true,
                            placeholder: 'SHA256',
                        },
                        {
                            field: {
                                isEnabled: true,
                            },
                            description:
                                'You can test this first, before enabling it. To test, please save the config.',
                            title: 'Enabled',
                            fieldType: FormFieldSchemaType.Toggle,
                        },
                    ]}
                    showRefreshButton={true}
                    showFilterButton={true}
                    actionButtons={[
                        {
                            title: 'View SSO URL',
                            buttonStyleType: ButtonStyleType.NORMAL,
                            onClick: async (
                                item: JSONObject,
                                onCompleteAction: Function
                            ) => {
                                setShowSingleSignOnUrlId(
                                    (item['_id'] as string) || ''
                                );
                                onCompleteAction();
                            },
                        },
                    ]}
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
                                isEnabled: true,
                            },
                            title: 'Enabled',
                            type: FieldType.Boolean,
                            isFilterable: true,
                        },
                    ]}
                />

                <Card
                    title={`Test Single Sign On (SSO)`}
                    description={
                        <span>
                            Here&apos;s a link which will help you test SSO
                            integration before you force it on your
                            organization:{' '}
                            <Link
                                openInNewTab={true}
                                to={URL.fromString(
                                    `${STATUS_PAGE_URL.toString()}/${modelId}/sso`
                                )}
                            >
                                <span>{`${STATUS_PAGE_URL.toString()}/${modelId}/sso`}</span>
                            </Link>
                        </span>
                    }
                />

                {/* API Key View  */}
                <CardModelDetail
                    name="SSO Settings"
                    editButtonText={'Edit Settings'}
                    cardProps={{
                        title: 'SSO Settings',
                        description: 'Configure settings for SSO.',
                        icon: IconProp.Lock,
                    }}
                    isEditable={true}
                    formFields={[
                        {
                            field: {
                                requireSsoForLogin: true,
                            },
                            title: 'Force SSO for Login',
                            description:
                                'Please test SSO before you you enable this feature. If SSO is not tested properly then you will be locked out of the project.',
                            fieldType: FormFieldSchemaType.Toggle,
                        },
                    ]}
                    modelDetailProps={{
                        modelType: StatusPage,
                        id: 'sso-settings',
                        fields: [
                            {
                                field: {
                                    requireSsoForLogin: true,
                                },
                                fieldType: FieldType.Boolean,
                                title: 'Force SSO for Login',
                                description:
                                    'Please test SSO before you enable this feature. If SSO is not tested properly then you will be locked out of the status page.',
                            },
                        ],
                        modelId: modelId,
                    }}
                />

                {showSingleSignOnUrlId && (
                    <ConfirmModal
                        title={`Single Sign on URL`}
                        description={
                            <div>
                                <span>
                                    You can configure this URL with your
                                    Identity Provider:
                                </span>
                                <br />
                                <br />
                                <span>
                                    {`${URL.fromString(
                                        IDENTITY_URL.toString()
                                    ).addRoute(
                                        `/status-page-idp-login/${modelId.toString()}/${showSingleSignOnUrlId}`
                                    )}`}
                                </span>
                                <br />
                            </div>
                        }
                        submitButtonText={'Close'}
                        onSubmit={() => {
                            setShowSingleSignOnUrlId('');
                        }}
                        submitButtonType={ButtonStyleType.NORMAL}
                    />
                )}
            </>
        </ModelPage>
    );
};

export default SSOPage;
