import type Route from 'Common/Types/API/Route';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type { IconProp } from '../Icon/Icon';
import Icon, { SizeProp } from '../Icon/Icon';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    route: Route;
    children?: undefined | Array<ReactElement> | ReactElement;
    icon?: undefined | IconProp;
}

const NavBarMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let children: Array<ReactElement> = [];

    if (props.children && !Array.isArray(props.children)) {
        children = [props.children as ReactElement];
    } else {
        children = props.children ? props.children : [];
    }

    const getDropdownItem: Function = (): ReactElement => {
        return (
            <Link className="dropdown-item flex" to={props.route}>
                {props.icon ? (
                    <>
                        <Icon icon={props.icon} size={SizeProp.Large} /> &nbsp;
                    </>
                ) : (
                    <></>
                )}
                <span>{props.title}</span>
            </Link>
        );
    };

    if (children.length === 0) {
        return getDropdownItem();
    }

    return (
        <div className="dropdown">
            {getDropdownItem()}
            <div className="dropdown-menu">{children}</div>
        </div>
    );
};

export default NavBarMenuItem;
