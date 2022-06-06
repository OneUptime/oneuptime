import React, { ReactElement, FunctionComponent } from 'react';

export interface ComponentProps {
    children: ReactElement;
    isActive?: boolean;
}

const NavLink: FunctionComponent<ComponentProps> = ({
    children,
    isActive,
}): ReactElement => {
    return (
        <div className={`${isActive ? 'active' : ''} nav-item`}>{children}</div>
    );
};

export default NavLink;
