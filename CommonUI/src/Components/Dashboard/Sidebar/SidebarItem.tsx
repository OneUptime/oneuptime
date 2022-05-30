import React, { ReactElement, FC, MouseEventHandler } from 'react';

export interface ComponentProps {
    isActive?: boolean;
    showSubsidebar?: boolean;
    subSidebar?: Array<ReactElement>;
    action?: MouseEventHandler;
    title: string;
}

const SidebarItem: FC<ComponentProps> = ({
    isActive,
    showSubsidebar,
    subSidebar,
    title,
    action,
}): ReactElement => {
    return (
        <div className="side_bar">
            <div
                className={`sidebar_label ${isActive && 'active_sidebar'}`}
                onClick={action}
            >
                {title}
            </div>
            {showSubsidebar && (
                <>
                    {subSidebar?.map((item, index) => (
                        <React.Fragment key={index}>{item}</React.Fragment>
                    ))}
                </>
            )}
        </div>
    );
};

export default SidebarItem;
