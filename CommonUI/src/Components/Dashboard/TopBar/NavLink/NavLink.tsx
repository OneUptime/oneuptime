import React, { ReactElement, FC } from 'react';

export interface ComponentProps {
    children: ReactElement;
    isActive?: boolean;
}

const NavLink: FC<ComponentProps> = ({ children, isActive }): ReactElement => {
    return (
        <div className={`${isActive ? 'active' : ''} nav-item`}>{children}</div>
    );
};

export default NavLink;
