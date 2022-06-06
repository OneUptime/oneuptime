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
}:ComponentProps): ReactElement => {
    return (
        <div className="side_bar">
            <div className={`sidebar_label ${isActive && 'active_sidebar'}`}>
                {title}
            </div>
            {children}
        </div>
    );
};

export default SidebarItem;
