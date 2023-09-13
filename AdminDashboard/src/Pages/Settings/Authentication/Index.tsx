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
                    title: 'Authentication',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}
            <CardModelDetail
                name="Authentication Settings"
                cardProps={{
                    title: 'Authentication Settings',
                    description:
                        'Authentication Settings for this OneUptime Server instance.',
                }}
                isEditable={true}
                editButtonText="Edit Settings"
                formFields={[
                    {
                        field: {
                            disableSignup: true,
                        },
                        title: 'Disable Sign Up',
                        fieldType: FormFieldSchemaType.Toggle,
                        required: false,
                        description:
                            'Should we disable sign up of new users to OneUptime?',
                    },
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-global-config',
                    fields: [
                        {
                            field: {
                                disableSignup: true,
                            },
                            fieldType: FieldType.Boolean,
                            title: 'Disable Sign Up',
                            placeholder: 'No',
                            description:
                                'Should we disable sign up of new users to OneUptime?',
                        },
                    ],
                    modelId: ObjectID.getZeroObjectID(),
                }}
            />
        </Page>
    );
};

export default Settings;
