import React, { FunctionComponent } from 'react';
import Route from 'Common/Types/API/Route';
import OneUptimeLogo from 'CommonUI/src/Images/logos/OneUptimePNG/7.png';
import Link from 'CommonUI/src/Components/Link/Link';

const VerifyEmail: FunctionComponent = () => {
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
                                        <div
                                            className="mt-4 text-center"
                                            style={{ marginBottom: '40px' }}
                                        >
                                            <img
                                                style={{ height: '40px' }}
                                                src={`/accounts/public/${OneUptimeLogo}`}
                                            />
                                        </div>
                                        <div className="text-center">
                                            <h5 className="mb-0">
                                                Your email is verified.
                                            </h5>
                                            <p className="text-muted mt-2 mb-0">
                                                Thank you for veryfing your
                                                email. You can now log in to
                                                OneUptime.{' '}
                                            </p>
                                        </div>

                                        <div className="mt-5 text-center">
                                            <p className="text-muted mb-0">
                                                Return to sign in?{' '}
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

export default VerifyEmail;
