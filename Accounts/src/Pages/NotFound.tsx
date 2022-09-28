import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';
import Link from 'CommonUI/src/Components/Link/Link';

const LoginPage: FunctionComponent = () => {
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
                                        <div className="text-center">
                                            <h5 className="mb-0">
                                                Page Not Found
                                            </h5>
                                            <p className="text-muted mt-2 mb-0">
                                                Page you&apos;re looking for is
                                                not found.{' '} <br/> <br/> <br/>
                                            </p>
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
                                            <p className="text-muted mb-0">
                                                Have an account?{' '}
                                                <Link
                                                    to={
                                                        new Route(
                                                            '/accounts/login'
                                                        )
                                                    }
                                                    className="underline-on-hover text-primary fw-semibold"
                                                >
                                                    Login.
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
