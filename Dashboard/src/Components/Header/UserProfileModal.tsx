import React, { FunctionComponent, ReactElement, useState } from 'react';
import User from 'Model/Models/User';
import UserUtil from 'CommonUI/src/Utils/User';
import FullPageModal from 'CommonUI/src/Components/FullPageModal/FullPageModal';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Card from 'CommonUI/src/Components/Card/Card';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';

export interface ComponentProps {
    onClose: () => void;
}

const UserProfileModal: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [hasPasswordChanged, setHasPasswordChanged] =
        useState<boolean>(false);

    return (
        <>
            <FullPageModal
                onClose={() => {
                    props.onClose && props.onClose();
                }}
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

                <div className="flex width-max">
                    <CardModelDetail<User>
                        name="User Profile > Profile Picture"
                        cardProps={{
                            title: 'Profile Picture',
                            description: 'Please update your profile pic here.',
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
                                placeholder:
                                    'Please upload your profile picture here.',
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
                        className="width-half"
                    />

                    <Card
                        title={'Update Password'}
                        description={
                            'You can set a new password here if you wish to do so.'
                        }
                    >
                        {!hasPasswordChanged ? (
                            <ModelForm<User>
                                modelType={User}
                                name="Change Password Form"
                                onSuccess={() => {
                                    setHasPasswordChanged(true);
                                }}
                                submitButtonStyleType={ButtonStyleType.NORMAL}
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
            </FullPageModal>
        </>
    );
};

export default UserProfileModal;
