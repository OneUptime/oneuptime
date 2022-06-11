import Route from 'Common/Types/API/Route';
import React, { ReactElement, FunctionComponent } from 'react';
import Navigation from '../../../Utils/Navigation';

export interface ComponentProps {
    title: string;
    route: Route;
}

const NavLink: FunctionComponent<ComponentProps> = ({
    title,
    route,
}: ComponentProps): ReactElement => {
    return (
        <div
            onClick={() => {
                Navigation.navigate(route);
            }}
            className={`${
                Navigation.getLocation().toString() === route.toString()
                    ? 'active'
                    : ''
            } nav-item`}
        >
            <p>{title}</p>
        </div>
    );
};

export default NavLink;
