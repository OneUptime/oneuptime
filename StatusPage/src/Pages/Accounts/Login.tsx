import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Link from 'CommonUI/src/Components/Link/Link';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import { LOGIN_API_URL } from '../../Utils/ApiPaths';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import LoginUtil from '../../Utils/Login';
import UserUtil from '../../Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { FILE_URL } from 'CommonUI/src/Config';
import ObjectID from 'Common/Types/ObjectID';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';


export interface ComponentProps { 
    statusPageId: ObjectID | null;
    isPreviewPage: boolean;
    statusPageName: string; 
    logoFileId: ObjectID;
}

const LoginPage: FunctionComponent<ComponentProps> = (props: ComponentProps) => {
    const apiUrl: URL = LOGIN_API_URL;

    if (!props.statusPageId) {
        return <></>
    }

    if (UserUtil.isLoggedIn(props.statusPageId)) {
        Navigation.navigate(new Route(props.isPreviewPage ? `/status-page/${props.statusPageId}` : '/'));
    }

    return (
        <div className="auth-page">
            <div className="container-fluid p-0">
                <div className="row g-0">
                    <div className="col-xxl-4 col-lg-4 col-md-3"></div>

                    <div className="col-xxl-4 col-lg-4 col-md-6">
                        <div className="auth-full-page-content d-flex p-sm-5 p-4">
                            <div className="w-100">
                                <div className="d-flex flex-column h-100">
                                    <div className="auth-content my-auto">
                                        {props.logoFileId ? <div
                                            className="mt-4 text-center"
                                            style={{ marginBottom: '40px' }}
                                        >
                                            <img
                                                style={{ height: '40px' }}
                                                src={`${URL.fromString(FILE_URL.toString()).addRoute("/image/" + props.logoFileId.toString())}`}
                                            />
                                        </div> : <></>}
                                        <div className="text-center">
                                            <h5 className="mb-0">
                                                Welcome back!
                                            </h5>
                                            <p className="text-muted mt-2 mb-0">
                                                Please login to view {props.statusPageName || 'Status Page'}
                                            </p>
                                        </div>

                                        <ModelForm<StatusPagePrivateUser>
                                            modelType={StatusPagePrivateUser}
                                            id="login-form"
                                            fields={[
                                                {
                                                    field: {
                                                        email: true,
                                                    },
                                                    title: 'Email',
                                                    fieldType:
                                                        FormFieldSchemaType.Email,
                                                    required: true,
                                                },
                                                {
                                                    field: {
                                                        password: true,
                                                    },
                                                    title: 'Password',
                                                    required: true,
                                                    validation: {
                                                        minLength: 6,
                                                    },
                                                    fieldType:
                                                        FormFieldSchemaType.Password,
                                                    sideLink: {
                                                        text: 'Forgot password?',
                                                        url: new Route(
                                                            props.isPreviewPage ? `/status-page/${props.statusPageId}/forgot-password` : '/forgot-password'
                                                        ),
                                                        openLinkInNewTab: false,
                                                    },
                                                },
                                            ]}
                                            apiUrl={apiUrl}
                                            formType={FormType.Create}
                                            submitButtonText={'Login'}
                                            onSuccess={(value: JSONObject) => {
                                                LoginUtil.login(value);
                                            }}
                                            maxPrimaryButtonWidth={true}
                                            
                                        />

                                        <div className="mt-5 text-center">
                                            <p className="text-muted mb-0">
                                                Don&apos;t have an account?{' '}
                                                <Link
                                                    to={
                                                        new Route(
                                                            '/accounts/register'
                                                        )
                                                    }
                                                    className="underline-on-hover text-primary fw-semibold"
                                                >
                                                    Register.
                                                </Link>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="col-xxl-4 col-lg-4 col-md-3"></div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
