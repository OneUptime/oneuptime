import Route from 'Common/Types/API/Route';
import React, { ReactElement, FunctionComponent } from 'react';
import Navigation from '../../../Utils/Navigation';

export interface ComponentProps {
    title: string;
    isActive?: boolean;
    route: Route;
}

const NavLink: FunctionComponent<ComponentProps> = ({
    title,
    isActive,
    route,
}: ComponentProps): ReactElement => {
    return (
        <div
            onClick={() => {
                Navigation.navigate(route);
            }}
            className={`${isActive ? 'active' : ''} nav-item`}
        >
            <p>{title}</p>
        </div>
    );
};

export default NavLink;
