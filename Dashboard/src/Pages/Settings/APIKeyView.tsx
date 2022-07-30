import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import ApiKeyPermission from 'Common/Models/ApiKeyPermission';
import TableColumnType from 'CommonUI/src/Components/Table/Types/TableColumnType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import ApiKey from 'Common/Models/ApiKey';
import Navigation from 'CommonUI/src/Utils/Navigation';
import PermissionUtil from 'CommonUI/src/Utils/Permission';
import Label from 'Common/Models/Label';

const APIKeyView: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Project Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project Name',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Settings',
                    to: RouteMap[PageMap.SETTINGS] as Route,
                },
                {
                    title: 'API Keys',
                    to: RouteMap[PageMap.SETTINGS_APIKEYS] as Route,
                },
                {
                    title: 'View API Key',
                    to: RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >

            {/* API Key View  */}
            <CardModelDetail
                cardProps={{
                    title: "API Key Details",
                    description: "Here's more details on this API Key.",
                    icon: IconProp.Terminal,
                }
                }
                modelDetailProps={
                    {
                        type: ApiKey,
                        model: new ApiKey(),
                        id: "model-detail-api-key",
                        fields: [
                            {
                                field: {
                                    name: true
                                },
                                title: "Name",
                            },
                            {
                                field: {
                                    description: true
                                },
                                title: "Description",
                            },
                        ],
                        modelId: Navigation.getParamByName("id"),
                    }
                }
            />

            {/* API Key Permisison Table */}

            <ModelTable<ApiKeyPermission>
                type={ApiKeyPermission}
                model={new ApiKeyPermission()}
                id="api-key-permission-table"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                isViewable={false}
                cardProps={{
                    icon: IconProp.Lock,
                    title: 'API Key Permissions',
                    description:
                        'Add different permisisons to API keys to make it more granular.',
                }}
                noItemsMessage={'No permisisons created for this API Key so far.'}
                formFields={[
                    {
                        field: {
                            permission: true,
                        },
                        title: 'Permission',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Permission',
                        validation: {
                            noSpaces: true,
                            minLength: 2,
                        },
                        dropdownOptions: PermissionUtil.projectPermissionsAsDropdownOptions()
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels (Optional)',
                        description: 'Labels on which this permissions will apply on. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: "name",
                            valueField: "_id"
                        },
                        required: false,
                        placeholder:
                            'Labels',
                    }
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                currentPageRoute={props.pageRoute}
                columns={[
                    {
                        field: {
                            permission: true,
                        },
                        title: 'Permission',
                        type: TableColumnType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels',
                        type: TableColumnType.Text,
                        isFilterable: true,
                    },
                ]}
            />
        </Page>
    );
};

export default APIKeyView;
