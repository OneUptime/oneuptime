import Link from 'Common/Types/Link';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Analytics from '../../Utils/Analytics';
import Breadcrumbs from '../Breadcrumbs/Breadcrumbs';

export interface ComponentProps {
    title: string;
    breadcrumbLinks: Array<Link>;
    children: Array<ReactElement> | ReactElement;
    sideMenu?: undefined | ReactElement;
}

const Page: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    useEffect(() => {
        if (props.breadcrumbLinks && props.breadcrumbLinks.length > 0) {
            Analytics.capture(
                'Page View: ' +
                    props.breadcrumbLinks
                        .map((link: Link) => {
                            return link.title;
                        })
                        .join(' > ')
                        .toString() || ''
            );
        }
    }, [props.breadcrumbLinks]);

    return (
        <div className="mx-auto max-w-full px-4 sm:px-6 lg:px-8 mt-5 mb-5">
            <div className="">
                <div className="mt-2">
                    <Breadcrumbs links={props.breadcrumbLinks} />
                </div>
                <div className="mt-2 md:flex md:items-center md:justify-between">
                    <div className="min-w-0">
                        <h2 className="text-xl leading-7 font-bold text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
                            {props.title}
                        </h2>
                    </div>
                </div>
            </div>

            {props.sideMenu && (
                <main className="mx-auto max-w-full pb-10 mt-5">
                    <div className="lg:grid lg:grid-cols-12 lg:gap-x-5">
                        {props.sideMenu}

                        <div className="space-y-6 sm:px-6 lg:col-span-9 lg:px-0">
                            {props.children}
                        </div>
                    </div>
                </main>
            )}

            {!props.sideMenu && props.children}
        </div>
    );
};

export default Page;
