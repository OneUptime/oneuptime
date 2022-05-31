import React, { ReactElement, FC, MouseEventHandler } from 'react';

export interface ComponentProps {
    isActive?: boolean;
    subSidebar?: Array<ReactElement>;
    action?: MouseEventHandler;
    title: string;
}

const SubItem: FC<ComponentProps> = ({
    isActive,
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
            <>
                {subSidebar?.map((item, index) => (
                    <React.Fragment key={index}>{item}</React.Fragment>
                ))}
            </>
        </div>
    );
};

export default SubItem;
