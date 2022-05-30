import React, { ReactElement, FC, MouseEventHandler } from 'react';

export interface ComponentProps {
    title: string;
    action?: MouseEventHandler;
}

const SubSidebar: FC<ComponentProps> = ({ title, action }): ReactElement => {
    return (
        <div className="subsidebar" onClick={action}>
            {title}
        </div>
    );
};

export default SubSidebar;
