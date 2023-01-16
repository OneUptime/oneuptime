import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import User from 'Model/Models/User';
import UserUtil from 'CommonUI/src/Utils/User';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Card from 'CommonUI/src/Components/Card/Card';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';


const Home: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [hasPasswordChanged, setHasPasswordChanged] =
        useState<boolean>(false);

    return (
        <Page
            title={'User Profile'}
            breadcrumbLinks={[
                {
                    title: 'Home',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
                },
                {
                    title: 'User Profile',
                    to: RouteUtil.populateRouteParams(RouteMap[PageMap.USER_PROFILE] as Route),
                },
            ]}
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

            <div className="w-full flex space-x-5 mt-5">

                <CardModelDetail<User>
                    name="User Profile > Profile Picture"
                    cardProps={{
                        title: 'Profile Picture',
                        description: 'Please update your profile pic here.',
                        icon: IconProp.Image,
                        className: "w-1/2"
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
                            placeholder:
                                'Upload profile picture',
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

                <Card
                    title={'Update Password'}
                    description={
                        'You can set a new password here if you wish to do so.'
                    }
                    className="w-1/2"
                >
                    {!hasPasswordChanged ? (
                        <ModelForm<User>
                            modelType={User}
                            name="Change Password Form"
                            onSuccess={() => {
                                setHasPasswordChanged(true);
                            }}
                            submitButtonStyleType={ButtonStyleType.PRIMARY}
                            id="change-password-form"
                            showAsColumns={1}
                            doNotFetchExistingModel={true}
                            modelIdToEdit={UserUtil.getUserId()}
                            maxPrimaryButtonWidth={true}
                            initialValues={{
                                password: '',
                                confirmPassword: '',
                            }}
                            fields={[
                                {
                                    field: {
                                        password: true,
                                    },
                                    fieldType: FormFieldSchemaType.Password,
                                    validation: {
                                        minLength: 6,
                                    },
                                    placeholder: 'Password',
                                    title: 'Password',
                                    required: true,
                                },
                                {
                                    field: {
                                        password: true,
                                    },
                                    validation: {
                                        minLength: 6,
                                        toMatchField: 'password',
                                    },
                                    fieldType: FormFieldSchemaType.Password,
                                    placeholder: 'Confirm Password',
                                    title: 'Confirm Password',
                                    overideFieldKey: 'confirmPassword',
                                    required: true,
                                },
                            ]}
                            formType={FormType.Update}
                            submitButtonText={'Update Password'}
                        />

                    ) : (
                        <p>Your password has been updated.</p>
                    )}
                </Card>
            </div>
        </Page>
    );
};

export default Home;
