// Tailwind.

import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import Email from 'Common/Types/Email';
import React, { FunctionComponent, ReactElement } from 'react';
import Navigation from '../Utils/Navigation';
import Button, { ButtonStyleType } from './Button/Button';

export interface ComponentProps {
    homeRoute: Route,
    supportEmail: Email
}

const NotFound: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
    return (
        <div className="mx-auto max-w-7xl sm:px-6 lg:px-8 rounded-lg drop-shadow-md">
            <div className="min-h-full bg-white py-16 px-6 sm:py-24 md:grid md:place-items-center lg:px-8">
                <div className="mx-auto">
                    <main className="sm:flex">
                        <p className="text-4xl font-bold tracking-tight text-slate-600 sm:text-5xl">404</p>
                        <div className="sm:ml-6">
                            <div className="sm:border-l sm:border-gray-200 sm:pl-6">
                                <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">Page not found</h1>
                                <p className="mt-1 text-base text-gray-500">Please check the URL in the address bar and try again.</p>
                            </div>
                            <div className="mt-10 flex space-x-3 sm:border-l sm:border-transparent sm:pl-6">
                                <Button title='Go Home' buttonStyle={ButtonStyleType.PRIMARY} onClick={() => {
                                    Navigation.navigate(props.homeRoute);
                                }} />
                                <Button title='Contact Support' buttonStyle={ButtonStyleType.NORMAL} onClick={() => {
                                    Navigation.navigate(URL.fromString("mailto:"+props.supportEmail.toString()));
                                }} />
                            </div>
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
};
export default NotFound;
