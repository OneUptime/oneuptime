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
                    title: 'Calls and SMS',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.SETTINGS_CALL_AND_SMS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            {/* Project Settings View  */}
            <CardModelDetail
                name="Call and SMS Settings"
                cardProps={{
                    title: 'Twilio Config',
                    description: 'This will be used to make Call and send SMS.',
                }}
                isEditable={true}
                editButtonText="Edit Twilio Config"
                formFields={[
                    {
                        field: {
                            twilioAccountSID: true,
                        },
                        title: 'Twilio Account SID',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        description:
                            'You can find this in your Twilio console.',
                        placeholder: '',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            twilioAuthToken: true,
                        },
                        title: 'Twilio Auth Token',
                        fieldType: FormFieldSchemaType.Password,
                        required: true,
                        description:
                            'You can find this in your Twilio console.',
                        placeholder: '',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            twilioPhoneNumber: true,
                        },
                        title: 'Twilio Phone Number',
                        fieldType: FormFieldSchemaType.Phone,
                        required: true,
                        description:
                            'You can find this in your Twilio console.',
                        placeholder: '',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                modelDetailProps={{
                    modelType: GlobalConfig,
                    id: 'model-detail-global-config',
                    fields: [
                        {
                            field: {
                                twilioAccountSID: true,
                            },
                            title: 'Twilio Account SID',
                            placeholder: 'None',
                        },
                        {
                            field: {
                                twilioPhoneNumber: true,
                            },
                            title: 'Twilio Phone Number',
                            fieldType: FieldType.Phone,
                            placeholder: 'None',
                        },
                    ],
                    modelId: ObjectID.getZeroObjectID(),
                }}
            />
        </Page>
    );
};

export default Settings;
