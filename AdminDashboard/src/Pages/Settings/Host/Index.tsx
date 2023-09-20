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
                    title: 'Host',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_HOST] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}
            <CardModelDetail
                name="Host Settings"
                cardProps={{
                    title: 'Host Settings',
                    description:
                        'Host Settings for this OneUptime Server instance.',
                }}
                isEditable={true}
                editButtonText="Edit Host"
                formFields={[
                    {
                        field: {
                            useHttps: true,
                        },
                        title: 'Use HTTPs',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                        description:
                            'Is this server hosted with a  TLS / SSL cert?',
                    },
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-global-config',
                    fields: [
                        {
                            field: {
                                useHttps: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Use HTTPS',
                            placeholder: 'No',
                            description:
                                'Is this server hosted with a valid TLS / SSL cert?',
                        },
                    ],
                    modelId: ObjectID.getZeroObjectID(),
                }}
            />
        </Page>
    );
};

export default Settings;
