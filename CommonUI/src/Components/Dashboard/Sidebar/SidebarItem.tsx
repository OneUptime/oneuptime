import React, { ReactElement, FunctionComponent } from 'react';

export interface ComponentProps {
    isActive?: boolean;
    children?: Array<ReactElement> | ReactElement;
    title: string;
}

const SidebarItem: FunctionComponent<ComponentProps> = ({
    isActive,
    children,
    title,
}: ComponentProps): ReactElement => {
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
