// Tailwind

import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    isRenderedOnMobile?: boolean;
}

const Navbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let className: string = 'hidden lg:flex lg:space-x-8 lg:py-2';

    if (props.isRenderedOnMobile) {
        className = 'space-y-1 px-2 pt-2 pb-3';
    }

    return (
        <nav className={className} aria-label="Global">
            {props.children}
        </nav>
    );
};

export default Navbar;
