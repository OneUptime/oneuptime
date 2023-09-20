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

const Settings: FunctionComponent = (): ReactElement => {
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
                    title: 'API Key',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_HOST] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}
            <CardModelDetail
                name="API Key Settings"
                cardProps={{
                    title: 'Master API Key Settings',
                    description:
                        'This API key has root access to all the resources in all the projects on OneUptime.',
                }}
                isEditable={true}
                editButtonText="Edit API Key Settings"
                formFields={[
                    {
                        field: {
                            masterApiKey: true,
                        },
                        title: 'Master API Key',
                        fieldType: FormFieldSchemaType.ObjectID,
                        required: false,
                    },
                    {
                        field: {
                            isMasterApiKeyEnabled: true,
                        },
                        title: 'Enabled',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                    },
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-global-config',
                    fields: [
                        {
                            field: {
                                masterApiKey: true,
                            },
                            title: 'Master API Key',
                            description:
                                'This API key has root access to all the resources in all the projects on OneUptime.',
                            fieldType: FieldType.HiddenText,
                            opts: {
                                isCopyable: true,
                            },
                            placeholder: 'API Key not generated yet.',
                        },
                        {
                            field: {
                                isMasterApiKeyEnabled: true,
                            },
                            title: 'Enabled',
                            description:
                                'Enable or disable the master API key. If disabled, all requests using this key will fail.',
                            fieldType: FieldType.Boolean,
                            placeholder: 'Not Enabled',
                        },
                    ],
                    modelId: ObjectID.getZeroObjectID(),
                }}
            />
        </Page>
    );
};

export default Settings;
