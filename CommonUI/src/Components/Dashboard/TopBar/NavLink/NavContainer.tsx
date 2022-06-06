import React, { ReactElement, FunctionComponent } from 'react';

export interface ComponentProps {
    navigations: Array<ReactElement>;
}

const NavContainer: FunctionComponent<ComponentProps> = ({
    navigations,
}): ReactElement => {
    return (
        <div className="navigation-rack">
            {navigations.map((navigation, index) => {
                return (
                    <React.Fragment key={index}>{navigation}</React.Fragment>
                );
            })}
        </div>
    );
};

export default NavContainer;
