import React, { ReactElement, FunctionComponent } from 'react';

export interface ComponentProps {
    title: string;
    isActive?: boolean;
}

const NavLink: FunctionComponent<ComponentProps> = ({
    title,
    isActive,
}: ComponentProps): ReactElement => {
    return (
        <div className={`${isActive ? 'active' : ''} nav-item`}>
            <p>{title}</p>
        </div>
    );
};

export default NavLink;
