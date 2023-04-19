// Tailwind

import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    className?: string | undefined;
}

const Navbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const className: string =
        props.className || 'hidden lg:flex lg:space-x-8 lg:py-2 bg-white';

    return <nav className={className}>{props.children}</nav>;
};

export default Navbar;
