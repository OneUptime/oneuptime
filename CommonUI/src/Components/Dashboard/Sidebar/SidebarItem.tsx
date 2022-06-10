import React, { ReactElement, FC } from 'react';

export interface ComponentProps {
    isActive?: boolean;
    children?: Array<ReactElement> | ReactElement;
    title: string;
}

const SidebarItem: FC<ComponentProps> = ({
    isActive,
    children,
    title,
}): ReactElement => {
    return (
        <div className="sideBar">
            <div className={`sidebarLabel ${isActive && 'activeSidebar'}`}>
                {title}
            </div>
            {children}
        </div>
    );
};

export default SidebarItem;
