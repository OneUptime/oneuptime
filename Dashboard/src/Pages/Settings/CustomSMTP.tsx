import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';
import TableColumnType from 'CommonUI/src/Components/Table/Types/TableColumnType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';

const CustomSMTP: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.SETTINGS] as Route,
                },
                {
                    title: 'Custom SMTP',
                    to: RouteMap[PageMap.SETTINGS_CUSTOM_SMTP] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<ProjectSmtpConfig>
                type={ProjectSmtpConfig}
                model={new ProjectSmtpConfig()}
                id="smtp-table"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Email,
                    title: 'Custom SMTP Configs',
                    description:
                        'If you need OneUptime to send emails through your SMTP Server, please enter the server details here.',
                }}
                noItemsMessage={
                    'No SMTP Server Configs created for this project so far.'
                }
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
                        validation: {
                            noSpaces: true,
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
                            'Friendly description for this config so you remember what this is about.',
                        placeholder: 'Company SMTP server hosted on AWS',
                    },
                    {
                        field: {
                            hostname: true,
                        },
                        title: 'Hostname',
                        fieldType: FormFieldSchemaType.Hostname,
                        required: true,
                        placeholder: 'smtp.server.com',
                    },
                    {
                        field: {
                            port: true,
                        },
                        title: 'Port',
                        fieldType: FormFieldSchemaType.Port,
                        required: true,
                        placeholder: '587',
                    },
                    {
                        field: {
                            secure: true,
                        },
                        title: 'Use SSL / TLS',
                        fieldType: FormFieldSchemaType.Checkbox,
                        description: 'Make email communication secure?',
                    },
                    {
                        field: {
                            username: true,
                        },
                        title: 'Username',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'emailuser',
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Password',
                        fieldType: FormFieldSchemaType.Password,
                        required: true,
                        placeholder: 'Password',
                    },
                    {
                        field: {
                            fromEmail: true,
                        },
                        title: 'Email From',
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
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        description:
                            'This is the display name your team and customers see, when they recieve emails from OneUptime.',
                        placeholder: 'Company, Inc.',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                currentPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: TableColumnType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        type: TableColumnType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            hostname: true,
                        },
                        title: 'Server Host',
                        type: TableColumnType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default CustomSMTP;
