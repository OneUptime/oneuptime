import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';
import User from 'Model/Models/User';
import UserUtil from 'CommonUI/src/Utils/User';
import IconProp from 'Common/Types/Icon/IconProp';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import SideMenu from './SideMenu';

const Home: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'User Profile'}
            breadcrumbLinks={[
                {
                    title: 'Home',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'User Profile',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route
                    ),
                },
            ]}
            sideMenu={<SideMenu />}
        >
            <CardModelDetail
                cardProps={{
                    title: 'Basic Info',
                    description: "Here's are some of your details.",
                    icon: IconProp.User,
                }}
                name="User Profile > Basic Info"
                isEditable={true}
                formFields={[
                    {
                        field: {
                            email: true,
                        },
                        fieldType: FormFieldSchemaType.Email,
                        placeholder: 'jeff@example.com',
                        required: true,
                        title: 'Email',
                        description:
                            'You will have to verify your email again if you change it',
                    },
                    {
                        field: {
                            name: true,
                        },
                        fieldType: FormFieldSchemaType.Text,
                        placeholder: 'Jeff Smith',
                        required: true,
                        title: 'Full Name',
                    },
                    {
                        field: {
                            companyName: true,
                        },
                        fieldType: FormFieldSchemaType.Text,
                        placeholder: 'Acme, Inc.',
                        required: true,
                        title: 'Company Name',
                    },
                    {
                        field: {
                            companyPhoneNumber: true,
                        },
                        fieldType: FormFieldSchemaType.Phone,
                        required: true,
                        placeholder: '+1-123-456-7890',
                        title: 'Phone Number',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 2,
                    modelType: User,
                    id: 'user-profile',
                    fields: [
                        {
                            field: {
                                name: true,
                            },
                            title: 'Name',
                        },
                        {
                            field: {
                                email: true,
                            },
                            title: 'Email',
                        },
                        {
                            field: {
                                companyName: true,
                            },
                            title: 'Company Name',
                        },
                        {
                            field: {
                                companyPhoneNumber: true,
                            },
                            title: 'Company Phone Number',
                        },
                    ],
                    modelId: UserUtil.getUserId(),
                }}
            />
        </Page>
    );
};

export default Home;
