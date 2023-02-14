import URL from 'Common/Types/API/URL';
import React, { FunctionComponent, ReactElement } from 'react';
import Link from '../Link/Link';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    footer?: {
        title: string;
        description: string;
        link: URL;
    }
}

const NavBarItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let children: Array<ReactElement>;
    if (!Array.isArray(props.children) && props.children) {
        children = [props.children];
    } else {
        children = props.children;
    }
    return (
        <div className="absolute left-1/2 z-10 mt-10 w-screen max-w-md -translate-x-1/2 transform px-2 sm:px-0 lg:max-w-3xl">
            <div className="overflow-hidden rounded-lg shadow-lg ring-1 ring-black ring-opacity-5">
                <div className="relative grid gap-6 bg-white px-5 py-6 sm:gap-8 sm:p-8 lg:grid-cols-2">
                    {children}
                </div>
                {props.footer && <div className="bg-gray-50 p-5 sm:p-8">
                    <Link to={props.footer.link} openInNewTab={true} className="-m-3 flow-root rounded-md p-3 transition duration-150 ease-in-out hover:bg-gray-100">
                        <span className="flex items-center">
                            <span className="text-base font-medium text-gray-900">{props.footer.title}</span>
                        </span>
                        <span className="mt-1 block text-sm text-gray-500">{props.footer.description}</span>
                    </Link>
                </div>}
            </div>
        </div>
    );
};

export default NavBarItem;
