import React from 'react';

const LoginPage: () => JSX.Element = () => {
    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                    Page not found
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Page you are looking for does not exist.
                </p>
            </div>
        </div>
    );
};

export default LoginPage;
