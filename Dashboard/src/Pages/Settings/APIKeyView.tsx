import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import ApiKeyPermission from 'Model/Models/ApiKeyPermission';
import TableColumnType from 'CommonUI/src/Components/Table/Types/TableColumnType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import ApiKey from 'Model/Models/ApiKey';
import Navigation from 'CommonUI/src/Utils/Navigation';
import PermissionUtil from 'CommonUI/src/Utils/Permission';
import Label from 'Model/Models/Label';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Permission, { PermissionHelper } from 'Common/Types/Permission';
import FieldType from 'CommonUI/src/Components/Detail/FieldType';
import ModelDelete from 'CommonUI/src/Components/ModelDelete/ModelDelete';
import ObjectID from 'Common/Types/ObjectID';
import LabelsElement from '../../Components/Label/Labels';
import BadDataException from 'Common/Types/Exception/BadDataException';

const APIKeyView: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getLastParam()?.toString().substring(1) || ''
    );

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
                    title: 'API Key Details',
                    description: "Here's more details on this API Key.",
                    icon: IconProp.Terminal,
                }}
                isEditable={true}
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
                modelDetailProps={{
                    modelType: ApiKey,
                    id: 'model-detail-api-key',
                    fields: [
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                        },
                        {
                            field: {
                                expiresAt: true,
                            },
                            title: 'Expires',
                            fieldType: FieldType.Date,
                        },
                        {
                            field: {
                                apiKey: true,
                            },
                            title: 'API Key',
                            fieldType: FieldType.HiddenText,
                            opts: {
                                isCopyable: true,
                            },
                        },
                    ],
                    modelId: modelId,
                }}
            />

            {/* API Key Permisison Table */}

            <ModelTable<ApiKeyPermission>
                modelType={ApiKeyPermission}
                id="api-key-permission-table"
                isDeleteable={true}
                query={{
                    apiKeyId: modelId,
                    projectId: props.currentProject?._id
                }}
                onBeforeCreate={(
                    item: ApiKeyPermission
                ): Promise<ApiKeyPermission> => {
                    
                    if (!props.currentProject || !props.currentProject.id) {
                        throw new BadDataException("Project ID cannot be null");
                    }

                    item.apiKeyId = modelId;
                    item.projectId = props.currentProject.id
                    return Promise.resolve(item);
                }}
                isEditable={true}
                isCreateable={true}
                isViewable={false}
                cardProps={{
                    icon: IconProp.Lock,
                    title: 'API Key Permissions',
                    description:
                        'Add different permisisons to API keys to make it more granular.',
                }}
                noItemsMessage={
                    'No permisisons created for this API Key so far.'
                }
                formFields={[
                    {
                        field: {
                            permission: true,
                        },
                        title: 'Permission',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Permission',
                        dropdownOptions:
                            PermissionUtil.projectPermissionsAsDropdownOptions(),
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels (Optional)',
                        description:
                            'Labels on which this permissions will apply on. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
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
                        getColumnElement: (item: JSONObject): ReactElement => {
                            return (
                                <p>
                                    {PermissionHelper.getTitle(
                                        item['permission'] as Permission
                                    )}
                                </p>
                            );
                        },
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels',
                        type: TableColumnType.Text,
                        getColumnElement: (item: JSONObject): ReactElement => {
                            return (<LabelsElement labels={Label.fromJSON(item["labels"] as JSONArray || [], Label) as Array<Label>} />);                          
                        },
                    },
                ]}
            />

            <ModelDelete
                modelType={ApiKey}
                modelId={modelId}
                onDeleteSuccess={() => {
                    Navigation.navigate(
                        RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                    );
                }}
            />
        </Page>
    );
};

export default APIKeyView;
