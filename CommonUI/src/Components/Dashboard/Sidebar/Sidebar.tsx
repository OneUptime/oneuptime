import React, { ReactElement, FC } from 'react';
import './Sidebar.scss';

export interface ComponentProps {
    title: string;
    children: Array<ReactElement>;
}

const Sidebar: FC<ComponentProps> = ({ title, children }): ReactElement => {
    return (
        <div className="sideBar">
            <h2>{title}</h2>
            <div className="sidebarList">{children}</div>
        </div>
    );
};

export default Sidebar;
