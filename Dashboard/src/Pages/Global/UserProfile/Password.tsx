import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageComponentProps from '../../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';
import User from 'Model/Models/User';
import UserUtil from 'CommonUI/src/Utils/User';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import SideMenu from './SideMenu';
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
                    title: 'Password Management',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_PROFILE_PASSWORD] as Route
                    ),
                },
            ]}
            sideMenu={<SideMenu />}
        >
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
        </Page>
    );
};

export default Home;
