// Tailwind

import type Route from 'Common/Types/API/Route';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import Navigation from '../../Utils/Navigation';
import type { IconProp } from '../Icon/Icon';
import Icon, { ThickProp } from '../Icon/Icon';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    icon?: undefined | IconProp;
    route?: undefined | Route;
    children?: undefined | ReactElement | Array<ReactElement>;
    isRenderedOnMobile?: boolean;
}

const NavBarItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const isActive: boolean = Boolean(
        props.route && Navigation.isOnThisPage(props.route)
    );

    let classNames: string =
        'text-gray-500 hover:bg-gray-50 hover:text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium';

    if (isActive) {
        classNames =
            'bg-gray-100 text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium';
    }

    if (props.isRenderedOnMobile) {
        classNames =
            'text-gray-900 hover:bg-gray-50 hover:text-gray-900 block rounded-md py-2 px-3 text-base font-medium';
        if (isActive) {
            classNames =
                'bg-gray-100 text-gray-900 block rounded-md py-2 px-3 text-base font-medium';
        }
    }

    return (
        <>
            <Link className={classNames} to={props.route ? props.route : null}>
                {props.icon ? (
                    <Icon
                        icon={props.icon}
                        className="mr-1 h-4 w-4"
                        thick={ThickProp.Thick}
                    />
                ) : (
                    <></>
                )}
                <span>{props.title}</span>
                {props.children ? <div className="arrow-down"></div> : <></>}
            </Link>
            {props.children}
        </>
    );
};

export default NavBarItem;
