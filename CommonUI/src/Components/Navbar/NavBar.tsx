// Tailwind

import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
}

const Navbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let className: string = 'hidden lg:flex lg:space-x-8 lg:py-2 bg-white';

    return (
        <nav className={className}>
            {props.children}
        </nav>
    );
};

export default Navbar;
