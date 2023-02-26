import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    route: Route;
    icon: IconProp;
    description: string;
    onClick: () => void;
}

const NavBarMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="dropdown">
            <Link
                onClick={props.onClick}
                to={props.route}
                className="-m-3 flex items-start rounded-lg p-3 transition duration-150 ease-in-out hover:bg-gray-50"
            >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-indigo-500 text-white sm:h-12 sm:w-12">
                    <Icon icon={props.icon} className="h-6 w-6" />
                </div>
                <div className="ml-4">
                    <p className="text-base font-medium text-gray-900">
                        {props.title}
                    </p>
                    <p className="text-sm text-gray-500">{props.description}</p>
                </div>
            </Link>
        </div>
    );
};

export default NavBarMenuItem;
