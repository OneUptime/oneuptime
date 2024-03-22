import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    className?: string | undefined;
    rightElement?: ReactElement | undefined;
}

const Navbar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const className: string =
        props.className || 'flex text-center lg:space-x-8 lg:py-2 bg-white ';

    return (
        <nav className={props.rightElement ? `flex justify-between` : ''}>
            <div className={className}>{props.children}</div>
            {props.rightElement && (
                <div className={className}>{props.rightElement}</div>
            )}
        </nav>
    );
};

export default Navbar;
