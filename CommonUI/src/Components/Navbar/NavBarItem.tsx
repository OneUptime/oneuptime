import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../Basic/Icon/Icon';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    icon?: IconProp;
    route?: Route;
    isActive?: boolean;
    children?: ReactElement | Array<ReactElement>;
}

const NavBarItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <li className={`nav-item dropdown ${props.isActive ? 'active' : ''}`}>
            <Link
                className="nav-link dropdown-toggle arrow-none active"
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
