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
import FieldType from 'CommonUI/src/Components/Types/FieldType';
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

                {
                    title: 'Profile Picture',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_PROFILE_PICTURE] as Route
                    ),
                },
            ]}
            sideMenu={<SideMenu />}
        >



            <CardModelDetail<User>
                name="User Profile > Profile Picture"
                cardProps={{
                    title: 'Profile Picture',
                    description: 'Please update your profile picture here.',
                    icon: IconProp.Image,
                }}
                isEditable={true}
                editButtonText={'Update Profile Picture'}
                formFields={[
                    {
                        field: {
                            profilePictureFile: true,
                        },
                        title: 'Profile Picture',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Upload profile picture',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: User,
                    id: 'model-detail-user-profile-picture',
                    fields: [
                        {
                            field: {
                                profilePictureFile: {
                                    file: true,
                                    type: true,
                                },
                            },
                            fieldType: FieldType.ImageFile,
                            title: 'Profile Picture',
                            placeholder: 'No profile picture uploaded.',
                        },
                    ],
                    modelId: UserUtil.getUserId(),
                }}
            />


        </Page>
    );
};

export default Home;
