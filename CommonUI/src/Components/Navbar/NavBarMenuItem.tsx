import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp } from '../Basic/Icon/Icon';
import Link from '../Link/Link';

export interface ComponentProps {
    title: string;
    route: Route;
    children?: Array<ReactElement> | ReactElement;
    icon?: IconProp;
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
            <Link className="dropdown-item" to={props.route}>
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
