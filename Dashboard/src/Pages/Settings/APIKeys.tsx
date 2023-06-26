import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import ApiKey from 'Model/Models/ApiKey';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
const APIKeys: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
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
                    title: 'API Keys',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ModelTable<ApiKey>
                modelType={ApiKey}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                id="api-keys-table"
                name="Settings > API Keys"
                isDeleteable={false}
                isEditable={false}
                showViewIdButton={false}
                isCreateable={true}
                isViewable={true}
                cardProps={{
                    icon: IconProp.Terminal,
                    title: 'API Keys',
                    description:
                        'All you can do on the dashboard can be done via the API. Use OneUptime API to automated repetitive work or integrate with other platforms you have.',
                }}
                noItemsMessage={'No API Keys found.'}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'API Key Name',
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
                        placeholder: 'API Key Description',
                    },
                    {
                        field: {
                            expiresAt: true,
                        },
                        title: 'Expires',
                        fieldType: FormFieldSchemaType.Date,
                        required: true,
                        placeholder: 'Expires at',
                        validation: {
                            dateShouldBeInTheFuture: true,
                        },
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
                            expiresAt: true,
                        },
                        title: 'Expires',
                        type: FieldType.Date,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default APIKeys;
