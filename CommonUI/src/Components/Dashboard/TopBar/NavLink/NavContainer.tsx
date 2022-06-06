import React, { ReactElement, FC } from 'react';

export interface ComponentProps {
    navigations: Array<ReactElement>;
}

const NavContainer: FC<ComponentProps> = ({ navigations }): ReactElement => {
    return (
        <div className="navigation-rack">
            {navigations.map((navigation, index) => (
                <React.Fragment key={index}>{navigation}</React.Fragment>
            ))}
        </div>
    );
};

export default NavContainer;
