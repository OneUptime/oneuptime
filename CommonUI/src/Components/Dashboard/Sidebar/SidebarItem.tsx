import Route from 'Common/Types/API/Route';
import React, { ReactElement, FunctionComponent } from 'react';
import Navigation from '../../../Utils/Navigation';

export interface ComponentProps {
    children?: Array<ReactElement> | ReactElement;
    title: string;
    route: Route;
}

const SidebarItem: FunctionComponent<ComponentProps> = ({
    children,
    title,
    route,
}: ComponentProps): ReactElement => {
    return (
        <div className="sideBar">
            <div
                className={`sidebarLabel ${
                    route.toString() === Navigation.getLocation().toString() &&
                    'activeSidebar'
                }`}
                onClick={() => {
                    Navigation.navigate(route);
                }}
            >
                {title}
            </div>
            {children}
        </div>
    );
};

export default SidebarItem;
