import React, { ReactElement, FunctionComponent } from 'react';
import './Sidebar.scss';

export interface ComponentProps {
    title: string;
    children: Array<ReactElement>;
}

const Sidebar: FunctionComponent<ComponentProps> = ({
    title,
    children,
}: ComponentProps): ReactElement => {
    return (
        <div className="sideBar">
            <h2>{title}</h2>
            <div className="sidebarList">{children}</div>
        </div>
    );
};

export default Sidebar;
