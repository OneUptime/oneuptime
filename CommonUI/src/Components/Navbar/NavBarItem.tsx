import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import Navigation from '../../Utils/Navigation';
import Icon, { IconProp } from '../Basic/Icon/Icon';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    icon?: IconProp;
    route?: Route;
    children?: ReactElement | Array<ReactElement>;
}

const NavBarItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <li
            className={`nav-item pointer dropdown ${
                props.route && Navigation.isOnThisPage(props.route)
                    ? 'active'
                    : ''
            }`}
        >
            <Link
                className="nav-link dropdown-toggle arrow-none"
                to={props.route ? props.route : null}
            >
                {props.icon ? <Icon icon={props.icon} /> : <></>}
                <span>{props.title}</span>
                {props.children ? <div className="arrow-down"></div> : <></>}
            </Link>
            {props.children}
        </li>
    );
};

export default NavBarItem;
