import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ProjectSSO from 'Model/Models/ProjectSso';
import SignatureMethod from 'Common/Types/SSO/SignatureMethod';
import DigestMethod from 'Common/Types/SSO/DigestMethod';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import Project from 'Model/Models/Project';
import Team from 'Model/Models/Team';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import TeamsElement from '../../Components/Team/TeamsElement';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Card from 'CommonUI/src/Components/Card/Card';
import Link from 'CommonUI/src/Components/Link/Link';
import URL from 'Common/Types/API/URL';
import { DASHBOARD_URL, IDENTITY_URL } from 'CommonUI/src/Config';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import Banner from 'CommonUI/src/Components/Banner/Banner';

const SSOPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [showSingleSignOnUrlId, setShowSingleSignOnUrlId] =
        useState<string>('');
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
                    title: 'SSO',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_SSO] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <>
                <Banner
                    openInNewTab={true}
                    title="Need help with configuring SSO?"
                    description="Watch this 10 minute video which will help you get set up"
                    link={URL.fromString('https://youtu.be/tq4WRgxbIwk')}
                />

                <ModelTable<ProjectSSO>
                    modelType={ProjectSSO}
                    query={{
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    id="sso-table"
                    name="Settings > Project SSO"
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
                        {
                            field: {
                                teams: true,
                            },
                            title: 'Teams',
                            description:
                                'Add users to these teams when they sign up',
                            fieldType: FormFieldSchemaType.MultiSelectDropdown,
                            dropdownModal: {
                                type: Team,
                                labelField: 'name',
                                valueField: '_id',
                            },
                            required: true,
                            placeholder: 'Select Teams',
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
                                teams: {
                                    name: true,
                                    _id: true,
                                    projectId: true,
                                },
                            },
                            title: 'Add User to Team',
                            type: FieldType.Text,
                            getElement: (item: JSONObject): ReactElement => {
                                return (
                                    <TeamsElement
                                        teams={
                                            JSONFunctions.fromJSON(
                                                (item['teams'] as JSONArray) ||
                                                    [],
                                                Team
                                            ) as Array<Team>
                                        }
                                    />
                                );
                            },
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
                                    `${DASHBOARD_URL.toString()}/${DashboardNavigation.getProjectId()?.toString()}/sso`
                                )}
                            >
                                <span>{`${DASHBOARD_URL.toString()}/${DashboardNavigation.getProjectId()?.toString()}/sso`}</span>
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
                        modelType: Project,
                        id: 'sso-settings',
                        fields: [
                            {
                                field: {
                                    requireSsoForLogin: true,
                                },
                                fieldType: FieldType.Boolean,
                                title: 'Force SSO for Login',
                                description:
                                    'Please test SSO before you enable this feature. If SSO is not tested properly then you will be locked out of the project.',
                            },
                        ],
                        modelId: DashboardNavigation.getProjectId()?.toString(),
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
                                        `/idp-login/${props.currentProject?._id}/${showSingleSignOnUrlId}`
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
        </Page>
    );
};

export default SSOPage;
