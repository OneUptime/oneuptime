import Route from 'Common/Types/API/Route';
import React, { ReactElement } from 'react';
import Icon, { IconProp } from '../Basic/Icon/Icon';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    route: Route;
    children?: Array<ReactElement> | ReactElement;
    icon?: IconProp;
}

const NavBarMenuItem = (props: ComponentProps): ReactElement => {
    let children: Array<ReactElement> = [];

    if (props.children && !Array.isArray(props.children)) {
        children = [props.children as ReactElement];
    } else {
        children = props.children ? props.children : [];
    }

    if (children.length === 0) {
        return (
            <Link className="dropdown-item" to={props.route}>
                {props.title}
            </Link>
        );
    }
    return (
        <div className="dropdown">
            <Link className="dropdown-item" to={props.route}>
                {props.icon ? <Icon icon={props.icon} /> : <></>}
                <span>{props.title}</span>
            </Link>
            <div className="dropdown-menu">{children}</div>
        </div>
    );
};

export default NavBarMenuItem;
